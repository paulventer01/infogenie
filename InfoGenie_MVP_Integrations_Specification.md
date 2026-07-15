# InfoGenie — MVP Integrations Specification

**Version:** 1.0  
**Date:** July 2026  
**Companion to:** InfoGenie_MVP_PRD.md  

---

## Overview

InfoGenie connects to 25+ external services. This document defines each integration: what it does, how credentials are stored, the authentication model, which features depend on it, rate limits, costs, and failure behaviour.

### Credential Architecture

InfoGenie has two classes of integrations:

**Platform Keys** — API keys InfoGenie pays for on behalf of all tenants. Stored encrypted in the `platform_api_keys` database table. Managed by the owner/admin via the 🔑 Platform APIs tab. Never exposed to end users. At boot, values are overlaid onto `process.env`.

**User Vault Keys** — Credentials a user brings themselves (their own Google Ads account, their own Shopify store, etc.). Stored in the AES-256-GCM credential vault, scoped per `(user_id, platform)`. Managed by users via Settings → Integrations.

| Key Type | Where stored | Who manages | Example |
|---|---|---|---|
| Platform Key | `platform_api_keys` table (encrypted) | Owner/Admin only | OpenAI, DataForSEO, Firecrawl |
| User Vault Key | `credentials` table (AES-256-GCM) | Each user | Google Ads OAuth, Shopify token |
| OAuth Token | `credentials` table (encrypted) | Auto-stored post-OAuth | Google Workspace, Meta Ads |

---

## 1. AI / LLM Providers

### 1.1 OpenAI

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `AI_INTEGRATIONS_OPENAI_API_KEY` |
| **Models used** | `gpt-4o` (complex reasoning), `gpt-4o-mini` (bulk operations, fast generation) |
| **Auth** | Bearer token in `Authorization` header |
| **SDK** | `openai` npm package (shared singleton, rebuilt on platform key change) |

**Used by:** Competitor Profiles, Battle Cards, Campaign Copy, Content Rewriter, InstaReports, Journey Builder, Ask InfoGenie, all AI Suggest fields

**Request pattern:**
```
POST https://api.openai.com/v1/chat/completions
{
  model: "gpt-4o-mini",
  response_format: { type: "json_object" },
  messages: [{ role: "user", content: prompt }]
}
```

**JSON Gate:** Every AI response is checked for a `_DUMMY` key. If present, the response is rejected and the system falls back to a template. This prevents fabricated/placeholder data from reaching users.

**gpt-5 / reasoning models:** Models matching `gpt-5*` require `max_completion_tokens` instead of `max_tokens`, and do not accept `temperature` or `top_p`. A global compatibility layer (`ai_compat.js`) normalises these differences transparently.

**Rate limits:** RPM varies by tier. InfoGenie enforces per-tenant quotas via `INFOGENIE_API_KEY` gate.

**Failure behaviour:** Falls back to Claude → Gemini → template. No silent empty responses.

---

### 1.2 Anthropic (Claude)

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` |
| **Models used** | `claude-3-5-sonnet-20241022` (long-form content), `claude-3-haiku` (fast tasks) |
| **SDK** | `@anthropic-ai/sdk` npm package (shared singleton) |

**Used by:** Long-form content generation, Brand Calendar, Video Script generation, deep competitor analysis

**Failure behaviour:** Falls back to OpenAI or template.

---

### 1.3 Google Gemini

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `GEMINI_API_KEY` |
| **Models used** | `gemini-1.5-flash`, `gemini-1.5-pro` |
| **Auth** | API key in query param `?key=` |

**Used by:** GEO Audit (tests visibility in Gemini answers), multimodal content tasks, fallback LLM

---

### 1.4 Perplexity

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `PERPLEXITY_API_KEY` |
| **Models used** | `llama-3.1-sonar-large-128k-online` |
| **Auth** | Bearer token |

**Used by:** GEO Audit (tests visibility in Perplexity answers), real-time web-aware generation, competitor news monitoring

**Key capability:** Perplexity models have live internet access — used when real-time web context is required.

---

### 1.5 Cloudflare Workers AI

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` |
| **Models used** | `@cf/meta/llama-3.1-8b-instruct` |
| **Endpoint** | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}` |

**Used by:** Low-cost bulk inference, market signals fallback, Llama 3.1 tasks

**Failure behaviour:** Falls back to OpenAI.

---

## 2. Ad Platforms

### 2.1 Google Ads

| Property | Value |
|---|---|
| **Key type** | Hybrid — platform developer token + per-user OAuth |
| **Platform env vars** | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET` |
| **Per-user vault key** | `google_ads` |
| **OAuth callback** | `${PUBLIC_URL}/api/integrations/google-ads/oauth/callback` |
| **Scope** | `https://www.googleapis.com/auth/adwords` |

