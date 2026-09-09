import { useState, useRef } from "react";
import { usePoll, apiPost } from "./api";
import { fetchSpeech, sayable } from "./tts";
import FlowCanvas from "./FlowCanvas";
import DataFlow from "./DataFlow";
import VolumeScatter from "./VolumeScatter";
import MacroNews from "./MacroNews";
import TxList from "./TxList";
import Chat from "./Chat";
import AgentLive from "./AgentLive";
import Landing from "./Landing";
import AmbientGlow from "./AmbientGlow";
import { feedLabel } from "./labels";

// ---------- types ----------
interface CatalogFeed { name: string; model: string; price: number; meter: string | null; periodDays: number | null; description: string; endpoint: string }
interface Catalog { wallet: string; feeds: CatalogFeed[] }
interface Swap { amountUSD: number; timestamp: number; pair: string; origin: string; txHash?: string }
interface Pool { pair: string; tvlUSD: number; volumeToday: number; volumePrev: number; momentum: number }
interface Radar { whales: Swap[]; momentum: Pool[]; prices: Record<string, number>; tracker: { watching: number; activity: number } | null; t: number }
interface Brief { text: string; generatedAt: number; sources: { whales: number; pools: number; news: number; prices: number } }
interface Health { ok: boolean; feeds: number; configured: boolean; missing: string[]; hedera: boolean; facilitator: string }
interface Ev { type: string; t: number; hashscan?: string; payer?: string; tx?: string; subscriber?: string; serial?: number; tokenId?: string; scheduleId?: string; path?: string }
// on-chain history, read back from the Hedera mirror node (see /chain + TxList)
interface Tx { id: string; name: string; title: string; kind: string; result: string; t: number; amountHbar?: number; payer?: string; hashscan: string }

// ---------- helpers ----------
const usd = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(2)}`;
const price = (n: number) => n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;
const short = (a: string) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
const ago = (t: number) => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`; };
const etherAddr = (a: string) => `https://etherscan.io/address/${a}`;
const etherTx = (t: string) => `https://etherscan.io/tx/${t}`;

