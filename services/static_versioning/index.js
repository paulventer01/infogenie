// Automatic static-asset cache-busting.
//
// Instead of hand-maintaining `?v=YYYYMMDD<TAG>` strings on every <script>/<link>
// in index.html, the server derives each local asset's version from its file
// content at serve time. Editing a file changes its content hash, so the URL
// changes automatically and returning users always fetch the new bytes — with no
// manual bump and no risk of a forgotten version string serving stale code.
//
// Versions are short content hashes (sha1, first 10 hex chars) cached per file
// and only recomputed when the file's mtime/size changes, so the 3.6 MB app.js is
// hashed once per edit — not on every page load.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cache: absPath -> { mtimeMs, size, version }
const _versionCache = new Map();

// Compute a content-hash version token for a local asset. Returns null when the
// file does not exist (caller leaves the reference unversioned in that case).
function assetVersion(absPath) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  const cached = _versionCache.get(absPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.version;
  }
  let version;
  try {
    const buf = fs.readFileSync(absPath);
    version = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
  } catch {
    return null;
  }
  _versionCache.set(absPath, { mtimeMs: stat.mtimeMs, size: stat.size, version });
  return version;
}

// Matches src="/foo.js" or href="/foo.css" (root-relative local assets only),
// optionally carrying an existing `?v=...` that we overwrite. External URLs
// (https://…) and non-js/css refs never start with a leading "/…\.(js|css)" so
// they are left untouched.
const _ASSET_RE = /\b(src|href)="(\/[^"?#]+\.(?:js|css))(\?[^"]*)?"/g;

// Rewrite an HTML string so every local .js/.css reference carries a fresh
// content-hash `?v=`. `rootDir` is the directory the asset paths resolve against.
function versionHtml(html, rootDir) {
  return html.replace(_ASSET_RE, (match, attr, urlPath) => {
    const absPath = path.join(rootDir, urlPath);
    const v = assetVersion(absPath);
    if (!v) return `${attr}="${urlPath}"`; // file missing — drop any stale ?v=
    return `${attr}="${urlPath}?v=${v}"`;
  });
}

// Returns an Express handler that serves the given HTML file with its local
// asset references auto-versioned. The HTML itself is sent `no-cache` so the
// browser always re-fetches it (it is tiny) and picks up new asset versions,
// while the hashed asset URLs remain cacheable.
function serveVersionedHtml(htmlAbsPath, rootDir) {
  // Cache only the raw HTML template (re-read when index.html itself changes).
  // Versions are recomputed on every request so an edit to ANY referenced asset
  // is reflected immediately — assetVersion() only re-hashes a file when its
  // mtime/size changed, so the per-request cost is a handful of cheap statSync
  // calls plus one regex pass, never re-hashing unchanged files.
  let raw = null; // { mtimeMs, size, html }
  return (req, res) => {
    let stat;
    try {
      stat = fs.statSync(htmlAbsPath);
    } catch {
      return res.status(404).send('Not found');
    }
    if (!raw || raw.mtimeMs !== stat.mtimeMs || raw.size !== stat.size) {
      let html;
      try {
        html = fs.readFileSync(htmlAbsPath, 'utf8');
      } catch {
        return res.status(404).send('Not found');
      }
      raw = { mtimeMs: stat.mtimeMs, size: stat.size, html };
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(versionHtml(raw.html, rootDir));
  };
}

// `express.static` `setHeaders` hook: when a request targets a fingerprinted
// asset (a .js/.css whose `?v=` matches the file's CURRENT content hash), mark
// it long-lived & immutable so returning visitors are served straight from
// cache and never re-download an unchanged 3.6 MB app.js. A request whose `?v=`
// does NOT match the current hash (e.g. a stale URL from an old, no-cached
// index.html) is intentionally left untouched — so it keeps the global
// middleware's no-store header and the browser re-fetches & self-corrects on the
// next load. Non-`?v=` requests are likewise untouched. `absPath` is the
// resolved file path send is about to stream.
function setVersionedAssetHeaders(res, absPath) {
  const req = res && res.req;
  const v = req && req.query && req.query.v;
  if (!v || typeof v !== 'string') return;
  if (!/\.(?:js|css)$/i.test(absPath)) return;
  const current = assetVersion(absPath);
  if (!current || v !== current) return;
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.removeHeader('Pragma');
  res.removeHeader('Expires');
}

module.exports = { assetVersion, versionHtml, serveVersionedHtml, setVersionedAssetHeaders };
