import { describe, expect, it } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import { haversineM, message, parseEmv, qrHash, verify, type Reader, type Stall } from "../src/index";

// Synthetic DuitNow-shaped QRs (fake payee, same structure as real TnG / GX samples).
const tlv = (tag: string, v: string) => tag + String(v.length).padStart(2, "0") + v;
const qr = (pim: "11" | "12", payee?: string, pfi = "02") =>
  tlv("00", pfi) +
  tlv("01", pim) +
  tlv("26", tlv("00", "A0000006150001") + tlv("01", "890053") + tlv("02", "000000000001")) +
  tlv("52", "5812") +
  tlv("53", "458") +
  tlv("58", "MY") +
  (payee ? tlv("59", payee) : "") +
  tlv("60", "KUALA LUMPUR") +
  tlv("64", tlv("00", "EN") + tlv("01", "Ali bin Abu")) +
  tlv("63", "ABCD");

const STALL_QR = qr("11", "MAK CIK NASI LEMAK");
const SCAM_QR = qr("11", "ALI BIN ABU");

// ~111 m per 0.001° latitude
const VENUE = { lat: 3.139, lng: 101.6869 };
const at = (dLatDeg: number) => ({ lat: VENUE.lat + dLatDeg, lng: VENUE.lng });

const stall = (id: number, hash: string, name: string, dLatDeg = 0, active = true): Stall => ({
  id,
  registrar: "0x0000000000000000000000000000000000000001",
  qrHash: hash,
  name,
  latE6: Math.round(at(dLatDeg).lat * 1e6),
  lngE6: Math.round(VENUE.lng * 1e6),
  photoURI: `https://x/${id}.jpg`,
  lang: "ms",
  registeredAt: 1_700_000_000,
  active,
});

function fakeReader(stalls: Stall[], blacklist: string[] = []): Reader {
  return {
    blacklisted: async (h) => blacklist.includes(h),
    stallByQr: async (h) => stalls.find((s) => s.active && s.qrHash === h)?.id ?? 0,
    getStall: async (id) => stalls.find((s) => s.id === id)!,
    listStalls: async () => stalls.filter((s) => s.active),
  };
}

describe("parseEmv", () => {
  it("parses a static QR", () => {
    const e = parseEmv(STALL_QR)!;
    expect(e.isDynamic).toBe(false);
    expect(e.payeeName).toBe("MAK CIK NASI LEMAK");
    expect(e.tags["60"]).toBe("KUALA LUMPUR");
    expect(e.tags["26"]).toContain("A0000006150001");
  });
  it("accepts payload format 02 (real DuitNow) and 01 (EMVCo)", () => {
    expect(STALL_QR.startsWith("000202")).toBe(true);
    expect(parseEmv(qr("11", "X", "01"))!.payeeName).toBe("X");
  });
  it("flags dynamic (01=12)", () => expect(parseEmv(qr("12", "X"))!.isDynamic).toBe(true));
  it("payeeName undefined when tag 59 missing", () => expect(parseEmv(qr("11"))!.payeeName).toBeUndefined());
  it("returns null on garbage", () => {
    for (const bad of ["", "hello", "https://example.com", "000201" + "59", "0002010111", "00020101021159XXAB", "0102115902AB"])
      expect(parseEmv(bad)).toBeNull();
  });
  it("returns null when a length overruns", () => expect(parseEmv("0002015920SHORT")).toBeNull());
});

describe("qrHash", () => {
  it("is keccak256 of trimmed utf8", () => {
    expect(qrHash(`  ${STALL_QR}\n`)).toBe(keccak256(toUtf8Bytes(STALL_QR)));
    expect(qrHash(STALL_QR)).not.toBe(qrHash(SCAM_QR));
  });
});

describe("haversineM", () => {
  it("0 for same point", () => expect(haversineM(VENUE, VENUE)).toBe(0));
  it("~111 m per 0.001° lat", () => expect(haversineM(VENUE, at(0.001))).toBeCloseTo(111.2, 0));
  it("KL → Penang ≈ 290 km", () => {
    const d = haversineM(VENUE, { lat: 5.4164, lng: 100.3327 });
    expect(d).toBeGreaterThan(285_000);
    expect(d).toBeLessThan(295_000);
  });
});

describe("message", () => {
  it("fills stall + payee (EN/MS)", () => {
    expect(message("qr_mismatch", "en", { stall: "Mak Cik", payee: "ALI" })).toBe("This QR doesn't pay Mak Cik. It pays ALI. Don't pay.");
    expect(message("match", "ms", { stall: "Mak Cik" })).toBe("Ini Mak Cik.");
  });
  it("unknown payee fallback", () => {
    expect(message("unregistered", "en", { payee: null })).toBe("Not registered with TrueQR. It pays an unknown account.");
    expect(message("unregistered", "ms", {})).toBe("Tidak berdaftar dengan TrueQR. Ia bayar kepada akaun yang tidak diketahui.");
  });
  it("Tamil falls back to EN", () => expect(message("blacklisted", "ta", {})).toBe("Reported scam QR. Do not pay."));
});

