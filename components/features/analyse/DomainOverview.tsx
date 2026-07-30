"use client";

import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import type { CompanyOverview } from "@/lib/companyOverview";
import ov from "@/styles/domain-overview.module.css";

const MODULE_ICONS: Record<string, string> = {
  seo: "🔎",
  traffic: "📈",
  ai: "🤖",
  content: "📝",
  ads: "📣",
  social: "📱",
  links: "🔗",
};

function trendLabel(t: { pct: number; up: boolean }) {
  if (t.pct === 0) return null;
  const arrow = t.up ? "▲" : "▼";
  return (
    <span style={{ color: t.up ? "#059669" : "#dc2626" }}>
      {arrow} {Math.abs(t.pct)}%
    </span>
  );
}

interface Props {
  overview: CompanyOverview;
  currentView?: string;
}

/** Semrush-style KPI strip, journey rail, and module tiles for the company dashboard. */
export default function DomainOverview({ overview, currentView = "dashboard" }: Props) {
  const router = useRouter();

  return (
    <>
      <nav className={ov.journey} aria-label="Analysis journey">
        {overview.journey.map((step) => {
          const isCurrent = step.view === currentView;
          const cls = [ov.journeyStep, step.done && !isCurrent ? ov.journeyDone : "", isCurrent ? ov.journeyCurrent : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={step.view}
              type="button"
              className={cls}
              onClick={() => goToView(router, step.view)}
              title={step.desc}
            >
              <span className={ov.journeyNum}>{step.done && !isCurrent ? "✓" : step.step}</span>
              {step.label}
            </button>
          );
        })}
      </nav>

      <h4 className={ov.sectionTitle} id="ig-domain-snapshot">Domain snapshot</h4>
      <div className={ov.strip}>
        {overview.snapshot.map((kpi) => (
          <button
            key={kpi.key}
            type="button"
            className={ov.stripCard}
            onClick={() => goToView(router, kpi.view)}
            title={kpi.cta || `Open ${kpi.label}`}
          >
            <span className={ov.stripLabel}>{kpi.label}</span>
            <span className={ov.stripValue}>{kpi.value}</span>
            <span className={ov.stripHint}>
              {kpi.live ? "Live data · " : ""}
              {trendLabel(kpi.trend)}
              {kpi.cta ? ` · ${kpi.cta}` : null}
            </span>
          </button>
        ))}
      </div>

      <h4 className={ov.sectionTitle}>Explore by area</h4>
      <div className={ov.moduleGrid}>
        {overview.modules.map((mod) => (
          <button
            key={mod.key}
            type="button"
            className={ov.moduleCard}
            onClick={() => goToView(router, mod.view)}
            style={{ borderLeftColor: mod.color, borderLeftWidth: 3 }}
          >
            <div className={ov.moduleIcon}>{MODULE_ICONS[mod.key] || "📊"}</div>
            <div className={ov.moduleTitle}>{mod.label}</div>
            <div className={ov.moduleDesc}>{mod.desc}</div>
            {mod.metrics[0] && (
              <div className={ov.moduleStat}>
                {mod.metrics[0].label}: {mod.metrics[0].value}
              </div>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
