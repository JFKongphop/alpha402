// Hedera settlement + HCS receipts (engine). Parameterized (topic memo, mirror
// base) with a generic mirror-GET helper that hts.ts reuses for NFT lookups.

import {
  Client, PrivateKey, AccountId, Hbar,
  TopicCreateTransaction, TopicMessageSubmitTransaction, TransferTransaction,
} from "@hashgraph/sdk";

export const MIRROR = process.env.HEDERA_MIRROR ?? "https://testnet.mirrornode.hedera.com/api/v1";

let client: Client | null = null;
let topicId: string | null = null;

export function hederaEnabled(): boolean {
  return !!(process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY);
}

export function operatorId(): AccountId {
  return AccountId.fromString(process.env.HEDERA_ACCOUNT_ID!);
}

export function operatorKey(): PrivateKey {
  const raw = process.env.HEDERA_PRIVATE_KEY!;
  // EVM-alias accounts use ECDSA keys; fall back to DER/ED25519 just in case.
  try { return PrivateKey.fromStringECDSA(raw); } catch { return PrivateKey.fromString(raw); }
}

export function initHedera(): Client {
  if (client) return client;
  client = Client.forTestnet().setOperator(operatorId(), operatorKey());
  return client;
}

export async function ensureTopic(memo = process.env.HEDERA_TOPIC_MEMO ?? "alpha402 x402 receipts"): Promise<string> {
  if (topicId) return topicId;
  if (process.env.HEDERA_TOPIC_ID) {
    topicId = process.env.HEDERA_TOPIC_ID;
    console.log(`🪵 HCS receipt topic ${topicId} (env)  https://hashscan.io/testnet/topic/${topicId}`);
    return topicId;
  }
  const c = initHedera();
  const tx = await new TopicCreateTransaction().setTopicMemo(memo).execute(c);
  topicId = (await tx.getReceipt(c)).topicId!.toString();
  console.log(`🪵 HCS receipt topic ${topicId}  https://hashscan.io/testnet/topic/${topicId}`);
  console.log(`   ↳ add HEDERA_TOPIC_ID=${topicId} to .env to keep it across restarts`);
  return topicId;
}

export const hashscanTx = (txId: string) =>
  // HashScan wants 0.0.x@sss.nnn as 0.0.x-sss-nnn
  `https://hashscan.io/testnet/transaction/${txId.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;

export interface HederaReceipt { txId: string; topicId: string; hashscan: string; }

/** Write one tamper-evident HCS message = the verifiable payment/subscription receipt. */
export async function hederaReceipt(memo: string): Promise<HederaReceipt> {
  const c = initHedera();
  const topic = await ensureTopic();
  const submit = await new TopicMessageSubmitTransaction().setTopicId(topic).setMessage(memo).execute(c);
  await submit.getReceipt(c);
  const txId = submit.transactionId!.toString();
  return { txId, topicId: topic, hashscan: hashscanTx(txId) };
}

/** Real HBAR transfer; sending to a fresh 0x address lazy-creates the account. */
export async function hederaTransfer(to: string, hbar = 0.001): Promise<HederaReceipt> {
  const c = initHedera();
  const from = operatorId();
  const toAccount = to.startsWith("0x") ? AccountId.fromEvmAddress(0, 0, to) : AccountId.fromString(to);
  const tx = await new TransferTransaction()
    .addHbarTransfer(from, new Hbar(-hbar))
    .addHbarTransfer(toAccount, new Hbar(hbar))
    .execute(c);
  await tx.getReceipt(c);
  return { txId: tx.transactionId!.toString(), topicId: "", hashscan: hashscanTx(tx.transactionId!.toString()) };
}

/** Generic mirror-node GET (returns null on any failure), reused by hts.ts. */
export async function mirrorGet(path: string): Promise<any | null> {
  try { const r = await fetch(`${MIRROR}${path}`); if (!r.ok) return null; return await r.json(); }
  catch { return null; }
}

export interface HederaAccount { accountId: string; evm: string | null; balance: number; created: boolean; hashscan: string; }

export async function lookup(addrOrId: string): Promise<HederaAccount | null> {
  const j = await mirrorGet(`/accounts/${addrOrId}`);
  if (!j?.account) return null;
  return {
    accountId: j.account,
    evm: j.evm_address ?? null,
    balance: Number(j.balance?.balance ?? 0) / 1e8,
    created: false,
    hashscan: `https://hashscan.io/testnet/account/${j.account}`,
  };
}

/** Resolve a connected wallet to its Hedera account, lazy-creating a 0x one if new. */
export async function resolveOrCreateAccount(addr: string): Promise<HederaAccount | null> {
  const existing = await lookup(addr);
  if (existing) return existing;
  if (!addr.startsWith("0x") || !hederaEnabled()) return null;
  await hederaTransfer(addr, 0.1);
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const found = await lookup(addr);
    if (found) return { ...found, created: true };
  }
  return null;
}
