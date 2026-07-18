"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Signup failed.");
      setBusy(false);
      return;
    }
    router.push("/activate");
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
                <div className="brand-meta">Payment verification workspace</div>
              </div>
            </div>
            <h1 className="hero-title" style={{ marginTop: 54 }}>Create the test user.</h1>
            <p className="subtitle">
              Your first flow is the $1 activation checkout. Access unlocks from the signed
              webhook, not from a redirect.
            </p>
          </div>
          <div className="auth-preview">
            <div className="terminal-line">signup - account created</div>
            <div className="terminal-line">checkout - SubScript intent opened</div>
            <div className="terminal-line">webhook - activation verified</div>
          </div>
        </section>
        <form className="card" onSubmit={submit}>
          <span className="badge pro">NEW ACCOUNT</span>
          <h1 className="brand" style={{ fontSize: "1.8rem", marginTop: 18 }}>
            Join Kris&apos;s Script
          </h1>
          <p className="subtitle">Create your account. A one-time $1 USDC activation fee applies.</p>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <label>Password (min 8 characters)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            minLength={8}
          />
          {error && <div className="error-box">{error}</div>}
          <button className="btn" disabled={busy}>
            {busy ? "Creating account..." : "Sign up"}
          </button>
          <p className="muted mt">
            Already registered? <a href="/login">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  );
}
