# InfoGenie — Integrations & Tools Reference

> **Last updated:** September 2026
> Covers every API, LLM, OAuth flow, AI provider, data source, and third-party tool wired into InfoGenie, with status for each.

---

## Status legend

| Symbol | Meaning |
|--------|---------|
| ✅ **Integrated** | Live in production — backend service + React UI + nav entry |
| ⚙️ **Backend only** | API wired in server, no dedicated React panel (consumed internally by other features) |
| 🔑 **Key referenced** | Env var exists in codebase but no dedicated service module |
| ❌ **Not integrated** | Identified as valuable, not yet built |

All **✅ integrated** services whose keys are optional (not required to boot) show a yellow "not configured" banner in the UI and degrade gracefully when the key is absent. Keys are managed via **Manage → Platform APIs** (admin-only, AES-256-GCM encrypted at rest).

---

## 1 · AI Models & LLMs

### 1.1 Integrated providers

| Provider | Env var(s) | Models used | Status | Used for |
|----------|-----------|-------------|--------|----------|
| **OpenAI** | `AI_INTEGRATIONS_OPENAI_API_KEY` | GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo, GPT-5, GPT-5-mini, gpt-image-1 | ✅ | Ad copy, battle cards, cold email, blog content, strategy, image generation (DALL·E / gpt-image-1), chatbot |
| **Anthropic Claude** | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | claude-sonnet-4-6, claude-opus-4-5, claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022, claude-3-haiku-20240307 | ✅ | Long-form competitive analysis, SEO audits, deep research tasks, content calendar |
| **Google Gemini** | `GEMINI_API_KEY` | gemini-2.5-flash, gemini-2.0-flash-001, gemini-1.5-pro, gemini-1.5-flash, gemini-vision (multimodal) | ✅ | Creative content, multimodal analysis, GEO audit, social content, infographic generation |
| **Perplexity** | `PERPLEXITY_API_KEY` | llama-3.1-sonar-small-128k-online | ✅ | Live web-grounded research — competitor news, real-time market signals, trend monitoring |
| **Cloudflare Workers AI** | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_TOKEN` | @cf/meta/llama-3.1-8b-instruct, @cf/meta/llama-3 | ✅ | Low-latency on-demand inference, fallback LLM for market signals |
| **RapidAPI (Meta Llama)** | `RAPIDAPI_KEY` | Meta Llama 3.2 Vision (via RapidAPI host) | ✅ | Vision-capable LLM fallback, keyword research endpoint (keyword-research-for-seo) |
| **DeepSeek** | `DEEPSEEK_API_KEY` | deepseek-chat | ⚙️ | Referenced in model-compare and ai_compat — available as selectable model; no dedicated UI panel |

### 1.2 LLM routing & compatibility layer

`ai_compat.js` is the central normalization layer. It patches the OpenAI SDK and intercepts all fetch/http calls to:
- Normalize `gpt-5*` reasoning models → `max_completion_tokens` (not `max_tokens`), strip `temperature`/`top_p`, add `reasoning_effort: 'minimal'`
- Route Llama calls through RapidAPI when Cloudflare is unavailable
- Enforce the strict-JSON → `/^_DUMMY/i` gate → template-fallback pattern used by all 119+ tiers

### 1.3 Not yet integrated

| Provider | Notes |
|----------|-------|
| **Mistral** | No env var or service module |
| **Cohere** | No env var or service module |
| **xAI Grok** | No env var or service module |
| **OpenAI o1/o3** | Reasoning models — partial support via ai_compat normalization; no explicit tier routing |

---

## 2 · OAuth Flows

| Flow | Provider | Env vars | Scope | Status |
|------|----------|----------|-------|--------|
| **Social Login — Google** | Google OAuth 2.0 | `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | `openid email profile` | ✅ — Login page, first signup auto-becomes owner |
| **Social Login — Facebook** | Meta OAuth | `AUTH_FACEBOOK_CLIENT_ID`, `AUTH_FACEBOOK_CLIENT_SECRET` | `email` | ✅ — Login page |
| **Social Login — Microsoft** | Azure AD OAuth | `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET` | `openid email profile` | ✅ — Login page |
| **Google Ads per-user connect** | Google Ads API OAuth | `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET` | `https://www.googleapis.com/auth/adwords` | ✅ — Per-user vault; callback `/api/integrations/google-ads/oauth/callback` |
| **Meta Ads per-user connect** | Meta Graph API | `META_OAUTH_CLIENT_ID`, `META_OAUTH_CLIENT_SECRET` | `ads_management ads_read` | ✅ — Per-user vault; callback `/api/integrations/meta-ads/oauth/callback` |
| **Google Workspace** | Google OAuth 2.0 | `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET` | Gmail + Drive + Calendar | ✅ — Per-user vault; callback `/api/integrations/workspace/oauth/callback`; vault key `google_workspace` |

> **Note:** Google Analytics / Google Search Console OAuth is parked — blocked by Google Workspace org policy (OAuth consent screen restricted to internal users only).

---

## 3 · SEO & Search Data

