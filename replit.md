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
- **Amplitude AI Agents** (server.js `/api/amplitude/*`, app.js `buildAmplitudeAgents`): three on-demand agents — Dashboard (top-events trends + WoW + GPT-4o hypotheses), Session Replay (auto-funnel from top events OR caller-supplied `events:[]`, drop-off + GPT-4o friction analysis), Customer Feedback (regex-matches NPS/feedback/support events + GPT-4o themes). Cheap `GET /api/amplitude/status` probe for the connection badge (no GPT call). Per-IP rate limit (`_ampRateLimit`) gates all three POST endpoints (8s min interval + 30/min). Dashboard agent falls back to `/api/2/sessions/average` on 403 since most plans block events/list. View at sidebar `Grow → Amplitude AI Agents`.
- **Outward Intelligence Suite** (Apr 2026): four production features wired end-to-end with real API data only.
  - **Mention Tracking + Sentiment** (`POST /api/mentions`, frontend `buildMentionTracker`): DataForSEO Google News SERP per brand+competitor over chosen window, batched OpenAI sentiment classification, daily SOV timeline, top sources, sentiment ribbon. View at `Analyse → Mention Tracker`.
  - **Real-Time Alerts** (`GET /api/alerts/list`, `POST /api/alerts/check|ack`, frontend bell + slide-out panel): detects mention surges (EMA baseline alpha 0.3) and rank drops (>5 positions, was top-10) by diffing fresh DataForSEO signals against `data/alerts_snapshot.json`. Persistence via atomic `_atomicWriteJson` (temp+rename) and serialized `_alertsMutate`/`_snapMutate` write chains so concurrent `/check` and `/ack` calls cannot lose updates. `/check` does network IO outside the mutex, then compare-and-write entirely inside `_snapMutate(snap => …)` for race-safety.
  - **AI Content-Gap Ideation** (`POST /api/content-gaps`, frontend `buildContentGaps`): SSRF-safe sitemap fetches via `_safeFetchWithRedirects` (uses `redirect:'manual'` and re-runs `_isUrlSafeToFetch` on every redirect hop, max 3 hops), extracts URL slugs, asks GPT-4o-mini for prioritised topic gaps with rationale + suggested angle. View at `Analyse → Content Gaps`.
  - **Cross-Channel Reporting** (`GET /api/cross-channel-report`, frontend `buildCrossChannel`): merges Meta/Google Ads/TikTok spend (existing helpers), DataForSEO organic visibility, Google News earned media count, and AI exec summary. Gracefully marks disconnected channels. View at `Manage → Cross-Channel Report`.
  - All responses include `dataOrigin` / `dataSource` / `confidence` transparency badges; alert routes share the `_ALERTS_META` constant.
- **Drip-Campaign Execution Engine** (server.js ~5120-5550): file-backed enrollment store at `data/drip-enrollments.json`, single-writer mutex (`_dripLock`) around all mutations, atomic tmp+rename writes. Endpoints: `POST /api/drips/enroll`, `GET /api/drips`, `GET /api/drips/stats`, `POST /api/drips/:id/(pause|resume|cancel)`, `GET /api/drips/unsubscribe?email=`, `POST /api/drips/webhook/resend` (Svix HMAC-verified when `RESEND_WEBHOOK_SECRET` set). Background `setInterval` ticks every 60s, sends email-channel steps via Resend, records non-email channels as "pending integration". Failure classifier (`_classifyEmailFailure`) buckets to bounce/complaint/auth/rate/config/other so bounce rate isn't polluted by config errors. Dry-run sends excluded from deliverability metrics. UI live panel inside Re-Engage > Sequence tab.
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
- Bumped to `v=20260430M` (next bump → `N`).

## UX polish — three issues fixed (2026-04-30)
- **Friendlier competitor-scrape errors** (app.js ~29339): Content Scorer competitor table previously showed raw `HTTP 403` / `HTTP 400` in red for bot-blocked sites (Trustpilot, Facebook, LinkedIn, etc.). Now maps to friendlier badges — `Bot-blocked` / `Rate-limited` / `Blocked` / `Server error` / `Timed out` — in muted grey/amber rather than alarming red, with a hover tooltip explaining why and that the page exists. Original raw error preserved in `title=` for power users.
- **Re-engage Audience manual input** (app.js ~27921 + 27963 + 27999): added `openReengageManualAdd()` modal — one-contact-at-a-time form (email + optional name + phone + backdate days) that submits via the existing `/api/reengage/upload-csv` endpoint by building a 1-row CSV in memory. Empty-state of the dormant list now shows BOTH "Upload audience CSV" and "Add manually" buttons prominently. Header has both buttons too.
- **Activator tile double-tooltip** (app.js ~7128): the Creative Studio Target / Counter-Objection / Email Sequence tiles previously rendered both a custom dark `infoBubble` tooltip AND a browser-native `title=` tooltip on hover, so the same text appeared twice. Removed the `title` attribute on enabled tiles (kept it on disabled tiles since they have no infoBubble).

