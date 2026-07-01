# InfoGenie — Complete API, LLM & Token Reference

This document covers every external API, AI/LLM provider, OAuth flow, and credential used by InfoGenie — what each credential is, where to get it, what it is used for, and how it is stored.

---

## HOW CREDENTIALS ARE STORED

InfoGenie uses two credential stores:

### Platform API Keys (`platform_api_keys` table)
Keys that InfoGenie pays for on behalf of all users — AI models, data APIs, infrastructure services. Stored AES-256-GCM encrypted in the PostgreSQL `platform_api_keys` table. Managed by administrators only via **Manage → Settings → 🔑 Platform APIs**. At boot, decrypted values are overlaid onto `process.env` so all existing code readers work transparently. DB values override environment variables — the database is authoritative.

### Per-User Credential Vault (`services/credentials/vault.js`)
Keys tied to individual user accounts — their personal Google Ads tokens, Meta tokens, and other user-managed integrations. AES-256-GCM encrypted per `(user_id, platform)` pair in the vault. Never shared between users.

### Environment Variables
Some credentials are set at the infrastructure level as environment secrets in Replit and loaded at boot. Required production variables are documented below.

---

## REQUIRED BOOT CREDENTIALS

These must be present as environment secrets before InfoGenie can start in production:

| Variable | Purpose |
|----------|---------|
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte AES-256-GCM key used to encrypt/decrypt the credential vault. Generate with: `openssl rand -base64 32`. **Required in production — app will not boot without it.** |
| `SESSION_SECRET` | Signs the `infogenie.sid` session cookie (HttpOnly, SameSite=Lax, 30-day rolling). Falls back to `INFOGENIE_API_KEY` in development. |
| `DATABASE_URL` | PostgreSQL connection string. All feature data, users, sessions, and credentials are stored here. |
| `INFOGENIE_API_KEY` | Platform-level API gate key. Used to authenticate programmatic API clients (non-session callers) and enforce LLM quota. |

---

## AI & LLM PROVIDERS

InfoGenie routes AI tasks to different models based on task type. All AI provider keys are platform-managed (admin-configurable via **🔑 Platform APIs**).

### OpenAI

| Item | Detail |
|------|--------|
| **Env var** | `AI_INTEGRATIONS_OPENAI_API_KEY` |
| **Alias** | `OPENAI_API_KEY` (kept in sync automatically) |
| **Where to get** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Models used** | `gpt-5` (large — complex strategy, war room, storyboard), `gpt-5-mini` (default fallback — ad copy, summaries, bulk generation), `dall-e-3` (image generation) |
| **Used for** | Ad copy generation, campaign strategy, competitor analysis, content AI, battle cards, AI Competitor War Room, infographic generation, video storyboards, and as the primary LLM fallback across all tiers |
| **Notes** | `gpt-5` reasoning models require `max_completion_tokens` (not `max_tokens`), no `temperature`/`top_p`, and `reasoning_effort: 'minimal'`. This normalisation is handled automatically via `ai_compat.js` — do not pass these params manually at call sites. |

---

### Anthropic (Claude)

| Item | Detail |
|------|--------|
| **Env var** | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` |
| **Alias** | `ANTHROPIC_API_KEY` (kept in sync automatically) |
| **Where to get** | [console.anthropic.com](https://console.anthropic.com) |
| **Models used** | `claude-sonnet-4-6` (current default) |
| **Used for** | Deep competitive analysis, long-form strategy documents, Model Comparison (A/B prompts), and as an alternative LLM for any tier that supports multi-model selection |
| **API version header** | `anthropic-version: 2023-06-01` |

---

### Google Gemini

| Item | Detail |
|------|--------|
| **Env var** | `GEMINI_API_KEY` |
| **Where to get** | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| **Models used** | `gemini-pro` (text generation), `veo-003` (AI video generation via `/v1beta/models/veo-003:generateVideo`) |
| **Used for** | AI video generation (Creator Studio), GEO Audit AI visibility checks, Model Comparison, and as a third LLM option across content tiers |
| **Notes** | Key is passed as a query parameter (`?key=`) to the Gemini REST API, not as a Bearer token. |

---

### Perplexity

| Item | Detail |
|------|--------|
| **Env var** | `PERPLEXITY_API_KEY` |
| **Where to get** | [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api) |
| **Models used** | `sonar` (live web-grounded search) |
| **Used for** | Real-time web research, Reddit intelligence, GEO Audit (what AI assistants say about your brand), Intent Radar, and any feature requiring current information rather than training-data knowledge |
| **Base URL** | `https://api.perplexity.ai/chat/completions` |
| **Auth** | `Authorization: Bearer <key>` |

