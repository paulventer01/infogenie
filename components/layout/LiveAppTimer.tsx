"use client";

import { useEffect, useState } from "react";

/** Live clock + session uptime so it's obvious the app is running. */
export default function LiveAppTimer({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  const [started] = useState(() => Date.now());
  const [uptimeSec, setUptimeSec] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = new Date();
      setNow(t);
      setUptimeSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [started]);

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const upH = Math.floor(uptimeSec / 3600);
  const upM = Math.floor((uptimeSec % 3600) / 60);
  const upS = uptimeSec % 60;
  const uptime =
    upH > 0
      ? `${upH}h ${String(upM).padStart(2, "0")}m ${String(upS).padStart(2, "0")}s`
      : `${upM}m ${String(upS).padStart(2, "0")}s`;

  return (
    <div
      className={className}
      title="Live session timer — updates every second while the app is running"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        borderRadius: 999,
        background: "rgba(15, 118, 110, 0.1)",
        border: "1px solid rgba(15, 118, 110, 0.22)",
        color: "#0f766e",
        fontSize: "0.72rem",
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        lineHeight: 1.2,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "#10b981",
          boxShadow: "0 0 0 0 rgba(16,185,129,.55)",
          animation: "igLivePulse 1.6s ease-out infinite",
          flexShrink: 0,
        }}
      />
      <span>
        Live {hh}:{mm}:{ss}
      </span>
      <span style={{ opacity: 0.45 }}>·</span>
      <span style={{ color: "#0369a1" }}>Up {uptime}</span>
      <style>{`@keyframes igLivePulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.55)}70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}`}</style>
    </div>
  );
}
