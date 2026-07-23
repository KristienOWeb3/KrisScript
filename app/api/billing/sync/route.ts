import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { getSubscription, cancelSubscription } from "@/lib/subscript";

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const targetId = user.subscription_id || user.wallet_address || "";
  if (!targetId) {
    return Response.json({ synced: false, reason: "no_subscription_id_or_wallet" });
  }

  const { status: httpStatus, subscription } = await getSubscription(targetId);

  // If subscription object returned from SubScript API has status 'canceled', 'cancelled', or 'deleted'
  const subStatus = subscription?.status || "";
  const cancelAt = subscription?.cancel_at_period_end ?? subscription?.cancelAtPeriodEnd;
  let isCanceled =
    subStatus === "canceled" ||
    subStatus === "cancelled" ||
    subStatus === "deleted" ||
    cancelAt === true;

  // If list status shows active, check DELETE endpoint for HTTP 409 (already canceled in DM / requires on-chain cancel)
  if (!isCanceled && user.subscription_id) {
    const cancelCheck = await cancelSubscription(user.subscription_id);
    if (cancelCheck.status === 409 || cancelCheck.status === 200 || cancelCheck.status === 404) {
      isCanceled = true;
    }
  }

  if (isCanceled || !subscription) {
    await q(
      "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
      [user.id]
    );
    return Response.json({ synced: true, subStatus: "canceled", cancelAtPeriodEnd: true });
  }

  if (subStatus === "active") {
    await q(
      "UPDATE users SET sub_cancel_at_period_end = 0, sub_status = 'active' WHERE id = $1",
      [user.id]
    );
  }

  return Response.json({ synced: true, subStatus, cancelAtPeriodEnd: isCanceled });
}
