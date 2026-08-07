"use client";

import { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import LiveAppTimer from "./LiveAppTimer";

/**
 * Mounts the live timer into `#ig-live-timer-slot` outside AppShell's React
 * tree. The slot is an empty SSR-stable placeholder in AppShell — this portal
 * fills it only after mount so a ticking Date can never hydrate-mismatch and
 * remount the shell (which would wipe legacy click handlers).
 */
export default function LiveAppTimerPortal() {
  useEffect(() => {
    let root: Root | null = null;
    let cancelled = false;

    const mount = () => {
      if (cancelled) return;
      const slot = document.getElementById("ig-live-timer-slot");
      if (!slot) return;
      if (slot.dataset.igTimerMounted === "1") return;
      slot.dataset.igTimerMounted = "1";
      root = createRoot(slot);
      root.render(<LiveAppTimer />);
    };

    if (window.__igLegacyReady) {
      mount();
    } else {
      document.addEventListener("ig:legacy-ready", mount, { once: true });
      // Fallback if legacy boot is slow / skipped
      const t = window.setTimeout(mount, 2500);
      return () => {
        cancelled = true;
        document.removeEventListener("ig:legacy-ready", mount);
        window.clearTimeout(t);
        try {
          root?.unmount();
        } catch {
          /* noop */
        }
        const slot = document.getElementById("ig-live-timer-slot");
        if (slot) delete slot.dataset.igTimerMounted;
      };
    }

    return () => {
      cancelled = true;
      try {
        root?.unmount();
      } catch {
        /* noop */
      }
      const slot = document.getElementById("ig-live-timer-slot");
      if (slot) delete slot.dataset.igTimerMounted;
    };
  }, []);

  return null;
}
