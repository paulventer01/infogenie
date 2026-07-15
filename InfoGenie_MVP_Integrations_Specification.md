# InfoGenie — MVP Integrations Specification

**Version:** 2.0  
**Date:** July 2026  
**Based on:** InfoGenie_MVP_Feature_Prioritisation.md (50 Must-Have features)  
**Supersedes:** InfoGenie_MVP_Integrations_Specification v1.0

---

## Purpose

This document answers three questions for every integration InfoGenie uses:

1. **Which of the 50 MVP features does it power?**
2. **Is it required for MVP launch, or optional?**
3. **What breaks if it isn't configured?**

Integrations are classified into three tiers:

| Tier | Meaning |
|---|---|
| 🔴 **Day 1 Required** | MVP is broken without it. Block launch until configured. |
| 🟡 **Day 1 Important** | Several MVP features degrade to templates/AI estimates. Ship without, but configure ASAP. |
| 🟢 **Post-MVP** | No MVP feature depends on it. Safely skip for launch. |

---

## Credential Architecture

InfoGenie uses two classes of credentials — never mix them up:

**Platform Keys** — API keys InfoGenie pays for on behalf of all tenants. Stored encrypted in the `platform_api_keys` database table. Managed owner/admin-only via the 🔑 Platform APIs admin tab. Overlaid onto `process.env` at boot. End users never see these.

**User Vault Keys** — Credentials the user brings themselves (their own Google Ads account, their own HubSpot portal, etc.). Stored AES-256-GCM per `(user_id, platform)`. Managed by each user via Settings → Integrations.

| Key type | Where stored | Who manages | Examples |
|---|---|---|---|
| Platform Key | `platform_api_keys` table (encrypted) | Owner / Admin | OpenAI, DataForSEO, Firecrawl, Resend |
| User Vault Key | `credentials` table (AES-256-GCM) | Each user | Google Ads OAuth, Shopify token |
| OAuth Token | `credentials` table (encrypted, auto) | Auto-stored after OAuth | Google Ads, Meta Ads, Google Workspace |

---

## MVP Integration Matrix

This table maps every Must-Have feature to the integrations it requires. Use it to decide which keys to configure first.

| Must-Have Feature | Required integrations | Optional (degrades gracefully) |
|---|---|---|
| Competitor Profiles | OpenAI, Firecrawl | BuiltWith (tech stack) |
| Battle Cards | OpenAI, Firecrawl | Perplexity |
| Ad Library Spy | Meta Access Token | — |
| Pricing Watcher | Firecrawl, OpenAI | — |
| Tech Stack Detector | BuiltWith | — |
| Keyword Explorer | DataForSEO | — |
| Question Mining | DataForSEO, OpenAI | — |
| Content Gaps vs Rivals | DataForSEO, OpenAI, Firecrawl | — |
| SERP Rank Tracker | DataForSEO | — |
| Backlink Explorer | DataForSEO | — |
| AI Answer SOV | OpenAI, Anthropic, Perplexity | Gemini |
| ICP Studio | OpenAI | — |
| Voice of Customer | OpenAI, Firecrawl | Perplexity |
| Review Aggregator | OpenAI, Perplexity | Firecrawl |
| Content AI | OpenAI or Anthropic | Gemini, Cloudflare |
| Headline Tester | OpenAI | — |
| Cold Email Writer | OpenAI | Anthropic |
| Email Personalizer | OpenAI | — |
| Email Broadcast + Tracking | Resend | — |
| Video Script Generator | OpenAI or Anthropic | — |
| Smart Creative Builder | OpenAI | — |
| Ad Creative from Landing Page | OpenAI | — |
| Landing Page Builder | OpenAI | — |
| LP Lead Capture + Webhook | — (internal) | HubSpot |
| Content Calendar | OpenAI | — |
| Campaign Strategy | OpenAI | Anthropic |
| A/B Test Designer | OpenAI | — |
| Advertise Hub (Meta) | Meta Access Token, Meta Ad Account ID | — |
| Advertise Hub (Google) | Google Ads Developer Token + per-user OAuth | — |
| Advertise Hub (TikTok) | TikTok Access Token | TikTok RapidAPI Key |
| AI Campaign Optimizer | Meta or Google creds (same as above) | — |
| Import Existing Campaigns | Meta or Google creds | — |
| Social Publisher | None required (copy/paste schedule mode) | (platform APIs per channel) |
| Journey Builder | Resend (email actions) | Twilio (SMS), VAPI (voice) |
| Dynamic Audiences | OpenAI | HubSpot (list mirror) |
| Omnichannel Composer | Resend (email) | Twilio (SMS), WhatsApp |
| Lead Generation | Apollo | Perplexity (fallback) |
| HubSpot CRM Sync | HubSpot Private App Token | — |
| Conversion Boosters | — (internal) | — |
| On-Page SEO Audit | DataForSEO, Google PageSpeed | — |
| Embeddable Audit Widget | DataForSEO, Google PageSpeed | — |
| GEO Audit | Gemini, Perplexity, OpenAI | Anthropic |
| Web Vitals Auditor | Google PageSpeed | DataForSEO |
| Email Deliverability Audit | OpenAI | — |
| Email Warm-Up | Resend | — |
| LinkedIn Outreach | Apollo | Perplexity |
| Content Scorer | DataForSEO, OpenAI, Firecrawl | — |
| Bulk Content Rewriter | OpenAI or Anthropic | — |
| AutoSEO Pro | DataForSEO, OpenAI, Firecrawl | — |
| CRO Lab | OpenAI | — |
| Meta Ads Insights | Meta Access Token, Meta Ad Account ID | — |
| Google Ads Insights | Google Ads Developer Token + OAuth | — |
| Funnel Analytics (JS pixel) | — (internal) | — |
| True ROAS / Blended CAC | — (internal, uses campaign data) | — |
| Revenue Forecast Engine | OpenAI | — |
| Churn-Risk Scorer | OpenAI | — |
| Today's Marketing Brief | OpenAI | — |
| Budget Board | — (internal) | — |
| Weekly Report | Resend, OpenAI | — |
| White-Label Reports | — (internal, PDF export) | — |
| InstaReports | OpenAI, Firecrawl, Google PageSpeed, Resend | BuiltWith |
| Ask InfoGenie | OpenAI | Anthropic |
| 7-Day Playbook | OpenAI | — |
| Re-Engage Customers | Resend | Twilio |
| Signal Triggers | — (internal) | Slack, Resend |
| Alert Routing | Slack or Resend | — |
| Workspaces & Team | Resend (invitation emails) | — |
| Unified Conversation Inbox | Resend | Twilio, WhatsApp |

