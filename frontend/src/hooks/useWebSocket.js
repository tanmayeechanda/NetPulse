import { useEffect, useState } from "react";

/**
 * Connect to a WebSocket that sends JSON messages, reconnecting with backoff.
 * Messages of the form {type: "error", detail} are surfaced via `error`.
 *
 * @returns {{status: "connecting"|"open"|"closed", lastMessage: object|null, error: string|null}}
 */
export default function useWebSocket(url, { enabled = true, maxBackoffMs = 30_000 } = {}) {
  const [status, setStatus] = useState("connecting");
  const [lastMessage, setLastMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let ws;
    let timer;
    let disposed = false;
    let attempt = 0;

    const connect = () => {
      setStatus("connecting");
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
      };

      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type === "error") {
          setError(data.detail || "Live capture failed");
          return;
        }
        setError(null);
        setLastMessage(data);
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("closed");
        const delay = Math.min(maxBackoffMs, 1000 * 2 ** attempt);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [url, enabled, maxBackoffMs]);

  return { status, lastMessage, error };
}
