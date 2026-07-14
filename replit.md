# InfoGenie

AI-powered marketing intelligence and campaign automation platform — competitor analysis, ad campaigns, SEO/content, lead management, omnichannel outreach.

## Run

**Production (Next.js is the front door — `npm start`):**

```
npm run build:next   # build the React/Next output (.next)
npm start            # → scripts/start.js
```

`scripts/start.js` is the prod mirror of `scripts/dev.js`: it spawns **Express on internal port 8000** (`EXPRESS_PORT=8000`, `NODE_ENV=production`, `NEXT_FRONT_DOOR=1`) and runs **`next start` on the public port** (`PORT`||5000, `NODE_ENV=production`) with `EXPRESS_PROXY_TARGET` pointed at the internal Express. Next owns the React dashboard + auth pages; everything else (the whole `/api/*` surface, `/index.html`, all legacy assets, `/style.css`, `public/js/*`, `/uploads`) is proxied to Express via `next.config.ts`. Single same-origin so the `infogenie.sid` cookie keeps working across the boundary. If either process dies the launcher tears the other down and exits non-zero so the platform restarts cleanly. Deployment is **vm** (always-running — crons/optimizer/journey ticks + in-memory state); `.replit` build=`npm run build:next`, run=`npm start`. `CREDENTIAL_ENCRYPTION_KEY` is **required** to boot in production. Express still listens on 80 (external) via the deploy proxy. PostgreSQL via `DATABASE_URL`. JSON files in `data/` auto-migrate to `kv_store` at boot.

**Legacy shell retired over HTTP:** Express no longer serves `index.html` — `GET /index.html` 302-redirects to `/` (the Next front door), so old bookmarks land on the React dashboard instead of the stripped legacy shell. Next reads `index.html` from disk (`lib/legacyShell.ts`), never over HTTP. The `start:express` npm script has been removed; running `node server.js` standalone (debug only, also `dev:express`) serves a 503 retirement notice at `/` pointing at `npm run dev` / `npm start`.

**Dev (Next.js front door — `npm run dev`):**

`scripts/dev.js` spawns Express on internal port **8000** (`EXPRESS_PORT=8000`) and **Next.js (App Router, TS) on port 5000** (the Replit webview). Next owns the new auth pages (`/login`, `/reset-password`, `/accept-invite`) and proxies everything else — the legacy SPA at `/`, all static assets, and the whole `/api/*` surface — back to Express via rewrites in `next.config.ts`. Single same-origin so the `infogenie.sid` cookie keeps working. `npm run build:next` / `npm run lint:next` for the Next layer. Note: `next dev` and `next start` cannot share the `.next` dir, so don't run the dev workflow while exercising the prod launcher locally. The migration is complete: every dashboard view is ported to React (`lib/migratedViews.ts` + `components/features/registry.tsx`). The duplicate legacy code for migrated views has been removed: 22 view-builder modules deleted from `public/js/` (17 shared/chrome modules remain), 228 migrated `#view-*` divs stripped from `index.html` (23 remain, incl. `view-home`), and their dead dispatch blocks deleted from `app.js` (surviving bare builder refs are guarded with `window.buildX && …`). The legacy shell (`index.html`/`app.js` + surviving modules) still hosts the not-yet-ported chrome and legacy-only panels.

## Lint

```
npm run lint
```

Runs `lint:fabrication` (AI-placeholder markers) **and** `lint:css` (both CSS checks) in sequence. Also available via the `lint` workflow in Replit. Individual checks: `npm run lint:fabrication` · `npm run lint:css-important` · `npm run lint:css-specificity` · `npm run lint:css` (both CSS checks together).

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express.js |
| Frontend | Vanilla JS SPA · HTML5 · CSS3 · Chart.js v4.4.0 |
| Database | PostgreSQL (`kv_store` + per-tier tables) |
| AI/LLM | GPT-4o/mini · Claude · Gemini · Perplexity · Cloudflare Workers AI (Llama 3.1) |
| External | DataForSEO · Firecrawl · HubSpot · Resend · Amplitude · Google PageSpeed · RapidAPI · Zernio |

## File Map

