"use client";

import { useEffect, useRef, useState } from "react";
import type { Verdict } from "@trueqr/core";

type Loc = { lat: number; lng: number; acc: number } | null;
type Screen =
  | { k: "home" }
  | { k: "scan" }
  | { k: "checking" }
  | { k: "result"; v: Verdict; here: Loc }
  | { k: "paid"; amount: number; to: string };

const btn = "flex h-14 w-full items-center justify-center rounded-2xl text-lg font-semibold disabled:opacity-40";
const rm = (n: number) => `RM ${n.toFixed(2)}`;
const MAX_ACCURACY_M = 500; // worse than this (e.g. indoor Wi-Fi fix ±2000 m) is treated as no location
const VENUE = { lat: Number(process.env.NEXT_PUBLIC_VENUE_LAT), lng: Number(process.env.NEXT_PUBLIC_VENUE_LNG) };
const hasVenue = Number.isFinite(VENUE.lat) && Number.isFinite(VENUE.lng);

function VenueBadge() {
  return (
    <span className="rounded-full bg-warn/15 px-3 py-1 text-sm font-semibold text-warn">📍 Demo: venue location</span>
  );
}

export default function Wallet({ token }: { token: string }) {
  const [screen, setScreen] = useState<Screen>({ k: "home" });
  const [balance, setBalance] = useState(120);
  const [error, setError] = useState<{ msg: string; retry: () => void } | null>(null);
  const loc = useRef<Promise<Loc> | null>(null);
  const [debug, setDebug] = useState(false);
  const [venue, setVenue] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setDebug(q.get("debug") === "1");
    setVenue(q.get("venue") === "1" && hasVenue);
  }, []);

  // Fresh fix per scan (the browser only prompts for permission once). Resolves null on deny/timeout so scanning never blocks.
  // ?venue=1 skips GPS and uses the venue coordinates (shown with a badge).
  const askLocation = () => {
    if (venue) {
      loc.current = Promise.resolve({ ...VENUE, acc: 0 });
      return;
    }
    loc.current = new Promise<Loc>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    });
  };

  const check = async (qrPayload: string) => {
    setError(null);
    setScreen({ k: "checking" });
    try {
      const here = await (loc.current ?? Promise.resolve(null));
      const usable = here && here.acc <= MAX_ACCURACY_M ? here : null;
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json", "x-demo-token": token },
        body: JSON.stringify({ qrPayload, lat: usable?.lat, lng: usable?.lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setScreen({ k: "result", v: data, here });
    } catch (e) {
      setScreen({ k: "home" });
      setError({ msg: `Couldn't check this QR: ${(e as Error).message}`, retry: () => check(qrPayload) });
    }
  };

  const startScan = () => {
    setError(null);
    askLocation();
    setScreen({ k: "scan" });
  };

  const pay = (amount: number, to: string) => {
    setBalance((b) => Math.round((b - amount) * 100) / 100);
    setScreen({ k: "paid", amount, to });
  };

  return (
    <main className="flex min-h-dvh flex-col">
      {error && (
        <div role="alert" className="m-4 flex items-center gap-3 rounded-2xl bg-bad p-4 text-white">
          <span className="flex-1">{error.msg}</span>
          <button className="rounded-xl bg-white/20 px-4 py-2 font-semibold" onClick={error.retry}>
            Retry
          </button>
        </div>
      )}
      {screen.k === "home" && <Home balance={balance} venue={venue} onScan={startScan} />}
      {screen.k === "scan" && (
        <Scanner
          onResult={check}
          onCancel={() => setScreen({ k: "home" })}
          onError={(msg) => setError({ msg, retry: startScan })}
        />
      )}
      {screen.k === "checking" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4" aria-live="polite">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-pay/20 border-t-pay" />
          <p className="text-xl font-semibold">Checking…</p>
        </div>
      )}
      {screen.k === "result" && (
        <Result
          v={screen.v}
          here={screen.here}
          debug={debug}
          venue={venue}
          balance={balance}
          onPay={pay}
          onAgain={startScan}
        />
      )}
      {screen.k === "paid" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-ok text-6xl text-white" aria-hidden>
            ✓
          </div>
          <h1 className="text-[28px] font-bold">
            {rm(screen.amount)} paid to {screen.to}
          </h1>
          <p className="text-muted">Demo — in a real wallet the payment happens here.</p>
          <button className={`${btn} mt-6 bg-pay text-white`} onClick={() => setScreen({ k: "home" })}>
            Done
          </button>
        </div>
      )}
    </main>
  );
}

