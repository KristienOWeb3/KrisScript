"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Login failed.");
      setBusy(false);
      return;
    }
    router.push(data.activated ? "/chat" : "/activate");
  }

  return (
    <div className="center-page">
      <div className="auth-grid">
        <section className="auth-copy">
          <div>
            <div className="rail-brand">
              <div className="mark">KS</div>
              <div className="brand-copy">
                <div className="brand-title">Kris&apos;s Script</div>
                <div className="brand-meta">Return to the workspace</div>
              </div>
            </div>
            <h1 className="hero-title" style={{ marginTop: 54 }}>Pick up the run.</h1>
            <p className="subtitle">
              Continue validating activation fees, recurring subscription events, and metered
              chat billing from a single compact workspace.
            </p>
          </div>
          <div className="auth-preview">
            <div className="terminal-line">session - authenticated</div>
            <div className="terminal-line">plan - synced from webhook state</div>
            <div className="terminal-line">chat - ready</div>
          </div>
        </section>
        <form className="card" onSubmit={submit}>
          <span className="badge free">SIGN IN</span>
          <h1 className="brand" style={{ fontSize: "1.8rem", marginTop: 18 }}>
            Welcome back
          </h1>
          <p className="subtitle">Enter your account details to reopen your chat workspace.</p>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <div className="error-box">{error}</div>}
          <button className="btn" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
          <p className="muted mt">
            New here? <a href="/signup">Create an account</a>
          </p>
        </form>
      </div>
    </div>
  );
}
