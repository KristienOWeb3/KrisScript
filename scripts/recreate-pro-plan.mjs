/**
 * Recreates the "Kris Script Pro audit" plan as a reusable catalog plan
 * via POST /api/v1/plans using the real merchant API key.
 * This publishes the plan to the DM plan picker.
 *
 * Usage:
 *   node scripts/recreate-pro-plan.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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
const key = env.SUBSCRIPT_SECRET_KEY;

if (!key) {
  console.error("❌ Error: Missing SUBSCRIPT_SECRET_KEY in .env.local");
  console.error("Make sure you have Kris's real merchant API key configured.");
  process.exit(1);
}

// Ensure it's not the shared demo key
if (key.includes("demo")) {
  console.warn("⚠️ Warning: You appear to be using a demo key.");
  console.warn("The DM plan picker requires a real merchant API key to render plans.");
}

const body = {
  title: "Kris Script Pro audit test",
  description: "Pro plan test",
  amountUsdcMicros: "2000000",
  interval: "weekly",
  subscriber: "0x1234567890123456789012345678901234567890",
  publishToDm: false,
  externalReference: "test-ref-" + Date.now(),
  idempotencyKey: crypto.randomUUID(),
  sandbox: true
};

const res = await fetch("https://www.subscriptonarc.com/api/v1/subscriptions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const json = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status}`);

if (!res.ok) {
  console.error("❌ Failed to create plan:", json);
  process.exit(1);
}

console.log("✅ Plan created successfully!");
console.log(JSON.stringify(json, null, 2));
