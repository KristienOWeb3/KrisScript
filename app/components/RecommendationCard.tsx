"use client";

import Icon from "./Icon";

export type Recommendation = {
  title: string;
  description: string;
  confidence: number; // e.g. 94%
  codeSnippet?: string;
  actionText?: string;
};

export default function RecommendationCard({
  item,
  onAction,
}: {
  item: Recommendation;
  onAction?: () => void;
}) {
  return (
    <div className="recommendation-card">
      <div className="recommendation-header">
        <div className="recommendation-tag">
          <span className="sparkle">
            <Icon name="lightbulb" size={14} />
          </span>
          <span>Agent Insight</span>
        </div>
        <div className="confidence-meter" title={`${item.confidence}% confidence`}>
          <div className="confidence-bar" style={{ width: `${item.confidence}%` }} />
          <span>{item.confidence}% match</span>
        </div>
      </div>

      <div className="recommendation-body">
        <h5>{item.title}</h5>
        <p>{item.description}</p>
        {item.codeSnippet && <pre className="recommendation-code"><code>{item.codeSnippet}</code></pre>}
      </div>

      {item.actionText && (
        <div className="recommendation-footer">
          <button className="btn small recommendation-btn" onClick={onAction}>
            <span>{item.actionText}</span>
            <Icon name="arrow-right" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
