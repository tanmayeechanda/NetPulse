import { Link, useSearchParams } from "react-router-dom";
import DeviceTable from "../components/DeviceTable";
import PageHeader from "../components/PageHeader";
import ScanControls from "../components/ScanControls";
import TopologyGraph from "../components/TopologyGraph";
import { useBackend } from "../context/BackendContext";
import { useNetwork } from "../context/NetworkContext";
import { useTraffic } from "../context/TrafficContext";
import { findGateway } from "../utils/format";

function DetailPanel({ device, devices, packets, onSelect, loading }) {
  if (!device) {
    return (
      <aside className="detail-panel">
        <section className="section">
          <header className="section-header">
            <h2>Device details</h2>
          </header>
          <p className="muted">Select a node in the graph or a row below.</p>
        </section>
        <section className="section">
          <DeviceTable devices={devices} loading={loading} onSelect={onSelect} />
        </section>
      </aside>
    );
  }

  const isGateway = findGateway(devices)?.ip === device.ip;
  const rows = [
    ["IP address", device.ip, true],
    ["MAC address", device.mac || "—", true],
    ["Hostname", device.hostname || "unknown", false],
    ["Role", isGateway ? "Gateway / router" : "Host", false],
    ["Status", device.status, false],
    ["Packets (last 2s)", packets != null ? packets.toLocaleString() : "0", true],
  ];

  return (
    <aside className="detail-panel">
      <section className="section">
        <header className="section-header">
          <h2 className="mono accent">{device.ip}</h2>
          <button className="btn ghost small" onClick={() => onSelect(null)} aria-label="Close details">
            ✕
          </button>
        </header>
        <dl className="kv">
          {rows.map(([k, v, mono]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className={mono ? "mono" : ""}>
                {k === "Status" ? (
                  <>
                    <span className={`dot ${v === "up" ? "up" : "down"}`} /> {v}
                  </>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div className="btn-row">
          <Link className="btn primary" to={`/ports?ip=${encodeURIComponent(device.ip)}&autoscan=1`}>
            Scan ports
          </Link>
          <Link className="btn" to={`/traceroute?target=${encodeURIComponent(device.ip)}`}>
            Traceroute
          </Link>
        </div>
      </section>
      <section className="section">
        <DeviceTable devices={devices} selectedIp={device.ip} onSelect={onSelect} />
      </section>
    </aside>
  );
}

export default function Topology() {
  const { devices, loading, error } = useNetwork();
  const { online } = useBackend();
  const { ipActivity } = useTraffic();
  const [params, setParams] = useSearchParams();
  const selectedIp = params.get("ip");
  const selected = devices.find((d) => d.ip === selectedIp) || null;

  const select = (d) => setParams(d ? { ip: d.ip } : {}, { replace: true });

  return (
    <div className="page page-fill">
      <PageHeader title="Topology" subtitle="Force-directed map of devices on your LAN">
        <ScanControls />
      </PageHeader>
      {error && online && <div className="alert">{error}</div>}
      <div className="topology-layout">
        <section className="section flush topology-main">
          <TopologyGraph
            devices={devices}
            loading={loading}
            ipActivity={ipActivity}
            selectedIp={selectedIp}
            onSelect={select}
          />
        </section>
        <DetailPanel
          device={selected}
          devices={devices}
          loading={loading}
          packets={selected ? ipActivity.get(selected.ip) : null}
          onSelect={select}
        />
      </div>
    </div>
  );
}
