import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { getSubscription } from "@/lib/subscript";

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const targetId = user.subscription_id || user.wallet_address || "";
  if (!targetId) {
    return Response.json({ synced: false, reason: "no_subscription_id_or_wallet" });
  }

  const { status: httpStatus, subscription } = await getSubscription(targetId);
  if (httpStatus !== 200) {
    return Response.json({ synced: false, error: "Failed to query SubScript API." });
  }

  if (!subscription) {
    // If SubScript has no record for this subscription ID, mark as canceled/lapsed
    await q(
      "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
      [user.id]
    );
    return Response.json({ synced: true, subStatus: "canceled", cancelAtPeriodEnd: true });
  }

  const subStatus = subscription.status || "";
  const cancelAt = subscription.cancel_at_period_end ?? subscription.cancelAtPeriodEnd;
  const isCanceled =
    subStatus === "canceled" ||
    subStatus === "cancelled" ||
    subStatus === "deleted" ||
    cancelAt === true;

  if (isCanceled) {
    await q(
      "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
      [user.id]
    );
  } else if (subStatus === "active") {
    await q(
      "UPDATE users SET sub_cancel_at_period_end = 0, sub_status = 'active' WHERE id = $1",
      [user.id]
    );
  }

  return Response.json({ synced: true, subStatus, cancelAtPeriodEnd: isCanceled });
}
