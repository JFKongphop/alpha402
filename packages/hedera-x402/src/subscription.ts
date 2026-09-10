// Subscription orchestration (engine, NEW).
// fulfil() runs AFTER the period fee is paid over x402: it mints the HTS pass and
// writes a verifiable HCS receipt. checkEntitlement() is the gateway's fast-path.

import { mintPass, verifyPass, type Pass, type Entitlement } from "./hts.js";
import { hederaReceipt } from "./receipts.js";

export interface FulfilArgs {
  feed: string;
  subscriber: string;      // 0.0.x or 0x…
  periodMs: number;
  payer?: string;          // who paid the period fee (from x402 settlement)
  payTx?: string | null;   // the settlement tx
}

export interface Subscription extends Pass { feed: string; subscriber: string; receipt: string; }

/** Mint the pass + write the HCS receipt. Call once the /subscribe fee has settled. */
export async function fulfil(args: FulfilArgs): Promise<Subscription> {
  const expiresAt = Date.now() + args.periodMs;
  const pass = await mintPass(args.feed, args.subscriber, expiresAt);
  const rec = await hederaReceipt(JSON.stringify({
    kind: "subscription",
    feed: args.feed,
    subscriber: args.subscriber,
    tokenId: pass.tokenId,
    serial: pass.serial,
    expiresAt,
    payer: args.payer ?? null,
    payTx: args.payTx ?? null,
    t: Date.now(),
  }));
  return { ...pass, feed: args.feed, subscriber: args.subscriber, receipt: rec.hashscan };
}

/** Is this subscriber currently entitled to the feed? (on-chain, via mirror node) */
export async function checkEntitlement(subscriber: string, feed: string): Promise<Entitlement> {
  return verifyPass(subscriber, feed);
}
