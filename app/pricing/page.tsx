"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Transaction = {
  id: string;
  product: string;
  amountMicros: string;
  amountUsdc: string;
  intentId: string | null;
  receiptToken: string | null;
  status: string;
  createdAt: number;
};

export default function PricingPage() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"subscript" | "card">("subscript");
  const [paygWalletInput, setPaygWalletInput] = useState("");
  const [copiedMerchant, setCopiedMerchant] = useState(false);

  function copyMerchantName() {
    navigator.clipboard.writeText("okechukwuanigba.sub");
    setCopiedMerchant(true);
    setTimeout(() => setCopiedMerchant(false), 2000);
  }

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  }

  async function load() {
    try {
      const data = await fetch("/api/me").then((r) => r.json());
      if (!data.user) return router.replace("/login");
      setMe(data);
      if (data.user?.walletAddress) {
        setPaygWalletInput((prev) => prev || data.user.walletAddress);
      }

      // Fetch transaction history
      const txRes = await fetch("/api/billing/transactions").then((r) => r.json());
      if (txRes.transactions) setTransactions(txRes.transactions);
    } catch {
      // Fallback
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncStatus() {
    setIsSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/billing/sync", { method: "POST" });
      const data = await res.json();
      await load();
      if (data.synced) {
        showToast("⚡ Status synchronized with SubScript!");
      } else {
        showToast("Sync checked: No changes detected.");
      }
    } catch {
      setError("Failed to sync status.");
    } finally {
      setIsSyncing(false);
    }
  }

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
    showToast("Redirecting to SubScript checkout...");
    window.location.href = data.checkoutUrl;
  }

  async function cancelSub() {
    setBusy("cancel");
    setError("");
    const res = await fetch("/api/billing/cancel-subscription", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to cancel subscription.");
    } else {
      showToast("Subscription canceled. Access remains active until period end.");
      setMe((prev: any) =>
        prev
          ? {
              ...prev,
              user: {
                ...prev.user,
                subCancelAtPeriodEnd: true,
                subStatus: "canceled",
              },
            }
          : prev
      );
    }
    setBusy("");
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
    if (!res.ok) {
      setError(data.error);
    } else {
      showToast(enabled ? "⚡ Pay-as-you-chat enabled!" : "Pay-as-you-chat disabled.");
      load();
    }
    setBusy("");
  }

  const user = me?.user;
  const now = Math.floor(Date.now() / 1000);
  const PLAN_LEVELS: Record<string, number> = { free: 0, pro: 1, promax: 2 };
  const currentPlanActive =
    (user?.plan === "pro" || user?.plan === "promax") &&
    (user?.planExpiresAt ?? 0) > now &&
    !user?.subCancelAtPeriodEnd;
  const userLevel = currentPlanActive ? (PLAN_LEVELS[user?.plan] ?? 0) : 0;

  const isHigherPlanActive = (p: "pro" | "promax") => userLevel > PLAN_LEVELS[p];

  const secondsRemaining = (user?.planExpiresAt ?? 0) - now;
  const isWithinSixHours = secondsRemaining <= 6 * 3600;

  const activeSub = (p: string) =>
    user?.plan === p &&
    user?.planExpiresAt &&
    !user?.subCancelAtPeriodEnd;

  function planButtonLabel(p: "pro" | "promax", price: string) {
    if (busy === p) return "Creating subscription...";
    if (isHigherPlanActive(p)) return "Included in Pro Max";
    if (user?.plan === p && user?.subCancelAtPeriodEnd) return `Re-subscribe - ${price}`;
    if (activeSub(p)) {
      if (!isWithinSixHours) return "Active (Renews soon)";
      return `Renew Plan - ${price}`;
    }
    return `Subscribe - ${price}`;
  }

  function isButtonDisabled(p: "pro" | "promax") {
    if (busy !== "") return true;
    if (isHigherPlanActive(p)) return true;
    if (activeSub(p) && !isWithinSixHours) return true;
    return false;
  }

  const userPlanLabel =
    user?.plan === "promax" ? "Pro Max" : user?.plan === "pro" ? "Pro" : "Free";

  return (
    <div className="app-shell">
      {/* TOAST NOTIFICATION POPUP */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            background: "#1f293d",
            color: "#65d98f",
            padding: "12px 20px",
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

      <aside className="rail">
        <div className="rail-header">
          <div className="rail-brand">
            <div className="mark">KS</div>
            <div className="brand-copy">
              <div className="brand-title">Kris&apos;s Script</div>
              <div className="brand-meta">Billing control</div>
            </div>
          </div>
        </div>

        <div className="drawer-actions" style={{ marginTop: 12 }}>
          <a className="new-chat-btn" href="/chat" style={{ textDecoration: "none" }}>
            <span className="btn-icon">💬</span>
            <span>Back to Chat</span>
          </a>
        </div>

        <div className="rail-section" style={{ marginTop: 16 }}>
          <div className="rail-label">Billing Options</div>
          <div className="recent-item">
            <span className="recent-title">🎁 3 Free Trial Messages</span>
          </div>
          <div className="recent-item">
            <span className="recent-title">💳 Metered Vault Usage ($0.10/msg)</span>
          </div>
        </div>

        <div className="rail-bottom profile-bar">
          <div className="profile-info">
            <div className="avatar">{user?.email ? user.email.charAt(0).toUpperCase() : "K"}</div>
            <div className="profile-details">
              <span className="profile-name">{user?.email ? user.email.split("@")[0] : "Kristien"}</span>
              <span className="badge pro">{user?.paygEnabled ? "Pay-As-You-Chat" : "Free Trial"}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <a className="icon-btn" href="/chat" title="Back to Chat">
              ←
            </a>
            <div className="topbar-title">
              <strong style={{ fontSize: "1rem" }}>Pay-As-You-Go Billing</strong>
            </div>
          </div>

          <div className="topbar-right">
            <button
              className="btn ghost small"
              onClick={syncStatus}
              disabled={isSyncing}
              style={{ fontSize: "0.85rem", padding: "4px 10px" }}
            >
              {isSyncing ? "Syncing..." : "🔄 Refresh Status"}
            </button>
            {me?.devMode && <span className="badge dev">DEV MODE</span>}
            {user && <span className="badge pro">{user?.paygEnabled ? "Pay-As-You-Chat" : "Free Trial"}</span>}
          </div>
        </header>

        <div className="container pricing-container">
          <div className="page-head">
            <div>
              <h1 className="hero-heading" style={{ textAlign: "left", fontSize: "2.2rem" }}>
                Pay-As-You-Go Billing
              </h1>
              <p className="subtitle">
                Kris&apos;s Script gives you 3 free trial messages. After 3 messages, pay-as-you-go metered billing ($0.10/msg) is handled seamlessly via your SubScript vault.
              </p>
            </div>
          </div>

          {user && (
            <div className="notice-box user-status-banner">
              <div className="status-banner-left">
                <span>Current Status: <strong>{user?.paygEnabled ? "Pay-As-You-Chat Active" : "Free Trial"}</strong></span>
                <span> · Trial Used: <strong>{user.freeUsed ?? 0} / 3 free messages</strong></span>
                {user.paygEnabled && (
                  <span> · Accrued Usage: <strong>${user.paygAccrued} USDC</strong></span>
                )}
              </div>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}

          {/* PAYMENT METHOD SELECTOR */}
          <div className="payment-method-wrap">
            <div className="payment-method-title">Payment Provider</div>
            <div className="payment-method-selector">
              <div
                className={`payment-method-option ${paymentMethod === "subscript" ? "selected" : ""}`}
                onClick={() => setPaymentMethod("subscript")}
              >
                <div className="payment-method-radio" />
                <div className="payment-method-icon">⚡</div>
                <div className="payment-method-details">
                  <strong>SubScript Pay-As-You-Go</strong>
                  <span>USDC on Arc Web3 Wallet</span>
                </div>
              </div>

              <div
                className="payment-method-option disabled"
                style={{ opacity: 0.45, cursor: "not-allowed" }}
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

          {/* HORIZONTAL PLANS SCROLL / GRID CONTAINER */}
          <div className="plans-horizontal-wrap">
            <div className="plans plans-horizontal">
              {/* FREE CARD */}
              <div className="plan-card">
                <div className="plan-card-header">
                  <h3>Free Trial</h3>
                  <div className="price">
                    $0 <small>/ 3 messages</small>
                  </div>
                </div>
                <ul className="plan-features">
                  <li>3 free DeepSeek AI messages</li>
                  <li>No payment details required upfront</li>
                  <li>Instant access upon signup</li>
                </ul>
                <button className="btn secondary" disabled>
                  {!user?.paygEnabled ? "Current mode" : "Completed"}
                </button>
              </div>

              {/* PAYG CARD */}
              <div className="plan-card payg-card featured">
                <div className="plan-card-header">
                  <div className="card-title-row">
                    <h3>Pay As You Chat</h3>
                    <span className="badge payg">METERED</span>
                  </div>
                  <div className="price">
                    $0.10 <small>/ message</small>
                  </div>
                </div>
                
                <div className="payg-setup-box">
                  <strong className="setup-title">⚡ First-Time SubScript PAYG Setup:</strong>
                  <ol className="setup-steps">
                    <li>
                      Go to <a href="https://dashboard.subscriptonarc.com/user" target="_blank" rel="noreferrer">SubScript User Dashboard</a> &rarr; <strong>Manage Commit</strong>.
                    </li>
                    <li>
                      Click <strong>&quot;Commit to a service&quot;</strong> and enter Merchant Name:{" "}
                      <button
                        type="button"
                        onClick={copyMerchantName}
                        className="merchant-tag-btn"
                        title="Click to copy merchant name"
                      >
                        <code className="merchant-tag">okechukwuanigba.sub</code>
                        <span className="copy-badge">{copiedMerchant ? "✓ Copied!" : "📋 Copy"}</span>
                      </button>
                    </li>
                    <li>
                      Commit min <strong>$2 USDC</strong> to activate vault.
                    </li>
                  </ol>

                  <label className="input-label">SubScript Commit ID / Vault Address:</label>
                  <input
                    type="text"
                    placeholder="Paste SubScript Commit ID (cmt_...) or 0x... address"
                    value={paygWalletInput}
                    onChange={(e) => setPaygWalletInput(e.target.value)}
                    className="payg-input"
                  />

                  {user?.paygEnabled ? (
                    <div className="payg-action-wrap">
                      <p className="payg-status">
                        Status: <strong style={{ color: "#65d98f" }}>Active Metered Billing</strong> · Accrued: <strong>${user.paygAccrued}</strong>
                      </p>
                      <button
                        className="btn secondary small"
                        style={{ width: "100%" }}
                        onClick={() => setPayg(false)}
                        disabled={busy !== ""}
                      >
                        {busy === "payg" ? "Updating..." : "Disable Pay-as-you-chat"}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn small"
                      style={{ width: "100%" }}
                      onClick={() => setPayg(true)}
                      disabled={busy !== ""}
                    >
                      {busy === "payg" ? "Saving..." : "Enable Pay-as-you-chat"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* IN-APP TRANSACTION & RECEIPT HISTORY TABLE */}
          {transactions.length > 0 && (
            <div className="notice-box" style={{ marginTop: 24, flexDirection: "column", alignItems: "stretch" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <strong style={{ fontSize: "1.05rem" }}>Receipt & Transaction History</strong>
                <span className="muted" style={{ fontSize: "0.8rem" }}>{transactions.length} record(s)</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", textAlign: "left", opacity: 0.8 }}>
                      <th style={{ padding: "8px 12px" }}>Product</th>
                      <th style={{ padding: "8px 12px" }}>Amount</th>
                      <th style={{ padding: "8px 12px" }}>Status</th>
                      <th style={{ padding: "8px 12px" }}>Receipt Token</th>
                      <th style={{ padding: "8px 12px" }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ padding: "8px 12px", textTransform: "capitalize" }}>
                          <strong>{tx.product}</strong>
                        </td>
                        <td style={{ padding: "8px 12px" }}>${tx.amountUsdc} USDC</td>
                        <td style={{ padding: "8px 12px" }}>
                          <span
                            className={`badge ${
                              tx.status === "PAID"
                                ? "pro"
                                : tx.status === "FAILED"
                                ? "danger"
                                : "free"
                            }`}
                            style={{ fontSize: "0.7rem", padding: "2px 6px" }}
                          >
                            {tx.status}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: "0.8rem", opacity: 0.8 }}>
                          {tx.receiptToken || tx.intentId ? (
                            <span>{tx.receiptToken || tx.intentId}</span>
                          ) : (
                            <span style={{ opacity: 0.4 }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px", opacity: 0.7 }}>
                          {new Date(tx.createdAt * 1000).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SUBSCRIPT USER DM LINK */}
          <div className="notice-box dm-notice-box" style={{ marginTop: 24 }}>
            <div className="dm-notice-content">
              <div>
                <strong style={{ fontSize: "1rem" }}>SubScript User Dashboard & DM</strong>
                <p className="muted" style={{ marginTop: 2 }}>
                  Manage subscriptions, view transaction receipts, or adjust commits on SubScript.
                </p>
              </div>
              <a
                className="btn secondary small"
                href="https://dashboard.subscriptonarc.com/user"
                target="_blank"
                rel="noreferrer"
              >
                Manage in SubScript DM ↗
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
