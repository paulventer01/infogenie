# InfoGenie

InfoGenie is an AI-powered marketing intelligence and campaign automation platform for analyzing competitors, generating ad campaigns, optimizing results, and re-engaging customers.

## Run & Operate

*   **Run**: `node server.js`
*   **Env Vars**: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `RESEND_WEBHOOK_SECRET`, `HUBSPOT_PRIVATE_APP_TOKEN`, `FIRECRAWL_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `INFOGENIE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, `DATABASE_URL`, `SLACK_WEBHOOK_URL`, `APOLLO_API_KEY`, `BUILTWITH_API_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`.

## Stack

*   **Backend**: Node.js, Express.js
*   **Frontend**: HTML5, CSS3, Vanilla JavaScript (SPA), Chart.js v4.4.0
*   **ORM/DB**: PostgreSQL (via `kv_store` table)
*   **AI/LLM**: OpenAI GPT-4o/GPT-4o-mini, Anthropic Claude, Perplexity, Gemini, Cloudflare Workers AI (Llama 3.1)
*   **External APIs**: DataForSEO, RapidAPI, Resend, Amplitude, HubSpot, Firecrawl, Google PageSpeed Insights
*   **Build Tool**: N/A

## Where things live

*   `/index.html`: Main SPA entry point.
*   `/style.css`: All application styling.
*   `/data.js`: Industry intelligence database, competitor data.
*   `/app.js`: Frontend application logic.
*   `/server.js`: Backend Express server, API integrations.
*   `/package.json`: Node.js dependencies.
*   `/uploads/`: User-uploaded brand assets.
*   `/data/`: Flat-file persistence (migrated to Postgres `kv_store` at server boot).
*   `attached_assets/InfoGenie_User_Manual.pdf`: User manual.
*   `scripts/`: Build and utility scripts.
    *   `scripts/build_user_manual.js`: Generates user manual.
    *   `scripts/capture_screenshots.js`: Captures screenshots for user manual.
*   `services/optimizer/schema.js`: Defines optimizer database schema.

## Architecture decisions

*   **Dual-AI Attack Plan**: Key analyses (`/api/ai-attack-plan`) run GPT-4o and Claude in parallel, with a third GPT-4o synthesizing robust, blended intelligence.
*   **Atomic + Mutex Persistence**: Critical data uses single-writer mutexes and atomic temp-file-and-rename for race-safe writes, mirrored to Postgres for transactional safety.
*   **LLM Redundancy and Cost Optimization**: Multiple LLMs are integrated for redundancy, diverse capabilities, and cost-effectiveness based on task requirements.
*   **Agentic Command Bar with Function Calling**: A floating command bar uses GPT-4o function calling for natural language commands, including confirmation for destructive operations.
*   **AI Campaign Optimizer**: Hourly insights from ad platforms, rule-based optimization (PAUSE / SCALE BUDGET / HOLD) every 6 hours. Dry-run by default, with live mode applying decisions via platform APIs. Includes Creative Auto-Refresh (Meta, Google Ads) and Multi-Armed Bandit (Meta, Google Ads) for budget/bid allocation.
*   **Dynamic Audiences (Reach → Dynamic Audiences)**: Drip-style real-time, rule-based contact segments. Phase 1 = builder UI + live preview. Phase 2 = 15-min sweep cron + HubSpot webhook (HMAC-validated when `HUBSPOT_WEBHOOK_SECRET` is set) + members drill-in. Phase 3 = bind any audience to a Drip email sequence — auto-enrol on join, auto-unsubscribe on leave (only enrollments tagged with the binding id are touched; manual enrollments untouched; mutations under `global._dripStore.lock`). Phase 4A = mirror membership to a HubSpot Static List (auto-creates the list via `POST /crm/v3/lists` on first save when `crm.lists.write` scope is granted; pushes joins/leaves via `/crm/v3/lists/{id}/memberships/add|remove`). Phase 4B = bind a churn-risk audience to a single-touch AI win-back: on join, fires a 1-step drip enrollment with the stored variant (regeneratable via `/api/reengage/generate`), tagged `audienceBindingId='reng:<bindingId>'` so onLeave can selectively auto-unsubscribe just the system-fired win-backs and never manual ones. All three bridges (drip, hs-list, re-engage) run after the membership write commits and are fanned out per-contact in parallel with per-target try/catch.

