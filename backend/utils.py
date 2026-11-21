"""Shared helpers for NetPulse backend modules."""

from __future__ import annotations

import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor, wait


class CapabilityError(RuntimeError):
    """Raised when an operation needs privileges or system tools that are unavailable
    (e.g. raw sockets without root/Npcap, or nmap not installed)."""


def is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast


def reverse_dns_many(ips: list[str], timeout: float = 2.0, workers: int = 32) -> dict[str, str | None]:
    """Resolve hostnames for many IPs concurrently, bounded by an overall timeout."""
    results: dict[str, str | None] = {ip: None for ip in ips}
    if not ips:
        return results

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
