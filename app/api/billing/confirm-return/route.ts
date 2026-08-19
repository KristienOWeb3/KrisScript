import { q, one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { reconcilePendingPayments, type Payment } from "@/lib/billing";

/**
 * SubScript return landing.
 *
 * This endpoint never fulfills on the strength of the redirect. Every field it
 * receives comes from the browser, so a return hit proves only that someone
 * loaded the success URL — not that money moved. It once called
 * fulfillPayment() directly (and, for plans, wrote status = 'PAID'), which
 * meant abandoning a checkout and then POSTing {"status":"success"} here was
 * enough to promote a pending display name or activate a paid plan for free.
 *
 * What it does instead is ask SubScript directly whether the intent is paid,
 * via reconcilePendingPayments(), and fulfill on that authoritative answer.
 * SubScript remains the only thing that can authorise a grant — the browser
 * still cannot — but we no longer depend on a webhook arriving, which in
 * practice left genuinely paid charges unfulfilled for weeks.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { status, checkoutId, receiptId, txHash } = (await req.json().catch(() => ({}))) as {
    status?: string;
    checkoutId?: string;
    receiptId?: string;
    txHash?: string;
  };

  if (status === "cancel" || status === "failed" || status === "error") {
    return Response.json(
      { error: "SubScript return indicates checkout was not completed." },
      { status: 400 }
    );
  }

  const searchId = (checkoutId || "").trim();

  // Locate the payment this return is about — for reporting only.
  let payment: Payment | undefined;
  let matched = false;
  if (searchId && searchId !== "pending" && searchId !== "auto_reconcile") {
    payment = await one<Payment>(
      "SELECT * FROM payments WHERE user_id = $1 AND intent_id = $2 ORDER BY created_at DESC LIMIT 1",
      [user.id, searchId]
    );
    if (!payment) {
      payment = await one<Payment>(
        "SELECT * FROM payments WHERE user_id = $1 AND intent_id = $2 ORDER BY created_at DESC LIMIT 1",
        [user.id, `sub_${searchId}`]
      );
    }
    matched = !!payment;
  }
  if (!payment) {
    payment = await one<Payment>(
      "SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [user.id]
    );
  }
  if (!payment) {
    return Response.json({ confirmed: false, reason: "pending_payment_not_found" }, { status: 404 });
  }

  /* Record the return for the audit trail. processed_at is left NULL because
     nothing was processed — this is an observation, not a fulfillment. */
  const eventId = `return:${searchId || payment.id}`;
  const rawBody = JSON.stringify({
    id: eventId,
    type: "subscript.return.observed",
    data: { checkoutId: searchId, receiptId, txHash, paymentId: payment.id, product: payment.product },
  });
  await q(
    "INSERT INTO webhook_events (id, event_type, raw_body) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [eventId, "subscript.return.observed", rawBody]
  );

  /* Ask SubScript about anything still unpaid, and fulfill what it confirms.
     Cheap when nothing is pending, and idempotent — fulfillPayment claims the
     row atomically, so racing with an arriving webhook is harmless. */
  const reconciled = await reconcilePendingPayments(user.id);

  const fresh = await one<Payment>("SELECT * FROM payments WHERE id = $1", [payment.id]);
  const current = fresh ?? payment;
  const paid = current.status === "PAID";

  /* A charge SubScript has settled as over is not "still pending". Abandoned
     checkouts now expire after 24 hours instead of sitting at incomplete
     forever, so the return page can say so rather than waiting indefinitely. */
  if (!paid && (current.status === "EXPIRED" || current.status === "FAILED")) {
    return Response.json({
      confirmed: false,
      pending: false,
      product: current.product,
      matched,
      reason: current.status === "EXPIRED" ? "checkout_expired" : "payment_failed",
      fulfilled: reconciled.fulfilled,
    });
  }

  /* Only claim a charge is in flight when we have reason to believe one is.
     Without a matching checkout id we fell back to this user's newest payment
     of any age or status, so an abandoned checkout from days ago made the
     return page report a charge the user never completed and wait on it
     forever. An unmatched, unpaid, not-recent row is reported as "nothing to
     confirm" instead of being presented as pending. */
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(current.created_at || 0));
  const RECENT_SECONDS = 30 * 60;
  if (!paid && !matched && ageSeconds > RECENT_SECONDS) {
    return Response.json({
      confirmed: false,
      pending: false,
      reason: "no_recent_payment",
      fulfilled: reconciled.fulfilled,
    });
  }

  return Response.json({
    confirmed: paid,
    pending: !paid,
    product: current.product,
    matched,
    ageSeconds,
    fulfilled: reconciled.fulfilled,
    ...(reconciled.mismatched.length ? { mismatched: reconciled.mismatched } : {}),
    ...(paid ? {} : { reason: "awaiting_confirmation" }),
  });
}
