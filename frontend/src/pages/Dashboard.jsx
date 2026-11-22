import { useNavigate } from "react-router-dom";
import DeviceTable from "../components/DeviceTable";
import PageHeader from "../components/PageHeader";
import ScanControls from "../components/ScanControls";
import TopologyGraph from "../components/TopologyGraph";
import TrafficChart from "../components/TrafficChart";
import { useBackend } from "../context/BackendContext";
import { useNetwork } from "../context/NetworkContext";
import { useTraffic } from "../context/TrafficContext";

export default function Dashboard() {
  const { devices, loading, error } = useNetwork();
  const { online } = useBackend();
  const { ipActivity } = useTraffic();
  const navigate = useNavigate();
  const openDevice = (d) => d && navigate(`/topology?ip=${encodeURIComponent(d.ip)}`);

  return (
    <div className="page">
      <PageHeader title="Dashboard" subtitle="Your local network at a glance">
        <ScanControls />
      </PageHeader>
      {error && online && <div className="alert">{error}</div>}

      <div className="dashboard-grid">
        <section className="hero section flush">
          <header className="section-header">
            <h2>Topology</h2>
            <span className="muted small">Click a node for details · drag to rearrange · scroll to zoom</span>
          </header>
          <TopologyGraph devices={devices} loading={loading} ipActivity={ipActivity} onSelect={openDevice} />
        </section>

        <div className="dashboard-side">
          <TrafficChart />
          <section className="section">
            <header className="section-header">
              <h2>Devices</h2>
              <span className="muted small mono">{devices.length}</span>
            </header>
            <DeviceTable devices={devices} loading={loading} onSelect={openDevice} />
          </section>
        </div>
      </div>
    </div>
  );
}