## Mention Tracker + Content Gaps auto-fill (added 2026-04-30)
- **Helpers in app.js (~line 29388)**: `_getDomainFromAnalysis()`, `_getBrandFromAnalysis()`, `_getCompetitorsFromAnalysis()` derive brand/domain/competitors from `window.analysisData` (set on home-page analysis at app.js ~3239). Sector-only analyses skip the URL-derived fields.
- **Reusable multi-select component**: `_igMultiselect`/`_igMultiselectInit`/`_igMultiselectToggle`/`_igMultiselectFlip`/`_igMultiselectAll`/`_igMultiselectRefreshTrigger`. Click-only dropdown panel with checkboxes + "Select all" header. State stored in `window[stateKey]` arrays. Registry in `window._igMultiselectMeta`.
- **Mention Tracker** (`buildMentionTracker`): brand auto-fills from analysis, competitors are a multi-select prepopulated with all detected competitors (cap 4 sent to API). Country is now multi-select with ~50 entries plus 🌍 Global at the top (default = `GLOBAL`). State keys: `_mtSelectedComps`, `_mtSelectedCountries`. `runMentionTracker` runs one `/api/mentions` call per selected country in parallel and merges results client-side (dedupe by URL, recompute SoV/sentiment/topSources). When `GLOBAL` is selected with other countries, only `GLOBAL` is used to avoid duplicate news.
- **Server `/api/mentions`** (server.js ~9531): accepts `country='GLOBAL'|'WORLDWIDE'|'ALL'` and omits `location_code` from the DataForSEO request entirely (DFS treats missing location as worldwide; passing 0 is rejected).
- **Content Gaps** (`buildContentGaps`): domain auto-fills from analysis, competitors are a multi-select of detected competitor **domains** (cap 4). State key: `_cgSelectedComps`. `runContentGaps` reads from the array.
- **Edit-tracking flags**: `window._mtSelectedCompsTouched` / `_mtSelectedCountriesTouched` / `_cgSelectedCompsTouched` prevent repopulating the dropdown after the user has manually deselected entries.

## Three Standout Features (added 2026-04-28 — server.js ~7000-7340, app.js end, index.html)
### 1. Blended Performance / CAC (the "ground truth" tile)
- **Server**: `GET /api/blended-roas?days=N` (cap 90) aggregates ad spend across Meta + Google Ads + TikTok in parallel via `_fetchMetaSpend` / `_fetchGoogleAdsSpend` / `_fetchTikTokSpend`, then divides by Amplitude conversions (`_fetchAmplitudeConversions` — pulls events list + matches signup/purchase/subscribe/checkout/payment/order/conversion/booking/install patterns, sums event_count via `/api/2/events/segmentation`). ROAS is intentionally returned as `null` with a `roasNote` because we don't yet have a revenue-per-conversion source — CAC is the honest number we can compute.
- **Each channel returns its own `{ok, spend, error?}`** so partial failures don't kill the tile (e.g. Meta token expired but Google works → blended still shows Google spend ÷ Amplitude conversions).
- **`customerSource`** field flips between `amplitude` (preferred) and `ad-platform` (fallback) so the UI can label "Customers from Amplitude (true conversions)" vs "Customers from ad platforms (estimated)".
- **Frontend**: `buildBlendedPerf()` + `loadBlendedPerf()` + `_blendedHtml()` in app.js. Hero CAC + total spend + total customers tile, per-channel mini-tiles with status/error badges. View at sidebar `Grow → Blended Performance`.

### 2. Goal-Based Autonomous Monitoring
- **Server**: file-backed store at `data/goals.json` with `_goalsLock` mutex + atomic `tmp+rename` writes (mirrors the drip-engine pattern). Endpoints:
  - `GET /api/goals` — list goals + the `GOAL_METRICS` registry (6 metrics: `drip.bounceRate`, `drip.totalSends`, `drip.deliveryRate`, `amp.sessions`, `ads.totalSpend`, `ads.cac` — each with `direction: 'lte'|'gte'` and a `fetch` resolver function).
  - `POST /api/goals` — create `{metric, target, label?}` (validates against registry, generates `g_<ts>_<rand>` ID).
  - `DELETE /api/goals/:id` — remove.
  - `GET /api/goals/check` — resolves every goal's current value in parallel, computes status (`on-track` / `off-track`), and **for every off-track goal fires a single GPT-4o root-cause call** that returns `{hypothesis, fixes:[3]}` with the metric, current vs target, gap, and last-7-days context. Errors per-goal are caught so one broken metric doesn't kill the dashboard.
- **`GOAL_METRICS` registry pattern**: each metric is `{label, unit, direction, fetch: async () => Number}`. To add a new metric, push one entry — UI/server pick it up automatically.
- **Frontend**: `buildGoals()` + `_goalCard()` (progress bar + status pill + GPT root-cause panel when off-track) + `openAddGoalModal()` / `submitNewGoal()` / `deleteGoal()`. View at sidebar `Grow → Goals & Targets`.