**Setup requirements:**
1. `GOOGLE_ADS_DEVELOPER_TOKEN` — issued by Google to InfoGenie as the app (not per user). Required for any Google Ads API call.
2. Per-user OAuth — each user connects their own Google Ads account via the Connect button. Tokens stored in vault.
3. Whitelist the OAuth callback URI in Google Cloud Console.

**Credential resolution:** `resolveGoogleAdsCredentials(userId)` checks:
1. User's vault (`google_ads` entry)
2. Owner env-var fallback (`GOOGLE_ADS_CLIENT_ID/SECRET/REFRESH_TOKEN/CUSTOMER_ID`) — only for platform owner or cron jobs

**Used by:** Campaign Launch (Google), AI Optimizer (pause/scale/budget rules), Cross-Channel Report, Import Existing Campaigns

**API surface used:**
- `CustomerService` — list accessible accounts
- `CampaignService` — create/update campaigns
- `AdGroupService` — ad group management
- `AdService` — create/update ads
- `BudgetService` — budget updates
- `ReportingService` — performance data pull

---

### 2.2 Meta Ads (Facebook/Instagram)

| Property | Value |
|---|---|
| **Key type** | Platform Key (long-lived system token) + per-user OAuth |
| **Platform env vars** | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` |
| **Per-user vault key** | `meta_ads` |
| **OAuth callback** | `${PUBLIC_URL}/api/integrations/meta-ads/oauth/callback` |
| **Scope** | `ads_management, ads_read, business_management` |
| **API version** | v19.0 |

**Used by:** Campaign Launch (Meta), AI Optimizer, Ad Library Spy, Cross-Channel Report

**API surface used:**
- `/{ad-account}/campaigns` — create/list campaigns
- `/{ad-account}/adsets` — audience + placement targeting
- `/{ad-account}/ads` — creative creation
- `/act_{ad_account_id}/insights` — performance metrics
- `/ads_archive` — competitor ad library (public endpoint, no user auth needed)

**Rate limits:** 200 calls/hour per user token. InfoGenie queues batch operations.

---

### 2.3 TikTok Ads

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`, `TIKTOK_RAPIDAPI_KEY` |
| **API base** | `https://business-api.tiktok.com/open_api/v1.3/` |

**Used by:** Campaign Launch (TikTok), AI Optimizer, Cross-Channel Report

**Note:** TikTok API access requires app review approval from TikTok. The `TIKTOK_RAPIDAPI_KEY` provides an alternative route via RapidAPI for accounts pending direct access.

---

### 2.4 Microsoft Ads (Bing)

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `MICROSOFT_ADS_CLIENT_ID`, `MICROSOFT_ADS_CLIENT_SECRET`, `MICROSOFT_ADS_REFRESH_TOKEN`, `MICROSOFT_ADS_DEVELOPER_TOKEN`, `MICROSOFT_ADS_CUSTOMER_ID` |

**Used by:** Campaign Launch (Microsoft/Bing), Cross-Channel Report

---

## 3. Data & Intelligence APIs

### 3.1 DataForSEO

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| **Auth** | HTTP Basic Auth (`login:password`) |
| **Base URL** | `https://api.dataforseo.com/v3/` |
| **Cost model** | Pay-per-result (fractions of a cent per data point) |

**API endpoints used:**

| Endpoint | Feature | Approx. cost |
|---|---|---|
| `serp/google/organic/live` | SERP Tracker, keyword rankings | ~$0.002/keyword |
| `keywords_data/google_ads/search_volume/live` | Keyword Explorer, Content Scorer | ~$0.001/keyword |
| `backlinks/summary/live` | Competitor backlink analysis | ~$0.01/domain |
| `on_page/task_post` | On-Page SEO Audit | ~$0.01/URL |
| `content_analysis/search/live` | Content gap analysis | ~$0.005/search |
| `domain_analytics/technologies/domain_technologies/live` | Tech stack detection | ~$0.01/domain |

