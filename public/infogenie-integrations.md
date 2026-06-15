# InfoGenie — Complete API, LLM & Token Reference
### Integration Status as of June 2026

---

## Quick Summary

| Status | Count | Meaning |
|---|---|---|
| ✅ **Active** | 30 keys | Set in environment — working right now |
| ⚠️ **Partial** | 6 keys | Some vars set, others missing — feature limited |
| ❌ **Not Connected** | 35 keys | Code is built and ready, just needs the key |

---

## 🤖 AI / LLM Providers

| Key(s) | Provider | Model(s) Used | Status | Notes |
|---|---|---|---|---|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | **OpenAI** | GPT-4o, GPT-4o-mini, TTS, DALL·E | ✅ Active | Via Replit integration. Powers most AI features |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | **Anthropic** | Claude 3.5 Sonnet, Claude 3 Haiku | ✅ Active | Via Replit integration |
| `GEMINI_API_KEY` | **Google Gemini** | Gemini 1.5 Flash, Gemini 1.5 Pro | ✅ Active | |
| `PERPLEXITY_API_KEY` | **Perplexity** | Sonar (web-search LLM) | ✅ Active | Used for real-time web research across 20+ features |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_TOKEN` | **Cloudflare Workers AI** | Llama 3.1 8B | ✅ Active | Cheapest inference option |
| `DEEPSEEK_API_KEY` | **DeepSeek** | DeepSeek-V3 / R1 | ❌ Not Connected | Code ready — get key at platform.deepseek.com |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Direct aliases | — | ⚠️ Partial | Not set — the `AI_INTEGRATIONS_*` keys are the active ones |

---

## 📊 Data & Research APIs

| Key(s) | Provider | What It Powers | Status | Notes |
|---|---|---|---|---|
| `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | **DataForSEO** | SERP Tracker, Keyword Explorer, Backlink Intel, Pulse | ✅ Active | Login/password pair, not a key |
| `FIRECRAWL_API_KEY` | **Firecrawl** | Pricing Watcher, Newsletter Tracker, Change Monitor, Web Extractor, Resilient Tracker | ✅ Active | |
| `APOLLO_API_KEY` | **Apollo.io** | Lead Aggregator (B2B prospecting) | ✅ Active | |
| `BUILTWITH_API_KEY` | **BuiltWith** | Tech Stack Detector | ✅ Active | |
| `GOOGLE_PAGESPEED_API_KEY` | **Google PageSpeed** | Web Vitals Auditor | ✅ Active | |
| `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` | **Google Custom Search** | Search & AI Visibility, various search features | ✅ Active | `GOOGLE_SEARCH_ENGINE_ID` alias missing — minor |
| `SERP_API_KEY` | **SerpAPI** | Supplementary SERP data | ✅ Active | |
| `RAPIDAPI_KEY` + `RAPIDAPI_EMAIL_KEY` | **RapidAPI** | Email verification, misc API marketplace calls | ✅ Active | |
| `REMOVE_BG_API_KEY` | **Remove.bg** | Background removal for brand assets | ✅ Active | |
| `SEMRUSH_API_KEY` | **Semrush** | SEO competitive data (supplementary) | ❌ Not Connected | Per-user vault key — users connect their own |
| `HUNTER_API_KEY` | **Hunter.io** | Email finder / verification | ❌ Not Connected | Code ready at `services/hunter/` |
| `APIFY_API_KEY` | **Apify** | Advanced web scraping pipelines | ❌ Not Connected | Code ready at `services/apify/` |
| `PROFOUND_API_KEY` | **Profound.co** | GEO Audit (Generative Engine Optimisation) | ❌ Not Connected | Code ready — sign up at profound.co |

---

## 📣 Ad Platforms

