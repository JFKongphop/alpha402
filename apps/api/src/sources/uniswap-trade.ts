// Uniswap investment layer — quotes via the Trading API, swaps via hak-uniswap-plugin.
// Hedera pays for the market data; Uniswap (Unichain Sepolia testnet) is where the
// agent's recommendation gets invested. Quote is read-only (no key); swap signs with
// the agent's EVM wallet (EVM_AGENT_PRIVATE_KEY, read by the plugin from the env).

import type { Config } from "../config.js";
import { ethers } from "ethers";

const TRADE_API = process.env.UNISWAP_TRADE_API ?? "https://trade-api.gateway.uniswap.org/v1";
const RPC = process.env.EVM_RPC ?? "https://sepolia.unichain.org";

// tokens with live liquidity on Unichain Sepolia (1301)
export const TOKENS: Record<string, { address: string; decimals: number; symbol: string }> = {
  USDC: { address: "0x31d0220469e10c4E71834a79b1f276d740d3768F", decimals: 6, symbol: "USDC" },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
};

export interface PoolQuote {
  ok: boolean; error?: string;
  chainId: number; tokenIn: string; tokenOut: string;
  amountIn: string;      // human, e.g. "1"
  amountOut: string;     // human, e.g. "0.000773"
  minReceived: string;   // human
  priceImpact: number;   // percent
  rate: string;          // tokenOut per 1 tokenIn (human)
  route: string;         // human route string
}

const toBase = (amountHuman: number, decimals: number) =>
  BigInt(Math.round(amountHuman * 10 ** decimals)).toString();

const fmtUnits = (raw: string, decimals: number, places = 6): string => {
  const neg = raw.startsWith("-");
  const s = (neg ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals) || "0";
  const frac = s.slice(s.length - decimals).replace(/0+$/, "").slice(0, places);
  return (neg ? "-" : "") + (frac ? `${int}.${frac}` : int);
};

/** Live Uniswap quote for tokenIn -> tokenOut (read-only; no wallet needed). */
export async function quotePool(cfg: Config, inSym: string, outSym: string, amountHuman: number, swapper?: string): Promise<PoolQuote> {
  const shell = (): PoolQuote => ({ ok: false, chainId: cfg.evm.chainId, tokenIn: inSym, tokenOut: outSym, amountIn: String(amountHuman), amountOut: "0", minReceived: "0", priceImpact: 0, rate: "0", route: "" });
  const tin = TOKENS[inSym], tout = TOKENS[outSym];
  if (!cfg.uniswapApiKey) return { ...shell(), error: "UNISWAP_API_KEY not set" };
  if (!tin || !tout) return { ...shell(), error: `unsupported token ${!tin ? inSym : outSym} on chain ${cfg.evm.chainId}` };
  const amount = toBase(amountHuman, tin.decimals);
  const body = {
    type: "EXACT_INPUT", tokenInChainId: cfg.evm.chainId, tokenOutChainId: cfg.evm.chainId,
    tokenIn: tin.address, tokenOut: tout.address, amount,
    swapper: swapper ?? "0x0000000000000000000000000000000000000001", slippageTolerance: 0.5,
  };
  const r = await fetch(`${TRADE_API}/quote`, {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": cfg.uniswapApiKey }, body: JSON.stringify(body),
  });
  if (!r.ok) return { ...shell(), error: `quote ${r.status}: ${(await r.text()).slice(0, 150)}` };
  const j: any = await r.json();
  const q = j.quote ?? {};
  const outRaw = String(q.output?.amount ?? "0");
  const minRaw = String(q.output?.minimumAmount ?? outRaw);
  const amountOut = fmtUnits(outRaw, tout.decimals);
  const rate = amountHuman > 0 ? (Number(amountOut) / amountHuman).toPrecision(6) : "0";
  return {
    ok: true, chainId: cfg.evm.chainId, tokenIn: inSym, tokenOut: outSym,
    amountIn: String(amountHuman), amountOut, minReceived: fmtUnits(minRaw, tout.decimals),
    priceImpact: Number(q.priceImpact ?? 0), rate, route: q.routeString ?? "Uniswap",
  };
}

export interface WalletStatus { configured: boolean; address?: string; eth?: string; usdc?: string; funded?: boolean; error?: string }

