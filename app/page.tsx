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

  if (!checked) return <div className="center-page muted">Loading…</div>;

  return (
    <div className="center-page">
      <div className="card wide" style={{ textAlign: "center" }}>
        <h1 className="brand" style={{ fontSize: "2.2rem" }}>
          Kris&apos;s <span>Script</span>
        </h1>
        <p className="subtitle" style={{ marginTop: 8 }}>
          An AI chat platform built to field-test the{" "}
          <a href="https://subscriptonarc.com" target="_blank" rel="noreferrer">
            SubScript
          </a>{" "}
          USDC payment system on Arc — one-time payments, weekly plans, and
          pay-per-message metered billing.
        </p>
        <a className="btn" href="/signup" style={{ maxWidth: 280, margin: "8px auto 0" }}>
          Create account — $1 activation
        </a>
        <p className="muted mt">
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </div>
    </div>
  );
}
