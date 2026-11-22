export function formatBps(bps) {
  if (bps == null || Number.isNaN(bps)) return "—";
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let v = bps;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : v < 100 ? 1 : 0)} ${units[i]}`;
}

export function formatNumber(n) {
  return n == null ? "—" : n.toLocaleString();
}

export function formatTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString([], { hour12: false });
}

export function isValidIPv4(ip) {
  return ipv4Error(ip) === null;
}

/** Human-readable reason an IPv4 string is invalid, or null if it's valid. */
export function ipv4Error(ip) {
  const value = ip.trim();
  if (!value) return "Enter an IPv4 address";
  if (!/^[\d.]+$/.test(value)) return "Use digits and dots only, e.g. 192.168.1.1";
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((p) => p === "")) return "An IPv4 address has 4 numbers separated by dots";
  if (parts.some((p) => p.length > 3 || Number(p) > 255)) return "Each number must be between 0 and 255";
  if (parts.some((p) => p.length > 1 && p.startsWith("0"))) return "Remove leading zeros (e.g. 192.168.1.1, not 192.168.001.001)";
  return null;
}

/** Heuristic: the gateway is usually .1 (or .254) on a home LAN. */
export function findGateway(devices) {
  return devices.find((d) => d.ip.endsWith(".1")) || devices.find((d) => d.ip.endsWith(".254")) || null;
}
