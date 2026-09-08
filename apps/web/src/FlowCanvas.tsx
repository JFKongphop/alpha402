import { useMemo, type CSSProperties, type ReactNode } from "react";
import { ReactFlow, Background, Controls, MarkerType, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePoll } from "./api";

interface Radar { whales: any[]; momentum: any[]; prices: Record<string, number>; tracker: { watching: number } | null }
interface Brief { sources: { whales: number; pools: number; news: number; prices: number } }
interface Health { hedera: boolean }

const card = (accent: string): CSSProperties => ({
  background: "#fff", border: "1px solid rgba(17,17,17,0.10)", borderLeft: `3px solid ${accent}`,
  borderRadius: 12, padding: "10px 13px", width: 176, color: "#111",
  boxShadow: "rgba(17,17,17,0.04) 0 1px 2px 0, rgba(17,17,17,0.04) 0 4px 8px 0",
});
const dark: CSSProperties = {
  background: "#111", color: "#fff", border: "1px solid #111", borderRadius: 12, padding: "12px 14px",
  width: 186, boxShadow: "rgba(17,17,17,0.18) 0 6px 18px 0",
};

function label(title: string, sub: string, isDark = false): ReactNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, textAlign: "left" }}>
      <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: "-0.01em" }}>{title}</div>
      <div style={{ color: isDark ? "rgba(255,255,255,0.6)" : "#6d6c6b", fontSize: 11 }}>{sub}</div>
    </div>
  );
}

export default function FlowCanvas() {
  const radar = usePoll<Radar>("/radar", 15000);
  const brief = usePoll<Brief>("/brief", 15000);
  const health = usePoll<Health>("/health", 30000);
  const signals = brief ? brief.sources.whales + brief.sources.pools + brief.sources.prices + brief.sources.news : 0;

  const nodes: Node[] = useMemo(() => ([
    { id: "uniswap", position: { x: 0, y: 70 }, data: { label: label("🦄 Uniswap", "v3 AMM + Trading API") }, style: card("#ff007a"), sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "news", position: { x: 0, y: 350 }, data: { label: label("📰 Macro news", "RSS / political") }, style: card("#fbc768"), sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "graph", position: { x: 250, y: 50 }, data: { label: label("🔵 The Graph", "Uniswap v3 subgraph") }, style: card("#328efa"), sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "uniapi", position: { x: 250, y: 210 }, data: { label: label("💲 Uniswap API", radar ? `${Object.keys(radar.prices).length} live prices` : "live prices") }, style: card("#ff007a"), sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "whale", position: { x: 510, y: 0 }, data: { label: label("🐋 whale-radar", radar ? `${radar.whales.length} swaps` : "…") }, style: card("#47d096"), sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "volume", position: { x: 510, y: 130 }, data: { label: label("📈 volume-radar", radar ? `${radar.momentum.length} pools` : "…") }, style: card("#47d096"), sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "macro", position: { x: 510, y: 350 }, data: { label: label("🗞 macro-news", "headlines") }, style: card("#fbc768"), sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "brief", position: { x: 790, y: 165 }, data: { label: label("◆ AI alpha-brief", brief ? `fused · ${signals} signals` : "generating…", true) }, style: dark, sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "x402", position: { x: 1070, y: 50 }, data: { label: label("🟣 x402 · Hedera", health?.hedera ? "blocky402 · testnet" : "settlement") }, style: card("#8b5cf6"), sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "hts", position: { x: 1070, y: 210 }, data: { label: label("🎫 HTS pass", "subscription NFT") }, style: card("#8b5cf6"), sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: "hcs", position: { x: 1330, y: 130 }, data: { label: label("🧾 HCS receipt", "verifiable on HashScan") }, style: card("#47d096"), targetPosition: Position.Left },
  ]), [radar, brief, health, signals]);

  const edge = (id: string, source: string, target: string, color = "#cfcecb"): Edge =>
    ({ id, source, target, animated: true, style: { stroke: color, strokeWidth: 1.6 }, markerEnd: { type: MarkerType.ArrowClosed, color } });

  const edges: Edge[] = [
    edge("e1", "uniswap", "graph", "#ff007a"),
    edge("e2", "graph", "whale", "#328efa"),
    edge("e3", "graph", "volume", "#328efa"),
    edge("e4", "news", "macro", "#fbc768"),
    edge("e5", "uniapi", "brief"),
    edge("e6", "whale", "brief"),
    edge("e7", "volume", "brief"),
    edge("e8", "macro", "brief"),
    edge("e9", "brief", "hts", "#8b5cf6"),
    edge("e10", "whale", "x402", "#47d096"),
    edge("e11", "x402", "hcs", "#8b5cf6"),
    edge("e12", "hts", "hcs", "#8b5cf6"),
  ];

  return (
    <div className="card canvas">
      <ReactFlow
        nodes={nodes} edges={edges} fitView
        nodesDraggable nodesConnectable={false} elementsSelectable={false}
        zoomOnScroll={false} panOnScroll={false} preventScrolling={false}
      >
        <Background color="#e6e5e2" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