---

## Section 1 — AI / LLM Providers

### 1.1 OpenAI 🔴 Day 1 Required

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `AI_INTEGRATIONS_OPENAI_API_KEY` |
| **Models used** | `gpt-4o` (complex reasoning), `gpt-4o-mini` (bulk/fast tasks) |
| **SDK** | `openai` npm package — shared singleton, rebuilt when platform key changes |
| **Auth** | Bearer token in `Authorization` header |

**MVP features powered:**
Battle Cards · Competitor Profiles · Cold Email Writer · Content AI · Video Script Generator · Smart Creative Builder · Landing Page Builder · Campaign Optimizer · Revenue Forecast Engine · Today's Marketing Brief · Ask InfoGenie · Weekly Report · Journey Builder · InstaReports · AI Answer SOV · and 30+ more

**If missing:** The majority of AI generation features will fail or fall back to template output. Not viable for MVP.

**JSON Gate (critical):** Every AI response is checked for a `_DUMMY` key before use. Responses containing `_DUMMY` are rejected and trigger template fallback, preventing fabricated placeholder data from reaching users.

**Failure cascade:** OpenAI → Anthropic → Gemini → template. No feature silently returns empty output — either real data or a clearly-labelled template.

**gpt-5 compatibility:** Models matching `gpt-5*` require `max_completion_tokens` (not `max_tokens`) and reject `temperature`/`top_p`. The global `ai_compat.js` normalises these automatically — no per-feature code changes needed.

**Rate limits:** Per-tier RPM limits enforced via the `INFOGENIE_API_KEY` quota gate.

---

### 1.2 Anthropic (Claude) 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` |
| **Models used** | `claude-3-5-sonnet-20241022` (long-form), `claude-3-haiku` (fast tasks) |
| **SDK** | `@anthropic-ai/sdk` — shared singleton |

**MVP features powered:**
Long-form blog content · Brand Calendar deep copy · Video scripts (alternative to OpenAI) · AI Answer SOV (Claude is one of the three tracked AI engines alongside GPT and Perplexity) · Fallback for any OpenAI failure

**If missing:** AI Answer SOV only tracks 2 of 3 AI engines. Long-form content quality degrades slightly. All other features fall back to OpenAI cleanly.

---

### 1.3 Google Gemini 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `GEMINI_API_KEY` |
| **Models used** | `gemini-1.5-flash`, `gemini-1.5-pro` |
| **Auth** | API key in `?key=` query param |

**MVP features powered:**
GEO Audit (tests whether brand appears in Gemini answers — a core part of the unique AI Answer Share-of-Voice feature) · Fallback LLM for OpenAI failures

**If missing:** GEO Audit and AI Answer SOV only test GPT + Perplexity, not Gemini. Product still works; coverage is reduced.

---

### 1.4 Perplexity 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `PERPLEXITY_API_KEY` |
| **Models used** | `llama-3.1-sonar-large-128k-online` |
| **Auth** | Bearer token |
| **Key capability** | Live internet access — use when real-time web context is required |

**MVP features powered:**
GEO Audit (Perplexity is one of the three tracked AI engines) · AI Answer SOV (Perplexity sweep) · Competitor monitoring (real-time news) · Voice of Customer (live web research) · Lead Generation (fallback when Apollo returns sparse results) · Review Aggregator (live web research for review data)

**If missing:** GEO Audit and AI Answer SOV lose Perplexity coverage. Live web-grounded features fall back to OpenAI without internet context. Lead Aggregator runs Apollo-only.

---

### 1.5 Cloudflare Workers AI 🟢 Post-MVP

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` |
| **Models used** | `@cf/meta/llama-3.1-8b-instruct` |
| **Endpoint** | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}` |

**MVP features powered:** Low-cost bulk inference, Llama 3.1 tasks — fallback only.