| Tool | Env var | API base | Status | What it provides |
|------|---------|----------|--------|-----------------|
| **DataForSEO** | `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | `api.dataforseo.com/v3/` | ✅ | SERP results, keyword suggestions, ranked keywords, keyword difficulty, AI optimization data — used across Keyword Explorer, SEO Auditor, Crawler, SERP Tracker, GEO Audit, and Advertising Orchestrator Google research (`ads_advertisers` / `ads_search`) |
| **Google Custom Search** | `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` / `GOOGLE_SEARCH_ENGINE_ID` | `googleapis.com/customsearch/v1` | ✅ | Branded SERP visibility checks, competitor SERP monitoring |
| **Google PageSpeed / Core Web Vitals** | `GOOGLE_PAGESPEED_API_KEY` | `googleapis.com/pagespeedonline/v5/run` | ✅ | CWV scores (LCP/FID/CLS/INP), performance audits, mobile vs desktop |
| **Bing Webmaster Tools** | `BING_WEBMASTER_API_KEY` | `api.bing.com/webmaster/` | ✅ | Bing keyword performance, crawl stats, page stats — free second SEO data source |
| **Google Trends** | *(npm: google-trends-api — no key needed)* | Unofficial Google Trends scrape | ✅ | Interest over time, related/rising queries, trending now, keyword comparison — free, no key |
| **SpyFu** | `SPYFU_API_KEY` | `spyfu.com/apis` | ✅ | Competitor PPC budgets, historical keyword rankings, organic/paid keyword spy data |
| **Majestic** | `MAJESTIC_API_KEY` | `api.majestic.com/api/json` | ✅ | Trust Flow, Citation Flow, Topical Trust Flow, backlinks, referring domains (free OpenApps tier) |
| **Mangools** | `MANGOOLS_API_KEY` | `api.mangools.com/v3` + MCP `mcp.mangools.com/mcp` | ✅ | KWFinder related/competitor keywords, SiteProfiler domain metrics, keyword gap analysis, LinkMiner backlink profiles (token from mangools.com/api-token). Also connectable as Streamable HTTP MCP (`x-access-token`) via **Reach → MCP Ecosystem → Client** |
| **Semrush** | `SEMRUSH_API_KEY` | `api.semrush.com` | ✅ | Domain traffic estimate, authority score, top organic keywords, organic competitors, keyword lookup with CPC/KD |
| **Ahrefs** | `AHREFS_API_KEY` | `api.ahrefs.com/v3/` | ✅ | Domain Rating, URL Rating, backlinks with DR scores, organic keyword rankings, content gap analysis |
| **Serpstat** | `SERPSTAT_API_KEY` | `api.serpstat.com/v4/` | ✅ | Domain visibility score, keyword momentum deltas (rising/falling), competitor overlap, 230+ regional Google databases |
| **ContentKing** | `CONTENTKING_API_KEY` | `api.contentkingapp.com/v1/` | ✅ | Real-time SEO change detection (with old→new diffs), open issue tracker by severity, page health inventory |
| **SerpAPI** | `SERP_API_KEY` | `serpapi.com/search.json` | ⚙️ | Referenced in `serp_tracker` service for SERP snapshot fallback; no standalone UI panel |
| **YouTube Data API** | `YOUTUBE_DATA_API_KEY` | `googleapis.com/youtube/v3/` | ⚙️ | YouTube trending videos (`chart=mostPopular`) consumed by Trending Topics / Realtime News; no standalone panel |
| **Moz** | — | — | ❌ | DA/PA scores — not integrated |
| **SEMrush Trends** | — | — | ❌ | Market Explorer / Traffic Analytics addon — not integrated |
| **Similarweb** | — | — | ❌ | Traffic & audience intel — not integrated |
| **Searchmetrics** | — | — | ❌ | Enterprise SEO suite — not integrated |

---

## 4 · Ad Platforms

| Platform | Env vars | Auth type | Status | What it provides |
|----------|---------|-----------|--------|-----------------|
| **Google Ads** | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_MERCHANT_CENTER_ID` | OAuth 2.0 per-user + env fallback | ✅ | Campaign launch, budget management, performance ingest, AI Optimizer (MAB + bandit), Shopping campaigns, keyword planner |
| **Meta Ads (Facebook/Instagram)** | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_APP_ID/SECRET`, `META_OAUTH_CLIENT_ID/SECRET` | OAuth 2.0 per-user + env token | ✅ | Campaign launch, ad library spy, performance ingest, Cross-Channel Report |
| **TikTok Ads** | `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`, `TIKTOK_RAPIDAPI_KEY` | Bearer token | ✅ | Campaign performance ingest, TikTok downloader, ad metrics |
| **Microsoft Advertising (Bing Ads)** | `MICROSOFT_ADS_CLIENT_ID/SECRET`, `MICROSOFT_ADS_DEVELOPER_TOKEN`, `MICROSOFT_ADS_ACCOUNT_ID`, `MICROSOFT_ADS_CUSTOMER_ID`, `MICROSOFT_ADS_REFRESH_TOKEN` | OAuth 2.0 | ✅ | Campaign performance ingest, Microsoft Ads Insights panel |
| **LinkedIn Ads** | *(via platform token)* | Bearer | ✅ | LinkedIn Ads Insights panel, B2B campaign performance |
| **Pinterest Ads** | — | — | ❌ | Not integrated |
| **Snapchat Ads** | — | — | ❌ | Not integrated |
| **Amazon Ads** | — | — | ❌ | Not integrated |
| **Twitter/X Ads** | — | — | ❌ | Not integrated |
| **Connected TV (CTV)** | — | — | ⚙️ | CTV service module exists (`services/ctv/`); no live ad platform connected |

### 4.1 Meta research connector (`meta_research`)

Competitor-ad research over the official Meta Ad Library Graph `ads_archive` endpoint. Used by Advertising Orchestrator research runs (`/api/agent-orchestrator/research`) — not a new API prefix.

| Item | Value |
|------|--------|
| **Module** | `services/agent_orchestrator/connectors/meta_research.js` |
| **Host allowlist** | `graph.facebook.com` only |
| **Path** | `/{GRAPH_VERSION}/ads_archive` (`v21.0`, or `META_GRAPH_API_VERSION` if it matches `/^v\d{1,2}\.\d{1,2}$/`) |
| **Auth** | Tenant vault `meta_ads` via opaque `credential_ref` → `Authorization: Bearer`. Token never in the URL, query, logs, evidence, or cursors |
| **Required params** | `search_terms` (from `search_parameters.query`, ≤500), `ad_reached_countries` (≤20 codes), `ad_type=ALL`, `ad_active_status=ALL`, allowlisted `fields`, `limit` 1–100 |
| **Optional** | `lookback_days` 1–365 → `ad_delivery_date_min`/`max`; bound `after` cursor (never `paging.next`) |
| **Permissions** | Meta Ad Library / ads_read. 401/190/102 → `auth_failure`; 403/10/200/294 → `policy_rejection` |
| **Limits** | Transport timeout 8s; body cap 256KiB; Retry-After honoured (capped 30s) by the research runtime |
| **Honesty** | Live pages stamp `provider_metrics.source=live` (no `_fabricated`). Fixture/synthetic still uses the canned adapter |
| **Live smoke** | `INFOGENIE_LIVE_META_RESEARCH=1` plus `INFOGENIE_LIVE_META_RESEARCH_TOKEN`. Skips when unset. Never prints the token |

Do not request demographic targeting, bylines, emails, phones, profiles, or comments. Creatives are not downloaded (`assets` stays empty). Source URLs are syntactic Ad Library links (`https://www.facebook.com/ads/library/?id=…`) and are not fetched.