---

### Cloudflare Workers AI

| Item | Detail |
|------|--------|
| **Env vars** | `CLOUDFLARE_ACCOUNT_ID` (account identifier, not secret) + `CLOUDFLARE_AI_TOKEN` (API token, secret) |
| **Where to get** | [dash.cloudflare.com → AI → Workers AI](https://dash.cloudflare.com) |
| **Models used** | `@cf/meta/llama-3.1-8b-instruct` (Llama 3.1 8B) |
| **Used for** | Low-cost LLM fallback, high-volume generation tasks where cost efficiency is critical |
| **Base URL** | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}` |
| **Auth** | `Authorization: Bearer <CLOUDFLARE_AI_TOKEN>` |

---

### RapidAPI (Multi-model Hub)

| Item | Detail |
|------|--------|
| **Env var** | `RAPIDAPI_KEY` (alias: `RAPIDAPI_EMAIL_KEY` — kept in sync) |
| **Where to get** | [rapidapi.com](https://rapidapi.com) — create an account and subscribe to the relevant APIs |
| **Models/APIs accessed** | `meta-llama-3-2-vision.p.rapidapi.com` (Meta Llama 3.2 11B Vision Instruct Turbo — LLM fallback + image understanding), `google-keyword-research-for-seo.p.rapidapi.com` (keyword research) |
| **Used for** | LLM fallback when primary providers are unavailable, image-aware generation, SEO keyword research data |
| **Auth** | `X-RapidAPI-Key: <key>` header |

---

### DeepSeek (Optional)

| Item | Detail |
|------|--------|
| **Env var** | `DEEPSEEK_API_KEY` |
| **Where to get** | [platform.deepseek.com](https://platform.deepseek.com) |
| **Models used** | `deepseek-chat` |
| **Used for** | Model Comparison (A/B prompts) — available as a fourth model option when key is configured |
| **Base URL** | `https://api.deepseek.com/chat/completions` |

---

## DATA & INTELLIGENCE APIS

### DataForSEO

