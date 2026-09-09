// Config + env + feeds loader for the alpha402 API.
// Loads .env (if present) and feeds.json, interpolates ${WALLET}, and reports which
// required keys are missing so we fail LOUDLY rather than silently serving a fake path.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// repo root: apps/api/src -> up three
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Node 20.6+/26 built-in .env loader (no dotenv dep). Silent if there is no .env yet.
try { (process as any).loadEnvFile?.(resolve(ROOT, ".env")); } catch { /* no .env — that's fine before setup */ }

export type FeedModel = "per-call" | "subscription";

export interface FeedSource {
  kind: "graph" | "news" | "brief";
  [k: string]: unknown;
}

export interface Feed {
  name: string;
  model: FeedModel;
  price: number;          // HBAR (per call, or per period for subscriptions)
  description: string;
  meter?: string;         // e.g. "per-query"
  periodDays?: number;    // subscriptions only
  source: FeedSource;
}

interface FeedsFile { wallet: string; feeds: Feed[]; }

export interface Config {
  port: number;
  wallet: string;
  facilitatorUrl: string;
  hedera: { accountId?: string; privateKey?: string; topicId?: string };
  client: { accountId?: string; key?: string };   // the demo buying agent
  graphApiKey?: string;
  uniswapApiKey?: string;
  paxaApiKey?: string;
  evm: { privateKey?: string; chainId: number };   // agent's EVM wallet for Uniswap swaps
  llm: { provider: string; openaiKey?: string; openaiModel: string; anthropicKey?: string; anthropicModel: string };
  feeds: Feed[];
  missing: string[];      // required keys that are unset — paid/live paths refuse until fixed
}

/** Substitute ${VAR} tokens from the environment (leaves the literal if unset). */
function interp(s: string): string {
  return s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? `\${${name}}`);
}

function loadFeeds(): { wallet: string; feeds: Feed[] } {
  const raw = JSON.parse(readFileSync(resolve(ROOT, "feeds.json"), "utf8")) as FeedsFile;
  return { wallet: interp(raw.wallet), feeds: raw.feeds };
}

export function loadConfig(): Config {
  const { wallet, feeds } = loadFeeds();
  const provider = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();

  const cfg: Config = {
    port: Number(process.env.PORT ?? 4021),
    wallet,
    facilitatorUrl: process.env.FACILITATOR_URL ?? "https://api.testnet.blocky402.com",
    hedera: {
      accountId: process.env.HEDERA_ACCOUNT_ID,
      privateKey: process.env.HEDERA_PRIVATE_KEY,
      topicId: process.env.HEDERA_TOPIC_ID,
    },
    client: {
      accountId: process.env.HEDERA_CLIENT_ID ?? process.env.HEDERA_ACCOUNT_ID,
      key: process.env.HEDERA_CLIENT_KEY ?? process.env.HEDERA_PRIVATE_KEY,
    },
    graphApiKey: process.env.GRAPH_API_KEY,
    uniswapApiKey: process.env.UNISWAP_API_KEY,
    paxaApiKey: process.env.PAXA_API_KEY,
    evm: {
      privateKey: process.env.EVM_AGENT_PRIVATE_KEY
        ? (process.env.EVM_AGENT_PRIVATE_KEY.startsWith("0x") ? process.env.EVM_AGENT_PRIVATE_KEY : `0x${process.env.EVM_AGENT_PRIVATE_KEY}`)
        : undefined,
      chainId: Number(process.env.EVM_CHAIN_ID ?? 1301),
    },
    llm: {
      provider,
      openaiKey: process.env.OPENAI_API_KEY,
      openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      anthropicKey: process.env.ANTHROPIC_API_KEY,
      anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    },
    feeds,
    missing: [],
  };

  // Required for the API to serve + settle for real. Reported, not thrown — so the
  // foundation (catalog/health) runs, but paid routes call requireConfigured() first.
  const need: Array<[string, unknown]> = [
    ["WALLET", process.env.WALLET],
    ["HEDERA_ACCOUNT_ID", cfg.hedera.accountId],
    ["HEDERA_PRIVATE_KEY", cfg.hedera.privateKey],
    ["GRAPH_API_KEY", cfg.graphApiKey],
    [provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY",
      provider === "anthropic" ? cfg.llm.anthropicKey : cfg.llm.openaiKey],
  ];
  cfg.missing = need.filter(([, v]) => !v).map(([k]) => k);
  return cfg;
}

/** Throw if any of the named keys are missing — call this at the top of paid/live paths. */
export function requireConfigured(cfg: Config, keys: string[]): void {
  const bad = keys.filter((k) => cfg.missing.includes(k));
  if (bad.length) throw new Error(`not configured: set ${bad.join(", ")} in .env`);
}
