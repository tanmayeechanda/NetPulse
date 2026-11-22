import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import { NetworkProvider } from "./context/NetworkContext";
import { TrafficProvider } from "./context/TrafficContext";
import Dashboard from "./pages/Dashboard";
import PortScanPage from "./pages/PortScanPage";
import Topology from "./pages/Topology";
import TraceroutePage from "./pages/TraceroutePage";

export default function App() {
  return (
    <BrowserRouter>
      <NetworkProvider>
        <TrafficProvider>
          <div className="app">
            <Sidebar />
            <main className="main">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/topology" element={<Topology />} />
                <Route path="/traceroute" element={<TraceroutePage />} />
                <Route path="/ports" element={<PortScanPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
        </TrafficProvider>
      </NetworkProvider>
    </BrowserRouter>
  );
}
