"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PricingPage() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"subscript" | "card">("subscript");
  const [paygWalletInput, setPaygWalletInput] = useState("");

  async function load() {
    const data = await fetch("/api/me").then((r) => r.json());
    if (!data.user) return router.replace("/login");
    setMe(data);
    if (data.user?.walletAddress) {
      setPaygWalletInput((prev) => prev || data.user.walletAddress);
    }
    if (data.user?.subscriptionId || data.user?.subscription_id || data.user?.walletAddress) {
      fetch("/api/billing/sync", { method: "POST" })
        .then((r) => r.json())
        .then((s) => {
          if (s.synced) {
            fetch("/api/me")
              .then((r) => r.json())
              .then((updated) => {
                if (updated.user) {
                  setMe(updated);
                  if (updated.user.walletAddress) {
                    setPaygWalletInput((prev) => prev || updated.user.walletAddress);
                  }
                }
              });
          }
        })
        .catch(() => {});
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function subscribe(product: "pro" | "promax") {
    if (paymentMethod === "card") return;
    setBusy(product);
    setError("");
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, paymentMethod: "subscript" }),
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
      body: JSON.stringify({ enabled, walletAddress: paygWalletInput.trim() }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    setBusy("");
    load();
  }

  const user = me?.user;
  const PLAN_LEVELS: Record<string, number> = { free: 0, pro: 1, promax: 2 };
  const currentPlanActive =
    (user?.plan === "pro" || user?.plan === "promax") &&
    (user?.planExpiresAt ?? 0) > Math.floor(Date.now() / 1000);
  const userLevel = currentPlanActive ? (PLAN_LEVELS[user?.plan] ?? 0) : 0;

  const isHigherPlanActive = (p: "pro" | "promax") => userLevel > PLAN_LEVELS[p];

  const activeSub = (p: string) =>
    user?.plan === p &&
    (user?.subStatus === "active" || user?.planExpiresAt) &&
    !user?.subCancelAtPeriodEnd;

  function planButtonLabel(p: "pro" | "promax", price: string) {
    if (busy === p) return "Creating subscription...";
    if (isHigherPlanActive(p)) return "Included in Pro Max";
    if (user?.plan === p && user?.subCancelAtPeriodEnd) return `Re-subscribe - ${price}`;
    if (activeSub(p)) return "Subscribed";
    return `Subscribe - ${price}`;
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="rail-brand">
          <div className="mark">KS</div>
          <div className="brand-copy">
            <div className="brand-title">Kris&apos;s Script</div>
            <div className="brand-meta">Billing control</div>
          </div>
        </div>
        <nav className="rail-section">
          <div className="rail-label">Workspace</div>
          <a className="nav-link" href="/chat">
            Chat <span>Open</span>
          </a>
          <a className="nav-link active" href="/pricing">
            Billing <span>Active</span>
          </a>
        </nav>
        <div className="rail-section">
          <div className="rail-label">SubScript methods</div>
          <div className="prompt-chip">One-time activation</div>
          <div className="prompt-chip">Weekly recurring subscription</div>
          <div className="prompt-chip">Metered vault usage</div>
        </div>
        <div className="rail-bottom">
          <a className="btn secondary small" href="/chat">
            Back to chat
          </a>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <div className="topbar-title">
            <strong>Billing</strong>
            <span>Manage real recurring plans and pay-as-you-chat vault billing.</span>
          </div>
          <div className="topbar-actions">
            {me?.devMode && <span className="badge dev">DEV MODE</span>}
            {user && (
              <span className="badge free">
                {user.plan === "promax" ? "Pro Max" : user.plan === "pro" ? "Pro" : "Free"}
              </span>
            )}
          </div>
        </header>

        <div className="container">
          <div className="page-head">
            <div>
              <h1 className="brand" style={{ fontSize: "2.35rem" }}>
                Plans and usage
              </h1>
              <p className="subtitle">
                Pro plans are recurring USDC subscriptions on Arc via SubScript.
              </p>
            </div>
          </div>
          {user && (
            <div className="notice-box" style={{ marginTop: 0, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div>
                Current plan:{" "}
                <strong>
                  {user.plan === "promax" ? "Pro Max" : user.plan === "pro" ? "Pro" : "Free"}
                </strong>
                {user.subStatus && user.plan !== "free" && (
                  <> - subscription <strong>{user.subStatus}</strong></>
                )}
                {user.planExpiresAt &&
                  ` - ${user.subCancelAtPeriodEnd ? "ends" : "renews"} ${new Date(
                    user.planExpiresAt * 1000
                  ).toLocaleString()}`}
              </div>
              {user.plan !== "free" && !user.subCancelAtPeriodEnd && (
                <button
                  className="btn ghost small"
                  onClick={cancelSub}
                  disabled={busy !== ""}
                  style={{ padding: "4px 12px", fontSize: "0.8rem", color: "#f87171", borderColor: "rgba(248,113,113,0.4)" }}
                >
                  {busy === "cancel" ? "Cancelling..." : "Cancel Plan"}
                </button>
              )}
            </div>
          )}
          {user && user.subCancelAtPeriodEnd && user.plan !== "free" && (
            <div className="notice-box">
              Subscription set to cancel. You keep access until the current period ends, then drop
              to Free. Re-subscribe anytime.
            </div>
          )}
          {error && <div className="error-box">{error}</div>}

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
                  <span>USDC on Arc Web3 Wallet</span>
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
                  <span>Credit / Debit Card (Coming Soon)</span>
                </div>
              </div>
            </div>
          </div>

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
                disabled={busy !== "" || activeSub("pro") || isHigherPlanActive("pro")}
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
              <div style={{ marginTop: 12, padding: "12px", background: "#10141b", border: "1px solid #232a36", borderRadius: "8px", fontSize: "0.8rem", textAlign: "left" }}>
                <strong style={{ color: "#65d98f", display: "block", marginBottom: 6 }}>⚡ First-Time PAYG Setup Instructions:</strong>
                <ol style={{ margin: "0 0 10px 0", paddingLeft: 18, color: "#9ca3af", lineHeight: "1.5" }}>
                  <li>
                    Open <a href="https://dashboard.subscriptonarc.com/user" target="_blank" rel="noreferrer" style={{ color: "#60a5fa", textDecoration: "underline" }}>SubScript User Dashboard</a> &rarr; <strong>Manage Commit</strong> page.
                  </li>
                  <li>
                    Click <strong>&quot;Commit to a service&quot;</strong> and enter Merchant Name: <code style={{ color: "#65d98f", background: "rgba(101,217,143,0.1)", padding: "1px 4px", borderRadius: "3px" }}>Okechukwuanigba.sub</code>.
                  </li>
                  <li>
                    Enter commitment amount (min <strong>$2 USDC</strong>) and commit to activate vault.
                  </li>
                  <li>
                    SubScript auto-links your wallet upon payment, or paste your wallet address below:
                  </li>
                </ol>

                <label style={{ display: "block", fontSize: "0.78rem", color: "#9ca3af", marginBottom: 4 }}>SubScript Vault Address:</label>
                <input
                  type="text"
                  placeholder="Paste 0x... wallet address"
                  value={paygWalletInput}
                  onChange={(e) => setPaygWalletInput(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    fontSize: "0.82rem",
                    background: "#080a0d",
                    border: "1px solid #282e3a",
                    borderRadius: "6px",
                    color: "#fff",
                    marginBottom: 10,
                    boxSizing: "border-box",
                  }}
                />

                {user?.paygEnabled ? (
                  <>
                    <p className="muted" style={{ margin: "0 0 8px 0" }}>
                      Status: <strong style={{ color: "#65d98f" }}>Enabled</strong> - accrued this cycle: <strong>${user.paygAccrued}</strong>
                    </p>
                    <button
                      className="btn secondary small"
                      style={{ width: "100%" }}
                      onClick={() => setPayg(false)}
                      disabled={busy !== ""}
                    >
                      {busy === "payg" ? "Updating..." : "Disable pay-as-you-chat"}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn small"
                    style={{ width: "100%" }}
                    onClick={() => setPayg(true)}
                    disabled={busy !== ""}
                  >
                    {busy === "payg" ? "Saving..." : "Enable pay-as-you-chat"}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="notice-box" style={{ marginTop: 28, background: "#0d0f12", borderColor: "#252a31" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <strong style={{ fontSize: "1rem", display: "block" }}>SubScript User Dashboard & DM</strong>
                <span className="muted">
                  Manage, upgrade, or control your subscription plan directly in your SubScript User DM.
                </span>
              </div>
              <a
                className="btn secondary"
                style={{ width: "auto", margin: 0 }}
                href="https://dashboard.subscriptonarc.com/user"
                target="_blank"
                rel="noreferrer"
              >
                Manage in SubScript DM ↗
              </a>
            </div>
          </div>

          {user && user.plan !== "free" && !user.subCancelAtPeriodEnd && (
            <div style={{ marginTop: 18, display: "flex", gap: "12px", alignItems: "center" }}>
              <button
                className="btn ghost"
                style={{ maxWidth: 220, fontSize: "0.82rem", color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}
                onClick={cancelSub}
                disabled={busy !== ""}
              >
                {busy === "cancel" ? "Cancelling..." : "Cancel Subscription"}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
