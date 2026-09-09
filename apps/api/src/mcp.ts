// alpha402 MCP server — makes any AI agent a paying customer.
//
// Tools:
//   list_feeds  → discover what's for sale (agent discovery / directory)
//   pay_feed    → pay per query (x402 on Hedera) for a raw feed, get live data + tx
//   subscribe   → pay the period fee -> receive an HTS pass for alpha-brief
//   get_brief   → read the AI trend brief (needs an active pass)
//
// Payments are REAL: the same x402 Hedera client, blocky402 as fee-payer, so each
// call returns a live HashScan transaction. Needs HEDERA_CLIENT_ID/HEDERA_CLIENT_KEY
// (the buyer's signing account) in .env. Requires the alpha402 API to be running.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js"; // importing loads .env
import { makePaidFetch, decodePaymentResponseHeader } from "alpha402";

const cfg = loadConfig();
const API = process.env.ALPHA_API ?? `http://localhost:${cfg.port}`;
const buyer = cfg.client.accountId && cfg.client.key
  ? makePaidFetch({ accountId: cfg.client.accountId, key: cfg.client.key })
  : null;

const hashscan = (tx: string) =>
  `https://hashscan.io/testnet/transaction/${String(tx).replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;

const server = new McpServer({ name: "alpha402", version: "0.1.0" });

server.tool(
  "list_feeds",
  "List the market-intelligence feeds for sale on alpha402: name, price (HBAR), pay model (per-call or subscription), and how to buy. Call this first.",
  {},
  async () => {
    const cat = await fetch(`${API}/catalog`).then((r) => r.json());
    return { content: [{ type: "text", text: JSON.stringify(cat, null, 2) }] };
  },
);

server.tool(
  "pay_feed",
  "Pay per query (x402 on Hedera) for a per-call feed and get the live data plus the Hedera settlement transaction.",
  {
    feed: z.string().describe("whale-radar | volume-radar | macro-news"),
    units: z.number().optional().describe("how many units to buy — scales the price and the amount of data"),
  },
  async ({ feed, units }) => {
    if (!buyer) return { content: [{ type: "text", text: "No buyer configured: set HEDERA_CLIENT_ID / HEDERA_CLIENT_KEY in .env." }], isError: true };
    const headers: Record<string, string> = {};
    if (units) headers["x-alpha-units"] = String(units);
    const res = await buyer(`${API}/feed/${feed}`, { headers });
    const text = (await res.text()).slice(0, 4000);
    let paid = "";
    const ph = res.headers.get("payment-response");
    if (ph) { try { const s: any = decodePaymentResponseHeader(ph); if (s?.transaction) paid = `PAID on Hedera, tx ${s.transaction}\n${hashscan(s.transaction)}\n\n`; } catch {} }
    return { content: [{ type: "text", text: `${paid}HTTP ${res.status}\n${text}` }] };
  },
);

server.tool(
  "subscribe",
  "Subscribe to the AI alpha-brief: pay the period fee over x402 and receive an HTS subscription pass. Returns the pass + HashScan links.",
  { subscriber: z.string().describe("your Hedera account id, e.g. 0.0.12345") },
  async ({ subscriber }) => {
    if (!buyer) return { content: [{ type: "text", text: "No buyer configured: set HEDERA_CLIENT_ID / HEDERA_CLIENT_KEY in .env." }], isError: true };
    const res = await buyer(`${API}/subscribe?subscriber=${subscriber}`, { method: "POST" });
    return { content: [{ type: "text", text: `HTTP ${res.status}\n${(await res.text()).slice(0, 2000)}` }] };
  },
);

server.tool(
  "get_brief",
  "Read the latest AI market-trend brief. Requires an active subscription pass for the given account.",
  { subscriber: z.string().describe("your Hedera account that holds the alpha-brief pass") },
  async ({ subscriber }) => {
    const res = await fetch(`${API}/feed/alpha-brief?subscriber=${subscriber}`);
    return { content: [{ type: "text", text: `HTTP ${res.status}\n${(await res.text()).slice(0, 3000)}` }] };
  },
);

await server.connect(new StdioServerTransport());
