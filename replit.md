# InfoGenie

InfoGenie is an AI-powered marketing intelligence and campaign automation platform for analyzing competitors, generating ad campaigns, optimizing results, and re-engaging customers.

## Run & Operate

*   **Run**: `node server.js`
*   **Env Vars**: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `RESEND_WEBHOOK_SECRET`, `HUBSPOT_PRIVATE_APP_TOKEN`, `FIRECRAWL_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `INFOGENIE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, `DATABASE_URL`, `SLACK_WEBHOOK_URL`, `APOLLO_API_KEY`, `BUILTWITH_API_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`, `TIKTOK_RAPIDAPI_KEY` (optional paid fallback for T20 TikTok Downloader, ~$10/mo), `ZERNIO_API_KEY`.

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
*   **Brandwatch-Killer Suite (T1-T19)** — see `docs/tiers.md` for full per-feature index (route · endpoint · storage). All tiers follow the same pattern: strict-JSON LLM prompt + `/^_DUMMY/i` key gate + template fallback + Postgres persistence + `_escapeHtml`/`_safeUrl` frontend builder. One-line summary per tier:
    *   **T1** Search & AI Visibility · One-Click Reports (PPTX/PDF/XLSX) · Influencer CRM
    *   **T2** Crisis Radar (6h cron + Slack) · Battle Cards · Trending Topics
    *   **T3** Share of Voice (Chart.js) · Influencer Discovery
    *   **T4** AI Daily Digest (24h cron) · Reply Assistant
    *   **T5** Press Release Generator · Smart Alert Routing (Slack + Resend email)
    *   **T6** Backlink Intel (DataForSEO) · Content Calendar (CSV export)
    *   **T7** Podcast Monitor · A/B Test Designer
    *   **T8** Voice of Customer · Pricing Watcher (Firecrawl)
    *   **T9** Email Deliverability Auditor (DNS A-F grade) · Landing Page Builder (server-rendered)
    *   **T10** Tech Stack Detector (BuiltWith) · Cold Email Writer (1-5 step sequences)
    *   **T11** Web Vitals Auditor (PageSpeed) · B2B Lead Finder (Perplexity, no invented emails)
    *   **T12** SERP Position Tracker (15 countries) · HubSpot Sync (batch upsert)
    *   **T13** Meta Ads Insights (Graph v19) · Keyword Explorer (DataForSEO Labs)
    *   **T14** Google Ads Insights (GAQL + OAuth2) · TikTok Ads Insights (Marketing v1.3)
    *   **T15** Social Publisher (Zernio, 15 platforms) · Social Analytics (per-account engagement)
    *   **T16** Email Personalizer (Firecrawl + GPT) · YouTube Monitor (Perplexity) · Weekly Report (7d auto-cron PDF email)
    *   **T17** Reddit Pulse · Ad Library Spy (Meta + TikTok) · Newsletter Tracker · Meeting Notes (BANT) · Headline Tester (10 patterns)
    *   **T18** Review Aggregator (5 sites) · Churn Scorer (0-100) · Twitter/X Pulse · Job Board Spy · Video Script Generator (TikTok/Reels/Shorts/LinkedIn)
    *   **T19** Chatbot Builder (FAQ + embed snippet) · Glassdoor Sentiment (culture signals) · Quora Mining (intent + response angle)
    *   **T20** TikTok Downloader (bulk URL → no-watermark mp4 + meta, pairs with Ad Library Spy)
    *   **T21** Voiceover (OpenAI TTS, 6 voices × 2 quality tiers, mp3 output, pairs with Video Script Generator)
    *   **T22** SEO On-Page Auditor (regex-parsed 19-check 100-pt audit + A-F grade + prioritised fixes, pairs with Web Vitals)
    *   **T23** Embeddable Audit Widget (paste-once `<script>` snippet → visitor URL+email → teaser score + lead capture, built on T22)
    *   **T24** SEO Task Manager (every T22 warn/fail becomes a tracked task with priority/assignee/due-date · re-audit auto-closes done · dup-skips on url+check_id, pairs with T22)
    *   **T25** Schema.org / JSON-LD Generator (form-driven 8 types — Organization · Article · Product · FAQPage · LocalBusiness · BreadcrumbList · Event · Recipe — outputs paste-ready `<script type="application/ld+json">`, boosts T1 AI Visibility)
    *   **T26** Unified Conversation Inbox (one inbox-style view aggregating Reddit Pulse · Twitter/X Pulse · Reviews · Quora · Glassdoor · Newsletter mentions · Chatbot · idempotent `/ingest` via `UNIQUE(source, source_id)` + per-item `_safeMap` guards · status flow new→replied→resolved→snoozed · filter by source/status/sentiment + search · pairs with T4 Reply Assistant)
    *   **T27** Conversion Boosters (two paste-once `<script>` widgets — 📣 Social Proof popup with rotating "Sarah from Cape Town just signed up" toasts · 🚪 Exit Intent popup capturing email on mouseleave/rapid-scroll-up · settings JSONB-stored & server-side normalised · embed JS is IIFE with `textContent`-only DOM build · public routes rate-limited via `req.socket.remoteAddress` (unforgeable, NOT `req.ip` which is XFF-spoofable when `trust proxy` is on) · captured leads `INSERT ON CONFLICT DO NOTHING` into `unified_inbox_items` so they appear in T26 inbox automatically · pairs with T26 Unified Inbox)
    *   **T28** White-Label Reports (single global brand profile in `kv_store.white_label.brand_profile` — agency name · logo data URL ≤256KB png/jpg · primary/accent/text colours · footer text · `hideInfoGenieBranding` toggle · threaded as optional `brand` arg through `streamPptx`/`streamPdf`/`streamXlsx` · auto-applied by `/api/exports/:format/:source` when `brand.enabled` · sample preview at `/api/white-label/preview/{pdf,pptx,xlsx}`)
    *   **T29** Multi-Page SEO Crawler (BFS same-origin crawl, hard caps 100 pages / 5min wall-clock / 4 concurrent audits · reuses T22 `runAudit` per page · streams `seo_crawl_pages` rows incrementally so the user sees progress · aggregates avg score → site grade A-F · live polling via `/runs/:id` returning {run, pages, live:{progress,errors,status}})
    *   **T30** GEO Audit (12 weighted regex checks summing to 100 — q-style headings · JSON-LD/FAQPage · concise paragraphs ≤80w · E-E-A-T author bio · freshness `article:modified_time`/&lt;time&gt; · 15-60w lead answer · lists/tables · alt-text % · internal links · `/llms.txt` HEAD probe · title 20-70 · meta desc 70-160 · sorted fail→warn→pass with prioritised `fix` strings · pure regex no LLM call · pairs with T22)
    *   **T31** Local SEO Basics (11 weighted regex checks summing to 100 for brick-and-mortar / service-area businesses — visible phone · click-to-call `tel:` · street + postcode · LocalBusiness JSON-LD (Restaurant/Store/MedicalBusiness/etc) · Google Business Profile / Maps link · embedded Maps iframe · opening hours · contact page link · NAP consistency (distinct phone count) · service-area phrasing · HTTPS+canonical hygiene · pure regex · pairs with T25 Schema Generator's LocalBusiness output)
    *   **T32** Social Tags Audit (13 weighted regex checks summing to 100 — og:title 10-95 · og:description 50-200 · og:image · og:type · og:url · twitter:card · twitter:image+title fallback · Facebook Pixel (fbq/fbevents.js) · GA4/GTM (deprecated UA flagged warn) · social profile links across 6 platforms (FB/X/LinkedIn/Instagram/YouTube/TikTok) · favicon · apple-touch-icon · Organization sameAs[] in JSON-LD · pure regex · pairs with T25 for sameAs schema generation)
*   **Dynamic Audiences (Reach → Dynamic Audiences)**: Real-time rule-based contact segments. Phase 1 builder UI + live preview · Phase 2 15-min sweep cron + HubSpot webhook (HMAC-validated when `HUBSPOT_WEBHOOK_SECRET` is set) · Phase 3 bind to Drip email sequence (only `audienceBindingId`-tagged enrollments touched, manual untouched, mutations under `global._dripStore.lock`) · Phase 4A mirror to HubSpot Static List (auto-creates via `POST /crm/v3/lists` when `crm.lists.write` scope present) · Phase 4B churn-risk audience → single-touch AI win-back drip tagged `reng:<bindingId>`. All three bridges run after membership write commits, fanned out per-contact in parallel with per-target try/catch.

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