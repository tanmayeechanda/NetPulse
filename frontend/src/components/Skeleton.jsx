/** Shimmering placeholder blocks shown while API data loads. */
export function Skeleton({ width = "100%", height = 12, round = false, className = "", style }) {
  return (
    <span
      className={`skeleton ${round ? "round" : ""} ${className}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}

/** Table body rows of skeleton cells. `widths` sets each column's bar width. */
export function SkeletonRows({ rows = 4, widths = ["60%", "80%", "70%", "50%"] }) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={r} className="skeleton-row" aria-hidden="true">
      {widths.map((w, c) => (
        <td key={c}>
          <Skeleton width={w} height={12} style={{ animationDelay: `${(r * widths.length + c) * 60}ms` }} />
        </td>
      ))}
    </tr>
  ));
}

/** Placeholder for a chart: a few stat blocks above a shimmering plot area. */
export function SkeletonChart({ height = 200, stats = 3 }) {
  return (
    <div className="skeleton-chart" aria-hidden="true">
      {stats > 0 && (
        <div className="skeleton-stats">
          {Array.from({ length: stats }, (_, i) => (
            <div key={i}>
              <Skeleton width={70} height={10} />
              <Skeleton width={110} height={22} style={{ marginTop: 6 }} />
            </div>
          ))}
        </div>
      )}
      <Skeleton height={height} />
    </div>
  );
}

/** Placeholder topology: a hub with a few spokes. */
export function SkeletonGraph() {
  const spokes = [
    [50, 22], [80, 40], [74, 74], [30, 78], [20, 42],
  ];
  return (
    <div className="skeleton-graph" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {spokes.map(([x, y], i) => (
          <line key={i} x1="50" y1="50" x2={x} y2={y} className="skeleton-line" />
        ))}
      </svg>
      <Skeleton round width={44} height={44} style={{ left: "50%", top: "50%" }} className="node" />
      {spokes.map(([x, y], i) => (
        <Skeleton
          key={i}
          round
          width={26}
          height={26}
          className="node"
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}
