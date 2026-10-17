// TrueQR Sentinel (CLAUDE.md §8): watches MismatchReported, alerts the stall family on Telegram,
// and blacklists on "Not our QR" or ≥ 3 reports in 1 h with no owner reply. Only sees hashes, never raw QR text.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { Contract, EventLog, Wallet, ZeroAddress, formatEther } from "ethers";
import { REGISTRY_ADDRESS, abi, chainReader, firstOk, rpcProviders } from "@trueqr/core";
import {
  AUTO_BLACKLIST_REPORTS,
  alertText,
  callbackData,
  findAlertKey,
  parseCallback,
  parseStart,
  recentReports,
  reportKey,
} from "./logic.js";

const { RPC_URLS, SENTINEL_PRIVATE_KEY, TELEGRAM_BOT_TOKEN } = process.env;
if (!RPC_URLS || !SENTINEL_PRIVATE_KEY || !TELEGRAM_BOT_TOKEN) {
  console.error("Set RPC_URLS, SENTINEL_PRIVATE_KEY and TELEGRAM_BOT_TOKEN in sentinel/.env");
  process.exit(1);
}

const PORT = Number(process.env.SENTINEL_PORT ?? 8787);
const urls = RPC_URLS.split(",").map((s) => s.trim()).filter(Boolean);
const providers = rpcProviders(urls);
const wallet = new Wallet(SENTINEL_PRIVATE_KEY);
const registries = providers.map((p) => new Contract(REGISTRY_ADDRESS, abi, wallet.connect(p)));
const reader = chainReader(urls);

const safe = (e: unknown) => String(e instanceof Error ? e.message : e).split(TELEGRAM_BOT_TOKEN).join("***");
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const txLink = (tx: string) => `https://testnet.bscscan.com/tx/${tx}`;

// ── state ────────────────────────────────────────────────────────────────────
type Decision = { stallId: number; qrHash: string; action: "blacklisted" | "ignored"; by: "owner" | "auto"; tx: string | null; at: number };
type State = {
  lastBlock: number;
  offset: number; // Telegram getUpdates offset
  chats: Record<string, number>; // stallId → chatId
  alerted: Record<string, { at: number; chatId: number; messageId: number }>; // reportKey → alert message
  reports: Record<string, number[]>; // reportKey → detection times (ms)
  decisions: Decision[];
};

const DATA_DIR = new URL("../data/", import.meta.url);
const STATE_FILE = new URL("state.json", DATA_DIR);
mkdirSync(DATA_DIR, { recursive: true });

function load(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastBlock: 0, offset: 0, chats: {}, alerted: {}, reports: {}, decisions: [] };
  }
}
const state = load();

function save() {
  const tmp = new URL("state.json.tmp", DATA_DIR);
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE); // atomic replace so a crash never leaves half a file
}

const decided = (k: string) => state.decisions.some((d) => reportKey(d.stallId, d.qrHash) === k);

// ── telegram ─────────────────────────────────────────────────────────────────
async function tg<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`);
  return data.result;
}

const say = (chatId: number, text: string) => tg("sendMessage", { chat_id: chatId, text });

async function editAlert(k: string, text: string) {
  const a = state.alerted[k];
  if (!a) return;
  await tg("editMessageText", { chat_id: a.chatId, message_id: a.messageId, text, disable_web_page_preview: true }).catch(
    (e) => log("edit failed:", safe(e)),
  );
}

// ── chain ────────────────────────────────────────────────────────────────────
/** confirmBlacklist and wait 1 block so a rescan is RED immediately. Returns null if already blacklisted. */
async function blacklist(qrHash: string, reason: string): Promise<string | null> {
  if (await reader.blacklisted(qrHash)) return null;
  const tx = await firstOk(registries, (r) => r.confirmBlacklist(qrHash, reason));
  await tx.wait(1, 60_000);
  return tx.hash;
}

async function activeStall(id: number) {
  const s = await reader.getStall(id).catch(() => null);
  return s && s.registrar !== ZeroAddress && s.active ? s : null;
}

// ── handlers ─────────────────────────────────────────────────────────────────
async function onMessage(chatId: number, text: string | undefined) {
  if (!text?.startsWith("/start")) return;
  const id = parseStart(text);
  if (id === null) return void (await say(chatId, "Open the Telegram link from TrueQR stall registration to get alerts."));
  const stall = await activeStall(id);
  if (!stall) return void (await say(chatId, "That TrueQR stall wasn't found."));
  state.chats[id] = chatId;
  save();
  await say(chatId, `You'll get TrueQR alerts for ${stall.name}.`);
  log(`linked chat to stall ${id}`);
}