/** Read-only funding status of the agent's EVM wallet (ETH gas + USDC to invest). */
export async function walletStatus(cfg: Config): Promise<WalletStatus> {
  if (!cfg.evm.privateKey) return { configured: false };
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const address = new ethers.Wallet(cfg.evm.privateKey).address;
    const usdc = new ethers.Contract(TOKENS.USDC.address, ["function balanceOf(address) view returns (uint256)"], provider);
    const [ethWei, usdcRaw] = await Promise.all([provider.getBalance(address), usdc.balanceOf(address)]);
    const eth = Number(ethers.formatEther(ethWei));
    const usdcBal = Number(usdcRaw) / 10 ** TOKENS.USDC.decimals;
    return { configured: true, address, eth: eth.toFixed(4), usdc: usdcBal.toFixed(2), funded: eth > 0 && usdcBal > 0 };
  } catch (e) {
    return { configured: true, error: String((e as Error).message ?? e) };
  }
}

export interface SwapResult { ok: boolean; status?: string; txHash?: string; blockNumber?: number; explorer?: string; error?: string }

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** Execute the swap on-chain via the Uniswap Trading API (signs with EVM_AGENT_PRIVATE_KEY).
 *  Does the full Permit2 flow the hak-uniswap-plugin@0.1.0 omits — ERC-20 approve to Permit2,
 *  SIGN the Permit2 permit, pass it to /swap — then simulates before broadcasting. */
export async function executeSwap(cfg: Config, inSym: string, outSym: string, amountHuman: number): Promise<SwapResult> {
  if (!cfg.evm.privateKey) return { ok: false, error: "EVM_AGENT_PRIVATE_KEY not set" };
  if (!cfg.uniswapApiKey) return { ok: false, error: "UNISWAP_API_KEY not set" };
  const tin = TOKENS[inSym], tout = TOKENS[outSym];
  if (!tin || !tout) return { ok: false, error: `unsupported token ${!tin ? inSym : outSym}` };
  const amount = toBase(amountHuman, tin.decimals);
  const H = { "content-type": "application/json", "x-api-key": cfg.uniswapApiKey };
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(cfg.evm.privateKey, provider);
  try {
    // 1) quote (also returns the Permit2 permitData to sign)
    const qr = await fetch(`${TRADE_API}/quote`, {
      method: "POST", headers: H,
      body: JSON.stringify({ type: "EXACT_INPUT", tokenInChainId: cfg.evm.chainId, tokenOutChainId: cfg.evm.chainId, tokenIn: tin.address, tokenOut: tout.address, amount, swapper: wallet.address, slippageTolerance: 0.5 }),
    });
    if (!qr.ok) return { ok: false, error: `quote ${qr.status}: ${(await qr.text()).slice(0, 120)}` };
    const qj: any = await qr.json();
    const quote = qj.quote, permitData = qj.permitData;

    // 2) ERC-20 approve token -> Permit2 (once)
    const erc = new ethers.Contract(tin.address, ["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"], wallet);
    if ((await erc.allowance(wallet.address, PERMIT2)) < BigInt(amount)) {
      await (await erc.approve(PERMIT2, ethers.MaxUint256)).wait();
    }

    // 3) sign the Permit2 permit (the step the plugin skipped -> revert).
    //    On later swaps the allowance is already set, so the API returns no permitData.
    const swapReq: Record<string, unknown> = { quote };
    if (permitData && typeof permitData === "object") {
      const types = { ...permitData.types } as any; delete types.EIP712Domain;
      swapReq.permitData = permitData;
      swapReq.signature = await wallet.signTypedData(permitData.domain, types, permitData.values);
    }

    // 4) build the swap calldata (with the signed permit embedded when present)
    const sr = await fetch(`${TRADE_API}/swap`, { method: "POST", headers: H, body: JSON.stringify(swapReq) });
    if (!sr.ok) return { ok: false, error: `swap ${sr.status}: ${(await sr.text()).slice(0, 120)}` };
    const tx = (await sr.json())?.swap;
    if (!tx?.to || !tx?.data) return { ok: false, error: "swap tx not returned by the API" };

    // 5) simulate before spending gas — never broadcast a reverting tx
    try { await provider.call({ to: tx.to, from: wallet.address, data: tx.data, value: tx.value ?? "0x0" }); }
    catch (e: any) { return { ok: false, status: "would_revert", error: `simulation reverted: ${String(e.shortMessage ?? e.message).slice(0, 140)}` }; }

    // 6) broadcast + wait
    const sent = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n });
    const rc = await sent.wait();
    const explorer = `https://sepolia.uniscan.xyz/tx/${sent.hash}`;
    if (!rc || rc.status === 0) return { ok: false, status: "reverted", txHash: sent.hash, explorer, error: "swap reverted on-chain" };
    return { ok: true, status: "executed", txHash: sent.hash, blockNumber: rc.blockNumber, explorer };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 200) };
  }
}
