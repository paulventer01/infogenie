// Cross-view navigation helper for migrated React panels.
//
// A ported panel often links to OTHER dashboard tools (most still legacy). This
// keeps both worlds in sync: it calls the legacy `window.navigateTo` (which does
// the instant `#view-*` panel swap for legacy targets, or a no-op for migrated
// ones whose div is stripped from the shell) AND pushes the canonical Next URL
// so the address bar, deep links and back/forward stay correct — and, for
// migrated targets, so <MigratedPanel/> mounts the right React component.

import type { useRouter } from "next/navigation";
import { startTransition } from "react";
import { viewToPath } from "@/lib/viewRoutes";

type AppRouter = ReturnType<typeof useRouter>;

export function goToView(router: AppRouter, view: string): void {
  const path = viewToPath(view);
  try {
    window.navigateTo?.(view);
  } catch {
    /* legacy not loaded yet — router.push still updates the URL */
  }
  // Skip a second push when navigateTo already bridged via ig:spa-navigate
  // (LegacyNavBridge). Only push here as a fallback when the path still differs.
  if (typeof window !== "undefined" && window.location.pathname === path) return;
  startTransition(() => {
    router.push(path);
  });
}
