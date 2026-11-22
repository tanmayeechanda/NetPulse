import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorMessage, traceroute, traceRouteStream } from "../api";
import PageHeader from "../components/PageHeader";
import { Skeleton, SkeletonRows } from "../components/Skeleton";
import TracerouteMap from "../components/TracerouteMap";
import useElapsed from "../hooks/useElapsed";

const PRESETS = ["google.com", "cloudflare.com", "github.com", "bbc.co.uk"];
const STEPS = [
  { key: "resolving", label: "Resolve target" },
  { key: "tracing", label: "Probe hops" },
  { key: "locating", label: "Geolocate" },
  { key: "done", label: "Done" },
];
const ORDER = STEPS.map((s) => s.key);

/** Four-step progress indicator; the active step pulses. */
function TraceSteps({ phase, hopCount, maxHops, locateCount }) {
  const current = ORDER.indexOf(phase);
  const detail = {
    resolving: "Looking up the address…",
    tracing: `Probing hop ${hopCount + 1} of up to ${maxHops}`,
    locating: `Looking up ${locateCount} hop locations…`,
  };
  return (
    <ol className="trace-steps" aria-label="Traceroute progress">
      {STEPS.map((s, i) => {
        const state = i < current || phase === "done" ? "complete" : i === current ? "active" : "pending";
        return (
          <li key={s.key} className={`trace-step ${state}`}>
            <span className="trace-step-marker">{state === "complete" ? "✓" : i + 1}</span>
            <span className="trace-step-text">
              <span className="trace-step-label">{s.label}</span>
              {state === "active" && detail[s.key] && <span className="trace-step-detail">{detail[s.key]}</span>}
              {s.key === "tracing" && state === "complete" && (
                <span className="trace-step-detail">{hopCount} hops</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function TraceroutePage() {
  const [params, setParams] = useSearchParams();
  const [target, setTarget] = useState(params.get("target") || "google.com");
  const [maxHops, setMaxHops] = useState(30);
  const [phase, setPhase] = useState("idle"); // idle | resolving | tracing | locating | done | error
  const [meta, setMeta] = useState(null); // {target, destination_ip, method}
  const [hops, setHops] = useState([]);
  const [locateCount, setLocateCount] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const running = phase === "resolving" || phase === "tracing" || phase === "locating";
  const elapsed = useElapsed(running);
  const cancelRef = useRef(null);
  const autoRan = useRef(false);

  const finish = (res) => {
    setResult(res);
    setHops(res.hops);
    setMeta({ target: res.target, destination_ip: res.destination_ip, method: res.method });
    setPhase("done");
  };

  // REST fallback, used if the WebSocket can't connect (e.g. a proxy blocks it).
  const runRest = async (value, hopsLimit) => {
    setPhase("tracing");
    try {
      finish(await traceroute(value, hopsLimit));
    } catch (err) {
      setError(errorMessage(err));
      setPhase("error");
    }
  };

  const run = (t = target) => {
    const value = t.trim();
    if (!value || running) return;
    cancelRef.current?.();
    setTarget(value);
    setParams({ target: value }, { replace: true });
    setPhase("resolving");
    setMeta(null);
    setHops([]);
    setResult(null);
    setError(null);

    const hopsLimit = maxHops;
    cancelRef.current = traceRouteStream(value, hopsLimit, {
      onStart: (m) => {
        setMeta(m);
        setPhase("tracing");
      },
      onHop: (hop) => setHops((prev) => [...prev, hop]),
      onLocating: (count) => {
        setLocateCount(count);
        setPhase("locating");
      },
      onDone: finish,
      onError: (message, { connectionFailed }) => {
        if (connectionFailed) {
          runRest(value, hopsLimit);
          return;
        }
        setError(message);
        setPhase("error");
      },
    });
  };

  // Auto-run when arriving with ?target= (e.g. from the Topology detail panel); cancel on leave.
  useEffect(() => {
    const t = params.get("target");
    if (t && !autoRan.current) {
      autoRan.current = true;
      run(t);
    }
    return () => cancelRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rtts = hops.map((h) => h.rtt_ms).filter((v) => v != null);
  const maxRtt = rtts.length ? Math.max(...rtts) : 0;
  const mapMessage =
    phase === "resolving"
      ? "Resolving target…"
      : phase === "tracing"
        ? `Tracing… ${hops.length} hop${hops.length === 1 ? "" : "s"} so far`
        : phase === "locating"
          ? "Geolocating hops…"
          : null;

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
          <button className="btn primary" type="submit" disabled={running || !target.trim()}>
            {running ? `Tracing… ${elapsed}s` : "Trace route"}
          </button>
        </form>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p} type="button" className="chip mono" onClick={() => run(p)} disabled={running}>
              {p}
            </button>
          ))}
        </div>
        {phase !== "idle" && phase !== "error" && (
          <TraceSteps phase={phase} hopCount={hops.length} maxHops={maxHops} locateCount={locateCount} />
        )}
      </section>

      {error && <div className="alert">{error}</div>}

      <section className="section flush">
        <header className="section-header">
          <h2>Route map</h2>
          {meta && (
            <span className="muted small">
              <span className="mono accent">{meta.target}</span> → <span className="mono">{meta.destination_ip}</span>
              {result && (
                <>
                  {" "}· {hops.length} hops · {result.reached ? <span className="accent">reached</span> : "not reached"}
                </>
              )}{" "}
              · via {meta.method}
            </span>
          )}
        </header>
        <TracerouteMap hops={result ? hops : []} loading={running} message={mapMessage} />
      </section>

      {(running || hops.length > 0) && (
        <section className="section">
          <header className="section-header">
            <h2>Hops</h2>
            {running && <span className="muted small">Rows appear as each router answers</span>}
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
                  <tr key={h.hop_number} className={`hop-row ${h.ip ? "" : "timeout"}`}>
                    <td className="mono muted">{h.hop_number}</td>
                    <td className="mono">{h.ip || "* * *"}</td>
                    <td className="truncate">
                      {h.hostname ||
                        (phase === "locating" && h.ip ? <Skeleton width={120} height={10} /> : <span className="muted">—</span>)}
                    </td>
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
                      ) : running && h.ip ? (
                        <Skeleton width={110} height={10} />
                      ) : (
                        <span className="muted">{h.ip ? "private / unknown" : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {phase === "resolving" && <SkeletonRows rows={3} widths={[14, "60%", "50%", 70, "45%"]} />}
                {phase === "tracing" && (
                  <tr className="probing-row" aria-live="polite">
                    <td className="mono">{hops.length + 1}</td>
                    <td colSpan={4}>
                      <span className="probing">
                        Probing hop {hops.length + 1}
                        <span className="dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {phase === "done" && (
            <p className="hint">
              Locations come from ip-api.com and reflect where an IP block is registered, which is not always where the
              router physically sits.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
