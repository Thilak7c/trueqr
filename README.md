# TrueQR

**Know who you're paying.** TrueQR tells you whether the DuitNow QR you're about to pay really belongs to the stall in front of you, using the QR the hawker already has. Built at BNB Builder Hack KL.

A scammer pastes their own QR sticker over a hawker's. TrueQR stores a fingerprint of each stall's real QR on BNB Smart Chain testnet. When a shopper scans, the wallet asks "does this QR belong to the stall here?" A different QR at a registered stall is flagged before anyone pays, the stall's family gets a Telegram alert, and one tap blacklists the scam QR everywhere.

| | |
|---|---|
| Live web app | https://trueqr-ochre.vercel.app (`/wallet` = DemoPay, `/register` = stall sign-up; `/wallet?venue=1` uses the venue location) |
| QRRegistry (BSC testnet, verified) | [`0x877D2247B6315f3b344E7F117382045Ee043CbEE`](https://testnet.bscscan.com/address/0x877d2247b6315f3b344e7f117382045ee043cbee#code) |
| Guardian agent (BNB Agent Studio) | local `bag dev`, see below |

## How it works

```
DemoPay (/wallet) ──► web /api/verify ──► QRRegistry (BSC testnet)
                         │ on qr_mismatch: relayer reportMismatch()
                         ▼
                    Sentinel ◄── MismatchReported event
                         │ Telegram alert + [Not our QR] [It's ours]
                         ▼
                    family taps Not our QR → confirmBlacklist() → RED everywhere

AI agents / other wallets ──► Guardian (BNB Agent Studio: A2A + MCP + x402) ──► reads QRRegistry
```

- **On-chain = fingerprint only:** `keccak256(qr text)` plus stall name, photo URL, location and language. Never the raw QR, never bank details.
- **Verdicts:** green `match` · amber `qr_mismatch` (a different QR at a registered stall within 300 m; Pay disabled) · amber `unregistered` / `registered_elsewhere` / `dynamic_qr` ("Pay anyway") · red `blacklisted`.
- **DemoPay is a mock wallet** (fake balance, fake payment). The registry, reports, blacklist, Sentinel and Guardian are real on BSC testnet.

## BNB Agent Studio

Built with BNB Agent Studio (scaffolded via /bnbagent-studio). The managed BNB trial deploy hung on Windows during the event, so Guardian is demoed locally with bag dev.

**What Guardian is:** a seller agent that answers one question for other wallets and AI agents: *does this DuitNow QR belong to the stall at this location?* It returns the same green / amber / red verdict as DemoPay. Its work function (`guardian/app/agent/src/sellerCore.ts` → `guardianWork`) parses `{ qrPayload, lat?, lng? }`, runs `verify()` from `@trueqr/core` over read-only RPCs and returns the verdict JSON. It is deterministic: no LLM decides a verdict, and Guardian never writes on-chain.

**Scaffold** (`bag init`, bag 0.0.15, `guardian/app/agent/studio.toml`):

| Setting | Value |
|---|---|
| Role | seller (single seller runtime, AgentCore) |
| Faces | A2A + MCP + X402 (`dualMain.ts`: A2A on `/`, MCP on `/mcp`, x402 on `/x402`) |
| Network | `bsc-testnet` |
| Wallet | `evm-local`, address `0x5f2CEACc18Ca118983047C64352347CD6E048443` (keystore in gitignored `guardian/.studio/`) |
| LLM | Pieverse `auto/free` (activated, zero deposit; not used for verdicts) |
| Price | `[payments.seller] price_usd = "0"`: x402 is anonymous FREE passthrough, no B402 settlement |
| Storage | `ipfs` (the managed platform injects its own storage) |
| Destination | `platform` (BNB managed 48 h testnet trial) |

`bag doctor`: no FAILs (x402 "FREE — /x402 is anonymous; B402 verify/settle … bypassed"; zip bundle dry run OK). `bag deploy prepare --provider bnb --backend aws`: 0 BLOCKED, 0 CRITICAL, ready to deploy.

**Agent card** (`GET /.well-known/agent-card.json` from `bag dev`):

```json
{
  "name": "guardian-agent",
  "description": "TrueQR Guardian — checks whether a DuitNow QR belongs to the stall at a location. Returns green / amber / red with a reason.",
  "protocolVersion": "0.3.0",
  "preferredTransport": "JSONRPC",
  "skills": [
    { "id": "negotiate", "name": "Negotiate an ERC-8183 job" },
    { "id": "notify_funded", "name": "Notify the seller a job is funded (request delivery)" }
  ]
}
```

**ERC-8004 identity:** not registered. Studio registers ERC-8004 at deploy time with the agent's public endpoint (`bag deploy verify`). The deploy didn't complete, so `bag erc8004 show` reports `Wallet 0x5f2CEACc18Ca118983047C64352347CD6E048443 has no registered agent.`

**Managed trial deploy (what happened):** `bag platform login` succeeded (trial "available", 0 agents). `bag deploy --provider bnb --backend aws --yes [--accept-risk]` run inside `guardian/` printed `deployment plan: create · provider=bnb · target=bnb/trial` and then hung with no network activity. Run from the home folder it got further, to the trial terms, then failed because there was no `studio.toml` there. No agent was created and the 48 h trial clock never started.

**Try Guardian locally:**

```powershell
node scripts/sync-core.mjs                 # copy packages/core/src into Guardian (works in PowerShell)
cd guardian/app/agent; bag config set storage.kind local; cd ../..   # bag dev needs local storage (IPFS needs a pinning endpoint)
bag dev --port 9100                        # :9000 is taken by Docker on the build machine
# another terminal, from the repo root:
$env:GUARDIAN_URL = "http://localhost:9100"
pnpm tsx scripts/wallet-agent.ts "<qr text>" 3.0629314 101.6168303
```

Set `storage.kind` back to `ipfs` before a managed deploy. The exact x402 request/response envelope is recorded in [`scripts/wallet-agent.ts`](scripts/wallet-agent.ts): POST `/x402` with `{"prompt": "<JSON string of {qrPayload, lat, lng}>"}` returns `{"result": "<verdict JSON string>"}`.

Result at the demo venue (stall 2, Siti Nasi Lemak): the stall's own QR → `green match`; a different QR → `amber qr_mismatch`.

## Sentinel (stall-family alerts)

`sentinel/` runs on a laptop (`pnpm --filter sentinel dev`; set `SENTINEL_PORT` if 8787 is taken). It long-polls the Telegram bot and watches `MismatchReported`:

- `/start s<id>` (from the QR on the registration screen) links a family's chat to a stall.
- The first report for a (stall, QR) pair sends an alert in the stall's language with **Not our QR** / **It's ours** buttons.
- **Not our QR** → `confirmBlacklist` from the Sentinel key → the QR is RED everywhere.
- Backup rule: 3 or more reports for the same (stall, QR) within 1 h and no reply → blacklisted automatically.

Tested end to end on BSC testnet with a made-up QR: report mined → Telegram alert about 1 s later → tap → [blacklist tx](https://testnet.bscscan.com/tx/0xd0127368f1b1889fa9e9a368e22da91ce8ab2ee1ec83e89854693b202108038e) → the live `/api/verify` rescan returns `red blacklisted`.

## Repo

| Path | What |
|---|---|
| `contracts/` | Foundry: `QRRegistry.sol` + tests (`forge test`) |
| `packages/core/` | `@trueqr/core`: EMV parser, fingerprint, geo, `verify()` (vitest, every verdict row tested) |
| `web/` | Next.js app on Vercel: DemoPay, stall registration, `/api/verify`, `/api/register`, `/api/stalls` |
| `sentinel/` | Telegram + chain watcher (Node 22, tsx, ethers v6) |
| `guardian/` | BNB Agent Studio seller agent (`bag`) |
| `scripts/` | `sync-core.mjs`, `wallet-agent.ts` |

Testnet only (chainId 97). Secrets live in gitignored `.env*` files and `guardian/.studio/`.