#### Meta provider-draft credential reference (PR 6F-0) — reference only

PR 6F-0 adds a tenant-owned Meta credential **reference** boundary in `services/credentials/vault.js` (`resolveTenantMetaCredentialRefForProviderDraft`, `withTenantMetaCredentialForProviderDraft`) alongside a frozen, single-use, short-lived `create_provider_draft` capability in `services/security/advertising_provider_capabilities.js`.

**This is not a live provider mutation.** There is no Meta Graph call, no SDK, no OAuth refresh, no token read and no vault decrypt in PR 6F-0. `isAdvertisingProviderMutationAllowed()` still returns `false`, so every provider write — including creating a paused campaign — remains hard-denied. The boundary reads `orchestrator_tenant_meta_credential_refs`, which stores metadata only (platform, `environment IN ('test','sandbox')`, status, 64-hex account fingerprint, version, owner) and holds no ciphertext, token or ad-account id. Production ad accounts are unreachable through it. The reference handed to callers carries `has_secret_access: false` and refuses serialization. Details and open items: `docs/security-guardrails.md` → “Advertising orchestrator — Meta provider-draft capability (PR 6F-0)”.

### 4.2 Google research connector (`google_research`)

Competitor-ad research over DataForSEO’s documented Google Ads Transparency APIs. Google has no official commercial Ads Transparency Center API — this connector does **not** call `adstransparency.google.com`, scrape HTML, or use browser automation. Used by Advertising Orchestrator research runs (`/api/agent-orchestrator/research`) — not a new API prefix.

