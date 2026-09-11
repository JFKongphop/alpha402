import { useEffect, useRef, useState, type ReactNode } from "react";
import VolumeBars from "./VolumeBars";
import { feedLabel } from "./labels";

function TokenIcon({ sym }: { sym: string }) {
  const s = sym.toUpperCase();
  if (s === "USDC") return (
    <svg className="tok" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <text x="16" y="16.5" textAnchor="middle" dominantBaseline="central" fontSize="18" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">$</text>
    </svg>
  );
  if (s === "WETH" || s === "ETH") return (
    <svg className="tok" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <g fill="#fff">
        <path fillOpacity="0.6" d="M16.5 4v8.87l7.5 3.35z" />
        <path d="M16.5 4 9 16.22l7.5-3.35z" />
        <path fillOpacity="0.6" d="M16.5 21.97v6.03L24 17.62z" />
        <path d="M16.5 28v-6.03L9 17.62z" />
        <path fillOpacity="0.2" d="m16.5 20.57 7.5-4.35-7.5-3.35z" />
        <path fillOpacity="0.6" d="M9 16.22l7.5 4.35v-7.7z" />
      </g>
    </svg>
  );
  return null;
}

interface Msg { role: "user" | "assistant"; content: string; chart?: { kind: "volume-bars"; data: any[] } }

// the model replies in light markdown; render **bold** and `code` inline so they
// don't show as literal asterisks. (newlines are handled by white-space: pre-wrap)
function renderRich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
    return p;
  });
}
interface PoolQuote {
  ok: boolean; chainId: number; tokenIn: string; tokenOut: string;
  amountIn: string; amountOut: string; minReceived: string; priceImpact: number; rate: string; route: string;
}
const BASE = (import.meta as any).env?.VITE_API ?? "/api";

function greetingFor(feed?: string | null): string {
  if (feed === "whale-radar") return "You're viewing your whale-flow result — ask me which wallets moved, what's unusual, or which pool to invest in. I can pay for data on Hedera and recommend a Uniswap pool.";
  if (feed === "volume-radar") return "You're viewing your volume-momentum result — ask me which pools are heating up, or which one to invest in. I can recommend a Uniswap pool and you can invest in one click.";
  if (feed === "macro-news") return "You're viewing your macro-news result — ask me to summarise the themes, what's most market-moving, or where to invest.";
  return "Hi — I'm Alpha, your market-intelligence agent. Ask me about the market, or which pool to invest in — I'll recommend a Uniswap pool and settle on Hedera.";
}
function suggestsFor(feed?: string | null): string[] {
  if (feed === "whale-radar") return ["Which wallet moved the most?", "Which pool should I invest in?", "Anything unusual here?"];
  if (feed === "volume-radar") return ["Which pool is heating up most?", "Which pool should I invest in?", "Summarise the volume picture"];
  if (feed === "macro-news") return ["Summarise the top themes", "What's most market-moving?", "Where should I invest?"];
  return ["What's the market bias right now?", "Which pool should I invest in?", "What are whales buying?"];
}

function PRow({ k, v }: { k: string; v: ReactNode }) {
  return <div className="prow"><span className="pk">{k}</span><span className="pv">{v}</span></div>;
}

interface Wallet { configured: boolean; address?: string; eth?: string; usdc?: string; funded?: boolean; error?: string }
const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

