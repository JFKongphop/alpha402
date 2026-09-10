# Uniswap Integration — Developer Feedback

Feedback on building with Uniswap for **alpha402**, where Uniswap is the **investment
venue**: an AI agent recommends a pool from market signals, then executes a **real swap**
on **Unichain Sepolia (chain 1301)** on the user's behalf.

**What we built with Uniswap**
- **Prices & data:** live token prices via the Uniswap **Trading API** (`/v1/quote`), and
  whale/volume signals derived from the **Uniswap v3 subgraph** (via The Graph).
- **Investment:** a server-side agent wallet swaps USDC → WETH via the Trading API,
  auto-routing across v2/v3/v4, using the full **Permit2** flow.
- Code: `apps/api/src/sources/uniswap.ts` (prices) and `apps/api/src/sources/uniswap-trade.ts`
  (quote + swap).

---

## What worked well

- **`/v1/quote` is excellent for a recommendation UI.** One call returns the route,
  `priceImpact`, `output.amount`, and `output.minimumAmount` — everything needed to render
  a "plan" card. Auto-routing across v2/v3/v4 means we didn't have to pick a pool manually.
- **Testnet support on Unichain Sepolia actually worked.** `/quote` returned real CLASSIC
  routes and permit data for USDC→WETH on chain 1301 with a standard API key — this was the
  single biggest risk and it held up.
- **Permit2 + Universal Router** is the right primitive for an agent that swaps repeatedly:
  after the first permit sets the allowance, later swaps need no signature.

## Pain points (with concrete repro)

1. **The server-side Permit2 flow is under-documented.** For a non-wallet (server signer)
   integration, the critical step is: `/quote` returns `permitData`, you must **sign it
   (EIP-712 `PermitSingle`)** and pass the signature to `/swap`. If you call `/swap` with
   just `{ quote }`, the returned calldata is built without the permit and the swap
   **reverts on the Universal Router** with an opaque `CALL_EXCEPTION` (empty data, no
   logs). A popular community plugin skipped the signing step and every swap silently
   reverted — it took an on-chain trace to realize the permit was missing. A short
   *"server-side swap with an agent key"* quickstart showing quote → sign permit → swap
   would save a lot of time.

2. **`/swap` rejects `permitData: null`.** On a repeat swap (allowance already set), `/quote`
   correctly returns `permitData: null`. But passing that straight through to `/swap` yields:
   `400 { "errorCode": "RequestValidationError", "detail": "\"permitData\" must be of type
   object" }`. The fix is to **omit** the field entirely rather than send `null` — but the
   error doesn't hint at that, and "returns null" → "must not be null" is a confusing
   round-trip. Accepting `null`/omitted gracefully (or saying so in the error) would help.

3. **Revert reasons are opaque.** A missing-permit swap fails with a bare `CALL_EXCEPTION`,
   `status: 0`, empty `logs`, and `data: null` — nothing points at Permit2. A
   `/swap`-time validation ("this quote requires a signed permit you didn't provide") or a
   documented `eth_call` simulation step would surface the real cause much earlier.

4. **Unichain Sepolia RPC reliability (not strictly Uniswap, but it blocked the swap).**
   The default public RPC `https://sepolia.unichain.org` **accepts `eth_sendRawTransaction`
   but never mines or returns the receipt**, so `tx.wait()` hangs indefinitely (the tx sits
   as `"already known"`). Switching to `https://unichain-sepolia-rpc.publicnode.com` mined
   the identical signed tx in ~4s. Worth flagging in the Unichain testnet docs and
   recommending a reliable RPC in Trading-API testnet examples.

5. **Thin testnet liquidity.** On Unichain Sepolia only **USDC/WETH** reliably quotes; most
   other testnet tokens have no pool, so recommendations are constrained to one pair. A
   documented list of **liquid testnet pairs** (or a few more seeded pools) would make
   building and demoing multi-pool flows much easier.

## Suggestions

- Publish a **server-side / agent quickstart** for the Trading API: quote → sign
  `permitData` → `/swap` → simulate → broadcast, with `ethers` v6.
- Make `/swap` **accept `permitData: null` / omitted** without a validation error, or make
  the error say "omit permitData when the quote returns null."
- Add an **optional simulation flag** (or clearer revert surface) so a missing permit is
  caught before broadcast.
- Recommend a reliable **Unichain Sepolia RPC** and list **liquid testnet pairs** in the docs.

---

*Submitted via the Uniswap Developer Feedback Form.* Integration code:
`apps/api/src/sources/uniswap-trade.ts` (see the `executeSwap` Permit2 flow) and
`apps/api/src/sources/uniswap.ts`.
