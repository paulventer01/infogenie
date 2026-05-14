# InfoGenie

InfoGenie is an AI-powered marketing intelligence and campaign automation platform for analyzing competitors, generating ad campaigns, optimizing results, and re-engaging customers.

## Run & Operate

*   **Run**: `node server.js`
*   **Env Vars**: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `RESEND_API_KEY` (booking + Linksell confirmations), `RESEND_WEBHOOK_SECRET`, `HUBSPOT_PRIVATE_APP_TOKEN`, `FIRECRAWL_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `INFOGENIE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, `DATABASE_URL`, `SLACK_WEBHOOK_URL`, `APOLLO_API_KEY`, `BUILTWITH_API_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`, `TIKTOK_RAPIDAPI_KEY` (optional paid fallback for T20 TikTok Downloader, ~$10/mo), `ZERNIO_API_KEY`, `MICROSOFT_ADS_DEVELOPER_TOKEN`, `MICROSOFT_ADS_CLIENT_ID`, `MICROSOFT_ADS_CLIENT_SECRET`, `MICROSOFT_ADS_REFRESH_TOKEN`, `MICROSOFT_ADS_CUSTOMER_ID`, `MICROSOFT_ADS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_VERIFY_TOKEN` + `WHATSAPP_APP_SECRET` (Meta WhatsApp Cloud API for the WhatsApp Channel feature; the App Secret is required in production for X-Hub-Signature-256 webhook verification), `VAPI_API_KEY` + `VAPI_PHONE_NUMBER_ID` + `VAPI_WEBHOOK_SECRET` (AI Voice Caller via Vapi.ai; webhook secret is required in production), `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (optional, enables checkout in Link-in-Bio; webhook secret is required in production for Stripe-Signature verification), `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` (optional, enables real SMS in Omnichannel Composer + Journey Builder; otherwise SMS sends are stubbed/logged), `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (optional, enables Web Push notifications — generate with `npx web-push generate-vapid-keys`), `RESEND_FROM_EMAIL` (optional, sender address used by Journey Builder + Omnichannel Composer email sends; defaults to `noreply@infogenie.app`), `PUBLIC_URL` (used to build webhook + tracking-pixel + checkout URLs; defaults to https://$REPL_SLUG.replit.app).

## Stack

*   **Backend**: Node.js, Express.js
*   **Frontend**: HTML5, CSS3, Vanilla JavaScript (SPA), Chart.js v4.4.0
*   **ORM/DB**: PostgreSQL (via `kv_store` table + per-tier tables)
*   **AI/LLM**: OpenAI GPT-4o/GPT-4o-mini, Anthropic Claude, Perplexity, Gemini, Cloudflare Workers AI (Llama 3.1)
*   **External APIs**: DataForSEO, RapidAPI, Resend, Amplitude, HubSpot, Firecrawl, Google PageSpeed Insights

## Where things live

*   `/index.html` — Main SPA entry point.
*   `/style.css` — All application styling.
*   `/data.js` — Industry intelligence database, competitor data.
*   `/app.js` — Frontend application logic.
*   `/server.js` — Backend Express server, API integrations.
*   `/services/` — Per-tier backend modules (`<name>/{schema,api}.js` pattern).
*   `/uploads/` — User-uploaded brand assets.
*   `/data/` — Flat-file persistence (migrated to Postgres `kv_store` at server boot).
*   `/scripts/` — Build/utility scripts (user manual generation, screenshot capture).
*   `attached_assets/InfoGenie_User_Manual.pdf` — User manual.
*   `docs/tiers.md` — **Full per-feature index for T1-T38** (route · endpoint · storage · pairs-with). Read this before adding new tiers.

## Architecture decisions

*   **Dual-AI Attack Plan**: Key analyses (`/api/ai-attack-plan`) run GPT-4o and Claude in parallel, with a third GPT-4o synthesizing blended intelligence.
*   **Atomic + Mutex Persistence**: Critical data uses single-writer mutexes and atomic temp-file-and-rename, mirrored to Postgres for transactional safety.
*   **LLM Redundancy & Cost Optimization**: Multiple providers integrated for redundancy and per-task cost-fit. All AI tiers use the **same pattern**: strict-JSON LLM prompt + `/^_DUMMY/i` key gate + template fallback + Postgres persistence + `_escapeHtml`/`_safeUrl` frontend builder.
*   **Agentic Command Bar**: Floating command bar uses GPT-4o function calling for natural language commands, with confirmation for destructive ops.
*   **AI Campaign Optimizer**: Hourly insights from ad platforms, rule-based optimization (PAUSE / SCALE BUDGET / HOLD) every 6 hours. Dry-run by default, live mode applies via platform APIs. Includes Creative Auto-Refresh and Multi-Armed Bandit (Meta + Google Ads).
*   **Brandwatch-Killer Suite (T1-T38)**: 80+ feature tiers covering monitoring, competitive intelligence, content, ads, SEO, conversation inbox, white-label reports, and more. **See `docs/tiers.md` for the full per-tier index** including routes, endpoints, storage, and which tiers pair together.
*   **Dynamic Audiences (Reach → Dynamic Audiences)**: Real-time rule-based contact segments. Phase 1 builder UI + live preview · Phase 2 15-min sweep cron + HMAC-validated HubSpot webhook · Phase 3 bind to Drip email sequence (only `audienceBindingId`-tagged enrollments touched, mutations under `global._dripStore.lock`) · Phase 4A mirror to HubSpot Static List · Phase 4B churn-risk audience → single-touch AI win-back drip. All bridges run after membership write commits, fanned out per-contact in parallel with per-target try/catch.
*   **Customer Journey Builder (Reach → Customer Journey Builder)**: Multi-step automated flows with `trigger`/`wait`/`condition`/`action` nodes. Actions fan out to email (Resend), SMS (Twilio), WhatsApp (Meta Cloud), AI voice (Vapi), Web Push (VAPID), or contact tagging. Backend runner ticks every 60s, advances `journey_runs` whose `next_run_at` has elapsed. Pause/Activate per journey · per-run log of every step.
*   **Real-time Signal Triggers (Manage → Real-time Signal Triggers)**: Bridge between observable signals (`mention_spike`, `sentiment_drop`, `competitor_price`, `trending_keyword`, `review_negative`, `crisis_alert`, `manual`) and journey enrolment. `fireSignal(type,payload)` is exported by `services/signal_triggers/api.js` for other services to call when they detect an event; matching enabled triggers spawn a `journey_runs` row for the contact in the payload. Manual fire UI for testing.
*   **Marketing Projects (Manage → + New Marketing Project)**: Lightweight project wrapper — name, goal, monthly budget, channels, owner, dates. Active project id stored in localStorage as `ig_active_project_id` so other features can scope themselves to it.
*   **Brand Calendar (Manage → Brand Calendar)**: Unified planner across 10 categories (Brand · Email · SMS+WhatsApp · Social · Content · Ads · Event · Surveys · Website · My Activities). Sidebar filter + month grid + click-to-add modal. Items persisted in `brand_calendar_items` table.
*   **Budget Board (Manage → Budget Board)**: Per-month target + per-channel allocations + spend log. `/api/budget/summary?month=YYYY-MM` returns target vs actual, per-channel utilization, and 30-day daily trend. Spend logged manually or by other services via `/api/budget/spend` (e.g., the optimizer can mirror its outflows here).
*   **Web Analytics (Manage → Web Analytics)**: Read-only aggregator that surfaces what's available without GA4 — channel sessions/impressions from `ad_insights` (last 30d), top landing pages from `landing_pages`, mobile PageSpeed scores from `web_vitals`. Banner prompts user to connect GA4 in Settings for full Source/Medium and Country data.
*   **Omnichannel Composer (Reach → Omnichannel Composer)**: One form, write once → fan out across Email + SMS + WhatsApp + AI Voice + Web Push. Per-channel `configured` status surfaced from `/api/omnichannel/channels` so the UI shows which providers are wired. Each contact gets one send per selected channel; per-target try/catch so a single failure doesn't abort the batch.

## Product

*   **AI Marketing Intelligence**: Competitor analysis, keyword gap analysis, share of voice, predictive moves, win/loss intelligence.
*   **Campaign Automation**: AI creative generation, multi-channel ad hub, social content calendar, drip execution engine, re-engagement agent.
*   **SEO & Content**: Content-gap ideation, internal link suggester, CRO Lab, Content Scorer, Keyword-Page Map, on-page audit, GEO audit, multi-page crawler.
*   **Analytics & Reporting**: Cross-channel reporting, GSC/GA4 hub, Attribution & ROI, Blended Performance/CAC, True ROAS, Goal-Based Autonomous Monitoring.
*   **Lead Management**: Lead Qualifier Agent, Lookalike Audience Builder, Unified Conversation Inbox.
*   **Real-time Monitoring**: Mention tracking with sentiment, real-time alerts, webhook channels.
*   **Platform Integrations**: DataForSEO, OpenAI, Anthropic, Resend, Amplitude, HubSpot, Firecrawl, Google PageSpeed, RapidAPI, Gemini, Perplexity, Cloudflare Workers AI, Zernio (15-platform social).

## User preferences

*   Non-technical user — prefers plain language + execution over options.
*   Every "Launch Campaign" auto-registers the campaign in the AI Optimizer dashboard **and turns optimizer_enabled=TRUE on first insert** (preserved on conflict, so users can still manually disable). The optimizer then monitors performance every hour, evaluates pause/scale rules every 6 hours, and reallocates budget across ad sets every 12 hours — all without the user flipping any toggle. Default mode is dry-run for safety; flip to LIVE in Grow → AI Optimizer when ready to let it apply changes to Meta/Google/TikTok directly. Without ad-platform creds, campaigns land as `platform_camp_id='local_<ts>'` so the user still sees them under Tracked Campaigns; once creds are connected the next launch uses the real platform id.
*   Counter-Message modal exposes 🚀 **Launch Now** (pre-fills Campaign Launch Brief + sets `window._counterTarget` so Campaigns view shows "Targeting: <competitor>" banner) and 📋 **Copy** / **Copy All** buttons for clipboard handoff.

## Gotchas

*   **API Authentication**: In production, `INFOGENIE_API_KEY` is required for most `/api/*` routes.
*   **LLM Quota Management**: Per-provider, per-IP, per-day budget caps enforced when `INFOGENIE_API_KEY` is set.
*   **Resend Webhook URL**: Update after deployment for deliverability metrics.
*   **Google Analytics/Search Console**: Currently parked due to Google Workspace org policy issues.
*   **SSRF Guards**: Strict SSRF guards on all external URL fetches.
*   **Postgres Migration**: Existing `data/*.json` files are migrated to Postgres `kv_store` at server boot.
*   **Ad Platform Connections**: Cross-Channel Report UI + backend fetchers are live but require real Meta/Google/TikTok credentials for full data.
*   **Rate-limit IPs**: Public embed routes (T23, T27) use `req.socket.remoteAddress` — NOT `req.ip` (which is XFF-spoofable when `trust proxy` is on).

## Pointers

*   [Amplitude](https://amplitude.com/) · [DataForSEO](https://dataforseo.com/apis) · [OpenAI](https://platform.openai.com/docs/api-reference) · [Anthropic](https://docs.anthropic.com/en/api/) · [Resend](https://resend.com/docs/api-reference) · [Chart.js](https://www.chartjs.org/docs/latest/) · [Express.js](https://expressjs.com/)
*   [Google PageSpeed](https://developers.google.com/speed/docs/insights/v5/get-started) · [HubSpot](https://developers.hubspot.com/docs/api/overview) · [Firecrawl](https://firecrawl.dev/docs/api-reference) · [Perplexity](https://docs.perplexity.ai/docs/getting-started) · [Gemini](https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-gemini) · [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
