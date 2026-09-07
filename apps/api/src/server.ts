// alpha-market API — single Hono server on one port.
//
// Phase C — the Hedera payment gates:
//   • per-call feeds (whale-radar, volume-radar, macro-news) are x402-gated (pay per query)
//   • POST /subscribe is x402-priced at the period fee -> mints an HTS pass + HCS receipt
//   • GET /feed/alpha-brief is HTS-entitlement-gated (hold a valid pass -> served free)
// Every settled payment writes a verifiable HCS receipt (fire-and-forget).

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  makeResourceServer, hederaRoute, paymentMiddleware, decodeSettlement, toAtomic,
  hederaReceipt, hederaEnabled, fulfil, checkEntitlement, scheduleRenewal, makePaidFetch,
} from "alpha402";
import { loadConfig, requireConfigured } from "./config.js";
import { whaleSwaps, volumeMomentum } from "./sources/graph.js";
import { fetchNews } from "./sources/news.js";
import { getBrief, generateBrief } from "./sources/brief.js";
import { activityFeed } from "./sources/watcher.js";
import { priceUsd } from "./sources/uniswap.js";
import { chainHistory } from "./sources/mirror.js";
import { startScheduler, getRadar } from "./scheduler.js";
import { runChat } from "./chat.js";
import { createAgent } from "./agent.js";

const cfg = loadConfig();
const g = { apiKey: cfg.graphApiKey ?? "", subgraph: "uniswap-v3" };
const app = new Hono();

const perCall = cfg.feeds.filter((f) => f.model === "per-call");
const subFeed = cfg.feeds.find((f) => f.model === "subscription")!;

// --- in-memory event log (on-chain activity for the dashboard) ---
const events: Record<string, unknown>[] = [];
const pushEvent = (e: Record<string, unknown>) => {
  events.unshift({ ...e, t: e.t ?? Date.now() });
  if (events.length > 200) events.pop();
};

// --- live data for a per-call feed (sized by the units the caller paid for) ---
async function feedData(name: string, units = 1): Promise<unknown> {
  const src = cfg.feeds.find((f) => f.name === name)!.source as any;
  const cap = (n: number) => Math.min(n, 100);
  if (name === "whale-radar") return whaleSwaps(g, Number(src.minUsd ?? 500000), cap(Number(src.limit ?? 20) * units));
  if (name === "volume-radar") return volumeMomentum(g, cap(Number(src.topN ?? 15) * units));
  if (name === "macro-news") return fetchNews(src.feeds ?? [], cap(Number(src.limit ?? 15) * units));
  throw new Error(`unknown feed ${name}`);
}

// --- per-query metering: price scales with the units the caller requests (x-alpha-units) ---
const unitsFromCtx = (ctx: any): number => {
  const h = ctx?.adapter?.getHeader?.("x-alpha-units") ?? ctx?.req?.header?.("x-alpha-units") ?? ctx?.headers?.["x-alpha-units"];
  return Math.min(Math.max(Math.floor(Number(h) || 1), 1), 20);
};
const meteredPrice = (baseHbar: number) => (ctx: any) => ({ amount: toAtomic(baseHbar * unitsFromCtx(ctx)), asset: "0.0.0" });
const reqUnits = (c: any): number => Math.min(Math.max(Math.floor(Number(c.req.header("x-alpha-units")) || 1), 1), 20);

app.onError((err, c) => c.json({ error: String(err.message ?? err) }, 500));

// ===== ungated routes (registered BEFORE the payment middleware) =====
app.get("/", (c) => c.text("alpha-market api — GET /catalog, /health, /events, /activity; paid feeds under /feed/*"));

app.get("/health", (c) => c.json({
  ok: true, service: "alpha-market", feeds: cfg.feeds.length,
  configured: cfg.missing.length === 0, missing: cfg.missing,
  hedera: hederaEnabled(), facilitator: cfg.facilitatorUrl,
}));

app.get("/catalog", (c) => c.json({
  wallet: cfg.wallet,
  feeds: cfg.feeds.map((f) => ({
    name: f.name, model: f.model, price: f.price, meter: f.meter ?? null,
    periodDays: f.periodDays ?? null, description: f.description,
    endpoint: f.model === "subscription" ? "POST /subscribe" : `GET /feed/${f.name}`,
  })),
}));

app.get("/events", (c) => c.json(events.slice(0, 50)));
app.get("/activity", (c) => c.json(activityFeed(50)));

// full on-chain history, read back from the Hedera mirror node (Etherscan-style):
// the ledger's own record of every payment/receipt/mint — survives restarts, never mocked.
app.get("/chain", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 100);
  try {
    return c.json(await chainHistory(cfg.wallet, limit));
  } catch (e) {
    return c.json({ error: String((e as Error).message ?? e) }, 502);
  }
});

