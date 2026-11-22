import { useNetwork } from "../context/NetworkContext";
import useElapsed from "../hooks/useElapsed";
import { formatTime } from "../utils/format";

/** Subnet/method summary + Rescan button, shared by Dashboard and Topology. */
export default function ScanControls() {
  const { meta, loading, scan, devices } = useNetwork();
  const elapsed = useElapsed(loading);
  return (
    <>
      {meta && (
        <span className="muted small">
          <span className="mono accent">{meta.subnet}</span> · {devices.length} devices · {meta.method.toUpperCase()} ·{" "}
          {formatTime(meta.timestamp)}
        </span>
      )}
      <button className="btn" onClick={() => scan()} disabled={loading}>
        {loading ? `Scanning… ${elapsed}s` : "Rescan network"}
      </button>
    </>
  );
}
