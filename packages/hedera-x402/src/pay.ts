// Buyer side — a generic x402 client that signs Hedera payments.
// Fully parameterized (no env / no hardcoded network), so any product can
// construct a paying agent.

import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey as HPK } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { x402Client } from "@x402/core/client";

export interface PayConfig {
  accountId: string;          // 0.0.x — the buying agent
  key: string;                // ECDSA private key (0x prefix ok)
  network?: string;           // default "hedera:testnet"
}

export type PaidFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Build a fetch that transparently answers x402 402-challenges by paying on Hedera. */
export function makePaidFetch(cfg: PayConfig): PaidFetch {
  const network = cfg.network ?? "hedera:testnet";
  const signer = createClientHederaSigner(
    cfg.accountId,
    HPK.fromStringECDSA(cfg.key.replace(/^0x/, "")),
    { network },
  );
  const client = new x402Client().register("hedera:*", new ExactHederaScheme(signer) as any);
  // Allow the Hedera HBAR asset ("0.0.0") — v2.24 spend controls otherwise reject it
  // as a non-default asset. This buyer is our own agent, so disable the caps/allowlist.
  (client as any).setSpendControls?.(false);
  return wrapFetchWithPayment(fetch, client) as PaidFetch;
}

/** True if env holds a client key, so a demo buyer can be constructed from env. */
export function paidFetchFromEnv(): PaidFetch | null {
  const key = process.env.HEDERA_CLIENT_KEY ?? process.env.HEDERA_PRIVATE_KEY;
  const accountId = process.env.HEDERA_CLIENT_ID ?? process.env.HEDERA_ACCOUNT_ID;
  if (!key || !accountId) return null;
  return makePaidFetch({ accountId, key });
}
