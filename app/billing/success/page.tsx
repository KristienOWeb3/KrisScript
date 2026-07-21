"use client";

import { useEffect, useState } from "react";

export default function BillingSuccessPage() {
  const [me, setMe] = useState<any>(null);
  const [ticks, setTicks] = useState(0);
  const [returnSync, setReturnSync] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/me")
        .then((r) => r.json())
        .then((d) => setMe(d));
    load();
    const t = setInterval(() => {
      setTicks((n) => n + 1);
      load();
    }, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("subscript_status");
    const checkoutId = params.get("subscript_checkout_id");
    const receiptId = params.get("subscript_receipt_id");
    const txHash = params.get("subscript_tx_hash");
    if (status !== "success" || !checkoutId) return;

    let cancelled = false;
    fetch("/api/billing/confirm-return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, checkoutId, receiptId, txHash }),
    })
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok && body.confirmed) {
          setReturnSync({
            status: "confirmed",
            message:
              "SubScript return matched your pending checkout. Access has been reconciled while the signed webhook is still expected for audit.",
          });
          fetch("/api/me")
            .then((r) => r.json())
            .then((d) => !cancelled && setMe(d));
        } else if (body.reason !== "pending_payment_not_found") {
          setReturnSync({
            status: "waiting",
            message: body.error || "Waiting for the signed SubScript webhook.",
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReturnSync({ status: "waiting", message: "Waiting for the signed SubScript webhook." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const user = me?.user;

  return (
    <div className="center-page">
      <div className="card">
        <span className="badge pro">PAYMENT STATUS</span>
        <h1 className="brand" style={{ fontSize: "1.85rem", marginTop: 16 }}>
          Payment received
        </h1>
        <p className="subtitle">
          Reminder: the redirect is not proof of payment - access unlocks only after the verified{" "}
          <code>payment.succeeded</code> webhook is processed.
        </p>
        {user ? (
          <div className="notice-box">
            <div>
              Account: <strong>{user.email}</strong>
            </div>
            <div>
              Activated: <strong>{user.activated ? "yes" : "waiting for webhook..."}</strong>
            </div>
            <div>
              Plan:{" "}
              <strong>
                {user.plan === "promax" ? "Pro Max" : user.plan === "pro" ? "Pro" : "Free"}
              </strong>
              {user.planExpiresAt
                ? ` (until ${new Date(user.planExpiresAt * 1000).toLocaleString()})`
                : ""}
            </div>
            {user.pendingPayment && (
              <div className="mt">
                Pending payment: <strong>{user.pendingPayment.product}</strong>. Waiting for
                SubScript webhook.
              </div>
            )}
          </div>
        ) : (
          <p className="muted">Checking account status{".".repeat((ticks % 3) + 1)}</p>
        )}
        {returnSync && (
          <div className={returnSync.status === "confirmed" ? "notice-box" : "error-box"}>
            {returnSync.message}
          </div>
        )}
        {user?.pendingPayment && !user.activated && (
          <div className="error-box">
            Almost there: SubScript redirected back successfully, but Kris&apos;s Script is still
            waiting for the signed payment webhook. Set the SubScript webhook URL to{" "}
            <code>https://kris-script.vercel.app/api/webhooks/subscript</code> and make sure the
            webhook secret matches Vercel&apos;s <code>SUBSCRIPT_WEBHOOK_SECRET</code>.
          </div>
        )}
        <a className="btn" href="/chat">
          Go to chat
        </a>
        <a className="btn secondary" href="/pricing">
          View plans
        </a>
        <div className="prompt-row" style={{ marginTop: 16 }}>
          <a className="btn secondary small" href="/login">
            Sign in
          </a>
          <a className="btn secondary small" href="/signup">
            Create account
          </a>
        </div>
      </div>
    </div>
  );
}
