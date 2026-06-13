"use client";

import { useEffect } from "react";
import type { LegacyScript } from "@/lib/legacyShell";

// Replays the legacy SPA scripts (Chart.js/Amplitude/PostHog CDN + data.js,
// app.js and every public/js module) in source order, then fires a synthetic
// DOMContentLoaded. The legacy code registers bare `DOMContentLoaded` listeners
// (no readyState guard) for its core wiring — under afterInteractive they'd
// never fire, so we dispatch the event manually once everything is loaded. When
// done, `window.__igLegacyReady` is set and `ig:legacy-ready` is dispatched so
// <SpaRouter/> can drive the first navigateTo.
export default function LegacyScripts({ scripts }: { scripts: LegacyScript[] }) {
  useEffect(() => {
    if (window.__igLegacyBooted) return;
    window.__igLegacyBooted = true;
    let cancelled = false;

    const inject = (s: LegacyScript) =>
      new Promise<void>((resolve) => {
        const el = document.createElement("script");
        if (s.type === "src") {
          el.src = s.src;
          el.async = false;
          el.onload = () => resolve();
          el.onerror = () => resolve();
          document.body.appendChild(el);
        } else {
          el.text = s.code;
          document.body.appendChild(el);
          resolve();
        }
      });

    (async () => {
      for (const s of scripts) {
        if (cancelled) return;
        await inject(s);
      }
      // The legacy app's core wiring is registered on a bare DOMContentLoaded.
      try {
        document.dispatchEvent(
          new Event("DOMContentLoaded", { bubbles: true, cancelable: false }),
        );
      } catch {
        /* noop */
      }
      window.__igLegacyReady = true;
      try {
        document.dispatchEvent(new Event("ig:legacy-ready"));
      } catch {
        /* noop */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scripts]);

  return null;
}
