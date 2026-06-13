// Server-only loader for the legacy SPA shell.
//
// During Phase 2 of the Next.js migration, Next owns `/` in DEV and renders the
// existing vanilla-JS SPA body (all 200+ static `#view-*` panels) via React,
// while a React <Navbar/> replaces the legacy `<nav id="navbar">`. This module
// reads `index.html` at request time and returns:
//   • `bodyHtml`  — the `<body>` inner HTML with the legacy navbar and every
//                   `<script>` stripped out (the navbar is re-rendered in React;
//                   the scripts are replayed in order by <LegacyScripts/>).
//   • `scripts`   — every `<script>` from the document (head + body) in source
//                   order, so the client loader can re-execute them faithfully.
//
// It uses `node:fs`, so it must only ever be imported from a Server Component.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATED_VIEWS } from "@/lib/migratedViews";

export type LegacyScript =
  | { type: "src"; src: string }
  | { type: "inline"; code: string };

export interface LegacyShell {
  bodyHtml: string;
  scripts: LegacyScript[];
}

function parse(): LegacyShell {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

  // 1. Collect every <script> (head + body) in document order.
  const scripts: LegacyScript[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) {
      scripts.push({ type: "src", src: srcMatch[1] });
    } else if (inner.trim()) {
      scripts.push({ type: "inline", code: inner });
    }
  }

  // 2. Extract the <body> inner HTML.
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let bodyHtml = bodyMatch ? bodyMatch[1] : html;

  // 3. Drop the legacy navbar — it's re-rendered by the React <Navbar/>.
  bodyHtml = bodyHtml.replace(/<nav\b[^>]*id="navbar"[\s\S]*?<\/nav>/i, "");

  // 4. Drop all <script> tags — they're replayed in order by <LegacyScripts/>.
  bodyHtml = bodyHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // 5. Suppress panels that have been ported to native React (<MigratedPanel/>
  //    renders them instead). For each migrated view we (a) remove its
  //    `#view-<id>` div so the legacy panel can't double-render, and (b) drop its
  //    `public/js` module from the replay bundle so it stops loading. index.html
  //    and the module file stay untouched on disk — prod still serves them.
  const migratedModules = new Set<string>();
  for (const m of MIGRATED_VIEWS) {
    bodyHtml = removeViewDiv(bodyHtml, m.view);
    if (m.legacyModule) migratedModules.add(m.legacyModule);
  }
  const keptScripts = scripts.filter(
    (s) =>
      s.type !== "src" ||
      ![...migratedModules].some((mod) => s.src.includes(mod)),
  );

  return { bodyHtml, scripts: keptScripts };
}

// Remove the `<div ... id="view-<id>">…</div>` element (with its full, possibly
// deeply-nested body) from the markup. The legacy view divs are flat siblings,
// but their content nests divs, so a naive non-greedy regex would stop at the
// first `</div>`. Instead we locate the opening tag and walk forward counting
// `<div`/`</div>` until the element closes. No-op if the view div isn't present.
function removeViewDiv(html: string, viewId: string): string {
  const marker = `id="view-${viewId}"`;
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return html;
  const start = html.lastIndexOf("<div", markerIdx);
  if (start === -1) return html;

  const tagRe = /<div\b|<\/div>/gi;
  tagRe.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[0].toLowerCase() === "</div>") {
      depth--;
      if (depth === 0) {
        const end = tagRe.lastIndex;
        return html.slice(0, start) + html.slice(end);
      }
    } else {
      depth++;
    }
  }
  return html; // unbalanced — leave untouched rather than corrupt the markup
}

// Re-read on every render in dev so edits to index.html are reflected without a
// server restart. This shell is dev-only (prod is served by Express), so the
// per-request parse cost is irrelevant.
export function getLegacyShell(): LegacyShell {
  return parse();
}
