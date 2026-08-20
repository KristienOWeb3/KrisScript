"use client";

import { useEffect, useRef, useState } from "react";
import { PLANS, isPlanId } from "@/lib/plans";

/* ─────────────────────────────────────────────────────────
 * SUBSCRIPT RETURN LANDING
 *
 * The redirect proves only that the browser came back, so this
 * page never claims a payment succeeded on its own. It asks the
 * server to check with SubScript, retries on a cadence, and only
 * then confirms the specific thing that was bought.
 *
 * Product-aware: a $1 name change has nothing to do with plans
 * or account activation, so it does not show them.
 *
 * For a subscription this page is not reached by a redirect at all.
 * POST /api/v1/subscriptions accepts no successUrl, so SubScript's
 * subscribe page cannot send anyone here — /pricing opens that
 * checkout in a second tab and sends the first one here instead.
 * That also makes this the only thing that reconciles a plan, so it
 * has to keep polling rather than assume a webhook will land.
 * ───────────────────────────────────────────────────────── */

type Me = {
  user?: {
    email: string;
    activated: boolean;
    plan: string;
    planName: string | null;
    planActive: boolean;
    planCap: number;
    planExpiresAt: number | null;
    willRenew: boolean;
    displayName: string;
    pendingDisplayName: string | null;
    paygEnabled: boolean;
    paygAccrued: string;
  } | null;
  devMode?: boolean;
};

