// Shared pure utilities for the React feature panels (Next.js migration Phase 3).
//
// These mirror the long-standing helpers in the legacy `app.js` SPA so that a
// panel ported to React produces byte-for-byte identical output. The legacy
// globals (`_escapeHtml`, `_safeUrl`, …) stay in `app.js` for now because the
// not-yet-migrated views still depend on them; these are the typed, importable
// equivalents new components use instead of reaching for `window.*`.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** HTML-escape a value. Mirrors `_escapeHtml` in app.js exactly. */
export function escapeHtml(s: unknown): string {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => HTML_ESCAPES[c],
  );
}

/**
 * Sanitise a URL for use in `href`/`src`. Returns `#` for anything that is not
 * an `http(s):` or `mailto:` URL. Mirrors `window._safeUrl` in app.js.
 */
export function safeUrl(u: unknown): string {
  try {
    const p = new URL(String(u));
    return /^(https?|mailto):$/i.test(p.protocol) ? p.toString() : "#";
  } catch {
    return "#";
  }
}

/**
 * Best-effort parse of a JSON payload returned by an LLM. Handles raw JSON,
 * ```json fenced blocks, and prose with an embedded object/array — mirroring the
 * `JSON.parse` + regex-extract fallback pattern used across the legacy modules.
 * Returns `fallback` (default `null`) when nothing parseable is found.
 */
export function safeLLMJson<T = unknown>(
  raw: unknown,
  fallback: T | null = null,
): T | null {
  if (raw == null) return fallback;
  const text = String(raw).trim();
  if (!text) return fallback;

  try {
    return JSON.parse(text) as T;
  } catch {
    /* fall through */
  }

  // Strip a leading/trailing markdown code fence (```json … ```).
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (unfenced !== text) {
    try {
      return JSON.parse(unfenced) as T;
    } catch {
      /* fall through */
    }
  }

  // Extract the first {...} or [...] block embedded in surrounding prose.
  const match = unfenced.match(/[[{][\s\S]*[\]}]/);
  if (match) {
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      /* fall through */
    }
  }

  return fallback;
}

/** Join class names, dropping falsy values. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
