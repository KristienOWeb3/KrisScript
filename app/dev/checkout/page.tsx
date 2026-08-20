"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function DevCheckout() {
  const router = useRouter();
  const params = useSearchParams();
  const intentId = params.get("intent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [eventType, setEventType] = useState<string>("default");
  const [gift, setGift] = useState(false);

  async function complete(typeToSimulate?: string) {
    setBusy(true);
    setError("");
    const selectedType = typeToSimulate || (eventType === "default" ? undefined : eventType);
    const res = await fetch("/api/dev/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId, eventType: selectedType, gift }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.error || `Webhook simulation failed (${data.webhookStatus}).`);
      setBusy(false);
      return;
    }
    router.push("/billing/success");
  }

  return (
    <div className="center-page">
      <div className="card">
        <span className="badge dev">SIMULATED CHECKOUT - DEV MODE</span>
        <h1 className="brand" style={{ marginTop: 14 }}>
          SubScript <span>Checkout</span> (simulated)
        </h1>
        <p className="subtitle">
          No real SubScript key is configured, so this page stands in for the hosted checkout at{" "}
          <code>subscriptonarc.com/pay/...</code>. Completing it sends a correctly signed{" "}
          webhook to your own endpoint - the same path a real payment takes.
        </p>
        <p className="muted">
          Intent: <code>{intentId}</code>
        </p>

        <div style={{ margin: "16px 0", textAlign: "left" }}>
          <label style={{ fontSize: "0.85rem", opacity: 0.8, display: "block", marginBottom: 6 }}>
            Select Event Simulation:
          </label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "8px",
              background: "#161b22",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            <option value="default">Default (Activated / Succeeded)</option>
            <option value="subscription.activated">subscription.activated (grant plan)</option>
            <option value="subscription.renewed">subscription.renewed (extend a period)</option>
            <option value="subscription.cancel_scheduled">
              subscription.cancel_scheduled (cancel at period end)
            </option>
            <option value="subscription.canceled">subscription.canceled (mark canceled)</option>
            <option value="subscription.reactivated">
              subscription.reactivated (resume — new id, charged, new period)
            </option>
            <option value="subscription.payment_failed">
              subscription.payment_failed (past due)
            </option>
            <option value="subscription.allowance_low">
              subscription.allowance_low (re-authorization needed)
            </option>
            <option value="subscription.renewal_upcoming">
              subscription.renewal_upcoming (advance notice)
            </option>
            <option value="payment.failed">payment.failed (mark charge failed)</option>
          </select>
        </div>

        {/* GIFT SIMULATION */}
        <div style={{ margin: "0 0 16px", textAlign: "left" }}>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: "0.85rem",
              opacity: 0.9,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={gift}
              onChange={(e) => setGift(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              Pay as someone else (gift). Sends <code>payer_address</code> and{" "}
              <code>beneficiary_address</code> as two different wallets, so it settles as a
              one-time payment: the plan is granted for one duration and marked
              non-renewing. Overrides the event type above — a gift always arrives as{" "}
              <code>payment.succeeded</code>, never as a subscription. Needs a wallet address
              on the account.
            </span>
          </label>
        </div>

        <button className="btn" onClick={() => complete()} disabled={busy || !intentId}>
          {busy ? "Delivering webhook..." : "Simulate Webhook Delivery"}
        </button>
        <a className="btn secondary" href="/billing/cancel" style={{ marginTop: 8 }}>
          Cancel payment
        </a>
        {error && <div className="error-box">{error}</div>}
      </div>
    </div>
  );
}

export default function DevCheckoutPage() {
  return (
    <Suspense fallback={<div className="center-page muted">Loading...</div>}>
      <DevCheckout />
    </Suspense>
  );
}