**Rate limits:** 2,000 requests/minute (post-limits via queue).

**Failure behaviour:** Returns cached data if available (24h TTL in `kv_store`). Falls back to AI-estimated values with a "data unavailable" flag.

---

### 3.2 Firecrawl

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `FIRECRAWL_API_KEY` |
| **Base URL** | `https://api.firecrawl.dev/v1/` |

**Used by:**
- Competitor Profiles — scrapes competitor websites to extract positioning, messaging, pricing, features
- Ad Swipe File — scrapes competitor landing pages
- Content Scorer — scrapes target URL for content analysis
- InstaReports — scrapes prospect website for audit data

**API endpoints used:**

| Endpoint | Purpose |
|---|---|
| `POST /scrape` | Single URL scrape (returns markdown + metadata) |
| `POST /crawl` | Multi-page crawl (up to 50 pages per domain) |
| `POST /extract` | Structured data extraction via AI schema |

**SSRF protection:** All URLs passed to Firecrawl are validated against a strict allowlist — private IP ranges (10.x, 192.168.x, 127.x, localhost, `*.internal`) are blocked before the request is made.

---

### 3.3 Apollo

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `APOLLO_API_KEY` |
| **Base URL** | `https://api.apollo.io/v1/` |

**Used by:** Lead Generation (prospect search + enrichment), LinkedIn Outreach (contact data), Re-engagement Agent

**API endpoints used:**

| Endpoint | Purpose |
|---|---|
| `POST /mixed_people/search` | Find contacts by title, company, location, industry |
| `POST /people/match` | Enrich a contact by email or LinkedIn URL |
| `POST /organizations/enrich` | Company firmographic data |

**Note:** Apollo returns HTTP 200 even for invalid API keys (with empty results). InfoGenie's platform key tester is aware of this behaviour and validates by checking result count, not HTTP status.

---

### 3.4 BuiltWith

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `BUILTWITH_API_KEY` |
| **Base URL** | `https://api.builtwith.com/v21/api.json` |

**Used by:** Competitor Profiles (technology stack), Battle Cards (tech comparison), InstaReports (tech stack section)

**Key data returned:** CMS, analytics tools, ad pixels, ecommerce platform, CDN, email service provider, frameworks.

**Note:** Like Apollo, BuiltWith returns HTTP 200 with an error payload for bad keys. The platform key tester checks for `Errors` in the response body.

---

### 3.5 Google PageSpeed Insights

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `GOOGLE_PAGESPEED_API_KEY` |
| **Endpoint** | `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` |

**Used by:** InstaReports (real Page Speed scores), Web Vitals audit, On-Page Audit

**Data returned per call:**
- Lighthouse scores: Performance, SEO, Accessibility, Best Practices (0–100)
- Core Web Vitals: LCP, FID/INP, CLS
- Opportunities: specific optimisation recommendations with estimated savings

**Fallback:** If key not configured or quota exceeded, InstaReports falls back to AI-estimated scores with a disclosure note.

---

### 3.6 Google Search (Custom Search API)

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `GOOGLE_SEARCH_API_KEY` |
| **Endpoint** | `https://www.googleapis.com/customsearch/v1` |

**Used by:** Competitor monitoring, brand mention alerts, Question Mining, GEO Audit (cross-referencing)

**Limits:** 100 queries/day on free tier; 10,000/day on paid.

---

## 4. Communication & Email

### 4.1 Resend

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `RESEND_API_KEY` |
| **From address** | `RESEND_FROM_EMAIL` (must be a verified Resend domain) |
| **Webhook secret** | `RESEND_WEBHOOK_SECRET` |
| **SDK** | `resend` npm package |

**Used by:**
- Auth — email verification, password reset, team invitations
- Weekly Report — automated Monday performance email
- Daily Digest — daily summary email
- InstaReports — prospect audit email delivery
- Journey Builder — email actions within automations
- Drip Engine — sequence emails
- Alert Routing — channel for marketing alerts

**Webhook events handled:**

