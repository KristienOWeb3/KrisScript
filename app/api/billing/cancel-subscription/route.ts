import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { cancelSubscription } from "@/lib/subscript";

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  if (user.plan === "free" && !user.subscription_id) {
    return Response.json({ error: "No active subscription to cancel." }, { status: 400 });
  }

  let subscriptStatus = null;
  if (user.subscription_id) {
    try {
      const res = await cancelSubscription(user.subscription_id);
      subscriptStatus = res.status;
    } catch (e) {
      console.warn("[cancel-subscription] SubScript cancel call notice:", e);
    }
  }

  // Mark subscription as canceled at period end locally in DB
  await q(
    "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
    [user.id]
  );

  return Response.json({ ok: true, subscriptStatus });
}
