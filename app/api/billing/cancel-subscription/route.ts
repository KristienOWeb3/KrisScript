import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { cancelSubscription } from "@/lib/subscript";

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  if (user.plan === "free" && !user.subscription_id) {
    return Response.json({ error: "No active subscription to cancel." }, { status: 400 });
  }

  /* DELETE needs the on-chain subscription id. The checkout id is only a
     fallback for a subscription that was never seen in an event — it is what
     creation returns, and the API rejects it here. */
  const cancelId = user.subscription_id || user.sub_checkout_id;

  let subscriptStatus = null;
  if (cancelId) {
    try {
      const res = await cancelSubscription(cancelId, user.wallet_address);
      subscriptStatus = res.status;
    } catch (e) {
      console.warn("[cancel-subscription] SubScript cancel call notice:", e);
    }
  }

  /* Mark cancel-at-period-end locally. Access deliberately runs to the end of
     the period already paid for — which is also the window in which the
     subscriber can resume, arriving as subscription.reactivated. */
  await q(
    "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
    [user.id]
  );

  return Response.json({ ok: true, subscriptStatus });
}
