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
      <form className="card" onSubmit={submit}>
        <h1 className="brand">
          Kris&apos;s <span>Script</span>
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
          placeholder="••••••••"
          required
          minLength={8}
        />
        {error && <div className="error-box">{error}</div>}
        <button className="btn" disabled={busy}>
          {busy ? "Creating account…" : "Sign up"}
        </button>
        <p className="muted mt">
          Already registered? <a href="/login">Sign in</a>
        </p>
      </form>
    </div>
  );
}
