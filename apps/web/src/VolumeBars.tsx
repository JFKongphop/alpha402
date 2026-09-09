import { useMemo, useState } from "react";

// volume-radar summary → grouped ("double") bar chart: today's 24h volume vs the
// previous 24h, per top pool. Two series on one linear axis, so "heating up" reads
// as the green bar overtaking the blue one. Inline SVG, Sprout tokens. Green fails
// contrast vs the surface (validator WARN), so every bar carries a direct value
// label — that's the required relief, and it makes the pairwise gap legible too.

const INK = "#111111", ASH = "#6d6c6b", HAIR = "rgba(17,17,17,0.09)";
const TODAY = "#47d096", PREV = "#328efa", WHITE = "#ffffff";

interface Pool { pair: string; volumeToday: number; volumePrev: number; momentum: number }

const W = 720, H = 360;
const ML = 66, MR = 18, MT = 30, MB = 58;
const PW = W - ML - MR, PH = H - MT - MB;
const TOP_N = 6;

const fmtUsd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${Math.round(n)}`;

// top-rounded bar anchored to the baseline (square bottom, 4px rounded data-end)
function barPath(x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

// a "nice" axis ceiling above the largest value
function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= v)! * mag;
  return step;
}

export default function VolumeBars({ data }: { data: any[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const { pools, groups, yTicks } = useMemo(() => {
    const pools: Pool[] = (Array.isArray(data) ? data : [])
      .filter((p) => p && p.pair && Number(p.volumeToday) > 0)
      .map((p) => ({ pair: String(p.pair), volumeToday: Number(p.volumeToday), volumePrev: Number(p.volumePrev ?? 0), momentum: Number(p.momentum ?? 0) }))
      .sort((a, b) => b.volumeToday - a.volumeToday)
      .slice(0, TOP_N);

    const max = niceMax(Math.max(1, ...pools.flatMap((p) => [p.volumeToday, p.volumePrev])));
    const yOf = (v: number) => MT + PH - (Math.max(0, v) / max) * PH;

    const gw = PW / (pools.length || 1);
    const pad = gw * 0.18;            // outer padding within a group slot
    const gap = 2;                    // 2px surface gap between the paired bars
    const bw = (gw - pad * 2 - gap) / 2;

    const groups = pools.map((p, i) => {
      const gx = ML + i * gw + pad;
      return {
        ...p, i,
        cx: ML + i * gw + gw / 2,
        today: { x: gx, y: yOf(p.volumeToday), h: MT + PH - yOf(p.volumeToday), w: bw },
        prev: { x: gx + bw + gap, y: yOf(p.volumePrev), h: MT + PH - yOf(p.volumePrev), w: bw },
      };
    });

    const yTicks: { v: number; y: number }[] = [];
    for (let k = 0; k <= 4; k++) { const v = (max / 4) * k; yTicks.push({ v, y: yOf(v) }); }
    return { pools, groups, yTicks };
  }, [data]);

  if (pools.length === 0) return <div className="card" style={{ padding: 28, textAlign: "center", color: ASH }}>No pools with volume in this result.</div>;

  return (
    <div className="volbars">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} onMouseLeave={() => setHover(null)}>
        {/* y gridlines + labels */}
        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={ML} x2={ML + PW} y1={t.y} y2={t.y} stroke={HAIR} strokeWidth={1} />
            <text x={ML - 10} y={t.y + 4} textAnchor="end" fontSize={11} fill={ASH} fontFamily="var(--mono)">{fmtUsd(t.v)}</text>
          </g>
        ))}
        {/* baseline */}
        <line x1={ML} x2={ML + PW} y1={MT + PH} y2={MT + PH} stroke={INK} strokeOpacity={0.25} strokeWidth={1.5} />
        <text transform={`translate(18 ${MT + PH / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill={INK} fontWeight={600}>24h volume</text>

        {groups.map((g) => {
          const dim = hover !== null && hover !== g.i ? 0.35 : 1;
          const heating = g.volumeToday >= g.volumePrev;
          return (
            <g key={g.i} opacity={dim} onMouseEnter={() => setHover(g.i)} style={{ cursor: "pointer" }}>
              {/* wide invisible hit target over the whole group slot */}
              <rect x={g.cx - PW / groups.length / 2} y={MT} width={PW / groups.length} height={PH} fill="transparent" />
              <path d={barPath(g.today.x, g.today.y, g.today.w, g.today.h, 4)} fill={TODAY} />
              <path d={barPath(g.prev.x, g.prev.y, g.prev.w, g.prev.h, 4)} fill={PREV} />
              {/* direct value labels — required relief for the green + shows the gap */}
              <text x={g.today.x + g.today.w / 2} y={g.today.y - 5} textAnchor="middle" fontSize={9.5} fill={INK} fontFamily="var(--mono)">{fmtUsd(g.volumeToday)}</text>
              <text x={g.prev.x + g.prev.w / 2} y={g.prev.y - 5} textAnchor="middle" fontSize={9.5} fill={ASH} fontFamily="var(--mono)">{fmtUsd(g.volumePrev)}</text>
              {/* pair label + heating arrow */}
              <text x={g.cx} y={MT + PH + 18} textAnchor="middle" fontSize={11} fill={INK} fontWeight={600}>{g.pair}</text>
              <text x={g.cx} y={MT + PH + 33} textAnchor="middle" fontSize={10} fill={heating ? TODAY : ASH} fontFamily="var(--mono)">
                {g.momentum >= 999 ? "new" : `${heating ? "▲" : "▼"} ${g.momentum.toFixed(2)}×`}
              </text>
            </g>
          );
        })}

        {/* hover tooltip (on top) */}
        {hover !== null && (() => {
          const g = groups[hover]; if (!g) return null;
          const tw = 158, th = 66;
          const tx = Math.min(Math.max(g.cx - tw / 2, ML), ML + PW - tw);
          const ty = Math.max(MT + 2, Math.min(g.today.y, g.prev.y) - th - 8);
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={tw} height={th} rx={9} fill={INK} />
              <text x={tx + 12} y={ty + 19} fontSize={13} fill={WHITE} fontWeight={700}>{g.pair}</text>
              <text x={tx + 12} y={ty + 36} fontSize={11.5} fill="rgba(255,255,255,0.82)"><tspan fill={TODAY}>●</tspan> {fmtUsd(g.volumeToday)} today</text>
              <text x={tx + 12} y={ty + 52} fontSize={11.5} fill="rgba(255,255,255,0.82)"><tspan fill={PREV}>●</tspan> {fmtUsd(g.volumePrev)} prev · {g.momentum >= 999 ? "new" : `${g.momentum.toFixed(2)}×`}</text>
            </g>
          );
        })()}
      </svg>

      {/* legend (≥2 series → always present) */}
      <div className="volbars-legend">
        <span><span className="sw" style={{ background: TODAY }} />Today (24h)</span>
        <span><span className="sw" style={{ background: PREV }} />Previous 24h</span>
        <span className="muted">▲ heating up · ▼ cooling · sorted by today's volume</span>
      </div>
    </div>
  );
}
