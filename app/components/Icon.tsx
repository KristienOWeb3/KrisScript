/* ─────────────────────────────────────────────────────────
 * ICON SET — inline stroke SVGs, no emoji, no icon font
 *
 * Every glyph inherits currentColor and sizes off a single
 * `size` prop, so icons pick up the colour of whatever
 * button or label they sit in. Stroke geometry is drawn on
 * a 24×24 grid at 1.75 weight to stay legible at 14–16px.
 * ───────────────────────────────────────────────────────── */

export type IconName =
  | "plus"
  | "paperclip"
  | "image"
  | "mic"
  | "zap"
  | "sparkle"
  | "chevron-right"
  | "chevron-down"
  | "check"
  | "x"
  | "arrow-up"
  | "arrow-right"
  | "arrow-left"
  | "arrow-up-right"
  | "pencil"
  | "search"
  | "settings"
  | "panel-left"
  | "menu"
  | "copy"
  | "file"
  | "message"
  | "card"
  | "gift"
  | "refresh"
  | "lightbulb"
  | "terminal"
  | "model";

const PATHS: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  paperclip: (
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0014 0M12 19v3" />
    </>
  ),
  zap: <path d="M13 2L4.09 12.97a1 1 0 00.78 1.63H11l-1 7.4 8.91-10.97a1 1 0 00-.78-1.63H13z" />,
  sparkle: (
    <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z" />
  ),
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  "arrow-up": <path d="M12 19V5M5 12l7-7 7 7" />,
  "arrow-right": <path d="M5 12h14M12 5l7 7-7 7" />,
  "arrow-left": <path d="M19 12H5M12 19l-7-7 7-7" />,
  "arrow-up-right": <path d="M7 17L17 7M7 7h10v10" />,
  pencil: (
    <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.35-4.35" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </>
  ),
  "panel-left": (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
  message: (
    <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
  ),
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  gift: (
    <>
      <path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7" />
      <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
    </>
  ),
  refresh: (
    <path d="M21 12a9 9 0 11-3.5-7.1M21 3v6h-6" />
  ),
  lightbulb: (
    <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V18h8v-3.3A7 7 0 0012 2z" />
  ),
  terminal: <path d="M4 17l6-6-6-6M12 19h8" />,
  model: <path d="M12 3l8 9-8 9-8-9 8-9z" />,
};

/** Icons whose geometry reads better filled than stroked. */
const FILLED: ReadonlySet<IconName> = new Set<IconName>(["zap", "sparkle", "model"]);

export default function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const filled = FILLED.has(name);
  return (
    <svg
      aria-hidden
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={filled ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
