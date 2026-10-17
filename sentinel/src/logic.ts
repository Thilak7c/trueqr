// Pure Sentinel rules (no I/O), unit-tested in logic.test.ts.

export const AUTO_BLACKLIST_REPORTS = 3;
export const AUTO_BLACKLIST_WINDOW_MS = 60 * 60_000;

export const reportKey = (stallId: number, qrHash: string) => `${stallId}:${qrHash.toLowerCase()}`;

// Telegram caps callback_data at 64 bytes, so buttons carry a 16-hex hash prefix;
// the full hash is looked up among this stall's alerted keys.
export const callbackData = (action: "bl" | "ok", stallId: number, qrHash: string) =>
  `${action}:${stallId}:${qrHash.toLowerCase().slice(2, 18)}`;

export function parseCallback(data: string | undefined): { action: "bl" | "ok"; stallId: number; prefix: string } | null {
  const m = /^(bl|ok):(\d{1,9}):([0-9a-f]{16})$/.exec(data ?? "");
  return m ? { action: m[1] as "bl" | "ok", stallId: Number(m[2]), prefix: m[3] } : null;
}

/** Full report key for a callback, from the keys we sent alerts for. */
export function findAlertKey(keys: string[], stallId: number, prefix: string): string | undefined {
  return keys.find((k) => k.startsWith(`${stallId}:0x${prefix}`));
}

/** "/start s12" (optionally "/start@bot s12") → 12. */
export function parseStart(text: string | undefined): number | null {
  const m = /^\/start(?:@\w+)?\s+s(\d{1,9})$/.exec((text ?? "").trim());
  return m ? Number(m[1]) : null;
}

export function alertText(lang: string, stall: string): string {
  return lang === "ms"
    ? `⚠️ QR yang bukan milik anda baru diimbas di ${stall}. Sila periksa jika ada pelekat ditampal di atas QR anda.`
    : `⚠️ A QR that isn't yours was just scanned at ${stall}. Please check for a sticker pasted over your QR.`; // EN; Tamil uses EN
}

export const recentReports = (times: number[], now: number) => times.filter((t) => now - t < AUTO_BLACKLIST_WINDOW_MS);
