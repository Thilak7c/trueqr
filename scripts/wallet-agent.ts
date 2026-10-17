// A wallet's AI agent asking TrueQR Guardian (BNB Agent Studio seller) about a QR before paying.
// Usage: pnpm tsx scripts/wallet-agent.ts "<qr text>" [lat] [lng]
// GUARDIAN_URL defaults to local `bag dev` (http://localhost:9000).
//
// x402 envelope (price_usd = "0" → FREE passthrough, no payment headers needed).
// Recorded 2026-10-17 against `bag dev` with a synthetic QR (fake payee ALI BIN ABU) at the venue:
//
//   POST /x402   content-type: application/json
//   {"prompt":"{\"qrPayload\":\"00020201021126440014A0000006150001010689005302120000000000015204581253034585802MY5911ALI BIN ABU6002KL6304ABCD\",\"lat\":3.0629314,\"lng\":101.6168303}"}
//
//   HTTP/1.1 200 OK   content-type: application/json
//   {"result":"{\"status\":\"amber\",\"reason\":\"qr_mismatch\",\"notes\":[],\"payeeName\":\"ALI BIN ABU\",
//     \"qrHash\":\"0x4ed12d882f93e23baadf8f50f413a8266662c8d58b0ea748e0bd081a8e14aebf\",
//     \"stall\":{\"id\":2,\"name\":\"Siti Nasi Lemak\",\"photoURI\":\"\",\"registeredAt\":1792211109,\"lat\":3.062931,\"lng\":101.61683},
//     \"nearby\":[{\"id\":2,\"name\":\"Siti Nasi Lemak\",\"photoURI\":\"\",\"distanceM\":0}],\"reportTx\":null,
//     \"message\":\"This QR doesn't pay Siti Nasi Lemak. It pays ALI BIN ABU. Don't pay.\"}"}
//
// `prompt` must be a STRING (the B402 runtime only reads body.prompt or ?prompt=); `result` is the Verdict as a JSON string.

const [qrPayload, lat, lng] = process.argv.slice(2);
if (!qrPayload) {
  console.error('usage: pnpm tsx scripts/wallet-agent.ts "<qr text>" [lat] [lng]');
  process.exit(1);
}

const base = (process.env.GUARDIAN_URL ?? "http://localhost:9000").replace(/\/$/, "");
const input = {
  qrPayload,
  ...(lat !== undefined && lng !== undefined ? { lat: Number(lat), lng: Number(lng) } : {}),
};

async function main() {
  const res = await fetch(`${base}/x402`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: JSON.stringify(input) }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.result !== "string") {
    console.error(`Guardian error: HTTP ${res.status}`, body);
    process.exit(1);
  }
  const v = JSON.parse(body.result);
  if (v.error) {
    console.error("Guardian rejected input:", v.error);
    process.exit(1);
  }
  console.log(`status:  ${v.status}`);
  console.log(`reason:  ${v.reason}`);
  console.log(`message: ${v.message}`);
}

main().catch((e) => {
  console.error(`Couldn't reach Guardian at ${base}: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
