"use client";

import { useEffect, useState } from "react";

/** Live clock + session uptime — client-only to avoid SSR hydration mismatches. */
export default function LiveAppTimer({ className }: { className?: string }) {
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [uptimeSec, setUptimeSec] = useState(0);

  useEffect(() => {
    const start = Date.now();
    setStarted(start);
    setNow(new Date(start));
    setReady(true);
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(new Date(t));
      setUptimeSec(Math.floor((t - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const shell = (
    <div
      className={className}
      title="Live session timer — updates every second while the app is running"
      aria-live="polite"
      suppressHydrationWarning
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
        minWidth: 168,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: ready ? "#10b981" : "#94a3b8",
          boxShadow: ready ? "0 0 0 0 rgba(16,185,129,.55)" : "none",
          animation: ready ? "igLivePulse 1.6s ease-out infinite" : "none",
          flexShrink: 0,
        }}
      />
      {!ready || !now || started == null ? (
        <span suppressHydrationWarning>Live --:--:-- · Up --</span>
      ) : (
        <>
          <span suppressHydrationWarning>
            Live{" "}
            {String(now.getHours()).padStart(2, "0")}:
            {String(now.getMinutes()).padStart(2, "0")}:
            {String(now.getSeconds()).padStart(2, "0")}
          </span>
          <span style={{ opacity: 0.45 }}>·</span>
          <span style={{ color: "#0369a1" }} suppressHydrationWarning>
            Up{" "}
            {Math.floor(uptimeSec / 3600) > 0
              ? `${Math.floor(uptimeSec / 3600)}h ${String(Math.floor((uptimeSec % 3600) / 60)).padStart(2, "0")}m ${String(uptimeSec % 60).padStart(2, "0")}s`
              : `${Math.floor(uptimeSec / 60)}m ${String(uptimeSec % 60).padStart(2, "0")}s`}
          </span>
        </>
      )}
      <style>{`@keyframes igLivePulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.55)}70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}`}</style>
    </div>
  );

  return shell;
}