| Event | Action |
|---|---|
| `email.delivered` | Mark send record as `delivered` |
| `email.opened` | Record open timestamp; trigger journey signals |
| `email.clicked` | Record click; fire `email_click` signal to Journey Builder |
| `email.bounced` | Mark contact as `hard_bounce`; suppress from future sends |
| `email.complained` | Unsubscribe contact; add to suppression list |

**Critical setup note:** `RESEND_FROM_EMAIL` must be a domain verified in the Resend dashboard. Emails from unverified domains are silently dropped. Use `onboarding@resend.dev` for development only.

**Webhook verification:** All incoming webhooks are verified using `RESEND_WEBHOOK_SECRET` with HMAC-SHA256 before processing.

---

### 4.2 Twilio (SMS & Voice)

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| **SDK** | `twilio` npm package |

**Used by:** Omnichannel Composer (SMS sends), Journey Builder (SMS actions), Re-engagement Agent (SMS channel)

**Failure behaviour:** If Twilio keys not configured, SMS channel is hidden from UI. No silent failures.

---

### 4.3 WhatsApp Business API

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` |
| **Provider** | Meta Cloud API |
| **Webhook endpoint** | `POST /api/webhooks/whatsapp` |

**Used by:** Omnichannel Composer (WhatsApp sends), Conversation Inbox (inbound messages), Journey Builder (WhatsApp actions)

**Webhook verification:** `WHATSAPP_VERIFY_TOKEN` used for the initial hub verification handshake. `WHATSAPP_APP_SECRET` used for HMAC verification of all subsequent event payloads.

---

### 4.4 Web Push (VAPID)

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| **Library** | `web-push` npm package |

**Used by:** Omnichannel Composer (push notifications), Journey Builder (push actions), Re-engagement Agent

**Setup:** Generate a VAPID key pair once with `web-push generate-vapid-keys`. The public key is served to the frontend for service worker registration.

---

### 4.5 VAPI (AI Voice)

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_SECRET` |

**Used by:** Omnichannel Composer (AI voice calls), Journey Builder (voice call actions), Re-engagement Agent (phone channel)

---

## 5. CRM & Marketing Automation

### 5.1 HubSpot

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `HUBSPOT_PRIVATE_APP_TOKEN` |
| **Auth** | Bearer token (`Authorization: Bearer {token}`) |
| **API version** | v3 |
| **Base URL** | `https://api.hubapi.com/` |

**Used by:**
- Dynamic Audiences — sync audience segments to HubSpot Static Lists
- Lead Generation — push enriched leads to HubSpot contacts
- InstaReports — pull contact records as prospect data source
- Journey Builder — HubSpot deal/contact actions
- Drip Engine — contact property updates on email events

**API endpoints used:**

| Endpoint | Purpose |
|---|---|
| `POST /crm/v3/objects/contacts` | Create contact |
| `PATCH /crm/v3/objects/contacts/{id}` | Update contact properties |
| `POST /crm/v3/lists` | Create static list for audience segment |
| `PUT /crm/v3/lists/{listId}/memberships/add-from-search` | Populate list with matching contacts |
| `GET /crm/v3/objects/contacts/search` | Search contacts by property |
| `POST /crm/v3/objects/deals` | Create deal from lead |

**Sync behaviour:** Audience sweep runs every 15 minutes. HubSpot list mirror runs after each sweep if changes detected. Mutations gated by `global._dripStore.lock` to prevent concurrent sync conflicts.

---

## 6. Analytics & Monitoring

### 6.1 Amplitude

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY` |
| **Base URL** | `https://api.amplitude.com/2/httpapi` |

**Events tracked (server-side):**

| Event | Trigger |
|---|---|
| `user_signed_up` | New account created |
| `ai_action_completed` | Any AI generation completes |
| `campaign_launched` | Campaign successfully submitted to ad platform |
| `report_sent` | Weekly report or InstaReport emailed |
| `competitor_profile_created` | First competitor added |
| `platform_key_updated` | Admin changes a platform API key |
| `insta_report_viewed` | Prospect opens their report via public link |

**Privacy:** No PII in event properties. User identity is the internal UUID only.

---

### 6.2 Google Analytics (Deferred)

Currently parked — Google Workspace org policy blocks the OAuth scope required for GA4 data API access. Will revisit post-MVP.

