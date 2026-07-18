import { q, one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { fulfillPayment, handleSubscriptionEvent, type Payment } from "@/lib/billing";

function validCheckoutId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validReceiptId(value: unknown): value is string {
  return typeof value === "string" && /^rcpt-[a-z0-9]+$/i.test(value);
}

function validTxHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-f0-9]{64}$/i.test(value);
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { status, checkoutId, receiptId, txHash } = (await req.json().catch(() => ({}))) as {
    status?: string;
    checkoutId?: string;
    receiptId?: string;
    txHash?: string;
  };

  if (status !== "success") {
    return Response.json({ error: "SubScript did not return a success status." }, { status: 400 });
  }
  if (!validCheckoutId(checkoutId) || !validReceiptId(receiptId) || !validTxHash(txHash)) {
    return Response.json({ error: "Missing or invalid SubScript return proof." }, { status: 400 });
  }

  const payment = await one<Payment>(
    "SELECT * FROM payments WHERE user_id = $1 AND status = 'PENDING' AND (intent_id = $2 OR intent_id = $3) ORDER BY created_at DESC LIMIT 1",
    [user.id, checkoutId, `sub_${checkoutId}`]
  );
  if (!payment) {
    return Response.json({ confirmed: false, reason: "pending_payment_not_found" }, { status: 404 });
  }

  const externalReference = `${payment.product}:${payment.user_id}:${payment.id}`;
  if (payment.product === "signup") {
    await fulfillPayment(payment.intent_id ?? checkoutId, externalReference);
  } else {
    const subscriptionId = payment.intent_id ?? `sub_${checkoutId}`;
    await q("UPDATE payments SET status = 'PAID', receipt_token = $1 WHERE id = $2", [
      receiptId,
      payment.id,
    ]);
    await handleSubscriptionEvent("subscription.created", {
      subscription_id: subscriptionId,
      status: "active",
      external_reference: externalReference,
    });
  }

  const eventId = `return:${checkoutId}`;
  const rawBody = JSON.stringify({
    id: eventId,
    type: "subscript.return.success",
    data: { checkoutId, receiptId, txHash, paymentId: payment.id, product: payment.product },
  });
  await q(
    "INSERT INTO webhook_events (id, event_type, raw_body, processed_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
    [eventId, "subscript.return.success", rawBody, Math.floor(Date.now() / 1000)]
  );

  return Response.json({ confirmed: true, product: payment.product });
}
