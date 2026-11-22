"""Network discovery: ARP scan of the local subnet.

Returns a list of {ip, mac, hostname, status}.

ARP scanning needs raw-socket access (root on Linux, Npcap on Windows). If that is
unavailable we fall back to a concurrent ICMP ping sweep using the system `ping`
command and read MAC addresses from the OS ARP cache.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import platform
import re
import socket
import subprocess
from concurrent.futures import ThreadPoolExecutor

from utils import CapabilityError, is_permission_error, max_scan_threads, reverse_dns_many, scan_interface

log = logging.getLogger(__name__)

MAX_HOSTS = 1024  # refuse to sweep absurdly large ranges
IS_WINDOWS = platform.system() == "Windows"


def _local_ip() -> str:
    """Primary outbound interface IP (no packets are actually sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


def detect_subnet() -> str:
    """Determine the local subnet in CIDR form.

    Priority: NETPULSE_SUBNET env var > scapy routing table for SCAN_INTERFACE (or
    scapy's default interface) > /24 around the local IP. scapy's interface is preferred
    over the OS outbound route because VPNs (e.g. WARP, WireGuard) hijack the latter.
    """
    env = os.getenv("NETPULSE_SUBNET")
    if env:
        return str(ipaddress.ip_network(env, strict=False))

    local_ip = None
    try:
        from scapy.all import conf

        iface_ip = getattr(scan_interface() or conf.iface, "ip", None)
        local_ip = iface_ip if iface_ip and iface_ip != "0.0.0.0" else _local_ip()
        for net, mask, _gw, _iface, addr, *_ in conf.route.routes:
            if addr != local_ip or net == 0 or mask in (0, 0xFFFFFFFF):
                continue
            prefix = bin(mask).count("1")
            # Only accept on-link LAN-sized subnets; anything larger gets clamped to /24 below.
            if 22 <= prefix <= 30:
                return str(ipaddress.ip_network(f"{local_ip}/{prefix}", strict=False))
    except Exception as exc:  # scapy missing/broken route table
        log.debug("scapy route lookup failed: %s", exc)

    return str(ipaddress.ip_network(f"{local_ip or _local_ip()}/24", strict=False))


def _validate(subnet: str) -> ipaddress.IPv4Network:
    net = ipaddress.ip_network(subnet, strict=False)
    if net.version != 4:
        raise ValueError("Only IPv4 subnets are supported")
    if net.num_addresses > MAX_HOSTS + 2:
        raise ValueError(f"Subnet {net} too large (max {MAX_HOSTS} hosts)")
    return net


def _arp_scan(net: ipaddress.IPv4Network, timeout: float) -> dict[str, str]:
    from scapy.all import ARP, Ether, srp

    iface = scan_interface()
    answered, _ = srp(
        Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=str(net)),
        timeout=timeout,
        retry=1,
        verbose=False,
        **({"iface": iface} if iface else {}),
    )
    return {rcv.psrc: rcv.hwsrc.lower() for _, rcv in answered}


def _ping(ip: str) -> bool:
    cmd = ["ping", "-n", "1", "-w", "800", ip] if IS_WINDOWS else ["ping", "-c", "1", "-W", "1", ip]
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3, text=True)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False
    # Windows returns 0 for "Destination host unreachable" replies, so check for a TTL.
    return r.returncode == 0 and "ttl=" in r.stdout.lower()


_MAC_RE = re.compile(r"([0-9a-f]{2}[:-]){5}[0-9a-f]{2}", re.I)
_IP_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")


def _read_arp_cache() -> dict[str, str]:
    try:
        out = subprocess.run(["arp", "-a"], capture_output=True, text=True, timeout=5).stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        out = ""
    if not out and os.path.exists("/proc/net/arp"):
        with open("/proc/net/arp") as f:
            out = f.read()
    table: dict[str, str] = {}
    for line in out.splitlines():
        ip_m, mac_m = _IP_RE.search(line), _MAC_RE.search(line)
        if ip_m and mac_m:
            mac = mac_m.group(0).lower().replace("-", ":")
            if mac not in ("ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00"):
                table[ip_m.group(1)] = mac
    return table


def _ping_sweep(net: ipaddress.IPv4Network) -> dict[str, str | None]:
    hosts = [str(h) for h in net.hosts()]
    with ThreadPoolExecutor(max_workers=max_scan_threads()) as pool:
        alive = [ip for ip, up in zip(hosts, pool.map(_ping, hosts)) if up]
    arp = _read_arp_cache()
    return {ip: arp.get(ip) for ip in alive}


def scan_network(subnet: str | None = None, timeout: float = 2.0) -> dict:
    """Discover live hosts on the subnet. Blocking — call from a worker thread."""
    net = _validate(subnet or detect_subnet())
    method = "arp"
    try:
        found: dict[str, str | None] = dict(_arp_scan(net, timeout))
    except Exception as exc:
        if not is_permission_error(exc):
            log.warning("ARP scan failed (%s); falling back to ping sweep", exc)
        else:
            log.info("ARP scan needs elevated privileges; falling back to ping sweep")
        method = "ping"
        found = _ping_sweep(net)

    # Make sure this host appears in the results.
    candidates = []
    try:
        from scapy.all import conf

        iface = scan_interface() or conf.iface
        candidates.append((getattr(iface, "ip", None), getattr(iface, "mac", None)))
    except Exception:
        pass
    try:
        candidates.append((_local_ip(), None))
    except OSError:
        pass
    for me, mac in candidates:
        if me and ipaddress.ip_address(me) in net:
            found.setdefault(me, mac.lower() if mac else None)

    hostnames = reverse_dns_many(list(found))
    devices = [
        {"ip": ip, "mac": mac, "hostname": hostnames.get(ip), "status": "up"}
        for ip, mac in sorted(found.items(), key=lambda kv: ipaddress.ip_address(kv[0]))
    ]
    if not devices and method == "ping":
        raise CapabilityError("No hosts found; ARP scan requires root/Npcap and ping sweep found nothing")
    return {"subnet": str(net), "method": method, "count": len(devices), "devices": devices}
