export type Reason = "match" | "qr_mismatch" | "blacklisted" | "registered_elsewhere" | "unregistered" | "dynamic_qr";

const TEXT: Record<"en" | "ms", Record<Reason, string> & { unknown: string }> = {
  en: {
    match: "This is {stall}.",
    qr_mismatch: "This QR doesn't pay {stall}. It pays {payee}. Don't pay.",
    blacklisted: "Reported scam QR. Do not pay.",
    registered_elsewhere: "This QR belongs to {stall} at another location.",
    unregistered: "Not registered with TrueQR. It pays {payee}.",
    dynamic_qr: "TrueQR can't check this type of QR.",
    unknown: "an unknown account",
  },
  ms: {
    match: "Ini {stall}.",
    qr_mismatch: "QR ini bukan milik {stall}. Ia bayar kepada {payee}. Jangan bayar.",
    blacklisted: "QR penipuan yang dilaporkan. Jangan bayar.",
    registered_elsewhere: "QR ini milik {stall} di lokasi lain.",
    unregistered: "Tidak berdaftar dengan TrueQR. Ia bayar kepada {payee}.",
    dynamic_qr: "TrueQR tidak dapat menyemak QR jenis ini.",
    unknown: "akaun yang tidak diketahui",
  },
};

/** EN + MS; any other language (incl. Tamil) falls back to EN. */
export function message(reason: Reason, lang: string, v: { stall?: string | null; payee?: string | null }): string {
  const t = lang === "ms" ? TEXT.ms : TEXT.en;
  return t[reason].replace("{stall}", v.stall ?? "").replace("{payee}", v.payee || t.unknown);
}