| Key(s) | Platform | What It Powers | Status | Notes |
|---|---|---|---|---|
| `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` | **Meta Ads** | Meta Ads Insights, Ad Library Spy, Campaign Launch | ✅ Active | Platform-level token |
| `META_APP_ID` + `META_APP_SECRET` + `META_OAUTH_CLIENT_ID` + `META_OAUTH_CLIENT_SECRET` | **Meta OAuth** | Per-user Meta Ads OAuth Connect | ❌ Not Connected | Needed for users to connect their own Meta accounts |
| `GOOGLE_ADS_DEVELOPER_TOKEN` + `GOOGLE_ADS_CLIENT_ID` + `GOOGLE_ADS_REFRESH_TOKEN` | **Google Ads** | Google Ads Insights, Campaign Launch, AI Optimizer | ✅ Active | Platform owner credentials |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` + `GOOGLE_ADS_OAUTH_CLIENT_SECRET` | **Google Ads OAuth** | Per-user Google Ads OAuth Connect | ❌ Not Connected | Needed for users to connect their own Google Ads |
| `GOOGLE_MERCHANT_CENTER_ID` | **Google Merchant Center** | Shopping campaign launches | ❌ Not Connected | Optional — only needed for Shopping ads |
| `TIKTOK_ACCESS_TOKEN` + `TIKTOK_ADVERTISER_ID` | **TikTok Ads** | TikTok Ads Insights, Ad Library Spy | ✅ Active | |
| `TIKTOK_RAPIDAPI_KEY` | **TikTok via RapidAPI** | TikTok Downloader (fallback when primary fails) | ❌ Not Connected | Optional — primary tikwm.com route still works |
| `MICROSOFT_ADS_DEVELOPER_TOKEN` + `MICROSOFT_ADS_CLIENT_ID` + `MICROSOFT_ADS_CLIENT_SECRET` + `MICROSOFT_ADS_ACCOUNT_ID` + `MICROSOFT_ADS_CUSTOMER_ID` + `MICROSOFT_ADS_REFRESH_TOKEN` | **Microsoft Ads (Bing)** | Microsoft Ads Insights, Campaign Launch | ❌ Not Connected | All 5+ vars needed. Apply at ads.microsoft.com |

---

## 🔗 CRM & Marketing Automation

| Key(s) | Provider | What It Powers | Status | Notes |
|---|---|---|---|---|
| `HUBSPOT_PRIVATE_APP_TOKEN` | **HubSpot** | HubSpot Sync, Dynamic Audiences → HS Lists, Lead push | ✅ Active | |
| `HUBSPOT_WEBHOOK_SECRET` | **HubSpot Webhooks** | HMAC-validates inbound HubSpot events | ❌ Not Connected | Optional — only needed for inbound webhooks from HubSpot |
| `MAILCHIMP_API_KEY` + `MAILCHIMP_SERVER_PREFIX` | **Mailchimp** | Email list sync, broadcast | ❌ Not Connected | Code ready at `services/` |
| `CONVERTKIT_API_KEY` | **ConvertKit / Kit** | Email automation sync | ❌ Not Connected | Code ready |
| `ACTIVECAMPAIGN_API_KEY` + `ACTIVECAMPAIGN_BASE_URL` | **ActiveCampaign** | Email automation sync | ❌ Not Connected | Code ready |

---

## 📧 Email & Messaging

| Key(s) | Provider | What It Powers | Status | Notes |
|---|---|---|---|---|
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` + `RESEND_WEBHOOK_SECRET` | **Resend** | All transactional email (auth, alerts, digests, weekly report, cold email send) | ✅ Active | `RESEND_FROM_EMAIL` must be a verified Resend domain or `onboarding@resend.dev` for testing |
| `SLACK_WEBHOOK_URL` | **Slack** | Crisis Radar alerts, Smart Alert Routing, Daily Digest | ✅ Active | |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` | **Twilio** | SMS channel in Omnichannel Composer, Journey Builder | ❌ Not Connected | Sign up at twilio.com |
| `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_VERIFY_TOKEN` + `WHATSAPP_APP_SECRET` | **WhatsApp Business** | WhatsApp channel in Omnichannel Composer | ❌ Not Connected | Requires Meta Business verified number |
| `VAPI_API_KEY` + `VAPI_PHONE_NUMBER_ID` + `VAPI_WEBHOOK_SECRET` | **Vapi** | AI voice calling in Journey Builder, outreach | ❌ Not Connected | Sign up at vapi.ai |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` | **Web Push (VAPID)** | Browser push notifications | ❌ Not Connected | Generate free with `npx web-push generate-vapid-keys` |

---

## 🔍 SEO & Analytics

| Key(s) | Provider | What It Powers | Status | Notes |
|---|---|---|---|---|
| `AMPLITUDE_API_KEY` + `AMPLITUDE_SECRET_KEY` | **Amplitude** | Product analytics, event tracking | ✅ Active | |
| `POSTHOG_API_KEY` | **PostHog** | Session recording, heatmaps, funnels | ✅ Active | |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Google Service Account** | Google APIs requiring service-account auth | ✅ Active | Used for various Google platform calls |
| `APPSFLYER_API_TOKEN` + `APPSFLYER_APP_ID` | **AppsFlyer** | Mobile attribution | ❌ Not Connected | Code ready |

---

## 💳 Payments

| Key(s) | Provider | What It Powers | Status | Notes |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | **Stripe** | Subscription billing, payment flows | ❌ Not Connected | Sign up at stripe.com — required if monetising the platform |

---

## 🛒 E-Commerce

| Key(s) | Provider | What It Powers | Status | Notes |
|---|---|---|---|---|
| `SHOPIFY_ADMIN_TOKEN` + `SHOPIFY_SHOP` | **Shopify** | Shopify store sync, product data | ❌ Not Connected | Per-user vault or env for owner's store |

---

## 🔐 Auth & Social Login

