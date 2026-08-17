"use client";

import Icon from "./Icon";

import { useState } from "react";

export type ApprovalRequest = {
  id: string;
  title: string;
  description: string;
  actionName: string;
  target?: string;
};

export default function ApprovalCard({
  request,
  onApprove,
  onReject,
}: {
  request: ApprovalRequest;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");

  function handleApprove() {
    setStatus("approved");
    onApprove?.();
  }

  function handleReject() {
    setStatus("rejected");
    onReject?.();
  }

  return (
    <div className={`approval-card ${status}`}>
      <div className="approval-card-header">
        <div className="approval-badge">
          <span className="approval-dot" />
          <span>Human-in-the-loop</span>
        </div>
        <span className="approval-time">Action required</span>
      </div>

      <div className="approval-card-content">
        <h4>{request.title}</h4>
        <p>{request.description}</p>
        {request.target && <code className="approval-target">{request.target}</code>}
      </div>

      {status === "pending" ? (
        <div className="approval-card-actions">
          <button className="btn ghost small" onClick={handleReject}>
            Decline
          </button>
          <button className="btn small approval-confirm-btn" onClick={handleApprove}>
            Approve {request.actionName}
          </button>
        </div>
      ) : (
        <div className={`approval-result-badge ${status}`}>
          <Icon name={status === "approved" ? "check" : "x"} size={14} />
          <span>
            {status === "approved" ? "Action approved & executed" : "Action declined"}
          </span>
        </div>
      )}
    </div>
  );
}
