"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pathToViewId } from "@/lib/viewRoutes";
import { isMigratedView } from "@/lib/migratedViews";

// Bridges Next's URL to the legacy SPA: whenever the pathname changes, it shows
// the matching #view-* panel via window.navigateTo. On first load it waits for
// <LegacyScripts/> to finish (ig:legacy-ready) before navigating, since
// navigateTo only exists once app.js has run.
//
// Migrated React panels are owned by <MigratedPanel/> — do not call legacy
// navigateTo (that races lazy chunk eval). Also do NOT clear the IGDiag
// breadcrumb to `idle` here: markNavPending / settleNavPending own that
// lifecycle. Clearing early made real panel-mount work look like
// `last=idle · view=<panel>` MAIN-THREAD STALL false positives.
export default function SpaRouter() {
  const pathname = usePathname();

  useEffect(() => {
    const view = pathToViewId(pathname) || "marketing-brief";
    const go = () => {
      try {
        if (isMigratedView(view)) {
          try {
            (window as unknown as { currentView?: string }).currentView = view;
          } catch {
            /* noop */
          }
          try {
            window.scrollTo?.(0, 0);
          } catch {
            /* noop */
          }
          return;
        }
        window.navigateTo?.(view);
      } catch {
        /* noop */
      }
    };

    if (window.__igLegacyReady && typeof window.navigateTo === "function") {
      go();
      return;
    }
    const onReady = () => go();
    document.addEventListener("ig:legacy-ready", onReady, { once: true });
    return () => document.removeEventListener("ig:legacy-ready", onReady);
  }, [pathname]);

  return null;
}
