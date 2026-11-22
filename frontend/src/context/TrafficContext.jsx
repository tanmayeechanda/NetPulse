import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { WS_TRAFFIC_URL } from "../api";
import useWebSocket from "../hooks/useWebSocket";
import { formatTime } from "../utils/format";

const TrafficContext = createContext(null);
const MAX_POINTS = 60; // 2 minutes at one message per 2 s
export const PROTOCOLS = ["TCP", "UDP", "ICMP", "DNS", "HTTP"];

/**
 * One app-wide WebSocket to /ws/traffic. Keeps a rolling history so charts
 * don't reset when you switch pages.
 */
export function TrafficProvider({ children }) {
  const { status, lastMessage, error } = useWebSocket(WS_TRAFFIC_URL);
  const [history, setHistory] = useState([]);
  const [totals, setTotals] = useState(() => Object.fromEntries(PROTOCOLS.map((p) => [p, 0])));

  useEffect(() => {
    if (!lastMessage) return;
    const m = lastMessage;
    setHistory((h) => [
      ...h.slice(-(MAX_POINTS - 1)),
      { time: formatTime(m.timestamp), bps: m.bandwidth_bps, packets: m.total_packets, ...m.protocol_counts },
    ]);
    setTotals((t) => {
      const next = { ...t };
      for (const p of PROTOCOLS) next[p] += m.protocol_counts?.[p] ?? 0;
      return next;
    });
  }, [lastMessage]);

  // Packet counts per IP in the latest 2 s window; used to light up active nodes.
  const ipActivity = useMemo(
    () => new Map((lastMessage?.top_ips ?? []).map(({ ip, packet_count }) => [ip, packet_count])),
    [lastMessage]
  );

  const value = { status, error, latest: lastMessage, history, totals, ipActivity };
  return <TrafficContext.Provider value={value}>{children}</TrafficContext.Provider>;
}

export function useTraffic() {
  const ctx = useContext(TrafficContext);
  if (!ctx) throw new Error("useTraffic must be used inside <TrafficProvider>");
  return ctx;
}
