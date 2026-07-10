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

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
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
      // Remove the optimistic message — it was not accepted/billed.
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
    <div className="chat-shell">
      <header className="chat-header">
        <h1 className="brand" style={{ fontSize: "1.15rem" }}>
          Kris&apos;s <span>Script</span>
        </h1>
        <div className="status">
          {me?.devMode && <span className="badge dev">DEV</span>}
          {user && <span className={`badge ${badgeClass}`}>{planLabel}</span>}
          {user?.paygEnabled && user?.plan === "free" && (
            <span className="badge payg">PAYG ${user.paygAccrued}</span>
          )}
          {user && user.plan === "free" && !user.paygEnabled && (
            <span className="muted">
              {Math.max(0, user.freeCap - user.freeUsed)}/{user.freeCap} free left
            </span>
          )}
          {user?.plan === "pro" && (
            <span className="muted">{user.todayCount}/{user.proDailyCap} today</span>
          )}
          <a className="btn secondary small" href="/pricing">
            Plans
          </a>
          <button className="btn secondary small" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="chat-messages">
        {messages.length === 0 && (
          <p className="muted" style={{ textAlign: "center", marginTop: 40 }}>
            Say hello — your first {user?.freeCap ?? 3} messages are free.
          </p>
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
        {busy && <div className="msg assistant muted">Thinking…</div>}
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
      </main>

      <form className="chat-composer" onSubmit={send}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message Kris's Script…"
          maxLength={4000}
        />
        <button className="btn" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
