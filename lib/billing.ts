import { q, one } from "./db";
import type { User } from "./auth";
import { PLAN_DURATION_SECONDS, PRODUCTS } from "./plans";

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
 * Fulfill a ONE-TIME payment referenced by a verified payment.succeeded
 * webhook (the $1 activation fee). Subscriptions are handled separately by
 * handleSubscriptionEvent. Idempotent: the PENDING -> PAID flip is the
 * atomic claim, so repeated deliveries fulfill at most once.
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

  if (payment.product === "signup") {
    await q("UPDATE users SET activated = 1 WHERE id = $1", [payment.user_id]);
  } else if (payment.product === "pro" || payment.product === "promax") {
    const now = Math.floor(Date.now() / 1000);
    const externalReference = `${payment.product}:${payment.user_id}:${payment.id}`;
    await handleSubscriptionEvent("subscription.created", {
      subscription_id: payment.intent_id ?? undefined,
      status: "active",
      external_reference: externalReference,
      amount_usdc_micros: payment.amount_micros,
    });
  }
  return { ok: true };
}

type SubEventData = {
  id?: string;
  subscription_id?: string;
  status?: string;
  external_reference?: string;
  externalReference?: string;
  cancel_at_period_end?: boolean;
  cancelAtPeriodEnd?: boolean;
  amount_usdc_micros?: string;
  amountUsdcMicros?: string;
};

/** Resolve which user + product a subscription event belongs to. */
async function resolveSubUser(
  data: SubEventData
): Promise<{ user: User; product: "pro" | "promax" } | null> {
  const ref = data.external_reference || data.externalReference || "";
  const [product, userId] = ref.split(":");
  if ((product === "pro" || product === "promax") && userId) {
    const user = await one<User>("SELECT * FROM users WHERE id = $1", [Number(userId)]);
    if (user) return { user, product };
  }
  const subId = data.subscription_id || data.id;
  if (subId) {
    const user = await one<User>("SELECT * FROM users WHERE subscription_id = $1", [
      subId,
    ]);
    if (user) {
      const p = user.plan === "promax" ? "promax" : "pro";
      return { user, product: p };
    }
    const payment = await one<Payment>(
      "SELECT * FROM payments WHERE intent_id = $1 LIMIT 1",
      [subId]
    );
    if (payment && (payment.product === "pro" || payment.product === "promax")) {
      const user = await one<User>("SELECT * FROM users WHERE id = $1", [payment.user_id]);
      if (user) return { user, product: payment.product };
    }
  }
  return null;
}

/**
 * Handle subscription.* webhooks. A successful charge (created/renewed while
 * active) grants one PLAN_DURATION period; SubScript re-charges each interval
 * and fires subscription.renewed to push it forward. Cancellation / payment
 * failure stop the extension and the plan lapses at plan_expires_at.
 */
export async function handleSubscriptionEvent(
  type: string,
  data: SubEventData
): Promise<{ ok: boolean; reason?: string }> {
  const resolved = await resolveSubUser(data);
  if (!resolved) return { ok: false, reason: "subscription_user_not_found" };
  const { user, product } = resolved;
  const now = Math.floor(Date.now() / 1000);
  const status = data.status || "";
  const subId = data.subscription_id || data.id;

  // Determine current active product by checking payload amounts (handles DM upgrades).
  let activeProduct = product;
  const amt = data.amountUsdcMicros || data.amount_usdc_micros;
  if (amt) {
    if (amt === PRODUCTS.promax.amountUsdcMicros) activeProduct = "promax";
    else if (amt === PRODUCTS.pro.amountUsdcMicros) activeProduct = "pro";
  }

  // Always keep the stored subscription id / status / plan current.
  await q(
    "UPDATE users SET subscription_id = COALESCE($1, subscription_id), sub_status = $2, plan = $4 WHERE id = $3",
    [subId ?? null, status || null, user.id, activeProduct]
  );

  const isCharge =
    type === "subscription.created" ||
    type === "subscription.renewed" ||
    (type === "subscription.updated" && status === "active");

  if (isCharge && status === "active") {
    const existingExpiry =
      user.plan === activeProduct && (user.plan_expires_at ?? 0) > now
        ? user.plan_expires_at!
        : 0;
    const base = existingExpiry > now ? existingExpiry : now;
    const alreadyExtended = existingExpiry > now && type === "subscription.updated";
    if (!alreadyExtended) {
      await q(
        "UPDATE users SET plan_expires_at = $1, sub_cancel_at_period_end = 0 WHERE id = $2",
        [base + PLAN_DURATION_SECONDS, user.id]
      );
  const isCanceled =
    type === "subscription.canceled" ||
    status === "canceled" ||
    status === "cancelled" ||
    data.cancel_at_period_end === true ||
    data.cancelAtPeriodEnd === true;

  if (isCanceled) {
    await q("UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1", [user.id]);
  } else if (type === "subscription.updated") {
    const cancelAt = data.cancel_at_period_end ?? data.cancelAtPeriodEnd;
    if (cancelAt != null) {
      await q("UPDATE users SET sub_cancel_at_period_end = $1 WHERE id = $2", [
        cancelAt ? 1 : 0,
        user.id,
      ]);
    }
  }
  // subscription.payment_failed: status stored above (e.g. past_due); no extension.

  return { ok: true };
}
