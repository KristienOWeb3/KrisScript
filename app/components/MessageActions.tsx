"use client";

import { useState } from "react";
import Icon from "./Icon";

/* ─────────────────────────────────────────────────────────
 * MESSAGE ACTIONS — the row that sits under an assistant turn
 *
 * Only actions with a real destination live here. Copy writes
 * to the clipboard and confirms with a check for 2s.
 *
 * Deliberately absent: thumbs up/down (needs a feedback table
 * to write to) and regenerate (POST /api/chat always inserts a
 * new user row, so re-running it would duplicate the turn and
 * bill again rather than replace the reply).
 * ───────────────────────────────────────────────────────── */

export default function MessageActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (insecure origin / denied permission) — stay silent */
    }
  }

  return (
    <div className="msg-actions">
      <button
        type="button"
        className="msg-action-btn"
        onClick={copy}
        title={copied ? "Copied" : "Copy response"}
        aria-label={copied ? "Copied" : "Copy response"}
      >
        <Icon name={copied ? "check" : "copy"} size={15} />
      </button>
    </div>
  );
}
