"use client";

import { useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * STREAMING TEXT — typewriter reveal with a trailing caret
 *
 * Reveals `speed` characters every `interval` ms (2 per 9ms
 * by default, matching the AICSS reference pacing). The
 * caret sits solid while text is still arriving and is
 * dropped once the reveal completes — a chat log full of
 * blinking carets reads as broken, not alive.
 *
 * Changing `text` restarts the reveal from the beginning.
 * Reduced motion skips the animation entirely.
 * ───────────────────────────────────────────────────────── */

export default function StreamingText({
  text,
  speed = 2,
  interval = 9,
  onDone,
}: {
  text: string;
  speed?: number;
  interval?: number;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState("");

  // Kept in a ref so a changing onDone identity doesn't restart the reveal.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      setShown(text);
      onDoneRef.current?.();
      return;
    }

    setShown("");
    let i = 0;
    const t = setInterval(() => {
      i += speed;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(t);
        onDoneRef.current?.();
      }
    }, interval);
    return () => clearInterval(t);
  }, [text, speed, interval]);

  const streaming = shown.length < text.length;

  return (
    <p className="streaming-prose">
      {shown}
      {streaming && <span className="streaming-caret" aria-hidden />}
    </p>
  );
}
