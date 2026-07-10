import db from "./db";
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
 * externalReference ("product:userId:paymentId"). Idempotent.
 */
export function fulfillPayment(
  intentId: string | undefined,
  merchantReference: string | undefined
): { ok: boolean; already?: boolean; reason?: string } {
  let payment: Payment | undefined;
  if (intentId) {
    payment = db.prepare("SELECT * FROM payments WHERE intent_id = ?").get(intentId) as
      | Payment
      | undefined;
  }
  if (!payment && merchantReference) {
    const paymentId = merchantReference.split(":")[2];
    if (paymentId) {
      payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId) as
        | Payment
        | undefined;
    }
  }
  if (!payment) return { ok: false, reason: "payment_not_found" };
  if (payment.status === "PAID") return { ok: true, already: true };

  const now = Math.floor(Date.now() / 1000);
  const apply = db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'PAID' WHERE id = ?").run(payment!.id);
    if (payment!.product === "signup") {
      db.prepare("UPDATE users SET activated = 1 WHERE id = ?").run(payment!.user_id);
    } else if (payment!.product === "pro" || payment!.product === "promax") {
      const user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(payment!.user_id) as User | undefined;
      if (!user) return;
      // Renewing the same plan extends the current period; switching plans starts fresh.
      const base =
        user.plan === payment!.product && (user.plan_expires_at ?? 0) > now
          ? user.plan_expires_at!
          : now;
      db.prepare("UPDATE users SET plan = ?, plan_expires_at = ? WHERE id = ?").run(
        payment!.product,
        base + PLAN_DURATION_SECONDS,
        payment!.user_id
      );
    }
  });
  apply();
  return { ok: true };
}
