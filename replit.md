# InfoGenie

InfoGenie is an AI-powered marketing intelligence and campaign automation platform for analyzing competitors, generating ad campaigns, optimizing results, and re-engaging customers.

## Run & Operate

*   **Run**: `node server.js`
*   **Env Vars**: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `RESEND_WEBHOOK_SECRET`, `HUBSPOT_PRIVATE_APP_TOKEN`, `FIRECRAWL_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `INFOGENIE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, `DATABASE_URL`, `SLACK_WEBHOOK_URL`, `APOLLO_API_KEY`, `BUILTWITH_API_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`, `ZERNIO_API_KEY`.

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
*   **Brandwatch-Killer Suite — Tiers 1-15 (compressed index)** — full design notes in git history; each entry: route · key endpoint · storage. All follow the same pattern (strict-JSON LLM prompt + `/^_DUMMY/i` key gate + template fallback + Postgres persistence + `_escapeHtml`/`_safeUrl` frontend builder).
    *   **T1 Search & AI Visibility** (Reach → Search & AI Visibility) · `POST /api/search-intel/{ai-visibility,pulse,images}/*` · multi-LLM (GPT-4o-mini + Claude Haiku + Perplexity + Gemini) brand-mention parser, DataForSEO Labs keyword pulse, GPT-4o-mini vision logo recognition · tables `search_intel_{llm_runs,pulse_runs,images}`.
    *   **T1 One-Click Reports** (📊/📄/📈 on Search & AI Visibility) · `GET /api/exports/{pptx|pdf|xlsx}/{search-intel|campaigns}` · `services/exports/data_sources.js` declarative pipeline · pptxgenjs / exceljs / pdfkit.
    *   **T1 Influencer CRM** (Reach → Influencer CRM) · `/api/influencers` REST + `POST /:id/draft-email` (GPT-4o-mini) · tables `influencers` + `influencer_outreach` · status pipeline prospect→contacted→negotiating→active.
    *   **T2 Crisis Radar** (Monitor → Crisis Radar) · `/api/crisis-radar/{watchlist,incidents,snapshots,run-now}` · 6h cron, baseline = 7-snapshot moving avg, Slack alerts via SSRF-guarded webhook · tables `crisis_{watchlist,snapshots,incidents}`.
    *   **T2 Battle Cards** (Compete → Battle Cards) · `POST /api/battle-cards/generate` (GPT-4o-mini, 4 strengths + 4 weaknesses + 3 moves + 4 counter-plays) · table `battle_cards`.
    *   **T2 Trending Topics** (Monitor → Trending Topics) · `POST /api/trends/detect` (Perplexity sonar, 6-10 7-day topics) · table `trend_runs`.
    *   **T3 Share of Voice** (Compete → Share of Voice) · `GET /api/sov/{series,targets}` · auto-populated by Crisis Radar 6h cron · table `sov_snapshots` · Chart.js stacked-area.
    *   **T3 Influencer Discovery** (Reach → Influencer Discovery) · `POST /api/discovery/influencers` (Perplexity, ≥5k followers) · one-click "+ Add to Influencer CRM".
    *   **T4 AI Daily Digest** (Plan → Daily Digest) · `POST /api/digest/{run-now,/:id/send}` + 24h cron per watchlist brand (GPT-4o-mini, sections kind=warning|win|action|highlight) · table `digest_runs` · Slack send.
    *   **T4 Reply Assistant** (Reach → Reply Assistant) · `GET /api/reply-assistant/inbox` + `POST /draft` (GPT-4o-mini, tone allowlist) · ranked top-30 mentions, long + 240ch X variant.
    *   **T5 Press Release Generator** (Plan → Press Releases) · `POST /api/press-release/generate` (GPT-4o-mini, kind=crisis_response|product_launch|milestone|counter_competitor|partnership|custom) · optional `from_incident_id`/`from_battle_card_id` hydration.
    *   **T5 Smart Alert Routing** (Monitor → Alert Routing) · `/api/alert-routing` REST + `POST /test/:id` · trigger kinds `crisis_incident|sov_drop|digest_ready|mention_volume|custom` · channels Slack + email (Resend) · tables `alert_{rules,dispatches}`.
    *   **T6 Backlink Intel** (Reach → Backlink Intel) · `POST /api/backlinks/{summary,referring-domains}` (DataForSEO `/v3/backlinks/*/live`).
    *   **T6 Content Calendar** (Plan → Content Calendar) · `POST /api/content-calendar/generate` (GPT-4o-mini, 1-30 days, channel allowlist 8) · table `content_calendar_runs` · CSV export.
    *   **T7 Podcast Monitor** (Monitor → Podcast Monitor) · `POST /api/podcast-monitor/scan` (Perplexity sonar, episodes with sentiment + platform) · table `podcast_monitor_runs`.
    *   **T7 A/B Designer** (Plan → A/B Test Designer) · `POST /api/ab-designer/generate` (GPT-4o-mini, 8 element_kinds, 10 angles, length-aware) · table `ab_designer_runs`.
    *   **T8 Voice of Customer** (Monitor → Voice of Customer) · `POST /api/voc/mine` (GPT-4o-mini, 4-8 themes kind=praise|complaint|question|feature_request|neutral) · table `voc_runs`.
    *   **T8 Pricing Watcher** (Compete → Pricing Watcher) · `/api/pricing-watch/{targets,scan/:id,snapshots/:id}` · Firecrawl `/v1/scrape` + GPT-4o-mini extract · tables `pricing_watch_{targets,snapshots}`.
    *   **T9 Email Deliverability Auditor** (Reach → Email Auditor) · `POST /api/deliverability/audit` (pure DNS — MX + SPF + DKIM 19 selectors + DMARC + MTA-STS + BIMI) · weighted A-F grade.
    *   **T9 Landing Page Builder** (Plan → Landing Page Builder) · `POST /api/landing-pages/generate` (GPT-4o-mini, hero + 4-6 features + 3-4 steps + 2-3 testimonials + 4-6 FAQs + final CTA) · `_renderHtml(content,{accent})` server-side responsive HTML · table `landing_pages` · sandboxed iframe preview.
    *   **T10 Tech Stack Detector** (Compete → Tech Stack Detector) · `POST /api/tech-stack/{detect,compare}` (BuiltWith Free API, normalised categories + live/dead pills, multi-domain matrix up to 5).
    *   **T10 Cold Email Writer** (Reach → Cold Email Writer) · `POST /api/cold-email/generate` (GPT-4o-mini strict-JSON, 1-5 step sequence, tone allowlist, template fallback) · table `cold_email_runs`.
    *   **T11 Web Vitals Auditor** (Compete → Web Vitals Auditor) · `POST /api/web-vitals/audit {url}` (Google PageSpeed Insights v5, mobile+desktop parallel, lab + CrUX field + top 6 opportunities).
    *   **T11 B2B Lead Finder** (Reach → B2B Lead Finder) · `POST /api/lead-finder/search` (Perplexity sonar, never invents emails, max 2/company, `window._lfLeads` cache for HubSpot push) · table `lead_finder_runs`.
    *   **T12 SERP Position Tracker** (Compete → SERP Tracker) · `/api/serp-tracker/{keywords,scan/:id,scan-all,history/:id}` (DataForSEO `/v3/serp/google/organic/live/regular`, 15-country location_code map, exact-domain match) · tables `serp_tracker_{keywords,runs}`.
    *   **T12 HubSpot Sync** (Reach → HubSpot Sync) · `/api/hubspot-sync/{test,push-lead,push-influencer,push-bulk,recent-contacts}` (`HUBSPOT_PRIVATE_APP_TOKEN` Bearer, batch upsert by email idProperty, scope-error hint).
    *   **T13 Meta Ads Insights** (Optimize → Meta Ads Insights) · `/api/meta-insights/{test,account-summary,campaigns,top-ads}` (Graph API v19.0 `/act_{id}/insights`, allowlisted date presets, ROAS = revenue/spend, friendly `ads_read` hint).
    *   **T13 Keyword Explorer** (Plan → Keyword Explorer) · `POST /api/keyword-explorer/explore` (DataForSEO Labs `keyword_overview` + `keyword_ideas` parallel, 15 countries, KD/CPC/intent, 5-50 ideas) · table `keyword_explorer_runs`.
    *   **T14 Google Ads Insights** (Optimize → Google Ads Insights) · `/api/google-ads-insights/{test,account-summary,campaigns,top-ads}` (Google Ads API v17 GAQL `searchStream`, OAuth2 refresh-token flow with in-memory access-token cache, allowlisted date presets, friendly errors for dev-token / customer-id / OAuth client / refresh-token issues, optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID` for MCC).
    *   **T14 TikTok Ads Insights** (Optimize → TikTok Ads Insights) · `/api/tiktok-ads-insights/{test,account-summary,campaigns,top-ads}` (TikTok Marketing API v1.3 `/report/integrated/get/`, `Access-Token` header, date-preset → start/end YYYY-MM-DD mapping, `AUCTION_ADVERTISER|CAMPAIGN|AD` data levels, friendly scope/advertiser-id hints).
    *   **T15 Social Publisher** (Reach → Social Publisher) · `/api/social-publisher/{test,profiles,accounts,connect-url,post,posts,schedule-calendar}` (Zernio API v1, `ZERNIO_API_KEY` Bearer, 15-platform allowlist twitter|instagram|facebook|linkedin|tiktok|youtube|pinterest|reddit|bluesky|threads|googlebusiness|telegram|snapchat|whatsapp|discord, OAuth-via-authUrl, post/schedule with mediaUrls + scheduledFor, bulk Content-Calendar scheduling, friendly 401/quota/profile/account hints).
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