### 3. Agentic Command Bar (NL → real endpoint via GPT-4o function calling)
- **Server**: `POST /api/assistant/command` with two-shot GPT-4o function calling.
  - Tool registry `_ASSISTANT_TOOLS` (8 tools): `enroll_drip_campaign`, `get_drip_stats`, `get_blended_performance`, `list_goals`, `create_goal`, `run_amplitude_dashboard_agent`, `run_amplitude_replay_agent`, `run_amplitude_feedback_agent`. Each has a strict JSON schema parameter object.
  - `_executeAssistantTool(name, args)` dispatches to internal `localhost:5000` HTTP calls (so we reuse existing endpoint validation/locking rather than re-implementing logic). The `enroll_drip_campaign` wrapper builds the `{contacts:[{email}], sequence:[…]}` shape required by `/api/drips/enroll` (with a sane default 3-touch welcome sequence when none is supplied).
  - **Confirmation gate** (`_DESTRUCTIVE_TOOLS = {'enroll_drip_campaign', 'create_goal'}`): on first call, server returns `{type:'needs-confirmation', toolName, toolArgs, preview}`. UI shows the preview + Confirm button → re-POSTs with `{confirm:true}` → server executes.
  - **Two-shot pattern**: (1) GPT-4o picks the tool + args, (2) we execute, (3) feed result back to GPT-4o for a plain-English summary.
  - **`_assistantRateLimit`**: 3s min interval + 30 calls/minute per IP (returns HTTP 429 with `{ok:false, error:'rate-limited'}`).
  - The catch-all `app.get('*')` SPA fallback near the original line 6040 was patched to skip `/api/*` paths — required so any GET endpoint registered AFTER that line (including the three new ones above) reaches its handler instead of returning index.html.
- **Frontend**: global floating `✨` button (always visible, fixed position) + Cmd+K / Ctrl+K shortcut opens modal with hint chips. `openCommandBar()` / `runCommandBar()` / `prefillCommand()` in app.js. The confirm button on a `needs-confirmation` response re-runs with `confirm:true`. Esc closes the modal.

## Two AgentOS Features (added 2026-04-28 — server.js ~7160-7345 and ~7480-7600, app.js end, index.html)
### 4. Lead Qualifier Agent (Reach › Lead Qualifier)
- **Server**: file-backed store at `data/qualified-leads.json` with `_leadsLock` mutex + atomic tmp+rename writes (mirrors goals/drip pattern).
  - `POST /api/leads/qualify` — accepts `{name?, email*, company?, source?, notes?, behaviour?}`, fires GPT-4o (JSON-mode) with a B2B-SDR prompt that returns `{score 0-100, tier 'hot'|'warm'|'cold', reasoning, bant:{budget,authority,need,timeline each {verdict,why}}, suggestedActions:[1-3]}`. Persists with `lead_<ts>_<rand>` ID.
  - `GET /api/leads/qualified` — list (newest first).
  - `DELETE /api/leads/qualified/:id`.
- **Frontend**: `buildLeadQualifier()` + `_leadQualifierHtml()` + `_leadCard()` + `submitLeadQualification()` + `enrollHotLead()` + `deleteQualifiedLead()` in app.js. Two-pane layout: qualify form on the left, history list on the right. Hot leads get a one-click "Enrol in nurture" that prefills the command bar with an `enroll_drip_campaign` request.
- **Assistant tool**: `qualify_lead` registered in `_ASSISTANT_TOOLS` (non-destructive — just classifies). Cmd+K example: *"qualify jane@acme.com, CMO at Acme, downloaded our CAC ebook"*.