| Item | Detail |
|------|--------|
| **Env vars** | `DATAFORSEO_LOGIN` (username) + `DATAFORSEO_PASSWORD` (password) |
| **Auth method** | HTTP Basic Authentication — Base64 encode `login:password` |
| **Where to get** | [app.dataforseo.com](https://app.dataforseo.com) |
| **APIs used** | SERP API (live Google results), Keywords Data API (search volume, CPC, difficulty), Backlinks API, On-Page API, Domain Analytics |
| **Used for** | Keyword Explorer, SERP Rank Tracker, Backlink Explorer, On-Page SEO Audit, Content Gaps, Search Intent Map, Keyword Map |
| **Base URL** | `https://api.dataforseo.com/v3/` |
| **Notes** | Both LOGIN and PASSWORD must be set. `DATAFORSEO_PASSWORD` is secret; `DATAFORSEO_LOGIN` is not. The live-test checks both together. |

---

### Firecrawl

| Item | Detail |
|------|--------|
| **Env var** | `FIRECRAWL_API_KEY` |
| **Where to get** | [firecrawl.dev](https://firecrawl.dev) |
| **Used for** | Web scraping and crawling — competitor page monitoring, Change Monitor, AI Web Extractor, Scraping Recipe Library, Full-Site SEO Crawler, tech stack detection enrichment |
| **Base URL** | `https://api.firecrawl.dev` |
| **Auth** | `Authorization: Bearer <key>` |
| **Notes** | Used as a fallback for scraping when direct HTTP fetch fails (403/429/503). SSRF guards are enforced on all URLs passed to Firecrawl. |

---

### Apollo

| Item | Detail |
|------|--------|
| **Env var** | `APOLLO_API_KEY` |
| **Where to get** | [apollo.io](https://app.apollo.io/#/settings/integrations/api) |
| **Used for** | B2B contact and company enrichment — Lead Generation, Lead Qualifier, Hunter.io Email Finder alternative, ICP Studio data enrichment |
| **Base URL** | `https://api.apollo.io/v1/` |
| **Auth** | `api_key` in request body or `X-Api-Key` header |
| **Notes** | Apollo returns HTTP 200 even for invalid keys (with an error body). The platform live-test checks for a valid response shape, not just HTTP status. |

---

### BuiltWith

| Item | Detail |
|------|--------|
| **Env var** | `BUILTWITH_API_KEY` |
| **Where to get** | [builtwith.com](https://builtwith.com) |
| **Used for** | Tech Stack Detector — identifies which marketing tools, analytics platforms, CMS, and frameworks a competitor's website is using |
| **Base URL** | `https://api.builtwith.com/v21/api.json` |
| **Auth** | `KEY` query parameter |
| **Notes** | Returns HTTP 200 for invalid keys with an error payload. Live-test checks response structure. |

---

### Google PageSpeed Insights

| Item | Detail |
|------|--------|
| **Env var** | `GOOGLE_PAGESPEED_API_KEY` |
| **Where to get** | [Google Cloud Console → APIs & Services → PageSpeed Insights API](https://console.cloud.google.com) |
| **Used for** | Web Vitals — measures Core Web Vitals (LCP, CLS, FID/INP), performance scores, and page load metrics for any URL |
| **Base URL** | `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` |
| **Auth** | `key` query parameter |

---

### Google Custom Search

| Item | Detail |
|------|--------|
| **Env var** | `GOOGLE_SEARCH_API_KEY` |
| **Where to get** | [Google Cloud Console → APIs & Services → Custom Search API](https://console.cloud.google.com) |
| **Used for** | Live Google SERP, AI Visibility & Search Pulse, GEO Audit — fetches real Google search results for a given query |
| **Base URL** | `https://www.googleapis.com/customsearch/v1` |
| **Auth** | `key` query parameter |

---

### YouTube Data API

| Item | Detail |
|------|--------|
| **Env var** | `YOUTUBE_DATA_API_KEY` |
| **Where to get** | [Google Cloud Console → APIs & Services → YouTube Data API v3](https://console.cloud.google.com) |
| **Used for** | YouTube Monitor, Trending Topics (most-popular chart), Comment Miner — fetches video metadata, trending videos, and comments |
| **Base URL** | `https://www.googleapis.com/youtube/v3/` |
| **Auth** | `key` query parameter |

---

### Google Service Account

| Item | Detail |
|------|--------|
| **Env var** | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| **Format** | Full JSON credentials object (the downloaded service account key file contents) |
| **Where to get** | Google Cloud Console → IAM & Admin → Service Accounts → Create key (JSON) |
| **Used for** | Server-to-server Google API calls that require OAuth2 service account auth (Google Sheets export, Drive integration) |
| **Notes** | Paste the entire JSON as a single-line string in the environment secret. |

---

### Modash

| Item | Detail |
|------|--------|
| **Env var** | `MODASH_API_KEY` |
| **Where to get** | [modash.io](https://modash.io) |
| **Used for** | Influencer Discovery — real follower counts, engagement rates, and audience quality scores for Instagram, TikTok, and YouTube influencers |
| **Auth** | `Authorization: Bearer <key>` |

---

### Zernio

| Item | Detail |
|------|--------|
| **Env var** | `ZERNIO_API_KEY` |
| **Where to get** | Contact Zernio directly |
| **Used for** | Social publishing — distributes posts across social platforms via the Social Publisher (15 platforms) feature |

---

## INFRASTRUCTURE & COMMUNICATIONS

### Resend (Email)

| Item | Detail |
|------|--------|
| **Env vars** | `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET` + `RESEND_FROM_EMAIL` |
| **Where to get** | [resend.com](https://resend.com) |
| **Used for** | All outbound email — transactional (email verify, password reset, invite), broadcast campaigns, Email Personalizer, Daily Digest, and weekly reports |
| **Base URL** | `https://api.resend.com` |
| **Auth** | `Authorization: Bearer <RESEND_API_KEY>` |
| **Webhook** | `POST /api/webhooks/resend` — verified using `RESEND_WEBHOOK_SECRET` (HMAC-SHA256) |
| **Critical note** | `RESEND_FROM_EMAIL` **must** be a verified sender domain in your Resend account. Unverified domains silently fail. Use `onboarding@resend.dev` for testing only. |

---

### Amplitude (Product Analytics)

| Item | Detail |
|------|--------|
| **Env vars** | `AMPLITUDE_API_KEY` + `AMPLITUDE_SECRET_KEY` |
| **Where to get** | Amplitude → Settings → Projects → select your project |
| **Used for** | Amplitude AI Agents — ingests usage events for cohort analysis, funnel tracking, and AI-powered insights. Both keys must be set — API Key alone is insufficient for the AI agents. |
| **Base URL** | `https://api2.amplitude.com` |
| **Auth** | API Key + Secret Key passed in request body |

---

### Stripe (Payments)

| Item | Detail |
|------|--------|
| **Env vars** | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` |
| **Where to get** | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) (secret key) and [dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks) (webhook signing secret) |
| **Used for** | Link-in-Bio + Stripe (direct product sales), billing integration for paid plans |
| **Auth** | `Authorization: Bearer <STRIPE_SECRET_KEY>` |
| **Webhook** | Inbound Stripe events verified using `STRIPE_WEBHOOK_SECRET` (Stripe-Signature header) |

---

### Twilio (SMS / Voice)

| Item | Detail |
|------|--------|
| **Env vars** | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` |
| **Where to get** | [console.twilio.com](https://console.twilio.com) |
| **Used for** | SMS sending via Omnichannel Composer, AI Voice Caller — outbound calls, appointment reminders, lead follow-ups |
| **Auth** | HTTP Basic Auth: `TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN` |
| **From number** | `TWILIO_FROM_NUMBER` must be a verified Twilio phone number (e.g. `+15551234567`) |

---

### WhatsApp Business (Meta Cloud API)

| Item | Detail |
|------|--------|
| **Env vars** | `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_VERIFY_TOKEN` + `WHATSAPP_APP_SECRET` |
| **Where to get** | [developers.facebook.com](https://developers.facebook.com) → your app → WhatsApp → API Setup |
| **Used for** | WhatsApp Channel — sending marketing messages, notifications, and automated sequences via WhatsApp Business API |
| **Base URL** | `https://graph.facebook.com/v19.0/{PHONE_NUMBER_ID}/messages` |
| **Auth** | `Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>` |
| **Webhook verification** | `WHATSAPP_VERIFY_TOKEN` — your chosen token that Meta sends back to verify your webhook endpoint |
| **Webhook security** | `WHATSAPP_APP_SECRET` — used to verify the `X-Hub-Signature-256` on inbound webhook events |

---

### Vapi (AI Voice Calls)

| Item | Detail |
|------|--------|
| **Env vars** | `VAPI_API_KEY` + `VAPI_PHONE_NUMBER_ID` + `VAPI_WEBHOOK_SECRET` |
| **Where to get** | [vapi.ai](https://vapi.ai) |
| **Used for** | AI Voice Caller — makes automated outbound calls using a realistic AI voice for lead qualification, follow-ups, and appointment reminders |
| **Auth** | `Authorization: Bearer <VAPI_API_KEY>` |
| **Webhook** | Inbound Vapi call events verified using `VAPI_WEBHOOK_SECRET` |

---

### Web Push (VAPID)

| Item | Detail |
|------|--------|
| **Env vars** | `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` |
| **How to generate** | Run `npx web-push generate-vapid-keys` — produces a matched public/private key pair |
| **Used for** | Browser push notifications — Alert Routing, re-engagement nudges, campaign alerts |
| **`VAPID_SUBJECT`** | A `mailto:` address or `https://` URL identifying the push sender (e.g. `mailto:admin@yourdomain.com`) |
| **Notes** | Public and private keys must be generated together as a matched pair. Replacing one without the other will break all existing push subscriptions. |

---

### HubSpot

| Item | Detail |
|------|--------|
| **Env var** | `HUBSPOT_PRIVATE_APP_TOKEN` |
| **Where to get** | HubSpot → Settings → Integrations → Private Apps → Create private app |
| **Required scopes** | `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.lists.read`, `crm.lists.write` |
| **Used for** | HubSpot CRM Sync — bi-directional sync of contacts and lists; Dynamic Audiences pushes audience segments as HubSpot Static Lists |
| **Auth** | `Authorization: Bearer <token>` |

---

### Slack

| Item | Detail |
|------|--------|
| **Env var** | `SLACK_WEBHOOK_URL` |
| **Where to get** | [api.slack.com/apps](https://api.slack.com/apps) → create app → Incoming Webhooks → Activate → Add to workspace |
| **Used for** | Alert Routing — sends brand alerts, anomaly notifications, and AI-generated digests to a Slack channel |
| **Auth** | The webhook URL contains the auth token — treat the full URL as a secret |

---

## AD PLATFORM CREDENTIALS

### Google Ads

Google Ads uses a three-tier credential model:

**Tier 1 — Platform Developer Token (required for all Google Ads API calls)**

| Item | Detail |
|------|--------|
| **Env var** | `GOOGLE_ADS_DEVELOPER_TOKEN` |
| **Where to get** | Google Ads API Centre — issued to your app by Google. Cannot be self-generated; requires Google approval. |
| **Scope** | Platform-wide. All API calls from any user use this developer token. |

**Tier 2 — Per-User OAuth Connect (recommended)**

Users connect their own Google Ads account via OAuth. Their tokens are stored in the per-user credential vault.

| Item | Detail |
|------|--------|
| **Env vars** | `GOOGLE_ADS_OAUTH_CLIENT_ID` + `GOOGLE_ADS_OAUTH_CLIENT_SECRET` |
| **Legacy aliases** | `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` (still supported) |
| **Where to get** | Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application) |
| **OAuth flow start** | `GET /api/integrations/google-ads/oauth/start` |
| **OAuth callback** | `GET /api/integrations/google-ads/oauth/callback` |
| **Callback URL to whitelist** | `{PUBLIC_URL}/api/integrations/google-ads/oauth/callback` — must be added as an Authorised Redirect URI in Google Cloud Console |
| **Scopes requested** | `https://www.googleapis.com/auth/adwords openid email` |
| **Flow** | PKCE + state token → Google authorization → code exchange → access token + refresh token → vault storage per user |

**Tier 3 — Owner Environment Fallback (legacy)**

| Env vars | `GOOGLE_ADS_CLIENT_REFRESH_TOKEN` + `GOOGLE_ADS_CUSTOMER_ID` |
|----------|------|
| **Used for** | Cron jobs and background optimiser tasks when no per-user token is available. Only available to the platform owner account. |

**Shopping Campaigns**

| Env var | `GOOGLE_MERCHANT_CENTER_ID` |
|---------|------|
| **Used for** | Required to launch Google Shopping campaigns. Must be the Merchant Center account ID linked to your Google Ads account. |

---

### Meta Ads (Facebook / Instagram)

**Option A — Per-User OAuth Connect (recommended)**

| Item | Detail |
|------|--------|
| **Env vars** | `AUTH_FACEBOOK_CLIENT_ID` + `AUTH_FACEBOOK_CLIENT_SECRET` |
| **Where to get** | [developers.facebook.com](https://developers.facebook.com) → My Apps → your app → Settings → Basic |
| **OAuth flow start** | `GET /api/integrations/meta-ads/oauth/start` |
| **OAuth callback** | `GET /api/integrations/meta-ads/oauth/callback` |
| **Callback URL to whitelist** | `{PUBLIC_URL}/api/integrations/meta-ads/oauth/callback` — add to Facebook App → Facebook Login → Valid OAuth Redirect URIs |
| **Graph API version** | `v19.0` |
| **Scopes requested** | `ads_management, ads_read, read_insights, business_management, email, public_profile` |
| **Token lifetime** | Short-lived token (1 hour) exchanged automatically for a long-lived token (~60 days). Stored in per-user vault. |

**Option B — Static Token Fallback**

| Env vars | `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` |
|----------|------|
| **Used for** | Platform-level Meta Ads access when per-user OAuth is not configured. `META_AD_ACCOUNT_ID` format: `act_123456789`. |

---

### TikTok Ads

| Item | Detail |
|------|--------|
| **Env vars** | `TIKTOK_ACCESS_TOKEN` + `TIKTOK_ADVERTISER_ID` + `TIKTOK_RAPIDAPI_KEY` |
| **Where to get** | TikTok For Business → [ads.tiktok.com](https://ads.tiktok.com) → Assets → Business Centre → App → Access Token |
| **Used for** | TikTok Ads Insights — campaign performance data, ad creative metrics, audience analytics |
| **`TIKTOK_RAPIDAPI_KEY`** | Separate RapidAPI key used for the TikTok data API via RapidAPI hub (if using the RapidAPI TikTok connector rather than direct TikTok API) |
| **Notes** | `TIKTOK_ADVERTISER_ID` must be a plain numeric string — surrounding quotes and spaces are stripped automatically. |

---

### Microsoft Ads (Bing)

| Item | Detail |
|------|--------|
| **Env vars** | `MICROSOFT_ADS_DEVELOPER_TOKEN` + `MICROSOFT_ADS_CLIENT_ID` + `MICROSOFT_ADS_CLIENT_SECRET` + `MICROSOFT_ADS_REFRESH_TOKEN` + `MICROSOFT_ADS_CUSTOMER_ID` + `MICROSOFT_ADS_ACCOUNT_ID` |
| **Where to get** | [ads.microsoft.com](https://ads.microsoft.com) → Tools → Bing Ads API → Request Developer Token; Azure Portal for OAuth client credentials |
| **Used for** | Microsoft Ads campaign management and performance reporting via the Bing Ads API |
| **Auth** | OAuth2 client credentials flow — refresh token exchanged for access token at runtime |

---

## SOCIAL LOGIN (User Authentication)

These OAuth credentials enable the **Sign in with Google / Facebook / Microsoft** buttons on the login page. If any pair is missing, the corresponding button is hidden automatically.

### Google Social Login

| Item | Detail |
|------|--------|
| **Env vars** | `AUTH_GOOGLE_CLIENT_ID` + `AUTH_GOOGLE_CLIENT_SECRET` |
| **Where to get** | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Web) |
| **Scopes** | `openid email profile` |
| **Callback URL** | `{PUBLIC_URL}/auth/google/callback` |

### Facebook / Meta Social Login

| Item | Detail |
|------|--------|
| **Env vars** | `AUTH_FACEBOOK_CLIENT_ID` + `AUTH_FACEBOOK_CLIENT_SECRET` |
| **Where to get** | [developers.facebook.com](https://developers.facebook.com) → your app → Facebook Login → Settings |
| **Scopes** | `email public_profile` |
| **Callback URL** | `{PUBLIC_URL}/auth/facebook/callback` |

### Microsoft Social Login

| Item | Detail |
|------|--------|
| **Env vars** | `AUTH_MICROSOFT_CLIENT_ID` + `AUTH_MICROSOFT_CLIENT_SECRET` |
| **Where to get** | [Azure Portal](https://portal.azure.com) → App registrations → New registration → Certificates & Secrets |
| **Scopes** | `openid email profile` |
| **Callback URL** | `{PUBLIC_URL}/auth/microsoft/callback` |

---

## GOOGLE WORKSPACE OAUTH

Connects a user's Google Workspace account (Gmail, Drive, Calendar) to InfoGenie for deeper integration.

| Item | Detail |
|------|--------|
| **Env vars** | `GOOGLE_WORKSPACE_CLIENT_ID` + `GOOGLE_WORKSPACE_CLIENT_SECRET` |
| **Vault key** | `google_workspace` (stored per user in credential vault) |
| **OAuth callback** | `/api/integrations/workspace/oauth/callback` |
| **Scopes** | Gmail, Drive, Calendar read/write scopes |
| **Where to get** | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID |

---

## PLATFORM & ACCOUNT CONFIGURATION

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `PUBLIC_URL` | The public-facing base URL of your InfoGenie instance (e.g. `https://myapp.replit.app`). Used to construct OAuth redirect URIs and webhook URLs. Defaults to `https://$REPL_SLUG.replit.app`. | Strongly recommended in production |
| `PORT` | Port for Next.js to listen on (default: 5000). | No |
| `EXPRESS_PORT` | Internal port for Express to listen on (default: 8000). | No |
| `NODE_ENV` | `production` or `development`. Controls cookie security, error verbosity, and the Next.js build mode. | Yes in production |

---

## LLM MODEL QUICK-REFERENCE

| Model identifier | Provider | Size / Type | Primary use in InfoGenie |
|------------------|---------|-------------|--------------------------|
| `gpt-5` | OpenAI | Large reasoning | Complex strategy, war room analysis, storyboard generation |
| `gpt-5-mini` | OpenAI | Small / fast | Default for most generation tasks — ad copy, summaries, content AI |
| `claude-sonnet-4-6` | Anthropic | Mid / balanced | Deep analysis, long-form strategy, Model Comparison |
| `gemini-pro` | Google Gemini | Mid | GEO audit, multimodal tasks, AI visibility |
| `veo-003` | Google Gemini | Video | AI video generation (Creator Studio) |
| `sonar` | Perplexity | Live web | Real-time research — Reddit, web mentions, GEO audit |
| `@cf/meta/llama-3.1-8b-instruct` | Cloudflare Workers AI | Small / cost-efficient | High-volume fallback generation |
| `meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo` | RapidAPI (Meta) | Mid / vision | Image-aware generation, LLM fallback |
| `deepseek-chat` | DeepSeek | Mid | Model Comparison (optional 4th model) |

### gpt-5 / Reasoning Model Gotcha
OpenAI's `gpt-5` and `gpt-5-mini` are reasoning models with a different API contract:
- Use `max_completion_tokens`, **not** `max_tokens`
- Do **not** pass `temperature` or `top_p`
- Pass `reasoning_effort: 'minimal'` for fast responses

InfoGenie handles this automatically in `ai_compat.js` via a global SDK patch — do not add workarounds at individual call sites.

---

## OAUTH FLOW SUMMARY

| Flow | Start endpoint | Callback endpoint | Redirect URI to register | Scopes |
|------|---------------|-------------------|--------------------------|--------|
| Google Ads per-user connect | `GET /api/integrations/google-ads/oauth/start` | `GET /api/integrations/google-ads/oauth/callback` | `{PUBLIC_URL}/api/integrations/google-ads/oauth/callback` | `https://www.googleapis.com/auth/adwords openid email` |
| Meta Ads per-user connect | `GET /api/integrations/meta-ads/oauth/start` | `GET /api/integrations/meta-ads/oauth/callback` | `{PUBLIC_URL}/api/integrations/meta-ads/oauth/callback` | `ads_management ads_read read_insights business_management email public_profile` |
| Google Workspace connect | `GET /api/integrations/workspace/oauth/start` | `GET /api/integrations/workspace/oauth/callback` | `{PUBLIC_URL}/api/integrations/workspace/oauth/callback` | Gmail · Drive · Calendar |
| Google social login | `/auth/google` | `/auth/google/callback` | `{PUBLIC_URL}/auth/google/callback` | `openid email profile` |
| Facebook social login | `/auth/facebook` | `/auth/facebook/callback` | `{PUBLIC_URL}/auth/facebook/callback` | `email public_profile` |
| Microsoft social login | `/auth/microsoft` | `/auth/microsoft/callback` | `{PUBLIC_URL}/auth/microsoft/callback` | `openid email profile` |

---

## CREDENTIAL SECURITY MODEL

| Layer | How it works |
|-------|-------------|
| **Vault encryption** | AES-256-GCM. Each credential is encrypted with a unique IV and auth tag. Key derived from `CREDENTIAL_ENCRYPTION_KEY`. |
| **Platform key storage** | Encrypted in `platform_api_keys` PostgreSQL table. DB values override env vars at boot via `hydrate()`. |
| **Session cookies** | `infogenie.sid` — HttpOnly, SameSite=Lax, 30-day rolling. Signed with `SESSION_SECRET`. |
| **Password hashing** | bcrypt cost factor 12. |
| **API gate** | All `/api/` routes require either a valid session cookie or `INFOGENIE_API_KEY` in `Authorization: Bearer` header. |
| **Admin-only keys** | Platform API keys are blocked from the per-user `/api/settings/api-key` endpoint. Non-admins receive HTTP 403 if they attempt to read or write a platform-managed key. |
| **SSRF protection** | All external URL fetches are validated through strict SSRF guards — private/loopback/link-local IP ranges are blocked. |
| **Webhook verification** | Resend, Stripe, Vapi, and WhatsApp webhooks all verify signatures before processing. |

---

## WHERE TO CONFIGURE CREDENTIALS

| Credential type | Where to set |
|-----------------|-------------|
| Platform API keys (AI, data, infrastructure) | **Manage → Settings → 🔑 Platform APIs** (admin only) |
| User's own ad platform credentials | **Settings & Integrations** in the user's account → Connect buttons |
| Social login OAuth apps | Replit environment secrets (set once per deployment) |
| Required boot vars (`CREDENTIAL_ENCRYPTION_KEY`, `SESSION_SECRET`, `DATABASE_URL`, `INFOGENIE_API_KEY`) | Replit environment secrets |
| Per-user Google Ads / Meta OAuth | User-initiated via **Settings → Connect Google Ads / Connect Meta Ads** |

---

*InfoGenie — API & Credential Reference — July 2026*
