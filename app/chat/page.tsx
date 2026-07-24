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
      // Refresh recents list after sending
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
  const planLabel =
    user?.plan === "promax" ? "Pro Max" : user?.plan === "pro" ? "Pro" : "Free";
  const badgeClass =
    user?.plan === "promax" ? "promax" : user?.plan === "pro" ? "pro" : "free";

  const userInitials = user?.email ? user.email.charAt(0).toUpperCase() : "K";

  const filteredRecents = recents.filter((r) =>
    r.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="app-shell chat-shell wireframe-layout">
      {/* SIDEBAR DRAWER OVERLAY & PANEL */}
      {sidebarOpen && (
        <div className="drawer-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`rail ${sidebarOpen ? "open" : ""}`}>
        <div className="rail-header">
          <div className="rail-brand">
            <div className="mark">KS</div>
            <div className="brand-title">Kris&apos;s Script</div>
          </div>
          <button className="icon-btn drawer-close" onClick={() => setSidebarOpen(false)} title="Close menu">
            ✕
          </button>
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
                  <span className="recent-icon">💬</span>
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
                    <strong>Manage subscription</strong>
                    <div className="muted" style={{ fontSize: "0.82rem", marginTop: 2 }}>
                      Current plan: <strong style={{ color: "#fff" }}>{planLabel}</strong>
                      {user?.planExpiresAt &&
                        ` · ${user.subCancelAtPeriodEnd ? "Ends" : "Renews"} ${new Date(
                          user.planExpiresAt * 1000
                        ).toLocaleDateString()}`}
                    </div>
                  </div>
                  <a className="btn small" href="/pricing">
                    {user?.plan === "free" ? "Upgrade" : "Manage"}
                  </a>
                </div>
              </div>

              <div className="modal-card">
                <strong style={{ display: "block", marginBottom: 6 }}>Usage & Allowance</strong>
                <div className="muted" style={{ fontSize: "0.84rem" }}>
                  {user?.plan === "promax" && "✨ Unlimited DeepSeek messages included"}
                  {user?.plan === "pro" && `⚡ ${user.todayCount} / ${user.proDailyCap} messages used today`}
                  {user?.plan === "free" &&
                    `💬 ${Math.max(0, user.freeCap - user.freeUsed)} of ${user.freeCap} free messages remaining`}
                </div>
              </div>

              {user?.paygEnabled && (
                <div className="modal-card">
                  <strong style={{ display: "block", marginBottom: 4 }}>Pay-as-you-chat Vault</strong>
                  <div className="muted" style={{ fontSize: "0.82rem" }}>
                    Status: <span style={{ color: "#65d98f" }}>Active Metered Billing</span> · Accrued: ${user.paygAccrued}
                  </div>
                </div>
              )}

              <button className="btn secondary danger-btn" onClick={logout} style={{ marginTop: 14 }}>
                Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CHAT AREA */}
      <section className="app-main">
        {/* TOPBAR HEADER (WIREFRAME 1) */}
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-btn hamburger" onClick={() => setSidebarOpen(true)} title="Open Menu">
              ☰
            </button>
            
            {/* CENTER PLAN SELECTOR / DROPDOWN PILL */}
            <div className="plan-selector-wrap">
              <button
                className="plan-selector-pill"
                onClick={() => setPlanDropdownOpen(!planDropdownOpen)}
              >
                <span>Kris&apos;s Script ({planLabel})</span>
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
              <section className="empty-state wireframe-empty">
                <div className="logo-spark">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"
                      fill="url(#sparkGradient)"
                    />
                    <defs>
                      <linearGradient id="sparkGradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#60a5fa" />
                        <stop offset="0.5" stopColor="#a855f7" />
                        <stop offset="1" stopColor="#f43f5e" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                
                <h1 className="hero-heading">What should we focus on?</h1>

                <div className="prompt-row">
                  <div
                    className="prompt-chip"
                    onClick={() => sendText("Explain how my current plan is billed.")}
                  >
                    Explain how my current plan is billed.
                  </div>
                  <div
                    className="prompt-chip"
                    onClick={() => sendText("Draft a SubScript webhook test checklist.")}
                  >
                    Draft a SubScript webhook test checklist.
                  </div>
                  <div
                    className="prompt-chip"
                    onClick={() => sendText("Compare PAYG vs weekly plans for this app.")}
                  >
                    Compare PAYG vs weekly plans for this app.
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

          {/* FLOATING COMPOSER PILL AT BOTTOM (WIREFRAME 1) */}
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

              <button className="composer-send-btn" disabled={busy || !input.trim()} title="Send">
                ↑
              </button>
            </form>
          </div>
        </main>
      </section>
    </div>
  );
}
