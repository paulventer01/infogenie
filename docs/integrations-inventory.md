# InfoGenie — Integrations Inventory

**Document type:** Integration status reference  
**Source of truth:** Codebase reverse-scan (`services/`, `platform_keys.js`, OAuth routes, ops tooling)  
**Generated:** 2026-08-11  
**Repo tip referenced:** `main` + related service modules  

## Status legend

| Status | Meaning |
|--------|---------|
| **DONE** | Integration path exists in code and is mounted/used |
| **PARTIAL** | Scaffolded, optional, stubbed, or not fully end-to-end |
| **NOT DONE** | Deferred, placeholder, or mentioned only |

> **DONE** means the product has a code path for the integration. It does **not** mean every API key is configured in a given environment (preview/local/production).

---

## 1. LLMs / AI models

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| OpenAI | **DONE** | Primary chat, embeddings, TTS, images; `/api/openai` proxy | `OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_API_KEY` |
| Anthropic Claude | **DONE** | Long-form analysis, Creator Studio | `ANTHROPIC_API_KEY` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY` |
| Google Gemini | **DONE** | Multimodal, GEO, chat router | `GEMINI_API_KEY` |
| Perplexity | **DONE** | Web-grounded research | `PERPLEXITY_API_KEY` |
| Cloudflare Workers AI | **DONE** | Llama inference / fallback | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` |
| RapidAPI (Meta Llama etc.) | **DONE** | LLM fallback + keyword hosts | `RAPIDAPI_KEY` |
| Z.ai / GLM (AutoClaw) | **DONE** | Coding/agent OpenAI-compatible models | `ZAI_API_KEY` / `GLM_API_KEY` |
| Moonshot / Kimi | **DONE** | Long-context models | `MOONSHOT_API_KEY` / `KIMI_API_KEY` |
| DeepSeek | **PARTIAL** | AI Providers preset | `DEEPSEEK_API_KEY` |
| Groq | **PARTIAL** | AI Providers preset | `GROQ_API_KEY` |
| Mistral | **PARTIAL** | AI Providers preset | `MISTRAL_API_KEY` |
| OpenRouter | **PARTIAL** | Multi-model gateway preset | `OPENROUTER_API_KEY` |
| Together AI | **PARTIAL** | OpenAI-compatible preset | `TOGETHER_API_KEY` |
| Ollama Cloud | **PARTIAL** | Cloud OpenAI-compatible models | `OLLAMA_API_KEY` |
| Ollama (local) | **PARTIAL** | Local `localhost:11434` | *(none; allow empty key)* |
| Azure OpenAI | **PARTIAL** | Custom-URL OpenAI-compatible preset | `AZURE_OPENAI_API_KEY` |

---

## 2. Other AI tools

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| OpenAI TTS / Voiceover | **DONE** | MP3 voiceover generation | OpenAI keys |
| Remove.bg | **DONE** | Background removal for creatives | `REMOVE_BG_API_KEY` |
| Profound | **DONE** | LLM brand-visibility API | `PROFOUND_API_KEY` |
| Promptfoo | **DONE** | Prompt/model eval gate | `PROMPTFOO_*` |
| Traceloop / OpenLLMetry | **PARTIAL** | LLM observability / FinOps | `TRACELOOP_API_KEY` |
| Confident AI | **PARTIAL** | Optional Promptfoo companion | `CONFIDENT_API_KEY` |
| Canva | **PARTIAL** | Template-link bridge (no live OAuth) | `CANVA_CLIENT_ID`, `CANVA_API_KEY` |
| MCP client (generic) | **PARTIAL** | Connect REST/JSON-RPC MCP servers | Per-server URL |

---

