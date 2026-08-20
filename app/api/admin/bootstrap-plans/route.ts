import crypto from "crypto";
import { q, one } from "@/lib/db";
import { createPlan, listPlans, hasRealKey, appUrl, SubScriptError } from "@/lib/subscript";
import { PLANS, PLAN_ORDER, PLAN_DURATION_SECONDS } from "@/lib/plans";

/**
 * Publish the three tiers to SubScript's plan catalogue, once.
 *
 * Why this exists at all: subscribing with an inline amount + interval makes
 * SubScript mint a fresh ad-hoc plan for every checkout, so the public catalogue
 * and the DM plan picker fill up with duplicate "Kris's Script Pro" entries — one
 * per attempt, including abandoned ones. Posting each tier once and then
 * subscribing by `planId` keeps a single durable entry per tier, which is what
 * the DM plan controls are meant to show.
 *
 * Why it is a route rather than a standalone script: locally the database is
 * PGlite in data/pglite, and PGlite allows one process at a time. A script would
 * be locked out whenever `next dev` is running, which is always. Going through
 * the app means one writer.
 *
 * Idempotent, and it has to be: POST /api/v1/plans accepts no idempotency key and
 * does not deduplicate on name, so a careless re-run is permanent litter in a
 * public catalogue. Two guards — the recorded plan id in merchant_plans, and a
 * name match against the live catalogue for the case where the table was reset
 * but the plans still exist upstream. Price and period are immutable once
 * created, so a tier whose price has changed needs a new plan, not a repair.
 */
function authorized(req: Request): boolean {
  const secret = process.env.ADMIN_RESET_SECRET;
  // Unset means the endpoint is disabled, not that anything goes.
  if (!secret) return false;

  const provided = req.headers.get("x-admin-key");
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The catalogue name for a tier. Also the key the upstream dedup check uses. */
function planName(tierName: string): string {
  // Max length 60 upstream; these are far shorter, but keep it explicit.
  return `Kris's Script ${tierName}`.slice(0, 60);
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return Response.json(
      {
        error:
          "Unauthorized. Set ADMIN_RESET_SECRET and send it as the x-admin-key header.",
      },
      { status: 401 }
    );
  }

  if (!hasRealKey()) {
    return Response.json(
      {
        error:
          "No SUBSCRIPT_SECRET_KEY configured. Catalogue plans are a real SubScript resource; there is nothing to publish in dev mode.",
      },
      { status: 400 }
    );
  }

  /* The DM's link back to the platform. Only sent over HTTPS: SubScript refuses
     plain-http URLs elsewhere in the API, and a localhost link in a published
     plan would be a dead end for every customer anyway. Reported in the response
     so a bootstrap run from localhost does not silently publish link-less plans —
     and since price and period are immutable, a plan published without one cannot
     be repaired by re-running this. */
  const detailsUrl = appUrl().startsWith("https://") ? `${appUrl()}/pricing` : null;

  /* The live catalogue, so a tier that exists upstream is adopted rather than
     duplicated. This is the guard that matters after a database reset: our table
     is empty but the plans are still published. */
  const { plans: existing } = await listPlans();
  const byName = new Map(
    existing.map((p) => [String(p.name || "").trim().toLowerCase(), p])
  );

  const created: string[] = [];
  const adopted: string[] = [];
  const skipped: string[] = [];
  const failed: { tier: string; error: string }[] = [];

  for (const tierId of PLAN_ORDER) {
    const tier = PLANS[tierId];

    const recorded = await one<{ plan_id: string }>(
      "SELECT plan_id FROM merchant_plans WHERE tier = $1",
      [tierId]
    );
    if (recorded) {
      skipped.push(tierId);
      continue;
    }

    const name = planName(tier.name);
    const upstream = byName.get(name.toLowerCase());
    if (upstream) {
      await q(
        `INSERT INTO merchant_plans (tier, plan_id, subscribe_url, amount_micros)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tier) DO NOTHING`,
        [tierId, upstream.id, upstream.subscribeUrl ?? null, tier.priceUsdcMicros]
      );
      adopted.push(tierId);
      continue;
    }

    try {
      const { plan } = await createPlan({
        name,
        amountUsdcMicros: tier.priceUsdcMicros,
        // PLAN_DURATION_SECONDS is the period the grant logic uses; keep the
        // published plan on exactly the same clock.
        periodDays: Math.round(PLAN_DURATION_SECONDS / 86400),
        description: `${tier.messages} messages per month`,
        /* Where the DM sends someone who wants this tier. The catalogue entry is
           for looking at what the business offers; the change itself happens on
           the platform, through a checkout we started and can therefore
           supersede the old subscription from. Without this the DM is a dead end
           or, worse, a second way to change plans that we never see coming. */
        ...(detailsUrl ? { detailsUrl } : {}),
      });
      await q(
        `INSERT INTO merchant_plans (tier, plan_id, subscribe_url, amount_micros)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tier) DO NOTHING`,
        [tierId, plan.id, plan.subscribeUrl ?? null, tier.priceUsdcMicros]
      );
      created.push(tierId);
    } catch (err) {
      /* Stop rather than continue. A partial catalogue is recoverable by re-running
         this; pressing on past an auth or quota failure just multiplies the same
         error against every remaining tier. */
      failed.push({
        tier: tierId,
        error: err instanceof SubScriptError ? err.message : String(err),
      });
      break;
    }
  }

  const { rows } = await q(
    "SELECT tier, plan_id, subscribe_url FROM merchant_plans ORDER BY tier"
  );

  return Response.json(
    {
      ok: failed.length === 0,
      created,
      adopted,
      skipped,
      detailsUrl,
      ...(detailsUrl
        ? {}
        : {
            warning:
              "APP_URL is not HTTPS, so no detailsUrl was published. The DM entry will have no link back to the site, and price/period are immutable — start a tunnel and publish fresh plans instead of re-running this.",
          }),
      ...(failed.length ? { failed } : {}),
      catalogue: rows,
    },
    { status: failed.length ? 502 : 200 }
  );
}

/** Read the recorded catalogue without publishing anything. */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { rows } = await q(
    "SELECT tier, plan_id, subscribe_url, amount_micros FROM merchant_plans ORDER BY tier"
  );
  const { plans } = await listPlans();
  return Response.json({ recorded: rows, upstream: plans });
}
