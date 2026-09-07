// Live Uniswap v3 subgraph client (The Graph decentralized gateway).
// Three query modes: whale-swaps, volume-momentum, watched-wallet activity.
// This is the load-bearing The Graph integration (real data, live key required).

const GATEWAY = "https://gateway.thegraph.com/api";
// Known subgraph deployments (name -> decentralized-network id). A raw id also works.
const SUBGRAPHS: Record<string, string> = {
  "uniswap-v3": "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV", // Uniswap v3, Ethereum
};

export interface GraphCfg { apiKey: string; subgraph: string; }

function endpoint(cfg: GraphCfg): string {
  const id = SUBGRAPHS[cfg.subgraph] ?? cfg.subgraph;
  return `${GATEWAY}/${cfg.apiKey}/subgraphs/id/${id}`;
}

async function gql<T>(cfg: GraphCfg, query: string, variables?: Record<string, unknown>): Promise<T> {
  const r = await fetch(endpoint(cfg), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`subgraph HTTP ${r.status}`);
  const j: any = await r.json();
  if (j.errors) throw new Error(`subgraph errors: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return j.data as T;
}

export interface Swap {
  amountUSD: number;
  timestamp: number;
  pair: string;        // "WETH/USDT"
  origin: string;      // the EOA that sent the swap
  txHash?: string;
}

function mapSwap(s: any): Swap {
  return {
    amountUSD: Number(s.amountUSD),
    timestamp: Number(s.timestamp),
    pair: `${s.token0?.symbol ?? "?"}/${s.token1?.symbol ?? "?"}`,
    origin: (s.origin ?? "").toLowerCase(),
    txHash: s.transaction?.id,
  };
}

const SWAP_FIELDS = "amountUSD timestamp origin transaction{ id } token0{ symbol } token1{ symbol }";

/** Mode 1 — recent swaps over a USD threshold (whale activity). */
export async function whaleSwaps(cfg: GraphCfg, minUsd: number, limit = 20): Promise<Swap[]> {
  const q = `query($min: BigDecimal!, $n: Int!){
    swaps(first:$n, orderBy: timestamp, orderDirection: desc, where:{ amountUSD_gt: $min }){ ${SWAP_FIELDS} }
  }`;
  const d = await gql<{ swaps: any[] }>(cfg, q, { min: String(minUsd), n: limit });
  return d.swaps.map(mapSwap);
}

export interface PoolMomentum {
  pair: string;
  tvlUSD: number;
  volumeToday: number;
  volumePrev: number;
  momentum: number;    // today / prev (capped)
}

/** Mode 2 — pools with unusual volume momentum (today vs prior day). */
export async function volumeMomentum(cfg: GraphCfg, topN = 15): Promise<PoolMomentum[]> {
  const q = `query($n: Int!){
    pools(first:$n, orderBy: totalValueLockedUSD, orderDirection: desc, where:{ totalValueLockedUSD_gt: "1000000" }){
      token0{ symbol } token1{ symbol } totalValueLockedUSD
      poolDayData(first:2, orderBy: date, orderDirection: desc){ volumeUSD }
    }
  }`;
  const d = await gql<{ pools: any[] }>(cfg, q, { n: topN });
  return d.pools.map((p) => {
    const today = Number(p.poolDayData?.[0]?.volumeUSD ?? 0);
    const prev = Number(p.poolDayData?.[1]?.volumeUSD ?? 0);
    const momentum = prev > 0 ? today / prev : (today > 0 ? 999 : 0);
    return { pair: `${p.token0?.symbol}/${p.token1?.symbol}`, tvlUSD: Number(p.totalValueLockedUSD), volumeToday: today, volumePrev: prev, momentum };
  }).sort((a, b) => b.momentum - a.momentum);
}

/** Mode 3 — recent swaps by watched wallet addresses (the tracker). */
export async function watchedActivity(cfg: GraphCfg, addresses: string[], limit = 30): Promise<Swap[]> {
  if (addresses.length === 0) return [];
  const q = `query($addrs: [String!], $n: Int!){
    swaps(first:$n, orderBy: timestamp, orderDirection: desc, where:{ origin_in: $addrs }){ ${SWAP_FIELDS} }
  }`;
  const d = await gql<{ swaps: any[] }>(cfg, q, { addrs: addresses.map((a) => a.toLowerCase()), n: limit });
  return d.swaps.map(mapSwap);
}
