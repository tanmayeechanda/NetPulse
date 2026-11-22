import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { feature, mesh } from "topojson-client";
import world from "world-atlas/countries-110m.json";

const COUNTRIES = feature(world, world.objects.countries);
const BORDERS = mesh(world, world.objects.countries, (a, b) => a !== b);
const GRATICULE = d3.geoGraticule10();

/**
 * SVG world map of traceroute hops. Hops without geo data (private IPs,
 * timeouts) are skipped on the map but still appear in the hop table.
 */
export default function TracerouteMap({ hops = [], loading, message }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(900);
  const height = Math.round(width * 0.5);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const { path, projection } = useMemo(() => {
    const proj = d3.geoNaturalEarth1().fitSize([width, height], { type: "Sphere" });
    return { projection: proj, path: d3.geoPath(proj) };
  }, [width, height]);

  // Hops with coordinates, grouped by location so stacked labels read "4·5·6".
  const { points, segments } = useMemo(() => {
    const geoHops = hops.filter((h) => h.geo && h.geo.lat != null && h.geo.lon != null);
    const byLoc = new Map();
    for (const h of geoHops) {
      const key = `${h.geo.lat.toFixed(2)},${h.geo.lon.toFixed(2)}`;
      if (!byLoc.has(key)) byLoc.set(key, { key, geo: h.geo, xy: projection([h.geo.lon, h.geo.lat]), hops: [] });
      byLoc.get(key).hops.push(h);
    }
    // Arcs are drawn in screen space (not great circles) so a route never gets
    // split across the map edge, e.g. Asia -> US over the pole.
    const segs = [];
    for (let i = 1; i < geoHops.length; i += 1) {
      const a = geoHops[i - 1].geo;
      const b = geoHops[i].geo;
      if (a.lat === b.lat && a.lon === b.lon) continue;
      const p1 = projection([a.lon, a.lat]);
      const p2 = projection([b.lon, b.lat]);
      if (!p1 || !p2) continue;
      const [mx, my] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const [dx, dy] = [p2[0] - p1[0], p2[1] - p1[1]];
      const bend = 0.2; // control point offset relative to segment length, bowing "upward"
      const sign = dx >= 0 ? -1 : 1;
      const cx = mx + sign * dy * bend;
      const cy = my - sign * dx * bend;
      segs.push({
        id: `${geoHops[i - 1].hop_number}-${geoHops[i].hop_number}`,
        d: `M${p1[0]},${p1[1]} Q${cx},${cy} ${p2[0]},${p2[1]}`,
      });
    }
    return { points: [...byLoc.values()], segments: segs };
  }, [hops, projection]);

  const lastHop = hops.length ? hops[hops.length - 1] : null;

  return (
    <div className="map-wrap" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="world-map" role="img" aria-label="Traceroute world map">
        <path d={path({ type: "Sphere" })} className="map-sphere" />
        <path d={path(GRATICULE)} className="map-graticule" />
        <path d={path(COUNTRIES)} className="map-land" />
        <path d={path(BORDERS)} className="map-borders" />

        {segments.map((s, i) => (
          <path key={s.id} d={s.d} className="route-line" style={{ animationDelay: `${i * 0.15}s, 0s` }} />
        ))}

        {points.map((p, i) => {
          if (!p.xy) return null;
          const isDest = lastHop && p.hops.some((h) => h.hop_number === lastHop.hop_number);
          return (
            <g key={p.key} transform={`translate(${p.xy[0]},${p.xy[1]})`} className={`hop-point ${isDest ? "dest" : ""}`} style={{ animationDelay: `${i * 0.15}s` }}>
              <circle r={isDest ? 9 : 7} className="hop-halo" />
              <circle r={isDest ? 5 : 4} className="hop-dot" />
              <text y={-12} textAnchor="middle" className="hop-label">
                {p.hops.map((h) => h.hop_number).join("·")}
              </text>
              <title>
                {`Hop ${p.hops.map((h) => h.hop_number).join(", ")}: ${[p.geo.city, p.geo.country].filter(Boolean).join(", ")}\n${p.hops.map((h) => h.ip).join("\n")}`}
              </title>
            </g>
          );
        })}
      </svg>
      {loading && (
        <div className="overlay-msg map-loading">
          <span className="map-scan" aria-hidden="true" />
          <span>{message || "Tracing route…"}</span>
        </div>
      )}
      {!loading && !hops.length && <div className="overlay-msg muted">Enter a target and run a traceroute</div>}
      {!loading && hops.length > 0 && !points.length && (
        <div className="overlay-msg muted">No hops had public geolocation data</div>
      )}
    </div>
  );
}