## 3. Data / SEO / intelligence APIs

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| DataForSEO | **DONE** | SERP, keywords, SEO intel | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| Firecrawl | **DONE** | Site scrape/crawl (WAF bypass) | `FIRECRAWL_API_KEY` |
| Apollo.io | **DONE** | B2B enrichment / lead finder | `APOLLO_API_KEY` |
| BuiltWith | **DONE** | Tech-stack detection | `BUILTWITH_API_KEY` |
| Modash | **DONE** | Influencer discovery | `MODASH_API_KEY` |
| Google PageSpeed | **DONE** | Core Web Vitals / performance | `GOOGLE_PAGESPEED_API_KEY` |
| Google Custom Search | **DONE** | SERP visibility | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX` |
| YouTube Data API | **DONE** | Trending / channel monitor | `YOUTUBE_DATA_API_KEY` |
| Bing Webmaster | **DONE** | Bing SEO stats | `BING_WEBMASTER_API_KEY` |
| SpyFu | **DONE** | Competitor PPC/SEO spy | `SPYFU_API_KEY` |
| Majestic | **DONE** | Trust/Citation Flow, backlinks | `MAJESTIC_API_KEY` |
| Semrush | **DONE** | Domain/keyword intel | `SEMRUSH_API_KEY` |
| Ahrefs | **DONE** | DR/UR/backlinks/keywords | `AHREFS_API_KEY` |
| Serpstat | **DONE** | Visibility / competitors | `SERPSTAT_API_KEY` |
| ContentKing | **DONE** | Real-time SEO change monitor | `CONTENTKING_API_KEY` |
| Hunter.io | **DONE** | Email finder/verifier | `HUNTER_API_KEY` |
| Apify | **DONE** | Scraping actors | `APIFY_API_KEY` |
| Google Trends (npm) | **DONE** | Interest/related/trending (no key) | *(none)* |
| Zernio | **DONE** | Social publishing API | `ZERNIO_API_KEY` |
| Reddit public JSON | **DONE** | Reddit Pulse / AEO | *(User-Agent)* |
| tikwm.com | **DONE** | Free TikTok no-watermark resolve | *(none)* |
| SerpAPI | **PARTIAL** | SERP snapshot fallback | `SERP_API_KEY` |
| OmniSocials | **PARTIAL** | Social DM/comment inbox | `OMNISOCIALS_API_KEY` |
| RapidAPI TikTok Scraper | **PARTIAL** | Paid TikTok download fallback | `TIKTOK_RAPIDAPI_KEY` |
| Quora mining | **PARTIAL** | Via Perplexity (not Quora API) | `PERPLEXITY_API_KEY` |
| Glassdoor sentiment | **PARTIAL** | Scrape/AI sentiment | *(no dedicated Glassdoor key)* |
| Google Maps / local leads | **PARTIAL** | Local lead aggregation | *(source always “available”)* |

---

## 4. OAuth / social login / ad connect

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| Google social login | **DONE** | Login/signup OIDC | `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` |
| Facebook social login | **DONE** | Login/signup | `AUTH_FACEBOOK_CLIENT_ID`, `AUTH_FACEBOOK_CLIENT_SECRET` |
| Microsoft social login | **DONE** | Azure AD login | `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET` |
| Google Ads OAuth | **DONE** | Vaulted Ads connect | `GOOGLE_ADS_OAUTH_CLIENT_ID`/`SECRET`, developer/refresh tokens |
| Meta Ads OAuth | **DONE** | Vaulted Meta connect | `META_OAUTH_CLIENT_ID`/`SECRET`, `META_ACCESS_TOKEN` |
| Google Workspace OAuth | **DONE** | Gmail / Drive / Calendar vault | `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET` |
| Google Service Account | **DONE** | GSC + GA4 server auth | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL` |
| Microsoft Advertising OAuth | **DONE** | Bing Ads reporting/launch | `MICROSOFT_ADS_*` |
| WordPress App Password | **DONE** | Per-site Basic auth (tenant vaulted) | Tenant credentials + `CREDENTIAL_ENCRYPTION_KEY` |
| Nango | **PARTIAL** | Unified OAuth foundation (Meta/Google Ads/HubSpot/Shopify) | `NANGO_SECRET_KEY`, `NANGO_HOST` |
| LinkedIn Ads OAuth | **PARTIAL** | Research / CAPI via vault token | `LINKEDIN_ACCESS_TOKEN` / vault |
| Canva OAuth | **PARTIAL** | Referenced; bridge is template links only | `CANVA_CLIENT_ID`, `CANVA_API_KEY` |

---

