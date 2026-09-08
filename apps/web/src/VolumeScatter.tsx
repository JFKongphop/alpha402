import { useMemo, useState } from "react";

// volume-radar → scatter: momentum (x) × 24h volume (y, log) · size = TVL ·
// colour = up/down (reinforced by x-position vs the neutral 1x line, so it never
// relies on colour alone). Inline SVG, styled to the Sprout tokens.

const INK = "#111111", ASH = "#6d6c6b", HAIR = "rgba(17,17,17,0.09)";
const GREEN = "#47d096", RED = "#e16540", WHITE = "#ffffff";

interface Pool { pair: string; tvlUSD: number; volumeToday: number; momentum: number }

const W = 1000, H = 560;
const ML = 76, MR = 150, MT = 26, MB = 52;
const PW = W - ML - MR, PH = H - MT - MB;
const XMAX = 2.5; // momentum axis cap; higher pinned to the edge + labelled

const fmtUsd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`);

export default function VolumeScatter({ data }: { data: any[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const { pts, yTicks, xTicks } = useMemo(() => {
    const pools: Pool[] = (Array.isArray(data) ? data : [])
      .filter((p) => p && p.pair && Number(p.volumeToday) > 0)
      .map((p) => ({ pair: p.pair, tvlUSD: Number(p.tvlUSD ?? 0), volumeToday: Number(p.volumeToday), momentum: Number(p.momentum ?? 0) }));

    const vols = pools.map((p) => p.volumeToday);
    const loMax = Math.ceil(Math.log10(Math.max(...vols, 10)));
    const loMin = loMax - 4; // focus the axis on the top ~4 decades where the pools live
    const yOf = (v: number) => MT + PH - ((Math.max(Math.log10(v), loMin) - loMin) / (loMax - loMin || 1)) * PH;
    const xOf = (m: number) => ML + (Math.min(m, XMAX) / XMAX) * PW;

    const tvls = pools.map((p) => Math.sqrt(Math.max(p.tvlUSD, 0)));
    const tMin = Math.min(...tvls, 0), tMax = Math.max(...tvls, 1);
    const rOf = (tvl: number) => 6 + ((Math.sqrt(Math.max(tvl, 0)) - tMin) / (tMax - tMin || 1)) * 15;

    const pts = pools.map((p) => ({ ...p, x: xOf(p.momentum), y: yOf(p.volumeToday), r: rOf(p.tvlUSD), up: p.momentum >= 1, clamped: p.momentum > XMAX }));
    // label the few most notable (top volume + top momentum), never every dot
    // selective direct labels with collision avoidance (the rest are on hover)
    const momTop = [...pts.keys()].sort((a, b) => pts[b].momentum - pts[a].momentum)[0];
    const order = momTop != null
      ? [momTop, ...[...pts.keys()].filter((i) => i !== momTop).sort((a, b) => pts[b].volumeToday - pts[a].volumeToday)]
      : [];
    const placed: { x: number; y: number }[] = [];
    for (const i of order) {
      if (placed.length >= 5) break;
      const p = pts[i];
      if (placed.some((q) => Math.abs(q.x - p.x) < 74 && Math.abs(q.y - p.y) < 18)) continue;
      (p as any).label = true;
      placed.push({ x: p.x, y: p.y });
    }

    const yTicks: { v: number; y: number }[] = [];
    for (let e = loMin; e <= loMax; e++) yTicks.push({ v: 10 ** e, y: yOf(10 ** e) });
    const xTicks = [0, 0.5, 1, 1.5, 2, 2.5].map((m) => ({ m, x: xOf(m) }));

    return { pts, yTicks, xTicks };
  }, [data]);

  if (pts.length === 0) return <div className="card" style={{ padding: 40, textAlign: "center", color: ASH }}>No pools with volume in this result.</div>;

  const x1 = xTicks.find((t) => t.m === 1)!.x; // neutral 1x line

  return (
    <div className="card" style={{ padding: 18 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} onMouseLeave={() => setHover(null)}>
        {/* y gridlines + labels (log decades) */}
        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={ML} x2={ML + PW} y1={t.y} y2={t.y} stroke={HAIR} strokeWidth={1} />
            <text x={ML - 10} y={t.y + 4} textAnchor="end" fontSize={12} fill={ASH} fontFamily="var(--mono)">{fmtUsd(t.v)}</text>
          </g>
        ))}
        {/* x ticks + labels */}
        {xTicks.map((t) => (
          <text key={t.m} x={t.x} y={MT + PH + 26} textAnchor="middle" fontSize={12} fill={ASH}>{t.m >= 2.5 ? "≥2.5×" : `${t.m}×`}</text>
        ))}
        {/* neutral 1x reference line */}
        <line x1={x1} x2={x1} y1={MT} y2={MT + PH} stroke={INK} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 4" />
        <text x={x1 + 6} y={MT + 12} fontSize={11} fill={ASH}>neutral 1×</text>
        {/* axis titles */}
        <text x={ML + PW / 2} y={H - 8} textAnchor="middle" fontSize={12.5} fill={INK} fontWeight={600}>momentum (24h vol ÷ prior)</text>
        <text transform={`translate(20 ${MT + PH / 2}) rotate(-90)`} textAnchor="middle" fontSize={12.5} fill={INK} fontWeight={600}>24h volume (log)</text>
        {/* dots */}
        {pts.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} style={{ cursor: "pointer" }}>
            <circle cx={p.x} cy={p.y} r={p.r} fill={p.up ? GREEN : RED} fillOpacity={hover === i ? 0.95 : 0.8} stroke={WHITE} strokeWidth={1.5} />
            {(p as any).label && hover !== i && (
              <text x={p.x + p.r + 5} y={p.y + 4} fontSize={11.5} fill={INK} fontWeight={600}>{p.pair}</text>
            )}
          </g>
        ))}

        {/* hover tooltip (drawn last, on top) */}
        {hover !== null && (() => {
          const p = pts[hover];
          const tw = 150, th = 62;
          const tx = Math.min(Math.max(p.x - tw / 2, ML), ML + PW - tw);
          const ty = p.y - p.r - th - 8 < MT ? p.y + p.r + 8 : p.y - p.r - th - 8;
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={tw} height={th} rx={9} fill={INK} />
              <text x={tx + 12} y={ty + 20} fontSize={13} fill={WHITE} fontWeight={700}>{p.pair}</text>
              <text x={tx + 12} y={ty + 37} fontSize={11.5} fill="rgba(255,255,255,0.75)">{p.momentum >= 999 ? "new" : `${p.momentum.toFixed(2)}×`} momentum</text>
              <text x={tx + 12} y={ty + 52} fontSize={11.5} fill="rgba(255,255,255,0.75)">{fmtUsd(p.volumeToday)} vol · {fmtUsd(p.tvlUSD)} TVL</text>
            </g>
          );
        })()}
      </svg>

      {/* legend */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "10px 8px 2px", fontSize: 12.5, color: ASH }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={{ width: 10, height: 10, borderRadius: 999, background: GREEN }} />heating up (≥1×)</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={{ width: 10, height: 10, borderRadius: 999, background: RED }} />cooling (&lt;1×)</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={{ width: 14, height: 14, borderRadius: 999, border: `2px solid ${ASH}` }} />dot size = TVL</span>
        <span>top-right = unusual (hot + high volume)</span>
      </div>
    </div>
  );
}