| Item | Value |
|------|--------|
| **Module** | `services/agent_orchestrator/connectors/google_research.js` |
| **Host allowlist** | `api.dataforseo.com` only (`adstransparency.google.com` is refused for fetch) |
| **Paths** | `POST /v3/serp/google/ads_advertisers/live/advanced` (first page) then `POST /v3/serp/google/ads_search/live/advanced` |
| **Auth** | Platform keys `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` → `Authorization: Basic`. Tenant vault `google_ads` via `credential_ref` is the actor gate only — Google Ads OAuth / `ctx.token` is never sent upstream. Dummy `/^_DUMMY/i` or missing keys fail closed (`auth_failure` / `missing_credentials`) with no transport |
| **Required params** | `search_parameters.query` (≤500). Missing → `policy_rejection` `search_query_required`. Advertiser resolve uses `keyword`; ads search uses collected `advertiser_ids` (max 25) or `target` when the query looks like `example.com` |
| **Optional** | Countries ≤20 mapped through a fixed ISO→`location_code` table (US/GB/CA/AU/DE/FR); unknown codes omit `location_code`. `lookback_days` 1–365 → `date_from`/`date_to` (min 2018-05-31). `max_results_per_page` 1–100, DataForSEO `depth` capped at 40 |
| **Pagination** | Bound continuation `{v:1,t,r,a}` (tenant + run + advertiser ids / page). Later pages are ads_search only. Same first `creative_id` as the previous page → `invalid_response` `repeated_continuation_token`. ATC `url` / `preview_url` / `preview_image` are never fetched |
| **Errors** | HTTP 401 / DataForSEO 401xx → `auth_failure` `provider_auth_rejected`. 403 / payment-required → `policy_rejection`. 429 / 40202 / 40501 → `rate_limit` (Retry-After honoured). 408/timeout → transient. 5xx / 50000+ → transient. 400/validation → `invalid_response`. Auth/validation are not retried |
| **Honesty** | Live pages stamp `provider_metrics.source=live` (no `_fabricated`). Empty live results stay live — never substitute the fixture page. ATC source URLs are syntactic HTTPS refs only |
| **Limits** | Transport timeout 8s; body cap 256KiB; one JSON task per POST |
| **Live smoke** | `INFOGENIE_LIVE_GOOGLE_RESEARCH=1` plus real (non-dummy) `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD`. Skips when unset. Never prints secrets |

Do not request targeting of individuals, emails, phones, or profiles. Creatives are not downloaded (`assets` stays empty). Live mode never falls back to fixtures on empty or error results.

### 4.3 TikTok research connector (`tiktok_research`)

Competitor-ad research over the official TikTok Commercial Content Library (Ad Library) API. Used by Advertising Orchestrator research runs (`/api/agent-orchestrator/research`) — not a new API prefix. This connector does **not** scrape `library.tiktok.com`, call the Marketing API (`business-api.tiktok.com`), download creatives, or use RapidAPI scrapers.

| Item | Value |
|------|--------|
| **Module** | `services/agent_orchestrator/connectors/tiktok_research.js` |
| **Host allowlist** | `open.tiktokapis.com` only (`library.tiktok.com` and `business-api.tiktok.com` are refused for fetch) |
| **Path** | `POST /v2/research/adlib/ad/query/` with allowlisted `fields` only |
| **Auth** | Dual gate (same shape as Google/DataForSEO). **Actor:** tenant vault `tiktok_ads` via opaque `credential_ref` (`ctx.token`) — required; dummy `/^_DUMMY/i` or missing actor token fails closed (`auth_failure` / `missing_credentials`) with **zero hops**. **Wire:** `process.env.TIKTOK_RESEARCH_CLIENT_TOKEN` only — a Commercial Content API client access token (`clt.…` from TikTok `client_credentials`, not a Marketing API / Ads Manager user token). Must be non-empty and not dummy. Sent as `Authorization: Bearer`. The vault actor token is **never** sent upstream. Missing/dummy platform token fails closed with zero hops even if the vault token is present. Neither token is logged or persisted. This PR does not exchange `client_key`/`client_secret` live |
| **Required params** | `search_parameters.query` (contract ≤500) → vendor `search_term` clipped to **50**. Missing query → `policy_rejection` `search_query_required`. Capability is `public_profile` only. `filters` is always sent. `filters.ad_published_date_range` is **required** (`YYYYMMDD`); default lookback **30** days; `min` clamped to **20221001** (docs: after 2022-10-01) |
| **Optional** | Exactly one ISO country → `filters.country_code`; 0 or many countries omit the vendor geo filter (do not invent). `max_results_per_page` 1–100, vendor `max_count` default **10**, maximum **10** |
| **Fields** | Query `fields` allowlist only: `ad.id,ad.first_shown_date,ad.last_shown_date,ad.status,ad.videos,ad.image_urls,advertiser.business_id,advertiser.business_name`. Do not request `ad.title`, `ad.external_url`, `advertiser.country_code`, `ad.reach`, targeting, ages, gender, or `ad_group.targeting_info`. `ad.status` is not persisted as a metric |
| **Format detection** | Non-empty `ad.videos` → `source_type: public_video`, `creative_format: video`. Else non-empty `ad.image_urls` → `ad_creative` / `image`. Else → `ad_creative` / `unknown`. Never infer `public_video` without videos. `ad.videos` / `ad.image_urls` are presence-only; URLs are never fetched or persisted |
| **Pagination** | Bound continuation `{v:1,t,r,s,f}` (tenant + run + `search_id` + first ad id). `search_id` is sent on page 2+ only. Same `search_id` rebound or same first ad id → `invalid_response` `repeated_continuation_token`. Provider next URLs and `library.tiktok.com` are never fetched |
| **Errors** | HTTP 401 / vendor auth codes → `auth_failure` `provider_auth_rejected`. 403 / permission / scope → `policy_rejection`. 429 / rate messages → `rate_limit` (Retry-After honoured). 408/timeout → transient. 5xx → transient. 400/validation → `invalid_response`. Auth/validation are not retried |
| **Honesty** | Live pages stamp `provider_metrics.source=live` (no `_fabricated`). Empty live results stay live — never substitute the fixture page. Canonical source URLs are syntactic (`https://library.tiktok.com/ads?id=…` / `?advertiser=…`) and are not fetched. Live `assets` is always `[]` |
| **Limits** | Transport timeout 8s; body cap 256KiB |
| **Live smoke** | `INFOGENIE_LIVE_TIKTOK_RESEARCH=1` plus a non-dummy `INFOGENIE_LIVE_TIKTOK_RESEARCH_TOKEN` **or** `TIKTOK_RESEARCH_CLIENT_TOKEN`. Skips when unset. Never prints tokens |

