import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { getSubscription } from "@/lib/subscript";

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (!user.subscription_id) {
    return Response.json({ synced: false, reason: "no_subscription" });
  }

  const { status: httpStatus, subscription } = await getSubscription(user.subscription_id);
  if (httpStatus !== 200 || !subscription) {
    return Response.json({ synced: false, error: "Failed to fetch status from SubScript." });
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
