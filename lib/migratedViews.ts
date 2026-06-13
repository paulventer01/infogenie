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
