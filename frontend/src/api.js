import axios from "axios";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const WS_TRAFFIC_URL = `${API_URL.replace(/^http/, "ws")}/ws/traffic`;

const client = axios.create({ baseURL: API_URL });

export async function getHealth() {
  const { data } = await client.get("/api/health", { timeout: 4000 });
  return data;
}

/** Discover devices on the local subnet. Takes ~5–20 s. */
export async function scanNetwork(subnet) {
  const { data } = await client.get("/api/scan/network", {
    params: subnet ? { subnet } : {},
    timeout: 120_000,
  });
  return data;
}

/** Scan the top 100 TCP ports of one host. */
export async function scanPorts(ip) {
  const { data } = await client.post("/api/scan/ports", { ip }, { timeout: 180_000 });
  return data;
}

/** Trace the route to a host, with geolocation for each hop. */
export async function traceroute(target, maxHops = 30) {
  const { data } = await client.post(
    "/api/traceroute",
    { target, max_hops: maxHops },
    { timeout: 240_000 }
  );
  return data;
}

/** One-off packet capture for `duration` seconds. */
export async function getTraffic(duration = 10) {
  const { data } = await client.get("/api/traffic", {
    params: { duration },
    timeout: (duration + 20) * 1000,
  });
  return data;
}

/** Turn an axios error into a readable message (uses the backend's `detail`). */
export function errorMessage(err) {
  const detail = err?.response?.data?.detail;
  if (detail) {
    return typeof detail === "string" ? detail : detail.map((d) => d.msg).join("; ");
  }
  if (err?.code === "ECONNABORTED") return "Request timed out";
  if (!err?.response) return `Cannot reach backend at ${API_URL}. Is it running?`;
  return err.message || "Unknown error";
}
