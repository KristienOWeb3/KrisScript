import { q, one } from "./db";
import {
  getIntent,
  intentIsPaid,
  getSubscription,
  hasRealKey,
  eventObject,
  field,
  toEpochSeconds,
  isWalletAddress,
} from "./subscript";
import {
  PLANS,
  PLAN_ORDER,
  PLAN_DURATION_SECONDS,
  getPlan,
  isPlanId,
  planIsActive,
  planPeriodStart,
  type PlanId,
} from "./plans";

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
  const obj = eventObject(eventData);
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

  /* `beneficiary` is present only when the wallet receiving the service differs
     from the wallet paying, and it is the one entitlement belongs to. Falling
     back to the payer is correct when it is absent, which is the usual case.

     Checked with isWalletAddress before storing: wallet_address is address-only
     now that commit ids have their own column, and this writes a value straight
     off the wire. */
  const wallet =
    field(obj, "beneficiary") ??
    field(obj, "subscriber", "subscriber_address", "user_address", "wallet_address");
  if (isWalletAddress(wallet)) {
    await q("UPDATE users SET wallet_address = COALESCE(wallet_address, $1) WHERE id = $2", [
      String(wallet).trim(),
      payment.user_id,
    ]);
  }

  const claim = await q(
    "UPDATE payments SET status = 'PAID' WHERE id = $1 AND status <> 'PAID'",
    [payment.id]
  );
  if (claim.rowCount === 0) return { ok: true, already: true };

  await q("UPDATE users SET activated = 1 WHERE id = $1", [payment.user_id]);

  // If this was a plan payment, activate the plan for one billing period.
  if (isPlanId(payment.product)) {
    const expiresAt = Math.floor(Date.now() / 1000) + PLAN_DURATION_SECONDS;
    await q(
      "UPDATE users SET plan = $1, plan_expires_at = $2, sub_status = 'active', sub_cancel_at_period_end = 0, sub_alert = NULL WHERE id = $3",
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

/**
 * Add a one-time payment's failure to the ledger so nothing waits on it.
 * Without this a failed charge is indistinguishable from one still in flight,
 * and the return page waits for a confirmation that will never come.
 */
export async function markPaymentFailed(
  intentId: string | undefined,
  merchantReference: string | undefined
): Promise<{ ok: boolean; reason?: string }> {
  const ids = [intentId, merchantReference?.split(":")[2]].filter(Boolean) as string[];
  if (!ids.length) return { ok: false, reason: "no_identifier" };
  const result = await q(
    "UPDATE payments SET status = 'FAILED' WHERE (intent_id = ANY($1) OR id = ANY($1)) AND status = 'PENDING'",
    [ids]
  );
  return result.rowCount > 0 ? { ok: true } : { ok: false, reason: "payment_not_found" };
}

/**
 * Which user, and which tier, a subscription event is about.
 *
 * Order matters. Our own reference comes first because it is the only key that
 * survives a resume: resuming a cancelled subscription mints a NEW
 * subscription_id (the on-chain authorization cannot be revived), so a customer
 * keyed on the id alone reappears as a stranger while their real row looks
 * abandoned. `previous_subscription_id` is what links the new id to the old one,
 * so it is tried before the current id.
 */
async function resolveSubscriptionSubject(obj: any): Promise<{
  userId?: number;
  planName?: PlanId;
  matchedBy?: string;
}> {
  const reference = String(field(obj, "merchant_customer_id", "external_reference") ?? "").trim();
  if (reference) {
    const parsed = parsePlanReference(reference);
    if (parsed) return { ...parsed, matchedBy: "reference" };
  }

  const previousId = field(obj, "previous_subscription_id");
  const currentId = field(obj, "subscription_id");
  const checkoutId = field(obj, "source_checkout_id", "checkout_id");

  for (const [candidate, matchedBy] of [
    [previousId, "previous_subscription_id"],
    [currentId, "subscription_id"],
    [checkoutId, "source_checkout_id"],
  ] as const) {
    if (!candidate) continue;
    const row = await one<{ id: number; plan: string }>(
      "SELECT id, plan FROM users WHERE subscription_id = $1 OR sub_checkout_id = $1",
      [String(candidate)]
    );
    if (row) {
      return {
        userId: row.id,
        planName: isPlanId(row.plan) ? row.plan : undefined,
        matchedBy,
      };
    }
  }

  /* Last resort: the payments row written before the checkout was handed off.
     Its intent_id holds the id creation returned, which is the checkout
     session, not the on-chain subscription id. */
  for (const candidate of [currentId, checkoutId]) {
    if (!candidate) continue;
    const payment = await one<Payment>("SELECT * FROM payments WHERE intent_id = $1", [
      String(candidate),
    ]);
    if (payment) {
      return {
        userId: payment.user_id,
        planName: isPlanId(payment.product) ? payment.product : undefined,
        matchedBy: "payment",
      };
    }
  }

  return {};
}

/** Parse the reference this app sends at creation, in either historical form. */
function parsePlanReference(
  reference: string
): { userId: number; planName?: PlanId } | undefined {
  // "user:{id}:plan:{tier}" — what /api/billing/checkout sends.
  const canonical = reference.match(/^user:(\d+):plan:([a-z]+)$/i);
  if (canonical) {
    const userId = Number(canonical[1]);
    const tier = canonical[2].toLowerCase();
    if (userId > 0) return { userId, planName: isPlanId(tier) ? tier : undefined };
  }
  // "{product}:{userId}:{paymentId}" — the dev simulator and reconcile path.
  const legacy = reference.match(/^([a-z_]+):(\d+)(?::|$)/i);
  if (legacy) {
    const userId = Number(legacy[2]);
    const tier = legacy[1].toLowerCase();
    if (userId > 0) return { userId, planName: isPlanId(tier) ? tier : undefined };
  }
  return undefined;
}

/** The tier whose price matches what this event says is being charged. */
function tierFromEventAmount(obj: any): PlanId | undefined {
  const pricing = field(obj, "pricing");
  const phase = pricing ? String(field(pricing, "phase") ?? "").toLowerCase() : "";
  // Under introductory pricing the charged amount is not the tier's price.
  if (phase && phase !== "regular") return undefined;
  const amount = String(field(obj, "amount_usdc_micros") ?? "").trim();
  if (!amount) return undefined;
  return PLAN_ORDER.find((id) => PLANS[id].priceUsdcMicros === amount);
}

/**
 * The tier to grant, or undefined when it cannot be established.
 *
 * Returning undefined rather than assuming a tier is the point: the previous
 * implementation defaulted to "pro", so an event whose reference did not parse
 * silently moved an Ultra subscriber down to Pro.
 */
async function planToGrant(
  userId: number,
  planName: PlanId | undefined,
  obj: any
): Promise<PlanId | undefined> {
  if (planName) return planName;
  const fromAmount = tierFromEventAmount(obj);
  if (fromAmount) return fromAmount;
  const user = await one<{ plan: string }>("SELECT plan FROM users WHERE id = $1", [userId]);
  return user && isPlanId(user.plan) ? user.plan : undefined;
}

/** The period end SubScript states outright, or null if it did not state one. */
function statedPeriodEnd(obj: any): number | null {
  return (
    toEpochSeconds(field(obj, "current_period_end_timestamp")) ??
    toEpochSeconds(field(obj, "current_period_end"))
  );
}

/**
 * When access runs out.
 *
 * `currentPeriodEnd` is now returned by the API and carried on events, so the
 * usual answer is simply to read it. The fallback derives the end of the period
 * the subscription is currently in from createdAt + intervalSeconds — never
 * `now + interval`, which over-grants on any delayed handling: reconciling a
 * subscription created 25 days ago would otherwise hand out a further full
 * month. Only when neither is available does it come to that.
 */
function subscriptionPeriodEnd(obj: any, now: number): number {
  const stated = statedPeriodEnd(obj);
  if (stated) return stated;

  const interval = Number(field(obj, "interval_seconds"));
  const intervalSeconds =
    Number.isFinite(interval) && interval > 0 ? interval : PLAN_DURATION_SECONDS;
  const created = toEpochSeconds(field(obj, "created_at"));
  if (created) {
    const elapsed = Math.max(0, now - created);
    return created + (Math.floor(elapsed / intervalSeconds) + 1) * intervalSeconds;
  }
  return now + intervalSeconds;
}

/**
 * Settle the payments row a subscription came from.
 *
 * Matched against both ids because the row records what creation returned (the
 * checkout session) while events lead with the on-chain subscription id.
 */
async function settleSubscriptionPayment(...ids: (string | undefined)[]): Promise<void> {
  const candidates = ids.filter(Boolean).map(String);
  if (!candidates.length) return;
  await q(
    "UPDATE payments SET status = 'PAID' WHERE intent_id = ANY($1) AND status <> 'PAID'",
    [candidates]
  );
}

/**
 * Apply a subscription lifecycle event.
 *
 * The event names here are the ones SubScript actually emits: activated,
 * updated, renewed, payment_failed, cancel_scheduled, canceled, reactivated,
 * renewal_upcoming, trial_ending, allowance_low. This app previously handled
 * `subscription.created`, `.active` and `.deleted`, none of which are emitted —
 * so a real activation matched no branch and granted nothing, and the plan only
 * ever appeared because the pull path in reconcilePendingPayments caught it.
 * Those three names are still accepted as aliases so events already stored in
 * webhook_events can be replayed.
 *
 * Names in SubScript's catalogue that nothing emits today — subscription.expired,
 * .recovered, .trial_converted, .winback_offered — deliberately have no branch.
 */
export async function handleSubscriptionEvent(
  type: string,
  data: any
): Promise<{ ok: boolean; reason?: string }> {
  const obj = eventObject(data);
  const kind = type.replace(/^subscription\./, "").toLowerCase();

  const { userId, planName } = await resolveSubscriptionSubject(obj);
  if (!userId) return { ok: false, reason: "user_not_found" };

  const now = Math.floor(Date.now() / 1000);
  const subId = field(obj, "subscription_id") ?? null;
  const checkoutId = field(obj, "source_checkout_id", "checkout_id") ?? null;

  switch (kind) {
    /* ── Access begins or is extended ─────────────────────────────────── */
    case "activated":
    case "renewed":
    case "created": // legacy alias, not emitted
    case "active": {
      // legacy alias, not emitted
      const plan = await planToGrant(userId, planName, obj);
      if (!plan) return { ok: false, reason: "plan_unknown" };
      await q(
        `UPDATE users
            SET plan = $1,
                plan_expires_at = $2,
                subscription_id = COALESCE($3::text, subscription_id),
                sub_checkout_id = COALESCE($4::text, sub_checkout_id),
                sub_status = 'active',
                sub_cancel_at_period_end = 0,
                sub_alert = NULL
          WHERE id = $5`,
        [plan, subscriptionPeriodEnd(obj, now), subId, checkoutId, userId]
      );
      /* Settle the originating payment row too. This function only ever touched
         users, so a subscription could be fully active while its payment stayed
         PENDING forever — and anything keyed off payment status, such as the
         return page, could never report it as confirmed. */
      await settleSubscriptionPayment(subId, checkoutId);
      return { ok: true };
    }

    /* ── Resumed inside the period already paid for ───────────────────── */
    case "reactivated": {
      /* Nothing is charged at a resume. The subscriber keeps the access they
         paid for and the next charge lands on the original period-end date, on
         the original cadence — so plan_expires_at is deliberately left alone.
         Extending it here would hand out a free period on every resume.

         What has changed is the id: the on-chain authorization cannot be
         revived once cancelled, so a resume mints a new one. The row is found
         via the reference or previous_subscription_id, then repointed. */
      await q(
        `UPDATE users
            SET subscription_id = COALESCE($1::text, subscription_id),
                sub_checkout_id = COALESCE($2::text, sub_checkout_id),
                sub_status = 'active',
                sub_cancel_at_period_end = 0,
                sub_alert = NULL
          WHERE id = $3`,
        [subId, checkoutId, userId]
      );
      return { ok: true };
    }

    /* ── The subscription itself changed (amount, interval) ───────────── */
    case "updated": {
      /* Only trust a period end this event actually states. Deriving one here
         could push expiry forward on an event that has nothing to do with a
         charge. And a scheduled cancellation is left untouched: an update is
         not a resume, so clearing the flag would silently un-cancel. */
      const stated = statedPeriodEnd(obj);
      const plan = tierFromEventAmount(obj) ?? planName ?? null;
      await q(
        `UPDATE users
            SET plan = COALESCE($1::text, plan),
                plan_expires_at = COALESCE($2::integer, plan_expires_at),
                subscription_id = COALESCE($3::text, subscription_id),
                sub_checkout_id = COALESCE($4::text, sub_checkout_id)
          WHERE id = $5`,
        [plan, stated, subId, checkoutId, userId]
      );
      return { ok: true };
    }

    /* ── Winding down ─────────────────────────────────────────────────── */
    case "cancel_scheduled": {
      // Requested, effective at period end. Access continues until then.
      await q(
        "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceling' WHERE id = $1",
        [userId]
      );
      return { ok: true };
    }
    case "canceled":
    case "deleted": {
      // legacy alias, not emitted
      /* The authorization is gone. Access still runs to the end of the period
         already paid for — that window is exactly when subscription.reactivated
         can arrive — so plan_expires_at stands and the plan is not cleared. */
      await q(
        "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
        [userId]
      );
      return { ok: true };
    }
    case "payment_failed": {
      await q(
        "UPDATE users SET sub_status = 'past_due', sub_alert = 'payment_failed' WHERE id = $1",
        [userId]
      );
      return { ok: true };
    }

    /* ── Advisory ─────────────────────────────────────────────────────── */
    case "allowance_low":
    case "renewal_upcoming":
    case "trial_ending": {
      /* allowance_low is the consequential one: the spending authorization is
         running out of cycles, and adding USDC does not fix it — the subscriber
         has to re-authorize. It therefore outranks any advisory already
         standing, while a lesser notice never overwrites a live warning. */
      await q(
        `UPDATE users SET sub_alert = $1
           WHERE id = $2 AND ($1::text = 'allowance_low' OR sub_alert IS NULL)`,
        [kind, userId]
      );
      return { ok: true };
    }

    default:
      /* Reserved-but-unemitted names land here, as does anything new. The event
         is still recorded in webhook_events; it simply grants nothing. */
      return { ok: true, reason: `unhandled:${type}` };
  }
}

/**
 * Copy for a standing subscription advisory, or null when there is nothing to
 * say. Kept next to the handler that sets these so the wording and the trigger
 * cannot drift apart.
 */
export function subAlertMessage(alert: string | null | undefined): string | null {
  switch (alert) {
    case "allowance_low":
      return "Your spending authorization is running out of cycles. Adding USDC will not fix this — re-authorize the subscription to keep it renewing.";
    case "payment_failed":
      return "The last renewal charge did not go through. Access continues to the end of the period you have already paid for.";
    case "renewal_upcoming":
      return "Your subscription renews shortly.";
    case "trial_ending":
      return "Your trial is ending shortly.";
    default:
      return null;
  }
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
): Promise<{ checked: number; fulfilled: string[]; mismatched: string[]; expired: string[] }> {
  /* Terminal rows are excluded, not just PAID ones. A checkout that SubScript
     has since expired, or a charge it reports as failed, must stop being polled
     on every page load and must stop being presented as a charge in flight. */
  const { rows } = await q(
    "SELECT * FROM payments WHERE user_id = $1 AND status NOT IN ('PAID', 'EXPIRED', 'FAILED') ORDER BY created_at ASC",
    [userId]
  );
  const pending = rows as Payment[];

  const fulfilled: string[] = [];
  const mismatched: string[] = [];
  const expired: string[] = [];

  for (const payment of pending) {
    if (!payment.intent_id) continue;

    /* Subscriptions are not one-time intents, so GET /api/intent does not apply
       to them. Without this branch they had no pull path at all and stayed
       pending indefinitely whenever the webhook failed to arrive. */
    if (payment.intent_id.startsWith("sub_")) {
      // The dev stub reports every subscription active — never grant on that.
      if (!hasRealKey()) continue;
      const { subscription } = await getSubscription(payment.intent_id);
      if (!subscription) continue;

      const status = String(field(subscription, "status") ?? "").trim().toLowerCase();

      /* Abandoned checkouts now expire after 24 hours rather than sitting at
         `incomplete` forever, so there is finally something definitive to
         record for one that was never completed. */
      if (status === "expired") {
        await q("UPDATE payments SET status = 'EXPIRED' WHERE id = $1 AND status <> 'PAID'", [
          payment.id,
        ]);
        expired.push(payment.id);
        continue;
      }

      /* Only `active` grants. `status` is now derived from the live
         subscription rather than the checkout, so a cancelled subscription no
         longer reports itself as active indefinitely — which it did when this
         check was written. */
      if (status !== "active") continue;

      const subAmount = String(field(subscription, "amount_usdc_micros") ?? "").trim();
      if (subAmount !== String(payment.amount_micros).trim()) {
        mismatched.push(payment.id);
        console.warn(
          `[reconcile] subscription amount mismatch for ${payment.id}: SubScript reports ${subAmount}, we recorded ${payment.amount_micros}`
        );
        continue;
      }

      const result = await handleSubscriptionEvent("subscription.activated", {
        // The on-chain id when the API gives one; DELETE needs that, not the
        // checkout id we recorded at creation.
        subscription_id: field(subscription, "subscription_id") ?? payment.intent_id,
        source_checkout_id:
          field(subscription, "source_checkout_id", "checkout_id") ?? payment.intent_id,
        status: "active",
        external_reference:
          field(subscription, "external_reference") ??
          `${payment.product}:${payment.user_id}:${payment.id}`,
        amount_usdc_micros: payment.amount_micros,
        // Prefer the stated period end; fall back to deriving it from creation.
        current_period_end: field(subscription, "current_period_end"),
        current_period_end_timestamp: field(subscription, "current_period_end_timestamp"),
        created_at: field(subscription, "created_at"),
        interval_seconds: field(subscription, "interval_seconds"),
      });
      if (result.ok) fulfilled.push(payment.id);
      continue;
    }

    const { intent } = await getIntent(payment.intent_id);
    if (!intent) continue;

    // Same treatment as an expired subscription checkout: definitively over.
    if (String(field(intent, "status") ?? "").trim().toUpperCase() === "EXPIRED") {
      await q("UPDATE payments SET status = 'EXPIRED' WHERE id = $1 AND status <> 'PAID'", [
        payment.id,
      ]);
      expired.push(payment.id);
      continue;
    }
    if (!intentIsPaid(intent)) continue;

    /* Verify the amount before granting anything. Without this, an intent for a
       cheaper product could be pointed at an expensive payment row. */
    const reported = String(field(intent, "amount_usdc_micros") ?? "").trim();
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

  return { checked: pending.length, fulfilled, mismatched, expired };
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
