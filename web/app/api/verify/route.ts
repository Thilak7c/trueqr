import { verify } from "@trueqr/core";
import { authed, reader, relayerSend, unauthorized } from "@/lib/server";

export const dynamic = "force-dynamic";

// shortcut: per-instance memory, so the limit resets on cold start / differs across Vercel instances; fine for the demo.
const lastReport = new Map<string, number>();
const REPORT_EVERY_MS = 10 * 60_000;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function POST(req: Request) {
  if (!authed(req)) return unauthorized();

  let body: { qrPayload?: unknown; lat?: unknown; lng?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { qrPayload } = body;
  if (typeof qrPayload !== "string" || !qrPayload.trim() || qrPayload.length > 1024) {
    return Response.json({ error: "qrPayload must be a non-empty string ≤ 1024 chars" }, { status: 400 });
  }

  try {
    // Raw QR text stays in this scope: it's hashed inside verify() and never logged or stored.
    const v = await verify({ qrPayload, lat: num(body.lat), lng: num(body.lng) }, reader);

    if (v.reason === "qr_mismatch" && v.stall) {
      const key = `${v.stall.id}:${v.qrHash}`;
      const now = Date.now();
      if (now - (lastReport.get(key) ?? 0) > REPORT_EVERY_MS) {
        lastReport.set(key, now);
        try {
          v.reportTx = await relayerSend((r) => r.reportMismatch(v.stall!.id, v.qrHash));
        } catch (e) {
          lastReport.delete(key);
          console.error("reportMismatch failed", { stallId: v.stall.id, qrHash: v.qrHash, error: String(e) });
        }
      }
    }
    return Response.json(v);
  } catch (e) {
    console.error("verify failed", String(e));
    return Response.json({ error: "chain read failed, try again" }, { status: 502 });
  }
}
