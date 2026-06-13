// Registry of legacy SPA panels that have been ported to native React pages.
//
// This is the single source of truth for the panel migration (Next.js Phase 3).
// It is consumed by:
//   • components/features/registry.tsx   — view id -> React component
//   • components/layout/MigratedPanel.tsx — renders the React panel for the
//     currently-routed view
//   • lib/legacyShell.ts                  — strips the ported `#view-<id>` div
//     and its `public/js` <script> out of the DEV replay shell, so the legacy
//     panel never double-renders and its module drops from the replayed bundle.
//
// PROD SAFETY (read before deleting anything): production still serves the
// vanilla-JS SPA directly via Express — there is no Next.js in prod yet (see
// `.agents/memory/nextjs-migration.md`). The legacy `#view-<id>` markup in
// `index.html` and the `public/js/<module>.js` file therefore MUST stay on
// disk: they are what prod renders. Suppression here is DEV-SHELL-ONLY. Physical
// deletion of the legacy view + module is the final step, deferred until Next
// owns the prod front door. Until then, porting a panel = (1) add a React
// component, (2) register it in `components/features/registry.tsx`, (3) add an
// entry below. The legacy files keep prod working with zero regression.

export interface MigratedView {
  /** Legacy `data-view` id — matches `#view-<id>` and the nav `data-view`. */
  view: string;
  /**
   * Basename of the `public/js` module that built this panel. Dropped from the
   * DEV replay bundle so it stops loading once React owns the view. Use `null`
   * for panels whose builder lives inline in `app.js` (nothing to drop).
   */
  legacyModule: string | null;
}

export const MIGRATED_VIEWS: MigratedView[] = [
  { view: "seo-roadmap", legacyModule: "ig_seo_roadmap.js" },
  // deliverability / web-vitals / tech-stack builders all live INLINE in app.js
  // (window.buildDeliverability, window.buildWebVitals, window.buildTechStack),
  // so there is no dedicated public/js module to drop — legacyModule is null and
  // suppression relies solely on stripping each `#view-<id>` div from the DEV
  // replay shell.
  { view: "deliverability", legacyModule: null },
  { view: "web-vitals", legacyModule: null },
  { view: "tech-stack", legacyModule: null },
  // The Manage-group panels below all live in SHARED public/js modules
  // (ig_seo.js, ig_manage_pack.js, ig_moat_features.js, ig_intelligence_tools.js)
  // — or inline in app.js — that still build many NOT-YET-migrated sibling
  // views. Dropping the whole module would break those siblings, so legacyModule
  // stays `null` here: suppression relies solely on stripping the `#view-<id>`
  // div (every builder early-returns when its target div/wrap is gone). Only a
  // panel whose module is dedicated to migrated views (like the pilot's
  // ig_seo_roadmap.js) may drop its module.
  { view: "growth-methodology", legacyModule: null },
  { view: "white-label", legacyModule: null },
  { view: "bulk-reports", legacyModule: null },
  { view: "model-compare", legacyModule: null },
  { view: "web-analytics", legacyModule: null },
  { view: "vertical-playbooks", legacyModule: null },
  // flywheel has a DEDICATED module (ig_growth_flywheel.js) — safe to drop from
  // the replay bundle. playbook-7day's builder lives inline in app.js (nothing
  // to drop), so its suppression relies solely on stripping the `#view-*` div.
  { view: "flywheel", legacyModule: "ig_growth_flywheel.js" },
  { view: "playbook-7day", legacyModule: null },
  // ── Remainder of the Manage group (Phase 3 batch 2) ──────────────────────
  // Every panel below either lives inline in app.js or in a SHARED public/js
  // module (ig_manage_pack.js, ig_reach_automation.js, ig_mentions_gaps.js,
  // ig_intel_pack_a/b.js, ig_advanced_features.js, ig_moat_features.js,
  // ig_content_traffic.js, ig_creator_suite.js, ig_journey_omnichannel.js,
  // ig_csuite.js, ig_settings.js) that still builds NOT-YET-migrated non-Manage
  // sibling views. Per the shared-module rule, legacyModule stays `null`:
  // suppression relies solely on stripping the `#view-<id>` div (every builder
  // early-returns when its target div/wrap is gone).
  { view: "new-project", legacyModule: null },
  { view: "master-calendar", legacyModule: null },
  { view: "brand-calendar", legacyModule: null },
  { view: "launches", legacyModule: null },
  { view: "ai-traffic", legacyModule: null },
  { view: "heatmaps", legacyModule: null },
  { view: "budget-board", legacyModule: null },
  { view: "ask-infogenie", legacyModule: null },
  { view: "agent-goals", legacyModule: null },
  { view: "ai-providers", legacyModule: null },
  { view: "meeting-notes", legacyModule: null },
  { view: "team-meetings", legacyModule: null },
  { view: "infographics", legacyModule: null },
  { view: "reengage", legacyModule: null },
  { view: "automations", legacyModule: null },
  { view: "employee-advocacy", legacyModule: null },
  { view: "signal-triggers", legacyModule: null },
  { view: "stakeholders", legacyModule: null },
  { view: "results", legacyModule: null },
  { view: "weekly-report", legacyModule: null },
  { view: "cross-channel", legacyModule: null },
  { view: "csuite", legacyModule: null },
  { view: "investor-mode", legacyModule: null },
  { view: "agency", legacyModule: null },
  { view: "marketplace", legacyModule: null },
  { view: "workspaces", legacyModule: null },
  { view: "admin", legacyModule: null },
  { view: "technical-suite", legacyModule: null },
  { view: "brand-safety", legacyModule: null },
  { view: "data-provenance", legacyModule: null },
  { view: "settings", legacyModule: null },
];

/** Set of view ids now rendered by React. */
export const MIGRATED_VIEW_IDS = new Set<string>(
  MIGRATED_VIEWS.map((m) => m.view),
);

/** `public/js` module basenames to drop from the DEV replay bundle. */
export const MIGRATED_MODULES: string[] = MIGRATED_VIEWS.map(
  (m) => m.legacyModule,
).filter((m): m is string => !!m);

/** True when a `data-view` id has been ported to a native React page. */
export function isMigratedView(view: string | null | undefined): boolean {
  return !!view && MIGRATED_VIEW_IDS.has(view);
}