function InvestCard({ pool }: { pool: PoolQuote }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "err">("idle");
  const [res, setRes] = useState<any>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [collapsed, setCollapsed] = useState(false); // after a swap, shrink to just the bar
  useEffect(() => { fetch(`${BASE}/wallet`).then((r) => r.json()).then(setWallet).catch(() => {}); }, []);
  const funded = wallet?.funded === true;
  const done = state === "done";
  async function invest() {
    setState("loading"); setRes(null);
    try {
      const r = await fetch(`${BASE}/invest`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: pool.tokenOut, amountUsdc: Number(pool.amountIn) }),
      });
      const j = await r.json();
      if (j.ok) { setState("done"); setRes(j); setCollapsed(true); } else { setState("err"); setRes(j); }
    } catch (e) { setState("err"); setRes({ error: String(e) }); }
  }
  return (
    <div className={`pool${collapsed ? " collapsed" : ""}`}>
      <div className="pool-head">
        <span className="pool-title">🦄 Uniswap · <TokenIcon sym={pool.tokenIn} />{pool.tokenIn} → <TokenIcon sym={pool.tokenOut} />{pool.tokenOut}</span>
        <span className="pool-head-r">
          <span className="badge soft">Unichain Sepolia</span>
          <button className="pool-toggle" onClick={() => setCollapsed((c) => !c)}>{collapsed ? "Details ▾" : "Hide ▴"}</button>
        </span>
      </div>

      <div className="pool-body" aria-hidden={collapsed}>
        <div className="pool-body-inner">
          {wallet && (
            <div className={`pool-wallet${funded ? " ok" : ""}`}>
              <span className={`dot${funded ? " on" : ""}`} />
              {!wallet.configured ? "agent wallet not configured"
                : wallet.error ? "wallet status unavailable"
                : funded ? `agent wallet funded · ${wallet.eth} ETH · ${wallet.usdc} USDC`
                : `agent wallet unfunded · fund ${shortAddr(wallet.address)}`}
            </div>
          )}
          <div className="pool-rows">
            <PRow k="You pay" v={<><TokenIcon sym={pool.tokenIn} />{pool.amountIn} {pool.tokenIn}</>} />
            <PRow k="You receive" v={<><TokenIcon sym={pool.tokenOut} />≈ {pool.amountOut} {pool.tokenOut}</>} />
            <PRow k="Rate" v={`${pool.rate} ${pool.tokenOut}/${pool.tokenIn}`} />
            <PRow k="Price impact" v={`${pool.priceImpact}%`} />
            <PRow k="Min received" v={`${pool.minReceived} ${pool.tokenOut}`} />
            <PRow k="Route" v={pool.route.length > 40 ? pool.route.slice(0, 40) + "…" : pool.route} />
          </div>
        </div>
      </div>

      {!done && (
        <button className="btn dark pool-cta" onClick={invest} disabled={state === "loading" || !funded}>
          {state === "loading" ? "Swapping on Uniswap…" : funded ? `Invest ${pool.amountIn} ${pool.tokenIn} →` : "Fund the agent wallet to invest"}
        </button>
      )}
      {state === "err" && <div className="pool-err">Swap failed{res?.error ? `: ${res.error}` : ""}.</div>}

      {/* the swap result flow, under the details */}
      {done && (
        <div className="pool-tx">
          <div className="pool-tx-head">
            <span className="ok-badge">✓ Success</span>
            <span className="pool-tx-net">Net transfers on Uniswap</span>
            {res?.explorer && <a className="scan" href={res.explorer} target="_blank" rel="noreferrer">tx ↗</a>}
          </div>
          <div className="pool-flow">
            <span className="flow-leg out"><span className="sign">−</span><TokenIcon sym={pool.tokenIn} />{pool.amountIn} {pool.tokenIn}</span>
            <span className="flow-arrow">→</span>
            <span className="flow-leg in"><span className="sign">+</span><TokenIcon sym={pool.tokenOut} />≈ {pool.amountOut} {pool.tokenOut}</span>
          </div>
          <div className="pool-tx-meta">
            block {res?.blockNumber ?? "—"}
            {res?.txHash ? ` · ${res.txHash.slice(0, 10)}…${res.txHash.slice(-6)}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Chat({ context }: { context?: { feed: string; data: any[] } | null }) {
  const feed = context?.feed ?? null;
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: greetingFor(feed) }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<string[]>([]);
  const [pool, setPool] = useState<PoolQuote | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // fresh conversation when the viewed dataset changes
  useEffect(() => { setMsgs([{ role: "assistant", content: greetingFor(feed) }]); setTools([]); setInput(""); setPool(null); }, [feed]);

  async function send(q?: string) {
    const text = (q ?? input).trim();
    if (!text || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];

    // volume-radar "summarise" → answer with a grouped bar chart (today vs previous
    // 24h volume per pool), not a wall of markdown. Read straight off the viewed data.
    const rows = (context?.data ?? []).filter((p) => p && p.pair && Number(p.volumeToday) > 0);
    // only the explicit "summarise" ask draws the chart; "which pool is heating up
    // most?" is a single-answer question → let the LLM answer it in text.
    if (feed === "volume-radar" && rows.length > 0 && /summar(i|y)|volume picture/i.test(text)) {
      const top = [...rows].sort((a, b) => Number(b.volumeToday) - Number(a.volumeToday));
      const heating = rows.filter((p) => Number(p.volumeToday) >= Number(p.volumePrev ?? 0)).length;
      const lead = top[0];
      const summary = `Volume picture across ${rows.length} pools — ${heating} heating up, ${rows.length - heating} cooling. ${lead.pair} leads today's flow. Green is the last 24h, blue the prior 24h; the ▲/▼ under each pool is its momentum.`;
      setMsgs([...next, { role: "assistant", content: summary, chart: { kind: "volume-bars", data: top } }]);
      setInput("");
      setTimeout(() => boxRef.current?.scrollTo(0, boxRef.current.scrollHeight), 60);
      return;
    }

    setMsgs(next); setInput(""); setBusy(true); setTools([]);
    try {
      const r = await fetch(`${BASE}/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(1).map((m) => ({ role: m.role, content: m.content })), // drop the UI greeting
          context: context ? { feed: context.feed, data: (context.data ?? []).slice(0, 30) } : undefined,
        }),
      });
      const j = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: j.reply ?? j.error ?? "(no reply)" }]);
      setTools(j.toolLog ?? []);
      if (j.pool && j.pool.ok) setPool(j.pool);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: "error: " + String(e) }]);
    }
    setBusy(false);
    setTimeout(() => boxRef.current?.scrollTo(0, boxRef.current.scrollHeight), 60);
  }

  return (
    <div className="card chat">
      <div className="head"><h2>💬 {feed ? `Ask about this ${feedLabel(feed)}` : "Chat with the market"}</h2><span className="badge soft">agentic · Hedera + Uniswap</span></div>
      <div className="chatbox" ref={boxRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}${m.chart ? " has-chart" : ""}`}>
            {renderRich(m.content)}
            {m.chart?.kind === "volume-bars" && <VolumeBars data={m.chart.data} />}
          </div>
        ))}
        {busy && <div className="msg assistant muted">thinking…</div>}
      </div>
      {pool && <InvestCard pool={pool} />}
      {tools.length > 0 && <div className="tools">🔧 {tools.join("  ·  ")}</div>}
      <div className="chatin">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={feed ? "e.g. which pool should I invest in?" : "e.g. where should I invest right now?"} />
        <button className="btn dark" onClick={() => send()} disabled={busy}>Send</button>
      </div>
      <div className="suggest">
        {suggestsFor(feed).map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
      </div>
    </div>
  );
}
