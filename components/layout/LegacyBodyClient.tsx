"use client";

import { useEffect, useRef } from "react";

/**
 * Legacy SPA body. We freeze the HTML into the DOM once and never let React
 * rewrite it — a parent remount/hydration recovery used to replace this markup
 * and wipe all app.js click handlers, leaving a "loaded but dead" Workspace.
 */
export default function LegacyBodyClient({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const written = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || written.current) return;
    // Prefer keeping SSR markup; only write if the server left it empty.
    if (!el.childNodes.length && html) {
      el.innerHTML = html;
    }
    written.current = true;
  }, [html]);

  return (
    <div
      ref={ref}
      id="ig-legacy-root"
      style={{ display: "contents" }}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
