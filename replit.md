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
- `window._icpProfile` — ICP Studio: { ageRange, role, intent, painPoints[], desires[], budget }
- `window._icpVoC` — ICP Studio Voice-of-Customer: { triggers[], objections[], emotionalDrivers[] } (each item: { text, evidence })
- `window._intentMap` — Search Intent Map: { keywords:[{keyword, intent, confidence, recommendedPageType, intentMatchScore, matchReason, competitorGap, gapReason, opportunity, estimatedCPC, priority}], summary:{total, byIntent, gaps, avgIntentMatch, mustDoCount} }
- `window._intentMustDos` — must-do keywords sent from Intent Map to Battle Plan (also in localStorage as `infogenie_intent_mustdos`)
- `window._linkSuggesterData` — Internal Link Suggester state: { domain, brand, pages[], suggestions[{id, sourceUrl, targetUrl, anchorText, priority, equityLift, reason, status}] }
- `window._croLabData` — CRO Lab state: { trustSignals[], trustScore, friction[], frictionScore, abIdeas[], overall }
- `window._croAbTests` — Active A/B tests launched from CRO Lab
- `window._croTab` — CRO Lab active tab ('trust' | 'friction' | 'abtests')
- `window._analyticsConnections` — { gsc:bool, ga4:bool } — GSC/GA4 Hub connection state
- `window._analyticsHubData` — GSC/GA4 Hub dashboard data: { domain, pages[], top[], weak[], totals, period }

## New Modules (April 2026 — Grow menu)
- **Internal Link Suggester** (view-link-suggester) — `buildLinkSuggester()` + `runLinkSuggester()`. Generates source→target page link pairs with anchor text, equity-lift estimates, and CSV export. Apply/Dismiss workflow.
- **CRO Lab** (view-cro-lab) — `buildCroLab()` + `runCroAudit()`. 3-tab UX: 10-point Trust Signal Audit, 8-point Checkout Friction scorer, 6 pre-built A/B test specs that can be "launched" into an in-memory queue.
- **GSC / GA4 Analytics Hub** (view-analytics-hub) — `buildAnalyticsHub()` + `connectAnalytics(svc)` + `loadAnalyticsHub()`. Two-stage UX: connector cards (mock OAuth) → KPI strip + Top/Weak performer panels + per-page table. Weak performers route to AutoSEO.
- All three gate behind a "Run an analysis first" empty state when `window.analysisData` is absent.
- `window._counterTarget` — used by Creative Studio activation flow; ICP Studio writes here with source='icp-studio' to pre-fill next campaign target
- **Battle Plan timer**: `_apSecs` counter ticks every 1s; `apElapsed` is an inline `<span style="color:#00E5FF">` inside `apLoadTitle`; any innerHTML update to the title must re-embed the span or use `apElapsed` ID for the querySelector (consistent with Reddit scanner style)

## Navigation Structure (4-Stage Workflow)
The navbar (two-row layout) organises all 20 sections into four logical groups with visible category labels.
Each group flows in a deliberate order — use the "Next Step" banners at the bottom of each view to follow the guided path.

- **ANALYSE** *(Understand the market)*: Dashboard → Competitors → Intelligence Hub → Battle Plan → Reddit Intel → ICP Studio → Intent Map → Google Search
- **CREATE** *(Build ads & content)*: Brand Assets → AI Creative → Campaigns → Content AI → Social Calendar
- **REACH** *(Distribute to audiences)*: Audience → Advertise Hub
- **GROW** *(Track, scale & manage)*: AutoSEO Pro → AI Visibility → Action Center → Results → Re-Engage → Automations → Agency & Reports → C-Suite Reports → Settings

**Logical end-to-end flow:**
Analyse competitors → Create Battle Plan → Build Content & Campaigns → Target Audience → Deploy Ads → Track Results → Re-Engage → Automate → Report

**"What's Next?" banners** appear at the bottom of every view, guiding users to the next logical step with one click.
Each section's view header breadcrumb also shows the group label (e.g. "Analyse › Competitors", "Create › Campaigns") for consistent orientation throughout.

