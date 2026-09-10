# alpha402

Reusable **x402 payment engine for Hedera**. Gate any HTTP resource behind a real
per-call payment, sell on-chain **HTS subscription passes**, and write verifiable
**HCS receipts** — all settled on Hedera through the [Blocky402](https://blocky402.com)
facilitator.

Powers [Alpha Market](https://github.com/JFKongphop/alpha402) — agentic market
intelligence for AI agents.

```bash
npm i alpha402
# peer runtime: Node 20.6+ (uses the built-in fetch + .env loader)
```

## What you get

| Capability | Functions |
|---|---|
| **Buyer** — sign & pay x402 requests | `makePaidFetch` |
| **Seller** — x402-gate a route | `makeResourceServer`, `hederaRoute`, `paymentMiddleware`, `toAtomic`, `decodeSettlement` |
| **Subscriptions** — HTS pass + entitlement | `fulfil`, `checkEntitlement`, `ensureFeedToken`, `mintPass`, `verifyPass`, `associate` |
| **Receipts** — verifiable audit trail | `hederaReceipt`, `hederaEnabled` |
| **Recurring** — Scheduled Transactions | `scheduleRenewal` |

## Buyer — pay per call

An agent pays for a resource with one signed request; the settled Hedera tx comes
back in the `payment-response` header.

```ts
import { makePaidFetch, decodeSettlement } from "alpha402";

const fetchPaid = makePaidFetch({ accountId: "0.0.x", key: "0x…" });

const res = await fetchPaid("https://api.example.com/feed/whale-radar");
const data = await res.json();

const settlement = decodeSettlement(res.headers.get("payment-response")!);
console.log(settlement.tx, settlement.hashscan); // real, verifiable on HashScan
```

## Seller — gate a route with x402

```ts
import { Hono } from "hono";
import { makeResourceServer, hederaRoute, paymentMiddleware, toAtomic } from "alpha402";

const app = new Hono();
const x402 = makeResourceServer("https://api.testnet.blocky402.com");

app.use("*", paymentMiddleware({
  "GET /feed/whale-radar": hederaRoute(payToAccountId, toAtomic(0.02), "whale-radar"),
}, x402));

app.get("/feed/whale-radar", (c) => c.json({ data: /* your live data */ }));
```

## Subscriptions — an on-chain HTS pass

`fulfil` charges the period fee, mints an NFT pass to the subscriber, and writes an
HCS receipt. `checkEntitlement` verifies the holder still has a valid pass (mirror node).

```ts
import { fulfil, checkEntitlement, scheduleRenewal } from "alpha402";

const sub = await fulfil({ feed: "alpha-brief", subscriber: "0.0.x", periodMs: 30 * 86_400_000 });
// -> { tokenId, serial, expiresAt, receipt }

const ent = await checkEntitlement("0.0.x", "alpha-brief"); // { entitled, expiresAt }

// optional: recurring renewal via Hedera Scheduled Transactions (HIP-423)
await scheduleRenewal({ subscriber: "0.0.x", payTo, renewalHbar: 5, executeAt: sub.expiresAt, memo: "renew" });
```

## Verifiable receipts on HCS

```ts
import { hederaReceipt, hederaEnabled } from "alpha402";

if (hederaEnabled()) {
  const r = await hederaReceipt(JSON.stringify({ kind: "call", payer, tx, t: Date.now() }));
  console.log(r.hashscan); // the receipt, on-chain
}
```

## Configuration

Read from the environment (Node's built-in `.env` loader):

| Var | Purpose |
|---|---|
| `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` | operator — mints passes, writes receipts |
| `HEDERA_TOPIC_ID` | durable HCS receipt topic (created on first use if unset) |
| `FACILITATOR_URL` | defaults to `https://api.testnet.blocky402.com` |

The chain is pluggable; only Hedera testnet is wired today.

## License

MIT