---

## 7. Payments

### 7.1 Stripe

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| **SDK** | `stripe` npm package |
| **Webhook endpoint** | `POST /api/webhooks/stripe` |

**Used by:** Subscription billing (Starter/Growth/Agency tiers), usage-based billing for AI credits

**Webhook events handled:**

| Event | Action |
|---|---|
| `checkout.session.completed` | Activate subscription, set tenant tier |
| `customer.subscription.updated` | Update tier limits |
| `customer.subscription.deleted` | Downgrade to free / lock account |
| `invoice.payment_failed` | Send payment failure email, grace period logic |

**Webhook verification:** All events verified with `stripe.webhooks.constructEvent()` using `STRIPE_WEBHOOK_SECRET` before any state change.

---

## 8. Social & Identity

### 8.1 Google OAuth (Social Login)

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` |
| **Callback** | `/api/auth/oauth/google/callback` |
| **Scopes** | `openid email profile` |

**Used by:** Sign in with Google on the login/signup page. If env vars not set, the Google button is hidden automatically.

---

### 8.2 Facebook OAuth (Social Login)

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `AUTH_FACEBOOK_CLIENT_ID`, `AUTH_FACEBOOK_CLIENT_SECRET` |
| **Callback** | `/api/auth/oauth/facebook/callback` |

---

### 8.3 Microsoft OAuth (Social Login + Ads)

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET` |
| **Callback** | `/api/auth/oauth/microsoft/callback` |

Used for both social login and Microsoft Ads authentication.

---

### 8.4 Google Workspace OAuth

| Property | Value |
|---|---|
| **Key type** | Per-user vault |
| **Vault key** | `google_workspace` |
| **Env vars** | `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET` |
| **Callback** | `/api/integrations/workspace/oauth/callback` |
| **Scopes** | Gmail read/send, Google Drive, Google Calendar |

**Used by:** Google Workspace integration tab — read emails, manage calendar bookings, attach Drive files to campaigns.

---

## 9. Website Intelligence

### 9.1 Bing Webmaster Tools

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `BING_WEBMASTER_API_KEY` |

**Used by:** SERP Tracker (Bing rankings), SEO Roadmap (Bing-specific recommendations)

---

## 10. File Storage

### 10.1 Local Uploads (MVP)

User-uploaded brand assets (logos, images) are stored in the `uploads/` directory on the VM. Files are served at `/uploads/{filename}`.

**Limits:** 10MB per file, 200MB total per tenant.

**Post-MVP:** Migrate to Cloudflare R2 or AWS S3 for durable object storage. VM filesystem is not suitable for multi-region deployments.

---

## 11. Internal APIs (Public-Facing)

These are InfoGenie-generated endpoints consumed by external parties.

### 11.1 Funnel Analytics Pixel

```
POST /api/funnel-analytics/track
Content-Type: application/json
{ "pixel_id": "abc123", "event": "pageview|optin|sale", "revenue": 0, "session_id": "...", "utm_source": "..." }
```

No authentication required. Rate-limited by hashed IP address. CORS: `*` (must be embeddable from any domain).

### 11.2 InstaReport Public View

```
GET /api/insta-reports/public/:token
```

No authentication required. Token is a 48-character random hex string. Records `viewed_at` timestamp on first access. Used by prospects clicking the link in their emailed report.

### 11.3 Booking Pages

```
GET  /book/:slug        — Public booking page
POST /api/bookings/:slug — Slot reservation
```

No authentication. Rate-limited by IP. Used by clients booking appointments via Link-in-Bio or direct URL.

### 11.4 Web Push Subscription

```
POST /api/push/subscribe
{ "subscription": { PushSubscription object } }
```

Authenticated. Stores the browser push subscription endpoint for the current user/contact.

---

## 12. Integration Health Monitoring

### Platform Key Live Tests

Each platform key can be tested from the 🔑 Platform APIs admin tab:

