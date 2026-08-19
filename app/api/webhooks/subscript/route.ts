import { q } from "@/lib/db";
import {
  verifyWebhookSignature,
  hasWebhookSecret,
  eventObject,
  environmentMismatch,
  field,
} from "@/lib/subscript";
import { fulfillPayment, markPaymentFailed, handleSubscriptionEvent } from "@/lib/billing";

/**
 * SubScript webhook receiver.
 * Per the SubScript docs: read the RAW body before parsing, verify the
 * HMAC signature, claim event.id atomically (UNIQUE), then fulfill.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-subscript-signature");

  /* Distinguish "not configured" from "bad signature". Without this, a missing
     SUBSCRIPT_WEBHOOK_SECRET silently verifies against a literal published in
     this repo, so every genuine delivery 401s and the logs blame the sender. */
  if (!hasWebhookSecret()) {
    console.error(
      "[webhook] SUBSCRIPT_WEBHOOK_SECRET is not set — cannot verify deliveries."
    );
    return Response.json(
      { error: "Webhook secret is not configured on this deployment." },
      { status: 500 }
    );
  }

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

  /* Real deliveries nest the payload under data.object; our own simulator and
     everything already in webhook_events is flat. eventObject() reads both. */
  const payload = eventObject(event.data);

  /* Refuse anything stamped for the other environment. A TEST event arriving at
     a live deployment would otherwise grant a real plan for a sandbox charge.
     4xx rather than 2xx so it is not retried and shows up as a failure on the
     sending side — this is a misconfiguration, not something to swallow. */
  const envProblem = environmentMismatch(payload);
  if (envProblem) {
    console.error(`[webhook] rejected ${event.type}: ${envProblem}`);
    await q("UPDATE webhook_events SET error = $2 WHERE id = $1", [
      event.id,
      `environment_mismatch: ${envProblem}`,
    ]);
    return Response.json({ error: `Environment mismatch — ${envProblem}` }, { status: 400 });
  }

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
      const result = await fulfillPayment(
        field(payload, "intent_id"),
        field(payload, "merchant_reference", "merchant_customer_id", "external_reference"),
        payload
      );
      if (!result.ok) {
        console.warn("[webhook] payment.succeeded for unknown payment", payload);
      }
    } else if (event.type === "payment.failed") {
      /* Recorded so the charge stops looking like one still in flight.
         payment.pending needs nothing: the row is already PENDING. */
      const result = await markPaymentFailed(
        field(payload, "intent_id"),
        field(payload, "merchant_reference", "merchant_customer_id", "external_reference")
      );
      if (!result.ok) {
        console.warn("[webhook] payment.failed for unknown payment", payload);
      }
    } else if (typeof event.type === "string" && event.type.startsWith("subscription.")) {
      const result = await handleSubscriptionEvent(event.type, payload);
      if (!result.ok) {
        console.warn(`[webhook] ${event.type} not applied (${result.reason})`, payload);
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
