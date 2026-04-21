# InfoGenie — AI Autonomous Marketing Intelligence Platform

## Overview
InfoGenie is a comprehensive AI-powered marketing intelligence and campaign automation platform built as a static single-page application. It enables businesses to analyse competitor marketing strategies, generate high-performing ad campaigns, autonomously optimise results, and re-engage lapsed leads and customers.

## Architecture
- **Type**: Node.js/Express backend + Static SPA frontend
- **Server**: `server.js` listens on port 5000 (preview) AND port 80 (external)
- **Frontend**: Pure HTML5 + CSS3 + Vanilla JavaScript
- **Charts**: Chart.js v4.4.0 (CDN)
- **Fonts**: Google Fonts — Inter + Sora (CDN)
- **Backend API**: DataForSEO + OpenAI GPT-4o + Anthropic Claude (both via Replit AI Integrations) + RapidAPI social intelligence
- **Dual-AI Attack Plan**: `/api/ai-attack-plan` runs GPT-4o and Claude in parallel via `Promise.allSettled`, then merges the two plans with a third GPT-4o synthesis call — badge shown in UI ("Synthesised from GPT-4o + Claude")
- **AI**: `openai` npm package + `@anthropic-ai/sdk`; uses `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY` env vars (set automatically by Replit, no user keys needed)

## File Structure
```
/
├── index.html          # Main SPA with all view templates
├── style.css           # Complete styling (Deep Navy + Teal + Cyan brand)
├── data.js             # Industry intelligence database + competitor data (7 industries, 11 competitor pool per industry)
├── app.js              # Main application controller (~5600 lines)
├── server.js           # Express backend (DataForSEO integration, dual-port, file upload)
├── package.json        # Node.js dependencies
└── uploads/
    ├── creatives/      # Brand asset files (images, videos, PDFs, SVGs)
    └── creatives_meta.json  # Asset metadata (JSON array, auto-managed)
```

