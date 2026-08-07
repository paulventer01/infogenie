"use client";

/**
 * Goals Hub — consolidates Marketing Goals, Targets, and Canonical Metrics.
 * Deep links:
 *   /grow/agent-goals           → Marketing Goals
 *   /grow/goals                 → Targets
 *   /manage/canonical-metrics   → Metrics SSOT
 */

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { pathToViewId } from "@/lib/viewRoutes";
import { goToView } from "@/lib/nav";
import AgentGoals from "@/components/features/manage/AgentGoals";
import Goals from "@/components/features/grow/Goals";
import CanonicalMetrics from "@/components/features/manage/CanonicalMetrics";

type TabId = "marketing" | "targets" | "metrics";

const TABS: Array<{ id: TabId; view: string; label: string; blurb: string }> = [
  {
    id: "marketing",
    view: "agent-goals",
    label: "Marketing Goals",
    blurb: "Set outcomes, build execution plans, and track progress",
  },
  {
    id: "targets",
    view: "goals",
    label: "Targets",
    blurb: "Metric targets with off-track root-cause checks",
  },
  {
    id: "metrics",
    view: "canonical-metrics",
    label: "Metrics SSOT",
    blurb: "Spend, ROAS, CAC, waste, and goals vs actuals — one engine",
  },
];

const RELATED: Array<{ view: string; label: string }> = [
  { view: "marketing-okr", label: "Marketing OKRs" },
  { view: "kpi-tracker", label: "KPI Tracker" },
  { view: "action-center", label: "Action Center" },
  { view: "budget", label: "Budget Hub" },
];

function viewToTab(view: string | null): TabId {
  if (view === "goals") return "targets";
  if (view === "canonical-metrics") return "metrics";
  return "marketing";
}

export default function GoalsHub() {
  const router = useRouter();
  const pathname = usePathname();
  const view = pathToViewId(pathname || "") || "agent-goals";
  const tab = viewToTab(view);
  const active = useMemo(() => TABS.find((t) => t.id === tab) || TABS[0], [tab]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#EEF2FF 0%,#F8FAFC 42%)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 24px 8px" }}>
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#4F46E5",
              marginBottom: 6,
            }}
          >
            Grow · Goals Hub
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
            Goals Hub
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748B", maxWidth: 720, lineHeight: 1.5 }}>
            One workflow for outcomes, numeric targets, and the metrics every report should trust.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Goals Hub sections"
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
                  borderBottom: on ? "3px solid #4F46E5" : "3px solid transparent",
                  background: "transparent",
                  color: on ? "#4F46E5" : "#64748B",
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
        <p style={{ margin: "8px 0 10px", fontSize: 12, color: "#64748B" }}>{active.blurb}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", alignSelf: "center" }}>
            Related:
          </span>
          {RELATED.map((r) => (
            <button
              key={r.view}
              type="button"
              onClick={() => goToView(router, r.view)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #E2E8F0",
                background: "#fff",
                color: "#334155",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div data-goals-hub-tab={tab}>
        {tab === "marketing" ? <AgentGoals embedded /> : null}
        {tab === "targets" ? <Goals embedded /> : null}
        {tab === "metrics" ? <CanonicalMetrics embedded /> : null}
      </div>
    </div>
  );
}
