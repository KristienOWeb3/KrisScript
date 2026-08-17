"use client";

import Icon from "./Icon";

import { useState } from "react";

export default function CodeBlock({
  code,
  language = "typescript",
  title,
}: {
  code: string;
  language?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  function copyCode() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const lines = code.trim().split("\n");

  return (
    <div className="beautiful-code-block">
      <div className="code-block-header">
        <div className="code-block-title">
          <span className="code-dot red" />
          <span className="code-dot yellow" />
          <span className="code-dot green" />
          <span className="code-lang-tag">{title || language}</span>
        </div>
        <button className="code-copy-btn" onClick={copyCode} type="button">
          <Icon name={copied ? "check" : "copy"} size={13} />
          <span>{copied ? "Copied" : "Copy code"}</span>
        </button>
      </div>
      <div className="code-block-body">
        <pre className="code-content">
          <code>
            {lines.map((line, idx) => (
              <div key={idx} className="code-line">
                <span className="line-num">{idx + 1}</span>
                <span className="line-text">{line}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
