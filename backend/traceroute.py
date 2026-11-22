"""Traceroute with geolocation.

For a domain/IP returns hops: {hop_number, ip, hostname, rtt_ms, geo: {lat, lon, city, country}}.
Probes are sent with scapy (ICMP echo with increasing TTL). If raw sockets are
unavailable, falls back to the system `tracert`/`traceroute` command.
Geo data comes from the ip-api.com batch endpoint (free tier, HTTP only, 15 req/min).

`trace_events()` yields progress events as each hop is discovered (used by the
/ws/traceroute stream); `traceroute()` runs it to completion (used by the REST API).
"""

from __future__ import annotations

import logging
import platform
import re
import socket
import subprocess
import time
from collections.abc import Callable, Iterator

import requests

from utils import CapabilityError, is_permission_error, is_private_ip, reverse_dns_many

log = logging.getLogger(__name__)

IP_API_BATCH = "http://ip-api.com/batch?fields=status,query,lat,lon,city,country"
_HOST_RE = re.compile(r"^[A-Za-z0-9.\-:]{1,253}$")


def _resolve(target: str) -> str:
    if not _HOST_RE.match(target):
        raise ValueError(f"Invalid target: {target!r}")
    try:
        return socket.gethostbyname(target)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve {target!r}") from exc


# ---------------------------------------------------------------------------
# Probing
# ---------------------------------------------------------------------------
def _scapy_probe(dst_ip: str, ttl: int, timeout: float) -> tuple[dict, bool]:
    """Send one ICMP echo with the given TTL. Returns (hop, reached_destination)."""
    from scapy.all import ICMP, IP, sr1

    pkt = IP(dst=dst_ip, ttl=ttl) / ICMP(id=0x4E50, seq=ttl)
    start = time.perf_counter()
    reply = sr1(pkt, timeout=timeout, verbose=False)
    rtt = round((time.perf_counter() - start) * 1000, 2)
    if reply is None:
        return {"hop_number": ttl, "ip": None, "rtt_ms": None}, False
    # Prefer the kernel/pcap timestamps when available for accuracy.
    if getattr(reply, "time", None) and getattr(pkt, "sent_time", None):
        rtt = round((reply.time - pkt.sent_time) * 1000, 2)
    reached = reply.src == dst_ip or (reply.haslayer(ICMP) and reply[ICMP].type == 0)
    return {"hop_number": ttl, "ip": reply.src, "rtt_ms": rtt}, reached


_HOP_LINE = re.compile(r"^\s*(\d+)\s+(.*)$")
_RTT = re.compile(r"(<?\d+(?:\.\d+)?)\s*ms")
_IPV4 = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")


def _system_hops(dst_ip: str, max_hops: int, timeout: float, should_stop: Callable[[], bool]) -> Iterator[dict]:
    """Run the OS traceroute and yield hops as its output lines arrive."""
    if platform.system() == "Windows":
        cmd = ["tracert", "-d", "-h", str(max_hops), "-w", str(int(timeout * 1000)), dst_ip]
    else:
        cmd = ["traceroute", "-n", "-q", "1", "-m", str(max_hops), "-w", str(max(1, int(timeout))), dst_ip]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, errors="replace")
    except FileNotFoundError as exc:
        raise CapabilityError(f"{cmd[0]} not available and raw sockets not permitted") from exc

    deadline = time.time() + max_hops * (timeout * 3 + 1)
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if should_stop():
                break
            if time.time() > deadline:
                raise TimeoutError("traceroute timed out")
            m = _HOP_LINE.match(line)
            if not m:
                continue
            rest = m.group(2)
            ip_m = _IPV4.search(rest)
            rtts = [float(r.lstrip("<")) for r in _RTT.findall(rest)]
            yield {
                "hop_number": int(m.group(1)),
                "ip": ip_m.group(1) if ip_m else None,
                "rtt_ms": round(min(rtts), 2) if rtts else None,
            }
    finally:
        if proc.poll() is None:
            proc.kill()


# ---------------------------------------------------------------------------
# Enrichment
# ---------------------------------------------------------------------------
def _geolocate(ips: list[str]) -> dict[str, dict]:
    public = sorted({ip for ip in ips if ip and not is_private_ip(ip)})
    geo: dict[str, dict] = {}
    if not public:
        return geo
    try:
        resp = requests.post(IP_API_BATCH, json=public[:100], timeout=5)
        resp.raise_for_status()
        for item in resp.json():
            if item.get("status") == "success":
                geo[item["query"]] = {
                    "lat": item.get("lat"),
                    "lon": item.get("lon"),
                    "city": item.get("city"),
                    "country": item.get("country"),
                }
    except (requests.RequestException, ValueError) as exc:
        log.warning("ip-api.com geolocation failed: %s", exc)
    return geo


def _enrich(hops: list[dict]) -> list[dict]:
    ips = [h["ip"] for h in hops if h["ip"]]
    names = reverse_dns_many(ips)
    geo = _geolocate(ips)
    return [
        {
            "hop_number": h["hop_number"],
            "ip": h["ip"],
            "hostname": names.get(h["ip"]) if h["ip"] else None,
            "rtt_ms": h["rtt_ms"],
            "geo": geo.get(h["ip"]) if h["ip"] else None,
        }
        for h in hops
    ]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def trace_events(
    target: str,
    max_hops: int = 30,
    timeout: float = 2.0,
    should_stop: Callable[[], bool] = lambda: False,
) -> Iterator[dict]:
    """Run a traceroute, yielding progress events. Blocking — iterate in a worker thread.

    Events, in order:
      {"type": "start",    "target", "destination_ip", "method", "max_hops"}
      {"type": "hop",      "hop": {hop_number, ip, rtt_ms}}           (one per hop)
      {"type": "locating", "count": <hops to look up>}
      {"type": "done",     "result": <same shape as traceroute()>}
    """
    dst_ip = _resolve(target)
    hops: list[dict] = []

    # Probe TTL 1 first: it tells us whether raw sockets work before announcing a method.
    try:
        first, reached = _scapy_probe(dst_ip, 1, timeout)
        method = "scapy"
    except Exception as exc:
        if is_permission_error(exc):
            log.info("Raw sockets unavailable; using system traceroute")
        else:
            log.warning("scapy traceroute failed (%s); using system traceroute", exc)
        method, first, reached = "system", None, False

    yield {"type": "start", "target": target, "destination_ip": dst_ip, "method": method, "max_hops": max_hops}

    if method == "scapy":
        hops.append(first)
        yield {"type": "hop", "hop": first}
        ttl = 1
        while not reached and ttl < max_hops and not should_stop():
            ttl += 1
            hop, reached = _scapy_probe(dst_ip, ttl, timeout)
            hops.append(hop)
            yield {"type": "hop", "hop": hop}
    else:
        for hop in _system_hops(dst_ip, max_hops, timeout, should_stop):
            hops.append(hop)
            yield {"type": "hop", "hop": hop}

    if should_stop():
        return

    yield {"type": "locating", "count": sum(1 for h in hops if h["ip"])}
    enriched = _enrich(hops)
    yield {
        "type": "done",
        "result": {
            "target": target,
            "destination_ip": dst_ip,
            "method": method,
            "reached": bool(enriched) and enriched[-1]["ip"] == dst_ip,
            "hops": enriched,
        },
    }


def traceroute(target: str, max_hops: int = 30, timeout: float = 2.0) -> dict:
    """Run a full traceroute and return the final result. Blocking — call from a worker thread."""
    result: dict | None = None
    for event in trace_events(target, max_hops, timeout):
        if event["type"] == "done":
            result = event["result"]
    assert result is not None
    return result
