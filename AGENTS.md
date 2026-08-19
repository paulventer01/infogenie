# AGENTS.md

InfoGenie Cursor Optimisation Package v2. Configuration-only. Do not treat this file as a licence to rewrite the app.

InfoGenie is an AI marketing-intelligence platform: competitor analysis, campaign automation, SEO/content, lead management, and omnichannel outreach. The operator is non-technical — prefer executing a complete, durable change over presenting options.

## Architecture

Two Node processes, one public origin:

| Process | Role | Dev | Prod |
|---|---|---|---|
| **Next.js** (App Router, TS) | Public front door: auth pages + React dashboard | `next dev` on **5000** | `next start` on `PORT`\|\|5000 |
| **Express** (`server.js`) | Source of truth for `/api/*`, sessions, crons, legacy assets | internal **8000** (`EXPRESS_PORT`) | internal **8000** |

Launchers: `npm run dev` → `scripts/dev.js`; `npm start` → `scripts/start.js`. Next proxies `/api/*` and unmatched paths to Express (`next.config.ts`). Session cookie is `infogenie.sid` (HttpOnly, SameSite=Lax). Never run `node server.js` as the public server — it collides with Next on 5000 and serves a 503 retirement notice at `/`.

There is **no dotenv**. The app reads `process.env` directly.

## Canonical map

| Path | Own this when… |
|---|---|
| `app/` | Next routes (auth + dashboard catch-alls) |
| `components/features/` | React dashboard panels |
| `components/layout/` | Shell, navbar, legacy↔React bridges |
| `lib/` | Shared TS: `api.ts`, `migratedViews.ts`, `viewRoutes.ts`, `legacyShell.ts` |
| `services/<name>/{schema,api}.js` | New backend capability (Postgres + Express router) |
| `server.js` | Middleware order, router mounts, `buildApp()` |
| `db.js` | Postgres pool + generic `kv_store` |
| `index.html`, `app.js`, `public/js/` | Surviving legacy SPA chrome — not the place for new views |
| `docs/tiers.md` | Feature/tier index — read before adding a tier |
| `.agents/memory/` | Durable gotchas — **read, do not edit** unless the user asks |

Retired markup lives in `legacy_archive/`. Live report generation lives in `services/exports/` (not the root `exports/` folder).

## Commands

```
npm run dev              # Next :5000 + Express :8000
npm start                # prod launcher (needs a prior next build)
npm run build:next       # Next production build (slow; ESLint + full tsc)
npm run lint             # fabrication + script-tag + duplicate-globals + CSS
npm run lint:next        # Next/ESLint only
npm run test:core        # fast deterministic gate (~seconds)
npm test                 # full node:test suite; use --test-force-exit
npm run test:integration # Express + Postgres harness
```

Default test gate for agent work: `npm run test:core`. Full `npm test` can hang after passing (open jsdom/DB handles) — that is why `test:core` exists.

## Non-negotiables

1. **Smallest change that ships the request.** No drive-by refactors, no unrelated file churn, no restoring archived views unless asked.
2. **New UI goes in React** (`components/features/…` + `lib/migratedViews.ts` + `components/features/registry.tsx` lockstep). Do not add new `#view-*` panels to `index.html`.
3. **New APIs go in `services/<name>/`**, mounted from `server.js` in existing middleware order. Add the route to `services/tenants/permission_matrix.js`.
4. **Every feature table is tenant-scoped.** Resolve `tenant_id` with `_tenantCtx.resolveTenantId(req, {label})`. Production runs `MULTITENANT_ENFORCEMENT=on` and `PERMISSION_ENFORCEMENT=on`.
5. **Never present fabricated metrics as live data.** Tag template/demo/fallback payloads (`source`, `_estimated`, `_fabricated`) so honesty mode can withhold them. See `.cursor/rules/04-ai-services.mdc`.
6. **Never log or commit secrets.** Keys live in the credential vault or `platform_api_keys`, not in source.
7. **Do not modify `.agents/`** unless the user explicitly asks.

Scoped Cursor rules live in `.cursor/rules/` (`01` core, `02` scope, `03` Next.js, `04` AI, `05` database, `06` integrations, `07` testing, `08` agent routing, `09` handoff, `10` PR workflow).

## Multi-agent development

Cursor specialists live in `.cursor/agents/` (Lead, Frontend, Backend, Database, Integrations, AI/LLM, Security, QA, Reviewer). This is **development routing**, not the product `services/agent_orchestrator` / `services/agent_swarm` features.

Lead decomposes and delegates. Specialists implement only their owned files and bounce anything else to Lead with the correct specialist named (e.g. Frontend given a database task hands off — it does not touch `db.js` / `schema.js`). Cross-domain work is split. **Security is a separate agent from day one** (auth, permissions, tenant isolation, credentials, OAuth security, encryption reviews). Pipeline: **You → Lead → Specialist → QA → Reviewer → PR → You approve → main**.

Do not weaken `.cursor/rules/01`–`07`, tenant isolation, the permission matrix, or `PERMISSION_ENFORCEMENT` in order to make routing easier.

## Cursor Cloud

Local Postgres is installed but **not** auto-started. Each session:

```
sudo pg_ctlcluster 16 main start
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/infogenie"
export CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export SESSION_SECRET="dev-session-secret"
export INFOGENIE_API_KEY="dev-infogenie-api-key"
npm run dev
```

Browse `http://localhost:5000`. First signup becomes owner and is auto-logged-in.

- Postgres is optional to *boot* but required for real use. Without `DATABASE_URL`, auth returns 503 and there is **no JSON-file fallback** (`data/*.json` migrated to `kv_store`).
- `db.js` always enables SSL (`rejectUnauthorized: false`). Do not disable it for local Ubuntu Postgres.
- `next dev` and `next start` cannot share `.next`.
- Production vault boot requires `CREDENTIAL_ENCRYPTION_KEY`.
- Harmless boot noise includes `[t35] … IMMUTABLE`, optimizer missing `campaign_id`, `[t116] getDb is not a function`, and `Port 80 unavailable (EACCES)`.
- Repo targets Node 20; Node 22 is fine for `dev` / `lint` / `test:core`.

## Task shape

When scoping work, fold obvious **in-domain** derivatives into the same specialist slice: persistence (Database), tenant-scoped handlers + new `ROUTE_GROUPS` prefix (Backend), lockstep registry (Frontend), failure/empty states, and a verification test. Cross-domain work is split by the Lead agent rather than implemented by one specialist. Name anything deliberately deferred.
