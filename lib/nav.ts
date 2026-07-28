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
  startTransition(() => {
    router.push(path);
  });
  try {
    (window as unknown as { __igReactRouting?: boolean }).__igReactRouting = true;
    window.navigateTo?.(view);
  } catch {
    /* legacy not loaded yet — router.push still updates the URL */
  } finally {
    try {
      (window as unknown as { __igReactRouting?: boolean }).__igReactRouting = false;
    } catch {
      /* noop */
    }
  }
}
