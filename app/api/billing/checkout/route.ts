import crypto from "crypto";
import { q, one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { createSubscription, isWalletAddress, SubScriptError } from "@/lib/subscript";
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
    const { devMode, subscription } = await createSubscription({
      title: `Kris's Script ${tier.name}`,
      description: `${tier.messages} messages per month`,
      amountUsdcMicros: tier.priceUsdcMicros,
      interval: PLAN_INTERVAL,
      /* wallet_address may hold a commit id ("cmt_...") rather than an
         address, since pay-as-you-chat accepts either. Sending a commit id
         here is rejected as "invalid subscriber address", so only pass a
         genuine 0x address and omit the field otherwise.

         createSubscription only forwards externalReference alongside
         subscriber, so omitting it means the webhook arrives without our
         reference — handleSubscriptionEvent then maps the event via the
         subscription id stored on the payments row below, which is why that
         UPDATE matters. */
      subscriber: isWalletAddress(user.wallet_address) ? user.wallet_address! : undefined,
      externalReference: `user:${user.id}:plan:${plan}`,
      idempotencyKey: paymentId,
    });

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
