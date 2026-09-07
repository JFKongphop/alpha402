// Uniswap Trading API — live quotes / prices. The API routes across v2/v3/v4,
// so this covers the newer AMM versions without a separate v4 subgraph.

const BASE = process.env.UNISWAP_API ?? "https://trade-api.gateway.uniswap.org/v1";

export interface UniCfg { apiKey: string }

// Well-known mainnet tokens (address + decimals) used for pricing/enrichment.
export const TOKENS: Record<string, { address: string; decimals: number }> = {
  WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
  WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
  UNI: { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
  LINK: { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
  ARB: { address: "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1", decimals: 18 },
};

async function callQuote(cfg: UniCfg, body: unknown): Promise<any> {
  const r = await fetch(`${BASE}/quote`, {
    method: "POST",
    headers: { "x-api-key": cfg.apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`uniswap ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
  return j;
}

export interface Quote {
  tokenIn: string; tokenOut: string;
  amountIn: string; amountOut: string;
  priceImpact?: number; gasFeeUSD?: string; routing?: string;
}

/** A live EXACT_INPUT quote (best price) from the Uniswap Trading API. */
export async function getQuote(cfg: UniCfg, tokenIn: string, tokenOut: string, amountRaw: string, chainId = 1): Promise<Quote> {
  const j = await callQuote(cfg, {
    type: "EXACT_INPUT",
    amount: amountRaw,
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    tokenIn,
    tokenOut,
    swapper: "0x0000000000000000000000000000000000000001",
    routingPreference: "BEST_PRICE",
  });
  const q = j.quote ?? {};
  return {
    tokenIn, tokenOut,
    amountIn: q.input?.amount ?? amountRaw,
    amountOut: q.output?.amount ?? "0",
    priceImpact: q.priceImpact,
    gasFeeUSD: q.gasFeeUSD,
    routing: j.routing,
  };
}

/** USD price of 1 unit of a known token (token -> USDC). null if unknown/failed. */
export async function priceUsd(cfg: UniCfg, symbol: string): Promise<number | null> {
  const key = symbol.toUpperCase();
  if (key === "USDC") return 1;
  const t = TOKENS[key];
  if (!t) return null;
  try {
    const one = (10n ** BigInt(t.decimals)).toString();
    const q = await getQuote(cfg, t.address, TOKENS.USDC.address, one);
    return Number(q.amountOut) / 1e6; // USDC has 6 decimals
  } catch { return null; }
}

/** Live USD prices for a set of symbols (unknown/failed symbols are skipped). */
export async function prices(cfg: UniCfg, symbols: string[]): Promise<Record<string, number>> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter((s) => s === "USDC" || TOKENS[s]))].slice(0, 8);
  const out: Record<string, number> = {};
  await Promise.all(uniq.map(async (s) => { const p = await priceUsd(cfg, s); if (p != null) out[s] = p; }));
  return out;
}
