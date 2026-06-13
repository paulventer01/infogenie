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

## Route-group rule (don't hijack `/`)

The dashboard route group `app/(dashboard)/` must NOT contain a `page.tsx`
until the dashboard is actually migrated — a route-group `page.tsx` resolves to
`/` and would shadow the Express SPA (the fallback rewrite only fires when no
Next route matches). A `layout.tsx` alone is safe (no route without a page).
Skeleton folders use `.gitkeep`, not placeholder pages.

## Constraints learned

- **`concurrently` is firewall-blocked** (its `shell-quote` dep has a CVE). Use
  a dependency-free Node launcher (`scripts/dev.js`) that spawns both servers.
- **Avoid `next/font/google`** — it fetches from Google at build time and can be
  blocked. Use a plain `<link>` in the root layout (the SPA's index.html does
  the same; auth pages have a system-font fallback chain anyway).
- **Avoid `useSearchParams`** in client auth pages — it forces a Suspense
  boundary or the build errors. Read `window.location.search` in `useEffect`
  instead (matches the original vanilla behaviour).