**If missing:** Cloudflare tasks fall back to OpenAI. No user-visible degradation.

---

## Section 2 — Ad Platforms

### 2.1 Meta Ads 🔴 Day 1 Required

| Property | Value |
|---|---|
| **Key type** | Platform Key (system token) + optional per-user OAuth |
| **Platform env vars** | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` |
| **Per-user vault key** | `meta_ads` |
| **OAuth callback** | `${PUBLIC_URL}/api/integrations/meta-ads/oauth/callback` |
| **OAuth scopes** | `ads_management, ads_read, business_management` |
| **API version** | v19.0 |

**MVP features powered:**
Campaign Launch (Meta) · AI Campaign Optimizer (pause / scale / budget rules) · Ad Library Spy (competitor ads) · Meta Ads Insights dashboard · Cross-Channel Report · Import Existing Campaigns

**Credential resolution:** Platform `META_ACCESS_TOKEN` is the system default. Users can connect their own account via OAuth, which takes precedence for their campaigns.

**Ad Library Spy note:** The `/ads_archive` endpoint is public — it does not require user OAuth, only the platform access token. This means Ad Library Spy works for any user even before they connect their own Meta account.

**API surface used for campaign launch:**

| Meta endpoint | Purpose |
|---|---|
| `/{ad-account}/campaigns` | Create / list campaigns |
| `/{ad-account}/adsets` | Audience + placement + budget per ad set |
| `/{ad-account}/ads` | Creative + copy for each ad |
| `/act_{id}/insights` | Performance metrics pull |
| `/ads_archive` | Competitor ad library (public, no user auth) |

**Rate limits:** 200 calls/hour per user token. InfoGenie queues batch operations.

**If missing:** Campaign Launch, Optimizer, and Meta Insights are disabled. Ad Library Spy shows no Meta ads. This removes a core MVP feature — Meta is the most common ad platform among InfoGenie's target users.

---

### 2.2 Google Ads 🔴 Day 1 Required

| Property | Value |
|---|---|
| **Key type** | Hybrid — platform developer token + per-user OAuth |
| **Platform env vars** | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET` |
| **Owner fallback** | `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID` |
| **Per-user vault key** | `google_ads` |
| **OAuth callback** | `${PUBLIC_URL}/api/integrations/google-ads/oauth/callback` |
| **OAuth scope** | `https://www.googleapis.com/auth/adwords` |

**Setup requirements (in order):**
1. `GOOGLE_ADS_DEVELOPER_TOKEN` — issued by Google to InfoGenie as the app. Required for any Google Ads API call whatsoever.
2. `GOOGLE_ADS_OAUTH_CLIENT_ID` + `GOOGLE_ADS_OAUTH_CLIENT_SECRET` — needed to run per-user OAuth. Whitelist the callback URI in Google Cloud Console.
3. Each user connects their Google Ads account via the Connect button in Settings. Tokens stored in vault.

**Credential resolution order** (`resolveGoogleAdsCredentials(userId)`):
1. User's vault entry (`google_ads`)
2. Owner env-var fallback — only for the platform owner account or cron jobs

**MVP features powered:**
Campaign Launch (Google) · Google Ads Insights dashboard · AI Campaign Optimizer (Google bids + budgets) · Import Existing Campaigns · Cross-Channel Report

**API surface used:**

| Google Ads API service | Purpose |
|---|---|
| `CustomerService` | List accessible accounts |
| `CampaignService` | Create / update campaigns |
| `AdGroupService` | Ad group management |
| `AdService` | Create / update ads |
| `BudgetService` | Budget adjustments |
| `GoogleAdsService (GAQL)` | Performance data queries |

**If missing:** Google campaign features are disabled. Users who are Google-primary (not Meta) cannot launch campaigns at MVP. Prioritise configuring this alongside Meta.

---

### 2.3 TikTok Ads 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID` |
| **Fallback** | `TIKTOK_RAPIDAPI_KEY` — RapidAPI route for accounts pending TikTok direct access |
| **API base** | `https://business-api.tiktok.com/open_api/v1.3/` |

**MVP features powered:** Campaign Launch (TikTok) · Cross-Channel Report

**Important:** TikTok direct API access requires a formal app review by TikTok. If pending, `TIKTOK_RAPIDAPI_KEY` via RapidAPI provides a fallback route. Configure RapidAPI key first; swap to direct access when approved.

**If missing:** TikTok campaign launch is disabled. Meta and Google still work. Acceptable for MVP if the primary ICP uses Meta/Google.

---

### 2.4 Microsoft Ads 🟢 Post-MVP

| Env var | Purpose |
|---|---|
| `MICROSOFT_ADS_CLIENT_ID` | OAuth client |
| `MICROSOFT_ADS_CLIENT_SECRET` | OAuth secret |
| `MICROSOFT_ADS_REFRESH_TOKEN` | Long-lived token |
| `MICROSOFT_ADS_DEVELOPER_TOKEN` | App-level token |
| `MICROSOFT_ADS_CUSTOMER_ID` | Account ID |

**If missing:** Microsoft/Bing campaign launch is disabled. Not a day-1 blocker for most users.

---

## Section 3 — Data & Intelligence APIs

