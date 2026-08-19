import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { getSubscription, listSubscriptions, field, toEpochSeconds } from "@/lib/subscript";
import { PLAN_ORDER, isPlanId } from "@/lib/plans";

/**
 * Pull this account's subscription state from SubScript.
 *
 * The webhook is the fast path; this is the counterpart for when a delivery was
 * missed. `status` is now derived from the live subscription rather than from
 * the checkout, so it is finally worth trusting — it previously reported a
 * cancelled subscription as `active` indefinitely.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  /* Ids first, cheapest and most direct. subscription_id is the on-chain
     authorization, sub_checkout_id the session it came from; both are accepted
     by GET /api/v1/subscriptions/{id}. */
  let subscription: any = null;
  for (const candidate of [user.subscription_id, user.sub_checkout_id, user.wallet_address]) {
    if (!candidate) continue;
    const found = await getSubscription(candidate);
    if (found.subscription) {
      subscription = found.subscription;
      break;
    }
  }

  /* Then our own reference. It is the only key that survives a resume — that
     mints a new subscription id — so this is what finds a customer who
     cancelled and resumed while deliveries were failing. */
  if (!subscription) {
    for (const tier of [user.plan, ...PLAN_ORDER]) {
      if (!isPlanId(tier)) continue;
      const { subscriptions } = await listSubscriptions({
        externalReference: `user:${user.id}:plan:${tier}`,
      });
      subscription =
        subscriptions.find(
          (s) => String(field(s, "status") ?? "").toLowerCase() === "active"
        ) ?? subscriptions[0];
      if (subscription) break;
    }
  }

  if (!subscription) {
    return Response.json({
      synced: false,
      reason: "subscription_not_found",
      subStatus: user.sub_status,
      cancelAtPeriodEnd: !!user.sub_cancel_at_period_end,
    });
  }

  const status = String(field(subscription, "status") ?? "").trim().toLowerCase();
  const cancelAtPeriodEnd = field(subscription, "cancel_at_period_end") === true;
  const onchainId = field(subscription, "subscription_id") ?? null;
  const checkoutId = field(subscription, "source_checkout_id", "checkout_id") ?? null;

  /* Keep the ids current. A resume replaces subscription_id, and cancel needs
     whichever one is live now. */
  await q(
    `UPDATE users
        SET subscription_id = COALESCE($1::text, subscription_id),
            sub_checkout_id = COALESCE($2::text, sub_checkout_id)
      WHERE id = $3`,
    [onchainId, checkoutId, user.id]
  );

  /* No need to compute createdAt + intervalSeconds any more: the API states
     when access ends. Only applied to an account already on a tier, so a
     never-paid checkout cannot hand out a period. */
  const periodEnd =
    toEpochSeconds(field(subscription, "current_period_end_timestamp")) ??
    toEpochSeconds(field(subscription, "current_period_end"));
  const TERMINAL_OR_LIVE = ["active", "past_due", "canceling", "canceled", "cancelled", "expired"];
  if (periodEnd && isPlanId(user.plan) && TERMINAL_OR_LIVE.includes(status)) {
    await q("UPDATE users SET plan_expires_at = $1 WHERE id = $2", [periodEnd, user.id]);
  }

  if (status === "canceled" || status === "cancelled" || status === "deleted" || cancelAtPeriodEnd) {
    await q(
      "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
      [user.id]
    );
    return Response.json({ synced: true, subStatus: "canceled", cancelAtPeriodEnd: true, periodEnd });
  }

  if (status === "past_due") {
    await q(
      "UPDATE users SET sub_status = 'past_due', sub_alert = 'payment_failed' WHERE id = $1",
      [user.id]
    );
    return Response.json({ synced: true, subStatus: "past_due", cancelAtPeriodEnd: false, periodEnd });
  }

  if (status === "expired") {
    await q("UPDATE users SET sub_status = 'expired' WHERE id = $1", [user.id]);
    return Response.json({ synced: true, subStatus: "expired", cancelAtPeriodEnd: false, periodEnd });
  }

  if (status === "active") {
    /* A local cancellation is not cleared here. We may have cancelled seconds
       ago and SubScript may not reflect it yet; un-cancelling on that basis
       would tell the user their cancellation did not take. */
    if (user.sub_cancel_at_period_end) {
      return Response.json({ synced: true, subStatus: user.sub_status, cancelAtPeriodEnd: true, periodEnd });
    }
    await q("UPDATE users SET sub_status = 'active', sub_cancel_at_period_end = 0 WHERE id = $1", [
      user.id,
    ]);
    return Response.json({ synced: true, subStatus: "active", cancelAtPeriodEnd: false, periodEnd });
  }

  // incomplete, or anything unrecognised: report, change nothing.
  return Response.json({
    synced: true,
    subStatus: user.sub_status,
    reportedStatus: status || null,
    cancelAtPeriodEnd: !!user.sub_cancel_at_period_end,
    periodEnd,
  });
}
