import crypto from "crypto";
import { q, one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import {
  createSubscription,
  isWalletAddress,
  SubScriptError,
} from "@/lib/subscript";
import { PLANS, PLAN_ORDER, PLAN_INTERVAL, isPlanId, planIsActive } from "@/lib/plans";

/** Statuses that mean the current subscription is winding down or already over. */
const WINDING_DOWN = new Set(["canceling", "canceled", "cancelled", "expired", "past_due"]);

/**
 * Start a monthly subscription for one of the plan tiers.
 *
 * Mirrors the one-time flows: a PENDING payments row is written first so the
 * subscription id has somewhere to land, and the plan is only granted when
 * SubScript confirms — handleSubscriptionEvent maps the event back to this row
 * by subscription id, so nothing here grants access on its own.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { plan } = (await req.json().catch(() => ({}))) as { plan?: string };

  if (!isPlanId(plan)) {
    return Response.json(
      {
        error: `Unknown plan. Choose one of: ${Object.keys(PLANS).join(", ")}.`,
      },
      { status: 400 }
    );
  }
  const tier = PLANS[plan];

  const planActive = planIsActive(user.plan, user.plan_expires_at);
  /* A cancelled subscription still has an unexpired period, so planIsActive
     stays true right through the wind-down. Treating that as "live" is what made
     resubscribing impossible: the guard below rejected the only tier the customer
     wanted, and the UI offered no other way back. */
  const windingDown =
    !!user.sub_cancel_at_period_end ||
    WINDING_DOWN.has(String(user.sub_status || "").toLowerCase());
  const live = planActive && !windingDown;

  // Genuinely live and set to continue: renewing really is SubScript's job.
  if (user.plan === plan && live) {
    return Response.json(
      { error: `You are already on ${tier.name}. It renews automatically.` },
      { status: 400 }
    );
  }

  /* Upgrade-only while a subscription is live, per SubScript: "Customer plan
     changes are upgrade-only; do not build or expose a downgrade action." Once
     it is winding down any tier is fair game, because the next checkout starts a
     fresh authorization rather than modifying one. */
  if (live && isPlanId(user.plan)) {
    const currentRank = PLAN_ORDER.indexOf(user.plan);
    if (PLAN_ORDER.indexOf(plan) < currentRank) {
      return Response.json(
        {
          error: `Plan changes are upgrade-only. Cancel ${PLANS[user.plan].name} first, then subscribe to ${tier.name} once the period ends.`,
        },
        { status: 400 }
      );
    }
  }

  /* The subscriber's address when we already know it, and simply absent when we
     do not. Nobody is asked to type it: the first checkout goes out without it
     (and therefore without our reference, which SubScript will not accept alone),
     the customer connects their wallet at SubScript's checkout, and the
     activation event carries the address back for handleSubscriptionEvent to file.
     From then on every checkout carries both. */
  const subscriberAddress = isWalletAddress(user.wallet_address)
    ? user.wallet_address!.trim()
    : undefined;

  /* The catalogue plan for this tier, when the bootstrap has run. Subscribing by
     planId keeps every subscriber on the one published tier instead of minting a
     fresh ad-hoc plan per checkout — which is what fills the DM plan picker with
     duplicates. Falls back to amount + interval when absent. */
  const catalogue = await one<{ plan_id: string }>(
    "SELECT plan_id FROM merchant_plans WHERE tier = $1",
    [plan]
  );

  /* On a tier change, park the outgoing authorization so it can be cancelled once
     the replacement is live. Two active subscriptions are two charges. */
  const superseded = user.plan !== plan && live ? user.subscription_id : null;

  const paymentId = `pay_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  await q(
    `INSERT INTO payments (id, user_id, product, amount_micros, status, supersedes_subscription_id)
     VALUES ($1, $2, $3, $4, 'PENDING', $5)`,
    [paymentId, user.id, plan, tier.priceUsdcMicros, superseded]
  );

  try {
    const { devMode, subscription } = await createSubscription({
      title: `Kris's Script ${tier.name}`,
      description: `${tier.messages} messages per month`,
      amountUsdcMicros: tier.priceUsdcMicros,
      interval: PLAN_INTERVAL,
      planId: catalogue?.plan_id,
      /* The subscriber's on-chain address, and the reason the DM flow works or
         doesn't: publishing creates the catalogue plan, but SubScript only
         writes the DM subscription offer when it also receives `subscriber`.
         Without it you get a plan in the picker and an empty thread. */
      subscriber: subscriberAddress,
      /* Our stable key for this customer — the id only, with no tier in it.
         SubScript models an upgrade as a new subscription that keeps the same
         customer id, so a reference naming the tier would change identity on
         every upgrade, which defeats the point. The tier is recovered from the
         charged amount when an event needs it. Comes back on every subscription
         event as merchant_customer_id / external_reference, and survives a
         resume — which mints a new subscription id. */
      externalReference: `user:${user.id}`,
      idempotencyKey: paymentId,
    });

    /* Records the checkout session id. The on-chain subscription id lands on
       users.subscription_id with the first subscription event; this row is what
       handleSubscriptionEvent falls back to when an event carries neither our
       reference nor a known id. */
    await q("UPDATE payments SET intent_id = $1 WHERE id = $2", [
      subscription.id,
      paymentId,
    ]);

    return Response.json({
      paymentId,
      devMode,
      plan: tier.id,
      planName: tier.name,
      messages: tier.messages,
      priceUsdc: tier.priceUsdc,
      interval: PLAN_INTERVAL,
      checkoutUrl: subscription.checkoutUrl,
      /* Publishing is unconditional, so the catalogue entry always happens. The
         DM offer needs `subscriber`, which a first-time subscriber has not
         supplied yet — it arrives with the activation event. So the first
         checkout publishes without a DM offer, and every later one has both. */
      published: true,
      dmOffer: !!subscriberAddress,
      viaCataloguePlan: !!catalogue?.plan_id,
      supersedes: superseded,
    });
  } catch (err) {
    // Roll back so an unreachable SubScript leaves no phantom pending row.
    await q("DELETE FROM payments WHERE id = $1", [paymentId]);

    const message =
      err instanceof SubScriptError
        ? err.message
        : "Could not reach SubScript to start the subscription.";
    return Response.json({ error: message }, { status: 502 });
  }
}

/**
 * The plan catalogue, so the pricing page renders from one definition.
 *
 * Each tier carries its SubScript catalogue plan id and `subscribeUrl` when the
 * bootstrap has run. That url is SubScript's own hosted checkout for the plan, so
 * it is what the UI offers as a share link — there is no need to mint anything of
 * our own for a subscriber who wants to send a plan to a friend.
 */
export async function GET() {
  const { rows } = await q("SELECT tier, plan_id, subscribe_url FROM merchant_plans");
  const catalogue = new Map(
    rows.map((r) => [String(r.tier), { planId: r.plan_id, shareUrl: r.subscribe_url }])
  );

  return Response.json({
    interval: PLAN_INTERVAL,
    plans: Object.values(PLANS).map((p) => ({
      ...p,
      planId: catalogue.get(p.id)?.planId ?? null,
      shareUrl: catalogue.get(p.id)?.shareUrl ?? null,
    })),
    bootstrapped: catalogue.size > 0,
  });
}
