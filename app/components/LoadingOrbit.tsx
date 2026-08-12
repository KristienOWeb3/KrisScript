"use client";

import React from "react";

export function LoadingOrbit({ text = "Kris's Script is thinking..." }: { text?: string }) {
  return (
    <div className="loading-orbit-container">
      <div className="loading-orbit-spinner">
        <div className="orbit-center-dot" />
        <div className="orbit-ring">
          <div className="orbit-dot dot-1" />
          <div className="orbit-dot dot-2" />
          <div className="orbit-dot dot-3" />
        </div>
      </div>
      <span className="loading-orbit-text">{text}</span>

      <style jsx>{`
        .loading-orbit-container {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 18px;
          background: var(--surface, #232427);
          border: 1px solid var(--line-strong, #3a3c40);
          border-radius: 12px;
          width: fit-content;
          margin: 12px 0;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        }

        .loading-orbit-spinner {
          position: relative;
          width: 24px;
          height: 24px;
          display: grid;
          place-items: center;
        }

        .orbit-center-dot {
          width: 6px;
          height: 6px;
          background: var(--accent, #3d9aff);
          border-radius: 50%;
          box-shadow: 0 0 8px var(--accent, #3d9aff);
        }

        .orbit-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1px dashed rgba(61, 154, 255, 0.3);
          animation: orbitRotate 2.5s linear infinite;
        }

        .orbit-dot {
          position: absolute;
          width: 5px;
          height: 5px;
          background: var(--accent, #3d9aff);
          border-radius: 50%;
          box-shadow: 0 0 6px var(--accent, #3d9aff);
        }

        .dot-1 {
          top: -2px;
          left: 50%;
          transform: translateX(-50%);
        }

        .dot-2 {
          bottom: 2px;
          right: -1px;
        }

        .dot-3 {
          bottom: 2px;
          left: -1px;
        }

        @keyframes orbitRotate {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        .loading-orbit-text {
          font-size: 0.88rem;
          font-weight: 500;
          color: var(--ink-2, #a5a8ad);
          letter-spacing: -0.01em;
          animation: textPulse 1.5s ease-in-out infinite alternate;
        }

        @keyframes textPulse {
          from {
            opacity: 0.7;
          }
          to {
            opacity: 1;
            color: var(--ink, #f2f3f4);
          }
        }
      `}</style>
    </div>
  );
}