// ---------- app ----------
export default function App() {
  const [view, setView] = useState<"overview" | "flow" | "tx" | "agent">("overview");
  const [entered, setEntered] = useState(false);   // gated behind the landing subscribe
  const [gate, setGate] = useState(false);         // subscribe modal open on the landing
  const [sub, setSub] = useState<any>(null);       // the alpha-brief pass bought at the gate
  const [askedQ, setAskedQ] = useState("");        // the question asked at the door
  const [focusBrief, setFocusBrief] = useState<Brief | null>(null); // brief focused on that question
  const [briefLoading, setBriefLoading] = useState(false);          // generating the focused brief
  const [buyFeed, setBuyFeed] = useState<CatalogFeed | null>(null);
  const [dataView, setDataView] = useState<{ feed: string; data: any[] } | null>(null);
  const nav = (v: "overview" | "flow" | "tx" | "agent") => { setView(v); setDataView(null); };
  const health = usePoll<Health>("/health", 30000);
  const catalog = usePoll<Catalog>("/catalog", 60000);
  const radar = usePoll<Radar>("/radar", 20000);
  const brief = usePoll<Brief>("/brief", 20000);
  const activity = usePoll<Swap[]>("/activity", 20000);
  const chain = usePoll<Tx[]>("/chain", 12000);

  const prices = radar?.prices ?? {};
  // the persistent on-chain record (survives restarts) — same source as the Transactions tab
  const receipts = Array.isArray(chain) ? chain : [];
  const subFeed = catalog?.feeds.find((f) => f.model === "subscription") ?? null;

  // the front door: ask a question -> subscribe (HTS pass on Hedera) -> enter the dashboard
  if (!entered) return (
    <>
      <Landing onAsk={(question) => { setAskedQ(question); setGate(true); }} />
      {gate && subFeed && (
        <BuyModal
          feed={subFeed}
          onClose={() => setGate(false)}
          onViewData={() => {}}
          onSuccess={(r) => {
            setSub(r); setGate(false); setEntered(true);
            if (askedQ) {
              setBriefLoading(true);
              apiPost<Brief>("/brief/ask", { question: askedQ })
                .then((b) => { if (b && !(b as any).error) setFocusBrief(b); })
                .finally(() => setBriefLoading(false));
            }
          }}
        />
      )}
    </>
  );

  return (
    <>
    <AmbientGlow />
    <div className="wrap">
      <Header health={health} view={view} setView={nav} />

      {view === "overview" && (
        <>
          <section className="hero">
            <h1>Market intelligence, priced for machines.</h1>
            <p>
              Whale flows and volume momentum from Uniswap (via The Graph), fused with macro news by AI
              sold to agents pay-per-query and by subscription, settled on Hedera with verifiable receipts.
            </p>
            <div className="flow">
              <span className="chip"><span className="d" style={{ background: "#ff007a" }} />Uniswap</span>
              <span className="chip"><span className="d" style={{ background: "var(--blue)" }} />The Graph</span>
              <span className="chip"><span className="d" style={{ background: "var(--ink)" }} />AI brief</span>
              <span className="chip"><span className="d" style={{ background: "var(--green)" }} />Hedera x402 + HTS</span>
            </div>
          </section>

          <Stats catalog={catalog} radar={radar} activity={activity} receipts={receipts} />

          <div className="grid">
            <div className="col">
              <BriefCard brief={focusBrief ?? brief} sub={sub} askedQ={askedQ} loading={briefLoading} />
              <WhaleRadar whales={radar?.whales ?? []} />
              <VolumeMomentum pools={radar?.momentum ?? []} />
            </div>
            <div className="col">
              <Feeds catalog={catalog} onPick={setBuyFeed} />
              <Prices prices={prices} />
              <Tracker swaps={activity ?? []} watching={radar?.tracker?.watching} />
              <Receipts receipts={receipts} />
            </div>
          </div>
        </>
      )}

      {view === "flow" && (
        <>
          <section className="hero" style={{ paddingBottom: 10 }}>
            <h1 style={{ fontSize: 38 }}>{dataView ? `${feedLabel(dataView.feed)} · your data` : "The data flow."}</h1>
            <p>{dataView
              ? (dataView.feed === "volume-radar"
                ? "Every pool by momentum (x) × 24h volume (y, log) — top-right is unusual (heating up on high volume). Dot size = TVL."
                : dataView.feed === "macro-news"
                ? "The headlines you just bought."
                : "The result you just bought — wallets linked to the pairs they traded, sized by volume.")
              : "Uniswap → The Graph → AI → Hedera — the live pipeline that turns pool activity into a paid, settled signal."}</p>
            {dataView && <button className="btn" style={{ marginTop: 14 }} onClick={() => nav("overview")}>← back to overview</button>}
          </section>
          {dataView
            ? (dataView.feed === "volume-radar"
              ? <VolumeScatter data={dataView.data} />
              : dataView.feed === "macro-news"
              ? <MacroNews data={dataView.data} />
              : <DataFlow feed={dataView.feed} data={dataView.data} />)
            : <FlowCanvas />}
          <div style={{ marginTop: 16 }}>
            <Chat context={dataView} />
          </div>
        </>
      )}

      {view === "agent" && (
        <>
          <section className="hero" style={{ paddingBottom: 10 }}>
            <h1 style={{ fontSize: 38 }}>The agent trades itself.</h1>
            <p>No human in the loop, it reads whale flow, volume momentum, and macro, decides what it needs,
              and pays for that feed itself via x402 on Hedera. Every “paid” line is a real settled transaction.</p>
          </section>
          <AgentLive />
        </>
      )}

      {view === "tx" && (
        <>
          <section className="hero" style={{ paddingBottom: 10 }}>
            <h1 style={{ fontSize: 38 }}>Transactions.</h1>
            <p>Every payment and subscription, settled on Hedera click any to verify on HashScan.</p>
          </section>
          <TxList />
        </>
      )}

      <div className="footer">
        alpha402 · agentic market intelligence · Uniswap → The Graph → AI → Hedera testnet
      </div>

      {buyFeed && <BuyModal feed={buyFeed} onClose={() => setBuyFeed(null)} onViewData={(feed, data) => { setDataView({ feed, data }); setView("flow"); setBuyFeed(null); }} />}
    </div>
    </>
  );
}

