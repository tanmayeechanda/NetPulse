import { findGateway } from "../utils/format";
import { SkeletonRows } from "./Skeleton";

/** Table of discovered devices. Rows are clickable when `onSelect` is given. */
export default function DeviceTable({ devices, loading, selectedIp, onSelect }) {
  const gateway = findGateway(devices);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th aria-label="Status" />
            <th>IP Address</th>
            <th>MAC</th>
            <th>Hostname</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr
              key={d.ip}
              className={`${onSelect ? "clickable" : ""} ${d.ip === selectedIp ? "selected" : ""}`}
              onClick={onSelect ? () => onSelect(d) : undefined}
            >
              <td>
                <span className={`dot ${d.status === "up" ? "up" : "down"}`} title={d.status} />
              </td>
              <td className="mono">
                {d.ip}
                {gateway?.ip === d.ip && <span className="tag violet">gateway</span>}
              </td>
              <td className="mono muted">{d.mac || "—"}</td>
              <td>{d.hostname || <span className="muted">unknown</span>}</td>
            </tr>
          ))}
          {!devices.length && loading && <SkeletonRows rows={4} widths={[8, "70%", "80%", "55%"]} />}
          {!devices.length && !loading && (
            <tr>
              <td colSpan={4} className="empty">
                No devices discovered yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
