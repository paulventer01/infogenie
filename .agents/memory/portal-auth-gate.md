---
name: Portal auth gate
description: How the InfoGenie portal is locked behind login at the server, and a related still-open source-leak.
---

# Portal auth gate (server-side shell lockdown)

The app shell (`index.html`) and all app code (`app.js`, `data.js`,
`public/js/*`, `ig_field_enhancer.js`, `ig_diag.js`, `script.js`) are served
ONLY to an authenticated session. The gate is a **deny-list** middleware in
`services/auth_gate/index.js` (`appShellGate` / `isProtectedAppAsset`), mounted
in `server.js` AFTER the session middleware and BEFORE the versioned
`index.html` route + `express.static`. Anonymous GET/HEAD of a protected asset
→ `302 /login`.

The standalone `/login` page is `login.html` — self-contained (own inline
styles/script), loads NO app bundle. It is the only thing a logged-out visitor
receives.

**Why deny-list, not allow-list:** `express.static(__dirname)` serves arbitrary
files, so an allow-list "gate everything except X" risks breaking unknown public
assets. The deny-list gates exactly the app's own shell+bundle.

**How to apply:** when adding a new top-level app JS file referenced by
`index.html`, add its path to `PROTECTED_APP_ASSETS`. Files under `public/js/`
are already covered by the `/^\/public\/js\/.+\.js$/` pattern.

## Still-open related hole (proposed as follow-up)
`express.static(path.join(__dirname))` also serves raw **server source** to
anyone: `/server.js`, `/db.js`, `/services/*`, `/package.json` all return 200.
The auth gate does NOT cover these (it only protects the client bundle). A real
fix restricts static serving to a public allow-list or moves browser assets into
a dedicated public dir.