### 3.1 DataForSEO 🔴 Day 1 Required

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| **Auth** | HTTP Basic Auth (`login:password` Base64) |
| **Base URL** | `https://api.dataforseo.com/v3/` |
| **Cost model** | Pay-per-result (fractions of a cent per data point) |

**MVP features powered and endpoints used:**

| DataForSEO endpoint | Feature(s) powered | Approx. cost |
|---|---|---|
| `serp/google/organic/live` | SERP Rank Tracker, Keyword Explorer | ~$0.002 / keyword |
| `keywords_data/google_ads/search_volume/live` | Keyword Explorer, Content Scorer, Question Mining | ~$0.001 / keyword |
| `backlinks/summary/live` | Backlink Explorer, Competitor Profiles | ~$0.01 / domain |
| `on_page/task_post` + `on_page/pages` | On-Page SEO Audit, Embeddable Widget, Web Vitals | ~$0.01 / URL |
| `content_analysis/search/live` | Content Gaps vs Rivals, AutoSEO Pro | ~$0.005 / search |
| `domain_analytics/technologies/domain_technologies/live` | Tech Stack Detector, Competitor Profiles | ~$0.01 / domain |

**Caching:** Results cached for 24 hours in `kv_store` to control costs. Cache is tenant-scoped.

**Rate limits:** 2,000 requests/minute. Batch operations are queued.

**Failure behaviour:** Returns cached data if available. Falls back to AI-estimated values with a visible "data unavailable" label — never silently empty.

**If missing:** All SEO features (SERP Tracker, Keyword Explorer, Backlink Explorer, Content Gaps, On-Page Audit, Content Scorer) return AI estimates only. Embeddable Audit Widget cannot produce real scores. DataForSEO is the single most impactful non-AI integration — configure before launch.

---

### 3.2 Firecrawl 🔴 Day 1 Required

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `FIRECRAWL_API_KEY` |
| **Base URL** | `https://api.firecrawl.dev/v1/` |

**MVP features powered:**

| Firecrawl endpoint | Feature(s) powered |
|---|---|
| `POST /scrape` (single URL) | Competitor Profiles · Pricing Watcher · InstaReports · Content Scorer · Voice of Customer |
| `POST /crawl` (multi-page, up to 50) | AutoSEO Pro (full-site crawl) · Content Gaps vs Rivals |
| `POST /extract` (AI-schema extraction) | Battle Cards · ICP Studio (extract competitor claims) |

**SSRF protection:** Every URL passed to Firecrawl is validated against a strict blocklist before the request. Private IP ranges (`10.x`, `192.168.x`, `127.x`, `localhost`, `*.internal`) are rejected with a 400 error — never forwarded.

**If missing:** Competitor Profiles and Battle Cards fall back to AI-generated intelligence without live website data (significantly lower accuracy). InstaReports produces an audit without live page analysis. Pricing Watcher cannot track real prices. This is a significant MVP capability gap — configure before launch.

---

### 3.3 Apollo 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `APOLLO_API_KEY` |
| **Base URL** | `https://api.apollo.io/v1/` |

**MVP features powered:**

| Apollo endpoint | Feature |
|---|---|
| `POST /mixed_people/search` | Lead Generation (find contacts by title/industry/company) |
| `POST /people/match` | Lead enrichment (add email, LinkedIn URL to a contact) |
| `POST /organizations/enrich` | Company firmographic data for Battle Cards |

**Apollo quirk (important):** Apollo returns HTTP 200 even for invalid API keys — the response body simply contains empty results. InfoGenie's platform key tester is aware of this and validates by checking result count + shape, not HTTP status code.

**If missing:** Lead Generation falls back to Perplexity sonar AI research (lower data quality, no guaranteed email addresses). LinkedIn Outreach uses AI-researched contacts only. Acceptable for MVP but reduce lead quality significantly — prioritise configuring.

---

### 3.4 BuiltWith 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `BUILTWITH_API_KEY` |
| **Base URL** | `https://api.builtwith.com/v21/api.json` |

**MVP features powered:** Tech Stack Detector · Competitor Profiles (technology section) · InstaReports (tech stack tab)

**Key data returned per domain:** CMS, analytics tools, ad pixels, ecommerce platform, CDN, email service provider, JavaScript frameworks, A/B testing tools.

**BuiltWith quirk:** Like Apollo, BuiltWith returns HTTP 200 with an `Errors` key in the response body when the API key is invalid. The platform key tester checks for `Errors` in the response, not just HTTP status.

**If missing:** Tech Stack Detector is disabled. Competitor Profiles omit the technology section. InstaReports shows AI-estimated tech stack only.

---

### 3.5 Google PageSpeed Insights 🔴 Day 1 Required

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `GOOGLE_PAGESPEED_API_KEY` |
| **Endpoint** | `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` |
| **Auth** | API key in `?key=` query param |

**MVP features powered:**
InstaReports (real Lighthouse scores — Performance, SEO, Accessibility, Best Practices 0–100) · Web Vitals Auditor (LCP, FID/INP, CLS) · On-Page SEO Audit (opportunities + estimated savings) · Embeddable Audit Widget

**Data returned per call:**
- Lighthouse scores: Performance / SEO / Accessibility / Best Practices (0–100)
- Core Web Vitals: LCP, FID/INP, CLS with pass/fail thresholds
- Specific optimisation opportunities with estimated time savings

