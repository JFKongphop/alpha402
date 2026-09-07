// The shared scheduler — one cadence drives both the wallet tracker and the AI brief.
// Runs immediately, then every refreshMinutes. The brief is cached so subscribers
// read the latest (the AI never runs per request).

import type { Config } from "./config.js";
import { whaleSwaps, volumeMomentum } from "./sources/graph.js";
import { fetchNews } from "./sources/news.js";
import { generateBrief, setBrief } from "./sources/brief.js";
import { pollTracker } from "./sources/watcher.js";
import { prices } from "./sources/uniswap.js";

type Emit = (e: Record<string, unknown>) => void;

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Latest cached market snapshot (whales + volume + prices) for the dashboard's operator view.
export interface RadarSnapshot {
  whales: Awaited<ReturnType<typeof whaleSwaps>>;
  momentum: Awaited<ReturnType<typeof volumeMomentum>>;
  prices: Record<string, number>;
  tracker: { added: number; watching: number; activity: number } | null;
  t: number;
}
let radar: RadarSnapshot = { whales: [], momentum: [], prices: {}, tracker: null, t: 0 };
export function getRadar(): RadarSnapshot { return radar; }

export function startScheduler(cfg: Config, emit: Emit = () => {}): () => void {
  const g = { apiKey: cfg.graphApiKey ?? "", subgraph: "uniswap-v3" };
  const brief = cfg.feeds.find((f) => f.name === "alpha-brief");
  const whale = cfg.feeds.find((f) => f.name === "whale-radar");
  const news = cfg.feeds.find((f) => f.name === "macro-news");
  const refreshMin = num((brief?.source as any)?.refreshMinutes, 15);
  const minUsd = num((whale?.source as any)?.minUsd, 500000);
  const newsFeeds = ((news?.source as any)?.feeds as string[]) ?? [];
  const hasLlm = !!(cfg.llm.openaiKey || cfg.llm.anthropicKey);

  async function tick(): Promise<void> {
    if (!cfg.graphApiKey) return; // nothing to do without live data
    try {
      const [whales, momentum, headlines, tracker] = await Promise.all([
        whaleSwaps(g, minUsd, 15),
        volumeMomentum(g, 10),
        fetchNews(newsFeeds, 10),
        pollTracker(g).catch(() => ({ added: 0, watching: 0, activity: 0 })),
      ]);
      emit({ type: "tracker", ...tracker });
      // live Uniswap prices for the tokens whales/pools are trading (v2/v3/v4 routing)
      const symbols = [...whales.flatMap((s) => s.pair.split("/")), ...momentum.flatMap((p) => p.pair.split("/"))];
      const priceMap = cfg.uniswapApiKey
        ? await prices({ apiKey: cfg.uniswapApiKey }, symbols).catch(() => ({}))
        : {};
      radar = { whales, momentum, prices: priceMap, tracker, t: Date.now() };
      if (hasLlm) {
        const b = await generateBrief({ whales, momentum, news: headlines, prices: priceMap }, cfg.llm);
        setBrief(b);
        emit({ type: "brief", generatedAt: b.generatedAt, sources: b.sources });
      }
    } catch (e) {
      console.error("scheduler tick error:", String(e).split("\n")[0]);
    }
  }

  void tick();
  const h = setInterval(() => void tick(), refreshMin * 60_000);
  return () => clearInterval(h);
}
