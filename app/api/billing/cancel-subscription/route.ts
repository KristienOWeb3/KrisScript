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
  // HTTP 200 = canceled, HTTP 409 = already canceled / canceled in DM / requires on-chain cancel, HTTP 404 = expired/removed.
  // In all these cases, flag sub_cancel_at_period_end = 1 so the platform immediately reflects the cancellation.
  if (res.status !== 200 && res.status !== 409 && res.status !== 404) {
    return Response.json(
      { error: res.body?.message || res.body?.error || `SubScript cancel failed (HTTP ${res.status}).` },
      { status: 502 }
    );
  }
  // Flag cancel-at-period-end; access rides until plan_expires_at, and no further renewals occur.
  await q(
    "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
    [user.id]
  );
  return Response.json({ ok: true, subscriptStatus: res.status });
}
