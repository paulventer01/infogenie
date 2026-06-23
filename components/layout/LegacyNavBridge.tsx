"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { viewToPath } from "@/lib/viewRoutes";

// Reverse of <SpaRouter/>: bridges the legacy SPA's navigateTo() to the Next
// router. When `navigateTo(view)` is called for a view whose `#view-<id>` div
// has been stripped from the dev shell (i.e. a migrated React panel), app.js
// finds no target div and dispatches `ig:spa-navigate`. We push the canonical
// URL so the pathname updates and <MigratedPanel/> mounts the matching React
// component — otherwise the legacy nav is a silent no-op and the page goes
// blank (e.g. the dashboard after Analyse completes).
export default function LegacyNavBridge() {
  const router = useRouter();

  useEffect(() => {
    const onNavigate = (e: Event) => {
      const view = (e as CustomEvent<{ view?: string }>).detail?.view;
      if (!view) return;
      const path = viewToPath(view);
      if (path && path !== window.location.pathname) {
        router.push(path);
      }
    };
    document.addEventListener("ig:spa-navigate", onNavigate);
    return () => document.removeEventListener("ig:spa-navigate", onNavigate);
  }, [router]);

  return null;
}
