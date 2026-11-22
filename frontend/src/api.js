import axios from "axios";

// REACT_APP_API_URL comes from .env / docker-compose; VITE_API_URL is also accepted.
export const API_URL = (
  import.meta.env.REACT_APP_API_URL ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");
const WS_BASE = API_URL.replace(/^http/, "ws");
export const WS_TRAFFIC_URL = `${WS_BASE}/ws/traffic`;
export const WS_TRACEROUTE_URL = `${WS_BASE}/ws/traceroute`;

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

/**
 * Stream a traceroute hop by hop over /ws/traceroute.
 * Handlers: onStart(meta), onHop(hop), onLocating(count), onDone(result), onError(message).
 * `onError` receives `{ connectionFailed: true }` as its second argument when the socket
 * never opened, so callers can fall back to the REST endpoint.
 * @returns {() => void} call to cancel
 */
export function traceRouteStream(target, maxHops, handlers) {
  const ws = new WebSocket(WS_TRACEROUTE_URL);
  let opened = false;
  let finished = false;

  ws.onopen = () => {
    opened = true;
    ws.send(JSON.stringify({ target, max_hops: maxHops }));
  };
  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "start") handlers.onStart?.(msg);
    else if (msg.type === "hop") handlers.onHop?.(msg.hop);
    else if (msg.type === "locating") handlers.onLocating?.(msg.count);
    else if (msg.type === "done") {
      finished = true;
      handlers.onDone?.(msg.result);
    } else if (msg.type === "error") {
      finished = true;
      handlers.onError?.(msg.detail || "Traceroute failed", { connectionFailed: false });
    }
  };
  ws.onclose = () => {
    if (finished) return;
    finished = true;
    handlers.onError?.(
      opened ? "Connection to the backend was lost" : `Cannot reach backend at ${API_URL}`,
      { connectionFailed: !opened }
    );
  };

  return () => {
    finished = true;
    ws.close();
  };
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
