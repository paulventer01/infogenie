# `public/js/` — per-feature frontend modules

This folder holds feature view-builders that were carved out of the monolithic
`app.js` (~50k lines). The goal: editing one feature only re-downloads that
feature's file, two people can touch different features without colliding, and
each file is small enough to read.

## The convention (read before adding a file here)

1. **Plain `<script>`, not an ES module.** The SPA injects views via
   `innerHTML` with inline `onclick=` handlers and calls builders by global
   name. So everything must stay a classic global script — no `import`/`export`,
   no bundler, no build step.

2. **Public entry points stay on `window`.** Each builder keeps its existing
   `window.buildX = function(){…}` (or `function buildX(){}` global) attachment,
   exactly as it was in `app.js`. That is what `navigateTo()`'s dispatch chain
   and inline `onclick="..."` handlers resolve against. Feature-private helpers
   stay inside the file's IIFE so they don't leak into the global namespace.

3. **One IIFE per file.** Wrap the feature in `(function(){ … })();` so its
   private helpers (`_esc`, `_f`, `_toast`, constants, …) are scoped to the file.
   These helpers are intentionally duplicated per file — that is what makes each
   file self-contained and safe to move.

4. **Shared globals come from `app.js`.** `showToast`, `navigateTo`, `_esc`,
   `_safeUrl`, `_escapeHtml`, `analysisData`, `_dataBadge`, Chart, etc. are
   defined in `app.js` and are available at *call time* (i.e. when the user
   navigates). Files here are loaded **after** `app.js` in `index.html`, but
   load order only matters for code that runs at load time — builders run on
   navigation, long after every script has executed.

5. **Per-file cache-busting.** Each `<script src>` in `index.html` carries its
   own `?v=YYYYMMDD<TAG>` string. When you edit a file here, bump **only that
   file's** `?v=` — you no longer have to bump (and force a re-download of) the
   whole `app.js`.

## How to extract another view from `app.js`

1. Find the feature's top-level IIFE (or its `build*` function plus its
   feature-private helpers). The existing `(function …(){ … })();` packs are the
   cleanest unit — they already attach only to `window`.
2. Move that block verbatim into a new `public/js/ig_<feature>.js` with the
   standard banner header. Do not change any code.
3. Leave a short pointer comment in `app.js` where the block used to be.
4. Add a `<script src="/public/js/ig_<feature>.js?v=…">` tag in `index.html`,
   after `app.js`, with its own cache-bust string.
5. Verify: load the app, navigate to the view, confirm it renders, charts draw,
   inline buttons fire, and there are no console errors.

## Files

| File | Views |
|---|---|
| `ig_studio.js` | Creator Studio (Brand Identity, Image Toolkit, AI Video, Presentations, Email Signature, Case Study, Page Insights, SEO Change Log) + WhatsApp/Voice/Bookings/Site/Link-in-Bio tiles |
| `ig_journey_omnichannel.js` | Customer Journey Builder · Real-time Signal Triggers · Omnichannel Composer |
| `ig_manage_pack.js` | New Project · Brand Calendar · Ask InfoGenie · Infographics · Heatmaps · Question Miner · AI Providers · Ad Swipe · Brand Foundation · Budget Board · Web Analytics |
