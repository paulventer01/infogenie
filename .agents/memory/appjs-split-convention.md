---
name: app.js split into per-feature modules
description: How the 50k-line app.js is being broken into public/js/ feature files, and the safe extraction unit.
---

# Splitting app.js into per-feature module files

`app.js` is being carved into `public/js/ig_<feature>.js` files loaded as plain
`<script>` tags in `index.html` (after app.js), each with its own `?v=`
cache-bust. Convention is documented in `public/js/README.md`.

**The safe extraction unit is a whole top-level IIFE.** app.js groups related
features into self-contained packs like `(function studioPack(){ … })();`. Each
pack:
- defines its OWN private helpers (`_esc`, `_f`, `_toast`, constants) — they are
  intentionally duplicated per pack, which is exactly what makes a pack movable;
- attaches public entry points to `window` (`window.buildX = …`);
- references only globals (`showToast`, `navigateTo`, `_esc` at 28095, `_safeUrl`
  at 37214, `analysisData`, Chart) that stay in app.js and exist at *call time*.

So a pack can only be reached from outside via its `window.*` exports — that
guarantees isolation. Move the IIFE verbatim, leave a pointer comment in app.js,
add a `<script>` tag.

**Why load-order is safe:** builders run on navigation (user click) or via the
background pre-build queue. That queue only ever calls
dashboard/competitors/audience/creative/intelligence/battleplan — all of which
stay in app.js. Extracted builders are invoked through `window.buildX` long
after every script has executed, so loading the modules after app.js is fine.

**navigateTo dispatch** (~line 3094) calls some builders bare (`buildStudio()`)
and others guarded (`window.buildX && window.buildX()`). Bare calls still
resolve because `window.buildStudio = …` creates a global property. Don't worry
about converting bare→guarded when extracting.

**Verify an extraction** with: `node --check` each file; `diff` the new file
(minus banner) against the pre-edit app.js region to prove a verbatim move;
HTTP 200 on `/public/js/<file>.js`; clean browser console at load (a failed IIFE
throws at load and the builder would be undefined).

Extracted so far: `ig_studio.js`, `ig_journey_omnichannel.js`, `ig_manage_pack.js`,
`ig_seo.js` (T22/T29/T30 + Local SEO + Social Tags — 5 contiguous standalone
`window.build*` fns, NOT one IIFE, but the contiguous region had no shared
top-level decls so it moved verbatim as one unit), `ig_onboarding.js` (Onboarding
Wizard + Tour IIFE), `ig_true_roas.js` (T36 `_trState`+`buildTrueRoas`+`_tr*` —
top-level fns, no IIFE, no shared decls), `ig_content_traffic.js`
(`buildContentScore`/`_csRender`+`buildAiTrafficMonitor`+`buildVisLeaderboard` —
contiguous top-level fns), `ig_navchrome.js` (three clustered IIFEs right after
onboarding: Slim Sidebar collapse/filter + auto-injected View Header/breadcrumbs +
Related Views pill bar — each its own self-contained DOMContentLoaded IIFE, moved
verbatim as one contiguous region). Remaining candidates: etc.
All edit the same app.js + index.html so they can't run in parallel.

Note: index.html script tags carry NO manual `?v=` anymore — the server
auto-appends a content-hash `?v=` at serve time (see static-asset-versioning.md),
so just add a plain `<script src="/public/js/ig_<feature>.js">` tag after app.js.