| Path | Purpose |
|---|---|
| `index.html` | SPA entry point |
| `style.css` | All styling |
| `app.js` | Frontend logic (~23k lines; shared chrome/utilities — migrated view-builders removed, remainder extracted into 17 `public/js/` modules) |
| `public/js/<feature>.js` | Extracted per-feature view-builders (plain `<script>` + `window` globals; own `?v=`). See `public/js/README.md` |
| `data.js` | Industry intelligence + competitor data |
| `server.js` | Express server + API wiring |
| `ig_field_enhancer.js` | Global AI-Suggest field decorator (MutationObserver) |
| `services/<name>/{schema,api}.js` | Per-tier backend modules |
| `docs/tiers.md` | **Full T1-T38 index** — read before adding tiers |
| `services/auth/` | Platform auth (users, sessions, OAuth) |
| `services/credentials/vault.js` | AES-256-GCM per-user credential vault |
| `services/google_ads_oauth/` | Per-user Google Ads OAuth Connect |
| `services/meta_ads_oauth/` | Per-user Meta Ads OAuth Connect |
| `scripts/` | Build utilities (manual gen, screenshots) |
| `uploads/` | User-uploaded brand assets |

## Environment Variables

**Required in production:**

| Var | Purpose |
|---|---|
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte AES-256-GCM key for vault (`openssl rand -base64 32`) |
| `SESSION_SECRET` | Signs `infogenie.sid` cookie (falls back to `INFOGENIE_API_KEY` in dev) |
| `DATABASE_URL` | Postgres connection string |
| `INFOGENIE_API_KEY` | API gate + LLM quota enforcement |

**Auth / Social Login (optional — missing = button hidden):**

`AUTH_GOOGLE_CLIENT_ID` · `AUTH_GOOGLE_CLIENT_SECRET` · `AUTH_FACEBOOK_CLIENT_ID` · `AUTH_FACEBOOK_CLIENT_SECRET` · `AUTH_MICROSOFT_CLIENT_ID` · `AUTH_MICROSOFT_CLIENT_SECRET`

**AI providers:**

`AI_INTEGRATIONS_OPENAI_API_KEY` · `AI_INTEGRATIONS_ANTHROPIC_API_KEY` · `GEMINI_API_KEY` · `PERPLEXITY_API_KEY` · `CLOUDFLARE_ACCOUNT_ID` · `CLOUDFLARE_AI_TOKEN`

**Ad platforms:**

| Var | Notes |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Platform-wide (Google issues to apps, not users) |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` / `_SECRET` | Required for per-user Google Ads OAuth Connect |
| `GOOGLE_ADS_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` / `_CUSTOMER_ID` | Owner env-var fallback only |
| `GOOGLE_MERCHANT_CENTER_ID` | Shopping campaign launches |
| `META_ACCESS_TOKEN` · `META_AD_ACCOUNT_ID` | Meta Ads |
| `TIKTOK_ACCESS_TOKEN` · `TIKTOK_ADVERTISER_ID` · `TIKTOK_RAPIDAPI_KEY` | TikTok |
| `MICROSOFT_ADS_*` (5 vars) | Microsoft Ads |

**Other integrations:**

`RESEND_API_KEY` · `RESEND_WEBHOOK_SECRET` · `RESEND_FROM_EMAIL` (sender; must be a verified Resend domain) · `HUBSPOT_PRIVATE_APP_TOKEN` · `FIRECRAWL_API_KEY` · `APOLLO_API_KEY` · `BUILTWITH_API_KEY` · `GOOGLE_PAGESPEED_API_KEY` · `GOOGLE_SEARCH_API_KEY` · `SLACK_WEBHOOK_URL` · `AMPLITUDE_API_KEY` · `ZERNIO_API_KEY`

**Messaging / push channels (optional):**

`TWILIO_ACCOUNT_SID` · `TWILIO_AUTH_TOKEN` · `TWILIO_FROM_NUMBER` · `WHATSAPP_PHONE_NUMBER_ID` · `WHATSAPP_ACCESS_TOKEN` · `WHATSAPP_VERIFY_TOKEN` · `WHATSAPP_APP_SECRET` · `VAPI_API_KEY` · `VAPI_PHONE_NUMBER_ID` · `VAPI_WEBHOOK_SECRET` · `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT`

**Payments / misc:**

`STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `PUBLIC_URL` (defaults to `https://$REPL_SLUG.replit.app`)

## Architecture — Key Decisions

**Auth** (`services/auth/`): Real per-user accounts in Postgres (`users`, `user_identities`, `email_tokens`, `user_sessions`). bcrypt (cost 12), email-verify via Resend, 1-hour password-reset tokens. Social login via OAuth for Google/Facebook/Microsoft. 30-day rolling session cookie (`infogenie.sid`, HttpOnly, SameSite=Lax). First signup auto-becomes `is_owner=TRUE`. API gate accepts session OR `INFOGENIE_API_KEY` for programmatic clients.

**Credential Vault** (`services/credentials/vault.js`): AES-256-GCM per-`(user_id, platform)` store. `resolveGoogleAdsCredentials(uid)` returns vault creds for that user or env-var fallback only for owners/cron. Smoke test: `GET /api/credentials/google-ads/test`.

