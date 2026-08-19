import { currentUser } from "@/lib/auth";
import { reconcilePendingPayments } from "@/lib/billing";

/**
 * Reconcile this account's unpaid payments against SubScript.
 *
 * The self-heal hatch for anything the webhook never delivered. Fulfillment
 * still requires SubScript to state that the intent is paid and that its amount
 * matches what we recorded, so this grants nothing on the caller's word — it is
 * safe to expose to the signed-in user and safe to call repeatedly, since
 * fulfillPayment claims each row atomically.
 *
 * Useful for recovering historical stalls: a charge that sat PENDING for weeks
 * because delivery failed is picked up the next time this runs.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const result = await reconcilePendingPayments(user.id);

  return Response.json({
    ok: true,
    checked: result.checked,
    fulfilled: result.fulfilled,
    fulfilledCount: result.fulfilled.length,
    ...(result.mismatched.length ? { mismatched: result.mismatched } : {}),
    ...(result.expired.length ? { expired: result.expired } : {}),
  });
}