## Product

*   **AI-Powered Marketing Intelligence**: Competitor analysis, keyword gap analysis, share of voice, predictive moves, win/loss intelligence.
*   **Campaign Automation**: AI creative generation, multi-channel advertising hub, social content calendar, drip campaign execution engine, re-engagement agent.
*   **SEO & Content Optimization**: Content-gap ideation, internal link suggester, CRO Lab, Content Scorer, Keyword-Page Map.
*   **Analytics & Reporting**: Cross-channel reporting, GSC/GA4 Analytics Hub, Attribution & ROI dashboard, Blended Performance/CAC, Goal-Based Autonomous Monitoring.
*   **Lead Management**: Lead Qualifier Agent, Lookalike Audience Builder.
*   **Real-time Monitoring**: Mention tracking with sentiment analysis, real-time alerts, Webhook channels for alerts.
*   **Platform Integrations**: DataForSEO, OpenAI, Anthropic, Resend, Amplitude, HubSpot, Firecrawl, Google PageSpeed Insights, RapidAPI, Gemini, Perplexity, Cloudflare Workers AI.

## User preferences

*   Non-technical user — prefers plain language + execution over options.
*   Every "Launch Campaign" registers the campaign in the AI Optimizer dashboard automatically. Without Meta/Google/TikTok creds, it lands as `platform_camp_id='local_<ts>'` so the user still sees it under Tracked Campaigns; once creds are connected the next launch uses the real platform id and the optimizer can ingest live data.
*   Counter-Message modal exposes a 🚀 **Launch Now** button that takes the selected AI variant straight into the Campaign Launch Brief — pre-fills name/platform/description/seed creative + sets `window._counterTarget` so the Campaigns view shows the "Targeting: <competitor>" banner.

## Gotchas

*   **API Authentication**: In production, `INFOGENIE_API_KEY` is required for most `/api/*` routes.
*   **LLM Quota Management**: Budget caps are enforced per provider, per IP, and per day when `INFOGENIE_API_KEY` is set.
*   **Resend Webhook URL**: Update after deployment for deliverability metrics.
*   **Google Analytics/Search Console**: Currently parked due to Google Workspace org policy issues.
*   **SSRF Guards**: Strict SSRF guards are in place for fetching external URLs.
*   **Postgres Migration**: Existing `data/*.json` files are migrated to Postgres `kv_store` at server boot.
*   **Ad Platform Connections**: Cross-Channel Report UI and backend fetchers are live but require real platform credentials (Meta, Google Ads, TikTok) for full functionality.

## Pointers

*   **Amplitude Documentation**: [https://amplitude.com/](https://amplitude.com/)
*   **DataForSEO API Docs**: [https://dataforseo.com/apis](https://dataforseo.com/apis)
*   **OpenAI API Docs**: [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)
*   **Anthropic API Docs**: [https://docs.anthropic.com/en/api/](https://docs.anthropic.com/en/api/)
*   **Resend API Docs**: [https://resend.com/docs/api-reference](https://resend.com/docs/api-reference)
*   **Chart.js Documentation**: [https://www.chartjs.org/docs/latest/](https://www.chartjs.org/docs/latest/)
*   **Express.js Documentation**: [https://expressjs.com/](https://expressjs.com/)
*   **Google PageSpeed Insights API**: [https://developers.google.com/speed/docs/insights/v5/get-started](https://developers.google.com/speed/docs/insights/v5/get-started)
*   **HubSpot API Docs**: [https://developers.hubspot.com/docs/api/overview](https://developers.hubspot.com/docs/api/overview)
*   **Firecrawl API Docs**: [https://firecrawl.dev/docs/api-reference](https://firecrawl.dev/docs/api-reference)
*   **Perplexity AI API**: [https://docs.perplexity.ai/docs/getting-started](https://docs.perplexity.ai/docs/getting-started)
*   **Gemini API (Google Cloud)**: [https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-gemini](https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-gemini)
*   **Cloudflare Workers AI**: [https://developers.cloudflare.com/workers-ai/](https://developers.cloudflare.com/workers-ai/)