"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "../components/Icon";
import { PLANS, PLAN_ORDER, tierView } from "@/lib/plans";

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
  const [commitInput, setCommitInput] = useState("");
  const [walletInput, setWalletInput] = useState("");
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
      /* Not prefilled: what is already saved is shown as an "On file" hint
         under each input instead, so the boxes stay empty for new entry and a
         cleared field cannot be silently re-submitted. */

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
        showToast("Status synchronized with SubScript.");
      } else {
        showToast("Sync checked: No changes detected.");
      }
    } catch {
      setError("Failed to sync status.");
    } finally {
      setIsSyncing(false);
    }
  }

  /** Start a monthly plan and hand off to SubScript checkout. */
  async function subscribe(plan: string) {
    setBusy(plan);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start the subscription.");
        setBusy("");
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch {
      setError("Network error. Please try again.");
      setBusy("");
    }
  }

  /** Cancel at period end — access continues until the plan expires. */
  async function cancelPlan() {
    setBusy("cancel");
    setError("");
    try {
      const res = await fetch("/api/billing/cancel-subscription", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Could not cancel the subscription.");
      else {
        showToast("Subscription cancelled. Access runs to the end of the period.");
        await load();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy("");
    }
  }

  /* Save the identifiers without touching the pay-as-you-chat toggle, so an
     address can be put on file purely to bind subscriptions and get the DM
     offer written. */
  async function saveIdentifiers() {
    setBusy("save");
    setError("");
    const res = await fetch("/api/billing/payg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commitId: commitInput.trim(), walletAddress: walletInput.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
    } else {
      showToast("Saved.");
      setCommitInput("");
      setWalletInput("");
      load();
    }
    setBusy("");
  }

  async function setPayg(enabled: boolean) {
    setBusy("payg");
    setError("");
    const res = await fetch("/api/billing/payg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        commitId: commitInput.trim(),
        walletAddress: walletInput.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
    } else {
      showToast(enabled ? "Pay-as-you-chat enabled." : "Pay-as-you-chat disabled.");
      load();
    }
    setBusy("");
  }

  const user = me?.user;
  /* Same rule as /chat: nothing derived from `user` is rendered until
     /api/me answers, so no account briefly sees another's placeholder. */
  const loading = !me;
  /* Same tier derivation as /chat, from the one shared definition. */
  const tier = tierView(user);
  const planAllowance = user?.planActive
    ? `${user.planRemaining} of ${user.planCap} messages left this month`
    : null;
  const displayName = user?.displayName || user?.email?.split("@")[0] || "";

  return (
    <div className="app-shell">
      {/* TOAST NOTIFICATION POPUP */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            background: "#232427",
            color: "#3dbb72",
            padding: "12px 20px",
            borderRadius: "8px",
            border: "1px solid #3dbb72",
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
              <div className="brand-meta">Pay-As-You-Go Billing</div>
            </div>
          </div>
        </div>

        <div className="drawer-actions" style={{ marginTop: 12 }}>
          <a className="new-chat-btn" href="/chat" style={{ textDecoration: "none" }}>
            <span className="btn-icon">
              <Icon name="message" size={16} />
            </span>
            <span>Back to Chat</span>
          </a>
        </div>

        <div className="rail-section" style={{ marginTop: 16 }}>
          <div className="rail-label">Billing Options</div>
          <div className="recent-item">
            <Icon name="gift" size={14} />
            <span className="recent-title">3 Free Trial Messages</span>
          </div>
          <div className="recent-item">
            <Icon name="zap" size={14} />
            <span className="recent-title">SubScript Pay-As-You-Go ($0.10/msg)</span>
          </div>
        </div>

        <div className="rail-bottom profile-bar" aria-busy={loading || undefined}>
          {loading ? (
            <div className="profile-info">
              <div className="skeleton skeleton-avatar" />
              <div className="profile-details">
                <span className="skeleton skeleton-line" style={{ width: 84 }} />
                <span className="skeleton skeleton-line sm" style={{ width: 104 }} />
              </div>
            </div>
          ) : (
            <div className="profile-info">
              <div className="avatar">{displayName.charAt(0).toUpperCase()}</div>
              <div className="profile-details">
                <span className="profile-name">{displayName}</span>
                <span className={`badge ${tier.id}`}>{tier.label}</span>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <a className="icon-btn" href="/chat" title="Back to Chat">
              <Icon name="arrow-left" size={17} />
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
              {isSyncing ? (
                  "Syncing..."
                ) : (
                  <>
                    <Icon name="refresh" size={14} />
                    <span>Refresh Status</span>
                  </>
                )}
            </button>
            {me?.devMode && <span className="badge dev">DEV MODE</span>}
            {user && <span className={`badge ${tier.id}`}>{tier.label}</span>}
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
                <span>
                  Current plan:{" "}
                  <span className={`badge ${tier.id}`}>{tier.label}</span>
                </span>
                {planAllowance && (
                  <span>
                    {" · "}
                    <strong>{planAllowance}</strong>
                    {user.subCancelAtPeriodEnd && " · cancels at period end"}
                  </span>
                )}
                <span> · Trial Used: <strong>{user.freeUsed ?? 0} / {user.freeCap ?? 0} free messages</strong></span>
                {user.paygEnabled && (
                  <span> · Accrued Usage: <strong>${user.paygAccrued} USDC</strong></span>
                )}
              </div>
            </div>
          )}
          {user?.subAlertMessage && (
            <div className="notice-box plan-alert-note">{user.subAlertMessage}</div>
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
                <div className="payment-method-icon">
                  <Icon name="zap" size={18} />
                </div>
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
                <div className="payment-method-icon">
                  <Icon name="card" size={18} />
                </div>
                <div className="payment-method-details">
                  <strong>Card</strong>
                  <span>Credit / Debit Card (Disabled)</span>
                </div>
              </div>
            </div>
          </div>

          {/* PLANS GRID */}
          <div className="plans-horizontal-wrap">
            <div className="plans plans-horizontal">
              {/* FREE TRIAL CARD */}
              <div className="plan-card ui-card">
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
              <div className="plan-card payg-card featured ui-card">
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
                  <strong className="setup-title">
                    <Icon name="zap" size={14} />
                    <span>SubScript Metered Vault Setup:</span>
                  </strong>
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
                        <span className="copy-badge">
                          <Icon name={copiedMerchant ? "check" : "copy"} size={12} />
                          <span>{copiedMerchant ? "Copied" : "Copy"}</span>
                        </span>
                      </button>
                    </li>
                    <li>
                      Commit min <strong>$2 USDC</strong> to activate vault.
                    </li>
                  </ol>

                  <label className="input-label">
                    SubScript Commit ID — metered usage:
                  </label>
                  <input
                    type="text"
                    placeholder="cmt_..."
                    value={commitInput}
                    onChange={(e) => setCommitInput(e.target.value)}
                    className="payg-input"
                  />
                  {user?.commitId && (
                    <p className="input-hint">
                      On file: <code>{user.commitId}</code>
                    </p>
                  )}

                  <label className="input-label">
                    Wallet address — subscriptions and DM offers:
                  </label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={walletInput}
                    onChange={(e) => setWalletInput(e.target.value)}
                    className="payg-input"
                  />
                  {user?.walletAddress ? (
                    <p className="input-hint">
                      On file: <code>{user.walletAddress}</code>
                    </p>
                  ) : (
                    <p className="input-hint warn">
                      No address on file. A plan checkout still publishes to the plan
                      catalogue, but SubScript only writes the DM subscription offer when it
                      receives a subscriber address — so the thread stays empty without this.
                    </p>
                  )}
                  {user && !user.dmPublishing && (
                    <p className="input-hint warn">
                      DM publishing is off on this deployment. Set{" "}
                      <code>SUBSCRIPT_PUBLISH_TO_DM=1</code> to publish plans into the
                      catalogue and DM flow.
                    </p>
                  )}

                  <button
                    className="btn secondary small"
                    style={{ width: "100%", marginBottom: 10 }}
                    onClick={saveIdentifiers}
                    disabled={busy !== "" || (!commitInput.trim() && !walletInput.trim())}
                  >
                    {busy === "save" ? "Saving..." : "Save identifiers"}
                  </button>

                  {user?.paygEnabled ? (
                    <div className="payg-action-wrap">
                      <p className="payg-status">
                        Status: <strong style={{ color: "#3dbb72" }}>Active Metered Billing</strong> · Accrued: <strong>${user.paygAccrued}</strong>
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

              {/* MONTHLY SUBSCRIPTION TIERS */}
              {PLAN_ORDER.map((id) => {
                const tier = PLANS[id];
                const isCurrent = user?.planActive && user?.plan === id;
                return (
                  <div
                    key={id}
                    className={`plan-card ui-card${isCurrent ? " active-plan-card" : ""}`}
                  >
                    <div className="plan-card-header">
                      <div className="card-title-row">
                        <h3>{tier.name}</h3>
                        {isCurrent && <span className="badge payg">CURRENT</span>}
                      </div>
                      <div className="price">
                        ${tier.priceUsdc} <small>/ month</small>
                      </div>
                    </div>
                    <ul className="plan-features">
                      <li>{tier.messages} messages per month</li>
                      <li>Allowance resets on renewal</li>
                      <li>Cancel anytime — access runs to period end</li>
                    </ul>

                    {isCurrent ? (
                      <div className="payg-action-wrap">
                        <p className="payg-status">
                          {user.planRemaining} of {user.planCap} left this month
                          {user.subCancelAtPeriodEnd && " · cancels at period end"}
                        </p>
                        {user.subCancelAtPeriodEnd ? (
                          <button className="btn secondary small" style={{ width: "100%" }} disabled>
                            Cancels at period end
                          </button>
                        ) : (
                          <button
                            className="btn secondary small danger-btn"
                            style={{ width: "100%" }}
                            onClick={cancelPlan}
                            disabled={busy !== ""}
                          >
                            {busy === "cancel" ? "Cancelling..." : "Cancel subscription"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        className="btn small"
                        style={{ width: "100%" }}
                        onClick={() => subscribe(id)}
                        disabled={busy !== ""}
                      >
                        {busy === id ? "Starting..." : `Subscribe · $${tier.priceUsdc}/mo`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* IN-APP TRANSACTION HISTORY TABLE */}
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

          {/* SUBSCRIPT USER DASHBOARD LINK */}
          <div className="notice-box dm-notice-box" style={{ marginTop: 24 }}>
            <div className="dm-notice-content">
              <div>
                <strong style={{ fontSize: "1rem" }}>SubScript User Dashboard & DM</strong>
                <p className="muted" style={{ marginTop: 2 }}>
                  Manage metered commits, view transaction receipts, or adjust vault limits on SubScript.
                </p>
              </div>
              <a
                className="btn secondary small"
                href="https://dashboard.subscriptonarc.com/user"
                target="_blank"
                rel="noreferrer"
              >
                <span>Manage in SubScript DM</span>
                <Icon name="arrow-up-right" size={14} />
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
