"use client";

import React, { useState, useRef, useEffect } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  planLabel?: string;
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
  placeholder = "Ask Kris's Script or type / for commands, @ for context...",
  planLabel,
  onTogglePlan,
}: Props) {
  const [showCommands, setShowCommands] = useState(false);
  const [showContexts, setShowContexts] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus text input on mount or when disabled state ends
  useEffect(() => {
    if (!disabled) {
      textInputRef.current?.focus();
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) {
        setShowCommands(false);
        setShowContexts(false);
        onSubmit();
      }
    }
  }

  function handleFileClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const fileName = e.target.files[0].name;
      onChange(value ? `${value} @file:${fileName}` : `@file:${fileName} `);
      textInputRef.current?.focus();
    }
  }

  function toggleDictation() {
    setIsRecording(!isRecording);
    if (!isRecording) {
      setTimeout(() => {
        onChange(value ? `${value} [voice input]` : "Explain the agent workflow.");
        setIsRecording(false);
        textInputRef.current?.focus();
      }, 2000);
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
                textInputRef.current?.focus();
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
                textInputRef.current?.focus();
              }}
            >
              <strong className="cmd-name">{ctx.name}</strong>
              <span className="cmd-desc">{ctx.desc}</span>
            </button>
          ))}
        </div>
      )}

      <form
        className="pill-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && value.trim()) {
            setShowCommands(false);
            setShowContexts(false);
            onSubmit();
          }
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />

        <button
          className="composer-action-btn"
          type="button"
          onClick={handleFileClick}
          title="Attach file or context"
        >
          📎
        </button>

        <input
          ref={textInputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={4000}
          className="pill-input"
          autoFocus
        />

        {/* DICTATION MIC */}
        <button
          type="button"
          className={`mic-btn ${isRecording ? "recording" : ""}`}
          onClick={toggleDictation}
          title={isRecording ? "Listening..." : "Voice Dictation"}
        >
          {isRecording ? "🔴" : "🎙️"}
        </button>

        {/* EMBEDDED PLAN BADGE */}
        {planLabel && (
          <div className="embedded-plan-wrap">
            <button
              className="embedded-plan-pill"
              type="button"
              onClick={() => onTogglePlan && onTogglePlan()}
            >
              <span className="dot">•</span>
              <span>{planLabel}</span>
            </button>
          </div>
        )}

        <button
          className={`composer-send-btn ${value.trim() ? "active" : ""}`}
          disabled={disabled || !value.trim()}
          title="Send message (Enter)"
          type="submit"
        >
          <span className="send-arrow">↑</span>
        </button>
      </form>
    </div>
  );
}
