// Hedera Token Service subscription passes (engine, NEW).
// A subscription = an NFT minted to the subscriber with {feed, exp} metadata.
// Entitlement is verified on-chain via the mirror node (ownership + unexpired).

import {
  TokenCreateTransaction, TokenMintTransaction, TokenAssociateTransaction,
  TransferTransaction, TokenType, TokenSupplyType, TokenId, AccountId, PrivateKey,
} from "@hashgraph/sdk";
import { initHedera, operatorId, operatorKey, mirrorGet } from "./receipts.js";

// One NFT collection per feed, created lazily and cached (mirrors ensureTopic).
const feedTokens = new Map<string, string>();
const envTokenKey = (feed: string) => `FEED_TOKEN_${feed.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

export async function ensureFeedToken(feed: string): Promise<string> {
  if (feedTokens.has(feed)) return feedTokens.get(feed)!;
  const fromEnv = process.env[envTokenKey(feed)];
  if (fromEnv) { feedTokens.set(feed, fromEnv); return fromEnv; }
  const c = initHedera();
  const tx = await new TokenCreateTransaction()
    .setTokenName(`AlphaPass:${feed}`)
    .setTokenSymbol("ALPHA")
    .setTokenType(TokenType.NonFungibleUnique)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(operatorId())
    .setSupplyKey(operatorKey())
    .setAdminKey(operatorKey())
    .execute(c);
  const tokenId = (await tx.getReceipt(c)).tokenId!.toString();
  feedTokens.set(feed, tokenId);
  console.log(`🎫 feed "${feed}" pass token ${tokenId}  https://hashscan.io/testnet/token/${tokenId}`);
  console.log(`   ↳ add ${envTokenKey(feed)}=${tokenId} to .env to reuse it`);
  return tokenId;
}

// HTS NFT metadata caps at 100 bytes: feed short id + expiry epoch (seconds).
function passMetadata(feed: string, expiresAt: number): Uint8Array {
  const meta = JSON.stringify({ f: feed.slice(0, 24), e: Math.floor(expiresAt / 1000) });
  const bytes = new TextEncoder().encode(meta);
  if (bytes.length > 100) throw new Error(`pass metadata too large (${bytes.length}b): ${meta}`);
  return bytes;
}

export interface Pass { tokenId: string; serial: number; expiresAt: number; hashscan: string; }

/** Mint a subscription pass and deliver it to the subscriber account. */
export async function mintPass(feed: string, subscriber: string, expiresAt: number): Promise<Pass> {
  const c = initHedera();
  const tokenId = await ensureFeedToken(feed);
  const mint = await new TokenMintTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setMetadata([passMetadata(feed, expiresAt)])
    .execute(c);
  const serial = Number((await mint.getReceipt(c)).serials![0]);
  // Deliver to subscriber. The mint deposits the serial into the treasury (operator),
  // so only transfer when the subscriber is a different account (and it must be
  // associated / have auto-assoc slots). Same-account = already held, skip.
  const to = subscriber.startsWith("0x") ? AccountId.fromEvmAddress(0, 0, subscriber) : AccountId.fromString(subscriber);
  if (to.toString() !== operatorId().toString()) {
    const xfer = await new TransferTransaction()
      .addNftTransfer(TokenId.fromString(tokenId), serial, operatorId(), to)
      .execute(c);
    await xfer.getReceipt(c);
  }
  return { tokenId, serial, expiresAt, hashscan: `https://hashscan.io/testnet/token/${tokenId}/${serial}` };
}

/** Associate a feed's token to an account we hold the key for (test subscribers). */
export async function associate(accountId: string, accountKey: string, feed: string): Promise<void> {
  const c = initHedera();
  const tokenId = await ensureFeedToken(feed);
  const key = (() => { try { return PrivateKey.fromStringECDSA(accountKey); } catch { return PrivateKey.fromString(accountKey); } })();
  const frozen = await new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(accountId))
    .setTokenIds([TokenId.fromString(tokenId)])
    .freezeWith(c);
  const signed = await frozen.sign(key);
  await (await signed.execute(c)).getReceipt(c);
}

export interface Entitlement { entitled: boolean; expiresAt: number | null; serial: number | null; tokenId: string | null; }

/** Check whether an account holds a valid (unexpired) pass for the feed, via mirror node. */
export async function verifyPass(subscriber: string, feed: string): Promise<Entitlement> {
  const tokenId = await ensureFeedToken(feed);
  const j = await mirrorGet(`/accounts/${subscriber}/nfts?token.id=${tokenId}`);
  const nfts: any[] = j?.nfts ?? [];
  const now = Date.now();
  let best: Entitlement = { entitled: false, expiresAt: null, serial: null, tokenId };
  for (const nft of nfts) {
    try {
      const raw = typeof atob === "function"
        ? Uint8Array.from(atob(nft.metadata), (ch) => ch.charCodeAt(0))
        : Uint8Array.from(Buffer.from(nft.metadata, "base64"));
      const meta = JSON.parse(new TextDecoder().decode(raw));
      const expMs = Number(meta.e) * 1000;
      if (Number.isFinite(expMs) && expMs > now && (!best.entitled || expMs > (best.expiresAt ?? 0))) {
        best = { entitled: true, expiresAt: expMs, serial: Number(nft.serial_number), tokenId };
      }
    } catch { /* skip unparseable serials */ }
  }
  return best;
}
