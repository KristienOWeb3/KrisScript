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

  await q(
    "INSERT INTO webhook_events (id, event_type, raw_body) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [event.id, event.type, rawBody]
  );

  const now = Math.floor(Date.now() / 1000);
  const claim = await q(
    "UPDATE webhook_events SET processing_at = $2, error = NULL WHERE id = $1 AND processed_at IS NULL AND (processing_at IS NULL OR processing_at < $3)",
    [event.id, now, now - 300]
  );
  if (claim.rowCount === 0) {
    return Response.json({ received: true, duplicate: true });
  }

  try {
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
    await q(
      "UPDATE webhook_events SET processed_at = $2, processing_at = NULL, error = NULL WHERE id = $1",
      [event.id, Math.floor(Date.now() / 1000)]
    );
  } catch (err) {
    await q(
      "UPDATE webhook_events SET processing_at = NULL, error = $2 WHERE id = $1",
      [event.id, (err as Error).message]
    );
    throw err;
  }

  return Response.json({ received: true });
}
