/**
 * Drives SubScript sandbox test clocks, so a renewal can be demonstrated in
 * seconds instead of waiting a month.
 *
 * Usage:
 *   node scripts/test-clock.mjs create [name]        # new clock
 *   node scripts/test-clock.mjs list                 # clocks + their subscriptions
 *   node scripts/test-clock.mjs add <clockId> [usdc] # attach a simulated subscription
 *   node scripts/test-clock.mjs advance <clockId> <days>
 *   node scripts/test-clock.mjs rm <clockId>
 *
 * Advancing fires one signed `subscription.renewed` per due period at your real
 * webhook endpoint, carrying `simulated: true` and `test_clock_id`.
 *
 * IMPORTANT, and worth knowing before you record anything: a clock subscription
 * accepts only a name, an amount, an interval and a `subscriberLabel` — there is
 * no externalReference or subscriber field. So its renewals carry none of our
 * identifiers and cannot resolve to a real account; handleSubscriptionEvent will
 * log them as `user_not_found`. That is expected. What this proves is that signed
 * renewal deliveries arrive and verify. To show a renewal actually extending a
 * real account's period, use the dev simulator instead:
 *
 *   curl -X POST localhost:3000/api/dev/complete \
 *     -H 'content-type: application/json' \
 *     -d '{"intentId":"<sub checkout id>","eventType":"subscription.renewed"}'
 *
 * Sandbox only: a live key gets 403. Limits are 10 clocks per merchant, and
 * 365 days / 50 events per advance call.
 */
import fs from "node:fs";
import path from "node:path";

const BASE = "https://www.subscriptonarc.com";
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
  console.error("Missing SUBSCRIPT_SECRET_KEY in .env.local.");
  process.exit(1);
}
if (key.startsWith("sk_live_")) {
  console.error("That is a live key. Test clocks are sandbox-only and will 403.");
  process.exit(1);
}

async function call(method, route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${method} ${route}`);
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

const [command, arg1, arg2] = process.argv.slice(2);

switch (command) {
  case "create": {
    const json = await call("POST", "/api/test/clocks", {
      name: arg1 || "Kris's Script demo",
    });
    const clock = json.clock ?? json;
    console.log(`Clock created: ${clock.id}`);
    console.log(`Frozen at: ${clock.frozenTime ?? "(unreported)"}`);
    console.log(`\nNext: node scripts/test-clock.mjs add ${clock.id}`);
    break;
  }

  case "list": {
    const json = await call("GET", "/api/test/clocks");
    const clocks = json.clocks ?? [];
    if (!clocks.length) {
      console.log("No clocks. Create one: node scripts/test-clock.mjs create");
      break;
    }
    for (const c of clocks) {
      console.log(`${c.id}  ${c.name ?? ""}  frozen=${c.frozenTime ?? "?"}`);
      for (const s of c.subscriptions ?? []) {
        console.log(
          `    sub ${s.id}  ${s.amountUsdcMicros} micros  every ${s.intervalSeconds}s  renewals=${s.renewalsFired ?? 0}`
        );
      }
    }
    break;
  }

  case "add": {
    if (!arg1) {
      console.error("Usage: node scripts/test-clock.mjs add <clockId> [usdc]");
      process.exit(1);
    }
    const usdc = Number(arg2 || "2");
    const json = await call("POST", `/api/test/clocks/${arg1}/subscriptions`, {
      name: `Demo ${usdc} USDC monthly`,
      amountUsdcMicros: String(Math.round(usdc * 1_000_000)),
      interval: "monthly",
      subscriberLabel: "demo-subscriber",
    });
    const sub = json.subscription ?? json;
    console.log(`Attached: ${sub.id ?? "(created)"}`);
    console.log(`\nNext: node scripts/test-clock.mjs advance ${arg1} 31`);
    break;
  }

  case "advance": {
    if (!arg1 || !arg2) {
      console.error("Usage: node scripts/test-clock.mjs advance <clockId> <days>");
      process.exit(1);
    }
    const days = Number(arg2);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      console.error("Days must be a number between 1 and 365.");
      process.exit(1);
    }
    const json = await call("POST", `/api/test/clocks/${arg1}/advance`, { days });
    console.log(`Advanced ${days} day(s). Events fired: ${json.eventsFired ?? "?"}`);
    console.log(JSON.stringify(json, null, 2));
    console.log(
      "\nThese arrive at your registered webhook URL. If APP_URL is still localhost, nothing will reach you — start a tunnel first."
    );
    break;
  }

  case "rm": {
    if (!arg1) {
      console.error("Usage: node scripts/test-clock.mjs rm <clockId>");
      process.exit(1);
    }
    await call("DELETE", `/api/test/clocks/${arg1}`);
    console.log(`Deleted clock ${arg1} and its simulated subscriptions.`);
    break;
  }

  default:
    console.error("Commands: create | list | add | advance | rm");
    console.error("  node scripts/test-clock.mjs create [name]");
    console.error("  node scripts/test-clock.mjs list");
    console.error("  node scripts/test-clock.mjs add <clockId> [usdc]");
    console.error("  node scripts/test-clock.mjs advance <clockId> <days>");
    console.error("  node scripts/test-clock.mjs rm <clockId>");
    process.exit(1);
}
