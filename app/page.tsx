"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          router.replace(data.user.activated ? "/chat" : "/activate");
        } else {
          setChecked(true);
        }
      })
      .catch(() => setChecked(true));
  }, [router]);

  if (!checked) return <div className="center-page muted">Loading...</div>;

  return (
    <div className="center-page">
      <div className="auth-grid">
        <section className="auth-copy">
          <div>
            <div className="rail-brand">
              <div className="mark">KS</div>
              <div className="brand-copy">
                <div className="brand-title">Kris&apos;s Script</div>
                <div className="brand-meta">SubScript payment lab</div>
              </div>
            </div>
            <h1 className="hero-title" style={{ marginTop: 54 }}>
              Chat, then prove every payment claim.
            </h1>
            <p className="subtitle" style={{ maxWidth: 560 }}>
              A focused AI chat workspace built to test SubScript on Arc across one-time
              activation, recurring weekly subscriptions, and metered pay-as-you-chat billing.
            </p>
          </div>
          <div className="auth-preview">
            <div className="terminal-line">payment.succeeded - activation unlocked</div>
            <div className="terminal-line">subscription.renewed - Pro extended 7 days</div>
            <div className="terminal-line">report-usage - $0.10 metered message</div>
          </div>
        </section>
        <section className="card">
          <h1 className="brand" style={{ fontSize: "2rem", marginTop: 18 }}>
            Kris&apos;s <span>Script</span>
          </h1>
          <p className="subtitle">
            Start with a one-time $1 USDC activation, then choose free capped chat,
            weekly Pro, Pro Max, or pay-as-you-chat metering.
          </p>
          <a className="btn" href="/signup">
            Create account - $1 activation
          </a>
          <a className="btn secondary" href="/login">
            Sign in
          </a>
          <p className="muted mt">
            Powered by DeepSeek replies and SubScript payment events.
          </p>
        </section>
      </div>
    </div>
  );
}
