// The AI summarizer — fuses whale + volume + news into a market-trend brief.
// Provider-agnostic: OpenAI by default, swappable to Anthropic via LLM_PROVIDER.

import type { Swap, PoolMomentum } from "./graph.js";
import type { NewsItem } from "./news.js";

export interface LlmCfg {
  provider: string;
  openaiKey?: string;
  openaiModel: string;
  anthropicKey?: string;
  anthropicModel: string;
}

/** One text-in/text-out call, provider chosen by cfg.provider. */
export async function llm(system: string, user: string, cfg: LlmCfg): Promise<string> {
  if (cfg.provider === "anthropic") {
    if (!cfg.anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: 700, system, messages: [{ role: "user", content: user }] }),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return j.content?.[0]?.text ?? "";
  }
  // default: OpenAI
  if (!cfg.openaiKey) throw new Error("OPENAI_API_KEY not set");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.openaiKey}` },
    body: JSON.stringify({
      model: cfg.openaiModel,
      temperature: 0.4,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`openai ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.choices?.[0]?.message?.content ?? "";
}

export interface BriefInputs { whales: Swap[]; momentum: PoolMomentum[]; news: NewsItem[]; prices?: Record<string, number> }
export interface Brief {
  text: string;
  generatedAt: number;
  sources: { whales: number; pools: number; news: number; prices: number };
}

const SYSTEM =
  "You are a crypto market analyst. Given on-chain whale swaps, Uniswap pool volume momentum, " +
  "live Uniswap token prices, and macro/political news, write a concise market-trend brief (5-8 sentences): " +
  "what is happening, why, and the net bias (risk-on / risk-off). Be specific — cite tokens, prices and figures. No disclaimers.";

/** Build the brief from the signals (whale + volume + live prices + news) via the LLM.
 *  `focus` (optional) is the reader's question — the brief leads with what answers it. */
export async function generateBrief(inp: BriefInputs, cfg: LlmCfg, focus?: string): Promise<Brief> {
  const user = JSON.stringify({
    whaleSwaps: inp.whales.slice(0, 15).map((s) => ({ usd: Math.round(s.amountUSD), pair: s.pair, from: s.origin })),
    volumeMomentum: inp.momentum.slice(0, 10).map((p) => ({ pair: p.pair, momentum: Number(p.momentum.toFixed(2)), volToday: Math.round(p.volumeToday) })),
    livePricesUSD: inp.prices ?? {},
    news: inp.news.slice(0, 10).map((n) => n.title),
    ...(focus ? { readerQuestion: focus } : {}),
  });
  const system = focus
    ? `${SYSTEM} The reader specifically asked: "${focus}". Open by directly addressing that question with the data above, then give the overall market bias.`
    : SYSTEM;
  const text = await llm(system, user, cfg);
  return {
    text,
    generatedAt: Date.now(),
    sources: { whales: inp.whales.length, pools: inp.momentum.length, news: inp.news.length, prices: Object.keys(inp.prices ?? {}).length },
  };
}

// In-memory cache of the latest brief — subscribers read this (AI runs on a schedule, not per request).
let latest: Brief | null = null;
export function setBrief(b: Brief): void { latest = b; }
export function getBrief(): Brief | null { return latest; }