/** "19 Sep 2026", or null when there is no date to show. */
function formatDate(epochSeconds: number | null | undefined): string | null {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function BillingSuccessPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  /* Authoritative: the server says this payment is PAID. Never inferred from
     watching pending_display_name, which reconciliation may clear before this
     page ever observes it. */
  const [confirmed, setConfirmed] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // The name that was pending when we arrived, so we can report what changed
  // after the webhook clears it.
  const requestedName = useRef<string | null>(null);
  const settled = useRef(false);
  const elapsedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const d: Me = await fetch("/api/me").then((r) => r.json());
      if (cancelled) return;
      if (requestedName.current === null && d.user?.pendingDisplayName) {
        requestedName.current = d.user.pendingDisplayName;
      }
      setMe(d);
    };

    const params = new URLSearchParams(window.location.search);
    const status = params.get("subscript_status") || params.get("status") || "success";
    /* The product this checkout was for, when whoever sent us here knew it.
       confirm-return reports it too, but only once it has answered — and for a
       subscription that can take a while, so naming the tier straight away is
       the difference between "confirming your payment" and confirming nothing
       in particular. */
    const productParam = params.get("product");
    if (productParam) setProduct(productParam);
    const checkoutId =
      params.get("subscript_checkout_id") ||
      params.get("checkout_id") ||
      params.get("checkoutId") ||
      params.get("intent_id") ||
      params.get("intent") ||
      params.get("id") ||
      "auto_reconcile";

    /* confirm-return asks SubScript whether the intent is paid and fulfills on
       its answer, so it is retried on a cadence rather than called once: the
       user often lands here a moment before the charge settles. */
    const confirm = () =>
      fetch("/api/billing/confirm-return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          checkoutId,
          receiptId: params.get("subscript_receipt_id") || params.get("receipt_id"),
          txHash: params.get("subscript_tx_hash") || params.get("tx_hash"),
        }),
      })
        .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (cancelled) return;
          if (ok && body.product) setProduct(body.product);
          if (ok && body.confirmed) setConfirmed(true);
          if (body?.reason === "pending_payment_not_found") setLookupFailed(true);
          return load();
        })
        .catch(() => !cancelled && setLookupFailed(true));

    load();
    confirm();

    const t = setInterval(() => {
      if (settled.current) return;
      setElapsed((n) => n + 3);
      // Re-ask SubScript every other tick; poll our own state every tick.
      if (elapsedRef.current % 6 === 0) confirm();
      else load();
      elapsedRef.current += 3;
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const user = me?.user;
  const isNameChange = product === "name_change";
  /* The tier this checkout bought, when it bought one. Named from the plan
     catalogue rather than from the account, so the price and allowance are
     right while the charge is still pending and the account is still on
     whatever it was on before. */
  const tier = isPlanId(product) ? PLANS[product] : undefined;

  /* Settled purely on the server's answer. Deriving it from the pending name
     instead was the bug: reconciliation now fulfills during the first
     confirm-return call, so pending_display_name is often already cleared by
     the time this page first reads /api/me, and a check that required having
     seen it could never pass. */
  const stillPending = !confirmed;
  if (!stillPending) settled.current = true;

  const heading = stillPending ? "Confirming your payment" : "Payment confirmed";

  return (
    <div className="center-page">
      <div className="card">
        <span className="badge pro">PAYMENT STATUS</span>
        <h1 className="brand" style={{ fontSize: "1.85rem", marginTop: 16 }}>
          {heading}
        </h1>
        <p className="subtitle">
          {tier
            ? "Landing here is not proof of payment — the plan unlocks only once SubScript itself confirms the charge."
            : "The redirect is not proof of payment — this unlocks only once SubScript itself confirms the charge."}
        </p>

        {!me ? (
          <p className="muted">Checking status…</p>
        ) : !user ? (
          <div className="error-box">
            You are signed out, so this payment cannot be matched to an account.
          </div>
        ) : isNameChange ? (
          <div className={confirmed ? "notice-box" : "error-box"}>
            {confirmed ? (
              <>
                Your display name is now <strong>{user.displayName}</strong>.
              </>
            ) : (
              <>
                <div>
                  Waiting for SubScript to confirm the $1.00 USDC charge.
                  {requestedName.current && (
                    <>
                      {" "}
                      Your name will change to{" "}
                      <strong>{requestedName.current}</strong> as soon as it clears.
                    </>
                  )}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Still your current name until then: <strong>{user.displayName}</strong>
                  {elapsed > 0 && ` · ${elapsed}s`}
                </div>
              </>
            )}
          </div>
        ) : tier ? (
          <div className={confirmed ? "notice-box" : "error-box"}>
            {confirmed ? (
              <>
                <div>
                  <strong>{user.planName || tier.name}</strong> is live on{" "}
                  <strong>{user.email}</strong>.
                </div>
                <div>
                  {user.planCap || tier.messages} messages per month · $
                  {tier.priceUsdc} USDC monthly
                </div>
                <div>
                  {user.willRenew ? (
                    <>
                      Renews automatically on{" "}
                      <strong>{formatDate(user.planExpiresAt) ?? "the period end"}</strong>.
                    </>
                  ) : (
                    <>
                      Access runs to{" "}
                      <strong>{formatDate(user.planExpiresAt) ?? "the period end"}</strong>,
                      and will not renew.
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div>
                  Waiting for SubScript to confirm the ${tier.priceUsdc} USDC charge for{" "}
                  <strong>{tier.name}</strong>. Finish the checkout in the other tab if it
                  is still open.
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  The plan starts the moment SubScript reports the charge as paid — not
                  when the checkout page closes
                  {elapsed > 0 && ` · ${elapsed}s`}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="notice-box">
            <div>
              Account: <strong>{user.email}</strong>
            </div>
            <div>
              Activated:{" "}
              <strong>{user.activated ? "yes" : "waiting for webhook…"}</strong>
            </div>
            <div>
              Billing:{" "}
              <strong>
                {user.paygEnabled ? "Pay-as-you-chat" : "Free trial"}
              </strong>
              {user.paygEnabled && ` · $${user.paygAccrued} accrued`}
            </div>
          </div>
        )}

        {lookupFailed && (
          <div className="error-box">
            No matching payment was found for your account. If you completed a
            checkout, it will still apply once SubScript confirms it.
          </div>
        )}

        {stillPending && user && elapsed >= 45 && (
          <div className="notice-box">
            Still waiting on SubScript to report the charge as paid. It is safe to
            leave this page — the change applies on its own once it clears, and
            stays visible as pending under Settings until then.
          </div>
        )}

        {stillPending && user && elapsed >= 300 && (
          <div className="error-box">
            After five minutes SubScript still does not report this intent as
            paid. If the charge did go through, check the function logs for{" "}
            <code>/api/billing/reconcile</code> — an amount mismatch is refused
            on purpose and logged rather than granted.
            {me?.devMode && " In dev, POST /api/dev/complete to simulate it."}
          </div>
        )}

        <a className="btn" href="/chat">
          Go to chat
        </a>
        {!isNameChange && (
          <a className="btn secondary" href="/pricing">
            Billing settings
          </a>
        )}
      </div>
    </div>
  );
}