| Key | Test method | Success signal |
|---|---|---|
| OpenAI | `GET /v1/models` | HTTP 200 + model list |
| Anthropic | `GET /v1/models` | HTTP 200 |
| Gemini | `GET /v1beta/models` | HTTP 200 |
| Perplexity | `POST /chat/completions` (minimal) | HTTP 200 |
| Cloudflare | `GET /accounts/{id}/ai/models/search` | HTTP 200 |
| DataForSEO | `GET /v3/serp/google/organic/task_get/advanced` | HTTP 200 |
| Firecrawl | `GET /v1/` (health endpoint) | HTTP 200 |
| Apollo | `POST /mixed_people/search` (0 results OK) | HTTP 200 + check result shape |
| BuiltWith | `GET /?KEY=&LOOKUP=example.com` | HTTP 200 + check no `Errors` key |
| Google PageSpeed | `GET /runPagespeed?url=https://example.com&key=` | HTTP 200 + categories |
| HubSpot | `GET /crm/v3/objects/contacts?limit=1` | HTTP 200 |
| Resend | `GET /emails` | HTTP 200 |
| Amplitude | `POST /httpapi` (test event) | HTTP 200 |
| Stripe | `GET /v1/customers?limit=1` | HTTP 200 |

Tests are logged as `platform_key_updated` audit events. Test results (pass/fail) are stored but the key value is never logged.

---

## 13. Setup Priority Order

For a new InfoGenie deployment, configure integrations in this order:

**Required to boot:**
1. `DATABASE_URL` — Postgres connection
2. `CREDENTIAL_ENCRYPTION_KEY` — 32-byte AES-256-GCM key (`openssl rand -base64 32`)
3. `SESSION_SECRET` — signs session cookies
4. `INFOGENIE_API_KEY` — API gate

**Required for core features:**
5. `AI_INTEGRATIONS_OPENAI_API_KEY` — powers almost everything AI
6. `RESEND_API_KEY` + `RESEND_FROM_EMAIL` — auth emails (verify/reset)
7. `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` — SEO data
8. `FIRECRAWL_API_KEY` — competitor scraping

**Required for ad campaigns:**
9. `GOOGLE_ADS_DEVELOPER_TOKEN` + OAuth client
10. `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID`

**Required for reporting & outreach:**
11. `HUBSPOT_PRIVATE_APP_TOKEN`
12. `AMPLITUDE_API_KEY`
13. `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`