function Home({ balance, venue, onScan }: { balance: number; venue: boolean; onScan: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-between p-6">
      <div className="w-full">
        <p className="text-2xl font-bold text-pay">DemoPay</p>
        <div className="mt-6 rounded-2xl bg-pay p-6 text-white">
          <p className="text-white/80">Balance</p>
          <p className="text-[32px] font-bold">{rm(balance)}</p>
        </div>
      </div>
      <button
        onClick={onScan}
        className="flex h-44 w-44 flex-col items-center justify-center rounded-full bg-pay text-2xl font-bold text-white shadow-xl active:scale-95"
      >
        <span className="text-5xl" aria-hidden>
          ⌗
        </span>
        Scan
      </button>
      <div className="flex flex-col items-center gap-2">
        {venue && <VenueBadge />}
        <p className="rounded-full bg-ok/10 px-4 py-2 text-base font-semibold text-ok">🛡️ Protected by TrueQR</p>
      </div>
    </div>
  );
}

function Scanner({
  onResult,
  onCancel,
  onError,
}: {
  onResult: (text: string) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const done = useRef(false);
  // Latest callbacks in a ref so parent re-renders don't restart the camera.
  const cb = useRef({ onResult, onError });
  cb.current = { onResult, onError };

  useEffect(() => {
    if (paste) return;
    let cancelled = false;
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    const stop = () => {
      if (scanner?.isScanning) scanner.stop().catch(() => {});
    };
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled) return;
      scanner = new Html5Qrcode("reader", false);
      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          (decoded) => {
            if (done.current) return;
            done.current = true;
            stop();
            cb.current.onResult(decoded);
          },
          () => {},
        );
        if (cancelled) stop(); // unmounted while the camera was starting
      } catch (e) {
        if (!cancelled) {
          setPaste(true);
          cb.current.onError(`Camera unavailable (${String(e).slice(0, 80)}). Paste the QR text instead.`);
        }
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [paste]);

  return (
    <div className="flex flex-1 flex-col bg-ink text-white">
      <div className="flex items-center justify-between p-4">
        <button onClick={onCancel} className="rounded-xl px-3 py-2 font-semibold">
          ✕ Cancel
        </button>
        <button onClick={() => setPaste((p) => !p)} className="text-sm underline">
          {paste ? "Use camera" : "Paste QR text"}
        </button>
      </div>
      {paste ? (
        <div className="flex flex-1 flex-col gap-4 bg-bg p-6 text-ink">
          <label htmlFor="qr" className="font-semibold">
            QR text
          </label>
          <textarea
            id="qr"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="rounded-2xl border border-ink/15 bg-card p-4 font-mono text-sm"
            placeholder="000201…"
          />
          <button className={`${btn} bg-pay text-white`} disabled={!text.trim()} onClick={() => onResult(text)}>
            Check
          </button>
        </div>
      ) : (
        <>
          <p className="p-4 text-center text-xl font-semibold">Point at the stall&apos;s QR</p>
          <div id="reader" className="w-full flex-1" />
        </>
      )}
    </div>
  );
}

function Avatar({ name, photoURI }: { name: string; photoURI?: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return photoURI ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoURI} alt={name} className="h-[120px] w-[120px] rounded-full border-4 border-white object-cover shadow" />
  ) : (
    <div
      className="flex h-[120px] w-[120px] items-center justify-center rounded-full border-4 border-white bg-pay/15 text-4xl font-bold text-pay shadow"
      aria-label={name}
    >
      {initials}
    </div>
  );
}

