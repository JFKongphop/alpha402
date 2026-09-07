// Chat agent — talks to the data and PAYS for it on the user's behalf.
// OpenAI tool-calling loop over the alpha-market feeds: free reads (brief/radar/
// list) plus paid actions (pay_feed / subscribe) that settle on Hedera via x402.
// The paid tools need HEDERA_CLIENT_* (the buyer account).

import type { Config } from "./config.js";
import { getBrief } from "./sources/brief.js";
import { getRadar } from "./scheduler.js";
import { makePaidFetch, decodePaymentResponseHeader } from "alpha402";

const TOOLS = [
  { type: "function", function: { name: "get_brief", description: "Get the latest AI market-trend brief (free).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_radar", description: "Get current whale swaps, volume momentum, and live Uniswap prices (free).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_feeds", description: "List the feeds for sale and their prices.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "pay_feed", description: "Pay per query (x402 on Hedera) for a per-call feed and get fresh data. Feeds: whale-radar, volume-radar, macro-news.", parameters: { type: "object", properties: { feed: { type: "string" }, units: { type: "number" } }, required: ["feed"] } } },
  { type: "function", function: { name: "subscribe", description: "Subscribe to alpha-brief: pay the period fee -> receive an HTS pass.", parameters: { type: "object", properties: { subscriber: { type: "string" } }, required: ["subscriber"] } } },
];

export interface ChatDeps { cfg: Config; apiBase: string }
export interface ChatResult { reply: string; toolLog: string[] }

export async function runChat(messages: any[], deps: ChatDeps, context?: { feed?: string; data?: any[] }): Promise<ChatResult> {
  const { cfg, apiBase } = deps;
  if (!cfg.llm.openaiKey) throw new Error("OPENAI_API_KEY not set");
  const buyer = cfg.client.accountId && cfg.client.key
    ? makePaidFetch({ accountId: cfg.client.accountId, key: cfg.client.key })
    : null;
  const toolLog: string[] = [];

  const system = {
    role: "system",
    content:
      "You are Alpha, a market-intelligence agent for crypto traders. Answer from the free brief/radar when you can. " +
      "When the user wants fresh or specific data, PAY per query (pay_feed) or subscribe on their behalf — payments settle on Hedera and you should mention the HashScan transaction when one comes back. Be concise, cite tokens and figures.",
  };
  const convo: any[] = [system, ...messages];
  if (context?.feed && Array.isArray(context.data) && context.data.length) {
    convo.splice(1, 0, {
      role: "system",
      content: `The user is viewing a "${context.feed}" result they just purchased. Prefer answering about THIS data directly, citing figures from it. Data (JSON): ${JSON.stringify(context.data).slice(0, 6000)}`,
    });
  }

  async function exec(name: string, args: any): Promise<string> {
    toolLog.push(`${name}(${JSON.stringify(args)})`);
    if (name === "get_brief") { const b = getBrief(); return b ? JSON.stringify(b) : "brief not ready yet"; }
    if (name === "get_radar") {
      const r = getRadar();
      return JSON.stringify({
        whales: r.whales.slice(0, 10).map((s) => ({ pair: s.pair, usd: Math.round(s.amountUSD) })),
        momentum: r.momentum.slice(0, 6).map((p) => ({ pair: p.pair, momentum: Number(p.momentum.toFixed(2)) })),
        prices: r.prices,
      });
    }
    if (name === "list_feeds") return JSON.stringify(cfg.feeds.map((f) => ({ name: f.name, model: f.model, price: f.price })));
    if (name === "pay_feed") {
      if (!buyer) return "cannot pay: buyer account not configured (set HEDERA_CLIENT_ID / HEDERA_CLIENT_KEY).";
      const headers: Record<string, string> = {};
      if (args.units) headers["x-alpha-units"] = String(args.units);
      const res = await buyer(`${apiBase}/feed/${args.feed}`, { headers });
      const text = (await res.text()).slice(0, 3000);
      let tx = "";
      const ph = res.headers.get("payment-response");
      if (ph) { try { const s: any = decodePaymentResponseHeader(ph); if (s?.transaction) tx = ` [paid on Hedera, tx ${s.transaction}]`; } catch {} }
      return `HTTP ${res.status}${tx}\n${text}`;
    }
    if (name === "subscribe") {
      if (!buyer) return "cannot subscribe: buyer account not configured.";
      const res = await buyer(`${apiBase}/subscribe?subscriber=${args.subscriber}`, { method: "POST" });
      return `HTTP ${res.status}\n${(await res.text()).slice(0, 1500)}`;
    }
    return "unknown tool";
  }

  for (let i = 0; i < 5; i++) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.llm.openaiKey}` },
      body: JSON.stringify({ model: cfg.llm.openaiModel, messages: convo, tools: TOOLS, temperature: 0.3 }),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`openai ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
    const msg = j.choices?.[0]?.message;
    convo.push(msg);
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        convo.push({ role: "tool", tool_call_id: tc.id, content: await exec(tc.function.name, args) });
      }
      continue;
    }
    return { reply: msg.content ?? "", toolLog };
  }
  return { reply: "(stopped after several tool calls)", toolLog };
}
