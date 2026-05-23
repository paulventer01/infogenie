# InfoGenie

AI-powered marketing intelligence and campaign automation platform — competitor analysis, ad campaigns, SEO/content, lead management, omnichannel outreach.

## Run

```
node server.js
```

Listens on port 5000 (preview) and 80 (external). PostgreSQL via `DATABASE_URL`. JSON files in `data/` auto-migrate to `kv_store` at boot.

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
| `app.js` | Frontend logic (~47k lines) |
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
