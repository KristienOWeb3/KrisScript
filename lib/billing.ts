import { q, one } from "./db";
import type { User } from "./auth";

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
    const paymentId = merchantReference.split(":")[2];
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
  return { ok: true };
}

export async function handleSubscriptionEvent(
  type: string,
  data: any
): Promise<{ ok: boolean; reason?: string }> {
  return { ok: true };
}

