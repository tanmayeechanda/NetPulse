import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorMessage, traceroute } from "../api";
import PageHeader from "../components/PageHeader";
import TracerouteMap from "../components/TracerouteMap";
import useElapsed from "../hooks/useElapsed";

const PRESETS = ["google.com", "cloudflare.com", "github.com", "bbc.co.uk"];

export default function TraceroutePage() {
  const [params, setParams] = useSearchParams();
  const [target, setTarget] = useState(params.get("target") || "google.com");
  const [maxHops, setMaxHops] = useState(30);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const elapsed = useElapsed(loading);
  const autoRan = useRef(false);

  const run = async (t = target) => {
    const value = t.trim();
    if (!value) return;
    setTarget(value);
    setParams({ target: value }, { replace: true });
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await traceroute(value, maxHops));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Auto-run when arriving with ?target= (e.g. from the Topology detail panel).
  useEffect(() => {
    const t = params.get("target");
    if (t && !autoRan.current) {
      autoRan.current = true;
      run(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hops = result?.hops ?? [];
  const rtts = hops.map((h) => h.rtt_ms).filter((v) => v != null);
  const maxRtt = rtts.length ? Math.max(...rtts) : 0;

  return (
    <div className="page">
      <PageHeader title="Traceroute" subtitle="The path your packets take, hop by hop" />

      <section className="section">
        <form
          className="input-row"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <input
            className="input mono"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="google.com or 8.8.8.8"
            aria-label="Target host"
            spellCheck={false}
          />
          <label className="inline-field">
            <span className="muted small">Max hops</span>
            <input
              className="input mono narrow"
              type="number"
              min={1}
              max={64}
              value={maxHops}
              onChange={(e) => setMaxHops(Math.min(64, Math.max(1, Number(e.target.value) || 30)))}
            />
          </label>
          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? `Tracing… ${elapsed}s` : "Trace route"}
          </button>
        </form>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p} type="button" className="chip mono" onClick={() => run(p)} disabled={loading}>
              {p}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="alert">{error}</div>}

      <section className="section flush">
        <header className="section-header">
          <h2>Route map</h2>
          {result && (
            <span className="muted small">
              <span className="mono accent">{result.target}</span> → <span className="mono">{result.destination_ip}</span> ·{" "}
              {hops.length} hops · {result.reached ? <span className="accent">reached</span> : "not reached"} · via{" "}
              {result.method}
            </span>
          )}
        </header>
        <TracerouteMap hops={hops} loading={loading} />
      </section>

      {hops.length > 0 && (
        <section className="section">
          <header className="section-header">
            <h2>Hops</h2>
          </header>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>IP</th>
                  <th>Hostname</th>
                  <th>RTT</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {hops.map((h) => (
                  <tr key={h.hop_number} className={h.ip ? "" : "timeout"}>
                    <td className="mono muted">{h.hop_number}</td>
                    <td className="mono">{h.ip || "* * *"}</td>
                    <td className="truncate">{h.hostname || <span className="muted">—</span>}</td>
                    <td className="mono rtt-cell">
                      {h.rtt_ms != null ? (
                        <>
                          <span className="rtt-bar" style={{ width: `${maxRtt ? (h.rtt_ms / maxRtt) * 100 : 0}%` }} />
                          <span>{h.rtt_ms.toFixed(1)} ms</span>
                        </>
                      ) : (
                        <span className="muted">timeout</span>
                      )}
                    </td>
                    <td>
                      {h.geo ? (
                        [h.geo.city, h.geo.country].filter(Boolean).join(", ")
                      ) : (
                        <span className="muted">{h.ip ? "private / unknown" : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Locations come from ip-api.com and reflect where an IP block is registered, which is not always where the
            router physically sits.
          </p>
        </section>
      )}
    </div>
  );
}
