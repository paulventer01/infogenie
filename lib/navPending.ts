/** Shared nav-in-flight markers so IGDiag ignores expected panel-mount work. */

const NAV_ATTR = "data-ig-nav";
let clearTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

function clearMarkers(idle = true): void {
  try {
    document.documentElement.removeAttribute(NAV_ATTR);
    window.__igReactRouting = false;
    if (idle) window.IGDiag?.setBreadcrumb?.("idle");
  } catch {
    /* noop */
  }
}

function resumeFields(scoped = true): void {
  try {
    window.IGFields?.resume?.({ scan: false });
    if (scoped) {
      const root = document.getElementById("ig-react-panel");
      if (root) window.IGFields?.scanRoot?.(root);
    }
  } catch {
    /* noop */
  }
}

export function markNavPending(reason = "nav"): void {
  try {
    document.documentElement.setAttribute(NAV_ATTR, "1");
    window.__igReactRouting = true;
    window.IGDiag?.setBreadcrumb?.(reason);
  } catch {
    /* noop */
  }
  try {
    window.IGFields?.pause?.();
  } catch {
    /* noop */
  }
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (safetyTimer) clearTimeout(safetyTimer);
  // If PanelReady never mounts (unknown route), still release the guard.
  safetyTimer = setTimeout(() => {
    clearMarkers(true);
    resumeFields(false);
    try {
      window.IGFields?.resume?.();
    } catch {
      /* noop */
    }
  }, 8000);
}

/**
 * Clear nav markers only after paint + a short settle window so first-commit
 * work (lazy panel mount, field decoration) is not reported as a stall.
 *
 * Always re-asserts the guard here — analyse → dashboard goes through
 * legacy `navigateTo` + `ig:spa-navigate` and historically skipped
 * `markNavPending`, which let IGDiag flag expected Dashboard mount work.
 */
export function settleNavPending(view?: string): void {
  try {
    document.documentElement.setAttribute(NAV_ATTR, "1");
    window.__igReactRouting = true;
    if (view) window.IGDiag?.setBreadcrumb?.("panel:" + view);
  } catch {
    /* noop */
  }

  const finish = () => {
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    clearMarkers(true);
    // Decorate only the active React panel — avoid a full-document scan.
    resumeFields(true);
  };

  // Dashboard (and similarly large panels) commit 1k+ nodes on first paint.
  const settleMs = view === "dashboard" || view === "competitors" || view === "battleplan" ? 2800 : 1600;

  try {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(finish, settleMs);
      });
    });
  } catch {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(finish, settleMs);
  }
}