**Rate limits:** Free tier = 25,000 requests/day. More than sufficient for MVP.

**If missing:** InstaReports falls back to AI-estimated scores with a disclosure note. Embeddable Audit Widget shows partial results. This directly impacts the showcase feature (InstaReports) — configure before launch.

---

### 3.6 Google Search (Custom Search API) 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `GOOGLE_SEARCH_API_KEY` |
| **Endpoint** | `https://www.googleapis.com/customsearch/v1` |
| **Rate limits** | 100 queries/day free · 10,000/day paid |

**MVP features powered:** Competitor monitoring (brand mentions) · Question Mining (cross-reference search results) · Alert Routing (news mention triggers)

**If missing:** Search-result based features degrade to Perplexity or OpenAI alternatives. Not a hard blocker.

---

## Section 4 — Communication & Email

### 4.1 Resend 🔴 Day 1 Required

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `RESEND_API_KEY` |
| **From address** | `RESEND_FROM_EMAIL` — must be a **verified Resend domain** |
| **Webhook secret** | `RESEND_WEBHOOK_SECRET` |
| **SDK** | `resend` npm package |

**MVP features powered:**
Auth flows (email verification, password reset, team invitations) · Weekly Report (auto Monday email) · Daily Digest · InstaReports (prospect report delivery via email) · Journey Builder email actions · Drip Engine sequences · Alert Routing · Omnichannel Composer email sends · Email Warm-Up (infrastructure sends)

**Webhook events handled:**

| Resend event | InfoGenie action |
|---|---|
| `email.delivered` | Mark send record `delivered` |
| `email.opened` | Record open timestamp; fire `email_open` signal to Journey Builder |
| `email.clicked` | Record click; fire `email_click` signal to Journey Builder |
| `email.bounced` | Mark contact `hard_bounce`; suppress from future sends |
| `email.complained` | Unsubscribe contact; add to suppression list |

**⚠️ Critical:** `RESEND_FROM_EMAIL` must use a domain verified in the Resend dashboard. Emails sent from unverified domains are silently dropped by Resend — no error is returned. This is the most common setup mistake.

For development and testing, use `onboarding@resend.dev` (Resend's pre-verified sandbox sender).

**Webhook verification:** All incoming webhooks verified via HMAC-SHA256 using `RESEND_WEBHOOK_SECRET` before any state change.

**If missing:** Auth emails don't send (users can't verify accounts). Weekly reports aren't delivered. InstaReports can be viewed on-screen but not emailed. This breaks the core product — configure before launch.

---

### 4.2 Twilio (SMS & Voice) 🟢 Post-MVP

| Env var | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Account identifier |
| `TWILIO_AUTH_TOKEN` | Auth credential |
| `TWILIO_FROM_NUMBER` | Sending phone number |

**MVP features powered (if configured):** Omnichannel Composer SMS sends · Journey Builder SMS actions · Re-engagement Agent SMS channel

**If missing:** SMS channel is hidden from UI automatically. No silent failures. Journey Builder and Omnichannel run email-only at MVP. Acceptable for launch.

---

### 4.3 WhatsApp Business API 🟢 Post-MVP

| Env var | Purpose |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Sending number |
| `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API token |
| `WHATSAPP_VERIFY_TOKEN` | Webhook hub verification |
| `WHATSAPP_APP_SECRET` | Inbound event HMAC verification |

**Webhook endpoint:** `POST /api/webhooks/whatsapp`

**If missing:** WhatsApp channel is hidden from UI. Email-only fallback is seamless. Post-MVP addition.

---

### 4.4 VAPI (AI Voice Calls) 🟢 Post-MVP

| Env var | Purpose |
|---|---|
| `VAPI_API_KEY` | Auth |
| `VAPI_PHONE_NUMBER_ID` | Outbound calling number |
| `VAPI_WEBHOOK_SECRET` | Inbound webhook verification |

**If missing:** Voice channel hidden from UI. No impact on MVP.

---

### 4.5 Web Push / VAPID 🟢 Post-MVP

| Env var | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY` | Served to browser for service worker subscription |
| `VAPID_PRIVATE_KEY` | Server-side push signing |
| `VAPID_SUBJECT` | Contact email for push service |

**Setup:** Generate once with `web-push generate-vapid-keys`. Keys must match — regenerating invalidates all existing browser subscriptions.

**If missing:** Push notifications hidden from Omnichannel and Journey Builder. No impact on MVP.

---

## Section 5 — CRM & Marketing Automation

### 5.1 HubSpot 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env var** | `HUBSPOT_PRIVATE_APP_TOKEN` |
| **Auth** | `Authorization: Bearer {token}` |
| **API version** | v3 |
| **Base URL** | `https://api.hubapi.com/` |

**MVP features powered:**

| HubSpot endpoint | Feature |
|---|---|
| `POST /crm/v3/objects/contacts` | Push enriched leads from Lead Generation |
| `PATCH /crm/v3/objects/contacts/{id}` | Update contact on email event (click, open) |
| `POST /crm/v3/lists` | Create HubSpot Static List per Dynamic Audience segment |
| `PUT /crm/v3/lists/{id}/memberships/add-from-search` | Sync audience members to HubSpot list |
| `GET /crm/v3/objects/contacts/search` | Look up existing contacts to avoid duplication |
| `POST /crm/v3/objects/deals` | Create deal from qualified lead |

