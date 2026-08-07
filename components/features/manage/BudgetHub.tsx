"use client";

/**
 * Budget Hub — consolidates Overview, Board (targets + spend log), and Caps
 * behind one tab strip. Deep links stay live:
 *   /manage/budget        → Overview
 *   /manage/budget-board  → Board
 *   /manage/budget-caps   → Caps
 */

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { pathToViewId } from "@/lib/viewRoutes";
import { goToView } from "@/lib/nav";
import Budget from "@/components/features/manage/Budget";
import BudgetBoard from "@/components/features/manage/BudgetBoard";
import BudgetCaps from "@/components/features/manage/BudgetCaps";

type TabId = "overview" | "board" | "caps";

const TABS: Array<{ id: TabId; view: string; label: string; blurb: string }> = [
  {
    id: "overview",
    view: "budget",
    label: "Overview",
    blurb: "Campaign spend, blended ROAS, and 3-month allocation",
  },
  {
    id: "board",
    view: "budget-board",
    label: "Board",
    blurb: "Monthly target, pacing, waste alerts, and spend log",
  },
  {
    id: "caps",
    view: "budget-caps",
    label: "Caps",
    blurb: "Platform daily/lifetime limits and campaign budgets",
  },
];

function viewToTab(view: string | null): TabId {
  if (view === "budget-board") return "board";
  if (view === "budget-caps") return "caps";
  return "overview";
}

export default function BudgetHub() {
  const router = useRouter();
  const pathname = usePathname();
  const view = pathToViewId(pathname || "") || "budget";
  const tab = viewToTab(view);
  const active = useMemo(() => TABS.find((t) => t.id === tab) || TABS[0], [tab]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#F0FDF4 0%,#F8FAFC 42%)" }}>
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "22px 24px 8px",
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#0F766E",
              marginBottom: 6,
            }}
          >
            Manage · Budget Hub
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: "#0F172A",
            }}
          >
            Budget Hub
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748B", maxWidth: 720, lineHeight: 1.5 }}>
            One place for spend overview, monthly pacing, and platform caps — switch tabs without leaving the workflow.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Budget Hub sections"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            borderBottom: "2px solid #E2E8F0",
            marginBottom: 4,
          }}
        >
          {TABS.map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => goToView(router, t.view)}
                style={{
                  padding: "10px 16px",
                  marginBottom: -2,
                  border: "none",
                  borderBottom: on ? "3px solid #0F766E" : "3px solid transparent",
                  background: "transparent",
                  color: on ? "#0F766E" : "#64748B",
                  fontWeight: on ? 800 : 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <p style={{ margin: "8px 0 12px", fontSize: 12, color: "#64748B" }}>{active.blurb}</p>
      </div>

      <div data-budget-hub-tab={tab}>
        {tab === "overview" ? <Budget embedded /> : null}
        {tab === "board" ? <BudgetBoard embedded /> : null}
        {tab === "caps" ? <BudgetCaps embedded /> : null}
      </div>
    </div>
  );
}
