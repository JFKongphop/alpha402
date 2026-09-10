// Recurring renewal via Hedera Scheduled Transactions (engine, NEW).
// A subscription renewal = a transfer of the renewal fee (subscriber -> payout)
// wrapped in a ScheduleCreateTransaction set to execute at the pass expiry.
// This is the "recurring / streamed payments using Scheduled Transactions" path.

import { ScheduleCreateTransaction, TransferTransaction, Hbar, AccountId, Timestamp } from "@hashgraph/sdk";
import { initHedera } from "./receipts.js";

const acct = (a: string) => (a.startsWith("0x") ? AccountId.fromEvmAddress(0, 0, a) : AccountId.fromString(a));

export interface ScheduledRenewal { scheduleId: string; hashscan: string; executeAt: number }

/** Schedule a renewal payment to fire at `executeAt` (epoch ms). */
export async function scheduleRenewal(opts: {
  subscriber: string;
  payTo: string;
  renewalHbar: number;
  executeAt: number;
  memo?: string;
}): Promise<ScheduledRenewal> {
  const c = initHedera();
  const inner = new TransferTransaction()
    .addHbarTransfer(acct(opts.subscriber), new Hbar(-opts.renewalHbar))
    .addHbarTransfer(acct(opts.payTo), new Hbar(opts.renewalHbar));

  const create = new ScheduleCreateTransaction()
    .setScheduledTransaction(inner)
    .setScheduleMemo(opts.memo ?? "alpha402 subscription renewal");

  // Long-term scheduled execution (HIP-423): fire at expiry instead of on first signature.
  try {
    create.setExpirationTime(Timestamp.fromDate(new Date(opts.executeAt)));
    create.setWaitForExpiry(true);
  } catch { /* fall back to sign-to-execute if not supported */ }

  const resp = await create.execute(c);
  const scheduleId = (await resp.getReceipt(c)).scheduleId!.toString();
  return { scheduleId, hashscan: `https://hashscan.io/testnet/schedule/${scheduleId}`, executeAt: opts.executeAt };
}
