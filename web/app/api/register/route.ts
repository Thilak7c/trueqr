import { put } from "@vercel/blob";
import { parseEmv, qrHash } from "@trueqr/core";
import { authed, reader, relayerSend, unauthorized } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // waits for the register tx to mine to learn the stall id

const LANGS = ["ms", "ta", "en"];
const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // Vercel functions cap request bodies at 4.5 MB; the client downsizes first

const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** multipart { qrPayload, name, lat, lng, lang, photo?, dryRun? }. dryRun=1 only checks the QR (used right after scanning). */
export async function POST(req: Request) {
  if (!authed(req)) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("expected multipart form data");
  }

  // Raw QR text stays in this scope: hashed, never logged or stored.
  const qrPayload = form.get("qrPayload");
  if (typeof qrPayload !== "string" || !qrPayload.trim() || qrPayload.length > 1024) return bad("QR text missing");
  const emv = parseEmv(qrPayload.trim());
  if (!emv) return bad("This isn't a DuitNow QR TrueQR can read.");
  if (emv.isDynamic) return bad("This is a one-time (dynamic) QR. Register the stall's printed QR instead.");
  const hash = qrHash(qrPayload);

  try {
    if (await reader.blacklisted(hash)) return bad("This QR was reported as a scam and can't be registered.", 409);
    if (await reader.stallByQr(hash)) return bad("This QR is already registered.", 409);
  } catch (e) {
    console.error("register precheck failed", String(e));
    return bad("chain read failed, try again", 502);
  }
  if (form.get("dryRun") === "1") return Response.json({ payeeName: emv.payeeName ?? null });

  const name = String(form.get("name") ?? "").trim();
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  const lang = String(form.get("lang") ?? "");
  if (!name || name.length > 40) return bad("Stall name must be 1–40 characters.");
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return bad("Invalid location.");
  if (!LANGS.includes(lang)) return bad("Invalid language.");

  // Photo is optional and never blocks registration: on any upload problem, photoURI = "" (initials avatar).
  let photoURI = "";
  let photoError: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!photo.type.startsWith("image/") || photo.size > MAX_PHOTO_BYTES) {
      photoError = "Photo must be an image under 4 MB.";
    } else {
      try {
        const blob = await put(`stalls/${hash.slice(2, 14)}.jpg`, photo, {
          access: "public",
          addRandomSuffix: true,
          contentType: photo.type,
        });
        photoURI = blob.url;
      } catch (e) {
        console.error("photo upload failed", String(e));
        photoError = "Photo upload failed; registered without a photo.";
      }
    }
  }

  try {
    const tx = await relayerSend((r) =>
      r.registerStall(hash, name, Math.round(lat * 1e6), Math.round(lng * 1e6), photoURI, lang),
    );
    const receipt = await tx.wait(1, 45_000);
    const log = receipt?.logs.find((l) => "eventName" in l && l.eventName === "StallRegistered");
    const stallId = log && "args" in log ? Number(log.args.id) : null;
    if (stallId == null) return bad(`Registered, but couldn't read the stall id. Tx ${tx.hash}`, 502);
    const bot = (process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
    return Response.json({ stallId, txHash: tx.hash, telegramLink: `https://t.me/${bot}?start=s${stallId}`, photoURI, photoError });
  } catch (e) {
    console.error("registerStall failed", String(e));
    return bad("Registration transaction failed. Try again.", 502);
  }
}
