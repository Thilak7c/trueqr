import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alertText,
  callbackData,
  findAlertKey,
  parseCallback,
  parseStart,
  recentReports,
  reportKey,
} from "./logic.js";

const H = "0x7AF6c8fdc353966da513cefe36efbaea291f9817788355b46a2a7c9c87832f69";

test("callback data fits Telegram's 64 bytes and round-trips to the full key", () => {
  const data = callbackData("bl", 123456789, H);
  assert.ok(Buffer.byteLength(data) <= 64);
  const p = parseCallback(data)!;
  assert.deepEqual(p, { action: "bl", stallId: 123456789, prefix: "7af6c8fdc353966d" });
  const keys = [reportKey(2, "0x" + "1".repeat(64)), reportKey(123456789, H)];
  assert.equal(findAlertKey(keys, p.stallId, p.prefix), reportKey(123456789, H));
  assert.equal(findAlertKey(keys, 7, p.prefix), undefined); // prefix must match the same stall
});

test("parseCallback rejects junk", () => {
  for (const bad of [undefined, "", "bl:2", "xx:2:7af6c8fdc353966d", "bl:2:7AF6C8FDC353966D", "bl:2:7af6c8fdc353966d1", "bl:-1:7af6c8fdc353966d"])
    assert.equal(parseCallback(bad), null);
});

test("parseStart", () => {
  assert.equal(parseStart("/start s2"), 2);
  assert.equal(parseStart("/start@trueqr_kl_bot s15"), 15);
  assert.equal(parseStart("/start"), null);
  assert.equal(parseStart("/start 2"), null);
  assert.equal(parseStart("hello"), null);
});

test("alert text by stall language (Tamil falls back to EN)", () => {
  assert.match(alertText("ms", "Siti"), /^⚠️ QR yang bukan milik anda baru diimbas di Siti\./);
  assert.match(alertText("en", "Siti"), /^⚠️ A QR that isn't yours was just scanned at Siti\./);
  assert.equal(alertText("ta", "Siti"), alertText("en", "Siti"));
});

test("backup rule counts only reports in the last hour", () => {
  const now = 10 * 3_600_000;
  assert.deepEqual(recentReports([now - 3_600_000, now - 3_599_000, now - 60_000, now], now), [now - 3_599_000, now - 60_000, now]);
});
