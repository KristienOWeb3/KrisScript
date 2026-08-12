"use client";

export type ToolCall = {
  id: string;
  toolName: string;
  args?: string;
  status: "success" | "running" | "error";
};

export default function ToolChips({ tools }: { tools: ToolCall[] }) {
  if (!tools || tools.length === 0) return null;

  return (
    <div className="tool-chips-container">
      {tools.map((t) => (
        <div key={t.id} className={`tool-chip ${t.status}`}>
          <span className="tool-chip-icon">
            {t.toolName.includes("search") ? "🔍" : t.toolName.includes("code") ? "💻" : "⚡"}
          </span>
          <span className="tool-chip-name">{t.toolName}</span>
          {t.args && <code className="tool-chip-args">{t.args}</code>}
          <span className="tool-chip-status">
            {t.status === "running" ? "..." : t.status === "success" ? "✓" : "!"}
          </span>
        </div>
      ))}
    </div>
  );
}
