"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function DevCheckout() {
  const router = useRouter();
  const params = useSearchParams();
  const intentId = params.get("intent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function complete() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/dev/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId }),
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
          <code>payment.succeeded</code> webhook to your own endpoint - the same path a real
          payment takes.
        </p>
        <p className="muted">
          Intent: <code>{intentId}</code>
        </p>
        <button className="btn" onClick={complete} disabled={busy || !intentId}>
          {busy ? "Delivering webhook..." : "Simulate successful USDC payment"}
        </button>
        <a className="btn secondary" href="/billing/cancel">
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
