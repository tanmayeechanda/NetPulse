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
  const parts = ip.trim().split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Heuristic: the gateway is usually .1 (or .254) on a home LAN. */
export function findGateway(devices) {
  return devices.find((d) => d.ip.endsWith(".1")) || devices.find((d) => d.ip.endsWith(".254")) || null;
}
