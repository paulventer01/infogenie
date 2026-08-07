"use client";

import { useEffect } from "react";

const BADGE_SEL = "[data-next-badge-root], [data-next-badge], [data-nextjs-toast]";

function hideNode(el: Element) {
  const style = (el as HTMLElement).style;
  if (!style) return;
  style.setProperty("display", "none", "important");
  style.setProperty("visibility", "hidden", "important");
  style.setProperty("opacity", "0", "important");
  style.setProperty("pointer-events", "none", "important");
  style.setProperty("width", "0", "important");
  style.setProperty("height", "0", "important");
  style.setProperty("overflow", "hidden", "important");
}

function sweep() {
  try {
    // Light-DOM hosts (if Next ever mounts them outside the portal).
    document.querySelectorAll(BADGE_SEL).forEach(hideNode);
    // Next 15 mounts the black "N" / error badge inside nextjs-portal shadow roots.
    document.querySelectorAll("nextjs-portal").forEach((portal) => {
      const root = (portal as HTMLElement).shadowRoot;
      if (!root) return;
      root.querySelectorAll(BADGE_SEL).forEach(hideNode);
    });
  } catch {
    /* noop */
  }
}

/**
 * Next.js re-injects its black "N" / route badge when runtime issues fire,
 * even with `devIndicators: false`. Hide badge hosts on every page so they
 * never read as a stray mark on the workspace canvas. Error dialog overlays
 * are left alone.
 */
export default function HideNextDevBadge() {
  useEffect(() => {
    sweep();
    const mo = new MutationObserver(() => sweep());
    try {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      /* noop */
    }
    const t = window.setInterval(sweep, 1500);
    return () => {
      mo.disconnect();
      window.clearInterval(t);
    };
  }, []);

  return null;
}
