// The wallet tracker — borrows the crypto-wallet-tracker *pattern* (watchlist ->
// watch loop -> activity feed) but keeps The Graph as the data source (not RPC/Mongo).
// Reuses the shared scheduler; watchlist is a JSON file, feed is in-memory.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { whaleSwaps, watchedActivity, type Swap, type GraphCfg } from "./graph.js";

// apps/api/src/sources -> repo root is up four
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const WATCHLIST = resolve(ROOT, "watchlist.json");

interface Watchlist { addresses: string[]; autoAdd: boolean; autoAddMinUsd: number }

function loadWatchlist(): Watchlist {
  if (!existsSync(WATCHLIST)) return { addresses: [], autoAdd: true, autoAddMinUsd: 250000 };
  try { return JSON.parse(readFileSync(WATCHLIST, "utf8")); }
  catch { return { addresses: [], autoAdd: true, autoAddMinUsd: 250000 }; }
}

function saveWatchlist(w: Watchlist): void {
  try { writeFileSync(WATCHLIST, JSON.stringify(w, null, 2) + "\n"); } catch { /* best effort */ }
}

// in-memory activity feed of watched-wallet swaps
let feed: Swap[] = [];
export function activityFeed(limit = 50): Swap[] { return feed.slice(0, limit); }
export function watchlistAddresses(): string[] { return loadWatchlist().addresses; }

/** One tracker tick: optionally auto-discover new whales, then refresh their activity. */
export async function pollTracker(cfg: GraphCfg): Promise<{ added: number; watching: number; activity: number }> {
  const wl = loadWatchlist();
  let added = 0;
  if (wl.autoAdd) {
    const big = await whaleSwaps(cfg, wl.autoAddMinUsd, 25);
    for (const s of big) {
      if (s.origin && !wl.addresses.includes(s.origin)) { wl.addresses.push(s.origin); added++; }
    }
    if (added) saveWatchlist(wl);
  }
  const activity = await watchedActivity(cfg, wl.addresses, 40);
  feed = activity;
  return { added, watching: wl.addresses.length, activity: activity.length };
}