**Note — AI Visibility is in Grow (not Reach):** AI Visibility covers LLM citation tracking (ChatGPT/Claude/Gemini mentions). It is an organic growth channel, logically grouped with AutoSEO Pro.

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
19. **Keyword–Page Map** — Dedicated 🗺️ page (`view-keyword-map`, `buildKeywordMap()` in app.js) under ANALYSE that enforces SEO discipline by assigning ONE primary keyword per page plus 2-5 supporting keywords (`POST /api/keyword-page-map`, GPT-4o, up to 30 pages × 80 keywords). Auto-seeds keyword pool from `window._intentMap` (or competitor `topKeywords` as fallback) and pages from common paths off `analysisData.url` (`/`, `/about`, `/pricing`, `/blog`, `/contact`). Per-page card shows: URL, primary keyword (with confidence %), supporting keyword chips, page-strength bar (how well the existing page already serves the chosen primary), AI rationale, and concrete next-step recommendation. **Cannibalisation detection**: any primary keyword chosen for >1 URL gets flagged red ⚠️, with a top-of-page alert listing every conflict group and the competing URLs. Summary tiles: pages mapped · unique primaries · avg page strength · cannibalised keywords · cannibalised pages. Two CTAs: "⬇️ Export CSV" (full table inc. supporting keywords, status, rationale, recommendation) and "⚔️ Send Cannibal. Fixes to Battle Plan" (queues cannibalisation fix tasks into `window._keywordMapFixes` + localStorage `infogenie_keyword_fixes` and navigates to Battle Plan). Server validates payloads (400 bad input, 502 AI parse fail, 500 runtime).
18. **Search Intent Map** — Dedicated 🧭 page (`view-intent-map`, `buildIntentMap()` in app.js) under ANALYSE that classifies up to 40 keywords into 4 intent buckets (Informational / Commercial / Transactional / Navigational) via GPT-4o (`POST /api/intent-map`). Each keyword card shows: intent badge, confidence, recommended page type (Blog / Comparison / Pricing / Brand Page / FAQ / etc.), 0-100 page-fit score with colour-coded bar, competitor-gap flag with gap reason, one-line opportunity action, estimated CPC, and priority (must-do / nice-to-have / skip). Auto-seeds keywords from `analysisData.competitors[].topKeywords`. Top summary tiles: total mapped · high-intent count · avg page-fit % · competitor gaps · must-do count. Two CTAs: "⬇️ Export CSV" (downloads full classification table) and "⚔️ Send to Battle Plan" (queues must-do keywords into `window._intentMustDos` + localStorage and navigates to Battle Plan). Server validates payloads (400 on bad types) and returns 502 on AI parse failure.
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

## User Manual (Downloadable PDF)
- Location: `attached_assets/InfoGenie_User_Manual.pdf` (41 pages, ~2.3 MB)
- Builder: `scripts/build_user_manual.js` (PDFKit, no headless browser)
- Screenshot capture: `scripts/capture_screenshots.js` (Puppeteer + Chromium 131)
  - Hardened with per-view try/catch + browser auto-relaunch on disconnect
  - Run all: `node scripts/capture_screenshots.js`
  - Run subset: `node scripts/capture_screenshots.js --only=agency,settings`
- Screenshots stored in `attached_assets/manual_screenshots/<id>.jpg` (1440×900 JPEG)
- 30 views captured (one per feature). Each PDF feature page embeds its corresponding screenshot.
- View routing for screenshots: `/view/<id>` (server.js + app.js URL router) with `<base href="/">` in index.html so relative CSS/JS still resolve.
- Layout per feature page: header bar (section colour) → "What it does" → screenshot with border + caption → 2-column Inputs/Outputs → "How to use it" tinted box. Each feature gets its own page for consistent alignment.
- To rebuild: capture screenshots first, then `node scripts/build_user_manual.js`. Output overwrites the PDF in place.

## Tier 1 + Tier 2 Plai-Parity Modules (April 2026 build)
Added 10 new modules in cache buster `v=20260425Q`. All client-side, simulated from analysisData.

### Create dropdown
- **Landing Page Builder** (`landing-builder` → `buildLandingBuilder`) — 7-section live preview + HTML export
- **Smart Creative Builder** (`smart-creative` → `buildSmartCreative`) — 50+ ad variants across Meta/Google/TikTok/LinkedIn/X with CSV export
- **AI UGC Avatars** (`ugc-avatars` → `buildUgcAvatars`) — 6 avatars + AI-written script + mock video preview
- **AI Voiceovers** (`voiceovers` → `buildVoiceovers`) — 8 voices, 12 languages, mock waveform + MP3/WAV export
- **Templates Library** (`templates` → `buildTemplates`) — 26 templates filtered by type (ad/lp/email/social). Card visuals are fetched live per industry via `/api/template-images` (DataForSEO Google Images, SerpAPI fallback) with a bounded LRU 7-day cache; curated Unsplash photos act as `<img onerror>` fallbacks.

### Reach dropdown
- **Optimization Folders** (`opt-folders` → `buildOptFolders`) — 4 auto-optimisation folders with rules + savings tally
- **Import Existing Campaigns** (`import-campaigns` → `buildImportCampaigns`) — Mock OAuth for Meta/Google/TikTok/LinkedIn + audited table
- **International Localization** (`localization` → `buildLocalization`) — 40+ languages, 3 presets (top10, EU pack, all), translation table

### Manage dropdown
- **Workspaces & Team** (`workspaces` → `buildWorkspaces`) — Multi-workspace switcher, team table with roles, audit log

