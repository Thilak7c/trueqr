import { Contract, FetchRequest, JsonRpcProvider, type EventLog } from "ethers";
import abi from "./abi.json";
import { CHAIN_ID, DEPLOY_BLOCK, REGISTRY_ADDRESS } from "./address";
import { parseEmv } from "./emv";
import { qrHash } from "./fingerprint";
import { haversineM, type LatLng } from "./geo";
import { message, type Reason } from "./reasons";

export type Stall = {
  id: number;
  registrar: string;
  qrHash: string;
  name: string;
  latE6: number;
  lngE6: number;
  photoURI: string;
  lang: string;
  registeredAt: number;
  active: boolean;
};

export type Reader = {
  blacklisted(hash: string): Promise<boolean>;
  stallByQr(hash: string): Promise<number>; // 0 = none
  getStall(id: number): Promise<Stall>;
  listStalls(): Promise<Stall[]>; // active only
};

export type Verdict = {
  status: "green" | "amber" | "red";
  reason: Reason;
  notes: string[];
  message: string;
  payeeName: string | null;
  qrHash: string;
  stall: { id: number; name: string; photoURI: string; registeredAt: number } | null;
  nearby: { id: number; name: string; photoURI: string; distanceM: number }[];
  reportTx: string | null;
};

export type VerifyInput = { qrPayload: string; lat?: number; lng?: number };

const MISMATCH_RADIUS_M = 100;
const ELSEWHERE_RADIUS_M = 300;

const pos = (s: Stall): LatLng => ({ lat: s.latE6 / 1e6, lng: s.lngE6 / 1e6 });
const summary = (s: Stall) => ({ id: s.id, name: s.name, photoURI: s.photoURI, registeredAt: s.registeredAt });

function location(i: VerifyInput): LatLng | null {
  const { lat, lng } = i;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** §6 table: first matching row wins. `lang` picks the message language (en | ms; others → en). */
export async function verify(input: VerifyInput, reader: Reader, lang = "en"): Promise<Verdict> {
  if (typeof input?.qrPayload !== "string" || !input.qrPayload.trim()) throw new Error("qrPayload required");
  const text = input.qrPayload.trim();
  const hash = qrHash(text);
  const emv = parseEmv(text);
  const payeeName = emv?.payeeName ?? null;
  const here = location(input);

  const out = (status: Verdict["status"], reason: Reason, extra: Partial<Verdict> = {}): Verdict => ({
    status,
    reason,
    notes: [],
    payeeName,
    qrHash: hash,
    stall: null,
    nearby: [],
    reportTx: null,
    ...extra,
    message: message(reason, lang, { stall: extra.stall?.name, payee: payeeName }),
  });

  if (await reader.blacklisted(hash)) return out("red", "blacklisted");
  if (emv?.isDynamic) return out("amber", "dynamic_qr");

  const id = await reader.stallByQr(hash);
  if (id) {
    const s = await reader.getStall(id);
    if (here && haversineM(here, pos(s)) > ELSEWHERE_RADIUS_M) return out("amber", "registered_elsewhere", { stall: summary(s) });
    return out("green", "match", { stall: summary(s), notes: here ? [] : ["location_not_checked"] });
  }

  if (here) {
    const nearby = (await reader.listStalls())
      .filter((s) => s.active)
      .map((s) => ({ s, d: haversineM(here, pos(s)) }))
      .filter((x) => x.d <= MISMATCH_RADIUS_M)
      .sort((a, b) => a.d - b.d);
    if (nearby.length) {
      return out("amber", "qr_mismatch", {
        stall: summary(nearby[0].s),
        nearby: nearby.map(({ s, d }) => ({ id: s.id, name: s.name, photoURI: s.photoURI, distanceM: Math.round(d) })),
      });
    }
  }
  return out("amber", "unregistered");
}

/** One provider per RPC URL (BSC testnet, 8 s timeout so a dead RPC fails over quickly). */
export function rpcProviders(urls: string[]): JsonRpcProvider[] {
  if (!urls.length) throw new Error("no RPC URLs");
  return urls.map((u) => {
    const req = new FetchRequest(u);
    req.timeout = 8_000;
    return new JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true });
  });
}

/** Runs fn against each item in order until one succeeds; throws the last error. */
export async function firstOk<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R> {
  let err: unknown;
  for (const it of items) {
    try {
      return await fn(it);
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

/** Read-only Reader over QRRegistry, trying each RPC URL in order per call.
 *  listStalls() is cached 15 s and scans logs incrementally in ≤ 5,000-block chunks. */
export function chainReader(rpcUrls: string[]): Reader {
  const providers = rpcProviders(rpcUrls);
  const contracts = providers.map((p) => new Contract(REGISTRY_ADDRESS, abi, p));
  const call = <R>(fn: (c: Contract) => Promise<R>) => firstOk(contracts, fn);
  const getStall = async (id: number): Promise<Stall> => {
    const s = await call((c) => c.getStall(id));
    return {
      id,
      registrar: s.registrar,
      qrHash: s.qrHash,
      name: s.name,
      latE6: Number(s.latE6),
      lngE6: Number(s.lngE6),
      photoURI: s.photoURI,
      lang: s.lang,
      registeredAt: Number(s.registeredAt),
      active: s.active,
    };
  };
  const ids = new Set<number>();
  let scanned = DEPLOY_BLOCK - 1;
  let cache: { at: number; stalls: Stall[] } | null = null;

  return {
    blacklisted: (h) => call((c) => c.blacklisted(h)),
    stallByQr: async (h) => Number(await call((c) => c.stallByQr(h))),
    getStall,
    async listStalls() {
      if (cache && Date.now() - cache.at < 15_000) return cache.stalls;
      const latest = await firstOk(providers, (p) => p.getBlockNumber());
      for (let from = scanned + 1; from <= latest; from += 5_000) {
        const to = Math.min(from + 4_999, latest);
        const logs = await call((c) => c.queryFilter(c.filters.StallRegistered(), from, to));
        for (const l of logs) ids.add(Number((l as EventLog).args.id));
        scanned = to;
      }
      const stalls = (await Promise.all([...ids].map(getStall))).filter((s) => s.active);
      cache = { at: Date.now(), stalls };
      return stalls;
    },
  };
}