Do not request targeting, emails, phones, profiles, comments, follower counts, reach, or `ad_group.targeting_info`. Do not fetch `ad.videos` media, `image_urls`, or `download_url`. Live mode never falls back to fixtures on empty or error results.

### 4.4 Google Ads paused-draft connector (`google_ads_paused_draft`)

Narrow mutate-only connector for PAUSED, non-serving Google Ads draft objects. Used by the advertising orchestrator provider-operation path — not a new API prefix, vault read, or settle authority.

| Item | Value |
|------|--------|
| **Module** | `services/agent_orchestrator/connectors/google_ads_paused_draft.js` |
| **Host allowlist** | `googleads.googleapis.com` only |
| **Path** | `POST /v17/customers/{id}/googleAds:mutate` |
| **Shape** | One frozen create of campaign budget + SEARCH campaign + ad group. `status` is always `PAUSED`. No update/remove/promote, no `ENABLED`/`SERVING`, no start/end, no optimize, no budget increase |
| **Idempotency** | Substrate `provider_operation_key` + `idempotency_key` stamped on the request and echoed on the result. Connector never retries |
| **Auth** | Caller-supplied access + developer token for the live path only. Tokens, customer ids, and decrypted values are never logged or returned |
| **Default** | Injected `mutate` client. Live Google requires `allowLive: true` **and** `INFOGENIE_LIVE_GOOGLE_ADS_PAUSED_DRAFT=1`. Default tests never set this |
| **Errors** | Provider 4xx / explicit error → determinate `provider_create_failed`. Timeout / 5xx / transport / malformed success → `provider_outcome_unknown` requiring reconciliation. No blind retry |

This connector does not settle `orchestrator_google_ads_provider_draft_operations`, resolve vault secrets, or mount HTTP.

### 4.5 Google Ads paused-draft reconciliation observer

Read-only ledger-bound GAQL Search observer for PAUSED Google Ads draft objects. Its separate host-allowlisted transport shares nothing with the write connector and can call Search only — never mutate or another provider RPC.

| Item | Value |
|------|--------|
| **Module** | `services/agent_orchestrator/connectors/google_ads_paused_draft_reconciliation_observer.js` |
| **Host allowlist** | `googleads.googleapis.com` only |
| **Path** | `POST /v17/customers/{id}/googleAds:search` with internally generated, ledger-bound GAQL; fixed fields (`status`, `resource_name`, parent links) and `LIMIT 1` |
| **Shape** | One Search per ledger kind (`campaign_budget`, `campaign`, `ad_group`). No retry. Sanitized observations; `serving` is always false. Does not evaluate `verified` |
| **Auth** | Caller-supplied access + developer token (optional `login-customer-id`). Tokens, raw customer ids, and request URLs never appear in the result |
| **Default** | Injected `transport`. Live Google requires `allowLive: true` **and** `INFOGENIE_LIVE_GOOGLE_ADS_RECONCILIATION=1`. Default tests never set this. Does not reuse `INFOGENIE_LIVE_GOOGLE_ADS_PAUSED_DRAFT` |
| **Scope** | Not a new API prefix. Does not settle operations or read the vault |

---

## 5 · Data & Intelligence

| Tool | Env var | Status | What it provides |
|------|---------|--------|-----------------|
| **Firecrawl** | `FIRECRAWL_API_KEY` | ✅ | Full-site crawler, markdown extraction — used by SEO Crawler, Competitor Detect, Tech Stack, Pricing Watch |
| **Apollo.io** | `APOLLO_API_KEY` | ✅ | B2B contact & company enrichment, lead finder, prospect lists |
| **BuiltWith** | `BUILTWITH_API_KEY` | ✅ | Tech stack detection for any domain — used in Tech Stack panel |
| **Zernio** | `ZERNIO_API_KEY` | ✅ | Social publishing, content distribution |
| **Hunter.io** | `HUNTER_API_KEY` | ✅ | Email finder & verifier — used in Lead Finder, Cold Email |
| **Modash** | `MODASH_API_KEY` | ✅ | Influencer discovery — follower counts, engagement rates, audience quality (IG/TikTok/YouTube) |
| **Apify** | `APIFY_API_KEY` | ⚙️ | Web scraping actors — used internally for advanced crawl tasks; no standalone panel |
| **Profound** | `PROFOUND_API_KEY` | ⚙️ | LLM brand-mention tracking — wired via `services/external_connectors/`; no standalone UI |
| **Remove.bg** | `REMOVE_BG_API_KEY` | ✅ | Background removal for brand assets and creative images |
| **Google Service Account** | `GOOGLE_SERVICE_ACCOUNT_JSON` | ⚙️ | Server-to-server Google API auth for Sheets, Drive, GA4 — used where per-user OAuth not needed |
| **Clearbit** | — | ❌ | Company enrichment — not integrated |
| **Crunchbase** | — | ❌ | Funding & company data — not integrated |
| **PitchBook** | — | ❌ | Investor/company data — not integrated |

