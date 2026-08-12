"use client";

import { useState } from "react";

export type Step = {
  id: string;
  label: string;
  detail?: string;
  status: "completed" | "running" | "failed";
};

export default function ThinkingTrace({
  steps,
  duration,
  defaultExpanded = false,
}: {
  steps?: Step[];
  duration?: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const defaultSteps: Step[] = [
    { id: "1", label: "Searching workspace context", detail: "Scanned 14 files & recents", status: "completed" },
    { id: "2", label: "Analyzing query & prompt intent", detail: "Synthesizing deep reasoning model output", status: "completed" },
    { id: "3", label: "Formatting response with UI primitives", detail: "Applied Beautiful UI layout", status: "completed" },
  ];

  const traceSteps = steps && steps.length > 0 ? steps : defaultSteps;

  return (
    <div className="thinking-trace-container">
      <button
        className="thinking-trace-toggle"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <div className="thinking-header-left">
          <span className="sparkle-icon">✨</span>
          <span className="thinking-title">Thought process</span>
          <span className="thinking-badge">{traceSteps.length} steps</span>
        </div>
        <div className="thinking-header-right">
          {duration && <span className="thinking-duration">{duration}</span>}
          <span className={`chevron-icon ${expanded ? "open" : ""}`}>▼</span>
        </div>
      </button>

      {expanded && (
        <div className="thinking-steps-body">
          {traceSteps.map((s, idx) => (
            <div key={s.id || idx} className={`thinking-step-row ${s.status}`}>
              <div className="step-indicator">
                {s.status === "completed" && <span className="step-check">✓</span>}
                {s.status === "running" && <span className="step-spinner" />}
                {s.status === "failed" && <span className="step-cross">✕</span>}
              </div>
              <div className="step-content">
                <span className="step-label">{s.label}</span>
                {s.detail && <span className="step-detail">{s.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
