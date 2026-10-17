export type Emv = { tags: Record<string, string>; payeeName?: string; isDynamic: boolean };

/** Parses top-level EMV QR TLVs (2-digit tag, 2-digit length). Returns null on any malformed input. */
export function parseEmv(text: string): Emv | null {
  if (typeof text !== "string" || !text) return null;
  const tags: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    const head = text.slice(i, i + 4);
    if (!/^\d{4}$/.test(head)) return null;
    const len = Number(head.slice(2));
    if (len === 0 || i + 4 + len > text.length) return null;
    tags[head.slice(0, 2)] = text.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  // Tag 00 must exist, but don't pin its value: real DuitNow QRs carry "02", not EMVCo's "01".
  if (!("00" in tags)) return null;
  return { tags, payeeName: tags["59"], isDynamic: tags["01"] === "12" };
}