---

## 6 · Messaging & Communication

| Tool | Env vars | Status | What it provides |
|------|---------|--------|-----------------|
| **Resend** | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` | ✅ | Transactional email (auth, reset, verify), broadcast campaigns, Drip Engine, email sequences |
| **Twilio SMS** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | ✅ | SMS outreach, omnichannel messaging — Omnichannel Composer |
| **WhatsApp Business** | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | ✅ | WhatsApp messaging channel — Journey Builder, Omnichannel Composer |
| **Vapi (AI Voice)** | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_SECRET` | ✅ | AI voice calls — Voice Caller feature, outbound AI-powered phone campaigns |
| **Web Push (VAPID)** | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | ✅ | Browser push notifications — Journey Builder, Re-engagement Agent |
| **Slack** | `SLACK_WEBHOOK_URL` / `SLACK_WEBHOOK` | ✅ | Internal alert routing — system alerts, weekly digest, optimizer events |
| **RCS (Rich Communication Services)** | *(via carrier)* | ⚙️ | Service module exists (`services/rcs/`); no active carrier integration |
| **Telegram** | — | ❌ | Not integrated |
| **Discord** | — | ❌ | Not integrated |
| **Mailchimp** | `MAILCHIMP_API_KEY`, `MAILCHIMP_SERVER_PREFIX` | 🔑 | Env vars referenced but no dedicated service module or UI panel |
| **ActiveCampaign** | `ACTIVECAMPAIGN_API_KEY`, `ACTIVECAMPAIGN_BASE_URL` | 🔑 | Env vars referenced but no dedicated service module or UI panel |
| **ConvertKit** | `CONVERTKIT_API_KEY` | 🔑 | Env var referenced but no dedicated service module or UI panel |

---

## 7 · CRM & Sales

| Tool | Env vars | Status | What it provides |
|------|---------|--------|-----------------|
| **HubSpot** | `HUBSPOT_PRIVATE_APP_TOKEN`, `HUBSPOT_WEBHOOK_SECRET` | ✅ | CRM sync, Static List mirror for Dynamic Audiences, contact enrichment, deal tracking |
| **Shopify** | `SHOPIFY_SHOP`, `SHOPIFY_ADMIN_TOKEN` | ⚙️ | Shopify product/order data — wired in `services/external_connectors/`; consumed by revenue intel features |
| **Salesforce** | — | ❌ | Not integrated |
| **Pipedrive** | — | ❌ | Not integrated |
| **PostHog** | `POSTHOG_API_KEY` | 🔑 | Env var referenced for product analytics; no dedicated service or UI |

---

## 8 · Analytics & Measurement

| Tool | Env vars | Status | What it provides |
|------|---------|--------|-----------------|
| **Amplitude** | `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY` | ✅ | Product analytics ingestion, cohort analysis, amplitude-driven journey signals, AI Agents panel |
| **Google Analytics 4** | *(via Google Service Account)* | ⚙️ | GA4 data surface exists in Web Analytics panel; full OAuth blocked by org policy |
| **Google Search Console** | *(via Google Service Account)* | ⚙️ | GSC data wired in SEO features; full OAuth blocked by org policy |
| **AppsFlyer** | `APPSFLYER_API_TOKEN`, `APPSFLYER_APP_ID` | ⚙️ | Mobile attribution — wired via `services/external_connectors/`; no standalone UI |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ✅ | Billing & subscription management; revenue data fed into ROI Ledger and True ROAS |
| **Mixpanel** | — | ❌ | Not integrated |
| **Segment** | — | ❌ | Not integrated |
| **Heap** | — | ❌ | Not integrated |

---

## 9 · Content & Creative Tools

| Tool | Env vars | Status | What it provides |
|------|---------|--------|-----------------|
| **OpenAI DALL·E / gpt-image-1** | `AI_INTEGRATIONS_OPENAI_API_KEY` | ✅ | AI image generation — Ad Creative Studio, Infographic Generator, Creator Studio, Social Content |
| **Google Gemini Vision** | `GEMINI_API_KEY` | ✅ | Multimodal image analysis — brand asset review, visual ad scoring |
| **Meta Llama 3.2 Vision (RapidAPI)** | `RAPIDAPI_KEY` | ✅ | Vision-capable analysis as LLM fallback |
| **Remove.bg** | `REMOVE_BG_API_KEY` | ✅ | Background removal for brand assets |
| **Canva (Bridge)** | *(OAuth — not configured)* | ⚙️ | Service exists (`services/canva_bridge/`) — OAuth bridge to Canva designs; key not yet required |
| **ElevenLabs** | — | ❌ | AI voiceover / text-to-speech — not integrated |
| **Runway / Kling** | — | ❌ | AI video generation — not integrated |
| **Midjourney** | — | ❌ | Not integrated (no public API) |
| **Stability AI** | — | ❌ | Image generation alternative — not integrated |

