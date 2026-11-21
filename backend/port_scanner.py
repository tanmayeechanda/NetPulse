"""Port scanner using python-nmap: scans the top 100 TCP ports of a host.

Returns a list of {port, state, service}. Requires the `nmap` binary on PATH.
"""

from __future__ import annotations

import ipaddress
import os

from utils import CapabilityError

# Checked in order: explicit NMAP_PATH, PATH, then default install locations
# (the Windows installer doesn't always update PATH for already-open shells).
_DEFAULT_NMAP_PATHS = (
    "nmap",
    r"C:\Program Files (x86)\Nmap\nmap.exe",
    r"C:\Program Files\Nmap\nmap.exe",
    "/usr/bin/nmap",
    "/usr/local/bin/nmap",
    "/opt/homebrew/bin/nmap",
)


def _nmap_search_path() -> tuple[str, ...]:
    env = os.getenv("NMAP_PATH")
    return ((env,) if env else ()) + _DEFAULT_NMAP_PATHS


def scan_ports(ip: str, top_ports: int = 100) -> dict:
    """Blocking — call from a worker thread."""
    addr = ipaddress.ip_address(ip)  # raises ValueError on bad input (prevents arg injection)

    try:
        import nmap
    except ImportError as exc:
        raise CapabilityError("python-nmap is not installed") from exc

    try:
        nm = nmap.PortScanner(nmap_search_path=_nmap_search_path())
    except nmap.PortScannerError as exc:
        raise CapabilityError(
            "nmap binary not found; install it from https://nmap.org or set NMAP_PATH"
        ) from exc

    # -T4: faster timing, -Pn: don't skip hosts that block ping.
    # TCP connect scan (-sT) works without root; nmap uses SYN scan automatically when privileged.
    args = f"--top-ports {int(top_ports)} -T4 -Pn"
    try:
        nm.scan(hosts=str(addr), arguments=args, timeout=120)
    except nmap.PortScannerTimeout as exc:
        raise TimeoutError(f"nmap scan of {addr} timed out") from exc

    ports: list[dict] = []
    host_state = "down"
    if str(addr) in nm.all_hosts():
        host = nm[str(addr)]
        host_state = host.state()
        for proto in host.all_protocols():
            for port, info in sorted(host[proto].items()):
                ports.append(
                    {
                        "port": port,
                        "protocol": proto,
                        "state": info.get("state", "unknown"),
                        "service": info.get("name") or "unknown",
                    }
                )

    return {"ip": str(addr), "host_state": host_state, "count": len(ports), "ports": ports}
