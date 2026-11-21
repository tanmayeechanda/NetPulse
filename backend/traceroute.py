"""Traceroute with geolocation.

For a domain/IP returns hops: {hop_number, ip, hostname, rtt_ms, geo: {lat, lon, city, country}}.
Probes are sent with scapy (ICMP echo with increasing TTL). If raw sockets are
unavailable, falls back to the system `tracert`/`traceroute` command.
Geo data comes from the ip-api.com batch endpoint (free tier, HTTP only, 15 req/min).
"""

from __future__ import annotations

import logging
import platform
import re
import socket
import subprocess
import time

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


def _scapy_trace(dst_ip: str, max_hops: int, timeout: float) -> list[dict]:
    from scapy.all import ICMP, IP, sr1

    hops: list[dict] = []
    for ttl in range(1, max_hops + 1):
        pkt = IP(dst=dst_ip, ttl=ttl) / ICMP(id=0x4E50, seq=ttl)
        start = time.perf_counter()
        reply = sr1(pkt, timeout=timeout, verbose=False)
        rtt = round((time.perf_counter() - start) * 1000, 2)
        if reply is None:
            hops.append({"hop_number": ttl, "ip": None, "rtt_ms": None})
            continue
        # Prefer the kernel/pcap timestamps when available for accuracy.
        if getattr(reply, "time", None) and getattr(pkt, "sent_time", None):
            rtt = round((reply.time - pkt.sent_time) * 1000, 2)
        hops.append({"hop_number": ttl, "ip": reply.src, "rtt_ms": rtt})
        if reply.src == dst_ip or (reply.haslayer(ICMP) and reply[ICMP].type == 0):
            break
    return hops


_HOP_LINE = re.compile(r"^\s*(\d+)\s+(.*)$")
_RTT = re.compile(r"(<?\d+(?:\.\d+)?)\s*ms")
_IPV4 = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")


def _system_trace(dst_ip: str, max_hops: int, timeout: float) -> list[dict]:
    if platform.system() == "Windows":
        cmd = ["tracert", "-d", "-h", str(max_hops), "-w", str(int(timeout * 1000)), dst_ip]
    else:
        cmd = ["traceroute", "-n", "-q", "1", "-m", str(max_hops), "-w", str(max(1, int(timeout))), dst_ip]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=max_hops * (timeout * 3 + 1)).stdout
    except FileNotFoundError as exc:
        raise CapabilityError(f"{cmd[0]} not available and raw sockets not permitted") from exc
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("traceroute timed out") from exc

    hops: list[dict] = []
    for line in out.splitlines():
        m = _HOP_LINE.match(line)
        if not m:
            continue
        rest = m.group(2)
        ip_m = _IPV4.search(rest)
        rtts = [float(r.lstrip("<")) for r in _RTT.findall(rest)]
        hops.append(
            {
                "hop_number": int(m.group(1)),
                "ip": ip_m.group(1) if ip_m else None,
                "rtt_ms": round(min(rtts), 2) if rtts else None,
            }
        )
    return hops


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


def traceroute(target: str, max_hops: int = 30, timeout: float = 2.0) -> dict:
    """Blocking — call from a worker thread."""
    dst_ip = _resolve(target)
    method = "scapy"
    try:
        hops = _scapy_trace(dst_ip, max_hops, timeout)
    except Exception as exc:
        if is_permission_error(exc):
            log.info("Raw sockets unavailable; using system traceroute")
        else:
            log.warning("scapy traceroute failed (%s); using system traceroute", exc)
        method = "system"
        hops = _system_trace(dst_ip, max_hops, timeout)

    ips = [h["ip"] for h in hops if h["ip"]]
    names = reverse_dns_many(ips)
    geo = _geolocate(ips)
    for h in hops:
        h["hostname"] = names.get(h["ip"]) if h["ip"] else None
        h["geo"] = geo.get(h["ip"]) if h["ip"] else None

    return {
        "target": target,
        "destination_ip": dst_ip,
        "method": method,
        "reached": bool(hops) and hops[-1]["ip"] == dst_ip,
        "hops": [
            {k: h[k] for k in ("hop_number", "ip", "hostname", "rtt_ms", "geo")} for h in hops
        ],
    }