## 5. Email / messaging / communications

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| Resend | **DONE** | Auth, drip, broadcast, alerts | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| Twilio SMS | **DONE** | Omnichannel / journey SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| WhatsApp Cloud API | **DONE** | Messaging + webhooks | `WHATSAPP_*` |
| Vapi.ai | **DONE** | AI voice outbound calls | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` |
| Web Push (VAPID) | **DONE** | Browser push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| Slack Incoming Webhooks | **DONE** | Digests, crisis, alert routing | `SLACK_WEBHOOK_URL` |
| Mailchimp | **DONE** | CRM sync | `MAILCHIMP_API_KEY`, `MAILCHIMP_SERVER_PREFIX` |
| ActiveCampaign | **DONE** | CRM sync | `ACTIVECAMPAIGN_API_KEY`, `ACTIVECAMPAIGN_BASE_URL` |
| ConvertKit | **DONE** | CRM sync | `CONVERTKIT_API_KEY` |
| Discord webhooks | **PARTIAL** | Allowed host on Slack-style dispatcher | User webhook URL |
| Telegram Bot API | **PARTIAL** | Optional notify destination | Bot URL/token; `INFOGENIE_NOTIFY_SECRET` |
| OneSignal | **PARTIAL** | Presence check in channel studios | `ONESIGNAL_APP_ID` |
| Firebase Cloud Messaging | **PARTIAL** | Presence check in channel studios | `FIREBASE_SERVER_KEY` |
| RCS | **PARTIAL** | Module present; no carrier API | *(none)* |

---

## 6. Ads / marketing platforms

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| Meta Ads / Graph / CAPI | **DONE** | Campaigns, insights, Ad Library, CAPI | `META_ACCESS_TOKEN`, Meta OAuth |
| Google Ads | **DONE** | Insights, launch, optimizer | `GOOGLE_ADS_*` |
| TikTok Ads | **DONE** | Campaign create + reporting | `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID` |
| Microsoft Advertising | **DONE** | Insights + campaign paths | `MICROSOFT_ADS_*` |
| HubSpot CRM | **DONE** | Contacts/deals/audiences/True ROAS | `HUBSPOT_PRIVATE_APP_TOKEN` |
| Shopify Admin | **DONE** | Orders + SEO publish destination | `SHOPIFY_SHOP`, `SHOPIFY_ADMIN_TOKEN` |
| AppsFlyer | **DONE** | Mobile install aggregation | `APPSFLYER_API_TOKEN`, `APPSFLYER_APP_ID` |
| LinkedIn Ads | **PARTIAL** | Research via Perplexity; CAPI via vault | LinkedIn token env/vault |
| Google Merchant Center | **PARTIAL** | Shopping campaign requirement flag | `GOOGLE_MERCHANT_CENTER_ID` |
| Webflow CMS | **PARTIAL** | SEO Autopilot publish destination | `WEBFLOW_API_TOKEN`, collection/site IDs |
| SEO publish webhook | **PARTIAL** | Generic CMS/webhook publish | `SEO_PUBLISH_WEBHOOK_URL` |
| CTV | **PARTIAL** | Creative brief scaffold (LLM); no ad network | Uses LLM keys |

---

## 7. Analytics

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| Amplitude | **DONE** | Product analytics + Agents + attribution | `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY` |
| Segment | **DONE** | CDP event track forwarder | `SEGMENT_WRITE_KEY` |
| GA4 (Data API) | **DONE** | Reports via service account | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| Google Search Console | **DONE** | Search analytics / social winners | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL` |
| PostHog | **PARTIAL** | Browser key via `/api/config` | `POSTHOG_API_KEY` |

---

## 8. Payments

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| Stripe | **DONE** | Checkout / billing / webhooks | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

---

## 9. Storage

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| PostgreSQL | **DONE** | Primary DB / sessions | `DATABASE_URL` |
| Local uploads filesystem | **DONE** | Default asset store (`/uploads`) | *(path)* |
| Redis / Upstash | **PARTIAL** | Optional cache/rate-limit | `REDIS_URL`, `UPSTASH_REDIS_URL` |
| S3-compatible object storage | **PARTIAL** | Uploads with local fallback | `S3_*` / `AWS_*` |

---

## 10. Infra / ops / security tooling

