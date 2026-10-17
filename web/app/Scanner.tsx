"use client";

import { useEffect, useRef, useState } from "react";

const btn = "flex h-14 w-full items-center justify-center rounded-2xl text-lg font-semibold disabled:opacity-40";

/** Full-screen html5-qrcode camera scanner with a "Paste QR text" fallback (dev + demo backup). */
export default function Scanner({
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