async function onCallback(q: any) {
  const p = parseCallback(q.data);
  const chatId = q.message?.chat?.id;
  const k = p && findAlertKey(Object.keys(state.alerted), p.stallId, p.prefix);
  // Only the chat linked to this stall may decide for it.
  if (!p || !k || state.chats[p.stallId] !== chatId) {
    return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: "This alert can't be used here." }));
  }
  if (decided(k)) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Already handled." }));
  const qrHash = k.split(":")[1];

  if (p.action === "ok") {
    state.decisions.push({ stallId: p.stallId, qrHash, action: "ignored", by: "owner", tx: null, at: Date.now() });
    save();
    await tg("answerCallbackQuery", { callback_query_id: q.id });
    await editAlert(k, "Marked as yours.");
    log(`stall ${p.stallId}: owner says QR is theirs`);
    return;
  }

  await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Blocking…" });
  try {
    const tx = await blacklist(qrHash, `Owner family confirmed not their QR at stall ${p.stallId}`);
    state.decisions.push({ stallId: p.stallId, qrHash, action: "blacklisted", by: "owner", tx, at: Date.now() });
    save();
    await editAlert(k, tx ? `Blocked ✅ ${txLink(tx)}` : "Blocked ✅ (already on the blacklist)");
    log(`stall ${p.stallId}: blacklisted by owner`, tx ?? "(already)");
  } catch (e) {
    log("confirmBlacklist failed:", safe(e));
    await say(chatId, "⚠️ Couldn't block yet — please tap “Not our QR” again.");
  }
}

async function onReport(stallId: number, qrHash: string) {
  const k = reportKey(stallId, qrHash);
  (state.reports[k] ??= []).push(Date.now());
  if (decided(k) || state.alerted[k]) return;
  const chatId = state.chats[stallId];
  if (!chatId) return log(`report for stall ${stallId} (no linked chat)`);
  const stall = await activeStall(stallId);
  if (!stall) return;
  const msg = await tg("sendMessage", {
    chat_id: chatId,
    text: alertText(stall.lang, stall.name),
    reply_markup: {
      inline_keyboard: [[
        { text: "Not our QR", callback_data: callbackData("bl", stallId, qrHash) },
        { text: "It's ours", callback_data: callbackData("ok", stallId, qrHash) },
      ]],
    },
  });
  state.alerted[k] = { at: Date.now(), chatId, messageId: msg.message_id };
  log(`alert sent for stall ${stallId}`);
}

async function scanLogs() {
  const latest = await firstOk(providers, (p) => p.getBlockNumber());
  if (!state.lastBlock) state.lastBlock = latest; // first run: only watch new reports
  for (let from = state.lastBlock + 1; from <= latest; from += 5_000) {
    const to = Math.min(from + 4_999, latest);
    const logs = await firstOk(registries, (r) => r.queryFilter(r.filters.MismatchReported(), from, to));
    for (const l of logs as EventLog[]) await onReport(Number(l.args.stallId), String(l.args.scannedQrHash));
    state.lastBlock = to;
    save();
  }
}

/** Backup rule: ≥ 3 reports for the same (stall, QR) within 1 h and no owner decision → blacklist. */
async function backupRule() {
  const now = Date.now();
  for (const [k, times] of Object.entries(state.reports)) {
    const recent = recentReports(times, now);
    if (recent.length) state.reports[k] = recent;
    else delete state.reports[k];
    if (recent.length < AUTO_BLACKLIST_REPORTS || decided(k)) continue;
    const [sid, qrHash] = k.split(":");
    const tx = await blacklist(qrHash, "3 reports in 1h, no owner reply");
    state.decisions.push({ stallId: Number(sid), qrHash, action: "blacklisted", by: "auto", tx, at: now });
    save();
    await editAlert(k, `Blocked automatically ✅ (3 reports in 1 h, no reply)${tx ? ` ${txLink(tx)}` : ""}`);
    log(`stall ${sid}: auto-blacklisted`, tx ?? "(already)");
  }
}

// ── HTTP :8787 ───────────────────────────────────────────────────────────────
createServer(async (req, res) => {
  const send = (code: number, body: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
  try {
    if (req.url === "/health") {
      const balance = await firstOk(providers, (p) => p.getBalance(wallet.address));
      return send(200, { ok: true, wallet: wallet.address, balance: formatEther(balance), lastBlock: state.lastBlock });
    }
    if (req.url === "/status") {
      const stalls = (await reader.listStalls()).map((s) => ({ id: s.id, name: s.name, linked: !!state.chats[s.id] }));
      return send(200, { stalls, decisions: state.decisions });
    }
    send(404, { error: "not found" });
  } catch (e) {
    send(502, { ok: false, error: safe(e) });
  }
})
  // A busy port must not stop alerts: log it and keep the Telegram/chain loop running.
  .on("error", (e) => log("HTTP server not started:", safe(e)))
  .listen(PORT, "127.0.0.1", () => log("Sentinel", wallet.address, `→ http://127.0.0.1:${PORT}/health`));

// ── loop: long-poll Telegram (≤ 10 s), then scan chain ───────────────────────
for (;;) {
  try {
    const updates = await tg<any[]>("getUpdates", {
      offset: state.offset,
      timeout: 10,
      allowed_updates: ["message", "callback_query"],
    });
    for (const u of updates) {
      state.offset = u.update_id + 1;
      save();
      try {
        if (u.message) await onMessage(u.message.chat.id, u.message.text);
        if (u.callback_query) await onCallback(u.callback_query);
      } catch (e) {
        log("update failed:", safe(e));
      }
    }
  } catch (e) {
    log("telegram poll failed:", safe(e));
    await new Promise((r) => setTimeout(r, 5_000));
  }
  try {
    await scanLogs();
    await backupRule();
  } catch (e) {
    log("chain scan failed:", safe(e));
  }
}
