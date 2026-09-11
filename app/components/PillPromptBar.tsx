"use client";

import React, { useState, useRef, useEffect } from "react";
import Icon from "./Icon";

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Receives the composed message. */
  onSubmit: (composed: string) => void;
  disabled?: boolean;
  placeholder?: string;
  planLabel?: string;
  /** Plan id / "payg" / "free", used to colour the pill's status dot. */
  tierId?: string;
  onTogglePlan?: () => void;
};

const COMMANDS = [
  { cmd: "/explain", desc: "Explain code or concept step-by-step" },
  { cmd: "/refactor", desc: "Improve structure and performance" },
  { cmd: "/test", desc: "Generate comprehensive unit tests" },
  { cmd: "/debug", desc: "Diagnose error and trace failure" },
];

const CONTEXTS = [
  { name: "@Codebase", desc: "Whole workspace repository" },
  { name: "@Database", desc: "PGlite / Postgres schema & records" },
  { name: "@Docs", desc: "Beautiful UI design documentation" },
];

export default function PillPromptBar({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Ask Kris's Script anything...",
  planLabel,
  tierId,
  onTogglePlan,
}: Props) {
  const [showCommands, setShowCommands] = useState(false);
  const [showContexts, setShowContexts] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content smoothly up to max height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextH = Math.min(Math.max(el.scrollHeight, 44), 220);
    el.style.height = `${nextH}px`;
  }, [value]);

  // Auto-focus textarea on mount or when disabled state ends
  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  useEffect(() => {
    if (value.startsWith("/")) {
      setShowCommands(true);
      setShowContexts(false);
    } else if (value.includes("@")) {
      setShowContexts(true);
      setShowCommands(false);
    } else {
      setShowCommands(false);
      setShowContexts(false);
    }
  }, [value]);

  const canSend = !disabled && value.trim().length > 0;

  function submit() {
    if (!canSend) return;
    setShowCommands(false);
    setShowContexts(false);
    const text = value.trim();
    onSubmit(text);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="pill-prompt-wrapper">
      {/* SLASH COMMANDS POPOVER */}
      {showCommands && (
        <div className="prompt-popover commands-popover">
          <div className="popover-title">Slash Commands</div>
          {COMMANDS.map((c) => (
            <button
              key={c.cmd}
              type="button"
              className="popover-item"
              onClick={() => {
                onChange(`${c.cmd} `);
                setShowCommands(false);
                textareaRef.current?.focus();
              }}
            >
              <strong className="cmd-name">{c.cmd}</strong>
              <span className="cmd-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* AT-CONTEXT POPOVER */}
      {showContexts && (
        <div className="prompt-popover contexts-popover">
          <div className="popover-title">Retrieved Context</div>
          {CONTEXTS.map((ctx) => (
            <button
              key={ctx.name}
              type="button"
              className="popover-item"
              onClick={() => {
                onChange(value.replace(/@\w*$/, `${ctx.name} `));
                setShowContexts(false);
                textareaRef.current?.focus();
              }}
            >
              <strong className="cmd-name">{ctx.name}</strong>
              <span className="cmd-desc">{ctx.desc}</span>
            </button>
          ))}
        </div>
      )}

      <form
        className="pill-prompt grok-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* TOP MULTILINE TEXT INPUT */}
        <div className="composer-input-area">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            maxLength={4000}
            rows={1}
            className="grok-textarea"
            autoFocus
          />
        </div>

        {/* BOTTOM TOOLBAR */}
        <div className="composer-toolbar">
          <div className="toolbar-left">
            {/* EMBEDDED PLAN BADGE (if plan provided) */}
            {planLabel && (
              <div className="embedded-plan-wrap">
                <button
                  className={`embedded-plan-pill${tierId ? ` tier-${tierId}` : ""}`}
                  type="button"
                  onClick={() => onTogglePlan && onTogglePlan()}
                  title="Click to view plan allowance"
                >
                  <span className="dot" />
                  <span>{planLabel}</span>
                </button>
              </div>
            )}
          </div>

          <div className="toolbar-right">
            {/* SEND BUTTON */}
            <button
              className={`composer-send-btn ${canSend ? "active" : ""}`}
              disabled={disabled || !canSend}
              title={canSend ? "Send message (Enter)" : "Type a message to send"}
              type="submit"
            >
              <span className="send-arrow">
                <Icon name="arrow-up" size={18} strokeWidth={2.4} />
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