### Inline (Dashboard)
- **Forecast vs Actual + Savings widget** (`renderForecastSavingsWidget`) — Auto-rendered on dashboard, SVG dual-line chart + savings tally

### Architecture
- All modules use `_lsAD()`/`_lsDomain()`/`_lsBrand()`/`_lsSector()`/`_lsKeywords()` resilient helpers (closure → window mirror → localStorage fallback).
- Shared helpers: `_emptyAnalysisCard()` (empty state), `_seedRng(domain)` (deterministic per-domain output), `_esc()` (HTML escape for XSS safety on user-controlled values).
- All run* triggers gate on `_lsDomain()` and redirect to home when no analysis exists.
- State persisted on `window._{module}Data` globals so view re-entry shows last-built result.
- All builders registered in `navigateTo()` dispatcher in app.js (lines ~2249-2278).

## Account System & Per-User Persistence (added 2026-04-28)
- **Auth wall** (app.js lines 56-145): Full-screen blocking modal on first visit. Login / Create Account tabs. Defaults to signup if no users exist locally, login otherwise. On success → `location.reload()`.
- **Per-user localStorage namespace** (app.js lines 9-53): Monkey-patches `localStorage.getItem/setItem/removeItem` to auto-prefix every key as `_u:<email>::<key>` for the active user. System keys (`ig-users`, `ig-current-user`, `ig-theme`) and already-prefixed keys are left alone. Result: ALL existing per-domain state in the app (analyse settings, campaigns, articles, social posts, etc.) is automatically isolated per account with zero changes elsewhere.
- **window._auth API**: `getUsers()`, `currentProfile()`, `signup({name,email,password})`, `login({email,password})`, `logout()`. Password is a 32-bit non-cryptographic hash — this is CLIENT-SIDE state separation, not real auth. No backend session. For real production auth, swap in Replit Auth or a custom OAuth flow.
- **Nav user menu** (index.html lines 53-66 + app.js wireUserMenu lines 148-183): Avatar pill with initial + name in nav; click to open dropdown showing email + Logout button. Logout flushes pending persistence then clears `ig-current-user` and reloads → returns to auth wall.
- **Content persistence** (app.js lines 188-235): The Master Calendar reads `_socialPosts` / `_launchedCampaigns` / `_autoSeoArticles` / `_autoSeoSchedule` — but those were in-memory only, so refreshes wiped them and the calendar showed zeros. Added a 1.5s polling loop that JSON-stringifies each tracked window var and writes only when changed. Restores on DOMContentLoaded BEFORE other init handlers (registered first at top of file) so the module-load resets don't clobber persisted values.

## Cache-buster
- Bumped to `v=20260428Z` (next bump → `AA`).

## Real Competitor Data Pipeline (no more fakes)
- **Removed all `Math.random()` initial values** for competitor traffic / adSpend / ROAS / CTR (app.js ~2893). They now start as `null` sentinels.
- **Three-stage data pipeline** for every competitor surfaced after "Analyse Now":
  1. **DataForSEO live scrape** via `/api/competitor-metrics` (server.js 810) — domain_rank_overview + keywords_for_site → real organic + paid traffic, derived CTR, ad-spend, ROAS.
  2. **OpenAI validation overlay** via NEW `/api/ai-validate-metrics` (server.js ~5082) — GPT-4o-mini cross-checks each competitor against its training-data knowledge of well-known brands (Similarweb, earnings reports, SemRush). Returns `{traffic, adSpend, roas, ctr, confidence: high|medium|low, source, notes}`. Returns `null` for fields it can't reasonably estimate (no fabrication).
  3. **Final safety net** — anything still null becomes greyed `'—'` with "Limited data" tooltip.
- **Per-campaign rows** (in competitor breakdown table) are now DERIVED from the validated top-level metrics (60/40 weighted split) — no random fakery.
- **UI: data-source ribbon** at top of each competitor modal showing source ("DataForSEO" / "AI-verified" / "AI-estimate" / "Limited data") + confidence dot (green/amber/grey) + tooltip with `dataOrigin` + `dataNotes`.
- **All downstream consumers** that fall back to fabricated values were rewired:
  - `_safeAvg()` filters non-finite values out of avgCTR/avgROAS averages (app.js ~3686)
  - `parseTrafficNum` / `parseAdSpend` return 0 (not 100k / 5k) for missing values
  - `renderCTRChart` and `renderTrendChart` skip competitors with no data instead of fabricating bars
  - `compROASIssues` falls back to industry benchmark (not random)
  - CEO strategy table shows greyed `—` for missing spend/ROAS
  - Share-of-voice + Market Position bars only include competitors with real traffic (no synthetic 5% floor)
- **Important env-var alignment**: OpenAI client at server.js:10 uses `AI_INTEGRATIONS_OPENAI_API_KEY`. The new `/api/ai-validate-metrics` gate at line ~5088 checks the SAME var so the gate and runtime never disagree.