describe("verify — §6 table", () => {
  const S1 = stall(1, qrHash(STALL_QR), "Mak Cik Nasi Lemak");

  it("row 1: blacklisted → red (beats registered + dynamic)", async () => {
    const v = await verify({ qrPayload: STALL_QR, ...VENUE }, fakeReader([S1], [qrHash(STALL_QR)]));
    expect([v.status, v.reason]).toEqual(["red", "blacklisted"]);
    const d = qr("12", "X");
    expect((await verify({ qrPayload: d }, fakeReader([], [qrHash(d)]))).reason).toBe("blacklisted");
  });

  it("row 2: dynamic → amber dynamic_qr (beats registered)", async () => {
    const d = qr("12", "MAK CIK NASI LEMAK");
    const v = await verify({ qrPayload: d, ...VENUE }, fakeReader([stall(1, qrHash(d), "Mak Cik")]));
    expect([v.status, v.reason]).toEqual(["amber", "dynamic_qr"]);
  });

  it("row 3: registered, > 1,000 m away → amber registered_elsewhere + distance note", async () => {
    const v = await verify({ qrPayload: STALL_QR, ...at(0.01) }, fakeReader([S1])); // ~1,112 m
    expect([v.status, v.reason, v.notes]).toEqual(["amber", "registered_elsewhere", ["distance_m:1112"]]);
    expect(v.stall?.name).toBe("Mak Cik Nasi Lemak");
    expect(v.message).toBe("This QR belongs to Mak Cik Nasi Lemak at another location.");
  });

  it("row 4: registered, ~890 m away (indoor GPS drift) → still green", async () => {
    const v = await verify({ qrPayload: STALL_QR, ...at(0.008) }, fakeReader([S1]));
    expect([v.status, v.reason, v.notes]).toEqual(["green", "match", ["distance_m:890"]]);
  });

  it("row 4: registered, nearby → green match + distance note + stall coords", async () => {
    const v = await verify({ qrPayload: STALL_QR, ...at(0.002) }, fakeReader([S1])); // ~222 m
    expect([v.status, v.reason]).toEqual(["green", "match"]);
    expect(v.notes).toEqual(["distance_m:222"]);
    expect(v.stall).toEqual({
      id: 1,
      name: "Mak Cik Nasi Lemak",
      photoURI: "https://x/1.jpg",
      registeredAt: 1_700_000_000,
      lat: 3.139,
      lng: 101.6869,
    });
    expect(v.payeeName).toBe("MAK CIK NASI LEMAK");
    expect(v.message).toBe("This is Mak Cik Nasi Lemak.");
  });

  it("row 4: registered, no location → green + location_not_checked", async () => {
    const v = await verify({ qrPayload: STALL_QR }, fakeReader([S1]));
    expect([v.status, v.reason, v.notes]).toEqual(["green", "match", ["location_not_checked"]]);
  });

  it("row 5: unregistered, active stalls ≤ 300 m → amber qr_mismatch, nearest first", async () => {
    const far = stall(2, "0x02", "Far Stall", 0.0025); // ~278 m
    const near = stall(3, "0x03", "Near Stall", 0.0002); // ~22 m
    const out = stall(4, "0x04", "Outside", 0.004); // ~445 m
    const dead = stall(5, "0x05", "Inactive", 0, false);
    const v = await verify({ qrPayload: SCAM_QR, ...VENUE }, fakeReader([far, near, out, dead]));
    expect([v.status, v.reason]).toEqual(["amber", "qr_mismatch"]);
    expect(v.nearby.map((n) => n.id)).toEqual([3, 2]);
    expect(v.nearby[0].distanceM).toBe(22);
    expect(v.stall?.id).toBe(3);
    expect(v.payeeName).toBe("ALI BIN ABU");
    expect(v.message).toBe("This QR doesn't pay Near Stall. It pays ALI BIN ABU. Don't pay.");
  });

  it("row 5 (MS message)", async () => {
    const v = await verify({ qrPayload: SCAM_QR, ...VENUE }, fakeReader([S1]), "ms");
    expect(v.message).toBe("QR ini bukan milik Mak Cik Nasi Lemak. Ia bayar kepada ALI BIN ABU. Jangan bayar.");
  });

  it("row 6: unregistered, no stall ≤ 300 m → amber unregistered", async () => {
    const v = await verify({ qrPayload: SCAM_QR, ...at(0.004) }, fakeReader([S1])); // ~445 m
    expect([v.status, v.reason, v.nearby]).toEqual(["amber", "unregistered", []]);
    expect(v.message).toBe("Not registered with TrueQR. It pays ALI BIN ABU.");
  });

  it("row 6: unregistered, no location → unregistered (never mismatch)", async () => {
    const v = await verify({ qrPayload: SCAM_QR }, fakeReader([S1]));
    expect([v.reason, v.notes]).toEqual(["unregistered", ["location_not_checked"]]);
  });

  it("row 6: non-EMV text → unregistered with unknown payee", async () => {
    const v = await verify({ qrPayload: "https://example.com" }, fakeReader([]));
    expect([v.reason, v.payeeName]).toEqual(["unregistered", null]);
    expect(v.message).toContain("an unknown account");
  });

  it("invalid lat/lng treated as no location", async () => {
    const v = await verify({ qrPayload: STALL_QR, lat: NaN, lng: 999 }, fakeReader([S1]));
    expect(v.notes).toEqual(["location_not_checked"]);
  });

  it("always returns reportTx null and a hash, never the raw QR", async () => {
    const v = await verify({ qrPayload: SCAM_QR }, fakeReader([]));
    expect(v.reportTx).toBeNull();
    expect(v.qrHash).toBe(qrHash(SCAM_QR));
    expect(JSON.stringify(v)).not.toContain(SCAM_QR);
  });

  it("rejects empty payload", async () => {
    await expect(verify({ qrPayload: "  " }, fakeReader([]))).rejects.toThrow();
  });
});
