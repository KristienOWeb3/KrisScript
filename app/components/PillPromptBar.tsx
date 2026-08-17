"use client";

import React, { useState, useRef, useEffect } from "react";
import Icon from "./Icon";

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Receives the composed message (input text + any attachment names). */
  onSubmit: (composed: string) => void;
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

const SKILLS = [
  { id: "deep-research", name: "Deep research" },
  { id: "code-review", name: "Code review" },
  { id: "web-search", name: "Web search" },
  { id: "summarize", name: "Summarize" },
];

type Attachment = { id: number; name: string; kind: "image" | "file" };

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [exitingAtt, setExitingAtt] = useState<number[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

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

  // Dismiss the + menu on outside pointerdown or Escape
  useEffect(() => {
    if (!menuOpen) {
      setSkillsOpen(false);
      return;
    }
    function onPointerDown(e: PointerEvent) {
      if (!plusRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        textInputRef.current?.focus();
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  /** Input text plus any attachment names, so filenames reach the model. */
  function composed() {
    if (attachments.length === 0) return value.trim();
    const names = attachments.map((a) => `@${a.kind}:${a.name}`).join(" ");
    return `${names} ${value.trim()}`.trim();
  }

  const canSend = !disabled && (value.trim().length > 0 || attachments.length > 0);

  function submit() {
    if (!canSend) return;
    setShowCommands(false);
    setShowContexts(false);
    setMenuOpen(false);
    const text = composed();
    setAttachments([]);
    setExitingAtt([]);
    onSubmit(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function openPicker(kind: "image" | "file") {
    const el = fileInputRef.current;
    if (!el) return;
    el.accept = kind === "image" ? "image/*" : "";
    el.dataset.kind = kind;
    el.click();
    setMenuOpen(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const fallback = (e.target.dataset.kind as "image" | "file") ?? "file";
    setAttachments((prev) => [
      ...prev,
      ...files.map((f) => ({
        id: nextId.current++,
        name: f.name,
        kind: f.type.startsWith("image/") ? ("image" as const) : fallback,
      })),
    ]);
    e.target.value = "";
    textInputRef.current?.focus();
  }

  function removeAttachment(id: number) {
    setExitingAtt((prev) => [...prev, id]);
    setTimeout(() => {
      setAttachments((prev) => prev.filter((a) => a.id !== id));
      setExitingAtt((prev) => prev.filter((x) => x !== id));
    }, 200);
  }

  function addSkill(id: string) {
    const token = `/${id} `;
    onChange(value ? `${value.replace(/\s*$/, "")} ${token}` : token);
    setMenuOpen(false);
    textInputRef.current?.focus();
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
          submit();
        }}
      >
        <input
          type="file"
          multiple
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />

        {/* ATTACH + SKILLS MENU */}
        <div className="plus-wrap" ref={plusRef}>
          <button
            className="composer-action-btn plus-btn"
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            data-open={menuOpen || undefined}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            title="Attach files or add a skill"
          >
            <span className="plus-glyph">
              <Icon name="plus" size={18} />
            </span>
          </button>

          {menuOpen && (
            <div className="composer-menu" role="menu">
              <button
                type="button"
                className="composer-menu-item"
                role="menuitem"
                onClick={() => openPicker("image")}
              >
                <span className="menu-icon">
                  <Icon name="image" size={15} />
                </span>
                <span className="menu-name">Add photos</span>
              </button>
              <button
                type="button"
                className="composer-menu-item"
                role="menuitem"
                onClick={() => openPicker("file")}
              >
                <span className="menu-icon">
                  <Icon name="paperclip" size={15} />
                </span>
                <span className="menu-name">Attach files</span>
              </button>

              <div className="composer-menu-divider" />

              <div
                className="composer-menu-sub"
                onMouseEnter={() => setSkillsOpen(true)}
                onMouseLeave={() => setSkillsOpen(false)}
              >
                <button
                  type="button"
                  className="composer-menu-item"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={skillsOpen}
                  onClick={() => setSkillsOpen((o) => !o)}
                >
                  <span className="menu-icon">
                    <Icon name="zap" size={15} />
                  </span>
                  <span className="menu-name">Skills</span>
                  <span className="menu-chevron">
                    <Icon name="chevron-right" size={14} />
                  </span>
                </button>

                {skillsOpen && (
                  <div className="composer-menu-flyout" role="menu">
                    {SKILLS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="composer-menu-item"
                        role="menuitem"
                        onClick={() => addSkill(s.id)}
                      >
                        <span className="menu-name">/{s.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="composer-menu-divider" />
              <div className="composer-menu-label">Model</div>
              <div className="composer-menu-item static" aria-disabled>
                <span className="menu-icon">
                  <Icon name="model" size={13} />
                </span>
                <span className="menu-name">DeepSeek Chat</span>
                <span className="menu-check">
                  <Icon name="check" size={14} />
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="composer-field">
          {/* ATTACHMENT CHIPS */}
          {attachments.length > 0 && (
            <div className="composer-chips">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="composer-chip"
                  data-exit={exitingAtt.includes(a.id) || undefined}
                >
                  <span className="chip-icon">
                    <Icon name={a.kind === "image" ? "image" : "file"} size={13} />
                  </span>
                  <span className="chip-name">{a.name}</span>
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

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
        </div>

        {/* DICTATION MIC */}
        <button
          type="button"
          className={`mic-btn ${isRecording ? "recording" : ""}`}
          onClick={toggleDictation}
          title={isRecording ? "Listening..." : "Voice Dictation"}
        >
          <Icon name="mic" size={16} />
        </button>

        {/* EMBEDDED PLAN BADGE */}
        {planLabel && (
          <div className="embedded-plan-wrap">
            <button
              className="embedded-plan-pill"
              type="button"
              onClick={() => onTogglePlan && onTogglePlan()}
            >
              <span className="dot" />
              <span>{planLabel}</span>
            </button>
          </div>
        )}

        <button
          className={`composer-send-btn ${canSend ? "active" : ""}`}
          disabled={!canSend}
          title="Send message (Enter)"
          type="submit"
        >
          <span className="send-arrow">
            <Icon name="arrow-up" size={17} strokeWidth={2} />
          </span>
        </button>
      </form>
    </div>
  );
}