function Header({ health, view, setView }: { health: Health | null; view: string; setView: (v: "overview" | "flow" | "tx" | "agent") => void }) {
  const tabs: ["overview" | "flow" | "tx" | "agent", string][] = [["overview", "Overview"], ["agent", "Agent Live"], ["tx", "Transactions"]];
  return (
    <header className="header">
      <div className="brand">
        <span className="mk">α</span>
        <span>alpha402</span>
      </div>
      <nav className="nav">
        {tabs.map(([k, l]) => (
          <button key={k} className={`navbtn${view === k ? " on" : ""}`} onClick={() => setView(k)}>{l}</button>
        ))}
      </nav>
      <div className="hgroup">
        <span className="pill"><span className={`live${health && !health.hedera ? " off" : ""}`} />Hedera testnet</span>
      </div>
    </header>
  );
}

function Stats({ catalog, radar, activity, receipts }: { catalog: Catalog | null; radar: Radar | null; activity: Swap[] | null; receipts: Tx[] }) {
  const items: [string, string, string][] = [
    ["Feeds for sale", String(catalog?.feeds.length ?? "—"), "pay-per-query + subscription"],
    ["Whales watched", String(radar?.tracker?.watching ?? activity?.length ?? "—"), "auto-discovered on-chain"],
    ["Live prices", String(Object.keys(radar?.prices ?? {}).length || "—"), "Uniswap API (v2/v3/v4)"],
    ["On-chain receipts", String(receipts.length || "—"), "verifiable on HashScan"],
  ];
  return (
    <div className="stats">
      {items.map(([label, value, sub]) => (
        <div className="stat" key={label}>
          <div className="label">{label}</div>
          <div className="value">{value}</div>
          <div className="sub">{sub}</div>
        </div>
      ))}
    </div>
  );
}

