"use client";

import { useEffect, startTransition } from "react";
import { useRouter } from "next/navigation";
import { viewToPath } from "@/lib/viewRoutes";
import { markNavPending } from "@/lib/navPending";

// Reverse of <SpaRouter/>: bridges the legacy SPA's navigateTo() to the Next
// router. When `navigateTo(view)` is called for a view whose `#view-<id>` div
// has been stripped from the dev shell (i.e. a migrated React panel), app.js
// finds no target div and dispatches `ig:spa-navigate`. We push the canonical
// URL so the pathname updates and <MigratedPanel/> mounts the matching React
// component — otherwise the legacy nav is a silent no-op and the page goes
// blank (e.g. the dashboard after Analyse completes).
//
// router.push is wrapped in startTransition so the previous panel stays
// responsive while the next route/chunk loads, avoiding MAIN-THREAD STALL
// reports from IGDiag during nav→<view>.
export default function LegacyNavBridge() {
  const router = useRouter();

  useEffect(() => {
    const onNavigate = (e: Event) => {
      const view = (e as CustomEvent<{ view?: string }>).detail?.view;
      if (!view) return;
      const path = viewToPath(view);
      if (!path || path === window.location.pathname) return;
      // Mark before push — analyse→dashboard used to skip this and IGDiag
      // flagged the Dashboard first paint as a MAIN-THREAD STALL.
      markNavPending("nav→" + view);
      startTransition(() => {
        router.push(path);
      });
    };
    document.addEventListener("ig:spa-navigate", onNavigate);
    (window as unknown as { __igNavigate?: (path: string) => void }).__igNavigate = (path: string) => {
      if (!path || path === window.location.pathname) return;
      markNavPending("nav→path");
      startTransition(() => {
        router.push(path);
      });
    };
    return () => {
      document.removeEventListener("ig:spa-navigate", onNavigate);
      delete (window as unknown as { __igNavigate?: (path: string) => void }).__igNavigate;
    };
  }, [router]);

  return null;
}
