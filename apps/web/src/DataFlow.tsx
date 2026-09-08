import { useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import {
  ReactFlow, Background, Controls, MarkerType, Position,
  useNodesState, useEdgesState, type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import FloatingEdge from "./floating";

const edgeTypes = { floating: FloatingEdge };

const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`);
const SEP = "@@";

function cardStyle(accent: string): CSSProperties {
  return {
    background: "#fff", border: "1px solid rgba(17,17,17,0.10)", borderLeft: `3px solid ${accent}`,
    borderRadius: 12, padding: "10px 13px", width: 168, color: "#111",
    boxShadow: "rgba(17,17,17,0.04) 0 1px 2px 0, rgba(17,17,17,0.04) 0 4px 8px 0",
  };
}
function label(title: string, sub: string, mono = false): ReactNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, fontFamily: mono ? "var(--mono)" : "var(--font)", letterSpacing: "-0.01em" }}>{title}</div>
      <div style={{ color: "#6d6c6b", fontSize: 11 }}>{sub}</div>
    </div>
  );
}

interface Swap { amountUSD: number; pair: string; origin: string }
const GAP_Y = 118;
const COL_X = 620;

function buildGraph(data: any[]): { nodes: Node[]; edges: Edge[]; empty: boolean } {
  const items: any[] = Array.isArray(data) ? data : [];
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // 1) whale-radar / watched activity → wallets ↔ pairs (bipartite)
  const swaps: Swap[] = items.filter((s) => s && s.origin && s.pair);
  if (swaps.length) {
    const walletTotal = new Map<string, number>();
    const pairTotal = new Map<string, number>();
    const edgeUsd = new Map<string, number>();
    for (const s of swaps) {
      walletTotal.set(s.origin, (walletTotal.get(s.origin) ?? 0) + s.amountUSD);
      pairTotal.set(s.pair, (pairTotal.get(s.pair) ?? 0) + s.amountUSD);
      const k = s.origin + SEP + s.pair;
      edgeUsd.set(k, (edgeUsd.get(k) ?? 0) + s.amountUSD);
    }
    const wallets = [...walletTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
    const pairs = [...pairTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => p);
    const wSet = new Set(wallets), pSet = new Set(pairs);
    const wOff = Math.max(0, (pairs.length - wallets.length) * GAP_Y) / 2;
    const pOff = Math.max(0, (wallets.length - pairs.length) * GAP_Y) / 2;
    wallets.forEach((w, i) => nodes.push({ id: "w:" + w, position: { x: 0, y: wOff + i * GAP_Y }, data: { label: label(short(w), usd(walletTotal.get(w)!), true) }, style: cardStyle("#47d096"), sourcePosition: Position.Right, targetPosition: Position.Left }));
    pairs.forEach((p, i) => nodes.push({ id: "p:" + p, position: { x: COL_X, y: pOff + i * GAP_Y }, data: { label: label(p, usd(pairTotal.get(p)!)) }, style: cardStyle("#ff007a"), sourcePosition: Position.Right, targetPosition: Position.Left }));
    for (const [k, v] of edgeUsd) {
      const [w, p] = k.split(SEP);
      if (!wSet.has(w) || !pSet.has(p)) continue;
      edges.push({ id: "e:" + k, source: "w:" + w, target: "p:" + p, animated: true, label: usd(v), style: { stroke: "#cfcecb", strokeWidth: Math.min(1.2 + v / 600000, 5) }, labelStyle: { fontSize: 10, fill: "#6d6c6b" }, labelBgStyle: { fill: "#fff", fillOpacity: 0.85 }, markerEnd: { type: MarkerType.ArrowClosed, color: "#cfcecb" } });
    }
    return { nodes, edges, empty: false };
  }

  // 2) volume-radar → token network (tokens = nodes, pools = floating edges)
  const pools = items.filter((it) => it && it.pair && String(it.pair).includes("/") && !it.origin);
  if (pools.length) {
    const agg = new Map<string, { a: string; b: string; vol: number; momW: number }>();
    for (const p of pools) {
      const [a, b] = String(p.pair).split("/");
      if (!a || !b || a === b) continue;
      const [x, y] = [a, b].sort();
      const key = x + SEP + y;
      const vol = Number(p.volumeToday ?? p.tvlUSD ?? 0);
      const cur = agg.get(key) ?? { a: x, b: y, vol: 0, momW: 0 };
      cur.vol += vol; cur.momW += Number(p.momentum ?? 0) * (vol || 1);
      agg.set(key, cur);
    }
    const tokenVol = new Map<string, number>();
    const degree = new Map<string, number>();
    for (const e of agg.values()) {
      tokenVol.set(e.a, (tokenVol.get(e.a) ?? 0) + e.vol);
      tokenVol.set(e.b, (tokenVol.get(e.b) ?? 0) + e.vol);
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    const tokens = [...degree.keys()].sort((x, y) => (degree.get(y)! - degree.get(x)!) || (tokenVol.get(y)! - tokenVol.get(x)!));
    const hub = tokens[0];
    const others = tokens.slice(1);
    const R = Math.max(260, others.length * 40);
    const cx = R + 220, cy = R + 130;
    nodes.push({ id: "t:" + hub, position: { x: cx, y: cy }, data: { label: label(hub, usd(tokenVol.get(hub) ?? 0)) }, style: cardStyle("#ff007a") });
    others.forEach((t, i) => {
      const ang = (i / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2;
      nodes.push({ id: "t:" + t, position: { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }, data: { label: label(t, usd(tokenVol.get(t) ?? 0)) }, style: cardStyle("#328efa") });
    });
    let ei = 0;
    for (const e of agg.values()) {
      const mom = e.momW / (e.vol || 1);
      const up = mom >= 1;
      const color = mom === 0 ? "#cfcecb" : up ? "#47d096" : "#e16540";
      edges.push({ id: "pe:" + (ei++), source: "t:" + e.a, target: "t:" + e.b, type: "floating", animated: up, label: mom ? `${mom.toFixed(2)}×` : usd(e.vol), style: { stroke: color, strokeWidth: Math.min(1.4 + e.vol / 8e6, 6) }, labelStyle: { fontSize: 10, color: "#6d6c6b" }, labelBgStyle: { fill: "#fff" }, markerEnd: { type: MarkerType.ArrowClosed, color } });
    }
    return { nodes, edges, empty: false };
  }

  // 3) macro-news → headline cards (grid)
  const cols = 3;
  items.slice(0, 12).forEach((it, i) => {
    const title = it.title ? String(it.title).slice(0, 44) : "item " + (i + 1);
    nodes.push({ id: "i:" + i, position: { x: (i % cols) * 320, y: Math.floor(i / cols) * 120 }, data: { label: label(title, it.published ?? "") }, style: { ...cardStyle("#fbc768"), width: 260 } });
  });
  return { nodes, edges, empty: nodes.length === 0 };
}

export default function DataFlow({ data }: { feed: string; data: any[] }) {
  const built = useMemo(() => buildGraph(data), [data]);
  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);
  useEffect(() => { setNodes(built.nodes); setEdges(built.edges); }, [built, setNodes, setEdges]);

  if (built.empty) return <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--ash)" }}>No graphable rows in this result.</div>;

  return (
    <div className="card canvas">
      <ReactFlow
        nodes={nodes} edges={edges} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        fitView nodesDraggable nodesConnectable={false} zoomOnScroll={false} panOnScroll={false} preventScrolling={false}
      >
        <Background color="#e6e5e2" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
