// Globals exposed by the legacy vanilla-JS SPA (app.js + public/js/*) that the
// React dashboard shell calls into. These live on `window` at runtime once the
// legacy scripts have been replayed by <LegacyScripts/>.
export {};

declare global {
  interface Window {
    // app.js — show/hide the static #view-<id> panels.
    navigateTo?: (viewId: string, updateActive?: boolean) => void;
    currentView?: string;
    // Analyse → "Dashboard Diag (replay)" nav item.
    _loadDashboardDiag?: () => void;
    // Grow → "Connect to WordPress" nav item.
    openWpCredentialsModal?: () => void;
    // Navbar bell.
    toggleAlertsPanel?: () => void;
    // Legacy-shell boot coordination (set by <LegacyScripts/>).
    __igLegacyBooted?: boolean;
    __igLegacyReady?: boolean;
    // Persists in-memory SPA content (social posts, campaigns…) before logout.
    _persistContent?: () => void;
    // Legacy auth client (app.js) — only `_clearSession` is used by React.
    _auth?: { _clearSession?: () => void };
    // Set by AppShell/goToView while React owns the URL transition so
    // navigateTo skips dispatching ig:spa-navigate (avoids double remount).
    __igReactRouting?: boolean;
    /** View id React is currently routing to (paired with __igReactRouting). */
    __igPendingView?: string;
    // ig_diag.js watchdog / breadcrumb helper.
    IGDiag?: {
      setBreadcrumb?: (s: string) => void;
      log?: (...args: unknown[]) => void;
      mark?: (...args: unknown[]) => void;
      err?: (...args: unknown[]) => void;
    };
    // ig_field_enhancer.js — pause during nav, scan scoped roots after settle.
    IGFields?: {
      pause?: () => void;
      resume?: (opts?: { scan?: boolean }) => void;
      scanRoot?: (root: Element | null) => void;
    };
  }
}
