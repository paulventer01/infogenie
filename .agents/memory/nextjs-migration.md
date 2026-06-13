---
name: Next.js migration (incremental front door)
description: How the Next.js layer coexists with the legacy Express SPA — ports, proxying, route-group rules.
---

# Next.js migration — incremental front door

InfoGenie is migrating its vanilla-JS SPA + Express backend to Next.js (App
Router, TypeScript) **incrementally**. Next.js is the front door; Express stays
the source of truth for the SPA and all `/api/*`.

## Port split (the key gotcha)

- **Production (`npm start` → `node server.js`)**: Express listens on **5000**
  (preview) + 80. Unchanged.
- **Dev (`npm run dev` → `scripts/dev.js`)**: Express moves to **8000** via
  `EXPRESS_PORT`, Next.js takes **5000** (Replit webview must be 5000).
- The Express preview listen reads `process.env.EXPRESS_PORT || 5000` (in
  `services/competitor_detect/routes.js`), so default behaviour (prod, tests)
  is untouched.

**Why:** Replit's webview is hard-wired to port 5000 and the done-criteria
require Next to be the front door. Two servers can't both own 5000, so dev
shifts Express to an internal port and Next proxies to it.

## Proxying

`next.config.ts` rewrites send everything Next doesn't own back to Express:
`beforeFiles` for `/api/:path*` (so an accidental page can't shadow the API),
`fallback` for `/:path*` (the SPA at `/`, static assets, etc.). Single
same-origin keeps the `infogenie.sid` session cookie working. Target is
`EXPRESS_PROXY_TARGET` (set by `scripts/dev.js`, defaults to localhost:8000).

## Route-group rule (`/` ownership flips by phase)

A route-group `page.tsx` resolves to `/` and shadows the Express SPA (the
fallback rewrite only fires when no Next route matches). In **Phase 1** this was
forbidden — `app/(dashboard)/` had only a `layout.tsx`, folders were `.gitkeep`.
In **Phase 2 (dev) Next deliberately owns `/`**: `app/(dashboard)/page.tsx`
(home) + per-group `<group>/[[...slug]]/page.tsx` claim every dashboard URL.
**Why this is safe for prod:** Express's `/` index.html route is gated behind
`NEXT_FRONT_DOOR=1` (set only by `scripts/dev.js`); plain `node server.js`
(prod) has no flag, keeps serving the SPA at `/`, and never runs Next at all.

## Phase 2 — Next renders the legacy SPA shell (dev)

See `nextjs-phase2-spa-shell.md` for the replay pattern (read index.html
server-side, strip navbar+scripts, React-render the body, replay scripts in
order then fire a synthetic DOMContentLoaded).

## Phase 3 — feature panel extraction (shared foundation)

The 176 view panels (legacy `app.js` + `public/js/ig_*.js`, ~50k lines) are
being ported to `components/features/[group]/*.tsx` group-by-group (Manage →
Grow → Reach → Create → Analyse). Step 1 (the prerequisite) is the shared
foundation that panels import instead of `window.*`:
`lib/utils.ts` (`escapeHtml`/`safeUrl`/`safeLLMJson`, mirroring `_escapeHtml`/
`_safeUrl`), `lib/dom.ts` (`downloadBlob`/`copyToClipboard`), `lib/api.ts`
(`apiFetch`/`apiGet…apiDelete`/`apiBlob` — same-origin, normalises both
transport and `{ok:false}` app errors), `hooks/useToast.ts` (`showToast`
reuses the legacy `#toast` node + `.toast`/`.hidden` CSS for identical look).

**Why the legacy app.js utils are NOT deleted yet:** the un-migrated views
still call them at runtime. Removing `_escapeHtml`/`_safeUrl`/`showToast` from
`app.js` before every panel is ported would break the live SPA — defer that to
Phase 4 cleanup once nothing depends on them.

**Panel-render gotcha (unsolved until a group is actually ported):** a ported
panel's Next page must render the React component AND suppress the legacy
`#view-*` div (navigateTo shows/hides `.view` divs) or the content
double-renders. Needs a migrated-view registry the page + SpaRouter consult.

- The `lint` workflow flagging `services/revenue_forecast/api.js` (fabrication
  marker) is **pre-existing and unrelated** to the Next.js migration (backend
  service file, out of frontend scope).

## Constraints learned

- **`concurrently` is firewall-blocked** (its `shell-quote` dep has a CVE). Use
  a dependency-free Node launcher (`scripts/dev.js`) that spawns both servers.
- **Avoid `next/font/google`** — it fetches from Google at build time and can be
  blocked. Use a plain `<link>` in the root layout (the SPA's index.html does
  the same; auth pages have a system-font fallback chain anyway).
- **Avoid `useSearchParams`** in client auth pages — it forces a Suspense
  boundary or the build errors. Read `window.location.search` in `useEffect`
  instead (matches the original vanilla behaviour).