**Sync behaviour:** Dynamic Audience sweep runs every 15 minutes. HubSpot list mirror runs after each sweep when changes are detected. All mutations gated by `global._dripStore.lock` to prevent concurrent sync conflicts.

**If missing:** Lead Generation results are not pushed to HubSpot. Dynamic Audience segments do not mirror to HubSpot Static Lists. Internal lead table still works — HubSpot sync is additive. Acceptable for MVP without HubSpot; configure for users who use HubSpot.

---

## Section 6 — Analytics & Monitoring

### 6.1 Amplitude 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY` |
| **Ingestion endpoint** | `https://api.amplitude.com/2/httpapi` |

**MVP events tracked (server-side):**

| Event name | Trigger |
|---|---|
| `user_signed_up` | New account created |
| `ai_action_completed` | Any AI generation completes successfully |
| `campaign_launched` | Campaign submitted to Meta / Google / TikTok |
| `report_sent` | Weekly report or InstaReport emailed |
| `competitor_profile_created` | First competitor profile saved |
| `insta_report_viewed` | Prospect opens their public report link |
| `platform_key_updated` | Admin changes a platform API key (key name only, never value) |

**Privacy:** No PII in any event properties. User identity sent as internal UUID only.

**If missing:** Product analytics are unavailable. No impact on user-facing features. Configure for team visibility into adoption and engagement.

---

### 6.2 Google Analytics 4 🧊 Blocked

Currently parked. Google Workspace organisational policy blocks the OAuth scope required for GA4 data API access. Will revisit post-PMF. Do not attempt to configure at MVP.

---

## Section 7 — Payments

### 7.1 Stripe 🟡 Day 1 Important

| Property | Value |
|---|---|
| **Key type** | Platform Key |
| **Env vars** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| **SDK** | `stripe` npm package |
| **Webhook endpoint** | `POST /api/webhooks/stripe` |

**MVP features powered:** Subscription billing (Starter / Growth / Agency tiers) · Usage billing for AI credits · Link-in-Bio Stripe payment links

**Webhook events handled:**

| Stripe event | InfoGenie action |
|---|---|
| `checkout.session.completed` | Activate subscription, set tenant tier |
| `customer.subscription.updated` | Update tier limits and feature access |
| `customer.subscription.deleted` | Downgrade to free; lock paid features |
| `invoice.payment_failed` | Send payment failure email; start grace period |

**Webhook verification:** All events verified with `stripe.webhooks.constructEvent()` using `STRIPE_WEBHOOK_SECRET`. No state change before verification passes.

**If missing:** Subscription billing is non-functional. Users remain on a single default tier. Acceptable for a closed beta / invite-only launch, but configure before public launch.

---

## Section 8 — Social Login (Auth)

These three integrations enable "Sign in with Google/Facebook/Microsoft" buttons on the login page. If any env vars are absent, that button is automatically hidden — no error shown to users.

### 8.1 Google OAuth Login 🟢 Post-MVP

| Env var | Value |
|---|---|
| `AUTH_GOOGLE_CLIENT_ID` | OAuth client ID |
| `AUTH_GOOGLE_CLIENT_SECRET` | OAuth client secret |
| **Callback** | `/api/auth/oauth/google/callback` |
| **Scopes** | `openid email profile` |

### 8.2 Facebook OAuth Login 🟢 Post-MVP

| Env var | Value |
|---|---|
| `AUTH_FACEBOOK_CLIENT_ID` | OAuth client ID |
| `AUTH_FACEBOOK_CLIENT_SECRET` | OAuth client secret |
| **Callback** | `/api/auth/oauth/facebook/callback` |

### 8.3 Microsoft OAuth Login 🟢 Post-MVP

| Env var | Value |
|---|---|
| `AUTH_MICROSOFT_CLIENT_ID` | OAuth client ID |
| `AUTH_MICROSOFT_CLIENT_SECRET` | OAuth client secret |
| **Callback** | `/api/auth/oauth/microsoft/callback` |

Note: Microsoft credentials serve double duty — social login and Microsoft Ads authentication.

---

## Section 9 — Workspace Integrations

### 9.1 Google Workspace OAuth 🟢 Post-MVP

| Property | Value |
|---|---|
| **Key type** | Per-user vault |
| **Vault key** | `google_workspace` |
| **Env vars** | `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET` |
| **Callback** | `/api/integrations/workspace/oauth/callback` |
| **Scopes** | Gmail read/send · Google Drive · Google Calendar |

**Powers:** Email reading in Conversation Inbox · Calendar-aware Journey Builder · Drive file attachment in campaigns.

**If missing:** Google Workspace tab in Settings shows a "connect" button; features gracefully unavailable until connected.

---

## Section 10 — File Storage

### 10.1 Local Filesystem (MVP) ⚠️

User-uploaded brand assets (logos, images) are stored in `uploads/` on the VM. Served at `/uploads/{filename}`.

**Limits:** 10MB per file · 200MB total per tenant.

**⚠️ Post-MVP action required:** VM filesystem is not durable for production multi-region deployments. Migrate to Cloudflare R2 or AWS S3 after MVP. This is a known technical debt item — document it before launch.

