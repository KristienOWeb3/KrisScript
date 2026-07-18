export default function BillingCancelPage() {
  return (
    <div className="center-page">
      <div className="card">
        <span className="badge free">CHECKOUT</span>
        <h1 className="brand" style={{ fontSize: "1.85rem", marginTop: 16 }}>
          Payment cancelled
        </h1>
        <p className="subtitle">No USDC was charged. You can retry whenever you&apos;re ready.</p>
        <a className="btn" href="/pricing">
          Back to plans
        </a>
        <a className="btn secondary" href="/chat">
          Back to chat
        </a>
      </div>
    </div>
  );
}
