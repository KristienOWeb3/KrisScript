"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Msg = { role: string; content: string; billed?: string | null };
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
  const [blocked, setBlocked] = useState<{ error: string; reason?: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [planDropdownOpen, setPlanDropdownOpen] = useState(false);

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

  function startNewChat() {
    setActiveThreadId(`thread_${Math.random().toString(36).substring(2, 10)}`);
    setMessages([]);
    setBlocked(null);
    setSidebarOpen(false);
  }

  function selectThread(tId: string) {
    setActiveThreadId(tId);
    loadThread(tId);
    setSidebarOpen(false);
  }

  async function sendText(textToSend: string) {
    const text = textToSend.trim();
    if (!text || busy) return;
    setBusy(true);
    setBlocked(null);
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
      loadThread(data.threadId || activeThreadId);
    }
    setBusy(false);
    loadMe();
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    await sendText(input);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const user = me?.user;
  const isPayg = !!user?.paygEnabled;
  const freeRemaining = Math.max(0, (user?.freeCap ?? 3) - (user?.freeUsed ?? 0));
  const planLabel = isPayg
    ? "Pay-As-You-Chat ($0.10/msg)"
    : `Free Trial (${freeRemaining} left)`;
  const badgeClass = isPayg ? "pro" : "free";

  const userInitials = user?.email ? user.email.charAt(0).toUpperCase() : "K";

  const filteredRecents = recents.filter((r) =>
    r.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`app-shell chat-shell wireframe-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* SIDEBAR DRAWER OVERLAY */}
      {sidebarOpen && (
        <div className="drawer-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* LEFT SIDEBAR (WIREFRAME DESKTOP + MOBILE) */}
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
                  <stop stopColor="#60a5fa" />
                  <stop offset="0.5" stopColor="#a855f7" />
                  <stop offset="1" stopColor="#f43f5e" />
                </linearGradient>
              </defs>
            </svg>
            <div className="brand-title">Kris&apos;s Script</div>
          </div>
          <div className="rail-header-actions">
            <button
              className="icon-btn collapse-toggle-btn"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title="Collapse sidebar"
            >
              ◧
            </button>
            <button
              className="icon-btn drawer-close"
              onClick={() => setSidebarOpen(false)}
              title="Close menu"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="drawer-actions">
          <button className="new-chat-btn" onClick={startNewChat}>
            <span className="btn-icon">✏️</span>
            <span>New chat</span>
          </button>

          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search chats"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* RECENTS SECTION ONLY (Strict rule: No notebooks, no image/video) */}
        <div className="rail-section recents-section">
          <div className="rail-label">Recents</div>
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
        <div className="rail-bottom profile-bar" onClick={() => setProfileModalOpen(true)}>
          <div className="profile-info">
            <div className="avatar">{userInitials}</div>
            <div className="profile-details">
              <span className="profile-name">{user?.email ? user.email.split("@")[0] : "Kristien"}</span>
              <span className={`badge ${badgeClass}`}>{planLabel}</span>
            </div>
          </div>
          <button
            className="icon-btn settings-gear"
            onClick={(e) => {
              e.stopPropagation();
              setProfileModalOpen(true);
            }}
            title="Account & Subscription"
          >
            ⚙️
          </button>
        </div>
      </aside>

      {/* USER PROFILE & ACCOUNT MODAL (WIREFRAME 3) */}
      {profileModalOpen && (
        <div className="modal-overlay" onClick={() => setProfileModalOpen(false)}>
          <div className="modal-content profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="user-email-tag">{user?.email}</span>
              <button className="icon-btn" onClick={() => setProfileModalOpen(false)}>
                ✕
              </button>
            </div>

            <div className="profile-hero">
              <div className="avatar large">{userInitials}</div>
              <h2>Hi, {user?.email ? user.email.split("@")[0] : "Kristien"}!</h2>
            </div>

            <div className="modal-body">
              <div className="modal-card">
                <div className="card-row">
                  <div>
                    <strong>Billing Status</strong>
                    <div className="muted" style={{ fontSize: "0.82rem", marginTop: 2 }}>
                      Current mode: <strong style={{ color: "#fff" }}>{planLabel}</strong>
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
                  💬 {Math.max(0, (user?.freeCap ?? 3) - (user?.freeUsed ?? 0))} of {user?.freeCap ?? 3} free trial messages remaining
                </div>
              </div>

              <div className="modal-card">
                <strong style={{ display: "block", marginBottom: 4 }}>SubScript Pay-As-You-Chat Vault</strong>
                <div className="muted" style={{ fontSize: "0.82rem" }}>
                  Status: {user?.paygEnabled ? (
                    <span style={{ color: "#65d98f" }}>Active Metered Billing (${user.paygAccrued} accrued)</span>
                  ) : (
                    <span style={{ color: "#ff7b72" }}>Not Enabled</span>
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

      {/* MAIN CHAT AREA */}
      <section className="app-main">
        {/* TOPBAR HEADER */}
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
                ☰
              </button>
            )}
          </div>

          <div className="topbar-right">
            <button className="icon-btn new-chat-icon" onClick={startNewChat} title="New Chat">
              ✏️
            </button>
          </div>
        </header>

        {/* MAIN MESSAGES CANVAS */}
        <main className="chat-main">
          <div className="chat-messages">
            {messages.length === 0 && (
              <section className="empty-state wireframe-empty desktop-hero">
                <h1 className="hero-heading">What should we focus on?</h1>

                {/* CENTERED DESKTOP FLOATING COMPOSER (WIREFRAME DESKTOP) */}
                <form className="chat-composer desktop-centered-pill" onSubmit={send}>
                  <button className="composer-action-btn" type="button" title="Attach / Options">
                    +
                  </button>

                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask Kris"
                    maxLength={4000}
                  />

                  {/* EMBEDDED PLAN SELECTOR PILL INSIDE INPUT BAR (EXACT WIREFRAME MATCH) */}
                  <div className="embedded-plan-wrap">
                    <button
                      className="embedded-plan-pill"
                      type="button"
                      onClick={() => setPlanDropdownOpen(!planDropdownOpen)}
                    >
                      <span className="dot">•</span>
                      <span>{planLabel}</span>
                      <span className="caret">⌄</span>
                    </button>

                    {planDropdownOpen && (
                      <div className="plan-dropdown-menu" onClick={() => setPlanDropdownOpen(false)}>
                        <div className="dropdown-item header">Status: {planLabel}</div>
                        <a className="dropdown-item" href="/pricing">
                          ⚡ SubScript Pay-As-You-Chat Setup
                        </a>
                      </div>
                    )}
                  </div>

                  <button className="composer-send-btn" disabled={busy || !input.trim()} title="Send">
                    ↑
                  </button>
                </form>

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
                    onClick={() => sendText("Draft a SubScript metered usage test checklist.")}
                  >
                    Draft a SubScript metered usage test checklist.
                  </div>
                </div>
              </section>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.content}
                {m.role === "user" && m.billed && (
                  <span className="bill-tag">
                    {m.billed === "free"
                      ? "free message"
                      : m.billed === "plan"
                        ? "included in plan"
                        : "billed $0.10 (pay-as-you-chat)"}
                  </span>
                )}
              </div>
            ))}

            {busy && <div className="msg assistant muted">Thinking...</div>}

            {blocked && (
              <div className="error-box" style={{ alignSelf: "center", textAlign: "center" }}>
                {blocked.error}
                <div style={{ marginTop: 10 }}>
                  <a className="btn small" href="/pricing" style={{ width: "auto" }}>
                    {blocked.reason === "vault" ? "Manage pay-as-you-chat" : "See plans"}
                  </a>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* FLOATING COMPOSER PILL WHEN ACTIVE MESSAGES EXIST */}
          {messages.length > 0 && (
            <div className="chat-composer-wrap">
              <form className="chat-composer floating-pill" onSubmit={send}>
                <button className="composer-action-btn" type="button" title="Attach / Options">
                  +
                </button>

                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask Kris"
                  maxLength={4000}
                />

                <div className="embedded-plan-wrap">
                  <button
                    className="embedded-plan-pill"
                    type="button"
                    onClick={() => setPlanDropdownOpen(!planDropdownOpen)}
                  >
                    <span className="dot">•</span>
                    <span>{planLabel}</span>
                    <span className="caret">⌄</span>
                  </button>

                  {planDropdownOpen && (
                    <div className="plan-dropdown-menu" onClick={() => setPlanDropdownOpen(false)}>
                      <div className="dropdown-item header">Current Plan: {planLabel}</div>
                      <a className="dropdown-item" href="/pricing">
                        ⚡ Upgrade or Manage Subscription
                      </a>
                      <a className="dropdown-item" href="/pricing">
                        💳 Metered Vault Billing (PAYG)
                      </a>
                    </div>
                  )}
                </div>

                <button className="composer-send-btn" disabled={busy || !input.trim()} title="Send">
                  ↑
                </button>
              </form>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}
