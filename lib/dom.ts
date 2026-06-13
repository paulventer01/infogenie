// Browser/DOM helpers shared by the React feature panels (Next.js migration
// Phase 3). These wrap the imperative DOM operations the legacy panels perform
// inline (file downloads, clipboard copies) so components can call them without
// re-implementing the boilerplate or touching `window.*`.

/**
 * Trigger a browser download of a Blob. Mirrors the
 * `URL.createObjectURL` → temporary `<a>` → `revokeObjectURL` pattern used by
 * the legacy export buttons (e.g. Pitch Deck PPTX export).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Trigger a browser download of a string as a file. */
export function downloadText(
  text: string,
  filename: string,
  mime = "text/plain;charset=utf-8",
): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/**
 * Copy text to the clipboard, falling back to a hidden `<textarea>` +
 * `execCommand` when the async Clipboard API is unavailable. Resolves to
 * whether the copy succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
