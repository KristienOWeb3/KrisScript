"use client";

import { useEffect, useRef, useState } from "react";
import LoadingState from "../components/LoadingState";
import StreamingText from "../components/StreamingText";
import PillPromptBar from "../components/PillPromptBar";
import CodeBlock from "../components/CodeBlock";
import Icon from "../components/Icon";
import MessageActions from "../components/MessageActions";
import { useRouter } from "next/navigation";

type Msg = { role: string; content: string; billed?: string | null };

/** messages.billed holds "free", "payg", or a plan id. */
const PLAN_LABELS: Record<string, string> = {
  pro: "Pro",
  promax: "Pro Max",
  ultra: "Ultra",
};

function billLabel(billed: string): string {
  if (billed === "free") return "free message";
  if (billed === "payg") return "billed $0.10 (pay-as-you-chat)";
  const name = PLAN_LABELS[billed];
  return name ? `included in ${name}` : billed;
}
type RecentThread = { threadId: string; title: string; createdAt: number };

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [recents, setRecents] = useState<RecentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** Content of the reply currently being typed out, or null. */
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ error: string; reason?: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [planDropdownOpen, setPlanDropdownOpen] = useState(false);
  const [paygWalletInput, setPaygWalletInput] = useState("");
  const [paygSaving, setPaygSaving] = useState(false);
  const [copiedMerchant, setCopiedMerchant] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  function copyMerchantName() {
    navigator.clipboard.writeText("okechukwuanigba.sub");
    setCopiedMerchant(true);
    setTimeout(() => setCopiedMerchant(false), 2000);
  }

  async function enablePayg() {
    if (!paygWalletInput.trim()) return;
    setPaygSaving(true);
    try {
      const res = await fetch("/api/billing/payg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, walletAddress: paygWalletInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setBlocked(null);
        await loadMe();
      } else {
        alert(data.error || "Failed to save Pay-as-you-chat.");
      }
    } catch {
      alert("Network error.");
    } finally {
      setPaygSaving(false);
    }
  }

  /** Start the $1 USDC display-name change and hand off to SubScript checkout. */
  async function startNameChange() {
    const requested = nameInput.trim();
    if (!requested || nameBusy) return;
    setNameBusy(true);
    setNameError(null);
    try {
      const res = await fetch("/api/billing/name-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: requested }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNameError(data.error || "Could not start the name change.");
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch {
      setNameError("Network error. Please try again.");
    } finally {
      setNameBusy(false);
    }
  }

  /** Drop a name change that was started but never paid for. */
  async function cancelNameChange() {
    setNameBusy(true);
    setNameError(null);
    try {
      await fetch("/api/billing/name-change", { method: "DELETE" });
      setNameInput("");
      await loadMe();
    } catch {
      setNameError("Network error. Please try again.");
    } finally {
      setNameBusy(false);
    }
  }

  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadMe() {
    const data = await fetch("/api/me").then((r) => r.json());
    if (!data.user) return router.replace("/login");
    if (!data.user.activated) return router.replace("/activate");
    setMe(data);
  }

  async function loadThread(threadId?: string | null) {
    const url = threadId ? `/api/chat?thread_id=${encodeURIComponent(threadId)}` : "/api/chat";
    const data = await fetch(url).then((r) => r.json());
    if (data.messages) setMessages(data.messages);
    if (data.recents) setRecents(data.recents);
    if (data.activeThreadId !== undefined) setActiveThreadId(data.activeThreadId);
  }

  useEffect(() => {
    loadMe();
    loadThread(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, blocked]);

  // Keep the view pinned to the bottom while a reply types itself out.
  useEffect(() => {
    if (!streamingReply) return;
    const t = setInterval(() => bottomRef.current?.scrollIntoView({ block: "end" }), 120);
    return () => clearInterval(t);
  }, [streamingReply]);

  function startNewChat() {
    setActiveThreadId(`thread_${Math.random().toString(36).substring(2, 10)}`);
    setMessages([]);
    setBlocked(null);
    setStreamingReply(null);
    setSidebarOpen(false);
  }

  function selectThread(tId: string) {
    setActiveThreadId(tId);
    loadThread(tId);
    setStreamingReply(null);
    setSidebarOpen(false);
  }

  async function sendText(textToSend: string) {
    const text = textToSend.trim();
    if (!text || busy) return;
    setBusy(true);
    setBlocked(null);
    setStreamingReply(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, threadId: activeThreadId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessages((m) => m.slice(0, -1));
      setBlocked({ error: data.error || "Something went wrong.", reason: data.reason });
      setInput(text);
    } else {
      if (data.threadId) setActiveThreadId(data.threadId);
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], billed: data.billed };
        return [...copy, { role: "assistant", content: data.reply }];
      });
      // Replies containing a fenced code block render instantly — typing a code
      // block out character by character just looks like a stutter.
      const hasCode = /```[\s\S]*?```/.test(data.reply ?? "");
      setStreamingReply(hasCode ? null : data.reply);
      loadThread(data.threadId || activeThreadId);
    }
    setBusy(false);
    loadMe();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const user = me?.user;
  /* /api/me hasn't answered yet. Everything derived from `user` is unknown
     until it does, so the UI shows skeletons rather than guessing — the old
     fallbacks rendered "Kristien" and "Free Trial (3 left)" to every account
     for a beat before snapping to the real values. */
  const loading = !me;
  const isPayg = !!user?.paygEnabled;
  const freeRemaining = Math.max(0, (user?.freeCap ?? 0) - (user?.freeUsed ?? 0));
  /* Precedence matches the chat gate: free trial first, then plan allowance,
     then metered. Whichever will actually pay for the next message is shown. */
  const planActive = !!user?.planActive;
  const planLabel = freeRemaining > 0
    ? `Free Trial (${freeRemaining} left)`
    : planActive
      ? `${user.planName} (${user.planRemaining} of ${user.planCap} left)`
      : isPayg
        ? "Pay-As-You-Chat ($0.10/msg)"
        : "No messages left";
  const badgeClass = isPayg ? "pro" : "free";
  const userName = user?.displayName || user?.email?.split("@")[0] || "";
  const userInitials = userName.charAt(0).toUpperCase();
  const pendingName: string | null = user?.pendingDisplayName ?? null;
  const nameChangePrice = me?.nameChangePriceUsdc ?? "1.00";

  const filteredRecents = recents.filter((r) =>
    r.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function renderMessageContent(content: string, stream = false) {
    const codeMatch = content.match(/```(\w+)?\n([\s\S]*?)```/);
    if (codeMatch) {
      const lang = codeMatch[1] || "javascript";
      const code = codeMatch[2];
      const parts = content.split(/```[\s\S]*?```/);
      return (
        <div>
          {parts[0] && <div style={{ marginBottom: 8 }}>{parts[0]}</div>}
          <CodeBlock code={code} language={lang} />
          {parts[1] && <div style={{ marginTop: 8 }}>{parts[1]}</div>}
        </div>
      );
    }
    if (stream) {
      return <StreamingText text={content} onDone={() => setStreamingReply(null)} />;
    }
    return <div>{content}</div>;
  }

  return (
    <div className={`app-shell chat-shell wireframe-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* SIDEBAR DRAWER OVERLAY */}
      {sidebarOpen && (
        <div className="drawer-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* LEFT SIDEBAR NAV */}
      <aside className={`rail ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="rail-header">
          <div className="rail-brand">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"
                fill="url(#sidebarSparkGrad)"
              />
              <defs>
                <linearGradient id="sidebarSparkGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#3d9aff" />
                  <stop offset="0.5" stopColor="#8b5cf6" />
                  <stop offset="1" stopColor="#ee5c61" />
                </linearGradient>
              </defs>
            </svg>
            <div className="brand-title">Kris&apos;s Script</div>
          </div>
          <button
            className="icon-btn collapse-toggle-btn"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title="Collapse sidebar"
          >
            <Icon name="panel-left" size={16} />
          </button>
        </div>

        <div className="drawer-actions">
          <button className="new-chat-btn" onClick={startNewChat}>
            <span className="btn-icon">
              <Icon name="pencil" size={16} />
            </span>
            <span>New chat</span>
          </button>

          <div className="search-box">
            <span className="search-icon">
              <Icon name="search" size={15} />
            </span>
            <input
              type="text"
              placeholder="Search chats"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* RECENTS SECTION */}
        <div className="rail-section recents-section">
          <span className="rail-label">Recents</span>
          <div className="recents-list">
            {filteredRecents.length === 0 ? (
              <div className="empty-recents">No recent chats</div>
            ) : (
              filteredRecents.map((r) => (
                <button
                  key={r.threadId}
                  className={`recent-item ${activeThreadId === r.threadId ? "active" : ""}`}
                  onClick={() => selectThread(r.threadId)}
                >
                  <span className="recent-title">{r.title}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* BOTTOM USER PROFILE BAR */}
        <div
          className="rail-bottom profile-bar"
          onClick={loading ? undefined : () => setProfileModalOpen(true)}
          aria-busy={loading || undefined}
        >
          {loading ? (
            <div className="profile-info">
              <div className="skeleton skeleton-avatar" />
              <div className="profile-details">
                <span className="skeleton skeleton-line" style={{ width: 84 }} />
                <span className="skeleton skeleton-line sm" style={{ width: 118 }} />
              </div>
            </div>
          ) : (
            <div className="profile-info">
              <div className="avatar">{userInitials}</div>
              <div className="profile-details">
                <span className="profile-name">{userName}</span>
                <span className={`badge ${badgeClass}`}>{planLabel}</span>
              </div>
            </div>
          )}
          <button
            className="icon-btn settings-gear"
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation();
              setProfileModalOpen(true);
            }}
            title="Settings & Account"
          >
            <Icon name="settings" size={16} />
          </button>
        </div>
      </aside>

      {/* USER PROFILE & ACCOUNT MODAL */}
      {profileModalOpen && (
        <div className="modal-overlay" onClick={() => setProfileModalOpen(false)}>
          <div className="modal-content profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="user-email-tag">{user?.email}</span>
              <button className="icon-btn" onClick={() => setProfileModalOpen(false)}>
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="profile-hero">
              <div className="avatar large">{userInitials}</div>
              <h2>Hi, {userName}!</h2>
            </div>

            <div className="modal-body">
              {/* PAID DISPLAY NAME CHANGE — $1 USDC one-time via SubScript */}
              <div className="modal-card">
                <div className="card-row">
                  <div>
                    <strong>Display Name</strong>
                    <div className="muted" style={{ fontSize: "0.82rem", marginTop: 2 }}>
                      Currently <strong style={{ color: "var(--ink)" }}>{userName}</strong>
                      {user?.hasCustomName ? "" : " (from your email)"}
                    </div>
                  </div>
                  <span className="badge payg">${nameChangePrice} USDC</span>
                </div>

                {pendingName ? (
                  <div className="name-change-pending">
                    <div className="muted" style={{ fontSize: "0.82rem" }}>
                      Waiting on payment to rename to{" "}
                      <strong style={{ color: "var(--ink)" }}>{pendingName}</strong>. It applies
                      as soon as the ${nameChangePrice} USDC clears.
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        className="btn small"
                        style={{ width: "auto" }}
                        onClick={() => {
                          setNameInput(pendingName);
                          startNameChange();
                        }}
                        disabled={nameBusy}
                      >
                        {nameBusy ? "Opening..." : "Resume payment"}
                      </button>
                      <button
                        className="btn ghost small"
                        style={{ width: "auto" }}
                        onClick={cancelNameChange}
                        disabled={nameBusy}
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <input
                        type="text"
                        placeholder="New display name"
                        value={nameInput}
                        maxLength={32}
                        onChange={(e) => {
                          setNameInput(e.target.value);
                          setNameError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") startNameChange();
                        }}
                        style={{ fontSize: "0.85rem", height: 38 }}
                      />
                      <button
                        className="btn small"
                        style={{ width: "auto", whiteSpace: "nowrap" }}
                        onClick={startNameChange}
                        disabled={nameBusy || !nameInput.trim()}
                      >
                        {nameBusy ? "Opening..." : `Pay $${nameChangePrice}`}
                      </button>
                    </div>
                    <div className="muted" style={{ fontSize: "0.76rem", marginTop: 6 }}>
                      2-32 characters. Charged once per change, in USDC via SubScript. The name
                      only changes after payment clears.
                    </div>
                  </>
                )}

                {nameError && (
                  <div className="name-change-error">{nameError}</div>
                )}
              </div>

              <div className="modal-card">
                <div className="card-row">
                  <div>
                    <strong>Billing Status</strong>
                    <div className="muted" style={{ fontSize: "0.82rem", marginTop: 2 }}>
                      Current mode: <strong style={{ color: "var(--accent)" }}>{planLabel}</strong>
                    </div>
                  </div>
                  <a className="btn small" href="/pricing">
                    Configure PAYG
                  </a>
                </div>
              </div>

              <div className="modal-card">
                <strong style={{ display: "block", marginBottom: 6 }}>Free Trial Progress</strong>
                <div className="muted" style={{ fontSize: "0.84rem" }}>
                  <Icon name="message" size={14} /> {freeRemaining} of{" "}
                  {user?.freeCap ?? 0} free trial messages remaining
                </div>
              </div>

              <div className="modal-card">
                <strong style={{ display: "block", marginBottom: 4 }}>SubScript Pay-As-You-Chat Vault</strong>
                <div className="muted" style={{ fontSize: "0.82rem" }}>
                  Status: {user?.paygEnabled ? (
                    <span style={{ color: "var(--green)" }}>Active Metered Billing (${user.paygAccrued} accrued)</span>
                  ) : (
                    <span style={{ color: "var(--red)" }}>Not Enabled</span>
                  )}
                </div>
              </div>

              <button className="btn secondary danger-btn" onClick={logout} style={{ marginTop: 14 }}>
                Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CHAT CANVAS */}
      <section className="app-main ui-card">
        <header className="topbar">
          <div className="topbar-left">
            {(sidebarCollapsed || !sidebarOpen) && (
              <button
                className="icon-btn sidebar-toggle-top"
                onClick={() => {
                  if (window.innerWidth <= 900) setSidebarOpen(true);
                  else setSidebarCollapsed(false);
                }}
                title="Open Sidebar"
              >
                <Icon name="menu" size={18} />
              </button>
            )}
          </div>

          <div className="topbar-right">
            <button className="icon-btn new-chat-icon" onClick={startNewChat} title="New Chat">
              <Icon name="pencil" size={16} />
            </button>
          </div>
        </header>

        {/* MESSAGES AREA */}
        <main className="chat-main">
          <div className="chat-messages">
            {messages.length === 0 && (
              <section className="empty-state wireframe-empty desktop-hero">
                <h1 className="hero-heading">What should we focus on?</h1>

                <div className="desktop-centered-pill">
                  <PillPromptBar
                    value={input}
                    onChange={(v) => setInput(v)}
                    onSubmit={(composed) => sendText(composed)}
                    disabled={!!busy}
                    planLabel={loading ? undefined : planLabel}
                    onTogglePlan={() => setPlanDropdownOpen(!planDropdownOpen)}
                  />

                  {planDropdownOpen && (
                    <div className="plan-dropdown-menu" onClick={() => setPlanDropdownOpen(false)}>
                      <div className="dropdown-item header">Status: {planLabel}</div>
                      <a className="dropdown-item" href="/pricing">
                        <Icon name="zap" size={14} />
                        <span>SubScript Pay-As-You-Chat Setup</span>
                      </a>
                    </div>
                  )}
                </div>

                <div className="prompt-row">
                  <div
                    className="prompt-chip"
                    onClick={() => sendText("Explain how SubScript Pay-As-You-Go works.")}
                  >
                    Explain how SubScript Pay-As-You-Go works.
                  </div>
                  <div
                    className="prompt-chip"
                    onClick={() => sendText("How do 3 free trial messages work?")}
                  >
                    How do 3 free trial messages work?
                  </div>
                  <div
                    className="prompt-chip"
                    onClick={() => sendText("Draft a code snippet using Beautiful UI components.")}
                  >
                    Draft a code snippet using Beautiful UI components.
                  </div>
                </div>
              </section>
            )}

            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const stream =
                m.role === "assistant" && isLast && m.content === streamingReply;

              // User turns are a pill that hugs its text; the billing note sits
              // outside it so the pill stays one clean line.
              if (m.role === "user") {
                return (
                  <div key={i} className="msg user">
                    <div className="msg-bubble">{renderMessageContent(m.content)}</div>
                    {m.billed && (
                      <span className="bill-tag">{billLabel(m.billed)}</span>
                    )}
                  </div>
                );
              }

              // Assistant turns have no bubble — the reply sits on the canvas,
              // with its action row underneath once the text has finished.
              return (
                <div key={i} className="msg assistant">
                  {renderMessageContent(m.content, stream)}
                  {!stream && <MessageActions content={m.content} />}
                </div>
              );
            })}

            {busy && (
              <div className="msg assistant muted">
                <LoadingState label="Thinking" variant="Drive" />
              </div>
            )}

            {blocked && (
              <div className="error-box" style={{ alignSelf: "center", maxWidth: 540, width: "100%", padding: 20 }}>
                <strong style={{ fontSize: "1rem", color: "#ee5c61" }}>{blocked.error}</strong>

                <div style={{ marginTop: 14, textAlign: "left", background: "#1c1d1f", padding: 14, borderRadius: 10, border: "1px solid var(--line-strong)" }}>
                  <span style={{ fontSize: "0.84rem", color: "#3dbb72", fontWeight: 650, display: "block", marginBottom: 6 }}>
                    <Icon name="zap" size={13} /> Enable SubScript Pay-As-You-Go ($0.10/msg):
                  </span>
                  <ol style={{ margin: "0 0 10px 0", paddingLeft: 18, fontSize: "0.82rem", color: "var(--ink-2)" }}>
                    <li>
                      Visit <a href="https://dashboard.subscriptonarc.com/user" target="_blank" rel="noreferrer" style={{ color: "#3d9aff" }}>SubScript User Dashboard</a> &rarr; <strong>Manage Commit</strong>.
                    </li>
                    <li>
                      Commit to Merchant Name:{" "}
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
                  </ol>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <input
                      type="text"
                      placeholder="Paste SubScript Commit ID (cmt_...) or 0x... address"
                      value={paygWalletInput}
                      onChange={(e) => setPaygWalletInput(e.target.value)}
                      style={{ fontSize: "0.82rem", height: 38 }}
                    />
                    <button
                      className="btn small"
                      style={{ width: "auto", whiteSpace: "nowrap" }}
                      onClick={enablePayg}
                      disabled={paygSaving || !paygWalletInput.trim()}
                    >
                      {paygSaving ? "Saving..." : "Activate PAYG"}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 12, textAlign: "center" }}>
                  <a className="btn ghost small" href="/pricing">
                    <span>Manage on Billing Page</span>
                    <Icon name="arrow-up-right" size={14} />
                  </a>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {messages.length > 0 && (
            <div className="chat-composer-wrap">
              <PillPromptBar
                value={input}
                onChange={(v) => setInput(v)}
                onSubmit={(composed) => sendText(composed)}
                disabled={!!busy}
                planLabel={loading ? undefined : planLabel}
                onTogglePlan={() => setPlanDropdownOpen(!planDropdownOpen)}
              />

              {planDropdownOpen && (
                <div className="plan-dropdown-menu" onClick={() => setPlanDropdownOpen(false)}>
                  <div className="dropdown-item header">Status: {planLabel}</div>
                  <a className="dropdown-item" href="/pricing">
                    <Icon name="zap" size={14} />
                    <span>SubScript Pay-As-You-Chat Setup</span>
                  </a>
                </div>
              )}
            </div>
          )}
        </main>
      </section>
    </div>
  );
}
