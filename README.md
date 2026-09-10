# alpha402

**Market intelligence, priced for machines.** AI agents *pay per query on Hedera* for
on-chain market signals, get an AI-synthesized trend brief behind an on-chain
subscription pass, and *act on the recommendation via Uniswap* — all settled on-chain
with verifiable receipts.

> Uniswap → The Graph → AI → **Hedera** (pay) → **Uniswap** (invest)

- 🟣 **Hedera** is the settlement core — x402 pay-per-query, HTS subscription passes, HCS receipts, Scheduled-Transaction renewals.
- 🔵 **The Graph** is the data layer — two live Uniswap v3 subgraph queries (whale swaps + volume momentum).
- 🦄 **Uniswap** is the investment venue — the agent recommends a pool and executes a real swap (Trading API, Permit2) on Unichain Sepolia.

The reusable payment engine is published to npm as [`alpha402`](https://www.npmjs.com/package/alpha402).

---

## What it does

alpha402 sells **synthesized market alpha** to AI agents and traders — not a raw API:

| Feed | Source | Model | Price |
|---|---|---|---|
| `whale-radar` | large Uniswap swaps (whale activity) via The Graph | pay-per-call (x402) | 0.02 ℏ |
| `volume-radar` | pools with unusual volume/liquidity momentum (same subgraph) | pay-per-call (x402) | 0.02 ℏ |
| `macro-news` | market-moving macro / political news (RSS) | pay-per-call (x402) | 0.01 ℏ |
| `alpha-brief` | **AI fuses whale + volume + prices + news → a market read** | subscription (HTS pass) | 1 ℏ / 30d |

Raw signals are metered **per query** and settle with x402 on Hedera. The AI brief is
generated on a schedule (the AI does **not** run per request), cached, and gated by an
**HTS subscription pass** — hold a valid pass and the brief is served free.

Two things make it feel alive:

- **Agent Live** — an autonomous agent reads the market on a cadence and, when a signal
  crosses a threshold, **pays for the feed it needs itself** via x402 on Hedera (with an
  optional voice, via Paxa Labs TTS).
- **Invest** — ask the chat *"which pool should I invest in?"* and it recommends a
  Uniswap pool with a live quote, then executes a **real swap on Unichain Sepolia**.

---

## Architecture

```
apps/web    React + Vite dashboard (landing → subscribe gate → dashboard)
apps/api    Hono server on one port — catalog, feeds, x402 gates, agent, chat, invest
packages/hedera-x402   the reusable engine, published to npm as `alpha402`
   pay.ts            buyer-side x402 signer
   resource-server.ts x402 resource server + Blocky402 facilitator
   receipts.ts       HCS receipts + mirror-node reads
   hts.ts            HTS subscription-pass mint / verify
   subscription.ts   subscribe orchestration + entitlement check
   scheduled.ts      recurring renewal via Scheduled Transactions
feeds.json  the catalog of feeds
```

### The Hedera payment flow (the core)

1. **Per-call feed** (`GET /feed/whale-radar`) → x402 `402 Payment Required` → the agent
   pays via the [Blocky402](https://blocky402.com) facilitator → served, and a **verifiable
   HCS receipt** is written to the topic.
2. **Subscription** (`POST /subscribe`) → x402 charges the period fee → **mints an HTS NFT
   pass** to the subscriber → writes an HCS receipt → schedules a **Scheduled-Transaction
   renewal** (HIP-423).
3. **Entitlement gate** (`GET /feed/alpha-brief`) → checks the caller holds a valid HTS
   pass (mirror node) → entitled: served free; not entitled: `402` pointing at `/subscribe`.
4. **Read it back** — the dashboard's Transactions tab reads the full history straight from
   the **Hedera mirror node** (`GET /chain`), so it survives restarts and is verifiable on
   HashScan.

### The Uniswap investment flow

`chat` → `recommend_pool` tool → live **Uniswap Trading API** quote (route, price impact,
min-received) → the pool card's **Invest** button → `POST /invest` → the full Permit2 swap
(ERC-20 approve → **sign the Permit2 permit** → `/swap` → simulate → broadcast) on
**Unichain Sepolia (chain 1301)**. Hedera pays for the *data*; Uniswap is where the
recommendation is *acted on*.

---

## Sponsor integrations — where to look

| Sponsor | What | Code |
|---|---|---|
| **Hedera** | x402 settlement, HTS passes, HCS receipts, Scheduled Transactions | `packages/hedera-x402/*`, gates in `apps/api/src/server.ts` |
| **The Graph** | 2 live Uniswap v3 subgraph queries (whale + volume) | `apps/api/src/sources/graph.ts` |
| **Uniswap** | live prices + real investment swaps (Trading API, Permit2, v3/v4 routing) | `apps/api/src/sources/uniswap.ts`, `apps/api/src/sources/uniswap-trade.ts` — see also [`FEEDBACK.md`](./FEEDBACK.md) |

---

## Setup

**Prerequisites:** Node **20.6+** (built-in `.env` loader + global `fetch`), `pnpm`.

```bash
pnpm install
cp .env.example .env      # then fill in the keys (see below)
pnpm dev                  # api on :4021, web on :4022
```

Open the dashboard at **http://localhost:4022**.

### Environment (`.env`)

| Key | Purpose |
|---|---|
| `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` | operator — mints passes, writes receipts, receives payout |
| `HEDERA_TOPIC_ID` | durable HCS receipt topic (auto-created if unset; paste back to reuse) |
| `WALLET` | payout wallet advertised to buyers |
| `HEDERA_CLIENT_ID` / `HEDERA_CLIENT_KEY` | the demo buying agent (pays for feeds/subscriptions) |
| `FACILITATOR_URL` | `https://api.testnet.blocky402.com` |
| `GRAPH_API_KEY` | The Graph gateway key — **required for live data** |
| `UNISWAP_API_KEY` | Uniswap Trading API key (prices + invest quotes/swaps) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | the AI that writes the brief (or set `LLM_PROVIDER=anthropic`) |
| `PAXA_API_KEY` | text-to-speech for the agent + brief (optional) |
| `EVM_AGENT_PRIVATE_KEY` | the agent's EVM wallet that executes Uniswap swaps |
| `EVM_CHAIN_ID` | `1301` (Unichain Sepolia) |
| `EVM_RPC` | `https://unichain-sepolia-rpc.publicnode.com` (reliable — see FEEDBACK.md) |

### To try the invest flow

Fund the EVM agent wallet on **Unichain Sepolia**:
- **USDC** → [faucet.circle.com](https://faucet.circle.com) (select Unichain Sepolia)
- **ETH (gas)** → [ethglobal.com/faucet/unichain-sepolia-1301](https://ethglobal.com/faucet/unichain-sepolia-1301) or bridge from Sepolia at [bridge.unichain.org](https://bridge.unichain.org)

The pool card shows the wallet's funding status and only enables **Invest** once it's funded.

---

## The engine as a package

The payment core is idea-agnostic and published to npm:

```bash
npm i alpha402
```

```ts
import { makePaidFetch, fulfil, checkEntitlement } from "alpha402";

// buyer: pay per call, get the settled Hedera tx back
const fetchPaid = makePaidFetch({ accountId: "0.0.x", key: "0x…" });
const res = await fetchPaid("https://…/feed/whale-radar");

// seller: subscribe -> HTS pass + HCS receipt, then gate on entitlement
const sub = await fulfil({ feed: "alpha-brief", subscriber: "0.0.x", periodMs: 30 * 86_400_000 });
const ent = await checkEntitlement("0.0.x", "alpha-brief");
```

---

## API (selected)

| Route | What |
|---|---|
| `GET /catalog` | the feeds for sale |
| `GET /feed/:name` | a per-call feed (x402-gated) |
| `POST /subscribe` | x402 → mint HTS pass + HCS receipt + schedule renewal |
| `GET /feed/alpha-brief` | HTS-entitlement-gated brief |
| `GET /chain` | full on-chain history, read back from the Hedera mirror node |
| `POST /chat` | the market-intelligence chat agent (recommends pools) |
| `POST /brief/ask` | a brief focused on the user's question |
| `GET /agent` · `POST /agent/start|stop` | the autonomous agent |
| `POST /invest` · `GET /wallet` | Uniswap swap + agent-wallet funding status |
| `POST /speak` | text-to-speech (Paxa Labs) |

---

## Stack

Hono · React + Vite · `@x402/*` + `@hashgraph/sdk` (Hedera) · The Graph (Uniswap v3
subgraph) · Uniswap Trading API + `ethers` v6 (Unichain Sepolia) · OpenAI · Paxa Labs (TTS).

## License

MIT
