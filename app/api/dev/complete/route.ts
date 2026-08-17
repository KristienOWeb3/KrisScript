import crypto from "crypto";
import { one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { signWebhook } from "@/lib/subscript";
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

  const { intentId, eventType } = (await req.json().catch(() => ({}))) as {
    intentId?: string;
    eventType?: string;
  };
  const payment = await one<Payment>(
    "SELECT * FROM payments WHERE intent_id = $1 AND user_id = $2",
    [intentId, user.id]
  );
  if (!payment) return Response.json({ error: "Unknown intent." }, { status: 404 });

  const isSubscription = payment.product === "pro" || payment.product === "promax" || payment.product === "ultra";
  const externalReference = `${payment.product}:${payment.user_id}:${payment.id}`;
  
  const targetType =
    eventType || (isSubscription ? "subscription.created" : "payment.succeeded");

  let eventData: any = {
    amount_usdc_micros: payment.amount_micros,
    currency: "USDC",
    transaction_hash: `0x${crypto.randomBytes(32).toString("hex")}`,
    chain_id: 5042002,
    simulated: true,
  };

  if (isSubscription) {
    eventData = {
      ...eventData,
      subscription_id: payment.intent_id,
      status: targetType.endsWith("canceled") ? "canceled" : "active",
      external_reference: externalReference,
      cancel_at_period_end: targetType.endsWith("canceled"),
    };
  } else {
    eventData = {
      ...eventData,
      intent_id: payment.intent_id,
      merchant_reference: externalReference,
      receipt_id: payment.receipt_token,
    };
  }

  const event = {
    id: `evt_dev_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: targetType,
    created: Math.floor(Date.now() / 1000),
    data: eventData,
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
