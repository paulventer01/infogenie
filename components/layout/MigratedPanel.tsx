"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { pathToViewId } from "@/lib/viewRoutes";
import { MIGRATED_COMPONENTS } from "@/components/features/registry";

// Renders the native React panel for the currently-routed view, if it has been
// migrated. Mounted once in the dashboard layout, it resolves the active view
// from the URL (the same source of truth <SpaRouter/> uses) and renders the
// matching component from the registry — otherwise it renders nothing and the
// replayed legacy `#view-*` panel handles the view as before.
//
// The wrapper deliberately does NOT carry the `.view` class: the legacy
// `navigateTo` hides every `.view` div on each navigation, so a `.view` wrapper
// would get hidden out from under React. Because this only mounts for migrated
// views (whose legacy div is stripped from the dev shell), it is always the sole
// visible panel for that route.
export default function MigratedPanel() {
  const pathname = usePathname();
  // Feature panels render client-only: the server (and the initial client
  // render) emit nothing, then we swap in the real component after mount. This
  // is intentional — these panels are behind auth and load all their data
  // client-side, so SSR adds no value, and rendering them only after hydration
  // eliminates an entire class of hydration mismatches (locale-formatted dates,
  // Date.now()/Math.random(), window/localStorage reads) without having to
  // audit every one of the 200+ ported components individually.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const view = pathToViewId(pathname);
  const Cmp = view ? MIGRATED_COMPONENTS[view] : undefined;
  if (!mounted || !view || !Cmp) return null;
  return (
    <div id="ig-react-panel" data-react-view={view}>
      <Cmp />
    </div>
  );
}
