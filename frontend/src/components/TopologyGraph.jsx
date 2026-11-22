import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { findGateway } from "../utils/format";
import { SkeletonGraph } from "./Skeleton";

const RADIUS = { internet: 16, gateway: 20, hub: 14, device: 11 };

/** Star topology: Internet — gateway — every other device. */
function buildGraph(devices) {
  if (!devices.length) return { nodes: [], links: [] }; // nothing to draw until a scan returns
  const gw = findGateway(devices);
  const hubId = gw ? gw.ip : "lan";
  const nodes = [{ id: "internet", role: "internet", label: "Internet", r: RADIUS.internet }];
  const links = [];

  if (!gw) nodes.push({ id: "lan", role: "hub", label: "LAN", r: RADIUS.hub });
  links.push({ source: "internet", target: hubId, kind: "uplink" });

  for (const d of devices) {
    const isGw = gw && d.ip === gw.ip;
    const label = d.hostname ? d.hostname.split(".")[0].slice(0, 20) : isGw ? "Gateway" : d.ip;
    nodes.push({
      id: d.ip,
      ip: d.ip,
      role: isGw ? "gateway" : "device",
      label,
      sublabel: label === d.ip ? "" : d.ip,
      r: isGw ? RADIUS.gateway : RADIUS.device,
      device: d,
    });
    if (!isGw) links.push({ source: hubId, target: d.ip, kind: "lan" });
  }
  return { nodes, links };
}

function dragBehavior(sim) {
  return d3
    .drag()
    .on("start", (event, d) => {
      if (!event.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) sim.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
}

/**
 * D3 force-directed graph of discovered devices.
 * Nodes with traffic in the latest live window pulse; clicking a node calls onSelect(device).
 */
export default function TopologyGraph({ devices, selectedIp, onSelect, ipActivity, loading }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const graph = useMemo(() => buildGraph(devices), [devices]);

  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.width - width) < 1 && Math.abs(s.height - height) < 1 ? s : { width, height }));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Build the simulation whenever the device list or the container size changes.
  useEffect(() => {
    const { width, height } = size;
    if (!width || !height) return undefined;

    const svg = d3.select(svgRef.current).attr("viewBox", [0, 0, width, height]);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "node-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("stdDeviation", 4).attr("result", "blur");
    const merge = glow.append("feMerge");
    merge.append("feMergeNode").attr("in", "blur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    const root = svg.append("g");
    svg.call(
      d3
        .zoom()
        .scaleExtent([0.3, 4])
        .on("zoom", (event) => root.attr("transform", event.transform))
    );
    svg.on("click", () => onSelectRef.current?.(null));

    const nodes = graph.nodes.map((n) => ({ ...n }));
    const links = graph.links.map((l) => ({ ...l }));

    const sim = d3
      .forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance((d) => (d.kind === "uplink" ? 110 : 140)).strength(0.9))
      .force("charge", d3.forceManyBody().strength(-500))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius((d) => d.r + 28));

    const link = root
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", (d) => `topo-link ${d.kind}`);

    const node = root
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", (d) => `topo-node ${d.role}`)
      .call(dragBehavior(sim))
      .on("click", (event, d) => {
        event.stopPropagation();
        onSelectRef.current?.(d.device ?? null);
      });

    node.append("circle").attr("class", "pulse").attr("r", (d) => d.r);
    node.append("circle").attr("class", "ring").attr("r", (d) => d.r + 6);
    node.append("circle").attr("class", "core").attr("r", (d) => d.r).attr("filter", (d) => (d.role === "device" ? null : "url(#node-glow)"));
    node.filter((d) => d.role === "internet")
      .append("path")
      .attr("class", "glyph")
      .attr("d", "M-8 0h16M0-8c-4 4-4 12 0 16M0-8c4 4 4 12 0 16M0-8a8 8 0 1 0 0 16a8 8 0 1 0 0-16");
    node.append("text").attr("class", "label").attr("text-anchor", "middle").attr("dy", (d) => d.r + 17).text((d) => d.label);
    node.append("text").attr("class", "sublabel").attr("text-anchor", "middle").attr("dy", (d) => d.r + 30).text((d) => d.sublabel || "");
    node.append("title").text((d) => (d.device ? `${d.device.ip}\n${d.device.mac || ""}` : d.label));

    sim.on("tick", () => {
      link
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    return () => sim.stop();
  }, [graph, size]);

  // Selection + live activity highlighting without rebuilding the simulation.
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const active = (ip) => !!ip && (ipActivity?.has(ip) ?? false);
    svg.selectAll(".topo-node")
      .classed("selected", (d) => !!d.ip && d.ip === selectedIp)
      .classed("active", (d) => active(d.ip));
    svg.selectAll(".topo-link").classed("active", (d) => active(d.target?.ip) || (d.kind === "uplink" && (ipActivity?.size ?? 0) > 0));
  }, [selectedIp, ipActivity, graph, size]);

  return (
    <div className="topology" ref={containerRef}>
      <svg ref={svgRef} className="topology-svg" role="img" aria-label="Network topology graph" />
      {loading && !devices.length && (
        <>
          <SkeletonGraph />
          <div className="overlay-msg skeleton-caption">Discovering devices…</div>
        </>
      )}
      {!loading && !devices.length && <div className="overlay-msg muted">No devices yet. Run a scan.</div>}
      <div className="topology-legend">
        <span><i className="lg internet" />Internet</span>
        <span><i className="lg gateway" />Gateway</span>
        <span><i className="lg device" />Device</span>
        <span><i className="lg active" />Live traffic</span>
      </div>
    </div>
  );
}