---

## Section 11 — Public-Facing Endpoints

These are InfoGenie-generated endpoints consumed by third parties or embedded in user websites.

| Endpoint | Auth | Used by | Rate limit |
|---|---|---|---|
| `POST /api/funnel-analytics/track` | None (pixel) | Funnel analytics JS pixel embedded on user sites | Hashed IP |
| `GET /api/insta-reports/public/:token` | None (token) | Prospects opening their emailed audit report | None (token is secret) |
| `GET /book/:slug` + `POST /api/bookings/:slug` | None | Clients booking via Link-in-Bio | IP-based |
| `POST /api/push/subscribe` | Session auth | Browser push service worker registration | Per-user |
| `GET /lp/:id` | None | Landing pages served to ad traffic | IP-based |
| `POST /api/landing-pages/lead/:pageId` | None | Lead capture form on landing pages | IP-based |

**Rate limiting note:** All public routes use `req.socket.remoteAddress` for IP rate limiting — NOT `req.ip`. This is intentional: `req.ip` is spoofable via `X-Forwarded-For` headers. Never change this without a security review.

---

## Section 12 — Environment Variables Reference

### Complete Day 1 Required Set (minimum to go live)

```bash
# Core security
CREDENTIAL_ENCRYPTION_KEY=<32-byte base64 string from openssl rand -base64 32>
SESSION_SECRET=<random secret>
INFOGENIE_API_KEY=<random token for API gate>

# Database
DATABASE_URL=<PostgreSQL connection string>

# AI
AI_INTEGRATIONS_OPENAI_API_KEY=<key>

# Data & intelligence
DATAFORSEO_LOGIN=<login>
DATAFORSEO_PASSWORD=<password>
FIRECRAWL_API_KEY=<key>
GOOGLE_PAGESPEED_API_KEY=<key>

# Email
RESEND_API_KEY=<key>
RESEND_FROM_EMAIL=<verified@yourdomain.com>
RESEND_WEBHOOK_SECRET=<key>

# Ad platforms (at least one)
META_ACCESS_TOKEN=<long-lived system token>
META_AD_ACCOUNT_ID=<act_NNNN>
GOOGLE_ADS_DEVELOPER_TOKEN=<key>
GOOGLE_ADS_OAUTH_CLIENT_ID=<key>
GOOGLE_ADS_OAUTH_CLIENT_SECRET=<key>

# Public URL (required for OAuth callbacks)
PUBLIC_URL=https://your-app.replit.app
```

### Full Day 1 Important Set (configure within first week)

```bash
# Additional AI providers
AI_INTEGRATIONS_ANTHROPIC_API_KEY=<key>
GEMINI_API_KEY=<key>
PERPLEXITY_API_KEY=<key>

# Additional data APIs
APOLLO_API_KEY=<key>
BUILTWITH_API_KEY=<key>
GOOGLE_SEARCH_API_KEY=<key>

# CRM
HUBSPOT_PRIVATE_APP_TOKEN=<key>

# Payments
STRIPE_SECRET_KEY=<key>
STRIPE_WEBHOOK_SECRET=<key>

# Analytics
AMPLITUDE_API_KEY=<key>
AMPLITUDE_SECRET_KEY=<key>

# TikTok (if target audience uses TikTok ads)
TIKTOK_ACCESS_TOKEN=<key>
TIKTOK_ADVERTISER_ID=<id>
TIKTOK_RAPIDAPI_KEY=<key>
```

### Post-MVP Set (configure after launch)

```bash
# Social login
AUTH_GOOGLE_CLIENT_ID=<key>
AUTH_GOOGLE_CLIENT_SECRET=<key>
AUTH_FACEBOOK_CLIENT_ID=<key>
AUTH_FACEBOOK_CLIENT_SECRET=<key>
AUTH_MICROSOFT_CLIENT_ID=<key>
AUTH_MICROSOFT_CLIENT_SECRET=<key>

# Messaging channels
TWILIO_ACCOUNT_SID=<sid>
TWILIO_AUTH_TOKEN=<token>
TWILIO_FROM_NUMBER=<+1XXXXXXXXXX>
WHATSAPP_PHONE_NUMBER_ID=<id>
WHATSAPP_ACCESS_TOKEN=<token>
WHATSAPP_VERIFY_TOKEN=<random>
WHATSAPP_APP_SECRET=<secret>
VAPI_API_KEY=<key>
VAPI_PHONE_NUMBER_ID=<id>
VAPI_WEBHOOK_SECRET=<secret>

# Push notifications
VAPID_PUBLIC_KEY=<key>
VAPID_PRIVATE_KEY=<key>
VAPID_SUBJECT=mailto:team@yourdomain.com

# Microsoft Ads
MICROSOFT_ADS_CLIENT_ID=<key>
MICROSOFT_ADS_CLIENT_SECRET=<key>
MICROSOFT_ADS_REFRESH_TOKEN=<token>
MICROSOFT_ADS_DEVELOPER_TOKEN=<key>
MICROSOFT_ADS_CUSTOMER_ID=<id>

# Cloudflare AI (fallback LLM)
CLOUDFLARE_ACCOUNT_ID=<id>
CLOUDFLARE_AI_TOKEN=<token>

# Slack alerts
SLACK_WEBHOOK_URL=<url>

# Misc
BING_WEBMASTER_API_KEY=<key>
GOOGLE_MERCHANT_CENTER_ID=<id>
RAPIDAPI_KEY=<key>
ZERNIO_API_KEY=<key>
```

