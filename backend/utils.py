"""Shared helpers for NetPulse backend modules."""

from __future__ import annotations

import ipaddress
import logging
import os
import socket
from concurrent.futures import ThreadPoolExecutor, wait
from functools import lru_cache

log = logging.getLogger(__name__)


def env_int(name: str, default: int, lo: int = 1, hi: int = 256) -> int:
    """Read an int env var, clamped to [lo, hi]; falls back to default if unset/invalid."""
    try:
        return max(lo, min(hi, int(os.getenv(name, default))))
    except (TypeError, ValueError):
        log.warning("Invalid %s=%r; using %d", name, os.getenv(name), default)
        return default


def max_scan_threads() -> int:
    """Worker threads for ping sweeps and reverse-DNS lookups (MAX_SCAN_THREADS)."""
    return env_int("MAX_SCAN_THREADS", 32)


@lru_cache(maxsize=4)
def _resolve_iface(name: str):
    from scapy.all import conf

    for finder in (conf.ifaces.dev_from_name, conf.ifaces.dev_from_networkname):
        try:
            return finder(name)
        except (ValueError, KeyError):
            continue
    available = ", ".join(sorted({i.name for i in conf.ifaces.values()}))
    log.warning("SCAN_INTERFACE=%r not found; using the default interface. Available: %s", name, available)
    return None


def scan_interface():
    """The scapy interface named by SCAN_INTERFACE (or legacy NETPULSE_IFACE), else None (= default).

    An unknown name logs a warning and falls back to the default, so a Docker-style
    value like `eth0` in .env doesn't break a native Windows run.
    """
    name = (os.getenv("SCAN_INTERFACE") or os.getenv("NETPULSE_IFACE") or "").strip()
    if not name:
        return None
    try:
        return _resolve_iface(name)
    except Exception as exc:  # scapy unavailable
        log.debug("interface lookup failed: %s", exc)
        return None


class CapabilityError(RuntimeError):
    """Raised when an operation needs privileges or system tools that are unavailable
    (e.g. raw sockets without root/Npcap, or nmap not installed)."""


def is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast


def reverse_dns_many(ips: list[str], timeout: float = 2.0, workers: int | None = None) -> dict[str, str | None]:
    """Resolve hostnames for many IPs concurrently, bounded by an overall timeout."""
    results: dict[str, str | None] = {ip: None for ip in ips}
    if not ips:
        return results
    workers = workers or max_scan_threads()

    def lookup(ip: str) -> tuple[str, str | None]:
        try:
            return ip, socket.gethostbyaddr(ip)[0]
        except (socket.herror, socket.gaierror, OSError):
            return ip, None

    pool = ThreadPoolExecutor(max_workers=min(workers, len(ips)))
    futures = [pool.submit(lookup, ip) for ip in ips]
    done, _ = wait(futures, timeout=timeout)
    for f in done:
        ip, name = f.result()
        results[ip] = name
    # Don't block on stragglers (gethostbyaddr has no native timeout).
    pool.shutdown(wait=False, cancel_futures=True)
    return results


def is_permission_error(exc: BaseException) -> bool:
    """Heuristic: does this scapy/socket exception mean 'need root / Npcap'?"""
    if isinstance(exc, PermissionError):
        return True
    msg = str(exc).lower()
    return any(
        s in msg
        for s in ("operation not permitted", "permission", "winpcap", "npcap", "libpcap", "access is denied")
    )
