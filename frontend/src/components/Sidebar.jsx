import { NavLink } from "react-router-dom";
import { API_URL } from "../api";
import { useBackend } from "../context/BackendContext";
import { useTraffic } from "../context/TrafficContext";

const NAV = [
  { to: "/", label: "Dashboard", icon: "M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z" },
  { to: "/topology", label: "Topology", icon: "M12 5v5M7 17l4-6M17 17l-4-6M12 3a2 2 0 1 0 0 .01M5 19a2 2 0 1 0 0 .01M19 19a2 2 0 1 0 0 .01" },
  { to: "/traceroute", label: "Traceroute", icon: "M3 12h4l3-7 4 14 3-7h4" },
  { to: "/ports", label: "Port Scanner", icon: "M4 6h16M4 12h16M4 18h16M8 4v4M14 10v4M10 16v4" },
];

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default function Sidebar() {
  const { status } = useBackend();
  const backendUp = status === "checking" ? null : status === "online";
  const { status: wsStatus } = useTraffic();

  return (
    <aside className="sidebar">
      <div className="logo">
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
          <path d="M3 17h6l3-8 5 15 3-9 2 2h7" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
        </svg>
        <span>
          Net<span className="accent">Pulse</span>
        </span>
      </div>

      <nav className="nav">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"} className="nav-link">
            <Icon d={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-status">
        <div className="status-row" title={API_URL}>
          <span className={`dot ${backendUp == null ? "pending" : backendUp ? "up" : "down"}`} />
          <span>API {backendUp == null ? "…" : backendUp ? "online" : "offline"}</span>
        </div>
        <div className="status-row">
          <span className={`dot ${wsStatus === "open" ? "up" : wsStatus === "connecting" ? "pending" : "down"}`} />
          <span>Live stream {wsStatus === "open" ? "connected" : wsStatus}</span>
        </div>
        <div className="mono muted small">{API_URL.replace(/^https?:\/\//, "")}</div>
      </div>
    </aside>
  );
}