---

## Section 13 — Integration Health Monitoring

The **🔑 Platform APIs** admin tab provides a live test button for each configured key. Tests are non-destructive read-only probes.

| Integration | Test method | Success signal | Known quirk |
|---|---|---|---|
| OpenAI | `GET /v1/models` | HTTP 200 + model list | — |
| Anthropic | `GET /v1/models` | HTTP 200 | — |
| Gemini | `GET /v1beta/models?key=` | HTTP 200 | Returns 400 (not 401) on bad key |
| Perplexity | Minimal chat completion | HTTP 200 | — |
| Cloudflare | `GET /accounts/{id}/ai/models/search` | HTTP 200 | — |
| DataForSEO | `GET /v3/appendix/user_data` | HTTP 200 | — |
| Firecrawl | `GET /v1/` (health) | HTTP 200 | — |
| Apollo | `POST /people/search` (empty query) | HTTP 200 + check result shape | Returns 200 on bad key with empty results |
| BuiltWith | `GET /?KEY=&LOOKUP=example.com` | HTTP 200 + no `Errors` key | Returns 200 + `Errors` on bad key |
| Google PageSpeed | `GET /runPagespeed?url=https://example.com&key=` | HTTP 200 | — |
| Resend | `GET /emails` | HTTP 200 | — |
| HubSpot | `GET /crm/v3/objects/contacts?limit=1` | HTTP 200 | — |
| Amplitude | `GET /amplitude/health` | HTTP 200 | — |
| Stripe | `GET /v1/customers?limit=1` | HTTP 200 | — |
| Meta Ads | `GET /{ad_account}/campaigns?fields=id` | HTTP 200 | — |

---

## Section 14 — Failure Behaviour Summary

This table defines what users see when an integration is unavailable.

| Integration | Feature affected | Failure experience |
|---|---|---|
| OpenAI down | All AI generation | Falls back: Claude → Gemini → template. Shows "Generated from template" label. Never silently empty. |
| DataForSEO quota | Keyword / SEO features | Returns cached data (24h TTL). If no cache, shows AI estimate with "data unavailable" label. |
| Firecrawl down | Competitor Profiles, InstaReports | Returns AI-generated profile without live web data. Labelled as "AI-researched". |
| Resend unverified domain | All outbound emails | Email silently dropped by Resend. In dev, use `onboarding@resend.dev`. |
| Meta token expired | Campaign Launch, Ad Library | "Reconnect Meta account" prompt shown. Existing data displayed; new data blocked. |
| Google Ads OAuth expired | Google campaign features | "Reconnect Google Ads" prompt. Same pattern as Meta. |
| Apollo unavailable | Lead Generation | Falls back to Perplexity sonar research. Lower data quality but no hard failure. |
| HubSpot token revoked | CRM sync | Sync silently skipped (logged). Internal lead table unaffected. User sees "HubSpot sync paused" in settings. |
| Stripe key invalid | Subscription billing | No tier changes possible. Users stay on current tier. No user-facing error unless they try to upgrade. |

---

## Section 15 — Day 1 Go-Live Checklist

Use this to verify the environment is ready before flipping the deployment to live.

```
SECURITY
[ ] CREDENTIAL_ENCRYPTION_KEY is a fresh 32-byte base64 key (openssl rand -base64 32)
[ ] SESSION_SECRET set (not INFOGENIE_API_KEY reused)
[ ] INFOGENIE_API_KEY set for API gate
[ ] DATABASE_URL points to production PostgreSQL

AI
[ ] AI_INTEGRATIONS_OPENAI_API_KEY — live test passes in Platform APIs tab

DATA & INTELLIGENCE
[ ] DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD — live test passes
[ ] FIRECRAWL_API_KEY — live test passes
[ ] GOOGLE_PAGESPEED_API_KEY — test: returns scores for example.com

EMAIL
[ ] RESEND_API_KEY set
[ ] RESEND_FROM_EMAIL is a verified domain in Resend dashboard (not @resend.dev)
[ ] RESEND_WEBHOOK_SECRET set and webhook registered in Resend dashboard

AD PLATFORMS (at least one)
[ ] META_ACCESS_TOKEN + META_AD_ACCOUNT_ID — test: fetch campaigns returns HTTP 200
[ ] GOOGLE_ADS_DEVELOPER_TOKEN set
[ ] GOOGLE_ADS_OAUTH_CLIENT_ID + SECRET set
[ ] OAuth callback URI whitelisted in Google Cloud Console

PUBLIC URL
[ ] PUBLIC_URL set to production domain (required for all OAuth callbacks)
[ ] Resend webhook URL updated to production URL

DEPLOYMENT TYPE
[ ] deploy=vm confirmed in .replit (required for cron/optimizer/journey ticks)
[ ] npm run build:next succeeds before deploy
[ ] npm start boots without errors (scripts/start.js)
```

---

*Document owner: Engineering / Product*  
*Review cadence: Updated each time a new integration is added or an existing one changes auth model*
