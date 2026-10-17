"use client";

import { useState } from "react";
import Scanner from "../Scanner";

const btn = "flex h-14 w-full items-center justify-center rounded-2xl text-lg font-semibold disabled:opacity-40";
const input = "h-14 w-full rounded-2xl border border-ink/15 bg-card px-4 text-lg";
const VENUE = { lat: Number(process.env.NEXT_PUBLIC_VENUE_LAT), lng: Number(process.env.NEXT_PUBLIC_VENUE_LNG) };
const hasVenue = Number.isFinite(VENUE.lat) && Number.isFinite(VENUE.lng);
const MAX_ACCURACY_M = 500;
const LANGS = [
  { v: "ms", label: "Bahasa Melayu" },
  { v: "ta", label: "தமிழ்" },
  { v: "en", label: "English" },
];

type Done = { stallId: number; txHash: string; telegramLink: string; photoError: string | null; qrDataUrl: string };

/** Phone photos are often 3–8 MB; Vercel caps request bodies at 4.5 MB, so shrink to ≤ 1024 px JPEG first. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.8));
}

export default function Register({ token }: { token: string }) {
  const [scanning, setScanning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [qr, setQr] = useState<{ text: string; payee: string | null } | null>(null);
  const [name, setName] = useState("");
  const [lang, setLang] = useState("ms");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [locMode, setLocMode] = useState<"venue" | "mine">(hasVenue ? "venue" : "mine");
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ msg: string; retry?: () => void } | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const api = async (form: FormData) => {
    const res = await fetch("/api/register", { method: "POST", headers: { "x-demo-token": token }, body: form });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  };

  const onScanned = async (text: string) => {
    setScanning(false);
    setError(null);
    setChecking(true);
    try {
      const f = new FormData();
      f.set("qrPayload", text);
      f.set("dryRun", "1");
      const { payeeName } = await api(f);
      setQr({ text, payee: payeeName });
    } catch (e) {
      setQr(null);
      setError({ msg: (e as Error).message, retry: () => onScanned(text) });
    } finally {
      setChecking(false);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    setPhotoNote(null);
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    if (!file) return;
    try {
      const blob = await shrink(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      if (file.size <= 4 * 1024 * 1024) setPhoto({ blob: file, url: URL.createObjectURL(file) });
      else setPhotoNote("Couldn't process this photo. You can register without one.");
    }
  };

  const useMyLocation = () => {
    setLocMode("mine");
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setLocating(false);
        setMyLoc({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
      },
      () => {
        setLocating(false);
        setMyLoc(null);
        setError({ msg: "Couldn't get your location. Use the venue location instead." });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  const loc = locMode === "venue" ? VENUE : myLoc && myLoc.acc <= MAX_ACCURACY_M ? myLoc : null;
  const canSubmit = !!qr && !!name.trim() && !!loc && !submitting;

  const submit = async () => {
    if (!qr || !loc) return;
    setError(null);
    setSubmitting(true);
    try {
      const f = new FormData();
      f.set("qrPayload", qr.text);
      f.set("name", name.trim());
      f.set("lang", lang);
      f.set("lat", String(loc.lat));
      f.set("lng", String(loc.lng));
      if (photo) f.set("photo", photo.blob, "stall.jpg");
      const r = await api(f);
      const QRCode = (await import("qrcode")).default;
      const qrDataUrl = await QRCode.toDataURL(r.telegramLink, { width: 320, margin: 1 });
      setDone({ ...r, qrDataUrl });
    } catch (e) {
      setError({ msg: (e as Error).message, retry: submit });
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setDone(null);
    setQr(null);
    setName("");
    setPhoto(null);
    setPhotoNote(null);
  };

  if (scanning) {
    return (
      <main className="flex min-h-dvh flex-col">
        <Scanner onResult={onScanned} onCancel={() => setScanning(false)} onError={(msg) => setError({ msg })} />
      </main>
    );
  }

  if (done) {
    return (
      <main className="flex min-h-dvh flex-col items-center gap-4 p-6 text-center">
        <h1 className="mt-6 text-[28px] font-bold">Stall registered ✅</h1>
        <a
          className="text-pay underline"
          href={`https://testnet.bscscan.com/tx/${done.txHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View on BscScan ↗
        </a>
        {done.photoError && <p className="text-warn">{done.photoError}</p>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={done.qrDataUrl} alt="Telegram alerts QR code" className="w-full max-w-[320px] rounded-2xl bg-white p-2 shadow" />
        <p className="text-xl font-semibold">Ask the family to scan this and tap Start.</p>
        <p className="break-all text-sm text-muted">{done.telegramLink}</p>
        <button className={`${btn} mt-auto border-2 border-ink/15 bg-card`} onClick={reset}>
          Register another stall
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col gap-6 p-6">
      <h1 className="text-[28px] font-bold">Register a stall</h1>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl bg-bad p-4 text-white">
          <span className="flex-1">{error.msg}</span>
          {error.retry && (
            <button className="rounded-xl bg-white/20 px-4 py-2 font-semibold" onClick={error.retry}>
              Retry
            </button>
          )}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-muted">1. The stall&apos;s QR</h2>
        {checking ? (
          <p className="text-lg">Checking QR…</p>
        ) : qr ? (
          <div className="rounded-2xl bg-card p-4 shadow-sm">
            <p className="text-muted">This QR pays:</p>
            <p className="text-xl font-bold">{qr.payee ?? "an unknown account"}</p>
          </div>
        ) : null}
        <button className={`${btn} ${qr ? "border-2 border-ink/15 bg-card" : "bg-pay text-white"}`} onClick={() => setScanning(true)}>
          {qr ? "Scan a different QR" : "Scan QR"}
        </button>
      </section>

      <section className={`flex flex-col gap-4 ${qr ? "" : "pointer-events-none opacity-40"}`} aria-disabled={!qr}>
        <h2 className="font-semibold text-muted">2. Stall details</h2>
        <label className="flex flex-col gap-1">
          <span>Stall name</span>
          <input className={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Siti Nasi Lemak" />
        </label>

        <label className="flex flex-col gap-2">
          <span>Photo (optional)</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => onPhoto(e.target.files?.[0])}
            className="text-base"
          />
        </label>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt="Stall photo preview" className="h-[120px] w-[120px] rounded-full object-cover shadow" />
        )}
        {photoNote && <p className="text-warn">{photoNote}</p>}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1">Language for alerts</legend>
          {LANGS.map((l) => (
            <label key={l.v} className="flex items-center gap-3 text-lg">
              <input type="radio" name="lang" value={l.v} checked={lang === l.v} onChange={() => setLang(l.v)} className="h-5 w-5" />
              {l.label}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1">Location</legend>
          {hasVenue && (
            <label className="flex items-center gap-3 text-lg">
              <input type="radio" name="loc" checked={locMode === "venue"} onChange={() => setLocMode("venue")} className="h-5 w-5" />
              Use venue location
            </label>
          )}
          <label className="flex items-center gap-3 text-lg">
            <input type="radio" name="loc" checked={locMode === "mine"} onChange={useMyLocation} className="h-5 w-5" />
            Use my location
          </label>
          {locMode === "mine" && (
            <p className="text-sm text-muted">
              {locating
                ? "Getting location…"
                : myLoc
                  ? myLoc.acc > MAX_ACCURACY_M
                    ? `GPS too inaccurate here (±${Math.round(myLoc.acc)} m). Use the venue location.`
                    : `${myLoc.lat.toFixed(6)}, ${myLoc.lng.toFixed(6)} (±${Math.round(myLoc.acc)} m)`
                  : "No location yet."}
            </p>
          )}
        </fieldset>
      </section>

      <button className={`${btn} mt-2 bg-pay text-white`} disabled={!canSubmit} onClick={submit}>
        {submitting ? "Registering… (≈10 s)" : "Register"}
      </button>
    </main>
  );
}
