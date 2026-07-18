"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PricingPage() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const data = await fetch("/api/me").then((r) => r.json());
    if (!data.user) return router.replace("/login");
    setMe(data);
    if (data.user.walletAddress) setWallet(data.user.walletAddress);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function subscribe(product: "pro" | "promax") {
    setBusy(product);
    setError("");
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error + (data.requestId ? ` (request_id: ${data.requestId})` : ""));
      setBusy("");
      return;
    }
    window.location.href = data.checkoutUrl;
  }

  async function cancelSub() {
    setBusy("cancel");
    setError("");
    const res = await fetch("/api/billing/cancel-subscription", { method: "POST" });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    setBusy("");
    load();
  }

  async function setPayg(enabled: boolean) {
    setBusy("payg");
    setError("");
    const res = await fetch("/api/billing/payg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, walletAddress: wallet }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    setBusy("");
    load();
  }

  const user = me?.user;
  const activeSub = (p: string) =>
    user?.plan === p && (user?.subStatus === "active" || user?.planExpiresAt);

  function planButtonLabel(p: "pro" | "promax", price: string) {
    if (busy === p) return "Creating subscription…";
    if (activeSub(p)) return "Subscribed ✓";
    return `Subscribe — ${price}`;
  }

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="brand">
          Kris&apos;s <span>Script</span> — Plans
        </h1>
        <a className="btn secondary small" href="/chat">
          ← Back to chat
        </a>
      </div>
      <p className="subtitle" style={{ marginTop: 6 }}>
        Pro plans are recurring USDC subscriptions on Arc via SubScript.{" "}
        {me?.devMode && <span className="badge dev">DEV MODE — simulated checkout</span>}
      </p>
      {user && (
        <p className="muted">
          Current plan:{" "}
          <strong>{user.plan === "promax" ? "Pro Max" : user.plan === "pro" ? "Pro" : "Free"}</strong>
          {user.subStatus && user.plan !== "free" && (
            <> — subscription <strong>{user.subStatus}</strong></>
          )}
          {user.planExpiresAt &&
            ` — ${user.subCancelAtPeriodEnd ? "ends" : "renews"} ${new Date(
              user.planExpiresAt * 1000
            ).toLocaleString()}`}
        </p>
      )}
      {user && user.subCancelAtPeriodEnd && user.plan !== "free" && (
        <div className="notice-box">
          Subscription set to cancel — you keep access until the current period ends, then drop to
          Free. Re-subscribe anytime.
        </div>
      )}
      {error && <div className="error-box">{error}</div>}

      <div className="plans">
        <div className="plan-card">
          <h3>Free</h3>
          <div className="price">
            $0 <small>after $1 activation</small>
          </div>
          <ul>
            <li>3 messages total</li>
            <li>DeepSeek-powered replies</li>
          </ul>
          <button className="btn secondary" disabled>
            {user && user.plan === "free" ? "Current plan" : "Included"}
          </button>
        </div>

        <div className="plan-card">
          <h3>Pro</h3>
          <div className="price">
            $2 <small>/ week recurring</small>
          </div>
          <ul>
            <li>100 messages per day</li>
            <li>Auto-renews weekly in USDC</li>
            <li>Cancel anytime</li>
          </ul>
          <button
            className="btn"
            onClick={() => subscribe("pro")}
            disabled={busy !== "" || activeSub("pro")}
          >
            {planButtonLabel("pro", "$2/wk")}
          </button>
        </div>

        <div className="plan-card featured">
          <h3>Pro Max</h3>
          <div className="price">
            $5 <small>/ week recurring</small>
          </div>
          <ul>
            <li>Unlimited messages</li>
            <li>Auto-renews weekly in USDC</li>
            <li>Cancel anytime</li>
          </ul>
          <button
            className="btn"
            onClick={() => subscribe("promax")}
            disabled={busy !== "" || activeSub("promax")}
          >
            {planButtonLabel("promax", "$5/wk")}
          </button>
        </div>

        <div className="plan-card">
          <h3>
            Pay as you chat <span className="badge payg">METERED</span>
          </h3>
          <div className="price">
            $0.10 <small>/ message</small>
          </div>
          <ul>
            <li>SubScript metered vault billing</li>
            <li>Charged per message via report-usage</li>
            <li>Used only when no plan is active</li>
          </ul>
          <label>Your Arc wallet address (vault owner)</label>
          <input
            type="text"
            placeholder="0x…"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
          />
          {user?.paygEnabled ? (
            <>
              <p className="muted mt">
                Enabled ✅ — accrued this cycle: <strong>${user.paygAccrued}</strong>
              </p>
              <button
                className="btn secondary"
                onClick={() => setPayg(false)}
                disabled={busy !== ""}
              >
                Disable pay-as-you-chat
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setPayg(true)} disabled={busy !== ""}>
              {busy === "payg" ? "Saving…" : "Enable pay-as-you-chat"}
            </button>
          )}
        </div>
      </div>

      {user && user.plan !== "free" && user.subscriptionId && !user.subCancelAtPeriodEnd && (
        <div style={{ marginTop: 24 }}>
          <button
            className="btn secondary"
            style={{ maxWidth: 260 }}
            onClick={cancelSub}
            disabled={busy !== ""}
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel subscription"}
          </button>
        </div>
      )}
    </div>
  );
}