## Key Globals (app.js)
- `analysisData` — current analysis session data
- `queuedCampaigns` — counter-campaigns queued from Win/Loss Intelligence (shown at top of Campaigns view)
- `creativeRound` — current creative batch (0=original, 1=new angles, 2=urgency hooks; wraps every 3)
- `window._wlData` — Win/Loss card data map for modal lookup
- `window._lastCampRecs` — last campaign recommendations for modal access
- `window._creativeStudio` — Creative Studio state (current campaign's full copy, scripts, email brief — used by _csDownload/_csCopyAll/_csSendEmail)
- **Battle Plan timer**: `_apSecs` counter ticks every 1s; `apElapsed` is an inline `<span style="color:#00E5FF">` inside `apLoadTitle`; any innerHTML update to the title must re-embed the span or use `apElapsed` ID for the querySelector (consistent with Reddit scanner style)

## Navigation Structure (4-Stage Workflow)
The navbar (two-row layout) organises all 17 sections into four logical groups with visible category labels:
- **ANALYSE**: Dashboard · Competitors · Intelligence · 🔴 Reddit · ⚔️ Battle Plan
- **CREATE**: AI Creative · Campaigns · Content AI · Social
- **REACH**: Audience · Advertise · AI Visibility
- **GROW**: Results · 🔁 Re-Engage · ⚡ Auto · 🏢 Agency · 👔 C-Suite · 🎯 Action Center · 🚀 AutoSEO Pro · Settings

Each section's view header breadcrumb also shows the group label (e.g. "Analyse › Competitors", "Create › Campaigns") for consistent orientation throughout.

## Features
1. **Website URL Input** — Enter any website, detect industry automatically; optional industry text field below URL row refines competitor targeting — `#industryInput` passes typed text to `detectIndustryFromText()` in data.js, which overrides URL auto-detection; hint label updates to confirm detected industry
2. **Industry Detection** — Identifies industry from URL/domain (7 industries supported); `detectIndustryFromText(text)` in data.js fuzzy-matches typed industry text against alias tables and INDUSTRY_DB keywords, falling back to URL-based `detectIndustry(url)` if no override supplied; `runAnalysis(url, country, industryOverride)` resolves final industry key
3. **Competitor Analysis** — 5+ real competitors per industry with actual website names
4. **Dashboard** — KPI cards, CTR/ROAS charts, trend analysis, competitor table
5. **Competitor Intelligence** — Deep dive with campaigns, suggestions, audiences per competitor
6. **Campaign Analysis** — AI-generated campaign recommendations with projected metrics; each card has a "🎨 Creative Studio" button
7. **Audience Intelligence** — Aggregate audience segments with targeting recommendations
8. **AI Creative Generation** — Competitor vs. InfoGenie side-by-side cards, auto-target audience panels, CTR/ROAS dual-axis chart
9. **⚡ Intelligence Hub** — Exclusive AI features: keyword gap analysis, share of voice donut chart, competitor signal feed (dark periods/budget surges/price changes/new campaigns), predictive moves with confidence %, 90-day category domination roadmap, win/loss intelligence
10. **Settings & Integrations** — Full documentation system (38 integrations), step-by-step guides, code examples, API reference tables, error codes, troubleshooting Q&A
11. **ROAS Domination Plan** — Detailed 90-day roadmap per competitor: ROAS gap analysis with transparent reasoning, 3-phase execution plan with projected revenue, channel budget allocation, competitor weakness identification
12. **Rich Campaign Launch** — Full campaign brief before launch: AI-generated headlines/descriptions, platform strategy, bid strategy, audience spec, budget breakdown (daily/weekly/monthly), projected conversions and revenue
13. **Creative Preview Modal** — 4-format ad preview per campaign: Search Ad, Display Banner, Instagram Story, Video Script — with AI copy per format
14. **Multi-Channel Advertise Hub** — 22-platform connected accounts grid with per-channel 3-step lead-gen campaign modals; each channel (Meta, Instagram, Google Search, YouTube, TikTok, LinkedIn, Bing, Snapchat, Spotify, Pinterest, X, Threads, etc.) has its own goal selector, format picker, AI-generated ad copy preview (GPT-4 via `/api/ai-channel-ad`), and launch flow; live Optimisation Folders for active campaigns; `ADV_PLATFORMS` array with platform-specific ad formats
15. **Social Content Calendar** — Monthly calendar view with per-platform post scheduling; Create Post modal with AI-generated captions (GPT-4), multi-platform selection, file upload, date/time picker; scheduled/published/draft status tracking; upcoming posts sidebar; `POST /api/ai-social-caption` GPT-4 endpoint
16. **Content AI Intelligence Hub** — 4-tab page: Overview (traffic health, content score, AI visibility score, keyword shift monitor, LLM citation gap detector with Fix Gap → cluster flow), Topical Clusters (GPT-4 builds full cluster with pillar page + 7-10 subtopics + 6-8 real user questions + LLM tip via `/api/ai-content-clusters`), Content Gaps (intent/volume/priority table with Build Content shortcuts), Page Audit (crawlability scores, outdated content detector, AI fix suggestions)
17. **Reddit Intelligence** — Dedicated 🔴 Reddit page (`view-reddit`, `buildRedditIntel()`): config panel (brand, keywords, competitors auto-filled from analysis), 4-tab layout: Monitor (AI-scored thread feed sorted by relevance), Trending (sorted by upvote velocity pts/hr), SERP Signals (threads flagged as likely ranking in Google), Reply Studio (persona/tone settings + GPT-4 brand-aware reply generator). Fetches from Reddit public JSON API + HN Algolia in parallel, deduplicates, then batch-scores via GPT-4 (`/api/reddit-monitor`). Reply generation via `/api/reddit-reply`. Cards show relevance score bar, sentiment badge, urgency badge, SERP flag, velocity badge, and "✍️ Reply" button that pre-loads Reply Studio.
- `window._redditPosts` — current scanned posts array
- `window._redditPersona` — { brand, tone, persona } saved between sessions
- `window._redditSelPost` — currently selected post for Reply Studio

## Supported Industries
- E-commerce & Retail (Amazon, Shopify, eBay, Etsy, Wayfair)
- Fintech & Finance (eToro, IG Markets, Plus500, XM, Revolut)
- SaaS & Software (HubSpot, Salesforce, Monday, Mailchimp, Zendesk)
- Crypto & Web3 (Coinbase, Binance, Kraken, ByBit, Ledger)
- Travel & Hospitality (Booking.com, Expedia, Airbnb, TripAdvisor, Hotels.com)
- Education & E-Learning (Coursera, Udemy, Skillshare, MasterClass, Duolingo)
- Marketing & Analytics (Semrush, SimilarWeb, AdCreative.ai, Hootsuite, Ahrefs)

## Key Metrics Tracked
- Avg CTR (Click-Through Rate)
- ROAS (Return on Ad Spend)
- CPA (Cost Per Acquisition)
- Monthly Traffic Estimates
- Conversion Rate
- AI Opportunity Score

## Brand Identity
- Primary: Deep Navy (#0A1628)
- Accent: Teal (#00C9C8)
- Highlight: Electric Cyan (#00E5FF)
- Success: Green (#10B981)
- Warning: Gold (#F59E0B)

## Business Plan
- Pricing: $99/mo (Starter) → $399/mo (Pro) → $999/mo (Agency) → $3K–$10K (Enterprise)
- Target Market: $600B+ global digital ad spend
- Revenue Model: SaaS + Usage fees + Ad-spend management fee
