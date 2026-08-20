/**
 * Publishes the three plan tiers to SubScript's catalogue, once.
 *
 * Usage:
 *   node scripts/bootstrap-plans.mjs            # publish (idempotent)
 *   node scripts/bootstrap-plans.mjs --check    # show state, publish nothing
 *
 * Drives POST /api/admin/bootstrap-plans on the running app rather than talking
 * to SubScript directly, because the plan ids have to be recorded in the same
 * database the app uses — and locally that is PGlite, which allows a single
 * process at a time. `next dev` holds it, so a script that opened the database
 * itself would simply be locked out.
 *
 * Requires ADMIN_RESET_SECRET in .env.local (the same guard as the reset route).
 * Safe to re-run: a tier already recorded is skipped, and a tier that exists
 * upstream but is missing locally is adopted rather than duplicated. That matters
 * because POST /api/v1/plans takes no idempotency key and does not deduplicate on
 * name, so every stray re-run would otherwise leave a permanent duplicate in a
 * public catalogue.
 */
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
const appUrl = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const adminKey = env.ADMIN_RESET_SECRET;
const check = process.argv.includes("--check");

if (!adminKey) {
  console.error("Missing ADMIN_RESET_SECRET in .env.local.");
  console.error("Add a long random value, restart `npm run dev`, then re-run this.");
  process.exit(1);
}

if (!env.SUBSCRIPT_SECRET_KEY) {
  console.error("Missing SUBSCRIPT_SECRET_KEY in .env.local.");
  console.error("Catalogue plans are a real SubScript resource — dev mode has nothing to publish.");
  process.exit(1);
}

const res = await fetch(`${appUrl}/api/admin/bootstrap-plans`, {
  method: check ? "GET" : "POST",
  headers: { "x-admin-key": adminKey },
}).catch((err) => {
  console.error(`Could not reach ${appUrl} — is \`npm run dev\` running?`);
  console.error(String(err));
  process.exit(1);
});

const body = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

if (check) {
  console.log("Recorded locally:");
  for (const row of body.recorded ?? []) {
    console.log(`  ${row.tier.padEnd(7)} ${row.plan_id}  ${row.subscribe_url ?? "(no url)"}`);
  }
  if (!body.recorded?.length) console.log("  (nothing yet — run without --check)");
  console.log(`\nUpstream catalogue: ${body.upstream?.length ?? 0} plan(s)`);
  for (const p of body.upstream ?? []) {
    console.log(`  ${p.id}  ${p.name}`);
  }
  process.exit(0);
}

const { created = [], adopted = [], skipped = [] } = body;
if (created.length) console.log(`Created:  ${created.join(", ")}`);
if (adopted.length) console.log(`Adopted:  ${adopted.join(", ")} (already existed upstream)`);
if (skipped.length) console.log(`Skipped:  ${skipped.join(", ")} (already recorded)`);
if (!created.length && !adopted.length) console.log("Nothing to do — catalogue is already complete.");

if (body.warning) console.warn(`\nWarning: ${body.warning}`);
else if (body.detailsUrl) console.log(`\nDM links back to: ${body.detailsUrl}`);

console.log("\nCatalogue:");
for (const row of body.catalogue ?? []) {
  console.log(`  ${row.tier.padEnd(7)} ${row.plan_id}`);
  if (row.subscribe_url) console.log(`  ${"".padEnd(7)} share: ${row.subscribe_url}`);
}
