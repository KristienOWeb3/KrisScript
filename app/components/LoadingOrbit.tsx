"use client";

export default function LoadingOrbit({ size = 40 }: { size?: number }) {
  return (
    <div className="loading-orbit" style={{ width: size, height: size }} aria-hidden>
      <div className="orbit-dot" />
      <div className="orbit-dot" />
      <div className="orbit-dot" />
    </div>
  );
}
