import db from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/subscript";
import { fulfillPayment } from "@/lib/billing";

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
  const claim = db
    .prepare("INSERT OR IGNORE INTO webhook_events (id) VALUES (?)")
    .run(event.id);
  if (claim.changes === 0) {
    return Response.json({ received: true, duplicate: true });
  }

  // "payment.success" is SubScript's documented legacy alias.
  if (event.type === "payment.succeeded" || event.type === "payment.success") {
    const result = fulfillPayment(event.data?.intent_id, event.data?.merchant_reference);
    if (!result.ok) {
      console.warn("[webhook] payment.succeeded for unknown payment", event.data);
    }
  }

  return Response.json({ received: true });
}
