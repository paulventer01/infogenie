"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pathToViewId } from "@/lib/viewRoutes";

// Bridges Next's URL to the legacy SPA: whenever the pathname changes, it shows
// the matching #view-* panel via window.navigateTo. On first load it waits for
// <LegacyScripts/> to finish (ig:legacy-ready) before navigating, since
// navigateTo only exists once app.js has run.
export default function SpaRouter() {
  const pathname = usePathname();

  useEffect(() => {
    const view = pathToViewId(pathname) || "marketing-brief";
    const go = () => {
      try {
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
