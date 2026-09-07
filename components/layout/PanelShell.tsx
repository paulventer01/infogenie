"use client";

import type { ReactNode } from "react";
import PanelHero from "@/components/layout/PanelHero";

export interface PanelShellProps {
  group: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Max content width — default 1100 */
  maxWidth?: number;
}

/**
 * Standard InfoGenie feature-page chrome: light hero + padded content column.
 * Use this for new/migrated panels so spacing, type, and hero treatment stay consistent.
 */
export default function PanelShell({
  group,
  title,
  subtitle,
  actions,
  children,
  maxWidth = 1100,
}: PanelShellProps) {
  return (
    <div className="view-header-wrap ig-panel-shell">
      <div className="container" style={{ paddingTop: 16, paddingBottom: 8 }}>
        <PanelHero group={group} title={title} subtitle={subtitle} actions={actions} />
      </div>
      <div
        className="container ig-panel-body"
        style={{
          maxWidth,
          margin: "0 auto",
          padding: "8px 24px 56px",
          color: "#0f172a",
        }}
      >
        {children}
      </div>
    </div>
  );
}
