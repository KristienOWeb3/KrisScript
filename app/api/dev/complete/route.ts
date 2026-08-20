import crypto from "crypto";
import { one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { signWebhook, expectedEnvironment } from "@/lib/subscript";
import { isPlanId, PLAN_DURATION_SECONDS } from "@/lib/plans";
import type { Payment } from "@/lib/billing";

/**
 * DEV MODE ONLY: simulates SubScript completing a checkout by POSTing a
 * signed payment.succeeded or subscription.* event to our own webhook endpoint.
 *
 * This route holds the webhook signing secret, so it can mint an event that
 * /api/webhooks/subscript will accept as genuine. That makes it a complete
 * bypass of the payment gate — any signed-in user could fulfill their own
 * pending intent for free — so it must never be reachable in production. The
 * docblock used to claim "DEV MODE ONLY" while nothing enforced it.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { intentId, eventType, gift } = (await req.json().catch(() => ({}))) as {
    intentId?: string;
    eventType?: string;
    /** Simulate a payment settled by another wallet on this account's behalf. */
    gift?: boolean;
  };

  /* With no intentId, fall back to this user's newest unpaid payment. Locally
     SubScript cannot reach the app, so every checkout parks as PENDING and the
     common case is "finish the one I just started" — digging the intent id out
     of the checkout URL first is friction with no purpose. */
  const payment = intentId
    ? await one<Payment>(
        "SELECT * FROM payments WHERE intent_id = $1 AND user_id = $2",
        [intentId, user.id]
      )
    : await one<Payment>(
        "SELECT * FROM payments WHERE user_id = $1 AND status <> 'PAID' ORDER BY created_at DESC LIMIT 1",
        [user.id]
      );
  if (!payment) {
    return Response.json(
      {
        error: intentId
          ? "Unknown intent."
          : "No pending payment found for this account.",
      },
      { status: 404 }
    );
  }

  const isSubscription = isPlanId(payment.product);
  const externalReference = `${payment.product}:${payment.user_id}:${payment.id}`;

  /* A gift settles as a ONE-TIME payment even when the product is a plan tier:
     the friend pays for one duration and no recurring authorization is created on
     their wallet. So it takes the payment.succeeded path regardless of product,
     and the subscription branch is skipped. */
  if (gift && !user.wallet_address) {
    return Response.json(
      {
        error:
          "Simulating a gift needs a wallet address on this account. A real gift resolves only via beneficiary_address, so with nothing on file there is nothing to map the payment to.",
      },
      { status: 400 }
    );
  }

  const targetType =
    eventType || (isSubscription && !gift ? "subscription.activated" : "payment.succeeded");
  const kind = targetType.replace(/^subscription\./, "");
  const now = Math.floor(Date.now() / 1000);
  const environment = expectedEnvironment() ?? "TEST";

  let eventData: any = {
    // Deliveries are stamped with their environment; an unstamped one used to
    // be dead-lettered. The receiver rejects a stamp that disagrees with the
    // configured key, so simulate the one this deployment expects.
    environment,
    livemode: environment === "LIVE",
    amount_usdc_micros: payment.amount_micros,
    currency: "USDC",
    transaction_hash: `0x${crypto.randomBytes(32).toString("hex")}`,
    chain_id: 5042002,
    simulated: true,
  };

  if (isSubscription && targetType.startsWith("subscription.") && !gift) {
    const resumedId = `sub_resumed_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const winding = kind === "canceled" || kind === "cancel_scheduled";
    eventData = {
      ...eventData,
      /* A resume mints a NEW authorization and names the one it replaces —
         the whole point of the reactivated event. Everything else keeps the
         id the checkout produced. */
      subscription_id: kind === "reactivated" ? resumedId : payment.intent_id,
      ...(kind === "reactivated"
        ? {
            previous_subscription_id: user.subscription_id || payment.intent_id,
            churn_kind: "voluntary",
            days_since_churn: 0,
            reason: "Resumed by subscriber; charged at the plan's regular price",
          }
        : {}),
      source_checkout_id: payment.intent_id,
      status: winding ? "canceled" : kind === "payment_failed" ? "past_due" : "active",
      cancel_at_period_end: winding,
      /* Both spellings of the reference, as real deliveries send. */
      external_reference: externalReference,
      merchantCustomerId: externalReference,
      /* The stated period end, so expiry does not have to be derived.
         Included for a resume too, which it previously was not: that omission
         encoded the belief that a resume is free and must not extend the
         period. It is not free — the same amount is debited — so leaving it out
         meant the subscriber paid and got no additional access, and the
         simulator faithfully reproduced the bug it was meant to catch. */
      ...(kind === "activated" ||
      kind === "renewed" ||
      kind === "created" ||
      kind === "reactivated"
        ? { current_period_end_timestamp: now + PLAN_DURATION_SECONDS }
        : {}),
    };
  } else {
    eventData = {
      ...eventData,
      intent_id: payment.intent_id,
      merchant_reference: externalReference,
      receipt_id: payment.receipt_token,
      /* A gift: somebody else's wallet settled a charge that entitles this
         account. Both addresses are sent under the names real deliveries use —
         `payer_address` and `beneficiary_address` — because the whole point of
         simulating this is to exercise the branch that tells them apart. The
         beneficiary is the account's own address so it can actually be resolved;
         without one on file a real gift has nothing to map to either. */
      ...(gift
        ? {
            payer_address: `0x${crypto.randomBytes(20).toString("hex")}`,
            beneficiary_address: user.wallet_address,
            is_sponsored: true,
            duration_seconds: PLAN_DURATION_SECONDS,
          }
        : {}),
    };
  }

  const event = {
    id: `evt_dev_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: targetType,
    created: now,
    // Real deliveries nest the payload one level down, under data.object.
    data: { object: eventData },
  };

  const rawBody = JSON.stringify(event);
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/webhooks/subscript`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-subscript-signature": signWebhook(rawBody),
    },
    body: rawBody,
  });
  const body = await res.json().catch(() => ({}));
  return Response.json({ ok: res.ok, webhookStatus: res.status, webhookResponse: body });
}
