import { useEffect, useRef, useState } from "react";
import { errorMessage, scanPorts } from "../api";
import { useNetwork } from "../context/NetworkContext";
import useElapsed from "../hooks/useElapsed";
import { ipv4Error } from "../utils/format";
import { Skeleton, SkeletonRows } from "./Skeleton";

/** IP input + scan button + color-coded results table. */
export default function PortScanner({ initialIp = "", autoScan = false }) {
  const { devices } = useNetwork();
  const [ip, setIp] = useState(initialIp);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(Boolean(initialIp));
  const elapsed = useElapsed(loading);
  const autoRan = useRef(false);
  const validation = ipv4Error(ip);
  const showValidation = touched && validation && ip.trim() !== "";

  const run = async (target = ip) => {
    const value = target.trim();
    setTouched(true);
    // Validate before any request is sent.
    if (ipv4Error(value)) {
      setIp(value);
      return;
    }
    setIp(value);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await scanPorts(value));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoScan && initialIp && !autoRan.current) {
      autoRan.current = true;
      run(initialIp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, initialIp]);

  const openCount = result?.ports.filter((p) => p.state === "open").length ?? 0;

  return (
    <div className="port-scanner">
      <section className="section">
        <form
          className="input-row"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <input
            className={`input mono ${showValidation ? "invalid" : ""} ${!validation ? "valid" : ""}`}
            value={ip}
            onChange={(e) => {
              setIp(e.target.value);
              setTouched(true);
            }}
            placeholder="192.168.1.1"
            aria-label="IP address"
            aria-invalid={Boolean(showValidation)}
            aria-describedby="ip-hint"
            spellCheck={false}
            inputMode="decimal"
          />
          <button className="btn primary" type="submit" disabled={loading || Boolean(validation)}>
            {loading ? `Scanning… ${elapsed}s` : "Scan top 100 ports"}
          </button>
        </form>
        <p id="ip-hint" className={`field-hint ${showValidation ? "error" : ""}`} aria-live="polite">
          {showValidation ? validation : "IPv4 address of a host on your network, e.g. 192.168.1.1"}
        </p>

        {devices.length > 0 && (
          <div className="chips">
            <span className="muted small">Discovered:</span>
            {devices.map((d) => (
              <button key={d.ip} type="button" className="chip mono" onClick={() => run(d.ip)} disabled={loading}>
                {d.ip}
              </button>
            ))}
          </div>
        )}
        <p className="hint">Only scan hosts you own or have permission to test.</p>
      </section>

      {error && <div className="alert">{error}</div>}

      {loading && (
        <section className="section" aria-busy="true">
          <header className="section-header">
            <h2 className="mono">{ip}</h2>
            <span className="muted small">nmap is probing the top 100 TCP ports… {elapsed}s</span>
          </header>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Port</th>
                  <th>Protocol</th>
                  <th>State</th>
                  <th>Service</th>
                </tr>
              </thead>
              <tbody>
                <SkeletonRows rows={5} widths={[40, 30, 64, "40%"]} />
              </tbody>
            </table>
          </div>
          <Skeleton width="45%" height={10} />
        </section>
      )}

      {result && (
        <section className="section">
          <header className="section-header">
            <h2 className="mono">{result.ip}</h2>
            <span className="muted">
              host <span className={result.host_state === "up" ? "accent" : ""}>{result.host_state}</span> ·{" "}
              <span className="accent mono">{openCount}</span> open of {result.count} reported
            </span>
          </header>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Port</th>
                  <th>Protocol</th>
                  <th>State</th>
                  <th>Service</th>
                </tr>
              </thead>
              <tbody>
                {result.ports.map((p) => (
                  <tr key={`${p.protocol}-${p.port}`} className={`port-row ${p.state}`}>
                    <td className="mono">{p.port}</td>
                    <td className="mono muted">{p.protocol}</td>
                    <td>
                      <span className={`state ${p.state.replace("|", "-")}`}>{p.state}</span>
                    </td>
                    <td>{p.service}</td>
                  </tr>
                ))}
                {!result.ports.length && (
                  <tr>
                    <td colSpan={4} className="empty">
                      No open ports found in the top 100
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
