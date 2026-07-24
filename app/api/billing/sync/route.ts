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

  const { subscription } = await getSubscription(targetId);

  if (subscription) {
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
      return Response.json({ synced: true, subStatus: "canceled", cancelAtPeriodEnd: true });
    }

    // Only set sub_cancel_at_period_end = 0 if the user has NOT explicitly canceled locally
    if (subStatus === "active" && !user.sub_cancel_at_period_end) {
      await q(
        "UPDATE users SET sub_cancel_at_period_end = 0, sub_status = 'active' WHERE id = $1",
        [user.id]
      );
      return Response.json({ synced: true, subStatus: "active", cancelAtPeriodEnd: false });
    }
  }

  return Response.json({ synced: true, subStatus: user.sub_status, cancelAtPeriodEnd: !!user.sub_cancel_at_period_end });
}
