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
          router.replace("/chat");
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
                <div className="brand-meta">Pay-As-You-Go AI Chat</div>
              </div>
            </div>
            <h1 className="hero-title" style={{ marginTop: 54 }}>
              Chat immediately. Pay as you go.
            </h1>
            <p className="subtitle" style={{ maxWidth: 560 }}>
              A focused AI chat workspace powered by DeepSeek & SubScript. Start with 3 free messages,
              then pay per message ($0.10/msg) with SubScript Pay-As-You-Go metered billing.
            </p>
          </div>
          <div className="auth-preview">
            <div className="terminal-line">signup - instant chat unlocked</div>
            <div className="terminal-line">free - 3 trial messages included</div>
            <div className="terminal-line">report-usage - $0.10 SubScript PAYG</div>
          </div>
        </section>
        <section className="card">
          <h1 className="brand" style={{ fontSize: "2rem", marginTop: 18 }}>
            Kris&apos;s <span>Script</span>
          </h1>
          <p className="subtitle">
            Sign up now for 3 free messages, then use SubScript Pay-As-You-Go to pay per message.
          </p>
          <a className="btn" href="/signup">
            Start chatting - 3 free messages
          </a>
          <a className="btn secondary" href="/login">
            Sign in
          </a>
          <p className="muted mt">
            Powered by DeepSeek AI & SubScript Pay-As-You-Go.
          </p>
        </section>
      </div>
    </div>
  );
}
