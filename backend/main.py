"""NetPulse — FastAPI entry point.

Run locally:  python main.py   (or: uvicorn main:app --reload)
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import port_scanner
import scanner
import traceroute as tracer
import traffic_monitor
from utils import CapabilityError, scan_interface

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("netpulse")

WS_INTERVAL_S = 2.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _error_detail(exc: BaseException) -> str:
    if isinstance(exc, (ValueError, CapabilityError, TimeoutError)):
        return str(exc)
    return f"{type(exc).__name__}: {exc}"


# ---------------------------------------------------------------------------
# Live traffic broadcasting
# ---------------------------------------------------------------------------
class TrafficBroadcaster:
    """Runs one shared sniffer and pushes interval stats to every connected client."""

    def __init__(self) -> None:
        self.monitor = traffic_monitor.LiveTrafficMonitor(iface=scan_interface())
        self.clients: set[WebSocket] = set()
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        async with self._lock:
            if not self.clients:
                await run_in_threadpool(self.monitor.subscribe)  # may raise CapabilityError
                self._task = asyncio.create_task(self._loop())
            self.clients.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            if ws not in self.clients:
                return
            self.clients.discard(ws)
            if not self.clients:
                if self._task:
                    self._task.cancel()
                    self._task = None
                await run_in_threadpool(self.monitor.unsubscribe)

    async def _loop(self) -> None:
        self.monitor.interval_snapshot()  # discard warm-up data
        while True:
            await asyncio.sleep(WS_INTERVAL_S)
            payload = {"type": "traffic_stats", "timestamp": _now(), **self.monitor.interval_snapshot()}
            for ws in list(self.clients):
                try:
                    await ws.send_json(payload)
                except Exception:
                    self.clients.discard(ws)

    async def shutdown(self) -> None:
        if self._task:
            self._task.cancel()
        if self.clients:
            self.clients.clear()
            await run_in_threadpool(self.monitor.unsubscribe)


broadcaster = TrafficBroadcaster()


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("NetPulse backend starting")
    yield
    await broadcaster.shutdown()


app = FastAPI(
    title="NetPulse API",
    description="Real-Time Network Topology Visualizer & Analyzer",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # must be False with wildcard origins
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class PortScanRequest(BaseModel):
    ip: str = Field(..., examples=["192.168.1.1"])


class TracerouteRequest(BaseModel):
    target: str = Field(..., examples=["google.com"])
    max_hops: int = Field(30, ge=1, le=64)


async def _run(func, *args, **kwargs):
    """Run a blocking network operation in a worker thread with uniform error mapping."""
    try:
        return await run_in_threadpool(func, *args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CapabilityError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Unhandled error in %s", getattr(func, "__name__", func))
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": _now()}


@app.get("/api/scan/network")
async def scan_network(subnet: str | None = Query(None, description="CIDR override, e.g. 192.168.1.0/24")):
    result = await _run(scanner.scan_network, subnet)
    return {"timestamp": _now(), **result}


@app.post("/api/scan/ports")
async def scan_ports(req: PortScanRequest):
    result = await _run(port_scanner.scan_ports, req.ip)
    return {"timestamp": _now(), **result}


@app.post("/api/traceroute")
async def run_traceroute(req: TracerouteRequest):
    result = await _run(tracer.traceroute, req.target, req.max_hops)
    return {"timestamp": _now(), **result}


@app.get("/api/traffic")
async def traffic(duration: int = Query(10, ge=1, le=120, description="Capture window in seconds")):
    result = await _run(traffic_monitor.capture, duration, scan_interface())
    return {"timestamp": _now(), **result}


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------
@app.websocket("/ws/traffic")
async def ws_traffic(ws: WebSocket):
    await ws.accept()
    try:
        await broadcaster.connect(ws)
    except Exception as exc:
        await ws.send_json({"type": "error", "timestamp": _now(), "detail": _error_detail(exc)})
        await ws.close(code=1011)
        return
    try:
        while True:
            await ws.receive_text()  # keep-alive; also detects disconnects
    except WebSocketDisconnect:
        pass
    finally:
        await broadcaster.disconnect(ws)


@app.websocket("/ws/traceroute")
async def ws_traceroute(ws: WebSocket):
    """Stream a traceroute hop by hop.

    Client sends {"target": "google.com", "max_hops": 30}; server replies with
    start → hop (one per hop) → locating → done events, or a single error event.
    """
    await ws.accept()
    try:
        req = await asyncio.wait_for(ws.receive_json(), timeout=10)
        target = str(req.get("target", "")).strip()
        max_hops = max(1, min(64, int(req.get("max_hops", 30))))
        if not target:
            raise ValueError("target is required")
    except (asyncio.TimeoutError, ValueError, TypeError, AttributeError) as exc:
        detail = "No request received" if isinstance(exc, asyncio.TimeoutError) else f"Invalid request: {exc}"
        await ws.send_json({"type": "error", "timestamp": _now(), "detail": detail})
        await ws.close(code=1008)
        return
    except WebSocketDisconnect:
        return

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    stop = threading.Event()

    def worker() -> None:
        # Runs the blocking probes in a thread and hands events back to the event loop.
        try:
            for event in tracer.trace_events(target, max_hops, should_stop=stop.is_set):
                loop.call_soon_threadsafe(queue.put_nowait, event)
        except Exception as exc:
            if not isinstance(exc, (ValueError, CapabilityError, TimeoutError)):
                log.exception("traceroute stream failed")
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "detail": _error_detail(exc)})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    task = loop.run_in_executor(None, worker)
    try:
        while (event := await queue.get()) is not None:
            await ws.send_json({**event, "timestamp": _now()})
        await ws.close()
    except (WebSocketDisconnect, RuntimeError):
        pass  # client went away mid-trace
    finally:
        stop.set()  # stops probing after the current hop
        await task


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
