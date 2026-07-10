import { q, one } from "./db";
import type { User } from "./auth";
import { PLAN_DURATION_SECONDS } from "./plans";

export type Payment = {
  id: string;
  user_id: number;
  product: "signup" | "pro" | "promax";
  amount_micros: string;
  intent_id: string | null;
  receipt_token: string | null;
  status: string;
  created_at: number;
};

/**
 * Fulfill a payment referenced by a verified payment.succeeded webhook.
 * Looks up by intent_id first, then by the paymentId embedded in
 * externalReference ("product:userId:paymentId"). Idempotent: the
 * PENDING -> PAID flip is the atomic claim, so concurrent or repeated
 * deliveries fulfill at most once.
 */
export async function fulfillPayment(
  intentId: string | undefined,
  merchantReference: string | undefined
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

  const claim = await q(
    "UPDATE payments SET status = 'PAID' WHERE id = $1 AND status <> 'PAID'",
    [payment.id]
  );
  if (claim.rowCount === 0) return { ok: true, already: true };

  const now = Math.floor(Date.now() / 1000);
  if (payment.product === "signup") {
    await q("UPDATE users SET activated = 1 WHERE id = $1", [payment.user_id]);
  } else if (payment.product === "pro" || payment.product === "promax") {
    const user = await one<User>("SELECT * FROM users WHERE id = $1", [payment.user_id]);
    if (user) {
      // Renewing the same plan extends the current period; switching plans starts fresh.
      const base =
        user.plan === payment.product && (user.plan_expires_at ?? 0) > now
          ? user.plan_expires_at!
          : now;
      await q("UPDATE users SET plan = $1, plan_expires_at = $2 WHERE id = $3", [
        payment.product,
        base + PLAN_DURATION_SECONDS,
        payment.user_id,
      ]);
    }
  }
  return { ok: true };
}