function DebugLine({ v, here }: { v: Verdict; here: Loc }) {
  const f = (n: number) => n.toFixed(6);
  const dist = v.notes.find((n) => n.startsWith("distance_m:"))?.split(":")[1] ?? v.nearby[0]?.distanceM ?? "–";
  return (
    <p className="break-all font-mono text-xs text-muted">
      debug · you{" "}
      {here
        ? `${f(here.lat)},${f(here.lng)} ±${Math.round(here.acc)}m${here.acc > MAX_ACCURACY_M ? " (ignored)" : ""}`
        : "no location"}{" "}
      · stall{" "}
      {v.stall ? `#${v.stall.id} ${f(v.stall.lat)},${f(v.stall.lng)}` : "–"} · d={dist}m · {v.reason}
    </p>
  );
}

function Result({
  v,
  here,
  debug,
  venue,
  balance,
  onPay,
  onAgain,
}: {
  v: Verdict;
  here: Loc;
  debug: boolean;
  venue: boolean;
  balance: number;
  onPay: (amount: number, to: string) => void;
  onAgain: () => void;
}) {
  const [amount, setAmount] = useState("5.00");
  const amt = Number(amount);
  const amountOk = Number.isFinite(amt) && amt > 0 && amt <= balance;
  const payee = v.payeeName ?? "an unknown account";
  const mismatch = v.reason === "qr_mismatch";

  const look =
    v.status === "green"
      ? { bg: "bg-ok", icon: "✅", title: "Safe to pay" }
      : v.status === "red"
        ? { bg: "bg-bad", icon: "⛔", title: "Do not pay" }
        : { bg: "bg-warn", icon: "⚠️", title: mismatch ? "Not this stall's QR" : "Check before paying" };

  const amountField = (
    <label className="block">
      <span className="text-muted">Amount (RM)</span>
      <input
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mt-1 h-14 w-full rounded-2xl border border-ink/15 px-4 text-xl font-semibold"
      />
    </label>
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className={`${look.bg} flex h-[45dvh] flex-col items-center justify-center gap-3 p-6 text-white`}>
        <span className="text-7xl" aria-hidden>
          {look.icon}
        </span>
        <h1 className="text-center text-[32px] font-bold leading-tight">{look.title}</h1>
        {venue && (
          <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">📍 Demo: venue location</span>
        )}
        {v.notes.includes("location_not_checked") && (
          <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">Location not checked</span>
        )}
      </div>
      <div className="-mt-6 flex flex-1 flex-col gap-4 rounded-t-3xl bg-card p-6">
        {v.status === "green" && v.stall && (
          <>
            <div className="-mt-20 flex flex-col items-center gap-2 text-center">
              <Avatar name={v.stall.name} photoURI={v.stall.photoURI} />
              <p className="text-2xl font-bold">{v.stall.name}</p>
              <p className="font-semibold text-ok">Registered on TrueQR</p>
            </div>
            {amountField}
            <button className={`${btn} bg-pay text-white`} disabled={!amountOk} onClick={() => onPay(amt, v.stall!.name)}>
              Pay {amountOk ? rm(amt) : ""}
            </button>
          </>
        )}

        {mismatch && v.stall && (
          <>
            <div className="-mt-20 flex flex-col items-center gap-2 text-center">
              <Avatar name={v.stall.name} photoURI={v.stall.photoURI} />
            </div>
            <p className="text-center text-xl">
              This QR doesn&apos;t pay <b>{v.stall.name}</b>. It pays <b>{payee}</b>.
            </p>
            {v.reportTx && (
              <a
                className="text-center text-sm text-muted underline"
                href={`https://testnet.bscscan.com/tx/${v.reportTx}`}
                target="_blank"
                rel="noreferrer"
              >
                Reported on-chain ↗
              </a>
            )}
            <button className={`${btn} bg-pay text-white`} disabled>
              Pay
            </button>
          </>
        )}

        {v.status === "amber" && !mismatch && (
          <>
            <p className="text-center text-xl">{v.message}</p>
            {amountField}
            <button
              className={`${btn} border-2 border-warn text-warn`}
              disabled={!amountOk}
              onClick={() => onPay(amt, v.stall?.name ?? payee)}
            >
              Pay anyway
            </button>
          </>
        )}

        {v.status === "red" && <p className="text-center text-xl">This QR was reported as a scam.</p>}

        <button className={`${btn} mt-auto bg-ink/5`} onClick={onAgain}>
          Scan again
        </button>
        {debug && <DebugLine v={v} here={here} />}
      </div>
    </div>
  );
}