### 5. Re-engagement Agent (Grow › Re-engage Audience)
- **Server**: file-backed store at `data/reengagement-campaigns.json` with `_reengageLock` mutex + atomic writes.
  - `GET /api/reengage/dormant?days=N` (default 30, cap 365) — reads `data/drip-enrollments.json`, filters subscribers whose last `sentAt` is older than the cutoff OR whose recent sends *all* failed. Cross-checks Amplitude when `_amplitudeAuthHeader()` is configured (note only; doesn't yet refine the list).
  - `POST /api/reengage/generate` — `{segment, tone, brand?}` → GPT-4o (JSON-mode) returns `{variants:[{angle, subject, preheader, body, cta}, ×3]}` testing different psychological angles (curiosity, value-reminder, soft-breakup, social-proof, urgency).
  - `POST /api/reengage/launch` — `{variant, emails, segment, tone, dryRun}`. Records the campaign and (when emails are supplied) wraps `/api/drips/enroll` with a single-touch sequence built from the variant. `dryRun:true` records but produces no real sends.
  - `GET /api/reengage/campaigns` — list (newest first).
- **Frontend**: `buildReengage()` + `_reengageHtml()` + `_reengageVariantsHtml()` + `generateReengageVariants()` + `launchReengage()` in app.js. Hero dormant-count tile + dormant-list pane + tone selector + 3-variant card chooser + Dry-run/Launch buttons (real-launch behind `confirm()`). Module-scoped `_reengageState` holds dormant list + variants + chosen index.
- **Assistant tools** (extends registry): `find_dormant_audience` (read), `launch_reengagement` (DESTRUCTIVE — added to `_DESTRUCTIVE_TOOLS`). The `launch_reengagement` execute case orchestrates 3 calls in sequence: dormant-list → generate-variants → launch-with-chosen-variant. The `_describeToolCall` preview clearly distinguishes DRY-RUN vs REAL SENDS for the confirmation modal.

## Real Competitor Data Pipeline (dual-LLM consensus, Apr 2026 hardened)
- **2026-04-30 hardening (v=20260430O)**: All **value-fabricating** `Math.random()` calls removed from competitor pool construction (app.js ~2960). `topChannel`, `topChannels`, `audiences`, and the random "paid search/display/social" suggestion line are now `null` / `[]` until the AI validator fills them. Manual competitors (`mc.topChannels`) likewise no longer get a random pick — empty array until validator data arrives. (One harmless `Math.random` remains at app.js ~3214 used purely for shuffle-order of the pool — this affects display order only, never the metric values themselves.)
- **Display fallbacks scrubbed too**: front-end no longer fabricates `'Google Search'` / `'Google Ads'` / `'Google'` placeholders when the validator returns no `topChannel` for a competitor. The competitor card "Top Channel" tile, the campaign-table channel column, and the competitor "why" sentence all now degrade to `'—'` (or "their primary channel" in prose) so the user can clearly see which fields the AI couldn't fill rather than seeing an invented brand.
- **`/api/ai-validate-metrics` upgraded to dual-LLM consensus** (server.js ~6213): runs **GPT-4o** + **Claude Sonnet 4.6** in parallel via `Promise.all`. Each LLM returns the same JSON shape including a NEW `topChannel` field. The merge logic:
  - Ad-spend: agreement within ±35% → average + bump confidence to "high". Disagreement up to ±2.5× → use the LOWER (conservative) value, confidence "medium". >2.5× divergence → lower value, confidence "low" with a "models diverged sharply" note.
  - Traffic: agreement within ±50% → average. Else lower.
  - ROAS / CTR: average when both present, else fall back to the available one.
  - `topChannel`: agreement → use it. Disagreement → prefer GPT-4o.
  - Source citation now combines both ("GPT-4o: Similarweb estimate · Claude: Public earnings report").
- **Front-end (app.js ~3115-3133)** now applies `v.topChannel` from validator response, cascading the channel into both `c.topChannel` and `c.campaigns[].channel`.
- **Same-niche filter strengthened** (server.js ~8329 smart-detect, ~8489 sector-competitors): temperature lowered 0.2/0.15 → **0.1**, prompts add the explicit "Sub-niche test" ("would a typical customer of X actively compare it to this candidate before buying?"), explicit EXCLUDE list (news outlets, comparison aggregators, Wikipedia, marketplaces, generic SaaS), and "When in doubt, EXCLUDE — accuracy beats completeness".
- **Module-scope `INFO_SITE_PATTERN`** (server.js ~785) shared by both endpoints — belt-and-braces post-AI scrub strips investopedia/bloomberg/forbes/g2/capterra/trustpilot/wikipedia/etc. even if the LLM slips them through.
- **Two latent bugs fixed during dual-LLM verification**:
  1. **`parseSpend` was eating the M/K/B suffix**. Old regex `[$,\s/mo]/gi` is a character class that strips the literal characters `$ , whitespace / m o` — so `"$2.5M/mo"` became `"25"` (numerically interpreted as $25/mo). New version uses two passes: first strips the literal `/mo`/`/month`/`/m` token with `/\/\s*(mo|month|m)\b/gi`, then strips currency/commas/whitespace, leaving `"2.5M"` so the `M`-suffix branch fires correctly (→ $2.5M/mo).
  2. **Claude's name lookup was missing every row**. Claude tended to echo the prompt's `"1. Plus500 (plus500.com)"` literally as `name`, while GPT-4o returned just `"Plus500"`. The lookup map then never matched, so every row was tagged as "Single-model estimate (GPT-4o only)". Fixed by upgrading the `norm()` helper to strip trailing `"(...)"` parentheticals AND all non-alphanumerics before keying — now both models match and we actually get true consensus rows.

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

## NEW: Attribution & ROI + Lookalike Audiences (Apr 2026)
### Attribution & ROI Dashboard (Grow › Attribution & ROI)
- **Server**: `_fetchMetaSpendRich(days)` (server.js ~6529) extends the existing `_fetchMetaSpend` to also pull Meta `action_values` for revenue. `_applyAttributionWeights(channels, model)` (~6561) supports four models — `last-click` (no change), `linear` (split by click share), `time-decay` (squared click share), `position-based` (40/40/20 split between top spender, top click-share, middle).
  - `GET /api/attribution/overview?days=30&model=last-click&aov=85` orchestrates `_fetchMetaSpendRich`, `_fetchGoogleAdsSpend`, `_fetchTikTokSpend`, `_fetchAmplitudeConversions` in parallel. Computes per-channel CPA/CTR/CPC/ROAS/ROI and blended totals. Revenue priority: Meta `action_values` → AOV × conversions → null. Best/worst channel insight surfaced via `winner`/`loser`. Amplitude is preferred conversion source, with `conversionSource` indicator.
- **Frontend**: `buildAttribution()` + `loadAttribution()` + `_attributionHtml()` in app.js (~27825). View header has model selector, days range, AOV input. Renders hero KPI tile, per-channel cards (spend, impressions, clicks, conversions, CPA, CTR, CPC, ROAS, ROI), spend-allocation stacked bar with legend, reallocation recommendation, and setup-checks panel for unconfigured channels.

### Lookalike Audience Builder (Reach › Lookalike Audiences)
- **Server**: `_seedSignalsFromCompetitor(domain)` (~server.js after attribution block) calls DataForSEO `dataforseo_labs/google/ranked_keywords/live` to get top organic keywords + intent for a competitor domain.
  - `POST /api/lookalike/generate` with `{seedType, seedValue, platforms, country, lookalikeSize, excludeExistingCustomers, additionalContext}` → optional DataForSEO signals + GPT-4o JSON-mode output of structured audience spec including persona, demographics, geo, interests, behaviors, jobTitles, industries, intentKeywords, and platform-specific definitions for Meta LLA / Google Customer Match / TikTok LLA. Each platform spec includes audience name, source/seed audience suggestion, targeting categories, and step-by-step upload instructions. Returns `seedExamples` (5 personas), `estimatedSize`, and `warnings`.
  - `POST /api/lookalike/export` with `{spec, platform}` → returns CSV template payload with proper headers per platform (Meta: email/phone/fn/ln/country/zip/city/state/dob; Google: SHA-256 hashed identifiers; TikTok: email/phone/IDFA/GAID/country) + comments at top explaining hashing requirements.
- **Frontend**: `buildLookalike()` + `generateLookalike()` + `_lookalikeResultHtml()` + `exportLookalikeCSV()` in app.js (~27970). Three-step UI: seed type picker (competitor domain / description / customer profile) → country + Meta LLA size + platform multi-select + exclusion checkbox → result with persona hero, three platform cards each with download-CSV button, targeting signals (interests/behaviors/jobs/industries/intent keywords), seed personas, and compliance warnings. Module-scoped `_lookalikeLastSpec` retained between generate and export.

## NEW: Cohorts/Forecast tabs + Marketing Journey panel + Content Scorer (Apr 29 2026)
### Attribution & ROI — Cohorts & Forecast tabs
- **Server**: 4 daily-data fetchers `_fetchMetaSpendDaily/_fetchGoogleAdsSpendDaily/_fetchTikTokSpendDaily/_fetchAmplitudeConversionsDaily` (server.js ~6710-6905) + helpers (`_isoDate`, `_emptyDailySeries`, `_mergeDailyInto`, `_isoWeekKey` Thursday-of-week, `_isoWeekStart` Monday-start). Endpoints `GET /api/attribution/cohorts` (84-day weekly cohorts with channel mix, conversions, revenue, ROAS, CAC, WoW deltas) and `GET /api/attribution/forecast` (linear least-squares + 30/70 EMA blend, std-dev confidence bands, drops today's partial day).
- **Frontend**: `switchAttributionTab/loadAttributionCohorts/_cohortHtml/loadAttributionForecast/_forecastHtml` (app.js end). Tab strip injected above `#attributionWrap`; Model dropdown auto-hides on Cohorts/Forecast tabs.

### Marketing Journey panel (Dashboard)
- `window._renderJourneyStages()` (app.js ~28421) builds Express → Tailor → Amplify → Evolve panel mapping 22 existing nav features. Hooked into `buildDashboard()` at app.js ~3965 via `host.parentNode.insertBefore(panel, host)`. Click on any feature card triggers the same `.nav-link[data-view="..."].click()` the sidebar uses.

### Content Optimisation Scorer (Grow › Content Scorer + Evolve stage)
- **Server**: `POST /api/content-scorer/analyze` (server.js ~7530) body `{keyword, targetUrl, targetText, country}` → fetches DataForSEO Google organic top 10 via `_fetchSerpTopForKeyword`, scrapes user page + competitors in parallel via `_scrapePageForScoring` (9s timeout, 600KB cap). `_extractContentSignals` regex-parses title/meta/H1/H2/H3/word-count/JSON-LD schema (with `@graph` + array `@type` handling)/FAQ heuristic (FAQPage schema OR ≥3 question-mark headings OR `<h2>FAQ`)/internal-vs-external links. OpenAI gpt-4o (`AI_INTEGRATIONS_OPENAI_API_KEY` gate) extracts 15 LSI terms + 6-8 prioritised recommendations as JSON; regex frequency-fallback if no key.
- **Scoring rubric** in `_scoreContent` (100 pts): word count vs SERP median (20, continuous piecewise — 0 at 0, 10 at 0.5, 20 at ≥1), heading structure (15), LSI coverage (35), FAQ section (10), schema markup (10), title+meta optimisation (10).
- **SSRF guard**: `_isPrivateIp` + `_isUrlSafeToFetch` block non-HTTP(S) protocols, `localhost`/`metadata.google.internal`, and any hostname resolving to private/loopback/link-local/CGNAT/multicast IPv4 or IPv6 ranges. Applied to BOTH user-supplied target URL and DataForSEO competitor URLs (defence-in-depth).
- **Frontend**: `buildContentScorer/runContentScorer/_contentScorerHtml` (app.js end) — form (keyword + country select + URL + draft textarea) → score circle (conic-gradient), 6-bar breakdown, LSI covered/missing tag clouds, prioritised recommendations cards, SERP top-10 competitor table with status indicators.
- **Cache busters bumped**: app.js?v=20260429G, style.css?v=20260429D.

## CRM Pivot — PAUSED (Apr 29 2026)
- User chose **Path B (full CRM management)** as a pivot from the outward-facing-only positioning. Phase 1 plan was: HubSpot OAuth + read contacts/deals into a new Contacts view + sync engine scaffold. Future phases would add lead scoring, drip campaigns, journey orchestration, then Zoho + Salesforce.
- **Status: paused.** HubSpot OAuth flow was dismissed by the user before completing. No CRM code was written.
- When resuming, ask which connect method to use (re-try Replit OAuth connector `connector:ccfg_hubspot_96987450B7BE4A05A4843E3756`, or paste a HubSpot Private App token as a secret named `HUBSPOT_PRIVATE_APP_TOKEN`).
- **Important**: this pivot fundamentally changes InfoGenie's identity from "Marketing Intelligence" to "Marketing Automation + CRM" platform. The current outward-facing-only guardrail in `<project_goal>` would need to be lifted, and the Marketing Journey panel + dashboard messaging would need to be re-written. Confirm the pivot is still on before resuming.
- **Not built** (Phase 1 work that was planned but not started): Contacts DB schema, OAuth/token storage, sync engine, contacts/deals/companies UI, GDPR/CCPA compliance for stored PII, deliverability infra for downstream email features.

## Strong-fit Trio (Apr 30 2026) — Smart Templates · Stakeholders · Launch Calendar
### Smart Template AI-Recommendation
- **Server**: `POST /api/templates/recommend` (server.js ~2244). Body `{domain, sector, keyword, brand, templates:[{id,title,type,tagline}]}`. Caps at 30 templates. Gates OpenAI on `process.env.AI_INTEGRATIONS_OPENAI_API_KEY` (matches client init at server.js:13). Uses `openaiChatWithRetry` with `gpt-4o-mini`, JSON-array output `{id,score,rationale}`. Deterministic keyword/sector overlap fallback if key absent or call fails. Returns `dataOrigin/dataSource/confidence`.
- **Frontend**: `buildTemplates()` re-render loop (app.js ~26088) overlays 🏆 ribbon + AI rationale on top 3 picks, re-sorts gallery by AI score. `_fetchTemplateRecommendations()` (app.js ~26115) handles 24h `localStorage` cache keyed `igTplRec_${domain}|${sector}|${keyword}`.

### Stakeholder Alert Distribution
- **Persistence**: `data/stakeholders.json` shape `{stakeholders:[{id,name,email,addedAt}], lastEmailSentAt}`. `_atomicWriteJson` + `_stakeMutate` mutex chain.
- **Server** (server.js ~9613-9778): `GET /api/stakeholders/list` · `POST /add` (email regex + dedupe) · `POST /remove` · `POST /test-email`. `_buildStakeholderDigest` builds severity-coloured HTML+text email. `_dispatchStakeholderDigest` filters severity ≥ high, throttles to one per 30 min via **atomic check-and-reserve inside `_stakeMutate`**, releases reservation only when `lastEmailSentAt === reservedAt` if all sends fail.
- **Hook**: `/api/alerts/check` invokes dispatcher in `Promise.resolve().then(...).catch(...)` — TRULY fire-and-forget, response returns immediately.
- **Frontend** (app.js bottom): `buildStakeholders/_renderStakeholders/addStakeholder/removeStakeholder/testStakeholderEmail`. New view `stakeholders` under Manage nav.

### Launch Calendar + 24h/1h Reminders
- **Persistence**: `data/launches.json` shape `{launches:[{id,name,channel,notes,datetimeISO,status,createdAt,reminders:{h24,h1,live}}]}`. `_launchMutate` mutex.
- **Server** (server.js ~9780-9956): `GET /api/launches/list` · `POST /add` (future-only, channel whitelist `[Email,Social,Paid Ad,PR,Mixed,Other]`, max 120-char name, 400-char notes) · `POST /remove`. `_sweepLaunches` runs every 60s + once 5s after boot. Idempotent via `reminders.{h24,h1,live}` flags. Pushes alerts into `alerts.json` (capped at 100) and dispatches stakeholder digest async.
- **Frontend** (app.js bottom): `buildLaunches/_renderLaunches/addLaunch/removeLaunch` with grouped Today/Week/Later/Past sections, countdown text, status pills, datetime-local input.
- **Index.html**: 2 new nav links + 2 view containers under Manage group.
- **Cache busters bumped**: app.js?v=20260430G, style.css?v=20260430D.

## Post-Trio Bug Fix Round (Apr 30 2026 — late)
Four user-feedback issues fixed after the trio shipped:
- **Issue 1+3 (HTTP 403 + LSI/FAQ/Schema=0)**: `_scrapePageForScoring` (server.js ~7771) rewritten with `_SCRAPE_UAS` rotation (Chrome, Googlebot, Safari) + new `_fetchWithBrowserHeaders` helper sending full browser headers (Accept, Accept-Language, Sec-Fetch-*, Upgrade-Insecure-Requests, **Referer:'https://www.google.com/' for non-root paths with Sec-Fetch-Site:'cross-site'**). Retries on 403/429/503 only — other statuses returned transparently.
- **Issue 2 ("Suggest related")**: `loadRelatedKeywords` (app.js ~28880) now pulls `_lsKeywords()` from prior analyses FIRST in a "From your analyses" section above DataForSEO results; deduped against seed; `buildContentScorer` auto-prefills `csKeyword` input from `_lsKeywords()[0]` when empty (never clobbers user input). New CSS `.cs-rel-section` + `.cs-rel-chip-analysis` (teal palette).
- **Issue 4 (audit timer)**: New `POST /api/page-audit/run` (server.js ~7536) scrapes `['/', '/about', '/pricing', '/features', '/blog', '/contact']` in parallel, computes transparent 0–100 score per page from real signals (title/meta length, H1/H2 count, word count, schema, FAQ, internal-link density). Returns `dataOrigin/dataSource/confidence/transparency` on BOTH success AND 400 error paths. Page Audit "Run Full Audit" button (was `showToast`-only) wired to `runRealPageAudit()` (app.js ~6594) using existing `window.startButtonTimer` for live elapsed-second counter; replaces `window._pageAuditList` with REAL pages then re-renders via `buildContent()`.
- **Security hardening**: All audit-card dynamic fields (`p.title/url/issue/fix`) escaped via `_escapeHtml` before HTML insertion (app.js ~6508). `data/stakeholders.json` wiped to baseline (no PII committed). Architect PASS verdict after fix round.
- **Cache busters bumped**: app.js?v=20260430I, style.css?v=20260430F.

## UI/UX Audit Polish Pass (Apr 30 2026 — later)
Targeted polish of duplicated functions, navigation, copy, and button consistency. Architect-pass intent.
- **Nav dedup**: Removed orphan `data-view="reengage"` link from the Grow group in `index.html` — Re-engage now lives only under Manage (lifecycle stage), one canonical entry.
- **Function-name collision fixed**: Renamed the original `function filterCreatives(platform, btn)` (Creative view) to `filterCreativeCards(...)` and updated its 5 onclick callers — `window.filterCreatives` from Smart Creative was shadowing it globally and breaking the Creative-view platform filter buttons.
- **Duplicate modal helpers removed**: Deleted orphan `function openExclusiveModal()/closeExclusiveModal()` near app.js line 17089 — robust `window.openExclusiveModal/closeExclusiveModal` definitions near line 14118 (with delegated click safety-net) are now the single source of truth.
- **Copy polish**:
  - "Audit Complete — GPT-4 Report" badges (×2) → "Audit Complete — AI Visibility Report" (we now use multiple models).
  - Per-module AI-Visibility buttons (×7 — coverage/accuracy/competitors/entity/sentiment/sge/attribution): "✨ Run AI Audit" → "✨ Run This Module". Trend-card master button → "✨ Run Full Audit". Distinguishes module scope from full-audit scope.
  - `runSingleAiVis` and `generateAiVisibilityAudit` `finally` blocks now call `stopTimer()` with **no** label so each button restores to its OWN original innerHTML — fixes label-collision bug where stopping the timer overwrote both module and master labels with one shared string.
  - Toast "✅ AI Audit ready!" → "✅ AI Visibility audit complete — open the modules below to review".
  - "AI offline — using smart template" cluster toast → "built-in template (add an OpenAI key for richer AI suggestions)". Counter-message source label "📋 Template (AI offline)" → "📋 Built-in Template".
  - Page Audit subtitle: clearer outcome-driven copy ("Find pages with crawl issues, thin content, and missing structured data — ranked by fix impact").
  - `runRealPageAudit` no-domain warning: friendlier wording.
- **Refresh-button standardisation**: Added `.btn-refresh-light` (translucent on dark headers) and `.btn-refresh-solid` (white pill on coloured headers) in `style.css`. Replaced 5 inline-styled `↻ Refresh` buttons across Goals / Blended Performance / Lead Qualifier / Re-engage / Attribution with these classes (accent colour preserved via tiny inline `style="color:..."`).
- **Cache busters bumped**: app.js?v=20260430J, style.css?v=20260430G.

### Post-architect cleanup
- Architect flagged PII in committed runtime artifacts. Wiped `data/drip-enrollments.json` and `data/reengagement-campaigns.json` to baseline `[]` (both `_dripLoad`/`_readReengage` already default to `[]` on missing/empty). No further runtime PII committed.

### 2026-04-30 — Five user-reported fixes (fxpro.com testing) → architect PASS
- **F1 Page Audit honest 403/anti-bot messaging**: `/api/page-audit/run` now classifies fetch errors via `classifyError()` into 403/blocked, 429/rate-limited, 5xx/server, 404/not-found, timeout, other — each with accurate `issue` and `fix` text. Response includes `errorKind` per page, top-level `notice` and `summary.blockedAll` flag when every page hits anti-bot. Frontend renders an amber notice banner above the audit list (`window._pageAuditNotice`) and adapts the toast.
- **F2 Content Scorer Suggest related — URL fallback seed**: `loadRelatedKeywords()` now derives a brand-stem seed from `csUrl` (e.g. "fxpro" from fxpro.com) when no keyword is typed and no prior analyses exist, auto-fills the input and shows a hint instead of bailing out silently.
- **F3 Ask InfoGenie command bar input fix**: `openCommandBar()` performs three staggered focus attempts (rAF + 80ms + 200ms), strips disabled/readonly defensively, and adds a click-to-refocus handler. Input gained `tabindex=0`, `pointer-events:auto`, explicit user-select; removed `autocomplete="off"`. Existing global Enter handler at line ~27701 untouched.
- **F4 Re-engage Audience CSV upload**: New `POST /api/reengage/upload-csv` endpoint with quoted-field-aware CSV parser; accepts `email` (mandatory) + optional `name`/`phone` columns in any order; dedupes by lowercased email; clamps backdate days 1-365; writes under existing `_dripLock`; seeds enrollments with backdated `startedAt` + empty `history` so they immediately surface in `/api/reengage/dormant`. `phone` stored but explicitly noted as unused for outreach (no SMS channel yet) in the modal. UI: `openReengageCsvUpload()` modal + file picker + paste textarea + `submitReengageCsv()`. Button on the Dormant subscribers panel header. `express.json` limit raised to 5mb to handle real audience lists.
- **F5 Internal Link Suggester subtitle clarified**: Subtitle now states "Apply marks a row as Done in this view (you still add the link in your CMS) · use Export CSV to hand the full list to your content team". Apply toast updated to "Marked done — remember to add … as a link in your CMS".
- **Cache busters bumped**: app.js?v=20260430K (no CSS changes).
- **Architect verdict**: PASS. Cleaned `data/drip-enrollments.json` and `data/reengagement-campaigns.json` back to `[]` after manual smoketest of CSV upload.

### 2026-04-30 — Four UI/UX screenshot fixes (architect PASS)
- **#1 Daily share-of-voice chart not rendering** (app.js ~29980): Chart.js with `maintainAspectRatio:false` had no fixed-height parent. Wrapped canvas in `<div style="position:relative;height:280px;width:100%">`.
- **#2 Viral Content Funnel Planner subtitle invisible** (app.js ~6583): On the dark-green panel header `rgba(255,255,255,.7)` was unreadable. Changed to `#D1FAE5`, font 0.78→0.85rem, line-height 1.5.
- **#3 Intelligence APIs panel title invisible in light theme** (style.css ~6397, ~6713): The light-theme dark-text sweep was forcing `.ich-title/.ich-sub` dark, but `.integ-category-header` keeps a dark navy gradient in BOTH themes. Excluded `.ich-title/.ich-sub` from the sweep and added explicit `[data-theme="light"]` overrides forcing white/translucent-white on those headers.
- **#4 OAuth "Connected via OAuth" pill reverting** (app.js ~17582): `restoreConnectedStates()` was choosing button styling from the STORED VALUE (`_isOAuth(id)`) instead of the BUTTON TYPE (`item.authType === 'oauth'`). For OAuth-type integrations auto-detected by the server (stored as `'1'`), the green OAuth pill never re-rendered. Now keys off `item.authType === 'oauth'` AND upgrades the stored value to `'oauth'` so future reads are consistent. localStorage remains per-user namespaced (lines 60-100), so persistence holds across reload + login.
- **Cache busters bumped**: app.js?v=20260430Q, style.css?v=20260430H.
- **Architect verdict**: PASS — no critical/high findings.
