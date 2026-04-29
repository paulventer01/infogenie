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
- Bumped to `v=20260428AF` (next bump → `AG`).

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
