/**
 * Simulates a SubScript `payment.succeeded` webhook against the app.
 *
 * Usage:
 *   node scripts/simulate-webhook.mjs <intent_id> [app_url]
 *
 * The intent_id is returned by POST /api/billing/checkout (and shown in the
 * dev checkout URL, e.g. /dev/checkout?intent=<intent_id>).
 *
 * Signs the payload with SUBSCRIPT_WEBHOOK_SECRET from .env.local (or the
 * built-in dev secret), matching SubScript's documented signature scheme:
 *   x-subscript-signature: t=<unix>,v1=HMAC_SHA256(secret, `${t}.${rawBody}`)
 *
 * Fulfillment looks the payment up by intent_id, so no other fields are needed.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function loadEnv(file) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(p, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local"), ...process.env };
const secret = env.SUBSCRIPT_WEBHOOK_SECRET || "dev-webhook-secret";

const intentId = process.argv[2];
const appUrl = (process.argv[3] || env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

if (!intentId) {
  console.error("Usage: node scripts/simulate-webhook.mjs <intent_id> [app_url]");
  process.exit(1);
}

const event = {
  id: `evt_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
  type: "payment.succeeded",
  created: Math.floor(Date.now() / 1000),
  data: {
    intent_id: intentId,
    currency: "USDC",
    transaction_hash: `0x${crypto.randomBytes(32).toString("hex")}`,
    chain_id: 5042002,
  },
};

const rawBody = JSON.stringify(event);
const t = Math.floor(Date.now() / 1000);
const v1 = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");

const res = await fetch(`${appUrl}/api/webhooks/subscript`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-subscript-signature": `t=${t},v1=${v1}`,
  },
  body: rawBody,
});

console.log(`Simulated ${event.type} for intent ${intentId} -> ${appUrl}`);
console.log(`Webhook response: HTTP ${res.status}`, await res.json());
