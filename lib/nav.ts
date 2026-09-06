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
import { markNavPending } from "@/lib/navPending";

type AppRouter = ReturnType<typeof useRouter>;

export function goToView(router: AppRouter, view: string, opts?: { query?: Record<string, string> }): void {
  let path = viewToPath(view);
  if (opts?.query && Object.keys(opts.query).length) {
    const qs = new URLSearchParams(opts.query).toString();
    path = path + (path.includes("?") ? "&" : "?") + qs;
  }
  markNavPending("nav→" + view);
  startTransition(() => {
    router.push(path);
  });
  try {
    window.navigateTo?.(view);
  } catch {
    /* legacy not loaded yet — router.push still updates the URL */
  }
}
