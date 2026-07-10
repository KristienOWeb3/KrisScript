import crypto from "crypto";
import { one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { hasRealKey, signWebhook } from "@/lib/subscript";
import type { Payment } from "@/lib/billing";

/**
 * DEV MODE ONLY: simulates SubScript completing a checkout by POSTing a
 * signed payment.succeeded event to our own webhook endpoint — the exact
 * payload shape and signature scheme SubScript documents. Disabled the
 * moment a real SUBSCRIPT_SECRET_KEY is configured.
 */
export async function POST(req: Request) {
  if (hasRealKey()) {
    return Response.json({ error: "Not available with a real SubScript key." }, { status: 404 });
  }
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { intentId } = (await req.json().catch(() => ({}))) as { intentId?: string };
  const payment = await one<Payment>(
    "SELECT * FROM payments WHERE intent_id = $1 AND user_id = $2",
    [intentId, user.id]
  );
  if (!payment) return Response.json({ error: "Unknown intent." }, { status: 404 });

  const event = {
    id: `evt_dev_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
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
