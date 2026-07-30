"use client";

import type { ReactNode } from "react";

export interface PanelHeroProps {
  group: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

const HERO_BG =
  "radial-gradient(ellipse 75% 65% at 10% 15%, rgba(15,118,110,0.16), transparent 55%), radial-gradient(ellipse 55% 50% at 92% 85%, rgba(2,132,199,0.14), transparent 50%), linear-gradient(135deg, #e8f6f3 0%, #eaf2fb 48%, #eef4ff 100%)";

/** Shared light hero used across InfoGenie feature panels. */
export default function PanelHero({
  group,
  title,
  subtitle,
  actions,
  children,
}: PanelHeroProps) {
  return (
    <div
      className="view-header ig-panel-hero"
      data-ig-light-hero="1"
      style={{
        background: HERO_BG,
        border: "1px solid rgba(15, 118, 110, 0.16)",
        borderRadius: 16,
        boxShadow: "0 10px 28px rgba(15, 23, 42, 0.06)",
        margin: "0 0 18px",
        padding: "22px 24px",
        color: "#0f172a",
      }}
    >
      <div className="vh-inner" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div
            className="breadcrumb"
            style={{ color: "#64748b", fontSize: "0.72rem", fontWeight: 700, marginBottom: 6 }}
          >
            <span className="bc-group" style={{ color: "#0f766e" }}>
              {group}
            </span>{" "}
            <span className="bc-sep" style={{ color: "#94a3b8" }}>
              ›
            </span>{" "}
            {title.replace(/^[^\w]*\s*/, "")}
          </div>
          <h2
            className="view-title"
            style={{
              margin: 0,
              fontSize: "1.35rem",
              fontWeight: 800,
              lineHeight: 1.25,
              color: "#0f172a",
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h2>
          {subtitle ? (
            <p
              className="view-sub"
              style={{
                margin: "8px 0 0",
                fontSize: "0.9rem",
                lineHeight: 1.55,
                color: "#475569",
                maxWidth: 720,
              }}
            >
              {subtitle}
            </p>
          ) : null}
          {children}
        </div>
        {actions ? (
          <div className="vh-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