---

## 10 · Social & Community Listening

| Tool | Env vars | Status | What it provides |
|------|---------|--------|-----------------|
| **Reddit (public API)** | *(no key — rate limited)* | ✅ | Reddit Pulse — subreddit monitoring, brand mention tracking, sentiment |
| **Twitter/X (public scrape)** | — | ⚙️ | Twitter Pulse — tweet monitoring; official API v2 not connected (cost barrier) |
| **YouTube Data API** | `YOUTUBE_DATA_API_KEY` | ⚙️ | YouTube trending data + comment mining (YT Comment Miner); consumed by Trending Topics |
| **Glassdoor (scrape)** | — | ⚙️ | Glassdoor Sentiment — web scrape of public reviews; no API key |
| **Modash** | `MODASH_API_KEY` | ✅ | Influencer audience data for IG/TikTok/YouTube |
| **Quora (scrape)** | — | ⚙️ | Quora Mining — public Q&A scrape; no API key |
| **Brandwatch** | — | ❌ | Enterprise social listening — not integrated |
| **Mention** | — | ❌ | Not integrated |
| **Sprout Social** | — | ❌ | Not integrated |

---

## 11 · Infrastructure & Platform

| Tool | Env vars | Status | Purpose |
|------|---------|--------|---------|
| **PostgreSQL** | `DATABASE_URL` | ✅ | Primary database — all feature data, sessions, tenants, kv_store |
| **Resend** | `RESEND_API_KEY` | ✅ | Transactional email (auth flows, drip, broadcast) |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ✅ | Billing |
| **Amplitude** | `AMPLITUDE_API_KEY` | ✅ | Product analytics |
| **Slack** | `SLACK_WEBHOOK_URL` | ✅ | Internal alerting |
| **VAPID / Web Push** | `VAPID_*` | ✅ | Browser push notifications |
| **Next.js 15 (App Router)** | — | ✅ | React frontend, new auth pages, SPA shell; Express proxied behind Next in dev + prod |
| **Express.js** | — | ✅ | All `/api/*` routes, legacy SPA serving, session management |
| **bcrypt (cost 12)** | — | ✅ | Password hashing |
| **AES-256-GCM vault** | `CREDENTIAL_ENCRYPTION_KEY` | ✅ | Per-user credential vault (OAuth tokens, per-user API keys) |
| **Redis** | — | ❌ | Not integrated — in-memory caching used instead |
| **Sentry / error tracking** | — | ❌ | Not integrated |
| **Cloudflare (CDN/DNS)** | — | ❌ | Not used (hosted on Replit) |

---

## 12 · Features That Still Need Integration

The following are either referenced in the codebase without a working integration, or identified as high value but not yet built:

### Keys exist — service not built
| Key | Tool | Effort | Priority |
|-----|------|--------|----------|
| `MAILCHIMP_API_KEY` | Mailchimp email platform | Medium | Medium — CRM sync, list import |
| `ACTIVECAMPAIGN_API_KEY` | ActiveCampaign automation | Medium | Medium — competitor to HubSpot |
| `CONVERTKIT_API_KEY` | ConvertKit (creator email) | Low | Low |
| `POSTHOG_API_KEY` | PostHog product analytics | Medium | Medium — open source Amplitude alt |
| `DEEPSEEK_API_KEY` | DeepSeek Chat | Low | Low — model already in ai_compat |

### No key yet — high/medium priority
| Tool | API | Priority | What it would add |
|------|-----|----------|-------------------|
| **Similarweb** | `api.similarweb.com` | High | Traffic & audience demographics for any domain |
| **Moz** | `moz.com/api` | High | Domain Authority / Page Authority (DA/PA) — industry-standard metric |
| **SEMrush Trends** | *(Semrush addon)* | Medium | Market Explorer, Traffic Analytics addon |
| **Brandwatch** | `api.brandwatch.com` | Medium | Enterprise social listening & sentiment |
| **Clearbit** | `clearbit.com/docs` | Medium | Company & person enrichment at scale |
| **Salesforce** | `api.salesforce.com` | Medium | CRM sync alternative to HubSpot |
| **Pipedrive** | `api.pipedrive.com` | Low | Sales CRM for SMB |
| **ElevenLabs** | `api.elevenlabs.io` | Medium | High-quality AI voiceover for Creator Studio |
| **Stability AI** | `api.stability.ai` | Low | Image generation fallback |
| **Google Ads Performance Max** | *(Google Ads API)* | High | PMax campaign creation — missing from Campaign Launch |
| **Pinterest Ads** | `api.pinterest.com` | Low | Visual ad platform |
| **Amazon Ads** | `advertising.amazon.com` | Medium | Retail / shopping campaigns |
| **LinkedIn Ads API (full)** | `api.linkedin.com` | Medium | Per-user OAuth connect + campaign launch |
| **Twitter/X Ads** | `ads-api.twitter.com` | Low | X ad campaigns |
| **Mixpanel** | `mixpanel.com/api` | Low | Additional product analytics option |
| **Heap** | `heapanalytics.com` | Low | Auto-capture product analytics |
| **Segment** | `api.segment.com` | Medium | CDP / data routing hub |
| **Appsflyer (full UI)** | *(already has keys)* | Medium | Dedicated Mobile Attribution panel |
| **Canva (full OAuth)** | `api.canva.com` | Medium | Design asset export — bridge exists, OAuth not live |
| **Telegram** | `api.telegram.org` | Low | Messaging channel |
| **Discord** | `discord.com/api` | Low | Community channel |
| **Stripe Billing Portal** | *(Stripe already integrated)* | Medium | Self-serve plan management UI |
| **Twilio Conversations** | *(Twilio already integrated)* | Medium | Multi-party messaging threads |

