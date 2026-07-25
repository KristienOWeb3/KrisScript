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

  async function complete(typeToSimulate?: string) {
    setBusy(true);
    setError("");
    const selectedType = typeToSimulate || (eventType === "default" ? undefined : eventType);
    const res = await fetch("/api/dev/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId, eventType: selectedType }),
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
            <option value="default">Default (Created / Succeeded)</option>
            <option value="subscription.renewed">subscription.renewed (Extend 7 Days)</option>
            <option value="subscription.canceled">subscription.canceled (Mark Canceled)</option>
          </select>
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
