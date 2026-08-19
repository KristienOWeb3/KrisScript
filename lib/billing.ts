import { q, one } from "./db";
import { getIntent, intentIsPaid } from "./subscript";
import { PLAN_ORDER, getPlan, planIsActive, planPeriodStart } from "./plans";

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

/**
 * Ask SubScript whether this user's unpaid payments have in fact been paid, and
 * fulfill the ones that have.
 *
 * Webhook delivery is the fast path but not a reliable one — a queue stalled on
 * SubScript's side left real, paid charges unfulfilled for weeks here. This is
 * the pull counterpart: SubScript is still the sole authority on whether money
 * moved, so this grants nothing the browser asked for, it only stops us waiting
 * to be told something we can look up.
 *
 * Fails closed. An unknown status, an unreachable API, a 404, or an amount that
 * disagrees with what we recorded all leave the payment pending.
 */
export async function reconcilePendingPayments(
  userId: number
): Promise<{ checked: number; fulfilled: string[]; mismatched: string[] }> {
  const { rows } = await q(
    "SELECT * FROM payments WHERE user_id = $1 AND status <> 'PAID' ORDER BY created_at ASC",
    [userId]
  );
  const pending = rows as Payment[];

  const fulfilled: string[] = [];
  const mismatched: string[] = [];

  for (const payment of pending) {
    if (!payment.intent_id) continue;
    // Subscriptions carry a sub_ id and are not one-time intents.
    if (payment.intent_id.startsWith("sub_")) continue;

    const { intent } = await getIntent(payment.intent_id);
    if (!intent || !intentIsPaid(intent)) continue;

    /* Verify the amount before granting anything. Without this, an intent for a
       cheaper product could be pointed at an expensive payment row. */
    const reported = String(
      intent.amountUsdcMicros ?? intent.amount_usdc_micros ?? ""
    ).trim();
    if (reported !== String(payment.amount_micros).trim()) {
      mismatched.push(payment.id);
      console.warn(
        `[reconcile] amount mismatch for ${payment.id}: intent reports ${reported}, we recorded ${payment.amount_micros}`
      );
      continue;
    }

    const externalReference = `${payment.product}:${payment.user_id}:${payment.id}`;
    const result = await fulfillPayment(payment.intent_id, externalReference, intent);
    if (result.ok && !result.already) fulfilled.push(payment.id);
  }

  return { checked: pending.length, fulfilled, mismatched };
}

/**
 * Where a user stands against their plan allowance this billing month.
 *
 * Single source of truth so the chat gate and /api/me cannot drift: both the
 * decision to bill against the plan and the number shown to the user come from
 * here. Usage counts messages billed under ANY plan tier within the current
 * period, not just the current tier, so upgrading mid-month keeps the usage
 * already spent rather than handing out a fresh allowance.
 */
export async function planQuota(user: {
  id: number;
  plan?: string | null;
  plan_expires_at?: number | null;
}): Promise<{
  planId: string | null;
  planName: string | null;
  active: boolean;
  cap: number;
  used: number;
  remaining: number;
  periodStart: number;
  expiresAt: number | null;
}> {
  const plan = getPlan(user.plan);
  const active = planIsActive(user.plan, user.plan_expires_at);

  if (!plan || !active) {
    return {
      planId: plan?.id ?? null,
      planName: plan?.name ?? null,
      active: false,
      cap: 0,
      used: 0,
      remaining: 0,
      periodStart: 0,
      expiresAt: user.plan_expires_at ?? null,
    };
  }

  const periodStart = planPeriodStart(user.plan_expires_at);
  const row = await one<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM messages
      WHERE user_id = $1 AND role = 'user'
        AND billed = ANY($2) AND created_at >= $3`,
    [user.id, PLAN_ORDER, periodStart]
  );
  const used = row?.c ?? 0;

  return {
    planId: plan.id,
    planName: plan.name,
    active: true,
    cap: plan.messages,
    used,
    remaining: Math.max(0, plan.messages - used),
    periodStart,
    expiresAt: user.plan_expires_at ?? null,
  };
}
