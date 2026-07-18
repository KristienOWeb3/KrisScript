"use client";

import { useEffect, useState } from "react";

export default function BillingSuccessPage() {
  const [me, setMe] = useState<any>(null);
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const load = () =>
      fetch("/api/me")
        .then((r) => r.json())
        .then((d) => setMe(d));
    load();
    const t = setInterval(() => {
      setTicks((n) => n + 1);
      load();
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const user = me?.user;

  return (
    <div className="center-page">
      <div className="card">
        <span className="badge pro">PAYMENT STATUS</span>
        <h1 className="brand" style={{ fontSize: "1.85rem", marginTop: 16 }}>
          Payment received
        </h1>
        <p className="subtitle">
          Reminder: the redirect is not proof of payment - access unlocks only after the verified{" "}
          <code>payment.succeeded</code> webhook is processed.
        </p>
        {user ? (
          <div className="notice-box">
            <div>
              Account: <strong>{user.email}</strong>
            </div>
            <div>
              Activated: <strong>{user.activated ? "yes" : "waiting for webhook..."}</strong>
            </div>
            <div>
              Plan:{" "}
              <strong>
                {user.plan === "promax" ? "Pro Max" : user.plan === "pro" ? "Pro" : "Free"}
              </strong>
              {user.planExpiresAt
                ? ` (until ${new Date(user.planExpiresAt * 1000).toLocaleString()})`
                : ""}
            </div>
          </div>
        ) : (
          <p className="muted">Checking account status{".".repeat((ticks % 3) + 1)}</p>
        )}
        <a className="btn" href="/chat">
          Go to chat
        </a>
        <a className="btn secondary" href="/pricing">
          View plans
        </a>
      </div>
    </div>
  );
}
