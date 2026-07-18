import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { cancelSubscription } from "@/lib/subscript";

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (!user.subscription_id) {
    return Response.json({ error: "No active subscription to cancel." }, { status: 400 });
  }

  const res = await cancelSubscription(user.subscription_id);
  if (res.status !== 200) {
    return Response.json(
      { error: res.body?.message || `SubScript cancel failed (HTTP ${res.status}).` },
      { status: 502 }
    );
  }
  // Flag cancel-at-period-end; access rides until plan_expires_at, and the
  // subscription.canceled webhook will confirm. No further renewals occur.
  await q(
    "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
    [user.id]
  );
  return Response.json({ ok: true });
}
