"use client";

import type { ReactNode, CSSProperties } from "react";

export interface IgTileProps {
  label?: string;
  value?: ReactNode;
  hint?: ReactNode;
  owner?: string;
  icon?: ReactNode;
  title?: string;
  description?: string;
  footer?: ReactNode;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Standard InfoGenie surface tile (KPI or nav card). */
export default function IgTile({
  label,
  value,
  hint,
  owner,
  icon,
  title,
  description,
  footer,
  onClick,
  className = "",
  style,
  children,
}: IgTileProps) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      className={`ig-tile ${className}`.trim()}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        textAlign: "left",
        padding: "14px 16px",
        cursor: onClick ? "pointer" : "default",
        borderLeft: "3px solid var(--ig-primary, #0f766e)",
        width: "100%",
        ...style,
      }}
    >
      {owner ? (
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ig-primary, #0f766e)" }}>{owner}</div>
      ) : null}
      {icon ? <div style={{ fontSize: 20, lineHeight: 1 }}>{icon}</div> : null}
      {label ? <div className="ig-label">{label}</div> : null}
      {title ? (
        <div className="ig-value" style={{ fontSize: "0.95rem" }}>
          {title}
        </div>
      ) : null}
      {value != null ? (
        <div className="ig-value" style={{ fontSize: "1.35rem" }}>
          {value}
        </div>
      ) : null}
      {description ? <div style={{ fontSize: "0.78rem", color: "#64748b", lineHeight: 1.45 }}>{description}</div> : null}
      {hint ? <div style={{ fontSize: 11, color: "#94a3b8" }}>{hint}</div> : null}
      {footer}
      {children}
    </Comp>
  );
}
