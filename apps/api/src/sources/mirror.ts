// Read-back of the full on-chain history from the Hedera mirror node — the
// Etherscan-equivalent for the dashboard's Transactions tab. Unlike the in-memory
// event log (which resets on every server restart), this is the ledger's own record:
// it survives restarts and returns every transaction the account was ever part of.

const MIRROR = process.env.MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

// map Hedera transaction types -> the dashboard's payment vocabulary
const LABEL: Record<string, { title: string; kind: string }> = {
  CRYPTOTRANSFER:         { title: "Payment",                  kind: "x402 payment" },
  CONSENSUSSUBMITMESSAGE: { title: "HCS receipt written",      kind: "HCS" },
  TOKENMINT:              { title: "Subscription pass minted", kind: "HTS mint" },
  TOKENASSOCIATE:         { title: "Token associated",         kind: "HTS" },
  TOKENCREATION:          { title: "Feed token created",       kind: "HTS" },
  CONSENSUSCREATETOPIC:   { title: "Receipt topic created",    kind: "HCS" },
  SCHEDULECREATE:         { title: "Scheduled renewal created", kind: "scheduled tx" },
};

export interface ChainTx {
  id: string; name: string; title: string; kind: string; result: string;
  t: number; amountHbar?: number; payer?: string; hashscan: string;
}

/** Every transaction touching `account`, newest first, straight from the mirror node. */
export async function chainHistory(account: string, limit = 60): Promise<ChainTx[]> {
  const url = `${MIRROR}/api/v1/transactions?account.id=${account}&limit=${Math.min(limit, 100)}&order=desc`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`mirror ${r.status}`);
  const j: any = await r.json();
  return (j.transactions ?? []).map((t: any): ChainTx => {
    const l = LABEL[t.name] ?? { title: t.name, kind: t.name };
    const ts = String(t.consensus_timestamp);
    const row: ChainTx = {
      id: t.transaction_id,
      name: t.name,
      title: l.title,
      kind: l.kind,
      result: t.result,
      t: Math.floor(Number(ts.split(".")[0]) * 1000),
      hashscan: `https://hashscan.io/testnet/transaction/${ts}`,
    };
    // for a payment: the amount this account received, and who paid it (the counterparty
    // that sent exactly that amount — not the facilitator relayer that only covers gas)
    if (t.name === "CRYPTOTRANSFER" && Array.isArray(t.transfers)) {
      const recv = t.transfers.filter((x: any) => x.account === account && x.amount > 0)
        .sort((a: any, b: any) => b.amount - a.amount)[0];
      if (recv) {
        row.amountHbar = Number((recv.amount / 1e8).toFixed(8));
        const payer = t.transfers.find((x: any) => x.account !== account && x.amount === -recv.amount)
          ?? t.transfers.filter((x: any) => x.amount < 0).sort((a: any, b: any) => a.amount - b.amount)[0];
        if (payer) row.payer = payer.account;
      }
    }
    return row;
  });
}
