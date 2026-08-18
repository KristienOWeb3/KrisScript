"use client";

import { useEffect, useRef, useState } from "react";

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
 * ───────────────────────────────────────────────────────── */

type Me = {
  user?: {
    email: string;
    activated: boolean;
    plan: string;
    displayName: string;
    pendingDisplayName: string | null;
    paygEnabled: boolean;
    paygAccrued: string;
  } | null;
  devMode?: boolean;
};

export default function BillingSuccessPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [product, setProduct] = useState<string | null>(null);
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
          else if (body?.reason === "pending_payment_not_found") setLookupFailed(true);
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

  // A name change is done when the parked name has been promoted.
  const nameSettled =
    isNameChange &&
    !!requestedName.current &&
    !user?.pendingDisplayName &&
    user?.displayName === requestedName.current;

  const stillPending = isNameChange ? !nameSettled : !user?.activated;
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
          The redirect is not proof of payment — this unlocks only once SubScript
          itself confirms the charge.
        </p>

        {!me ? (
          <p className="muted">Checking status…</p>
        ) : !user ? (
          <div className="error-box">
            You are signed out, so this payment cannot be matched to an account.
          </div>
        ) : isNameChange ? (
          <div className={nameSettled ? "notice-box" : "error-box"}>
            {nameSettled ? (
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
