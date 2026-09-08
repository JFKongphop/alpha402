import { usePoll } from "./api";

// The full on-chain history, read straight back from the Hedera mirror node —
// Etherscan-style. Unlike the in-memory event log, this survives server restarts
// and shows every transaction the account ever made.
interface Tx {
  id: string; name: string; title: string; kind: string; result: string;
  t: number; amountHbar?: number; payer?: string; hashscan: string;
}

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const ago = (t: number) => {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function TxList() {
  const data = usePoll<Tx[]>("/chain", 8000);
  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="card newsfeed" style={{ maxHeight: 464 }}>
      {rows.length === 0 && (
        <div className="muted" style={{ padding: 22 }}>
          Reading on-chain history from the Hedera mirror node…
        </div>
      )}
      {rows.map((e) => {
        const detail = [
          e.amountHbar ? `${e.amountHbar} ℏ` : "",
          e.payer ? `from ${short(e.payer)}` : "",
        ].filter(Boolean).join(" · ");
        return (
          <a key={e.id} className="newsrow" href={e.hashscan} target="_blank" rel="noreferrer">
            <div className="news-l">
              <div className="news-title">{e.title}</div>
              <div className="news-time">{e.kind}{detail ? ` · ${detail}` : ""} · {ago(e.t)}</div>
            </div>
            <span className="news-arrow">↗</span>
          </a>
        );
      })}
    </div>
  );
}