---

## 13 · Quick-reference: env var → feature map

| Env var | Feature(s) that use it |
|---------|------------------------|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | All 119+ AI-powered tiers: ad copy, content calendar, cold email, battle cards, strategy, DALL·E image gen |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Deep competitive analysis, SEO audits, long-form strategy docs, content scorer |
| `GEMINI_API_KEY` | GEO Audit, infographics, social content, multimodal analysis, creator studio |
| `PERPLEXITY_API_KEY` | Real-time market signals, competitor news, web-grounded research |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_TOKEN` | Llama 3.1 inference, market signals fallback |
| `RAPIDAPI_KEY` | Llama 3.2 Vision fallback, keyword research endpoint |
| `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | SERP Tracker, Keyword Explorer, SEO Auditor, Crawler, GEO Audit, Advertising Orchestrator Google research |
| `FIRECRAWL_API_KEY` | SEO Crawler, Competitor Detect, Tech Stack, Pricing Watch, Content Scorer |
| `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` | SERP visibility, competitor monitoring, brand SERP check |
| `GOOGLE_PAGESPEED_API_KEY` | Web Vitals panel, CWV scores, PageSpeed insights |
| `BING_WEBMASTER_API_KEY` | Bing Webmaster Tools panel |
| `SPYFU_API_KEY` | SpyFu Competitor PPC & SEO Spy panel |
| `MAJESTIC_API_KEY` | Majestic Trust Flow & Authority panel |
| `SEMRUSH_API_KEY` | Semrush Domain & Keyword Intel panel |
| `AHREFS_API_KEY` | Ahrefs Backlinks & Authority panel |
| `SERPSTAT_API_KEY` | Serpstat Visibility & Competitors panel |
| `CONTENTKING_API_KEY` | ContentKing Real-time SEO Monitor panel |
| `APOLLO_API_KEY` | Lead Finder, B2B prospect enrichment |
| `BUILTWITH_API_KEY` | Tech Stack Detector |
| `HUNTER_API_KEY` | Email finder in Lead Finder, Cold Email |
| `MODASH_API_KEY` | Influencer Discovery panel |
| `HUBSPOT_PRIVATE_APP_TOKEN` | CRM Sync, HubSpot contact export, audience mirror |
| `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` | Meta Ads Insights, Campaign Launch, Ad Library Spy |
| `GOOGLE_ADS_DEVELOPER_TOKEN` + `GOOGLE_ADS_*` | Google Ads Insights, Campaign Launch, AI Optimizer |
| `TIKTOK_ACCESS_TOKEN` + `TIKTOK_ADVERTISER_ID` | TikTok Ads Insights |
| `MICROSOFT_ADS_*` | Microsoft Ads Insights |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Auth emails, Drip Engine, Email Broadcast |
| `TWILIO_*` | SMS channel in Omnichannel Composer, Journey Builder |
| `WHATSAPP_*` | WhatsApp channel in Omnichannel Composer, Journey Builder |
| `VAPI_API_KEY` | Voice Caller AI outbound calls |
| `VAPID_*` | Web Push in Journey Builder, Re-engagement Agent |
| `SLACK_WEBHOOK_URL` | Alert Routing, Weekly Digest, system notifications |
| `AMPLITUDE_API_KEY` | Product analytics, Amplitude Agents panel |
| `STRIPE_SECRET_KEY` | Billing, revenue data for ROI Ledger |
| `REMOVE_BG_API_KEY` | Background removal in brand asset tools |
| `ZERNIO_API_KEY` | Social publishing |
| `YOUTUBE_DATA_API_KEY` | Trending Topics, YT Comment Miner |
| `GOOGLE_WORKSPACE_CLIENT_ID/SECRET` | Google Workspace OAuth (Gmail + Drive + Calendar) |
| `AUTH_GOOGLE_CLIENT_ID/SECRET` | Google social login |
| `AUTH_FACEBOOK_CLIENT_ID/SECRET` | Facebook social login |
| `AUTH_MICROSOFT_CLIENT_ID/SECRET` | Microsoft social login |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256-GCM per-user credential vault (required in production) |
| `INFOGENIE_API_KEY` | API gate + LLM quota enforcement |

---

*Generated from live codebase scan of 236 service modules, 4,465 lines of server.js, and platform_keys registry.*
