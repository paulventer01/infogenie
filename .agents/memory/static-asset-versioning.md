---
name: Static asset cache-busting
description: How index.html script/css ?v= strings are auto-derived; manual bumps retired.
---
Manual `?v=YYYYMMDD<TAG>` strings in index.html were retired. The server now
auto-appends a content-hash `?v=` to every local `.js`/`.css` reference at serve time.

**Module:** `services/static_versioning/index.js` — `serveVersionedHtml(htmlAbsPath, rootDir)`
returns an Express handler. Wired in `server.js` via `app.get(['/','/index.html'], ...)`
registered BEFORE `express.static` so the rewritten HTML wins over the raw file.

**Key invariant:** asset versions are recomputed on EVERY request (cheap statSync +
one regex pass); only the raw HTML template is cached. Do NOT cache the rewritten
HTML body keyed solely by index.html's mtime — that was the first-attempt bug:
editing app.js/ig_*.js left index.html unchanged, so stale versions were served.
`assetVersion()` caches the sha1 hash keyed by (mtimeMs,size) so big files
(app.js ~3.6MB) are only re-hashed when actually edited.

**Regex** `\b(src|href)="(\/[^"?#]+\.(?:js|css))(\?[^"]*)?"` — only root-relative
local refs; external https CDN URLs never match. Missing files drop the `?v=`.

**Why:** keeping per-tag version strings correct by hand is error-prone as app.js is
split into more public/js/ modules; a forgotten bump serves stale code to returning users.
