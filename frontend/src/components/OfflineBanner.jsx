import { useState } from "react";
import { API_URL } from "../api";
import { useBackend } from "../context/BackendContext";

/** Full-width banner shown whenever /api/health is unreachable. */
export default function OfflineBanner() {
  const { status, recheck } = useBackend();
  const [retrying, setRetrying] = useState(false);
  if (status !== "offline") return null;

  const retry = async () => {
    setRetrying(true);
    await recheck();
    setRetrying(false);
  };

  return (
    <div className="offline-banner" role="alert">
      <span className="dot down" />
      <div className="offline-text">
        <strong>Backend offline — start with docker-compose up</strong>
        <span className="muted small">
          Can't reach <span className="mono">{API_URL}</span>. Running locally? Use <span className="mono">python run.py</span>.
          Retrying every 5s.
        </span>
      </div>
      <button className="btn small" onClick={retry} disabled={retrying}>
        {retrying ? "Checking…" : "Retry now"}
      </button>
    </div>
  );
}
