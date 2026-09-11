import { useEffect, useMemo, useRef, useState } from "react";
import { usePoll } from "./api";

// The front door. A Sprout-style hero: one big question box. Asking is gated —
// you subscribe to alpha-brief (an on-chain HTS pass, paid on Hedera) before you
// get in. The subscribe modal is reused from the dashboard (passed as children-less
// props via App), so the payment path is identical.

interface CatalogFeed { name: string; model: string; price: number; meter: string | null; periodDays: number | null; description: string; endpoint: string }
interface Catalog { wallet: string; feeds: CatalogFeed[] }
interface Radar { whales: any[]; prices: Record<string, number>; tracker: { watching: number } | null }
interface Tx { id: string }

const CHIPS = [
  "What are whales buying right now?",
  "Which pools are heating up?",
  "What's the macro read today?",
  "Give me today's alpha",
  "Any unusual volume?",
  "What's WETH doing?",
];

export default function Landing({ onAsk }: { onAsk: (question: string) => void }) {
  const [q, setQ] = useState("");
  const catalog = usePoll<Catalog>("/catalog", 60000);
  const radar = usePoll<Radar>("/radar", 30000);
  const chain = usePoll<Tx[]>("/chain", 30000);

  const feeds = catalog?.feeds.length ?? 4;
  const whales = radar?.tracker?.watching ?? radar?.whales?.length ?? 0;
  const prices = Object.keys(radar?.prices ?? {}).length;
  const receipts = Array.isArray(chain) ? chain.length : 0;

  const ask = (text?: string) => { const val = (text ?? q).trim(); if (val) onAsk(val); };

  // ambient colored glows, scattered randomly (fresh each load), gently drifting
  const blobs = useMemo(() => {
    const colors = ["rgba(249,115,22,0.30)", "rgba(139,111,199,0.28)", "rgba(236,72,153,0.22)", "rgba(249,115,22,0.22)", "rgba(139,111,199,0.20)"];
    return Array.from({ length: 10 }).map((_, i) => ({
      left: Math.random() * 100, top: Math.random() * 100,
      size: 260 + Math.random() * 280, color: colors[i % colors.length],
      dur: 16 + Math.random() * 14, delay: -Math.random() * 12,
    }));
  }, []);

  // the background glow trails the cursor (eased, not instant)
  const landingRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const cur = useRef({ x: 0, y: 0 });
  const onMove = (e: React.MouseEvent) => { target.current = { x: e.clientX, y: e.clientY }; };
  useEffect(() => {
    target.current = cur.current = { x: window.innerWidth * 0.8, y: window.innerHeight * 0.28 };
    let raf = 0;
    const ease = 0.045; // lower = slower/laggier trail
    const tick = () => {
      cur.current.x += (target.current.x - cur.current.x) * ease;
      cur.current.y += (target.current.y - cur.current.y) * ease;
      const el = landingRef.current;
      if (el) { el.style.setProperty("--mx", `${cur.current.x}px`); el.style.setProperty("--my", `${cur.current.y}px`); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="landing" ref={landingRef} onMouseMove={onMove}>
      <div className="l-blobs" aria-hidden="true">
        {blobs.map((b, i) => (
          <span key={i} className="blob" style={{
            left: `${b.left}%`, top: `${b.top}%`, width: b.size, height: b.size,
            background: `radial-gradient(circle, ${b.color}, transparent 70%)`,
            animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s`,
          }} />
        ))}
      </div>
      <header className="l-nav">
        <div className="brand"><span className="mk">α</span><span>alpha402</span></div>
        <span className="pill"><span className="live" />Hedera testnet</span>
      </header>

      <section className="l-hero">
        <div className="l-badge">◆ agentic market intelligence · settled on Hedera</div>

        <h1 className="l-title">
          Ask the market<br />
          <span className="grn">Alpha</span> answers on <span className="blu">Hedera</span>
        </h1>

        <p className="l-sub">
          Whale flows and volume momentum from Uniswap (via The Graph), fused with macro news by AI
          into one market read. <strong>Subscribe with an on-chain pass</strong><br />every answer settles on Hedera, with a verifiable receipt.
        </p>

        <div className="l-chatbox">
          <input
            className="l-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Ask anything about the market…"
            autoFocus
          />
          <div className="l-chatbar">
            <span className="l-model">Alpha · agentic</span>
            <button className="l-send" onClick={() => ask()} aria-label="ask" title="Ask — subscribe to unlock">▲</button>
          </div>
        </div>

        <div className="l-chips">
          {CHIPS.map((c) => (
            <button key={c} className="l-chip" onClick={() => setQ(c)}>{c}</button>
          ))}
        </div>

        <div className="l-statsbar">
          <span><b>{feeds}</b> live feeds</span>
          <span className="dot">·</span>
          <span><b>{whales}</b> whales watched</span>
          <span className="dot">·</span>
          <span><b>{receipts}</b> on-chain receipts</span>
          <span className="dot">·</span>
          <span><b>{prices}</b> live prices</span>
        </div>
      </section>
    </div>
  );
}