// live Uniswap price (Trading API — routes across v2/v3/v4)
app.get("/price", async (c) => {
  if (!cfg.uniswapApiKey) return c.json({ error: "uniswap api not configured" }, 503);
  const symbol = (c.req.query("symbol") ?? "WETH").toUpperCase();
  const usd = await priceUsd({ apiKey: cfg.uniswapApiKey }, symbol);
  if (usd == null) return c.json({ error: `unknown token ${symbol}` }, 404);
  return c.json({ source: "uniswap", symbol, usd, t: Date.now() });
});

// operator-view snapshots for the dashboard (ungated — the seller's own control tower)
app.get("/brief", (c) => { const b = getBrief(); return b ? c.json(b) : c.json({ error: "brief_not_ready" }, 503); });
app.get("/radar", (c) => c.json(getRadar()));

// a brief focused on the question the subscriber asked at the door — leads with what answers it
app.post("/brief/ask", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const question = String(body.question ?? "").slice(0, 200).trim();
  if (!question) return c.json({ error: "missing question" }, 400);
  try {
    const r = getRadar();
    const newsSrc = (cfg.feeds.find((f) => f.name === "macro-news")?.source as any)?.feeds ?? [];
    const news = await fetchNews(newsSrc, 10).catch(() => []);
    const b = await generateBrief({ whales: r.whales, momentum: r.momentum, news, prices: r.prices }, cfg.llm, question);
    return c.json({ ...b, focus: question });
  } catch (e) {
    return c.json({ error: String((e as Error).message ?? e) }, 502);
  }
});

// chat agent — talks to the data, pays for it on the user's behalf (x402 on Hedera)
app.post("/chat", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const out = await runChat(messages, { cfg, apiBase: `http://localhost:${cfg.port}` }, body.context);
  return c.json(out);
});

// --- click-to-buy: the server-side buyer pays via x402 (dashboard "Pay" / "Subscribe") ---
const buyerFetch = cfg.client.accountId && cfg.client.key ? makePaidFetch({ accountId: cfg.client.accountId, key: cfg.client.key }) : null;

// server-side x402 buyer: pays for a per-call feed and returns the receipt + rows.
// Shared by the dashboard "Pay" button (/buy/:feed) and the autonomous agent.
async function buyFeed(feed: string, units = 1) {
  if (!buyerFetch) throw new Error("buyer not configured (set HEDERA_CLIENT_*)");
  const u = Math.max(1, Math.floor(units));
  const spec = cfg.feeds.find((f) => f.name === feed);
  const r = await buyerFetch(`http://localhost:${cfg.port}/feed/${feed}`, { headers: u > 1 ? { "x-alpha-units": String(u) } : {} });
  const body: any = await r.json().catch(() => ({}));
  let payer = "", tx: string | null = null, hashscan: string | null = null;
  const ph = r.headers.get("payment-response");
  if (ph) { try { const s = decodeSettlement(ph); payer = s.payer; tx = s.tx; hashscan = s.hashscan; } catch {} }
  const amountHbar = Number(((spec?.price ?? 0) * u).toFixed(8));
  const payment = { network: "hedera:testnet", amountHbar, payer, payTo: cfg.wallet, tx, hashscan };
  return { ok: r.status < 300, status: r.status, feed, tx, hashscan, amountHbar, payment, rows: Array.isArray(body?.data) ? body.data : [], body };
}

app.post("/buy/:feed", async (c) => {
  try {
    const out = await buyFeed(c.req.param("feed"), Number(c.req.query("units") ?? 1));
    return c.json({ ok: out.ok, status: out.status, feed: out.feed, tx: out.tx, hashscan: out.hashscan, payment: out.payment, data: out.body });
  } catch (e) {
    return c.json({ error: String((e as Error).message ?? e) }, 503);
  }
});

// --- the autonomous agent: decides + pays for feeds itself (x402 on Hedera) ---
const agent = createAgent({ cfg, buy: (feed, units) => buyFeed(feed, units) });
app.get("/agent", (c) => c.json(agent.state()));
app.post("/agent/start", (c) => c.json(agent.start()));
app.post("/agent/stop", (c) => c.json(agent.stop()));

app.post("/buy-subscription", async (c) => {
  if (!buyerFetch || !cfg.client.accountId) return c.json({ error: "buyer not configured (set HEDERA_CLIENT_*)" }, 503);
  const r = await buyerFetch(`http://localhost:${cfg.port}/subscribe?subscriber=${cfg.client.accountId}`, { method: "POST" });
  const j = await r.json().catch(() => ({}));
  return c.json({ ok: r.status < 300, status: r.status, subscriber: cfg.client.accountId, ...j });
});

