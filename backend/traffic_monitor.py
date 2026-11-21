"""Packet sniffer using scapy.

capture(duration) sniffs for N seconds and returns:
  {protocol_counts: {TCP, UDP, ICMP, DNS, HTTP}, top_ips: [{ip, packet_count}], bandwidth_bps, ...}

LiveTrafficMonitor runs one shared background sniffer and hands out per-interval
snapshots, used by the /ws/traffic WebSocket.

Sniffing needs root/CAP_NET_RAW on Linux or Npcap on Windows.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import Counter

from utils import CapabilityError, is_permission_error

log = logging.getLogger(__name__)

HTTP_PORTS = {80, 8000, 8080}
HTTP_METHODS = (b"GET ", b"POST ", b"PUT ", b"DELETE ", b"HEAD ", b"PATCH ", b"OPTIONS ", b"HTTP/1.")


class TrafficStats:
    """Thread-safe packet statistics accumulator."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._reset()

    def _reset(self) -> None:
        self.protocols = Counter({"TCP": 0, "UDP": 0, "ICMP": 0, "DNS": 0, "HTTP": 0, "OTHER": 0})
        self.ips: Counter[str] = Counter()
        self.total_packets = 0
        self.total_bytes = 0
        self.started = time.monotonic()

    def add(self, pkt) -> None:
        from scapy.all import DNS, ICMP, IP, TCP, UDP, IPv6, Raw

        tags: list[str] = []
        if pkt.haslayer(TCP):
            tags.append("TCP")
            tcp = pkt[TCP]
            payload = bytes(pkt[Raw].load[:8]) if pkt.haslayer(Raw) else b""
            if tcp.sport in HTTP_PORTS or tcp.dport in HTTP_PORTS or payload.startswith(HTTP_METHODS):
                tags.append("HTTP")
        elif pkt.haslayer(UDP):
            tags.append("UDP")
        elif pkt.haslayer(ICMP):
            tags.append("ICMP")
        if pkt.haslayer(DNS):
            tags.append("DNS")
        if not tags:
            tags.append("OTHER")

        src = dst = None
        if pkt.haslayer(IP):
            src, dst = pkt[IP].src, pkt[IP].dst
        elif pkt.haslayer(IPv6):
            src, dst = pkt[IPv6].src, pkt[IPv6].dst

        size = len(pkt)
        with self._lock:
            self.total_packets += 1
            self.total_bytes += size
            for t in tags:
                self.protocols[t] += 1
            if src:
                self.ips[src] += 1
            if dst:
                self.ips[dst] += 1

    def snapshot(self, reset: bool = False, top_n: int = 10) -> dict:
        with self._lock:
            elapsed = max(time.monotonic() - self.started, 1e-6)
            data = {
                "protocol_counts": dict(self.protocols),
                "top_ips": [{"ip": ip, "packet_count": n} for ip, n in self.ips.most_common(top_n)],
                "bandwidth_bps": round(self.total_bytes * 8 / elapsed, 2),
                "total_packets": self.total_packets,
                "total_bytes": self.total_bytes,
                "duration_s": round(elapsed, 2),
            }
            if reset:
                self._reset()
            return data


def _wrap_sniff_error(exc: Exception) -> Exception:
    if is_permission_error(exc):
        return CapabilityError(
            "Packet capture requires root/CAP_NET_RAW (Linux) or Npcap + admin (Windows): " + str(exc)
        )
    return exc


def capture(duration: int = 10, iface: str | None = None) -> dict:
    """Sniff for `duration` seconds and return stats. Blocking — call from a worker thread."""
    from scapy.all import sniff

    stats = TrafficStats()
    try:
        sniff(prn=stats.add, store=False, timeout=duration, iface=iface)
    except Exception as exc:
        raise _wrap_sniff_error(exc) from exc
    result = stats.snapshot()
    # Report against the requested window rather than wall time spent in setup.
    result["bandwidth_bps"] = round(result["total_bytes"] * 8 / duration, 2)
    result["duration_s"] = duration
    return result


class LiveTrafficMonitor:
    """A single shared background sniffer, ref-counted by subscribers."""

    def __init__(self, iface: str | None = None) -> None:
        self.iface = iface
        self.stats = TrafficStats()
        self._sniffer = None
        self._subscribers = 0
        self._lock = threading.Lock()

    def subscribe(self) -> None:
        with self._lock:
            self._subscribers += 1
            if self._sniffer is None:
                self._start()

    def unsubscribe(self) -> None:
        with self._lock:
            self._subscribers = max(0, self._subscribers - 1)
            if self._subscribers == 0:
                self._stop()

    def _start(self) -> None:
        from scapy.all import AsyncSniffer

        self.stats = TrafficStats()
        sniffer = AsyncSniffer(prn=self.stats.add, store=False, iface=self.iface)
        try:
            sniffer.start()
            time.sleep(0.2)  # let the thread fail fast if capture is not permitted
            if not sniffer.running and getattr(sniffer, "exception", None):
                raise sniffer.exception
        except Exception as exc:
            raise _wrap_sniff_error(exc) from exc
        self._sniffer = sniffer
        log.info("Live traffic sniffer started")

    def _stop(self) -> None:
        if self._sniffer is not None:
            try:
                self._sniffer.stop()
            except Exception as exc:  # already stopped / never started
                log.debug("sniffer stop: %s", exc)
            self._sniffer = None
            log.info("Live traffic sniffer stopped")

    def interval_snapshot(self) -> dict:
        """Stats since the previous call (shared across subscribers)."""
        return self.stats.snapshot(reset=True)
