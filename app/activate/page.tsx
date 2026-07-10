"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ActivatePage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user) return router.replace("/login");
        if (data.user.activated) return router.replace("/chat");
        setDevMode(data.devMode);
      });
    // Poll so that a webhook landing while this page is open advances the user.
    pollRef.current = setInterval(async () => {
      const data = await fetch("/api/me").then((r) => r.json());
      if (data.user?.activated) router.replace("/chat");
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [router]);

  async function pay() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product: "signup" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(
        data.error + (data.requestId ? ` (request_id: ${data.requestId})` : "")
      );
      setBusy(false);
      return;
    }
    setWaiting(true);
    window.location.href = data.checkoutUrl;
  }

  return (
    <div className="center-page">
      <div className="card">
        <h1 className="brand">
          One last step <span>💸</span>
        </h1>
        <p className="subtitle">
          Kris&apos;s Script charges a one-time <strong>$1 USDC</strong> activation fee, settled
          on Arc via SubScript hosted checkout.
        </p>
        {devMode && (
          <div className="notice-box">
            <strong>Dev mode:</strong> no SubScript API key configured — checkout is simulated
            locally so you can test the full flow.
          </div>
        )}
        <button className="btn" onClick={pay} disabled={busy}>
          {busy ? (waiting ? "Redirecting to checkout…" : "Creating checkout…") : "Pay $1 & activate"}
        </button>
        {error && <div className="error-box">{error}</div>}
        <p className="muted mt">
          After paying you&apos;ll be activated automatically once SubScript&apos;s{" "}
          <code>payment.succeeded</code> webhook is verified — never from the redirect alone.
        </p>
      </div>
    </div>
  );
}