// alpha-brief: entitlement-gated (NOT payment-gated). Hold a valid HTS pass -> served free.
app.get(`/feed/${subFeed.name}`, async (c) => {
  const subscriber = c.req.header("x-subscriber") ?? c.req.query("subscriber");
  if (!subscriber) return c.json({ error: "missing x-subscriber (your Hedera account 0.0.x)" }, 400);
  let ent: any = null;
  try { ent = await checkEntitlement(subscriber, subFeed.name); } catch { /* hedera not configured */ }
  if (!ent?.entitled) {
    return c.json({
      error: "subscription_required",
      subscribe: `POST /subscribe?subscriber=${subscriber}`,
      priceHbar: subFeed.price, entitlement: ent,
    }, 402);
  }
  const brief = getBrief();
  if (!brief) return c.json({ error: "brief_not_ready" }, 503);
  return c.json({ feed: subFeed.name, brief: brief.text, generatedAt: brief.generatedAt, sources: brief.sources, expiresAt: ent.expiresAt });
});

// ===== settlement receipt wrapper (outermost around the paid routes) =====
async function settlement(c: any, next: any) {
  await next();
  const header = c.res.headers.get("payment-response");
  if (!header || c.res.status >= 300) return;
  try {
    const s = decodeSettlement(header);
    pushEvent({ type: "payment", path: c.req.path, payer: s.payer, tx: s.tx, hashscan: s.hashscan });
    if (hederaEnabled()) {
      // fire-and-forget verifiable audit trail on HCS (does not block the response)
      hederaReceipt(JSON.stringify({ kind: "call", path: c.req.path, payer: s.payer, tx: s.tx, t: Date.now() }))
        .then((r) => pushEvent({ type: "hcs_receipt", ...r }))
        .catch(() => {});
    }
  } catch { /* no settlement to record */ }
}
app.use("/feed/*", settlement);
app.use("/subscribe", settlement);

// ===== the x402 payment gate =====
const x402 = makeResourceServer(cfg.facilitatorUrl);
const routes: Record<string, unknown> = {};
for (const f of perCall) routes[`GET /feed/${f.name}`] = hederaRoute(cfg.wallet, meteredPrice(f.price), f.name);
routes["POST /subscribe"] = hederaRoute(cfg.wallet, toAtomic(subFeed.price), `subscribe:${subFeed.name}`);
app.use("*", paymentMiddleware(routes as any, x402));

// ===== paid handlers (registered AFTER the payment middleware) =====
for (const f of perCall) {
  app.get(`/feed/${f.name}`, async (c) => {
    const units = reqUnits(c);
    return c.json({ feed: f.name, units, priceHbar: f.price * units, data: await feedData(f.name, units), t: Date.now() });
  });
}

app.post("/subscribe", async (c) => {
  const subscriber = c.req.header("x-subscriber") ?? c.req.query("subscriber");
  if (!subscriber) return c.json({ error: "missing subscriber (your Hedera account 0.0.x)" }, 400);
  requireConfigured(cfg, ["HEDERA_ACCOUNT_ID", "HEDERA_PRIVATE_KEY"]);
  const periodMs = Number(subFeed.periodDays ?? 30) * 86_400_000;
  const sub = await fulfil({ feed: subFeed.name, subscriber, periodMs });
  pushEvent({ type: "subscription", feed: subFeed.name, subscriber, tokenId: sub.tokenId, serial: sub.serial, expiresAt: sub.expiresAt, receipt: sub.receipt });
  // recurring renewal via Hedera Scheduled Transactions (best-effort; needs subscriber != seller)
  let renewal: Awaited<ReturnType<typeof scheduleRenewal>> | null = null;
  try {
    renewal = await scheduleRenewal({ subscriber, payTo: cfg.wallet, renewalHbar: subFeed.price, executeAt: sub.expiresAt, memo: `renew ${subFeed.name}` });
    pushEvent({ type: "scheduled_renewal", scheduleId: renewal.scheduleId, hashscan: renewal.hashscan, executeAt: renewal.executeAt });
  } catch (e) { console.warn("renewal scheduling skipped:", String(e).split("\n")[0]); }
  return c.json({ ...sub, renewal });
});

// ===== start =====
serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`▶ alpha-market api on http://localhost:${info.port}`);
  console.log(`  per-call: ${perCall.map((f) => f.name).join(", ")}  ·  subscription: ${subFeed.name}`);
  console.log(`  facilitator ${cfg.facilitatorUrl} · hedera ${hederaEnabled() ? "configured" : "NOT configured"}`);
  if (cfg.missing.length) console.warn(`⚠ missing config: ${cfg.missing.join(", ")} (paid/live routes refuse until set)`);
});

startScheduler(cfg, pushEvent);
