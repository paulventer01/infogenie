/** Shared nav-in-flight markers so IGDiag ignores expected panel-mount work. */

const NAV_ATTR = "data-ig-nav";
let clearTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

function clearMarkers(idle = true): void {
  try {
    document.documentElement.removeAttribute(NAV_ATTR);
    window.__igReactRouting = false;
    window.__igPendingView = undefined;
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
    // Stash the target view so legacy navigateTo can skip a duplicate
    // ig:spa-navigate when React already owns this same transition.
    const m = /^nav→(.+)$/.exec(reason);
    window.__igPendingView = m ? m[1] : reason;
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

  // Large / form-heavy panels commit 1k+ nodes (and often hydrate from API)
  // after first paint — keep the stall guard up long enough to cover that.
  const heavy =
    view === "home" ||
    view === "campaigns" ||
    view === "dashboard" ||
    view === "competitors" ||
    view === "battleplan" ||
    view === "white-label" ||
    view === "settings" ||
    view === "csuite";
  const settleMs = heavy ? 2800 : 1600;

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
