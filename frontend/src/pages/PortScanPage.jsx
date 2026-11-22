import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import PortScanner from "../components/PortScanner";

export default function PortScanPage() {
  const [params] = useSearchParams();
  const ip = params.get("ip") || "";
  return (
    <div className="page">
      <PageHeader title="Port Scanner" subtitle="Check the 100 most common TCP ports on a host (nmap)" />
      <PortScanner key={ip} initialIp={ip} autoScan={params.get("autoscan") === "1"} />
    </div>
  );
}
