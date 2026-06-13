"use client";

// Toast hook for the React feature panels (Next.js migration Phase 3).
//
// Reuses the legacy `#toast` element and its `.toast` / `.hidden` CSS (from
// style.css) so notifications look identical to the legacy `showToast()` in
// app.js. During the incremental migration the `#toast` node already exists in
// the rendered legacy body; if it is ever missing we create it on demand, so a
// fully-React page works too. No `window.*` globals are introduced — the
// dismiss timer is module-scoped.

import { useCallback } from "react";

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Imperatively show a toast. Safe to call from anywhere (no-ops during SSR).
 * Mirrors the legacy `showToast(msg)` behaviour: show for 4s then hide.
 */
export function showToast(msg: string): void {
  if (typeof document === "undefined") return;
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast hidden";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove("hidden");
  toast.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
    toast.classList.add("hidden");
  }, 4000);
}

/** React hook returning a stable `toast(msg)` callback. */
export function useToast(): (msg: string) => void {
  return useCallback((msg: string) => showToast(msg), []);
}
