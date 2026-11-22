import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PROTOCOLS, useTraffic } from "../context/TrafficContext";
import { formatBps, formatNumber } from "../utils/format";

const CYAN = "#00D4FF";
const VIOLET = "#7C3AED";
const PROTOCOL_COLORS = { TCP: CYAN, UDP: VIOLET, ICMP: "#5EE7FF", DNS: "#A78BFA", HTTP: "#0891B2" };
const AXIS = { fill: "#6B7280", fontSize: 11, fontFamily: "JetBrains Mono, monospace" };

function BandwidthTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="muted mono">{label}</div>
      <div className="mono accent">{formatBps(p.bps)}</div>
      <div className="mono muted">{formatNumber(p.packets)} packets</div>
    </div>
  );
}

/** Live bandwidth area chart + protocol breakdown, fed by /ws/traffic. */
export default function TrafficChart() {
  const { status, error, latest, history, totals } = useTraffic();
  const totalPackets = PROTOCOLS.reduce((s, p) => s + totals[p], 0);
  const breakdown = PROTOCOLS.map((p) => ({
    name: p,
    value: totals[p],
    pct: totalPackets ? (totals[p] / totalPackets) * 100 : 0,
  }));

  return (
    <section className="section">
      <header className="section-header">
        <h2>Live Traffic</h2>
        <span className={`live-badge ${status}`}>{status === "open" ? "LIVE" : status.toUpperCase()}</span>
      </header>

      {error && <div className="alert">{error}</div>}

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Bandwidth</span>
          <span className="stat-value mono accent">{formatBps(latest?.bandwidth_bps)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Packets / 2s</span>
          <span className="stat-value mono">{formatNumber(latest?.total_packets)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Session total</span>
          <span className="stat-value mono">{formatNumber(totalPackets)}</span>
        </div>
      </div>

      <div className="chart-box">
        {history.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="bwFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CYAN} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={VIOLET} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="time" tick={AXIS} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={72} tickFormatter={formatBps} />
              <Tooltip content={<BandwidthTooltip />} cursor={{ stroke: "rgba(0,212,255,0.3)" }} />
              <Area type="monotone" dataKey="bps" stroke={CYAN} strokeWidth={2} fill="url(#bwFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-empty muted">
            {status === "open" ? "Waiting for first sample…" : "Connecting to live stream…"}
          </div>
        )}
      </div>

      <h3 className="subheading">Protocol breakdown <span className="muted">(this session)</span></h3>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={breakdown} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} vertical={false} />
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="chart-tooltip mono">
                  {payload[0].payload.name}: {formatNumber(payload[0].payload.value)} ({payload[0].payload.pct.toFixed(1)}%)
                </div>
              ) : null
            }
          />
          <Bar
            dataKey="value"
            barSize={12}
            isAnimationActive={false}
            label={{ position: "right", fill: "#9CA3AF", fontSize: 11, fontFamily: "JetBrains Mono, monospace", formatter: (v) => formatNumber(v) }}
          >
            {breakdown.map((b) => (
              <Cell key={b.name} fill={PROTOCOL_COLORS[b.name]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="hint">DNS and HTTP packets are also counted under UDP/TCP. HTTPS shows as TCP.</p>
    </section>
  );
}
