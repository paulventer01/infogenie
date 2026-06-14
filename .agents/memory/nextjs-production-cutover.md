---
name: Next.js production cutover
description: How production serves the React app — the start launcher, deploy config, and the port/build constraints that bite.
---

# Next.js production cutover

Production no longer runs `node server.js` directly. `npm start` →
`scripts/start.js`, the prod mirror of `scripts/dev.js`:

- Express on internal `EXPRESS_PORT` (default 8000), `NODE_ENV=production`,
  `NEXT_FRONT_DOOR=1` (so it cedes `/` to Next but still serves `/index.html`,
  all legacy assets, and `/api/*`).
- `next start -p <PORT||5000>` on the public port, `NODE_ENV=production`,
  `EXPRESS_PROXY_TARGET=http://localhost:<EXPRESS_PORT>`.
- Same crash/teardown pattern as dev: either process dying kills the other and
  exits non-zero so the platform restarts the whole thing.

`start:express` keeps the old `node server.js` path for one-off use.

## Deploy config
`.replit` deployment is **vm** (not autoscale/static): the app has crons,
optimizer/journey ticks, and in-memory state (`global._dripStore`) that need an
always-running process. build=`npm run build:next`, run=`npm start`.
**Why vm:** autoscale would suspend background jobs and drop in-memory locks.

## Production secret gotcha
Under `NODE_ENV=production` the credential vault **refuses to boot** without
`CREDENTIAL_ENCRYPTION_KEY` (services/credentials). Dev never sets it (vault
disabled in dev), so a local prod smoke test must export a throwaway key just to
boot. The real deploy must have it set or Express exits 1 immediately (and the
launcher tears Next down with it).

## Build constraints that waste time
- `next dev` and `next start` **cannot share `.next`** — running the dev
  workflow wipes a production build out from under `next start` ("Could not find
  a production build"). Stop dev before exercising the prod launcher locally.
- Full `next build` here is **slow (~10 min)** and detached spawns (`setsid`,
  `nohup`) get SIGKILLed by the harness; `.local/*` scratch dirs get cleaned
  mid-run. Poll `.next/BUILD_ID` to detect completion rather than trusting a log
  file. A clean build yields server-mode manifests (export-marker
  `hasExportPathMap:false`).

## What's env-agnostic (verify via the running dev server)
`next.config.ts` rewrites (`/api/*` beforeFiles, `/:path*` fallback) and
`middleware.ts` (`/`→`/login` when no `infogenie.sid`) run identically in dev and
prod. Live checks against dev: `/`→307 /login, `/login`→200, `/style.css`→200
(proxied), `/api/auth/me`→200 (proxied), `/app.js`→302 (Express auth-gate).
