"use client";

import React from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  planLabel?: string;
  onTogglePlan?: () => void;
};

export default function PillPromptBar({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Ask Kris",
  planLabel,
  onTogglePlan,
}: Props) {
  return (
    <form
      className="pill-prompt"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      <button className="composer-action-btn" type="button" title="Attach / Options">
        +
      </button>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={4000}
        className="pill-input"
      />

      <div className="embedded-plan-wrap">
        <button
          className="embedded-plan-pill"
          type="button"
          onClick={() => onTogglePlan && onTogglePlan()}
        >
          <span className="dot">•</span>
          <span>{planLabel}</span>
          <span className="caret">⌄</span>
        </button>
      </div>

      <button className="composer-send-btn" disabled={disabled || !value.trim()} title="Send">
        ↑
      </button>
    </form>
  );
}
