// The autonomous buying agent — the "wow": no human in the loop.
// On a cadence it reads the live radar (whale flow + volume momentum + macro),
// decides what it needs, and PAYS for that feed itself via x402 on Hedera — then
// narrates the call. Every payment is a real settled tx (verifiable on HashScan).
//
// The decision engine is deliberately rule-based over the live market snapshot:
// reliable on stage, and every action it takes is a genuine on-chain payment.

import type { Config } from "./config.js";
import { getRadar } from "./scheduler.js";

export interface AgentEntry {
  id: number;
  t: number;
  kind: "start" | "observe" | "decide" | "pay" | "insight" | "error";
  text: string;
  feed?: string;
  amountHbar?: number;
  hashscan?: string;
}

// injected from server.ts — it owns the x402 buyer signer
export type BuyFn = (feed: string, units?: number) => Promise<{
  ok: boolean; tx: string | null; hashscan: string | null; amountHbar: number; rows: any[];
}>;

const WHALE_TRIGGER = 500_000; // $ — a swap this big is worth confirming
const VOL_TRIGGER = 1.4;       // × — today's volume vs the prior day
const COOLDOWN_MS = 40_000;    // don't re-buy the same feed too fast
const MACRO_EVERY_MS = 90_000; // sweep macro news on a cadence
const TICK_MS = 7_000;
const MAX_LOG = 80;

const fmtUsd = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`;

export function createAgent(deps: { cfg: Config; buy: BuyFn }) {
  const { buy } = deps;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let seq = 0;
  let busy = false;
  const log: AgentEntry[] = [];
  const lastBuy: Record<string, number> = {};

  const push = (e: Omit<AgentEntry, "id" | "t">) => {
    log.unshift({ id: ++seq, t: Date.now(), ...e });
    if (log.length > MAX_LOG) log.pop();
  };
  const cool = (feed: string) => Date.now() - (lastBuy[feed] ?? 0) > COOLDOWN_MS;

  async function buyAndNarrate(feed: string, reason: string, insight: (rows: any[]) => string): Promise<void> {
    busy = true;
    lastBuy[feed] = Date.now();
    push({ kind: "decide", text: `${reason} → buying ${feed}…`, feed });
    try {
      const r = await buy(feed, 1);
      if (r.ok) {
        push({ kind: "pay", text: `paid ${r.amountHbar} ℏ on Hedera for ${feed}`, feed, amountHbar: r.amountHbar, hashscan: r.hashscan ?? undefined });
        push({ kind: "insight", text: insight(r.rows) });
      } else {
        push({ kind: "error", text: `payment for ${feed} did not settle` });
      }
    } catch (e) {
      push({ kind: "error", text: `couldn't buy ${feed}: ${String((e as Error).message ?? e).slice(0, 90)}` });
    } finally {
      busy = false;
    }
  }

  async function tick(): Promise<void> {
    if (!running || busy) return;
    const r = getRadar();
    if (!r || !r.t) { push({ kind: "observe", text: "waiting for the first market snapshot…" }); return; }

    // 1) whale flow — a big print is worth confirming with fresh whale-radar
    const whale = r.whales?.[0];
    if (whale && whale.amountUSD >= WHALE_TRIGGER && cool("whale-radar")) {
      await buyAndNarrate(
        "whale-radar",
        `Whale swap $${fmtUsd(whale.amountUSD)} on ${whale.pair}`,
        (rows) => {
          const top = rows?.[0];
          return top ? `Smart-money flow into ${top.pair} — tracking accumulation.` : "Whale activity confirmed.";
        },
      );
      return;
    }

    // 2) volume momentum — a pool heating up on volume
    const vol = (r.momentum ?? []).find((p) => Number.isFinite(p.momentum) && p.momentum < 900) ?? r.momentum?.[0];
    if (vol && vol.momentum >= VOL_TRIGGER && cool("volume-radar")) {
      await buyAndNarrate(
        "volume-radar",
        `Volume ${vol.momentum.toFixed(1)}× on ${vol.pair}`,
        () => `Volume expanding on ${vol.pair} (${vol.momentum.toFixed(1)}×) — momentum favors continuation.`,
      );
      return;
    }

    // 3) macro sweep — pull headlines on a cadence to keep the read current
    if (cool("macro-news") && Date.now() - (lastBuy["macro-news"] ?? 0) > MACRO_EVERY_MS) {
      await buyAndNarrate(
        "macro-news",
        "Scheduled macro sweep",
        (rows) => {
          const h = rows?.[0]?.title;
          return h ? `Macro: “${String(h).slice(0, 90)}” — folding into the read.` : "Macro headlines refreshed.";
        },
      );
      return;
    }

    // nothing crossed a threshold this tick
    const m = r.momentum?.[0];
    push({
      kind: "observe",
      text: m
        ? `Scanning — top momentum ${Number(m.momentum).toFixed(1)}× (${m.pair}); no whale print over $${fmtUsd(WHALE_TRIGGER)}.`
        : "Scanning the market — nothing actionable yet.",
    });
  }

  function start() {
    if (running) return { running };
    running = true;
    push({ kind: "start", text: "Agent online — watching whale flow, volume momentum, and macro. I buy what I need on Hedera, no human in the loop." });
    void tick();
    timer = setInterval(() => void tick(), TICK_MS);
    return { running };
  }
  function stop() {
    if (!running) return { running };
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    push({ kind: "observe", text: "Agent paused." });
    return { running };
  }

  return { start, stop, state: () => ({ running, log }) };
}
