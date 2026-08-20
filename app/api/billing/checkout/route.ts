import crypto from "crypto";
import { q, one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { createSubscription, isWalletAddress, publishToDmEnabled, SubScriptError } from "@/lib/subscript";
import { PLANS, PLAN_INTERVAL, isPlanId, planIsActive } from "@/lib/plans";

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

  // Already on this tier and not expired: renewing is SubScript's job.
  if (user.plan === plan && planIsActive(user.plan, user.plan_expires_at)) {
    return Response.json(
      { error: `You are already on ${tier.name}. It renews automatically.` },
      { status: 400 }
    );
  }

  const paymentId = `pay_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  await q(
    "INSERT INTO payments (id, user_id, product, amount_micros, status) VALUES ($1, $2, $3, $4, 'PENDING')",
    [paymentId, user.id, plan, tier.priceUsdcMicros]
  );

  try {
    const subscriberAddress = isWalletAddress(user.wallet_address)
      ? user.wallet_address!.trim()
      : undefined;
    const { devMode, subscription } = await createSubscription({
      title: `Kris's Script ${tier.name}`,
      description: `${tier.messages} messages per month`,
      amountUsdcMicros: tier.priceUsdcMicros,
      interval: PLAN_INTERVAL,
      /* The subscriber's on-chain address, and the reason the DM flow works or
         doesn't: publishing creates the catalogue plan, but SubScript only
         writes the DM subscription offer when it also receives `subscriber`.
         Without it you get a plan in the picker and an empty thread.

         wallet_address is address-only now that commit ids have their own
         column, so this is normally just the stored value; the guard stays
         because the API rejects anything else as "invalid subscriber address"
         and older rows may predate the split. */
      subscriber: subscriberAddress,
      /* Our stable key for this customer. Comes back on every subscription
         event as merchant_customer_id / external_reference, and is returned by
         GET /api/v1/subscriptions, so the mapping survives both a missed
         delivery and a resume — which mints a new subscription id. */
      externalReference: `user:${user.id}:plan:${plan}`,
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
      /* Reported so the caller does not have to infer why a DM did or did not
         arrive. Publishing alone puts the plan in the catalogue; the DM offer
         additionally needs the subscriber's address. */
      published: publishToDmEnabled(),
      dmOffer: publishToDmEnabled() && !!subscriberAddress,
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

/** The plan catalogue, so the pricing page renders from one definition. */
export async function GET() {
  return Response.json({
    interval: PLAN_INTERVAL,
    plans: Object.values(PLANS),
  });
}
