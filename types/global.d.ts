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
  }
}