| Key(s) | Provider | What It Powers | Status | Notes |
|---|---|---|---|---|
| `AUTH_GOOGLE_CLIENT_ID` + `AUTH_GOOGLE_CLIENT_SECRET` | **Google OAuth** | "Sign in with Google" button | ❌ Not Connected | Missing = button hidden on login screen |
| `AUTH_FACEBOOK_CLIENT_ID` + `AUTH_FACEBOOK_CLIENT_SECRET` | **Facebook OAuth** | "Sign in with Facebook" button | ❌ Not Connected | Missing = button hidden |
| `AUTH_MICROSOFT_CLIENT_ID` + `AUTH_MICROSOFT_CLIENT_SECRET` | **Microsoft OAuth** | "Sign in with Microsoft" button | ❌ Not Connected | Missing = button hidden |
| `GOOGLE_WORKSPACE_CLIENT_ID` + `GOOGLE_WORKSPACE_CLIENT_SECRET` | **Google Workspace** | Gmail, Google Drive, Google Calendar integration | ❌ Not Connected | Per-user OAuth connect; service blocked by Workspace org policy currently |

---

## ⚙️ Platform / Infrastructure

| Key(s) | What It Does | Status | Notes |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | ✅ Active | Replit-managed Postgres |
| `INFOGENIE_API_KEY` | API gate + LLM quota enforcement + programmatic access | ✅ Active | |
| `SESSION_SECRET` | Signs the `infogenie.sid` session cookie | ✅ Active | |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256-GCM key for the per-user credential vault | ❌ Not Connected | **Required in production.** Generate with `openssl rand -base64 32` |
| `PUBLIC_URL` | Base URL for OAuth redirect URIs and embed widgets | ⚠️ Partial | Falls back to `https://$REPL_SLUG.replit.app` — set explicitly in prod |

---

## Priority: What To Connect Next

### 🔴 High Priority (unlocks major features)

| What | Why |
|---|---|
| `CREDENTIAL_ENCRYPTION_KEY` | Without this, the per-user credential vault doesn't work in production. Required for any real deployment. |
| `META_APP_ID` + `META_APP_SECRET` + `META_OAUTH_CLIENT_ID/SECRET` | Lets each user connect their own Meta Ads account — right now only the platform owner's token is used |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` + `SECRET` | Same for Google Ads — enables per-user connection |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Required if you want to charge users/subscriptions through the platform |
| `TWILIO_ACCOUNT_SID/TOKEN/NUMBER` | Unlocks SMS channel across Journey Builder + Omnichannel Composer |

### 🟡 Medium Priority (extends reach)

| What | Why |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` + secrets | WhatsApp is the highest-engagement messaging channel |
| `MICROSOFT_ADS_*` (5 vars) | Microsoft/Bing Ads reach ~30% of desktop search — fully built, just needs keys |
| `AUTH_GOOGLE_CLIENT_ID/SECRET` | Social login dramatically reduces sign-up friction |
| `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT` | Free to generate — unlocks browser push notifications immediately |
| `MAILCHIMP_API_KEY` | Many users already have Mailchimp lists |

### 🟢 Nice To Have (power features)

| What | Why |
|---|---|
| `DEEPSEEK_API_KEY` | Very cheap inference — good cost backup for GPT-4o-mini tasks |
| `VAPI_API_KEY` | AI voice calling for outreach — unique channel vs. competitors |
| `PROFOUND_API_KEY` | Needed for GEO Audit (how well your brand appears in AI search answers) |
| `HUNTER_API_KEY` | Email verification at scale improves lead quality |
| `CONVERTKIT_API_KEY` / `ACTIVECAMPAIGN_API_KEY` | Sync audiences to whichever email tool users already pay for |
| `APIFY_API_KEY` | More robust scraping fallback for heavy research tasks |
| `TIKTOK_RAPIDAPI_KEY` | Fallback when TikTok Downloader's primary source gets rate-limited |
| `AUTH_FACEBOOK_CLIENT_ID` / `AUTH_MICROSOFT_CLIENT_ID` | More social login options |
| `SHOPIFY_ADMIN_TOKEN` + `SHOPIFY_SHOP` | Shopify store sync for e-commerce users |

---

## How Keys Are Stored

InfoGenie uses two secure stores:

**1. Platform API Keys (admin-managed, `platform_api_keys` table)**
These are keys the platform pays for and shares across all users — OpenAI, Anthropic, Gemini, Perplexity, Cloudflare, DataForSEO, Firecrawl, Apollo, Zernio, BuiltWith, PageSpeed, Google Search, Resend, Amplitude, Stripe, VAPID. Managed via the **🔑 Platform APIs** admin tab (`GET/PUT /api/admin/platform-keys`). Values in the DB override environment variables at boot.

**2. Per-User Credential Vault (`services/credentials/vault.js`)**
Each user's own ad platform credentials (their Google Ads, Meta, Microsoft accounts etc.) are stored encrypted per `(user_id, platform)` using AES-256-GCM. This requires `CREDENTIAL_ENCRYPTION_KEY` to be set. Users manage these via **Settings → Integrations**.

---

*Checked against live environment — June 15, 2026*
