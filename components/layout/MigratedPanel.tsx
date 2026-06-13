"use client";

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
  const view = pathToViewId(pathname);
  const Cmp = view ? MIGRATED_COMPONENTS[view] : undefined;
  if (!view || !Cmp) return null;
  return (
    <div id="ig-react-panel" data-react-view={view}>
      <Cmp />
    </div>
  );
}
