"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ActivatePage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"subscript" | "card">("subscript");

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(3000);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  }

  async function checkActivation() {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const res = await fetch("/api/me");
      const data = await res.json();
      if (!data.user) {
        router.replace("/login");
        return;
      }
      if (data.user.activated) {
        showToast("⚡ Activation confirmed! Redirecting...");
        router.replace("/chat");
        return;
      }
      setDevMode(data.devMode);
    } catch {
      // Ignore network errors in background poll
    }
  }

  // Adaptive exponential backoff polling with Page Visibility API check
  useEffect(() => {
    checkActivation();

    function scheduleNext() {
      timeoutRef.current = setTimeout(async () => {
        await checkActivation();
        delayRef.current = Math.min(delayRef.current * 1.3, 12000);
        scheduleNext();
      }, delayRef.current);
    }

    scheduleNext();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        delayRef.current = 3000;
        checkActivation();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function manualSync() {
    setIsSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/billing/sync", { method: "POST" });
      const data = await res.json();
      await checkActivation();
      if (data.synced) {
        showToast("⚡ Status synchronized!");
      } else {
        showToast("Sync checked: No update yet.");
      }
    } catch {
      setError("Failed to sync status with SubScript.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function pay() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product: "signup", paymentMethod }),
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
    showToast("Redirecting to SubScript checkout...");
    window.location.href = data.checkoutUrl;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="center-page">
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            background: "#1f293d",
            color: "#65d98f",
            padding: "10px 18px",
            borderRadius: "8px",
            border: "1px solid #65d98f",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            zIndex: 9999,
            fontWeight: 600,
            fontSize: "0.9rem",
          }}
        >
          {toastMessage}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="badge pro">ACTIVATION</span>
          <button
            className="btn ghost small"
            onClick={manualSync}
            disabled={isSyncing}
            style={{ fontSize: "0.8rem", padding: "4px 8px" }}
          >
            {isSyncing ? "Syncing..." : "🔄 Refresh Status"}
          </button>
        </div>

        <h1 className="brand" style={{ fontSize: "1.85rem", marginTop: 16 }}>
          One last step
        </h1>
        <p className="subtitle">
          Kris&apos;s Script charges a one-time <strong>$1 USDC</strong> activation fee, settled
          on Arc via SubScript hosted checkout.
        </p>
        {devMode && (
          <div className="notice-box">
            <strong>Dev mode:</strong> no SubScript API key configured - checkout is simulated
            locally so you can test the full flow.
          </div>
        )}

        <div className="payment-method-wrap">
          <div className="payment-method-title">Choose payment method</div>
          <div className="payment-method-selector">
            <div
              className={`payment-method-option ${paymentMethod === "subscript" ? "selected" : ""}`}
              onClick={() => setPaymentMethod("subscript")}
            >
              <div className="payment-method-radio" />
              <div className="payment-method-icon">⚡</div>
              <div className="payment-method-details">
                <strong>SubScript</strong>
                <span>USDC on Arc Web3 (Active)</span>
              </div>
            </div>

            <div
              className="payment-method-option disabled"
              style={{ opacity: 0.5, cursor: "not-allowed" }}
              title="Card payment method coming soon"
            >
              <div className="payment-method-radio" />
              <div className="payment-method-icon">💳</div>
              <div className="payment-method-details">
                <strong>Card</strong>
                <span>Credit / Debit Card (Disabled)</span>
              </div>
            </div>
          </div>
        </div>

        <button className="btn" onClick={pay} disabled={busy}>
          {busy ? (waiting ? "Redirecting to checkout..." : "Creating checkout...") : "Pay $1 and activate"}
        </button>

        <div className="prompt-row" style={{ marginTop: 16 }}>
          <a className="btn secondary small" href="/login">
            Sign in
          </a>
          <a className="btn secondary small" href="/signup">
            Create account
          </a>
          <button className="btn ghost small" type="button" onClick={logout}>
            Sign out
          </button>
        </div>

        {error && <div className="error-box">{error}</div>}

        <p className="muted mt">
          After paying you&apos;ll be activated automatically once SubScript&apos;s{" "}
          <code>payment.succeeded</code> webhook is verified - never from the redirect alone.
        </p>
      </div>
    </div>
  );
}
