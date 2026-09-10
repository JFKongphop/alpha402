// x402 resource-server + Hedera facilitator wiring (engine). The idea-agnostic
// payment plumbing only — product logic (upstream proxy, key injection, etc.)
// stays in the app that consumes this package.

import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { paymentMiddleware } from "@x402/hono";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { hashscanTx } from "./receipts.js";

export const DEFAULT_FACILITATOR = "https://api.testnet.blocky402.com";
export const toAtomic = (hbar: number) => String(Math.round(hbar * 1e8)); // HBAR -> tinybar

/** Hedera x402 resource server, talking to the Blocky402 facilitator. */
export function makeResourceServer(facilitator = process.env.FACILITATOR_URL ?? DEFAULT_FACILITATOR) {
  return new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitator }))
    .register("hedera:*", new ExactHederaScheme() as any);
}

/** Price is either a fixed atomic string or a per-request function (for per-query metering). */
export type PriceFn = (ctx: any) => { amount: string; asset: string };

/** A payment-middleware route descriptor for a Hedera x402 endpoint. */
export function hederaRoute(payTo: string, price: string | PriceFn, description = "x402 endpoint") {
  const priceSpec = typeof price === "string" ? { amount: price, asset: "0.0.0" } : price;
  return { description, accepts: { scheme: "exact", network: "hedera:testnet", payTo, price: priceSpec, maxTimeoutSeconds: 180 } };
}

export interface Settlement { payer: string; tx: string | null; hashscan: string | null; }

/** Decode the X-PAYMENT-RESPONSE header a settled x402 request returns. */
export function decodeSettlement(header: string): Settlement {
  const s: any = decodePaymentResponseHeader(header);
  const tx = s.transaction ?? null;
  return { payer: s.payer ?? "unknown", tx, hashscan: tx ? hashscanTx(tx) : null };
}

export { paymentMiddleware, decodePaymentResponseHeader };
