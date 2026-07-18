import { q } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/subscript";
import { fulfillPayment, handleSubscriptionEvent } from "@/lib/billing";

/**
 * SubScript webhook receiver.
 * Per the SubScript docs: read the RAW body before parsing, verify the
 * HMAC signature, claim event.id atomically (UNIQUE), then fulfill.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-subscript-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return Response.json({ error: "Invalid or expired signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!event?.id || !event?.type) {
    return Response.json({ error: "Malformed event" }, { status: 400 });
  }

  // Atomic claim: duplicate deliveries are acknowledged but not re-fulfilled.
  const claim = await q(
    "INSERT INTO webhook_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
    [event.id]
  );
  if (claim.rowCount === 0) {
    return Response.json({ received: true, duplicate: true });
  }

  // "payment.success" is SubScript's documented legacy alias.
  if (event.type === "payment.succeeded" || event.type === "payment.success") {
    const result = await fulfillPayment(event.data?.intent_id, event.data?.merchant_reference);
    if (!result.ok) {
      console.warn("[webhook] payment.succeeded for unknown payment", event.data);
    }
  } else if (typeof event.type === "string" && event.type.startsWith("subscription.")) {
    const result = await handleSubscriptionEvent(event.type, event.data ?? {});
    if (!result.ok) {
      console.warn(`[webhook] ${event.type} for unknown subscription`, event.data);
    }
  }

  return Response.json({ received: true });
}
