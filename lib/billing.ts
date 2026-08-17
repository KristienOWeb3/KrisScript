import { q, one } from "./db";

export type Payment = {
  id: string;
  user_id: number;
  product: string;
  amount_micros: string;
  intent_id: string | null;
  receipt_token: string | null;
  status: string;
  created_at: number;
};

/**
 * Fulfill a payment referenced by a verified webhook.
 */
export async function fulfillPayment(
  intentId: string | undefined,
  merchantReference: string | undefined,
  eventData?: any
): Promise<{ ok: boolean; already?: boolean; reason?: string }> {
  let payment: Payment | undefined;
  if (intentId) {
    payment = await one<Payment>("SELECT * FROM payments WHERE intent_id = $1", [intentId]);
  }
  if (!payment && merchantReference) {
    const parts = merchantReference.split(":");
    const paymentId = parts[2] || parts[0];
    if (paymentId) {
      payment = await one<Payment>("SELECT * FROM payments WHERE id = $1", [paymentId]);
    }
  }
  if (!payment) return { ok: false, reason: "payment_not_found" };

  const wallet = eventData?.subscriber || eventData?.subscriber_address || eventData?.user_address || eventData?.wallet_address;
  if (wallet) {
    await q("UPDATE users SET wallet_address = COALESCE(wallet_address, $1) WHERE id = $2", [wallet, payment.user_id]);
  }

  const claim = await q(
    "UPDATE payments SET status = 'PAID' WHERE id = $1 AND status <> 'PAID'",
    [payment.id]
  );
  if (claim.rowCount === 0) return { ok: true, already: true };

  await q("UPDATE users SET activated = 1 WHERE id = $1", [payment.user_id]);

  // If this was a plan payment, activate the plan for 30 days
  if (payment.product === "pro" || payment.product === "promax" || payment.product === "ultra") {
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86400;
    await q(
      "UPDATE users SET plan = $1, plan_expires_at = $2, sub_status = 'active', sub_cancel_at_period_end = 0 WHERE id = $3",
      [payment.product, expiresAt, payment.user_id]
    );
  }

  // Paid display-name change: promote the parked name now that $1 has cleared.
  // Guarded on pending_display_name being non-null so a replayed webhook after
  // a later change can't resurrect an older name.
  if (payment.product === "name_change") {
    await q(
      `UPDATE users
          SET display_name = pending_display_name,
              pending_display_name = NULL
        WHERE id = $1 AND pending_display_name IS NOT NULL`,
      [payment.user_id]
    );
  }

  return { ok: true };
}

export async function handleSubscriptionEvent(
  type: string,
  data: any
): Promise<{ ok: boolean; reason?: string }> {
  const subId = data.subscription_id || data.id;
  const extRef = data.external_reference || data.externalReference || "";
  let userId: number | undefined;
  let planName = "pro";

  if (extRef) {
    // Expected format: user:{userId}:plan:{product} or {product}:{userId}:{paymentId}
    const match = extRef.match(/user:(\d+):plan:(pro|promax|ultra)/) || extRef.match(/(pro|promax|ultra):(\d+)/);
    if (match) {
      if (extRef.startsWith("user:")) {
        userId = parseInt(match[1], 10);
        planName = match[2];
      } else {
        planName = match[1];
        userId = parseInt(match[2], 10);
      }
    }
  }

  if (!userId && subId) {
    const payment = await one<Payment>("SELECT * FROM payments WHERE intent_id = $1", [subId]);
    if (payment) {
      userId = payment.user_id;
      planName = payment.product;
    }
  }

  if (!userId) return { ok: false, reason: "user_not_found" };

  const now = Math.floor(Date.now() / 1000);
  const thirtyDays = 30 * 86400;

  if (type === "subscription.created" || type === "subscription.renewed" || type === "subscription.active") {
    await q(
      `UPDATE users SET 
         plan = $1, 
         plan_expires_at = $2, 
         subscription_id = $3, 
         sub_status = 'active', 
         sub_cancel_at_period_end = 0 
       WHERE id = $4`,
      [planName, now + thirtyDays, subId, userId]
    );
  } else if (type === "subscription.canceled" || type === "subscription.deleted") {
    await q(
      "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
      [userId]
    );
  }

  return { ok: true };
}