**Platform vs User keys** (`services/credentials/platform_keys.js`): Platform-owned API keys (the ones InfoGenie pays for on behalf of every tenant — OpenAI, Anthropic, Gemini, Perplexity, Cloudflare, DataForSEO, Firecrawl, Apollo, Zernio, BuiltWith, PageSpeed, Google Search, Resend, Amplitude, Stripe, VAPID) live in the **non-tenant-scoped** `platform_api_keys` table (`key_name` PK, encrypted via vault). At boot, `hydrate()` overlays DB values onto `process.env` (incl. aliases) so DB overrides env; `_rebuildAiClients()` then rebuilds the shared `openai`/`anthropic` clients. Managed admin-only via the **🔑 Platform APIs** tab → `GET/PUT /api/admin/platform-keys` (audit `platform_key_updated`, actor + key_name, never the value). These keys are purged from per-user Settings; non-admins hitting `/api/settings/api-key` for a blocklisted key get 403. User-managed integrations (their own Semrush/Shopify/etc. subscriptions) stay in the vault + user Settings.

**Permission Matrix** (`services/tenants/permission_matrix.js` + `permission_enforce.js`): Single source of truth mapping (a) every protected API route group → its required permission key (`view` for reads, `write` for POST/PUT/PATCH/DELETE) and (b) every app component/`data-view` → its permission (the menu task consumes `COMPONENT_MATRIX`). `enforceMatrix` is mounted once in `server.js` right after the auth gate (before `/api/admin`), looks each authenticated `/api/` request up in the matrix, and enforces it via `req.can()`/`req.permissions` (set by `loadTenantContext`). Platform owner/admin bypass via the shared `isPlatformAdmin()` — the Admin Portal reuses the **same** helper (no bespoke check). Rollout flag `PERMISSION_ENFORCEMENT` mirrors `MULTITENANT_ENFORCEMENT`: `off` (kill-switch) · `shadow` (**default** — logs+counts would-be denials but allows) · `on` (strict 403). **Flip to `on`** by setting `PERMISSION_ENFORCEMENT=on` once shadow traffic shows no false denials. Unmapped paths are allowed but logged so the matrix can be completed. Observability: owner-only `GET /api/_debug/permissions` (mode, allow/deny/shadow/unmapped counters, would-be denials per key, recent denial samples — actor id + route + key only, never bodies/secrets). To gate a new router: add a `{ prefix, view, write }` entry to `ROUTE_GROUPS` (keys must exist in `permissions.js`; the test asserts this).

**Google Ads OAuth** (`services/google_ads_oauth/`): Per-user OAuth connect → vault. Redirect URI to whitelist: `${PUBLIC_URL}/api/integrations/google-ads/oauth/callback`.

**AI Pattern** (all tiers): strict-JSON LLM prompt → `/^_DUMMY/i` key gate → template fallback → Postgres persist → `_escapeHtml`/`_safeUrl` frontend builder.

**Optimizer**: Hourly ad-insight ingest · 6-hour pause/scale rules · 12-hour bandit reallocation · 24-hour creative refresh. Dry-run by default; flip LIVE in Grow → AI Optimizer.

**Campaign Launch**: Auto-registers in Optimizer with `optimizer_enabled=TRUE`. Without platform creds, lands as `platform_camp_id='local_<ts>'` — visible immediately, real ID used once creds connected.

**Dynamic Audiences**: 4-phase pipeline — rule builder → 15-min sweep cron → Drip email bind → HubSpot Static List mirror. Mutations gated by `global._dripStore.lock`.

**Journey Builder**: `trigger/wait/condition/action` nodes. Runner ticks every 60s. Signal triggers (`fireSignal()`) bridge real events into journey enrolment.

**Brand Foundation**: Singleton (`brand_foundation` table, id=1). `getBrandContextBlock()` auto-injected into landing pages, content calendar, cold email, video scripts, Creator Studio.

**Field Enhancer** (`ig_field_enhancer.js`): MutationObserver adds AI Suggest + brand pill to every eligible input. Scans only newly-added nodes via `requestAnimationFrame` (never full-document re-scan). Skips auth forms, password/file/search inputs, already-decorated fields. Cache-busted as `?v=20260521REL1`.