**Optional (features degrade gracefully without these):**
14. `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Claude fallback
15. `GEMINI_API_KEY` — Gemini fallback + GEO Audit
16. `PERPLEXITY_API_KEY` — real-time web AI + GEO Audit
17. `GOOGLE_PAGESPEED_API_KEY` — real PageSpeed in InstaReports
18. `APOLLO_API_KEY` — lead enrichment
19. `BUILTWITH_API_KEY` — tech stack detection
20. `TWILIO_*` — SMS channel
21. `WHATSAPP_*` — WhatsApp channel
22. `VAPI_*` — AI voice channel
23. `VAPID_*` — web push notifications
24. Auth OAuth keys (Google/Facebook/Microsoft) — social login buttons

---

## 14. Environment Variables Reference

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Postgres connection string |
| `CREDENTIAL_ENCRYPTION_KEY` | ✅ prod | — | AES-256-GCM vault key |
| `SESSION_SECRET` | ✅ prod | Falls back to `INFOGENIE_API_KEY` in dev | Signs session cookies |
| `INFOGENIE_API_KEY` | ✅ | — | API gate + LLM quota |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | ✅ | — | OpenAI (GPT-4o/mini) |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | ⚠️ | — | Claude fallback |
| `GEMINI_API_KEY` | ⚠️ | — | Gemini + GEO Audit |
| `PERPLEXITY_API_KEY` | ⚠️ | — | Perplexity + real-time AI |
| `CLOUDFLARE_ACCOUNT_ID` | ⚠️ | — | Cloudflare Workers AI |
| `CLOUDFLARE_AI_TOKEN` | ⚠️ | — | Cloudflare Workers AI |
| `DATAFORSEO_LOGIN` | ✅ | — | SEO keyword + SERP data |
| `DATAFORSEO_PASSWORD` | ✅ | — | SEO keyword + SERP data |
| `FIRECRAWL_API_KEY` | ✅ | — | Web scraping |
| `APOLLO_API_KEY` | ⚠️ | — | Lead enrichment |
| `BUILTWITH_API_KEY` | ⚠️ | — | Tech stack detection |
| `GOOGLE_PAGESPEED_API_KEY` | ⚠️ | — | Real PageSpeed scores |
| `GOOGLE_SEARCH_API_KEY` | ⚠️ | — | Google custom search |
| `BING_WEBMASTER_API_KEY` | ⚠️ | — | Bing rankings |
| `HUBSPOT_PRIVATE_APP_TOKEN` | ⚠️ | — | CRM sync |
| `RESEND_API_KEY` | ✅ | — | All outbound email |
| `RESEND_FROM_EMAIL` | ✅ | `onboarding@resend.dev` | Verified sender address |
| `RESEND_WEBHOOK_SECRET` | ✅ | — | Webhook verification |
| `AMPLITUDE_API_KEY` | ⚠️ | — | Product analytics |
| `AMPLITUDE_SECRET_KEY` | ⚠️ | — | Server-side events |
| `STRIPE_SECRET_KEY` | ✅ prod | — | Subscription billing |
| `STRIPE_WEBHOOK_SECRET` | ✅ prod | — | Billing webhook verification |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | ⚠️ | — | Google Ads API access |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` | ⚠️ | — | Per-user Google Ads OAuth |
| `GOOGLE_ADS_OAUTH_CLIENT_SECRET` | ⚠️ | — | Per-user Google Ads OAuth |
| `META_ACCESS_TOKEN` | ⚠️ | — | Meta Ads |
| `META_AD_ACCOUNT_ID` | ⚠️ | — | Meta Ads |
| `TIKTOK_ACCESS_TOKEN` | ⚠️ | — | TikTok Ads |
| `TIKTOK_ADVERTISER_ID` | ⚠️ | — | TikTok Ads |
| `AUTH_GOOGLE_CLIENT_ID` | ⚠️ | — | Google social login |
| `AUTH_GOOGLE_CLIENT_SECRET` | ⚠️ | — | Google social login |
| `AUTH_FACEBOOK_CLIENT_ID` | ⚠️ | — | Facebook social login |
| `AUTH_FACEBOOK_CLIENT_SECRET` | ⚠️ | — | Facebook social login |
| `AUTH_MICROSOFT_CLIENT_ID` | ⚠️ | — | Microsoft social login |
| `AUTH_MICROSOFT_CLIENT_SECRET` | ⚠️ | — | Microsoft social login |
| `GOOGLE_WORKSPACE_CLIENT_ID` | ⚠️ | — | Google Workspace OAuth |
| `GOOGLE_WORKSPACE_CLIENT_SECRET` | ⚠️ | — | Google Workspace OAuth |
| `TWILIO_ACCOUNT_SID` | ⚠️ | — | SMS |
| `TWILIO_AUTH_TOKEN` | ⚠️ | — | SMS |
| `TWILIO_FROM_NUMBER` | ⚠️ | — | SMS sender number |
| `WHATSAPP_PHONE_NUMBER_ID` | ⚠️ | — | WhatsApp |
| `WHATSAPP_ACCESS_TOKEN` | ⚠️ | — | WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | ⚠️ | — | WhatsApp webhook verification |
| `WHATSAPP_APP_SECRET` | ⚠️ | — | WhatsApp payload verification |
| `VAPI_API_KEY` | ⚠️ | — | AI voice calls |
| `VAPI_PHONE_NUMBER_ID` | ⚠️ | — | AI voice calls |
| `VAPI_WEBHOOK_SECRET` | ⚠️ | — | VAPI webhook verification |
| `VAPID_PUBLIC_KEY` | ⚠️ | — | Web push |
| `VAPID_PRIVATE_KEY` | ⚠️ | — | Web push |
| `VAPID_SUBJECT` | ⚠️ | — | Web push (mailto: or URL) |
| `RAPIDAPI_KEY` | ⚠️ | — | TikTok + Llama via RapidAPI |
| `PUBLIC_URL` | ⚠️ | `https://{REPL_SLUG}.replit.app` | OAuth callback base URL |
| `SLACK_WEBHOOK_URL` | ⚠️ | — | Internal Slack alerts |
| `ZERNIO_API_KEY` | ⚠️ | — | Additional data enrichment |

✅ = Required to boot / core function | ⚠️ = Optional, feature degrades gracefully

---

*Document owner: Engineering*  
*Next review: At each new integration added*
