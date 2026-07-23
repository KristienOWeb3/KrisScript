"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Msg = { role: string; content: string; billed?: string | null };

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ error: string; reason?: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadMe() {
    const data = await fetch("/api/me").then((r) => r.json());
    if (!data.user) return router.replace("/login");
    if (!data.user.activated) return router.replace("/activate");
    setMe(data);
  }

  useEffect(() => {
    loadMe();
    fetch("/api/chat")
      .then((r) => r.json())
      .then((d) => d.messages && setMessages(d.messages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, blocked]);

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
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessages((m) => m.slice(0, -1));
      setBlocked({ error: data.error || "Something went wrong.", reason: data.reason });
      setInput(text);
    } else {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], billed: data.billed };
        return [...copy, { role: "assistant", content: data.reply }];
      });
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

  return (
    <div className="app-shell chat-shell">
      <aside className="rail">
        <div className="rail-brand">
          <div className="mark">KS</div>
          <div className="brand-copy">
            <div className="brand-title">Kris&apos;s Script</div>
            <div className="brand-meta">DeepSeek + SubScript</div>
          </div>
        </div>
        <nav className="rail-section">
          <div className="rail-label">Workspace</div>
          <a className="nav-link active" href="/chat">
            Chat <span>Live</span>
          </a>
          <a className="nav-link" href="/pricing">
            Billing <span>{planLabel}</span>
          </a>
        </nav>
        <div className="rail-section">
          <div className="rail-label">Current user</div>
          <div className="prompt-chip">{user?.email ?? "Loading account..."}</div>
          <div className="status-row">
            {me?.devMode && <span className="badge dev">DEV</span>}
            {user && <span className={`badge ${badgeClass}`}>{planLabel}</span>}
            {user?.paygEnabled && user?.plan === "free" && (
              <span className="badge payg">PAYG ${user.paygAccrued}</span>
            )}
          </div>
        </div>
        <div className="rail-bottom">
          <a className="btn secondary small" href="/pricing">
            Manage billing
          </a>
          <button className="btn ghost small" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <section className="app-main">
        <header className="topbar">
          <div className="topbar-title">
            <strong>Chat</strong>
            <span>Messages are gated by activation, plan state, and metered usage.</span>
          </div>
          <div className="topbar-actions">
            {user && user.plan === "free" && !user.paygEnabled && (
              <span className="badge free">
                {Math.max(0, user.freeCap - user.freeUsed)}/{user.freeCap} free left
              </span>
            )}
            {user?.plan === "pro" && (
              <span className="badge pro">{user.todayCount}/{user.proDailyCap} today</span>
            )}
            {user?.plan === "promax" && <span className="badge promax">Unlimited</span>}
          </div>
        </header>

        <main className="chat-main">
          <div className="chat-messages">
            {messages.length === 0 && (
              <section className="empty-state">
                <div className="prompt-card">
                  <span className="badge pro">READY</span>
                  <h1 className="brand" style={{ fontSize: "2rem", marginTop: 14 }}>
                    What should we test?
                  </h1>
                  <p className="subtitle">
                    Ask the assistant normally, or probe a billing edge case. Free users get{" "}
                    {user?.freeCap ?? 3} messages before Pro, Pro Max, or metered billing is needed.
                  </p>
                </div>
                <div className="prompt-row">
                  <div
                    className="prompt-chip"
                    style={{ cursor: "pointer" }}
                    onClick={() => sendText("Explain how my current plan is billed.")}
                  >
                    Explain how my current plan is billed.
                  </div>
                  <div
                    className="prompt-chip"
                    style={{ cursor: "pointer" }}
                    onClick={() => sendText("Draft a SubScript webhook test checklist.")}
                  >
                    Draft a SubScript webhook test checklist.
                  </div>
                  <div
                    className="prompt-chip"
                    style={{ cursor: "pointer" }}
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

          <div className="chat-composer-wrap">
            <form className="chat-composer" onSubmit={send}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message Kris's Script..."
                maxLength={4000}
              />
              <button className="btn" disabled={busy || !input.trim()}>
                Send
              </button>
            </form>
          </div>
        </main>
      </section>
    </div>
  );
}
