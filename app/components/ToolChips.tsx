"use client";

import Icon from "./Icon";

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
            <Icon
              name={
                t.toolName.includes("search")
                  ? "search"
                  : t.toolName.includes("code")
                    ? "terminal"
                    : "zap"
              }
              size={14}
            />
          </span>
          <span className="tool-chip-name">{t.toolName}</span>
          {t.args && <code className="tool-chip-args">{t.args}</code>}
          <span className="tool-chip-status">
            {t.status === "running" ? (
              <span className="tool-chip-spinner" />
            ) : t.status === "success" ? (
              <Icon name="check" size={13} />
            ) : (
              <Icon name="x" size={13} />
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