function BriefCard({ brief, sub, askedQ, loading }: { brief: Brief | null; sub?: any; askedQ?: string; loading?: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  async function listen() {
    if (speaking) { audioRef.current?.pause(); audioRef.current = null; setSpeaking(false); return; }
    if (!brief?.text) return;
    setSpeaking(true);
    const url = await fetchSpeech(sayable(brief.text));
    if (!url) { setSpeaking(false); return; }
    const a = new Audio(url); audioRef.current = a;
    const done = () => { URL.revokeObjectURL(url); audioRef.current = null; setSpeaking(false); };
    a.onended = done; a.onerror = done;
    a.play().catch(done);
  }
  return (
    <div className="brief">
      <div className="head">
        <h2>◆ AI alpha-brief</h2>
        <div className="brief-meta">
          {sub?.hashscan
            ? <a className="brief-sub" href={sub.hashscan} target="_blank" rel="noreferrer"><span className="d" />Subscribed ↗</a>
            : <span className="brief-sub"><span className="d" />Subscribed</span>}
          {brief && <span className="tag" style={{ color: "rgba(255,255,255,.5)" }}>{ago(brief.generatedAt)}</span>}
        </div>
      </div>
      <div className="desc" style={{ marginBottom: 14 }}>
        {askedQ ? <>Focused on your question — <em>“{askedQ}”</em></> : "The subscription product — whale + volume + prices + news, fused into a market read."}
      </div>
      {loading ? (
        <div className="brief-loading"><span className="spinner" />Generating your brief…</div>
      ) : brief ? (
        <>
          <div className="body">{brief.text}</div>
          <div className="meta">
            <span className="src">{brief.sources.whales} whale swaps</span>
            <span className="src">{brief.sources.pools} pools</span>
            <span className="src">{brief.sources.prices} prices</span>
            <span className="src">{brief.sources.news} headlines</span>
            <button className="brief-listen" onClick={listen}>{speaking ? "⏸ Stop" : "▶ Listen"}</button>
          </div>
        </>
      ) : (
        <div className="empty">Generating the first brief… (the scheduler runs on a cadence)</div>
      )}
    </div>
  );
}

function WhaleRadar({ whales }: { whales: Swap[] }) {
  return (
    <div className="card">
      <div className="head"><h2>🐋 Whale flow</h2><span className="badge call">Uniswap v3 · The Graph</span></div>
      <div className="desc">Large swaps over threshold — real on-chain money flow.</div>
      {whales.length === 0 && <div className="muted">Loading live swaps…</div>}
      {whales.slice(0, 8).map((s, i) => (
        <div className="row" key={i}>
          <div className="l">
            <span className="pair">{s.pair}</span>
            {s.txHash ? <a className="addr" href={etherTx(s.txHash)} target="_blank" rel="noreferrer">{short(s.origin)}</a> : <span className="addr">{short(s.origin)}</span>}
          </div>
          <span className="usd">{usd(s.amountUSD)}</span>
        </div>
      ))}
    </div>
  );
}

function VolumeMomentum({ pools }: { pools: Pool[] }) {
  return (
    <div className="card">
      <div className="head"><h2>📈 Volume momentum</h2><span className="badge soft">market structure</span></div>
      <div className="desc">Pools by today-vs-prior volume — is the market confirming the move.</div>
      {pools.length === 0 && <div className="muted">Loading pools…</div>}
      {pools.slice(0, 6).map((p, i) => (
        <div className="row" key={i}>
          <div className="l"><span className="pair">{p.pair}</span><span className="tag">TVL {usd(p.tvlUSD)}</span></div>
          <span className={`mom ${p.momentum >= 1 ? "up" : "dn"}`}>{p.momentum >= 999 ? "new" : `${p.momentum.toFixed(2)}×`}</span>
        </div>
      ))}
    </div>
  );
}

function Prices({ prices }: { prices: Record<string, number> }) {
  const entries = Object.entries(prices).filter(([sym]) => sym !== "USDT");
  return (
    <div className="card">
      <div className="head"><h2>💲 Live prices</h2><span className="badge uni">Uniswap API</span></div>
      <div className="desc">Quotes routed across v2/v3/v4.</div>
      {entries.length === 0 && <div className="muted">Loading prices…</div>}
      <div className="prices">
        {entries.map(([sym, p]) => (
          <div className="price" key={sym}><span className="sym">{sym}</span><span className="p">{price(p)}</span></div>
        ))}
      </div>
    </div>
  );
}

function Feeds({ catalog, onPick }: { catalog: Catalog | null; onPick: (f: CatalogFeed) => void }) {
  // only the pay-per-call feeds here; alpha-brief is the subscription (shown as active on the brief card)
  const perCall = (catalog?.feeds ?? []).filter((f) => f.model !== "subscription");
  return (
    <div className="card">
      <div className="head"><h2>🛒 Feeds</h2>{catalog && <span className="tag mono">payTo {short(catalog.wallet)}</span>}</div>
      {perCall.map((f) => (
        <div className="feed clickable" key={f.name} onClick={() => onPick(f)} title="Click to pay">
          <div>
            <div className="name">{feedLabel(f.name)}</div>
            <div className="d">{f.description}</div>
          </div>
          <div className="price">
            <span className="p">{f.price} ℏ</span>
          </div>
          <span className="badge call feed-tag">per-call</span>
        </div>
      ))}
      {!catalog && <div className="muted">Loading catalog…</div>}
    </div>
  );
}

function RRow({ k, v }: { k: string; v: any }) {
  return <div className="rrow"><span className="rk">{k}</span><span className="rv">{v}</span></div>;
}

function BuyModal({ feed, onClose, onViewData, onSuccess }: { feed: CatalogFeed; onClose: () => void; onViewData: (feed: string, data: any[]) => void; onSuccess?: (result?: any) => void }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "err">("idle");
  const [result, setResult] = useState<any>(null);
  const isSub = feed.model === "subscription";
  async function pay() {
    setState("loading"); setResult(null);
    const j: any = await apiPost(isSub ? "/buy-subscription" : `/buy/${feed.name}`);
    if (j?.ok) { setState("done"); setResult(j); } else { setState("err"); setResult(j); }
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{feedLabel(feed.name)}{isSub ? <span className="badge sub">subscription</span> : <span className="badge call">per-call</span>}</h2>
          <button className="x" onClick={onClose} aria-label="close">×</button>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>{feed.description}</p>
        <div className="modal-price"><span className="p">{feed.price} ℏ</span><span className="u">{isSub ? `for ${feed.periodDays} days` : "per query"}</span></div>
        {state !== "done" && (
          <button className="btn dark modal-cta" onClick={pay} disabled={state === "loading"}>
            {state === "loading" ? "paying on Hedera…" : isSub ? `Subscribe · ${feed.price} ℏ` : `Pay · ${feed.price} ℏ`}
          </button>
        )}
        {state === "err" && <div className="modal-err">Payment failed{result?.error ? `: ${result.error}` : ""}.</div>}
        {state === "done" && (
          <div className="modal-done">
            {isSub && (
              <div className="receipt">
                <div className="receipt-h"><span>subscription receipt</span><span className="paid-inline">✓ settled on Hedera</span></div>
                <RRow k="network" v="hedera:testnet" />
                <RRow k="HTS pass" v={result?.hashscan
                  ? <a className="scan" href={result.hashscan} target="_blank" rel="noreferrer">{result.tokenId} · #{result.serial} ↗</a>
                  : <span className="mono">{result?.tokenId} · #{result?.serial}</span>} />
                <RRow k="period" v={`${feed.periodDays} days`} />
                {result?.receipt && <RRow k="HCS receipt" v={<a className="scan" href={result.receipt} target="_blank" rel="noreferrer">view ↗</a>} />}
              </div>
            )}
            {!isSub && result?.payment && (
              <div className="receipt">
                <div className="receipt-h"><span>payment receipt</span><span className="paid-inline">✓ settled on Hedera</span></div>
                <RRow k="network" v={result.payment.network} />
                <RRow k="amount" v={`${result.payment.amountHbar} ℏ`} />
                <RRow k="from" v={<span className="mono">{short(result.payment.payer)}</span>} />
                <RRow k="to" v={<span className="mono">{short(result.payment.payTo)}</span>} />
                {result.payment.hashscan && <RRow k="tx" v={<a className="scan" href={result.payment.hashscan} target="_blank" rel="noreferrer">{short(result.payment.tx)} ↗</a>} />}
              </div>
            )}
            {!isSub && (() => {
              const items = result?.data?.data ?? result?.data;
              const n = Array.isArray(items) ? items.length : 0;
              const verb = feed.name === "macro-news" ? `View ${n} headlines →` : `View ${n} rows as a graph →`;
              return n > 0 ? <button className="btn dark modal-cta" onClick={() => onViewData(feed.name, items)}>{verb}</button> : null;
            })()}
            {onSuccess
              ? <button className="btn dark modal-cta" onClick={() => onSuccess(result)}>Enter alpha402 →</button>
              : <button className="btn modal-cta" onClick={onClose}>Done</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Tracker({ swaps, watching }: { swaps: Swap[]; watching?: number }) {
  return (
    <div className="card">
      <div className="head"><h2>👁 Watched wallets</h2>{watching != null && <span className="badge soft">{watching} tracked</span>}</div>
      <div className="desc">Recent swaps by wallets the tracker follows.</div>
      {swaps.length === 0 && <div className="muted">No activity yet…</div>}
      {swaps.slice(0, 6).map((s, i) => (
        <div className="row" key={i}>
          <div className="l"><span className="pair">{s.pair}</span><a className="addr" href={etherAddr(s.origin)} target="_blank" rel="noreferrer">{short(s.origin)}</a></div>
          <span className="usd">{usd(s.amountUSD)}</span>
        </div>
      ))}
    </div>
  );
}

function Receipts({ receipts }: { receipts: Tx[] }) {
  return (
    <div className="card receipts">
      <div className="head"><h2>🧾 On-chain receipts</h2><span className="badge soft">HCS · HashScan</span></div>
      <div className="desc">Read back from the Hedera mirror node — every payment / receipt, verifiable on HashScan.</div>
      {receipts.length === 0 && <div className="muted">Reading on-chain history…</div>}
      {receipts.slice(0, 5).map((e) => (
        <div className="row" key={e.id}>
          <div className="l">
            <span className="badge soft">{e.kind}</span>
            <span className="tag">{e.amountHbar ? `${e.amountHbar} ℏ · ` : ""}{ago(e.t)}</span>
          </div>
          <a className="scan" href={e.hashscan} target="_blank" rel="noreferrer">view ↗</a>
        </div>
      ))}
    </div>
  );
}
