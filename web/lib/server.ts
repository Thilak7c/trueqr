// Server-only helpers. Never import from a client component: this module reads secrets.
import { Contract, Wallet, type ContractTransactionResponse } from "ethers";
import { REGISTRY_ADDRESS, abi, chainReader, firstOk, rpcProviders } from "@trueqr/core";

const rpcUrls = (process.env.RPC_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const reader = chainReader(rpcUrls);

const relayers = rpcProviders(rpcUrls).map(
  (p) => new Contract(REGISTRY_ADDRESS, abi, new Wallet(process.env.RELAYER_PRIVATE_KEY!, p)),
);

/** Sends a relayer tx via the first RPC that accepts it. Returns once broadcast, without waiting for mining. */
export function relayerSend(fn: (registry: Contract) => Promise<ContractTransactionResponse>) {
  return firstOk(relayers, fn);
}

export function authed(req: Request): boolean {
  const t = process.env.DEMO_TOKEN;
  return !!t && req.headers.get("x-demo-token") === t;
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
