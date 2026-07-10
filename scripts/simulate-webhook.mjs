/**
 * Simulates a SubScript `payment.succeeded` webhook against the local server.
 *
 * Usage:
 *   node scripts/simulate-webhook.mjs              # latest PENDING payment
 *   node scripts/simulate-webhook.mjs <intent_id>  # specific intent
 *
 * Signs the payload with SUBSCRIPT_WEBHOOK_SECRET from .env.local (or the
 * built-in dev secret), matching SubScript's documented signature scheme:
 *   x-subscript-signature: t=<unix>,v1=HMAC_SHA256(secret, `${t}.${rawBody}`)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

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
const appUrl = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const db = new Database(path.join(root, "data", "app.db"));
const arg = process.argv[2];
const payment = arg
  ? db.prepare("SELECT * FROM payments WHERE intent_id = ?").get(arg)
  : db.prepare("SELECT * FROM payments WHERE status = 'PENDING' ORDER BY created_at DESC").get();

if (!payment) {
  console.error(arg ? `No payment found for intent ${arg}` : "No PENDING payments found.");
  process.exit(1);
}

const event = {
  id: `evt_sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
  type: "payment.succeeded",
  created: Math.floor(Date.now() / 1000),
  data: {
    intent_id: payment.intent_id,
    merchant_reference: `${payment.product}:${payment.user_id}:${payment.id}`,
    amount_usdc_micros: payment.amount_micros,
    currency: "USDC",
    receipt_id: payment.receipt_token,
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

console.log(`Simulated ${event.type} for intent ${payment.intent_id} (${payment.product})`);
console.log(`Webhook response: HTTP ${res.status}`, await res.json());