| Tool | Status | How used | Typical env / key |
|------|--------|----------|-------------------|
| Chromium / Puppeteer | **DONE** | Headless HTML fetch | `CHROMIUM_PATH`, `PUPPETEER_EXECUTABLE_PATH` |
| Credential vault (AES-GCM) | **DONE** | Encrypt platform + tenant secrets | `CREDENTIAL_ENCRYPTION_KEY` |
| Session signing | **DONE** | Express sessions | `SESSION_SECRET` |
| InfoGenie API gate | **DONE** | Global `/api` auth + quotas | `INFOGENIE_API_KEY` |
| Public base URLs | **DONE** | OAuth redirects, CSRF, synthetics | `PUBLIC_BASE_URL`, `APP_URL` |
| Sentry | **PARTIAL** | Optional error tracking | `SENTRY_DSN` |
| Checkly | **PARTIAL** | External synthetics | `CHECKLY_API_KEY`, `CHECKLY_ACCOUNT_ID` |
| Better Stack (Uptime) | **PARTIAL** | Alternate synthetics | `BETTERSTACK_API_KEY` |
| OpenTelemetry → SigNoz | **PARTIAL** | Trace/metrics export | `OTEL_*` / `SIGNOZ_*` |
| GitGuardian | **PARTIAL** | Secret-scan API + CI | `GITGUARDIAN_API_KEY` |
| Notify shared secret | **PARTIAL** | Gate `/api/notify/send` | `INFOGENIE_NOTIFY_SECRET` |
| Infisical | **NOT DONE** | Deferred secrets manager | — |
| incident.io | **NOT DONE** | Deferred incident tool | — |
| PagerDuty | **NOT DONE** | Deferred paging | — |
| Uptrace | **NOT DONE** | Deferred APM | — |

---

## 11. Explicitly not integrated

These appear only as missing/deferred mentions (docs or ops status). There is **no DONE code path**:

- Moz, Similarweb, Searchmetrics  
- Brandwatch, Mention, Sprout Social  
- Clearbit, Crunchbase, PitchBook  
- Salesforce, Pipedrive  
- Mixpanel, Heap  
- ElevenLabs  
- Runway / Kling, Midjourney, Stability AI  
- Pinterest Ads, Snapchat Ads, Amazon Ads, Twitter/X Ads (official Ads API)

---

## 12. Where keys are managed

| Location | What lives there |
|----------|------------------|
| **Manage → AI Providers / platform keys** | Admin-managed platform secrets overlay (`services/credentials/platform_keys.js`) — OpenAI, Anthropic, Gemini, Perplexity, Firecrawl, DataForSEO, Apollo, Resend, Stripe, Amplitude, many data APIs, etc. |
| **Environment variables** | Ads OAuth tokens, Twilio/WhatsApp/Vapi, HubSpot, Shopify, Redis/S3, ops tooling (Checkly, OTEL, GitGuardian), session/vault secrets |
| **Tenant credential vault** | Per-user/per-tenant OAuth tokens and WordPress credentials (encrypted with `CREDENTIAL_ENCRYPTION_KEY`) |

### Platform key registry groups (admin UI)

From `services/credentials/platform_keys.js`:

1. **AI Models** — OpenAI, Anthropic, Gemini, Perplexity, Cloudflare Workers AI, RapidAPI, Z.ai, Moonshot/Kimi, Groq, DeepSeek, Mistral, OpenRouter, Together, Ollama Cloud  
2. **Data & Intelligence** — DataForSEO, Firecrawl, Apollo, Zernio, OmniSocials, Modash, BuiltWith, Google PageSpeed, Google Search, YouTube Data, Bing Webmaster, SpyFu, Majestic  
3. **Infrastructure** — Resend (+ webhook/from), Amplitude, Stripe (+ webhook), VAPID  

Many additional services are wired in code but configured only via env (Semrush, Ahrefs, HubSpot, Twilio, ad-platform OAuth, ops stack, etc.).

---

## 13. Approximate counts (code-backed)

| Category | Approx. items (DONE or PARTIAL) |
|----------|----------------------------------|
| LLM | 16 |
| AI-other | 8 |
| API-data | 28 |
| OAuth/social | 12 |
| Email/comms | 14 |
| Ads/marketing | 13 |
| Analytics | 5 |
| Payments | 1 |
| Storage | 4 |
| Infra/ops | 14 (+ 4 NOT DONE deferred) |

Primary evidence files:

- `services/credentials/platform_keys.js`
- `services/integrations_status/routes.js`
- `services/ops_tooling/status.js`
- `services/ai_providers/presets.js`
- `services/execution_hub/api.js`
- Individual `services/*/api.js` modules

---

## 14. Preview / ops note

In a typical preview environment, many integrations are **code-DONE** but **keys missing**. Example:

- SEO On-Page Auditor → Firecrawl path is DONE in code, but without `FIRECRAWL_API_KEY`, WAF-protected sites (e.g. fxpro.com) cannot be scraped.

To check live configuration in a running instance, use integrations/status surfaces in the app and/or the platform keys admin UI.

---

*End of document — InfoGenie integrations inventory*
