import { q, one } from "./db";
import {
  getIntent,
  intentIsPaid,
  getSubscription,
  cancelSubscription,
  hasRealKey,
  eventObject,
  field,
  toEpochSeconds,
  paymentParties,
  isSponsoredPayment,
  sponsoredDurationSeconds,
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
): Promise<{ ok: boolean; already?: boolean; gifted?: boolean; reason?: string }> {
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
  /* No row of ours matches. Before giving up, consider that this may be a
     payment we never initiated: a sponsored one, where a friend paid for
     somebody's plan straight from a DM. Those arrive with a beneficiary and no
     reference of ours — payment.succeeded carries no external_reference at all —
     so the only key available is the beneficiary's address. */
  if (!payment) {
    if (isSponsoredPayment(obj)) return fulfillSponsoredPayment(obj);
    return { ok: false, reason: "payment_not_found" };
  }

  const { payer, beneficiary } = paymentParties(obj);

  /* Record both sides on the ledger row regardless of what happens next. Which
     wallet signed is the difference between a refundable charge and an
     unexplained one, and it is not recoverable later: the event is the only
     place it appears. */
  if (payer || beneficiary) {
    await q(
      `UPDATE payments
          SET payer_address = COALESCE(payer_address, $1),
              beneficiary_address = COALESCE(beneficiary_address, $2),
              is_sponsored = CASE WHEN $3 THEN 1 ELSE is_sponsored END
        WHERE id = $4`,
      [payer, beneficiary, isSponsoredPayment(obj), payment.id]
    );
  }

  /* Adopt an address onto the account only when nobody else is involved.

     The rule is deliberately narrow. `beneficiary_address` names the account to
     fulfill and `payer_address` the wallet that signed; when they differ, a third
     party paid and NEITHER address reliably belongs to this account — so writing
     either would be a guess. Getting it wrong is not cosmetic: wallet_address is
     what later checkouts send as `subscriber`, so an absorbed stranger's address
     routes every future DM offer to the wrong person.

     COALESCE means an address already on file always wins, so this can only ever
     fill a blank. */
  const selfPaid = !payer || !beneficiary || payer === beneficiary;
  const ownAddress = beneficiary ?? payer;
  if (selfPaid && ownAddress) {
    await q("UPDATE users SET wallet_address = COALESCE(wallet_address, $1) WHERE id = $2", [
      ownAddress,
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
 * Credit a payment somebody else made on a subscriber's behalf.
 *
 * This is the "ask a friend to pay" case. Nothing here was initiated by us, so
 * there is no pending payments row to settle and none of our own identifiers are
 * on the event — `payment.succeeded` carries no external_reference or
 * merchant_customer_id at all. The single usable key is `beneficiary_address`,
 * which means sponsorship can only ever resolve for an account that has a 0x
 * address on file. That is a real limitation rather than an oversight: no other
 * mapping is available.
 *
 * SubScript's instruction is to credit the beneficiary rather than the payer, and
 * where the beneficiary already has access, to extend the existing window rather
 * than reject the delivery or hand out a duplicate.
 */
export async function fulfillSponsoredPayment(
  obj: any
): Promise<{ ok: boolean; already?: boolean; gifted?: boolean; reason?: string }> {
  const { payer, beneficiary } = paymentParties(obj);
  if (!beneficiary) return { ok: false, reason: "no_beneficiary" };

  const user = await one<{
    id: number;
    plan: string;
    plan_expires_at: number | null;
    subscription_id: string | null;
    sub_status: string | null;
  }>(
    `SELECT id, plan, plan_expires_at, subscription_id, sub_status
       FROM users WHERE lower(wallet_address) = $1`,
    [beneficiary]
  );
  if (!user) return { ok: false, reason: "beneficiary_not_registered" };

  /* Claim the charge before granting anything. The webhook route already makes a
     repeat of the same event id a no-op, but the same money can arrive under two
     event ids — payment.succeeded and its legacy payment.success alias — and a
     second grant would silently double the window. The UNIQUE primary key
     arbitrates. */
  const intentId = String(
    field(obj, "intent_id") ?? field(obj, "checkout_session_id") ?? ""
  ).trim();
  if (!intentId) return { ok: false, reason: "no_intent_id" };
  const paymentId = `spon_${intentId}`.slice(0, 64);
  const amountMicros = String(field(obj, "amount_usdc_micros") ?? "").trim();
  const tier = tierFromEventAmount(obj);

  const claim = await q(
    `INSERT INTO payments
       (id, user_id, product, amount_micros, intent_id, status,
        payer_address, beneficiary_address, is_sponsored)
     VALUES ($1, $2, $3, $4, $5, 'PAID', $6, $7, 1)
     ON CONFLICT (id) DO NOTHING`,
    [paymentId, user.id, tier ?? "sponsored", amountMicros, intentId, payer, beneficiary]
  );
  if (claim.rowCount === 0) return { ok: true, already: true };

  await q("UPDATE users SET activated = 1 WHERE id = $1", [user.id]);

  /* Extend from where access currently ends, not from now — otherwise a gift to
     someone mid-period silently shortens what they already paid for. */
  const now = Math.floor(Date.now() / 1000);
  const duration = sponsoredDurationSeconds(obj) ?? PLAN_DURATION_SECONDS;
  const active = planIsActive(user.plan, user.plan_expires_at);
  const expiresAt = (active ? user.plan_expires_at! : now) + duration;

  /* Never move someone down a tier on a gift. A Pro-priced gift to an Ultra
     subscriber buys time, not a demotion, so the tier only changes when the
     account has no live plan or the gift is for an equal or higher one. */
  const currentRank = isPlanId(user.plan) ? PLAN_ORDER.indexOf(user.plan) : -1;
  const giftRank = tier ? PLAN_ORDER.indexOf(tier) : -1;
  const grantedPlan = active && currentRank > giftRank ? user.plan : (tier ?? user.plan);
  if (!isPlanId(grantedPlan)) return { ok: false, reason: "plan_unknown" };

  /* Whether a recurring authorization of the subscriber's own is still standing.
     This decides what the gift actually means to them:

      - With a live subscription, the gift is just extra time on top. Their own
        subscription keeps renewing, so nothing about the account changes state
        and there is nothing to warn them about.
      - Without one, the gift IS their access. It settles as a one-time payment
        with no standing authorization behind it, so it will not renew and the
        plan stops when the duration runs out. That has to be visible, or the
        account looks exactly like a paying subscriber until it silently lapses.

     subscription_id is deliberately left alone either way — it is the handle
     cancel needs, and clearing it would strand a real subscription. */
  const liveSubscription =
    !!user.subscription_id && ["active", "canceling"].includes(String(user.sub_status || ""));

  await q(
    `UPDATE users
        SET plan = $1,
            plan_expires_at = $2,
            plan_gifted = $3,
            plan_gifted_by = CASE WHEN $3 = 1 THEN $4 ELSE plan_gifted_by END,
            sub_status = CASE WHEN $3 = 1 THEN 'gifted' ELSE sub_status END,
            sub_cancel_at_period_end = CASE WHEN $3 = 1 THEN 1 ELSE sub_cancel_at_period_end END,
            sub_alert = NULL
      WHERE id = $5`,
    [grantedPlan, expiresAt, liveSubscription ? 0 : 1, payer, user.id]
  );

  return { ok: true, gifted: !liveSubscription };
}

/**
 * What to tell someone whose plan was paid for by another account.
 *
 * A gift is a one-time payment, not a subscription: it buys a single duration and
 * leaves no standing authorization, so nothing renews and access ends on the
 * date below. Saying so plainly matters — the account otherwise looks identical
 * to a paying subscriber right up to the moment it silently stops.
 *
 * Kept next to the handler that sets the flag so the wording and the trigger
 * cannot drift apart, the same way subAlertMessage is.
 */
export function giftNotice(user: {
  plan_gifted?: number | null;
  plan_gifted_by?: string | null;
  plan_expires_at?: number | null;
  plan?: string | null;
}): string | null {
  if (!user.plan_gifted) return null;
  const tier = getPlan(user.plan);
  const name = tier ? tier.name : "Your plan";
  const ends = user.plan_expires_at
    ? new Date(user.plan_expires_at * 1000).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  const payer = user.plan_gifted_by
    ? `${user.plan_gifted_by.slice(0, 6)}…${user.plan_gifted_by.slice(-4)}`
    : "another account";

  return (
    `${name} was paid for by ${payer}. This was a one-time gift payment, not a subscription — ` +
    `it will not renew${ends ? `, and access ends on ${ends}` : ""}. ` +
    `Subscribe yourself before then to keep going without a gap.`
  );
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

/** Parse the reference this app sends at creation, in any historical form. */
function parsePlanReference(
  reference: string
): { userId: number; planName?: PlanId } | undefined {
  /* "user:{id}" — the current form. Deliberately carries no tier: SubScript
     models an upgrade as a new subscription that keeps the SAME customer id, so
     a reference naming the tier changes identity every time someone moves up,
     which is exactly what the reference exists to prevent. The tier is recovered
     from the charged amount instead, via planToGrant(). */
  const customer = reference.match(/^user:(\d+)$/i);
  if (customer) {
    const userId = Number(customer[1]);
    if (userId > 0) return { userId };
  }
  // "user:{id}:plan:{tier}" — the previous form, still live on older subscriptions.
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
 * Cancel the subscription an upgrade replaced, once the replacement is live.
 *
 * SubScript models a tier change as a new subscription rather than an edit to the
 * old one, and each subscription is an independent on-chain authorization — so
 * two active records for one subscriber are two things that will charge. Nothing
 * cancelled the old one, which meant an upgrade quietly doubled the bill and the
 * stale subscription's next renewal would drag the tier back down to what it used
 * to be.
 *
 * Deliberately runs after the grant, never before: cancelling first would leave
 * the subscriber with nothing if the new checkout were abandoned.
 *
 * Two sources for the id to retire, in order:
 *
 *  1. `payments.supersedes_subscription_id`, parked at checkout. This is the
 *     normal case — an upgrade started from our own pricing page.
 *  2. The id the account held before this event, when the tier actually changed.
 *     This is the safety net for a tier change we did not initiate, which has no
 *     payments row to carry the supersede. We do not build or expose that path,
 *     but a subscriber picking a higher tier straight from their DM plan picker
 *     would otherwise end up paying for both.
 */
async function retireSupersededSubscription(
  userId: number,
  opts: {
    activeIds: (string | null | undefined)[];
    priorSubscriptionId: string | null;
    tierChanged: boolean;
  }
): Promise<void> {
  const active = opts.activeIds.filter(Boolean).map(String);

  const recorded = active.length
    ? await one<{ id: string; supersedes_subscription_id: string }>(
        `SELECT id, supersedes_subscription_id FROM payments
           WHERE intent_id = ANY($1) AND supersedes_subscription_id IS NOT NULL
           LIMIT 1`,
        [active]
      )
    : undefined;

  const target =
    recorded?.supersedes_subscription_id ??
    (opts.tierChanged ? opts.priorSubscriptionId : null);

  // Nothing to do, or the "old" id is the one that just activated.
  if (!target || active.includes(target)) {
    if (recorded) {
      await q("UPDATE payments SET supersedes_subscription_id = NULL WHERE id = $1", [
        recorded.id,
      ]);
    }
    return;
  }

  const user = await one<{ wallet_address: string | null }>(
    "SELECT wallet_address FROM users WHERE id = $1",
    [userId]
  );
  try {
    const res = await cancelSubscription(target, user?.wallet_address ?? undefined);
    if (res.status >= 400) {
      console.warn(
        `[upgrade] could not cancel superseded subscription ${target} (HTTP ${res.status})`,
        res.body
      );
    }
  } catch (err) {
    console.warn(`[upgrade] cancel of superseded subscription ${target} threw`, err);
  }

  /* Cleared whatever the outcome. A failed cancel is worth a log, but retrying it
     on every later renewal event is not — and the merchant dashboard is the place
     to settle a stuck authorization. */
  if (recorded) {
    await q("UPDATE payments SET supersedes_subscription_id = NULL WHERE id = $1", [recorded.id]);
  }
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

  /* What the account looked like before this event. Read up front because the
     grant below repoints users.subscription_id, and the id being replaced is the
     only handle on the authorization that has to stop charging. */
  const prior = await one<{ subscription_id: string | null; plan: string }>(
    "SELECT subscription_id, plan FROM users WHERE id = $1",
    [userId]
  );

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
                sub_alert = NULL,
                plan_gifted = 0,
                plan_gifted_by = NULL
          WHERE id = $5`,
        [plan, subscriptionPeriodEnd(obj, now), subId, checkoutId, userId]
      );
      /* Settle the originating payment row too. This function only ever touched
         users, so a subscription could be fully active while its payment stayed
         PENDING forever — and anything keyed off payment status, such as the
         return page, could never report it as confirmed. */
      await settleSubscriptionPayment(subId, checkoutId);
      /* Now that the replacement is live, stop the one it replaced from
         charging. No-op on a renewal and on a first subscription. */
      await retireSupersededSubscription(userId, {
        activeIds: [subId, checkoutId],
        priorSubscriptionId: prior?.subscription_id ?? null,
        tierChanged: !!prior && prior.plan !== plan,
      });
      return { ok: true };
    }

    /* ── Resumed ──────────────────────────────────────────────────────── */
    case "reactivated": {
      /* This branch used to leave plan_expires_at alone on purpose, reasoning
         that a resume charges nothing and the subscriber simply keeps the period
         they had already paid for. That is wrong. SubScript documents no free
         revival — the only resubscribe primitive it exposes points at minting a
         NEW checkout at the plan's regular price — and in practice the same
         amount is debited on resume. So the old behaviour took the money and
         extended nothing.

         The period end SubScript states is now authoritative. Extending only to
         a stated end is what keeps this safe in both directions: it cannot
         over-grant on a genuinely free resume (none is stated, nothing moves)
         and it cannot under-grant on a charged one. */
      const stated = statedPeriodEnd(obj);
      await q(
        `UPDATE users
            SET plan_expires_at = COALESCE($1::integer, plan_expires_at),
                subscription_id = COALESCE($2::text, subscription_id),
                sub_checkout_id = COALESCE($3::text, sub_checkout_id),
                sub_status = 'active',
                sub_cancel_at_period_end = 0,
                sub_alert = NULL
          WHERE id = $4`,
        [stated, subId, checkoutId, userId]
      );
      /* A resume that charged has a payments row behind it, same as any other
         checkout, and it stays PENDING forever unless settled here. */
      await settleSubscriptionPayment(subId, checkoutId);
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