**Multitenant** (`services/tenants/`): All feature data is tenant-scoped via `tenant_id` columns (113/114 tables NOT NULL; `roles` intentionally nullable for global system roles). Enforcement flag `MULTITENANT_ENFORCEMENT` runs in three modes: `off` (Phase 1 legacy), `shadow` (warn but allow fallback — used during rollout to spot gaps), `on` (strict — `resolveTenantId` returns null with no fallback, callers 4xx). **Currently `on` in production.** Routes use `const tid = await _tenantCtx.resolveTenantId(req, {label:'svc:op'})`; cookie sessions get `req.tenant` from `loadTenantContext` middleware, api-key callers get it from `_injectApiKeyAuth` in `server.js` (which runs BEFORE the public-path bypass so tenant-bound public routes like `/api/optimizer/status` get correct scoping). Crons/background jobs call `getCronTenantId()` directly. Default tenant = first active tenant created by the owner (cached 60s). Observability via owner-only `GET /api/_debug/multitenant` (mode, defaultTenantId, api-key hit/miss counters, current request snapshot). To add a new tenant-scoped table: include `tenant_id INT NOT NULL REFERENCES tenants(id)` in schema, add `WHERE tenant_id=$1` to every read, and call `resolveTenantId(req, {label})` at the top of every route handler — never use `allowFallback:true` (removed everywhere in Phase 2F as part of the enforcement-on flip).

## Feature Surface (T1-T38)

See `docs/tiers.md` for the full index. High-level areas:

- **Compete**: Competitor profiles · Battle Cards/Plan · AI Attack Plan · SOV · Ad Library Spy · Ad Swipe File · Question Mining · Win/Loss Intel
- **Grow**: Campaign Launch · AI Optimizer (MAB + creative refresh) · CRO Lab · Landing Pages · Link-in-Bio · Booking Pages
- **Reach**: Dynamic Audiences · Journey Builder · Omnichannel Composer · Drip Engine · Re-engagement Agent · Conversation Inbox
- **Manage**: Brand Foundation · Brand Calendar · Budget Board · Marketing Projects · 7-Day Playbook · Ask InfoGenie · Infographic Generator · Heatmaps · AI Providers · Web Analytics · Signal Triggers
- **Creator Studio**: AI Video (storyboard → frames → MP4) · Social Content · Short-form Video Scripts
- **SEO**: GEO Audit · Content Scorer · Keyword-Page Map · Internal Link Suggester · On-Page Audit · Multi-page Crawler · SERP Tracker

## User Preferences

- Non-technical — plain language, execute over options.
- Counter-Message modal: 🚀 Launch Now pre-fills Campaign Brief + sets `window._counterTarget`.
- **Task scoping** — When scoping a task, do a wider "implications sweep" first and fold the obvious derivatives into the same task rather than emitting a thin task plus follow-ups. Cover: the obvious next ask (e.g. ship automation/schedule + all alert channels with a feature, not just the manual trigger), adjacent surfaces sharing the same pattern, persistence/durability (migrations, tenant scoping, backfill), the verification test/guard, edge cases & failure handling, and security/privacy. Prefer fewer, more complete tasks. Still split work that parallel agents would collide on or that's too large to execute reliably in one go, and name any deliberately-deferred follow-ups in the plan's scope section (in-scope vs. deferred) instead of surfacing them after delivery.

## Gotchas

- **Resend domain**: `RESEND_FROM_EMAIL` must be a verified Resend domain — unverified domains silently fail. Use `onboarding@resend.dev` for testing.
- **SSRF guards**: All external URL fetches are strictly guarded.
- **Rate-limit IPs**: Public embed routes (T23, T27) use `req.socket.remoteAddress` — NOT `req.ip` (XFF-spoofable).
- **GA/GSC**: Parked — Google Workspace org policy blocks OAuth.
- **Ad platform creds**: Cross-Channel Report requires real Meta/Google/TikTok credentials.
- **T35 index error**: `[t35] init failed: functions in index expression must be marked IMMUTABLE` — known, non-blocking.
- **Multitenant enforcement is ON**: Any new tenant-scoped table or route MUST resolve tenant via `resolveTenantId(req, {label})` (no `allowFallback`). Forgetting this causes a 400 `no_tenant` for api-key callers or null-tenant queries — visible immediately in `/api/_debug/multitenant` as a rising `miss` counter.

## Docs

[DataForSEO](https://dataforseo.com/apis) · [OpenAI](https://platform.openai.com/docs/api-reference) · [Anthropic](https://docs.anthropic.com/en/api/) · [Resend](https://resend.com/docs/api-reference) · [HubSpot](https://developers.hubspot.com/docs/api/overview) · [Firecrawl](https://firecrawl.dev/docs/api-reference) · [Perplexity](https://docs.perplexity.ai/docs/getting-started) · [Gemini](https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-gemini) · [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) · [Chart.js](https://www.chartjs.org/docs/latest/) · [Amplitude](https://amplitude.com/)
