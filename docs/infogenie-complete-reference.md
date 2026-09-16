# InfoGenie — Complete Feature, Architecture & Integration Reference

**Version**: T1–T119 · July 2026  
**Classification**: Internal reference document

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Architecture](#2-architecture)
3. [Core Systems (Cross-cutting)](#3-core-systems-cross-cutting)
4. [COMPETE — Intelligence on Rivals](#4-compete--intelligence-on-rivals)
5. [GROW — Campaigns, Conversion & Revenue](#5-grow--campaigns-conversion--revenue)
6. [REACH — Audiences, Outreach & Distribution](#6-reach--audiences-outreach--distribution)
7. [CREATE — Content, Creative & Publishing](#7-create--content-creative--publishing)
8. [ANALYSE — Measurement, Intelligence & Prediction](#8-analyse--measurement-intelligence--prediction)
9. [MONITOR — Brand & Market Surveillance](#9-monitor--brand--market-surveillance)
10. [MANAGE — Operations, Planning & Configuration](#10-manage--operations-planning--configuration)
11. [CREATOR STUDIO — AI Video, Persona & Design](#11-creator-studio--ai-video-persona--design)
12. [How Features Work Together (Integration Map)](#12-how-features-work-together-integration-map)
13. [Complete Connections Reference](#13-complete-connections-reference)
14. [Agency Operating Model Alignment](#14-agency-operating-model-alignment)

---

## 1. Executive Overview

InfoGenie is a **multi-tenant, AI-powered marketing intelligence and campaign automation platform**. It consolidates 119 distinct tools across 9 navigation domains into a single same-origin application. Rather than being a point tool (e.g., only SEO or only email marketing), InfoGenie is designed as a **full-stack marketing brain**: every insight it generates can directly trigger an action, and every action feeds data back into its intelligence layer.

### Design Philosophy

- **Insight → Action → Measurement** loop: every intelligence module feeds directly into an action module, and every action module has a measurement partner.
- **No mock data**: every module has real API integration with an honest template-fallback path (labelled `source:'template'`) when keys are absent — the platform never fabricates and presents data as real.
- **Data moat**: anonymised cross-tenant benchmark data (T89) means the platform becomes more valuable as more users join.
- **Autonomous where safe**: AI optimises ad budgets, rewrites ad copy, publishes content, and proposes actions — but Safe Agent (T92) enforces a human-approval gate before any destructive or irreversible action executes.
- **Single-origin architecture**: no CORS complications, no split-domain cookies — all auth, APIs, and the React dashboard share one domain.

### What InfoGenie Is Not

- Not a full CRM (it syncs to HubSpot rather than replacing it)
- Not a payment processor (Stripe handles billing)
- Not a social media platform (it publishes to 15 platforms via Zernio)
- Not a session recorder (Clarity handles heatmaps/session replay)

---

## 2. Architecture

### 2.1 Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| **Runtime** | Node.js 20+ / Express.js | Backend, API surface, background jobs |
| **Frontend (legacy)** | Vanilla JS + HTML5 + CSS3 | Original SPA (`app.js` ~23k lines + `public/js/` ~36k lines across 31 modules) |
| **Frontend (new)** | Next.js 15 (App Router) + React + TypeScript | Incremental migration — new modules are React components in `components/features/` |
| **Database** | PostgreSQL | 119 tenant-scoped tables via `kv_store` + per-tier schemas |
| **AI/LLM** | OpenAI, Anthropic, Google Gemini, Perplexity, Cloudflare Workers AI | Multi-model architecture with automatic fallback chain |
| **Styling** | CSS3 (style.css) + inline React styles | No CSS frameworks — bespoke design system |
| **Charts** | Chart.js v4.4.0 | All data visualisations |
| **Exports** | pptxgenjs · pdfkit · exceljs | PPTX/PDF/XLSX report generation |

### 2.2 Process Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Public Internet / Replit Proxy                                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS (mTLS proxy)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js (port 5000) — Front Door                               │
│  • Owns: /login  /reset-password  /accept-invite                │
│  • Owns: All React component views (registry-driven)            │
│  • Proxies: /api/* → Express internal (port 8000)              │
│  • Proxies: / (SPA shell) → Express                             │
│  • Single same-origin so infogenie.sid cookie works everywhere  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ Internal HTTP proxy
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Express (port 8000) — API + Legacy SPA                         │
│  • 119 service routers mounted at /api/<service>                │
│  • Auth gate → Permission matrix → Route handlers               │
│  • Background jobs: optimizer, journey runner, digest cron,     │
│    weekly report, autopilot, dynamic audience sweep             │
│  • Static: /index.html  /style.css  /public/js/*  /uploads      │
└─────────────────────────┬───────────────────────────────────────┘
                          │ pg (node-postgres)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL                                                      │
│  • kv_store (JSON key-value for app state)                      │
│  • 119+ per-tier tables (all tenant_id NOT NULL FK)             │
│  • Tenant, auth, credential, and audit tables                   │
└─────────────────────────────────────────────────────────────────┘
```

**Dev**: `scripts/dev.js` spawns both processes. Express on internal :8000, Next on :5000.  
**Prod**: `scripts/start.js` mirrors dev but with `NODE_ENV=production`, `NEXT_FRONT_DOOR=1`, and a required `CREDENTIAL_ENCRYPTION_KEY`.

### 2.3 Multi-tenancy

Every feature table includes `tenant_id INT NOT NULL REFERENCES tenants(id)`. Routes resolve tenant via:

```javascript
const tid = await _tenantCtx.resolveTenantId(req, { label: 'service:operation' });
if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
```

No `allowFallback:true` is used anywhere in production. Enforcement mode is `on`. The default tenant is the first active tenant created by the owner (cached 60 seconds).

### 2.4 Authentication & Sessions

- **Auth service**: `services/auth/` — real Postgres-backed accounts (`users`, `user_identities`, `email_tokens`, `user_sessions`)
- **Password security**: bcrypt cost 12
- **Session**: 30-day rolling `infogenie.sid` cookie (HttpOnly, SameSite=Lax)
- **Email verification**: Resend transactional email
- **Password reset**: 1-hour signed token
- **Social login**: OAuth 2.0 for Google / Facebook / Microsoft (optional; button hidden if env vars absent)
- **API gate**: `INFOGENIE_API_KEY` header accepted alongside session cookie (for programmatic/cron callers)
- **First signup**: auto-promoted to `is_owner=TRUE`

### 2.5 Credential Vault

`services/credentials/vault.js` provides AES-256-GCM per-user, per-platform credential storage. When a user connects their own Google Ads or Meta Ads account, tokens are encrypted and stored per `(user_id, platform)` in the `user_integrations` table. `resolveGoogleAdsCredentials(uid)` returns vault credentials for that user or falls back to env vars only for owners/cron jobs.

### 2.6 Platform API Keys

`services/credentials/platform_keys.js` manages InfoGenie-wide API keys (OpenAI, Anthropic, Gemini, Perplexity, Cloudflare, DataForSEO, Firecrawl, Apollo, Zernio, etc.) in the `platform_api_keys` table (AES-256-GCM encrypted). At boot, `hydrate()` overlays DB values onto `process.env` so database keys override environment. Changes are audited (actor + key name, never the value). Non-admin users cannot access these keys.

### 2.7 Permission System

`services/tenants/permission_matrix.js` + `permission_enforce.js` form a centralised route × component access control layer. Every `/api/` route group is mapped to a `view` (GET) and `write` (POST/PUT/PATCH/DELETE) permission key. `enforceMatrix` middleware runs on every authenticated request, checking `req.can()`. Platform admins bypass. Enforcement mode: `off` / `shadow` (default — logs but allows) / `on` (strict 403).

### 2.8 AI Pattern (Standard for All Tiers)

Every AI-powered feature follows the same pattern:

```
1. Build strict-JSON system prompt with brand context injected automatically
2. Call primary AI model (usually GPT-4o-mini for speed/cost)
3. Parse response: check for /^_DUMMY/i key gate (rejects placeholder keys)
4. If AI fails: apply template fallback (clearly labelled source:'template')
5. Persist result to Postgres (tenant-scoped)
6. Return JSON to frontend builder (_escapeHtml / _safeUrl on all output)
```

### 2.9 AI Model Compatibility Layer

`ai_compat.js` patches the OpenAI SDK and Node.js `fetch`/`http` globally to handle reasoning models (gpt-5*):
- `max_completion_tokens` instead of `max_tokens`
- No `temperature` or `top_p`
- `reasoning_effort: 'minimal'`
- Normalisation applied per-call-site transparently

### 2.10 Frontend Architecture: Registry-Driven React Migration

New React views are registered in `components/features/registry.tsx` as a `view-name → Component` map. `lib/migratedViews.ts` lists all views that have been ported to React. `lib/viewRoutes.ts` defines the navigation tree (groups → sections → items). When a user navigates to a view:

1. Next.js App Router checks `migratedViews.ts`
2. If migrated: renders the React component from registry
3. If not migrated: renders the legacy SPA shell, which replays vanilla JS

The legacy SPA (`index.html`, `app.js`, `public/js/`) is intentionally preserved on disk — Express still serves it as a fallback until full removal is scheduled.

### 2.11 Field Enhancer

`ig_field_enhancer.js` (MutationObserver, `?v=20260521REL1`): decorates every eligible text input across the platform with:
- **AI Suggest button**: generates context-aware field content from the active view's data
- **Brand pill**: shows active brand from Brand Foundation
- Skips: auth forms, password/file/search inputs, already-decorated fields
- Sets `autocomplete="new-password"` on all free-text fields to prevent browser credential-leak autofill

### 2.12 Background Jobs & Cron Schedule

| Job | Frequency | Purpose |
|---|---|---|
| Dynamic Audience Sweep | Every 15 minutes | Re-evaluate segment memberships, trigger drip/re-engage bridges |
| Journey Runner | Every 60 seconds | Process journey step timeouts, condition checks, action dispatches |
| AI Optimizer | Ingest 60min · Rules 6h · Creative 24h · Bandit 12h | Ad insight ingest, pause/scale decisions, creative refresh, MAB reallocation |
| Crisis Radar | Every 6 hours | Snapshot brand mentions, compute SoV delta, trigger Slack alerts |
| Daily Digest | Every 24 hours | Aggregate signals, send per-brand digest email + Slack |
| Weekly Report | Every 7 days | Aggregate 7-day KPIs, generate PDF, email all subscribers |
| Content Autopilot | Hourly tick | Check due schedules, generate content, optionally publish to WordPress |
| True ROAS Sync | Every 6 hours | Pull ad spend + revenue, compute margin-aware ROAS |

---

## 3. Core Systems (Cross-cutting)

### 3.1 Brand Foundation

**Location**: Manage → Brand Foundation  
**API**: `/api/brand-foundation`  
**Table**: `brand_foundation` (singleton, id=1, tenant-scoped)

The single most important module. Stores:
- Company name, website, logo URL
- Mission, vision, purpose
- Ideal Customer Profile (ICP) — demographics, psychographics, pain points
- Brand voice, tone guidelines
- Positioning statement, key messages
- Brand colours and visual identity
- Products/services summary, key differentiators, competitors list

`getBrandContextBlock()` is called by every AI prompt generator across all 119 tiers. When Brand Foundation is complete, every generated piece of content — cold emails, ad copy, blog posts, landing pages, video scripts — is automatically personalised to the brand.

**Sub-feature — URL Brand Scanner (T52)**: Scrapes any public URL (Firecrawl + GPT-4o), extracts brand identity fields, lets users review and apply them to Brand Foundation in one click.

**Relationship**: Brand Foundation is the source of truth that feeds: Content Calendar, Landing Page Builder, Cold Email Writer, Creator Studio, Benchmark Intelligence, Acquisition Engine, and all AI Suggest buttons.

---

### 3.2 Multi-Tenant Architecture

Every data row is isolated by `tenant_id`. A single InfoGenie deployment serves multiple organisations without data leakage. The permission matrix controls which users within a tenant can see and edit which modules.

---

### 3.3 Export Engine

**API**: `/api/exports/{pptx|pdf|xlsx}/{data-source}`  
**Libraries**: pptxgenjs (PPTX) · pdfkit (PDF) · exceljs (XLSX)  
**Data sources**: search-intel, campaigns, weekly reports, pitch decks

The export pipeline is declarative: `services/exports/data_sources.js` defines how each module's Postgres data maps to slides/pages/rows. New modules can be added without touching the export engine itself.

---

### 3.4 Smart Alert Routing (T5)

**API**: `/api/alert-routing`  
**Channels**: Slack (SSRF-guarded webhook) + email (Resend)  
**Trigger kinds**: `crisis_incident` · `sov_drop` · `digest_ready` · `mention_volume` · `custom`

Alert rules evaluate in real time against incoming data from Crisis Radar, SoV, Digest, and custom signal triggers. Every alert is logged in `alert_dispatches` for audit. This is the notification backbone that makes InfoGenie actionable — instead of users checking 10 dashboards, the platform proactively notifies them.

---

### 3.5 Signal Triggers

**Location**: Manage → Real-time Signal Triggers  
**Function**: `fireSignal(eventName, payload)` — bridges real-world events (form submits, purchases, page visits, external webhooks) into Journey Builder enrolments. Signals are the event bus that connects user behaviour on the customer's website to the outreach automation system.

---

## 4. COMPETE — Intelligence on Rivals

The Compete section is InfoGenie's deepest and most differentiated area. It covers every dimension of competitor intelligence that the modern marketing intelligence framework requires.

---

### 4.1 Competitor Profiles

**Foundation layer** — stores competitor data across all Compete sub-modules. Competitors are referenced by name and domain throughout the platform.

---

### 4.2 Battle Cards (T2)

**API**: `POST /api/battle-cards/generate`  
**AI**: GPT-4o-mini  
**Output**: 4 strengths · 4 weaknesses · 3 strategic moves · 4 counter-plays  
**Table**: `battle_cards`

Generates a sales-ready competitive intel card for any competitor. Used in: sales calls, content strategy, ad messaging. Links to: AI Attack Plan, Press Release Generator (from_battle_card_id hydration), Unified Inbox.

---

### 4.3 Share of Voice (T3)

**API**: `GET /api/sov/{series,targets}`  
**Data source**: Auto-populated by Crisis Radar 6-hour cron  
**Table**: `sov_snapshots`  
**Visualisation**: Chart.js stacked-area

Tracks the brand's share of online conversation vs competitors over time. This is distinct from ad-spend SOV — it measures organic mention volume. Feeds into: Daily Digest, Weekly Report, Alert Routing (sov_drop trigger), AI Competitor War Room.

---

### 4.4 Pricing Watcher (T8)

**API**: `/api/pricing-watch/{targets,scan/:id,snapshots/:id}`  
**Data source**: Firecrawl scrape + GPT-4o-mini extraction  
**Tables**: `pricing_watch_targets` + `pricing_watch_snapshots`

Monitors competitor pricing pages and extracts structured pricing data (plan names, prices, features). Any change in price or plan structure is captured in snapshots with full change history. Links to: Battle Cards (competitive positioning), Content Modes (pricing-aware copy), Dataset Marketplace.

---

### 4.5 Tech Stack Detector (T10)

**API**: `POST /api/tech-stack/{detect,compare}`  
**Data source**: BuiltWith Free API  
**Output**: Normalised technology categories with live/dead status pills, multi-domain matrix (up to 5 domains)

Reveals what CRM, email platform, analytics tools, chat widgets, payment processors, and ad pixels competitors are running. Informs: technology adoption signals in AI Competitor War Room, prospecting (know their stack before a sales call).

---

### 4.6 SERP Tracker (T12)

**API**: `/api/serp-tracker/{keywords,scan/:id,scan-all,history/:id}`  
**Data source**: DataForSEO `/v3/serp/google/organic/live/regular`  
**15-country location code map**  
**Tables**: `serp_tracker_keywords` + `serp_tracker_runs`

Tracks exact Google organic ranking positions for specified keywords over time. Exact-domain matching (not subdomain). Feeds into: SEO Task Manager (ranking regressions become tasks), Content Scorer (identify pages to optimise), Weekly Report.

---

### 4.7 Ad Library Spy (T17)

**API**: `POST /api/ad-library/{meta,tiktok}`  
**Data sources**: Meta Graph API v19.0 `/ads_archive` (requires ads_read scope) · TikTok via Perplexity sonar  

Pulls live competitor ads from Meta and TikTok ad libraries. Shows ad creative, targeting hints, and run duration. Pairs with TikTok Downloader (T20) — convert competitor URLs from Ad Library into a local swipe file. Feeds into: Creative Intel (T42), Creative Scoring (T68), A/B Designer (T7).

---

### 4.8 Review Aggregator (T18) + Deleted Review Detection (T46)

**API**: `POST /api/review-aggregator/{scan,compare,runs}`  
**Data source**: Perplexity sonar — Trustpilot · G2 · Google · Capterra · TripAdvisor  
**Table**: `review_aggregator_runs`

T18: Pulls reviews for 1–4 brands with average rating, sentiment-tagged review extracts, and review counts per platform.  
T46: Every scan snapshots the reviews. If any review disappears between scans, it's flagged as deleted in `review_snapshots`, a Slack alert fires, and a "Deleted Reviews" tab appears showing the review's full text, when it was first seen, and when it disappeared. This is legally valuable for brands disputing fraudulent review removal.

---

### 4.9 Job Board Spy (T18)

**API**: `POST /api/job-board-spy/scan`  
**Data source**: Perplexity sonar (LinkedIn + Indeed + careers page)  

Reads a competitor's open job listings and breaks them down by department. AI generates 2–5 strategic signals from hiring patterns (e.g., "Hiring 3 ML engineers suggests they're building an AI feature"). Feeds into: AI Competitor War Room.

---

### 4.10 Glassdoor Sentiment (T19)

**API**: `POST /api/glassdoor/{scan,runs}`  
**Data source**: Perplexity sonar  

Pulls competitor overall rating, CEO approval, recommend %, and real employee reviews with pros/cons/role/tenure. GPT generates 2–5 culture signals (e.g., "High churn in sales team"). Feeds into: Battle Cards, Talent acquisition strategy, AI Attack Plan.

---

### 4.11 Newsletter Tracker (T17)

**API**: `/api/newsletter-tracker/{targets,scan/:id,history/:id}`  
**Data source**: Firecrawl scrape + GPT-4o-mini  
**Tables**: `newsletter_targets` + `newsletter_issues`

Tracks competitor newsletters (Substack/Beehiiv/Mailchimp) and extracts each issue's subject, send date, preview, and URL for the last 10 issues. Identifies messaging patterns, content cadence, and topic focus. Feeds into: Content Calendar, A/B Designer (subject lines), Reply Assistant.

---

### 4.12 Web Vitals Auditor (T11)

**API**: `POST /api/web-vitals/audit {url}`  
**Data source**: Google PageSpeed Insights v5 API (mobile + desktop parallel)  
**Output**: Lab metrics + CrUX field data + top 6 improvement opportunities

Measures Core Web Vitals (LCP, FID/INP, CLS) plus Time to First Byte, Speed Index, Total Blocking Time. Pairs with SEO On-Page Auditor (T22) — speed and SEO twin tools. Feeds into: SEO Task Manager (opportunities become tasks).

---

### 4.13 SEO On-Page Auditor (T22)

**API**: `POST /api/seo-auditor/audit {url}`  
**Checks**: 17 page-level + 2 root-level (robots.txt, sitemap.xml)  
**Score**: 0–100, grades A–F  
**Table**: `seo_audit_runs`

Checks: HTTPS, title length 30–60ch, meta description 70–160ch, single H1, viewport tag, html lang, canonical, Open Graph (title/description/image), Twitter card, JSON-LD, image alt-text %, noindex blocker, favicon, word count ≥600, ≥3 internal links, no mixed content. Each check is weighted; total normalised to 0–100. The `runAudit(url)` function is shared by T22, T23 (embeddable widget), T24 (task import), and T33 (extended inventory).

---

### 4.14 Embeddable SEO Audit Widget (T23)

**API**: `/api/seo-widget/{sites,embed/:siteId.js,audit/:siteId}`  
**Tables**: `seo_audit_runs` + `seo_widget_leads`

Generates a paste-once JavaScript widget (`<script src=".../embed/sw_xxx.js" async>`). When a visitor enters their URL and email on the host site, the widget calls InfoGenie's audit API, shows them a teaser score (passed/warned/failed counts), and gates the full 17-check report behind email capture. The lead is stored and accessible in InfoGenie's lead panel. This is a **lead-generation play for agencies** — they install the widget on their own marketing site and capture prospects who want an SEO audit.

---

### 4.15 SEO Task Manager (T24)

**API**: `/api/seo-tasks/{list,import-from-audit,reaudit}`  
**Table**: `seo_tasks` (statuses: open/in_progress/done/snoozed/wont_fix, priorities P1–P3)

Converts audit failures and warnings into tracked action items. `POST /import-from-audit` reads the audit's JSONB, creates one task per failing check, and deduplicates against existing open tasks for the same URL + check combination. `POST /reaudit` re-runs the audit and automatically closes any tasks whose checks now pass. This transforms the SEO auditor from a snapshot snapshot tool into a living improvement tracker.

---

### 4.16 Change Monitor (T73)

**API**: `/api/change-monitor/watches`  
**Data source**: Firecrawl page fetch  
**Tables**: `change_monitor_watches` + `change_monitor_diffs`

Watches any competitor URL for content changes. On each check: fetches the page, computes word-level delta %. If ≥5% change detected: GPT-4o-mini classifies the change type (pricing/features/messaging/design/content/other), severity (low/medium/high), and generates a strategic insight. Alerts fire via Slack + email. Full snapshot stored (up to 50k chars).

---

### 4.17 Resilient Competitor Tracker (T80)

**API**: `/api/resilient-tracker/trackers`  
**Data sources**: Firecrawl (primary) → Perplexity sonar (fallback)  
**Tables**: `resilient_trackers` + `resilient_tracker_snapshots`

Tracks specific data **points** (key-description pairs) on competitor pages rather than full-page changes. Example: track "price of Pro plan" as a specific extraction key. The dual-source cascade (Firecrawl → Perplexity) makes it resilient to anti-bot measures. Consecutive failure counter prevents false positives.

---

### 4.18 AI Competitor War Room (T81)

**API**: `POST /api/war-room/analyse {competitor, domain}`  
**Data sources**: Perplexity sonar (live signals) → GPT-4o (strategic prediction)  
**Table**: `war_room_analyses`

Cross-signal AI prediction engine. Gathers signals: recent hires, ad spend changes, new pages, pricing changes, PR activity, geographic expansion. GPT-4o produces: move type (market_expansion/product_launch/pricing_war/talent_surge/acquisition/channel_shift/partnership), confidence score 0–100, threat level (low/medium/high/critical), rationale, recommended counter-move, and per-signal weight breakdown.

---

### 4.19 AI Web Extractor (T75)

**API**: `POST /api/web-extractor/extract {url, instruction}`  
**Data source**: Firecrawl markdown → GPT-4o-mini  

Free-form data extraction in plain English. Example: "Extract all pricing tiers and their feature lists from this page." Returns structured JSON table with summary and row count. Useful for one-off competitive research that doesn't fit a pre-built recipe.

---

### 4.20 Scraping Recipe Library (T76)

**API**: `POST /api/recipe-scraper/run {recipe_id, target_url}`  
**10 pre-built recipes**: G2 reviews · Product Hunt · Trustpilot · LinkedIn company · HN discussion · App Store · Glassdoor · Capterra · competitor pricing page · jobs page

Each recipe defines an extraction instruction matched to the target page's structure. Firecrawl fetches the page; GPT-4o-mini extracts. Returns columns/rows/summary. The difference from T75 is that recipes are templated and repeatable — users can run the same recipe against multiple competitors.

---

### 4.21 Dataset Marketplace (T78)

**API**: `POST /api/dataset-market/generate {pack_id, industry, region}`  
**8 dataset packs**: competitor pricing · job market signals · social proof aggregator · industry benchmarks · tech stack map · content gaps · ad creative intelligence · market sizing

Generates structured intelligence datasets (≥8 rows) via GPT-4o with key takeaways and an AI disclaimer. Useful for strategy presentations and board reports.

---

### 4.22 SpyFu Integration (T114)

**API**: `/api/spyfu`  
Competitor keyword overlap and paid keyword intelligence. Shows which keywords competitors buy on Google Ads and which organic keywords they rank for. Feeds into: Keyword Explorer, SERP Tracker target list.

---

### 4.23 Majestic SEO Integration (T115)

**API**: `/api/majestic`  
Backlink intelligence: Trust Flow, Citation Flow, referring domains, anchor text distribution for any domain. Feeds into: Link Prospector (T44), Backlink Intel (T6).

---

### 4.23b Mangools SEO Integration

**API**: `/api/mangools`  
**Auth**: `MANGOOLS_API_KEY` → `x-access-token` header on `api.mangools.com/v3`  
KWFinder related & competitor keywords, SiteProfiler overview/competitors, keyword gap analysis, and SiteProfiler backlink profiles. UI: Analyse → Mangools. Configure via Manage → Platform APIs.

---

### 4.24 Maps Intelligence (T41)

**API**: `POST /api/maps-intel/scan {keyword, region}`  
**Data sources**: Perplexity Sonar (12–20 local businesses) → GPT-4o-mini (market summary)  
**Table**: `maps_intel_runs`

For local/regional businesses: pulls competitor businesses from Google Maps data, including ratings, review counts, price range, website presence. Market summary: density, average rating benchmark, market maturity, opportunities, threats.

---

### 4.25 Organic Social Monitor (T65)

**API**: `POST /api/apify/tiktok-organic {keyword, limit}`  
**Data source**: Apify `clockworks~tiktok-scraper` Actor  

Scrapes organic TikTok posts for any brand or keyword. Returns views, likes, comments, shares, and engagement rate per video. Complements Ad Library Spy — covers both paid and organic competitor activity.

---

## 5. GROW — Campaigns, Conversion & Revenue

The Grow section covers the full paid acquisition, conversion optimisation, and revenue modelling stack.

---

### 5.1 Campaign Launch

**Location**: Grow → Advertise Hub  
**AI**: GPT-4o campaign brief generation  
**Platforms**: Meta · Google Ads · TikTok Ads

Generates complete campaign briefs (objective, audience, creative direction, budget recommendation) and launches them to connected ad platforms. Auto-registers every launched campaign in the AI Optimizer with `optimizer_enabled=TRUE`. Without platform credentials, campaigns land as `platform_camp_id='local_<ts>'` — visible immediately in the UI, real ID applied once credentials are connected.

---

### 5.2 AI Optimizer

**Location**: Grow → AI Optimizer  
**Schedule**: Ingest 60min · Pause/scale rules 6h · Creative refresh 24h · MAB reallocation 12h  
**Default**: Dry-run mode (proposes changes, doesn't execute)

Multi-armed bandit (MAB) budget reallocation across campaigns. Six-hour rule engine: pauses underperforming campaigns, scales winners. Twenty-four-hour creative refresh: detects creative fatigue (frequency rising, CTR falling), rewrites ad copy via GPT-4o, flags for human approval. Manual flip from dry-run to LIVE in the UI. All optimizer decisions are logged and surfaced in the Weekly Report.

---

### 5.3 Landing Page Builder (T9) + A/B Split Testing (T70) + Lead Analytics (T71)

**API**: `POST /api/landing-pages/generate`  
**AI**: GPT-4o-mini (hero + 4–6 features + 3–4 steps + 2–3 testimonials + 4–6 FAQs + CTA)  
**Table**: `landing_pages`  

Full pipeline:
1. **Audience Research Agent (T67)**: Before writing a page, runs AI audience intelligence (3–4 personas, pain points, objections, power words, hook angles)
2. **Page Generation**: Server-side `_renderHtml(content, {accent})` produces responsive HTML; sandboxed iframe preview
3. **A/B Testing (T70)**: Generate a variant B with a different persuasion angle; track views and conversions per variant in real time
4. **Lead Capture (T71)**: Auto-injected form; leads stored in `landing_page_leads`; webhook forwarding to Zapier/HubSpot/Make
5. **Ad Package (T72)**: Generate Meta + Google Display + TikTok copy from the same LP content

---

### 5.4 CRO Lab

**Location**: Grow → CRO Lab  
Structured conversion rate optimisation experiments. Pairs with Heatmaps (Microsoft Clarity integration) for visual evidence.

---

### 5.5 Conversion Boosters (T27)

**API**: `/api/conversion-boosters/widgets`  
**Widgets**: Social Proof popup (rotating toasts) + Exit Intent popup (email capture modal)  
**Tables**: `cb_widgets` + `cb_events`

Paste-once JavaScript embeds for any website. Social proof shows "Sarah from Cape Town just signed up" style notifications. Exit intent triggers on desktop mouseleave-top + mobile rapid scroll-up. Both track view/dismiss/lead events with IP-hashed analytics (never raw IPs) and serve the widget from the origin via CORS * for easy embed.

---

### 5.6 Conversion Recovery (T74)

**API**: `POST /api/conversion-recovery/score` + `POST /setup-guide`

Two-panel tool:
1. **Score Calculator**: Computes a 0–100 Conversion Recovery Score based on iOS/Safari cookie loss, ad blockers, cross-device gaps, cookie consent, late pixel fires. Returns estimated monthly dollar loss.
2. **Setup Guide**: GPT-4o-mini generates a step-by-step server-side tracking implementation (Meta CAPI or Google Enhanced Conversions) with copy-paste code for Node/Python/PHP.

---

### 5.7 iROAS Incrementality (T61)

**API**: `/api/iroas/tests`  
**Tables**: `iroas_tests` · `iroas_saturation`

Design a holdout experiment: split audience into test group and control group, measure conversion delta. AI calculates: test CVR, control CVR, lift %, incremental conversions, incremental revenue, iROAS vs reported ROAS (the gap reveals how much credit reporting attributes incorrectly). Saturation curves show the point where additional spend produces diminishing returns.

---

### 5.8 Multi-touch Attribution Dashboard (T117)

**API**: `POST /api/attribution/model` · `GET /api/attribution/history`  
**Tables**: `attribution_runs` + `attribution_touchpoints`

Models revenue credit across every marketing touchpoint in the customer journey. Five attribution models:
- **First-Touch**: 100% credit to the first channel the customer interacted with — measures brand awareness investment
- **Last-Touch**: 100% to the final channel before conversion — favours retargeting and direct
- **Linear**: Equal credit split — treats every channel as equal contributors
- **Position-Based (U-shaped)**: 40% first + 40% last + 20% shared across middle — balances awareness and conversion
- **Time-Decay**: Geometric weighting toward recent touchpoints — favours channels close to the sale

Per-channel outputs: attributed revenue, credit %, ROAS, CPA. Cross-model comparison chart reveals divergence (e.g., "Google Ads gets 60% under last-touch but only 18% under linear"). AI insights flag: highest-spend channel, best ROAS channel, first-touch vs last-touch divergence, lowest CPA.

**Why it matters**: Without multi-touch attribution, media buyers optimise against last-touch data and systematically underfund top-of-funnel channels. This closes that loop.

---

### 5.9 True ROAS (T36)

**API**: `/api/true-roas`  
**Schedule**: 6-hour sync + budget recommendations  

Margin-aware ROAS calculation. Unlike platform-reported ROAS (revenue / spend), True ROAS factors in product margins, fulfilment costs, and overheads to compute actual profit per channel. Budget recommendations identify which channels are profitable at the margin level vs which are generating revenue but losing money.

---

### 5.10 Revenue Forecast Engine (T82)

**API**: `POST /api/revenue-forecast/simulate`  
**AI**: GPT-4o  
**Table**: `revenue_forecasts`

90-day what-if revenue modeller. User inputs: current monthly spend, budget change %, current leads, CVR, AOV, CAC, LTV. GPT-4o produces: best/expected/worst case (leads, customers, revenue, CAC, ROAS), payback period, LTV:CAC ratio, 3-month breakdown table, plain-English recommendation, key assumptions, risk factors.

---

### 5.11 Digital Twin (T83)

**API**: `POST /api/digital-twin/simulate {scenario, question, business_context}`  
**AI**: GPT-4o  
**Table**: `digital_twin_scenarios`

AI business simulation engine. 7 preset scenarios: increase spend · launch UK market · cut Meta · double down on SEO · raise prices · launch product · custom. GPT-4o returns: verdict (positive/neutral/negative/mixed), confidence %, executive summary, 90-day timeline (3 phases), upsides, risks, affected metrics with directional estimates, recommended action, alternative scenarios to explore.

---

### 5.12 Media Mix Modeler (T90)

**Location**: Grow → Media Mix Modeler  
Computes optimal budget allocation across channels to maximise ROI given a total budget constraint. Uses historical performance data from connected ad platforms plus user-entered channel data.

---

### 5.13 Blended Performance (CAC) + Benchmark Intelligence (T89)

**API**: `POST /api/benchmarks/{submit,compare}`  
**Tables**: `benchmark_submissions` + `benchmark_aggregates`

Blended Performance: cross-channel CAC (all spend ÷ total customers) — the single most important growth metric.

Benchmark Intelligence: tenants submit their own metrics (CPA, CAC, ROAS, CTR, CVR, CPM, email open rate, LTV, LTV:CAC, ad spend, organic traffic). These are aggregated via `PERCENTILE_CONT` into P25/median/P75 per vertical × region × company size. Compare view shows your metrics vs network medians with GPT-4o-identified gaps and actions. The **data moat**: as more tenants submit benchmarks, the aggregate intelligence improves for all.

---

### 5.14 AI Acquisition Engine (T84)

**API**: `POST /api/acquisition-engine/launch`  
**Data sources**: Perplexity sonar (prospects) · GPT-4o (email sequence)  
**Tables**: `acquisition_campaigns` + `acquisition_prospects`

Fully autonomous lead-to-meeting pipeline:
1. Finds prospects via Perplexity (real LinkedIn-style research)
2. Scores each prospect (email +40, company +20, role +20, base +20)
3. Generates a 3-step cold email sequence in GPT-4o
4. Tracks pipeline status: found → emailed → meeting_booked

No manual prospecting required — specify target industry, role, company size, and value proposition.

---

## 6. REACH — Audiences, Outreach & Distribution

### 6.1 Dynamic Audiences

**Architecture**: 4-phase pipeline

- **Phase 1 (Rule Builder)**: Define segment rules (field + operator + value) with AND/OR logic. Live contact preview.
- **Phase 2 (Sweep Cron)**: Every 15 minutes, re-evaluates all segment rules against the contacts database. Adds/removes contacts. HubSpot webhook integration (HMAC-validated).
- **Phase 3 (Drip Bind)**: Bind any audience to a Drip email sequence — auto-enrol on join, auto-unsubscribe on leave (only enrolments tagged with the binding ID are touched; manual enrolments are never disturbed).
- **Phase 4A (HubSpot Mirror)**: Mirror audience membership to a HubSpot Static List (auto-creates the list on first save; pushes joins/leaves in real time).
- **Phase 4B (Churn Re-engage Bridge)**: Bind a churn-risk audience to a 1-step AI win-back email. Fires on join, withdraws on leave.

All three bridges (drip, HS list, re-engage) run after the membership write commits and are fanned out per-contact with per-target try/catch.

---

### 6.2 Journey Builder

**Location**: Reach → Customer Journey Builder  
**Tick**: Every 60 seconds  
**Node types**: trigger · wait · condition · action

Visual workflow builder. Signal triggers (`fireSignal()`) bridge real-world events (website visits, purchases, form submits) into journey enrolments. The runner evaluates every active enrolment on each tick: checks wait timers, evaluates conditions (contact field values, event history), dispatches actions (send email, add tag, notify Slack, move to next step). Non-destructive — removing a contact from an audience only unsubscribes journey-tagged enrolments, not manual ones.

---

### 6.3 Drip Engine

**Location**: Reach → Drip Engine  
**Architecture**: email sequences with per-contact state machine  

Multi-step email sequences with configurable delays. Each step is an email; state is stored per `(drip_id, contact_email)`. The dynamic audience bridge auto-enrols/unsubscribes when segment membership changes. Safe concurrent writes via `global._dripStore.lock`.

---

### 6.4 Omnichannel Composer

**Location**: Reach → Omnichannel Composer  
**Channels**: Email · SMS · WhatsApp · Voice (Vapi) · Push (VAPID Web Push)

Single-message composer that adapts copy for all 5 channels simultaneously. Feeds into Journey Builder actions.

---

### 6.5 Email Broadcast + Tracking (T40-tier)

**API**: `/api/email-broadcast`  
**Tables**: `email_broadcasts` + `email_broadcast_recipients`  
**Webhook**: Resend Svix-signed events → `/api/email-broadcast/webhook`  

Full bulk email broadcast system with per-recipient tracking. Sends via Resend API. Incoming webhooks update open_count, click_count, bounce_count, complaint_count, unsubscribe_count on the broadcast row and set the recipient's status (opened/clicked/bounced/complained/unsubscribed) with a timestamp.

---

### 6.6 Email Campaign Analytics (T119)

**API**: `GET /api/email-broadcast/analytics`  
**React component**: `EmailCampaignAnalytics.tsx`

Dashboard over the broadcast tracking data:
- 6 headline metrics: total campaigns, total sent, average open rate, average CTR, average bounce rate, average unsub rate
- Colour-coded industry benchmarks: open rate (good: >25%, poor: <15%), CTR (good: >3%, poor: <1%), bounce (good: <0.5%), unsub (good: <0.2%)
- Per-campaign sortable table with inline health bars, status badges, and per-campaign rates
- Export-ready for client reports

**Relationship**: Completes the email loop — Broadcast handles sending, Analytics handles measurement. Benchmarks in T89 provide the context to interpret the numbers.

---

### 6.7 Cold Email Writer (T10)

**API**: `POST /api/cold-email/generate`  
**AI**: GPT-4o-mini  
**Output**: 1–5 step email sequence with subject, body, follow-up cadence  
**Table**: `cold_email_runs`

Generates multi-step cold outreach sequences with configurable tone. Integrates with Brand Foundation (auto-injects USP and ICP). Links to: Email Personalizer (1-to-1 customisation), Acquisition Engine (automated sending), HubSpot Sync (push contacts).

---

### 6.8 Email Personalizer (T16)

**API**: `POST /api/email-personalizer/{personalize,bulk}`  
**Data source**: Firecrawl (site research per lead) + GPT-4o-mini  
**Tokens**: [NAME] [FIRST_NAME] [COMPANY] [ROLE] [WEBSITE]  
**Batch**: up to 25 leads  

Rewrites a cold email template for each specific lead using real research about their company (from Firecrawl scrape of their website). Pulls leads from `window._lfLeads` (the B2B Lead Finder results cache) in one click. CSV export for upload to any email platform.

---

### 6.9 Social Publisher (T15)

**API**: `/api/social-publisher`  
**Data source**: Zernio API v1 (`ZERNIO_API_KEY`)  
**15 platforms**: Twitter/X · Instagram · Facebook · LinkedIn · TikTok · YouTube · Pinterest · Reddit · Bluesky · Threads · Google Business · Telegram · Snapchat · WhatsApp · Discord  

OAuth connect per platform via Zernio's authUrl flow. Post immediately or schedule. Bulk scheduling from Content Calendar (one click publishes entire calendar to connected platforms). Analytics pull per account: posts, impressions, likes, comments, shares, clicks, engagement rate, followers, follower growth.

---

### 6.10 B2B Lead Finder (T11)

**API**: `POST /api/lead-finder/search`  
**Data source**: Perplexity sonar  

AI-powered prospect research — finds real companies and contacts. Never invents emails (returns LinkedIn profiles when email not found). Max 2 contacts per company to avoid spam. Results cached in `window._lfLeads` for one-click push to HubSpot Sync or Email Personalizer.

---

### 6.11 Lead Aggregator (T77)

**API**: `POST /api/lead-aggregator/sweep`  
**Data sources**: Perplexity sonar (AI web research) + Apollo.io API (database lookup)  

Sweeps leads from both sources simultaneously. Deduplicates by email/LinkedIn URL/name+company. Scores leads by completeness (+15 email, +10 LinkedIn, +5 domain, +10 title match). Returns sorted, source-attributed lead list. Apollo.io requires `APOLLO_API_KEY`.

---

### 6.12 Local Lead Finder (T66)

**API**: `POST /api/apify/maps-leads {query, limit}`  
**Data source**: Apify `compass~crawler-google-places` Actor  

Scrapes Google Maps for local businesses: name, category, address, phone, website, rating, review count, opening hours. One-click HubSpot push (creates company record). Useful for local agencies building prospect lists.

---

### 6.13 HubSpot CRM Sync (T12)

**API**: `/api/hubspot-sync/{test,push-lead,push-influencer,push-bulk,recent-contacts}`  
**Auth**: `HUBSPOT_PRIVATE_APP_TOKEN` Bearer  

Upserts contacts/companies to HubSpot via batch API (dedupes by email). Receives inbound webhooks (HMAC-validated) to keep dynamic audience membership in sync with HubSpot list changes. Surfaces last 50 HubSpot contacts in the UI for reference. This is InfoGenie's CRM bridge — it doesn't replace HubSpot, it keeps it up to date in real time.

---

### 6.14 Backlink Intel (T6) + Link Prospector (T44)

**Backlink Intel**: DataForSEO `/v3/backlinks/*/live` — referring domain summary, anchor text breakdown, link velocity.

**Link Prospector (T44)**: 
- Step 1: DataForSEO SERP finds top 20 pages ranking for target keyword
- Step 2: Perplexity Sonar enriches each page (domain strength, content relevance, competitor link status, contact email/Twitter)
- Step 3: GPT-4o-mini scores and prioritises prospects (priority scoring: domain strength 40%, content relevance 35%, competitor-links bonus 10%, edu/gov/news bonus 15%)
- Outputs: prioritised link prospect table with "Draft Outreach" button (pre-fills Cold Email Writer)

---

### 6.15 Email Deliverability Auditor (T9)

**API**: `POST /api/deliverability/audit`  
**Method**: Pure DNS lookups — no external API needed  
**Checks**: MX · SPF · DKIM (19 common selectors) · DMARC · MTA-STS · BIMI  
**Score**: Weighted A–F grade

Prevents email campaigns from going to spam. BIMI check verifies the brand logo can appear in Gmail. MTA-STS check confirms encrypted delivery enforcement. Pairs with Email Broadcast — fix deliverability before sending.

---

### 6.16 Hashtag Intelligence (T40)

**API**: `POST /api/hashtag-intel/research`  
**Data sources**: Perplexity Sonar (research) + GPT-4o-mini (cluster analysis)  
**Platforms**: Instagram · TikTok  

Researches hashtags for a seed keyword, clusters them by reach (Mega/High/Medium/Niche), generates posting strategy per cluster. Caption-ready copy block with top 30 tags. Feeds into Social Publisher (attach hashtags to scheduled posts).

---

### 6.17 Chatbot Builder (T19)

**API**: `POST /api/chatbot/{generate,configs}`  
**AI**: GPT-4o-mini  
**Table**: `chatbot_configs`

Generates a complete chatbot configuration: greeting, 8–15 FAQ Q&A entries, fallback message, lead-capture fields, quick replies, accent colour. Returns copy-pasteable embed snippet. The chatbot conversations feed into the Unified Conversation Inbox (T26) for centralised management.

---

### 6.18 Influencer CRM (T1) + Discovery (T3) + Fake Detection (T45)

**Influencer CRM**: Status pipeline prospect → contacted → negotiating → active. AI draft email generation per influencer. Table `influencers` + `influencer_outreach`.

**Discovery**: Perplexity sonar finds influencers with ≥5k followers for any niche/platform. One-click "Add to CRM".

**Fake Detection (T45)**: Perplexity researches follower growth trajectory, engagement quality, comment authenticity, brand partnerships, pod signals. GPT-4o-mini produces: score 0–100, risk level (Low/Medium/High/Suspicious), red flags, green flags, engagement verdict. Engagement benchmarks: Instagram 3%, TikTok 5%, YouTube 2%, X 0.5%, LinkedIn 1.5%.

---

### 6.19 AI Voice Caller (Vapi)

**Channel**: Outbound voice calls via Vapi API  
**Webhook**: `/api/voice-caller/webhook` (shared-secret verified)  

AI-powered outbound voice calling. Scripts generated by GPT. Call recordings and transcripts stored and surfaced in conversation inbox.

---

### 6.20 WhatsApp Channel

**API**: Meta WhatsApp Cloud API  
**Webhook**: `/api/whatsapp/webhook` (X-Hub-Signature-256 verified)  

Send and receive WhatsApp messages. Inbound messages appear in Unified Inbox. Feeds into Journey Builder (WhatsApp action node).

---

## 7. CREATE — Content, Creative & Publishing

### 7.1 Content Calendar (T6)

**API**: `POST /api/content-calendar/generate`  
**AI**: GPT-4o-mini  
**Table**: `content_calendar_runs`  
**Output**: 1–30 days · 8 channel types  
**Export**: CSV  

Generates a complete content calendar with topic, format, platform, copy, hashtags, and CTA for each day. Brand Foundation auto-injected. Language-aware (T55 — 30 languages). Each post card has: 📤 Publish to Social Publisher · 📤 Publish to WordPress · 🎧 Audio Summary · 📅 Add to Calendar. Ideas from Idea Swipe Feed (T53/54) can be added to calendar in one click. Content Ideas from YouTube Comment Miner (T43) can be added to calendar directly.

---

### 7.2 Content AI (T48 — Content Modes)

**API**: `POST /api/content-modes/generate {mode, keyword, brand, audience, tone}`  
**AI**: GPT-4o-mini with mode-specific system prompts  
**6 modes**:
- `article` — standard SEO blog post with sections, internal link suggestions
- `affiliation` — product review with pros/cons, verdict, star rating
- `ecommerce` — product/category page with features, benefits, buying guide
- `local` — location-based with local keywords and GMB signals
- `update` — refresh existing content (paste in existing article)
- `discovery` — Google Discover-optimised (500–700 words, curiosity hook, trending signals)

Output: title, SEO title, meta description, word count, intro, sections[], conclusion, CTA, internal link suggestions. Feeds into: Audio Summaries (T50), WordPress Publishing (T47), Content Autopilot (T49).

---

### 7.3 Content Autopilot (T49)

**API**: `/api/autopilot/schedules`  
**Tables**: `autopilot_schedules` + `autopilot_logs`  
**Cron**: Hourly tick (first tick 30s after boot)  
**Frequencies**: daily · every3days · weekly · biweekly · monthly  

Schedules automatic content generation + optional WordPress auto-publishing. Each schedule specifies: keyword, mode, frequency, WordPress site, auto-publish, post status. The hourly cron checks `next_run_at <= now()`, calls Content Modes internally, then optionally pushes to WordPress. Logs each run with status and WordPress post URL.

---

### 7.4 WordPress Auto-Publishing (T47)

**API**: `/api/wordpress/{sites,connect,publish,publish-log}`  
**Tables**: `wordpress_sites` + `wordpress_publish_log`  
**Auth**: Application Password (AES-256-GCM encrypted in vault)  
**SSRF guard**: Rejects private IP WordPress installs  

Connects to any self-hosted WordPress via REST API. Credentials validated on connect (`GET /wp-json/wp/v2/users/me`). Publish with status: draft/publish/pending. Available from: Content Calendar post cards, Content Modes article view, Content Autopilot.

---

### 7.5 Content Scorer (T39-A)

**API**: `POST /api/content-score/score` + `POST /auto-optimize`  
**8 scoring dimensions**: keyword density · meta tags · content depth · heading structure · featured-snippet eligibility · schema markup · internal/external links · image alt coverage  

Scores existing content 0–100 per dimension. `auto-optimize` sends all failing dimensions to GPT-4o-mini in one prompt, returns a structured fix plan (issue, fix_text, priority per dimension). Copy buttons per fix. Pairs with SEO Task Manager — scoring issues become tracked tasks.

---

### 7.6 Idea Swipe Feed (T53/54)

**API**: `GET /api/idea-feed/ideas?brand=&force=`  
**20 content angles**: Mythbuster · Before & After · Us vs Them · Problem-Solution · Statistics · Negative Hook · What's Inside · Top Reasons · FAQ · Testimonial Story · Best-seller Spotlight · Behind the Scenes · Media Feature · Customer Mistake · Quick Win Tip · Trend Reaction · Founder Story · Product Demo · Social Proof · Limited Offer  

Generates 20 AI content ideas per day using Brand Foundation context. Cached by batch date. Tinder-style swipe interface: ✕ Skip / ⭐ Save / 📅 Add to Calendar. Saved ideas and the full angles library are accessible in a sidebar.

---

### 7.7 Video Script Generator (T18)

**API**: `POST /api/video-script/generate`  
**Platforms**: TikTok · Instagram Reels · YouTube Shorts · LinkedIn  
**Output**: Up to 5 variants, each with hook/body (spoken+on-screen+cue)/CTA/viral pattern/hashtags  

Pairs with Voiceover (T21) — generate script then get MP3. Pairs with Creative Intel (T42) — "Open Video Script Generator" button pre-fills topic from creative analysis.

---

### 7.8 Headline Tester (T17)

**API**: `POST /api/headline-tester/test-headline`  
**10 variant types**: curiosity · negative · question · listicle · urgent · specific number · contrarian · social proof · how-to · outcome  

Scores original headline 0–100. Generates 3–10 variants. Each variant has: score, patterns_hit, reasoning. Sortable by score. Feeds into: A/B Designer (headline element), Content Calendar (optimised post titles), Landing Page Builder (hero headline).

---

### 7.9 A/B Designer (T7)

**API**: `POST /api/ab-designer/generate`  
**AI**: GPT-4o-mini  
**8 element kinds**: headline · subheadline · CTA button · hero image description · form copy · social proof · urgency trigger · value proposition  
**10 persuasion angles per element**  

Generates A/B test variants for any page element. Length-aware (respects character limits for platforms). Pairs with Landing Page A/B Testing (T70).

---

### 7.10 Press Release Writer (T5)

**API**: `POST /api/press-release/generate`  
**6 kinds**: crisis_response · product_launch · milestone · counter_competitor · partnership · custom  

Hydrates from existing data: `from_incident_id` pulls context from Crisis Radar incidents, `from_battle_card_id` pulls from Battle Cards. This means a PR response to a competitor attack can be generated in one click from the battle card context.

---

### 7.11 Cold Email Writer (T10)

Already covered in Reach section. Also lives in Create navigation.

---

### 7.12 AI Creative Generator (T51)

**API**: `POST /api/ad-creative/generate`  
**AI**: DALL-E 3 (OpenAI Images API)  
**10 platforms**: Facebook ad · Instagram post/story · Google Display · Twitter/X · LinkedIn · TikTok · Pinterest · email banner · YouTube thumbnail  
**8 styles**: photorealistic · illustration · minimalist · bold graphic · corporate · playful · editorial · flat design  

Generates actual ad images. Saves to `uploads/ad_creatives/`. History gallery. Pairs with: Creative Scoring (T68) — score before spending, UGC Video Scripts (T69) — generate the video concept to film.

---

### 7.13 Pre-launch Creative Scoring (T68)

**API**: `POST /api/ad-creative/score`  
**5 dimensions**: hook_strength · CTA clarity · urgency · emotional resonance · relevance  

Score 0–100, letter grade A–F, predicted CTR range (low/high %), 3–5 specific improvement tips. Prevents wasted ad spend on weak creative.

---

### 7.14 UGC Video Ad Scripts (T69)

**API**: `POST /api/ad-creative/ugc-script`  
**5 hook styles**: problem-solution · before-after · testimonial · ASMR · trending-sound  
**Durations**: 15/30/45/60 seconds  

Scene-by-scene timed UGC script with timestamp, type badge (hook/problem/solution/proof/CTA), exact spoken words, camera direction, on-screen text. Full post caption and creator filming tips. Pairs with Video Script Generator (T18).

---

### 7.15 Viral Carousel Generator (T38)

**API**: `POST /api/carousel/generate`  
**4 structures**: pure-info · storytelling · problem-solution · listicle  
**Framework**: Hook → Context → Value → Action (10 slides)  

Generates 10 colour-graded carousel slides. Pairs with: Reddit Pulse "Discover Questions" panel — the "Make Carousel" button pre-fills the topic from a real audience question. "Open Social Publisher" and "Add to Calendar" handoff buttons.

---

### 7.16 Schema.org / JSON-LD Generator (T25)

**API**: `POST /api/schema-generator/generate`  
**8 types**: Organization · Article · Product · FAQPage · LocalBusiness · BreadcrumbList · Event · Recipe  

Fully dynamic form driven by a `TYPES` manifest. Generates valid JSON-LD with proper nesting (AggregateRating + Offer for Product, HowToStep for Recipe, etc.). Directly improves AI search visibility (T1) — proper schema is what ChatGPT/Perplexity/Gemini parse to cite a site.

---

### 7.17 Localization (T55)

**30 languages** injected via `language` param into Content Modes and Content Calendar. Language selector rendered by MutationObserver across all content generation forms. Languages include Arabic, Hebrew, Chinese (Simplified/Traditional), Japanese, Korean, all major European languages, and key Southeast Asian and African languages.

---

### 7.18 Voiceover (T21)

**API**: `POST /api/voiceover/generate`  
**AI**: OpenAI TTS (tts-1 / tts-1-hd)  
**Voices**: alloy · echo · fable · onyx · nova · shimmer  
**Max**: 4,000 characters  

Generates MP3 saved to `uploads/voiceovers/`. History widget with inline `<audio>` players. Pairs with: Video Script Generator (script → voice), Audio Summaries (T50 — condense article → MP3).

---

## 8. ANALYSE — Measurement, Intelligence & Prediction

### 8.1 GSC & GA4 Hub (Analytics Hub)

**Location**: Analyse → GSC & GA4 Hub  
**Status**: Parked — Google Workspace org policy blocks OAuth in the current environment  

Integration point for Google Search Console keyword data and Google Analytics 4 session/conversion data. When connected: feeds into SERP Tracker, Content Scorer, and Weekly Report.

---

### 8.2 Amplitude AI Agents

**API**: Amplitude Analytics API (`AMPLITUDE_API_KEY` + `AMPLITUDE_SECRET_KEY`)  
**Location**: Analyse → Amplitude AI Agents  

Connects to Amplitude product analytics. AI agents interpret event funnels, cohort retention, and feature adoption data. Surfaces product-led growth signals that feed into Journey Builder (trigger on Amplitude events) and Dynamic Audiences (segment by product behaviour).

---

### 8.3 AI Competitor War Room (T81)

Covered in Compete section. Located in Analyse navigation.

---

### 8.4 Business Acquisition Scanner (T86)

**API**: `POST /api/biz-scanner/scan {industry, region, scan_type, budget_range}`  
**Data sources**: Perplexity sonar (market intelligence) + GPT-4o (opportunity scoring)  
**Table**: `biz_scan_runs`

M&A opportunity intelligence. Scan types: struggling competitors · businesses for sale · fast-growing sectors · franchise opportunities · full scan. Returns: market summary, scored opportunity cards (1–100), top pick recommendation, sector trends. Feeds into: Revenue Forecast Engine (model the acquisition scenario), Digital Twin (simulate post-acquisition).

---

### 8.5 Benchmark Intelligence (T89)

Covered in Grow section. Located in Analyse navigation.

---

### 8.6 WCAG Accessibility Audit (T57)

**API**: `POST /api/accessibility/audit {url}`  
**AI**: GPT-4o (12 WCAG 2.1 AA criteria categories)  
**Score**: 0–100 with severity breakdown (critical/serious/moderate/minor)  

Fetches page via Firecrawl, runs structural HTML checks, then GPT-4o deep-audits for: image alt text, colour contrast, keyboard navigation, form labels, heading structure, link purpose, ARIA roles, media captions, language attribute, skip nav, empty interactive elements. Returns per-criterion fixes, passes list, and quick wins.

---

### 8.7 BingWebmaster Tools Integration (T113)

**API**: `/api/bing-webmaster`  
**Auth**: `BING_WEBMASTER_API_KEY`  

Bing Search Console data: crawl errors, sitemap submission status, keyword performance on Bing. Complements Google Analytics Hub.

---

### 8.8 SpyFu Integration (T114) / Majestic SEO (T115)

Covered in Compete section. Located in Analyse navigation as well.

---

### 8.9 Real-Time News (T116)

**API**: `/api/realtime-news`  
**Data sources**: Multiple news APIs + Perplexity sonar for AI-powered news research  
**Table**: `realtime_news_runs`

Real-time industry and competitor news monitoring. Surfaces breaking news relevant to the brand's competitive space. Feeds into: Daily Digest, Crisis Radar (manual trigger from news item), Content Calendar (react to breaking news).

---

### 8.10 Multi-touch Attribution Dashboard (T117)

Covered in Grow section. Located in Analyse navigation (Grow → Track full-funnel ROI).

---

## 9. MONITOR — Brand & Market Surveillance

### 9.1 Crisis Radar (T2)

**API**: `/api/crisis-radar/{watchlist,incidents,snapshots,run-now}`  
**Schedule**: Every 6 hours  
**Baseline**: 7-snapshot moving average  
**Tables**: `crisis_watchlist` + `crisis_snapshots` + `crisis_incidents`  
**Alerts**: Slack (SSRF-guarded webhook)

Monitors brand mention volume across sources. When volume deviates significantly from the 7-snapshot baseline, an incident is created. Slack alert fires immediately. Populates Share of Voice data. Press Release Generator can hydrate directly from an incident (`from_incident_id`). The Alert Routing system (T5) can route crisis_incident triggers to any channel (Slack, email, SMS, push).

---

### 9.2 AI Daily Digest (T4)

**API**: `POST /api/digest/{run-now,/:id/send}`  
**Schedule**: Every 24 hours per watchlist brand  
**AI**: GPT-4o-mini  
**Table**: `digest_runs`  
**Sections**: warning · win · action · highlight  

Aggregates all monitoring signals from the past 24 hours into a single briefing. Sends to Slack and optionally email. Surfaces in Weekly Report. This is the "morning briefing" — instead of checking 10 dashboards, the platform summarises everything overnight.

---

### 9.3 Reddit Pulse (T17)

**API**: `POST /api/reddit-pulse/scan`  
**Data source**: Reddit public JSON API (no auth required)  
**Window**: 7 days · Up to 10 subreddits × 5 keywords  
**AI**: GPT-4o-mini batch sentiment classification  
**Table**: `reddit_pulse_runs`

Finds real Reddit discussions about the brand/competitors. T39-D adds reply generation: each post card has tone presets (Engaging/Direct/Balanced) and a "Generate Reply" button — GPT writes a contextual, non-spammy reply. The "Discover Questions Customers Ask" panel finds customer questions and the "Make Carousel" button pre-fills T38 with the question as topic.

---

### 9.4 Twitter/X Pulse (T18)

**API**: `POST /api/twitter-pulse/scan`  
**Data source**: Perplexity sonar  

Finds tweets about brand + keywords in the last 7 days. Returns author, text, likes, retweets, replies, sentiment. Viral flag for >1k likes OR >500 retweets. Feeds into: Unified Inbox, Daily Digest, Reply Assistant.

---

### 9.5 YouTube Monitor (T16)

**API**: `/api/youtube-monitor/{channels,scan/:id,history/:id}`  
**Data source**: Perplexity sonar (3–15 recent videos per channel)  
**Tables**: `yt_channels` + `yt_snapshots`

Monitors competitor YouTube channels. Each scan pulls: views, likes, comments, sentiment, summary per video. Channel cards have "💬 Mine" shortcut to YouTube Comment Miner. Feeds into: Weekly Report, Daily Digest.

---

### 9.6 YouTube Comment Miner (T43)

**API**: `POST /api/yt-comment-miner/mine {channelId?, videoUrl?}`  
**Data sources**: Perplexity Sonar (80–120 real comments) + GPT-4o-mini (classification + ideas)  
**Table**: `yt_comment_runs`

Collects real audience comments, classifies into questions/themes/sentiment, generates 6–10 content ideas with title, angle, and "why it works" evidence from comments. "Add to Calendar" button pushes ideas directly to Content Calendar. This is reverse-engineering what your target audience is already asking about.

---

### 9.7 Podcast Monitor (T7)

**API**: `POST /api/podcast-monitor/scan`  
**Data source**: Perplexity sonar  

Finds podcast episodes mentioning the brand or competitors. Returns episode title, platform, sentiment, summary. Feeds into: PR opportunities (guest appearances), Crisis Radar (negative podcast coverage), Content Calendar (respond to podcast topics).

---

### 9.8 Unified Conversation Inbox (T26)

**API**: `/api/unified-inbox/{ingest,list,stats}`  
**Data sources**: Reddit Pulse · Twitter/X Pulse · Review Aggregator · Quora Mining · Glassdoor · Newsletter mentions · Chatbot conversations  
**Table**: `unified_inbox_items`

Aggregates all conversations from all 7 monitoring tools into a single actionable stream. Each item: source badge, sentiment dot, author, content excerpt, status (new/replied/resolved/snoozed), assignee. Filter by source/status/sentiment/keyword. The 7 monitoring tools that previously lived in separate dashboards now flow into one triage queue. Pairs with Reply Assistant for drafting responses.

---

### 9.9 Voice of Customer (T8)

**API**: `POST /api/voc/mine`  
**AI**: GPT-4o-mini  
**Theme kinds**: praise · complaint · question · feature_request · neutral  
**Table**: `voc_runs`

Mines customer language patterns from reviews, support tickets, social mentions. Returns 4–8 themes with representative quotes per theme. Feeds into: Content Calendar (address complaints with content), Landing Page Builder (use customer language in copy), Cold Email Writer (mirror customer vocabulary).

---

### 9.10 Alert Routing (T5)

**API**: `/api/alert-routing`  
**Trigger kinds**: crisis_incident · sov_drop · digest_ready · mention_volume · custom  
**Channels**: Slack + email (Resend)  
**Tables**: `alert_rules` + `alert_dispatches`

Configurable routing: when trigger X fires, send to channel Y at threshold Z. The notification backbone for the entire monitoring layer.

---

## 10. MANAGE — Operations, Planning & Configuration

### 10.1 Product Library (T118)

**API**: `/api/products` (full CRUD)  
**Table**: `products`  
**React component**: `ProductLibrary.tsx`

Structured catalog for all products and services. Each product has tabbed sections:
- **Basics**: name, tagline, category, description, USP (unique selling proposition)
- **Pricing**: model (one-time/subscription/freemium/usage/custom), price, currency
- **Features**: what the product does (tag list)
- **Benefits**: what the customer gets (outcomes, not features)
- **FAQ**: question + answer pairs
- **Objections**: common reasons people don't buy, with responses
- **Cross-sell**: products that complement this one
- **Upsell**: higher-tier products to upgrade customers to

**Relationship**: Product Library is the operational companion to Brand Foundation. While Brand Foundation captures the overall brand narrative, Product Library stores the specific details of each product/service. Feeds into: Cold Email Writer (product-specific outreach), Landing Page Builder (product-page generation), Content Calendar (product-focused posts), Content Modes (ecommerce mode uses product data), AI Acquisition Engine (value proposition per product).

---

### 10.2 Brand Calendar

**Location**: Manage → Brand Calendar  
**10 content categories**: product · education · community · behind-scenes · testimonial · promotion · thought-leadership · seasonal · announcement · entertainment

Visual content planner with 10 predefined brand content pillars. Feeds into: Content Calendar (pulls planned topics), Social Publisher (publishes scheduled content).

---

### 10.3 Budget Board

**Location**: Manage → Budget Board  
**Function**: Track planned vs actual ad spend per channel per month. Budget alerts when overspending.

Feeds into: AI Optimizer (knows budget constraints), Revenue Forecast Engine (uses actual spend in models), True ROAS (spend context for margin calculation).

---

### 10.4 Marketing Projects

**Location**: Manage → Marketing Projects  
**Function**: Kanban project tracking for marketing initiatives. Each project has tasks, assignees, due dates, status.

Feeds into: 7-Day Playbook (generates project tasks automatically from a campaign goal), AI Marketing Agent (T62) goal-based task generation.

---

### 10.5 AI Marketing Agent (T62)

**API**: `POST /api/agent-goals/:id/evaluate` + `POST /api/agent-goals/:id/tasks`  
**AI**: GPT-4o  
**Tables**: `agent_goals` + `agent_tasks`

Set a marketing goal with success criteria and deadline. GPT-4o generates a 5–8 task execution plan with action types (content_creation/campaign_launch/audience_build/SEO/outreach/analysis/competitor_research), priorities, and due dates. "Evaluate Progress" runs a judge LLM that grades the goal (A–F), assesses on-track status, identifies the priority next action, and suggests adjustments. Checking tasks auto-updates goal progress %.

---

### 10.6 Safe Agent (T92)

**Location**: Manage → Safe Agent (propose → approve → execute)  
**Architecture**: Propose → Simulate → Human approval → Execute → Rollback capability  

Every potentially destructive or irreversible action (pause a campaign, delete an audience, change a budget) goes through Safe Agent. GPT-4o proposes the action with full rationale, a simulation preview of the expected outcome, and a risk score. Human approves or rejects. If approved, execution is logged with a rollback plan. This is the autonomous agent layer with human-in-the-loop safety.

---

### 10.7 Brand Foundation

Already covered in Core Systems (Section 3.1).

---

### 10.8 Ask InfoGenie

**Location**: Manage → Ask InfoGenie  
**Function**: Conversational AI over your own platform data. Queries your Postgres data (campaign performance, competitor snapshots, audience segments, content history) and answers in plain English.

---

### 10.9 AI Providers (T79 — Model Comparison)

**API**: `POST /api/model-compare/run`  
**Models**: GPT-4o · GPT-4o-mini (OpenAI) · Claude 3.5 Sonnet · Claude 3 Haiku (Anthropic) · Gemini 1.5 Flash · Gemini 1.5 Pro (Google) · Llama 3.1 8B (Cloudflare)  

Run any prompt on up to 5 models simultaneously. Per-model latency and token tracking. AI judge picks winner and scores each model on quality/creativity/accuracy/conciseness.

---

### 10.10 Investor Mode (T85)

**API**: `POST /api/investor-mode/generate`  
**AI**: GPT-4o  
**Table**: `investor_reports`  
**Public portal**: `/investor/:token` (no auth, unique per report)

AI CFO report generator. Inputs: MRR, ARR, growth rate, CAC, LTV, burn rate, runway months, paying customers, highlights, challenges. Outputs: executive summary, 8-metric dashboard, 12-month forecast, investor narrative, next milestones. Generates a unique shareable investor portal URL. Useful for board decks and investor updates.

---

### 10.11 7-Day Marketing Playbook

**Location**: Manage → 7-Day Marketing Playbook  
**AI**: GPT-4o-mini  

Generates a day-by-day tactical action plan for any campaign goal. Each day has a specific task with platform, copy direction, budget allocation, and expected outcome. Feeds into Marketing Projects (each day becomes a task).

---

### 10.12 Platform API Keys (Admin)

**API**: `GET/PUT /api/admin/platform-keys`  
**Table**: `platform_api_keys` (AES-256-GCM encrypted)  

Admin-only management of InfoGenie's platform-wide API keys (OpenAI, Anthropic, Gemini, etc.). DB overrides env vars. All changes audited (actor + key name, never the value). Non-admins get 403 on platform key endpoints.

---

### 10.13 Web Analytics

**Location**: Manage → Web Analytics  
**Data**: Page views, sessions, acquisition sources, behaviour events from embedded pixel  

First-party analytics. Pairs with: AI Traffic Monitor (T39-B) which specifically tracks AI chatbot referrals (ChatGPT, Perplexity, Claude, Gemini, Copilot, etc.).

---

### 10.14 Heatmaps + Session Replay

**Location**: Manage → Heatmaps + Session Replay  
**Integration**: Microsoft Clarity  

Visual evidence for CRO decisions. Pairs with CRO Lab and Landing Page Builder.

---

## 11. CREATOR STUDIO — AI Video, Persona & Design

### 11.1 AI Video (Storyboard → Frames → MP4)

**Location**: Creator Studio → AI Video  
**Pipeline**: brief → GPT-4o storyboard → frame-by-frame HTML renders → MP4 export  

Generates a complete video concept as a storyboard (scene title, headline, voiceover, visual direction, bullets per scene). Each frame is rendered as an HTML slide. Export to PPTX via T59 (Video → Slides).

---

### 11.2 Social Content Generator

**Location**: Creator Studio → Social Content  
**AI**: GPT-4o-mini  
**Platforms**: Instagram · LinkedIn · Twitter/X · TikTok · Facebook · YouTube

Generates platform-optimised social content (caption, hook, hashtags, CTA, posting time recommendation) from a topic or brand context.

---

### 11.3 UGC Avatar Videos (T60 — AI Persona Studio)

**API**: `POST /api/personas/:id/generate-avatar` + `POST /api/personas/:id/generate-content`  
**AI**: DALL-E 3 (avatar images) + GPT-4o-mini (platform content in persona's voice)  
**Table**: `ai_personas`

Design virtual AI influencer personas with: name, niche, age range, gender, appearance prompt, personality, content voice, posting style. AI Build mode generates a full character from niche + audience description alone. Generate platform-specific content in the persona's exact voice. Links to: Brand Deal Pipeline (T64) — each deal can be linked to a persona.

---

### 11.4 E-commerce Product Video (T63)

**API**: `POST /api/ecom-video/generate`  
**AI**: GPT-4o  
**6 scenes**: hook · scene-by-scene breakdown · CTA  
**5 styles**: lifestyle+demo · UGC authentic review · before-and-after · unboxing · product showcase  

Generates conversion-optimised product video storyboard with shot types, voiceovers, text overlays, durations, and ready-to-post captions. Optionally links to an AI Persona (T60) as presenter.

---

### 11.5 Creative Intelligence (T42)

**API**: `POST /api/creative-intel/analyze {urls[]}`  
**Data sources**: Perplexity Sonar (video metadata) + GPT-4o-mini (pattern analysis)  
**Table**: `creative_intel_runs`

Analyses up to 20 TikTok/YouTube Shorts/Instagram Reels URLs. Per-video: hook type, text overlay, emotion trigger, CTA, music type, length bucket. Aggregate patterns: hook styles %, emotion triggers %, music types %, length buckets %, text overlay %, CTA %, optimal length range, winning formula. Full creative brief with "Open Video Script Generator" handoff.

---

### 11.6 Pitch Deck Builder (T56)

**API**: `POST /api/pitch-deck/generate` + `POST /api/pitch-deck/export-pptx`  
**AI**: GPT-4o  
**Table**: `pitch_decks`

Generates a fully-structured pitch deck as JSON slide objects. `_buildPptx()` converts to PPTX via pptxgenjs: title slide, content slides with speaker notes, bullet points, stat callouts, visual direction placeholders. `/from-storyboard` converts Creator Studio storyboard frames to PPTX.

---

### 11.7 Wireframe Generator (T58)

**API**: `POST /api/wireframe/generate`  
**AI**: Claude (Anthropic) preferred · OpenAI fallback  
**10 page types**: landing · pricing · about · product · checkout · dashboard · blog · contact · login · portfolio  

Returns complete self-contained HTML wireframe with inline styles, grey placeholder boxes, sticky nav, CTA buttons. Rendered in srcdoc iframe. Download as HTML. Useful for rapid prototyping before handing off to designers.

---

### 11.8 AI Persona Studio (T60)

Already covered in 11.3.

---

### 11.9 Brand Deal Pipeline (T64)

**API**: `/api/brand-deals`  
**Table**: `brand_deals` (FK to `ai_personas`)  
**7 kanban statuses**: inquiry → negotiating → accepted → active → completed → rejected → paused  

Tracks influencer brand deals. Each deal: brand, contact, product, deal type (sponsored_post/affiliate/gifted/ambassador/product_review/UGC/other), offered rate, negotiated rate, deliverables, follow-up date, deadline. AI pitch generator (GPT-4o) writes pitch email, follow-up, or counter-offer. Stats: total inquiries, active deals, total earned, pipeline value.

---

### 11.10 Ad Creative Generator (T51)

Already covered in Create section.

---

## 12. How Features Work Together (Integration Map)

### 12.1 The Research → Plan → Create → Publish → Measure Loop

```
Brand Foundation ──────────────────────────────────┐
       │                                            │ (context injected)
       ▼                                            ▼
Competitor Research ──► Battle Cards ──► Content Calendar ──► Social Publisher
(War Room, SERP,        AI Attack Plan   (AI-generated,       (Zernio, 15 platforms)
 Reviews, Glassdoor,    Press Release    30 languages,             │
 Job Board Spy)              │           brand-aware)              │
       │                     │                │                    │
       ▼                     ▼                ▼                    ▼
Pricing Watcher ──► Cold Email ──► WordPress ──► Social Analytics ──► Weekly Report
Change Monitor       Personalizer    (auto-publish)    Amplitude          (PDF email)
       │                 │                                               
       ▼                 ▼                                               
Share of Voice    Lead Finder ──► HubSpot Sync ──► CRM ──► Churn Scorer
Crisis Radar      Lead Aggregator    (auto-sync)           Re-engage Agent
```

### 12.2 The Paid Acquisition Loop

```
Campaign Brief ──► Campaign Launch ──► AI Optimizer ──► Performance Data
     │                   │                   │                  │
     │                   │            (MAB reallocation)        │
     │                   │                   │                  │
     ▼                   ▼                   ▼                  ▼
Audience Builder  Google/Meta/TikTok   Creative Refresh   Attribution Dashboard
Dynamic Segments   Ad Platform APIs    (auto-rewrites)    (multi-touch models)
     │                                                          │
     ▼                                                          ▼
Journey Builder ──► Drip Engine ──► Email Broadcast ──► Email Analytics
(enrol on event)    (nurture)        (bulk send)          (open/click/bounce)
```

### 12.3 The Content Production Pipeline

```
Idea Swipe Feed ──► Content Modes ──► Audio Summary ──► Voiceover MP3
     │                  │                   │
     │          (6 specialised modes)        │
     │                  │                   ▼
Reddit Pulse ──► Carousel Generator   WordPress
(discover           │                  (auto-publish)
 questions)         │
     │              ▼
YT Comment     Content Calendar ──► Social Publisher ──► Analytics
Miner          (scheduled posts)    (15 platforms)    (engagement data)
```

### 12.4 The Intelligence Feedback Loop

```
SERP Tracker ──► SEO Task Manager ──► Content Scorer ──► Auto-Optimize
     │                  │                    │
     ▼                  ▼                    ▼
Keyword Explorer  Web Vitals           Link Prospector ──► Cold Email (outreach)
(find gaps)       (speed fixes)        (find prospects)
     │
     ▼
Content Calendar ──► SEO On-Page Audit ──► Schema Generator
(target keywords)    (17-point check)      (JSON-LD markup)
```

### 12.5 Key Cross-Feature Dependencies

| Feature | Depends On | Enables |
|---|---|---|
| Brand Foundation | — | Every AI prompt across all 119 tiers |
| Crisis Radar | Brand watchlist | Share of Voice, Daily Digest, Alert Routing |
| SERP Tracker | Keyword list, DataForSEO | SEO Task Manager, Content Scorer, Weekly Report |
| Review Aggregator | Competitor list | Deleted Review Detection, Unified Inbox, Battle Cards |
| Dynamic Audiences | Contact database | Drip Engine, HubSpot Sync, Re-engage Agent, Journey Builder |
| Campaign Launch | Ad platform credentials | AI Optimizer, True ROAS, Attribution Dashboard |
| Social Publisher | Zernio OAuth | Social Analytics, Content Calendar scheduling |
| YouTube Monitor | Channel list | Comment Miner, Weekly Report |
| AI Optimizer | Campaign launch | Creative Refresh, MAB reallocation, Weekly Report |
| Benchmark Intelligence | Submitted metrics | GPT-4o gap analysis, action recommendations |
| Product Library | — | Cold Email, Landing Pages, Content Calendar, AI Acquisition |

---

## 13. Complete Connections Reference

### 13.1 AI Language Models

| Model | Provider | Use Cases |
|---|---|---|
| **GPT-4o** | OpenAI | Complex reasoning: Investor Mode, Revenue Forecast, Digital Twin, iROAS, War Room, Benchmark analysis |
| **GPT-4o-mini** | OpenAI | High-volume generation: Battle Cards, Content Modes, Cold Email, Carousels, Video Scripts, Meeting Notes, Headline Tester, all standard tiers |
| **GPT-4o Images (DALL-E 3)** | OpenAI | Image generation: Ad Creatives (T51), AI Persona avatars (T60) |
| **OpenAI TTS (tts-1 / tts-1-hd)** | OpenAI | Audio: Voiceovers (T21), Audio Summaries (T50) |
| **Claude 3.5 Sonnet** | Anthropic | Preferred for Wireframe Generator (T58) — superior HTML generation |
| **Claude 3 Haiku** | Anthropic | Cost-efficient fallback for structured generation |
| **Gemini 1.5 Flash** | Google | AI Suggest fields, Gemini fallback paths |
| **Gemini 1.5 Pro** | Google | Heavy reasoning when OpenAI unavailable |
| **Llama 3.1 8B** | Cloudflare Workers AI | Fast, free inference for eligible tasks |
| **Perplexity Sonar** | Perplexity | Live web research: review aggregation, competitor research, social monitoring, news, hashtag research, influencer research — any task requiring real-time web data |

**Key**: OpenAI + Anthropic keys may be `_DUMMY` placeholders (inactive). Gemini is the active fallback. All tiers implement a `/^_DUMMY/i` gate that rejects placeholder keys and falls through to template fallback. New features should always include a Gemini fallback path.

---

### 13.2 External API Connections

| Service | Env Variable(s) | Used For |
|---|---|---|
| **DataForSEO** | `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | SERP Tracker, Keyword Explorer, Backlink Intel, Link Prospector (SERP step) |
| **Firecrawl** | `FIRECRAWL_API_KEY` | Pricing Watcher, Newsletter Tracker, Change Monitor, Web Extractor, Recipe Scraper, Resilient Tracker (primary), WordPress (SSRF-guarded), Brand Scanner (T52), Content Score (URL fetch), SEO Auditor (HTML fetch fallback) |
| **Zernio** | `ZERNIO_API_KEY` | Social Publisher (15-platform OAuth + post + schedule + analytics) |
| **Apollo.io** | `APOLLO_API_KEY` | Lead Aggregator (database lookup layer) |
| **HubSpot** | `HUBSPOT_PRIVATE_APP_TOKEN` | CRM Sync (contacts + companies), Dynamic Audiences (webhook + Static Lists) |
| **Google PageSpeed Insights** | `GOOGLE_PAGESPEED_API_KEY` | Web Vitals Auditor (T11) — mobile + desktop CrUX + lab data |
| **Google Search API** | `GOOGLE_SEARCH_API_KEY` | Search Intelligence, YouTube data fallback |
| **Google Ads API v17** | `GOOGLE_ADS_DEVELOPER_TOKEN` + OAuth2 credentials | Google Ads Insights (T14), Campaign Launch, AI Optimizer |
| **Google Ads OAuth** | `GOOGLE_ADS_OAUTH_CLIENT_ID` + `_SECRET` | Per-user OAuth Connect → credential vault |
| **Meta Graph API v19.0** | `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` | Meta Ads Insights (T13), Ad Library Spy (T17) |
| **Meta Ads OAuth** | `AUTH_FACEBOOK_CLIENT_ID` + `_SECRET` | Per-user social login + Meta Ads OAuth Connect |
| **TikTok Marketing API v1.3** | `TIKTOK_ACCESS_TOKEN` + `TIKTOK_ADVERTISER_ID` | TikTok Ads Insights (T14) |
| **TikTok Scraper (tikwm)** | None (free) | TikTok Downloader (T20) — stage 1 |
| **TikTok Scraper (RapidAPI)** | `TIKTOK_RAPIDAPI_KEY` | TikTok Downloader (T20) — stage 2 fallback |
| **BuiltWith API** | `BUILTWITH_API_KEY` | Tech Stack Detector (T10) |
| **Resend** | `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | All transactional email (password reset, email verify, weekly report, alert routing, broadcast sends) |
| **Resend Webhooks (Svix)** | `RESEND_WEBHOOK_SECRET` | Email Broadcast event tracking (open/click/bounce/unsub) |
| **Amplitude** | `AMPLITUDE_API_KEY` + `AMPLITUDE_SECRET_KEY` | Amplitude AI Agents (product analytics) |
| **Slack** | `SLACK_WEBHOOK_URL` | Alert Routing, Crisis Radar, Deleted Review Detection, Daily Digest, Auto Operator |
| **Apify** | `APIFY_API_KEY` | Organic Social Monitor (T65 — TikTok scraper), Local Lead Finder (T66 — Google Maps) |
| **Majestic SEO** | API credentials | Backlink Trust Flow, Citation Flow (T115) |
| **SpyFu** | API credentials | Competitor keyword intelligence (T114) |
| **Bing Webmaster** | `BING_WEBMASTER_API_KEY` | Bing search data (T113) |
| **Vapi** | `VAPI_API_KEY` + `VAPI_PHONE_NUMBER_ID` + `VAPI_WEBHOOK_SECRET` | AI Voice Caller |
| **Twilio** | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` | SMS channel |
| **WhatsApp Cloud API** | `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` | WhatsApp channel |
| **Stripe** | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Platform billing |
| **Zernio** | `ZERNIO_API_KEY` | Social Publisher (covered above) |
| **Reddit Public API** | None (no auth) | Reddit Pulse (T17) — public search endpoint |
| **Web Push (VAPID)** | `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` | Browser push notifications |

---

### 13.3 OAuth Flows

| Flow | Scope Required | Used For |
|---|---|---|
| **Google Social Login** | email · profile | User authentication |
| **Facebook Social Login** | email · public_profile | User authentication |
| **Microsoft Social Login** | email · profile | User authentication |
| **Google Ads OAuth (per-user)** | `https://www.googleapis.com/auth/adwords` | Per-user Google Ads credential vault |
| **Meta Ads OAuth (per-user)** | `ads_read` · `ads_management` | Per-user Meta Ads credential vault |
| **Google Workspace OAuth** | Gmail · Drive · Calendar | Google Workspace integration (vault key: `google_workspace`) |
| **Zernio OAuth (per-platform, per-user)** | Platform-specific | Social Publisher account connections (15 platforms) |
| **HubSpot OAuth (optional)** | `crm.objects.contacts.write` · `crm.lists.write` (for audience mirrors) | HubSpot Dynamic Audience mirroring |

---

### 13.4 Internal APIs (Key Endpoints Summary)

| Prefix | Function |
|---|---|
| `/api/auth` | Login, signup, email verify, password reset, OAuth callbacks |
| `/api/admin/platform-keys` | Platform API key management (admin only) |
| `/api/exports/{pptx,pdf,xlsx}` | Report exports |
| `/api/brand-foundation` | Brand context (singleton) |
| `/api/battle-cards` | Competitive battle cards |
| `/api/crisis-radar` | Brand mention monitoring + SoV |
| `/api/serp-tracker` | Google ranking positions |
| `/api/keyword-explorer` | Keyword research |
| `/api/backlinks` | Backlink analysis |
| `/api/meta-insights` | Meta Ads performance |
| `/api/google-ads-insights` | Google Ads performance |
| `/api/tiktok-ads-insights` | TikTok Ads performance |
| `/api/social-publisher` | 15-platform social posting |
| `/api/cold-email` | Cold email sequence generation |
| `/api/email-broadcast` | Bulk email sends + analytics |
| `/api/landing-pages` | Landing page generation + A/B + leads |
| `/api/content-modes` | SEO content generation (6 modes) |
| `/api/content-calendar` | Content calendar generation |
| `/api/autopilot` | Content autopilot schedules |
| `/api/wordpress` | WordPress publishing |
| `/api/audience` | Dynamic audience rules + membership |
| `/api/hubspot-sync` | HubSpot contact/company sync |
| `/api/lead-finder` | B2B lead research |
| `/api/attribution` | Multi-touch attribution models |
| `/api/products` | Product library CRUD |
| `/api/war-room` | AI competitor prediction engine |
| `/api/revenue-forecast` | 90-day revenue simulation |
| `/api/digital-twin` | Business scenario simulation |
| `/api/benchmarks` | Cross-tenant benchmark aggregation |
| `/api/investor-mode` | AI CFO reports + investor portals |
| `/api/agent-goals` | AI Marketing Agent goal loops |
| `/api/auto-operator` | Autonomous marketing operator |
| `/api/safe-agent` | Human-in-the-loop agent actions |
| `/api/model-compare` | Multi-LLM comparison |
| `/api/_debug/permissions` | Permission debug (owner only) |
| `/api/_debug/multitenant` | Tenant debug (owner only) |

---

### 13.5 Required for Production Boot

| Variable | Purpose |
|---|---|
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte AES-256-GCM key (required — platform refuses to start without it) |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Signs `infogenie.sid` cookie |
| `INFOGENIE_API_KEY` | API gate + LLM quota enforcement |

---

## 14. Agency Operating Model Alignment

InfoGenie maps precisely to the 10-step modern marketing agency operating cycle:

| Step | InfoGenie Tools |
|---|---|
| **1. Discover** | Competitor Profiles · War Room · Web Extractor · Real-Time News · Reddit/Twitter Pulse · Review Aggregator · Glassdoor · Job Board Spy · Quora Mining · Dataset Marketplace |
| **2. Strategize** | Battle Cards · AI Attack Plan · 7-Day Playbook · Brand Foundation · Keyword Explorer · Decision Engine · Media Mix Modeler · Digital Twin |
| **3. Create** | Content Calendar · Content Modes · Landing Page Builder · Creator Studio · Cold Email · Video Scripts · Headline Tester · A/B Designer · Schema Generator · Carousel Generator · Idea Feed |
| **4. Launch** | Campaign Launch · Social Publisher (15 platforms) · Acquisition Engine · Drip Engine · Journey Builder · Email Broadcast · WhatsApp · Voice Caller |
| **5. Measure** | Benchmark Intelligence · SERP Tracker · Social Analytics · Meta/Google/TikTok Ads Insights · Web Vitals · SEO Auditor · Email Analytics · Attribution Dashboard |
| **6. Analyse** | Voice of Customer · AI Answer SOV · Share of Voice · Crisis Radar · Revenue Intelligence · Data Provenance · Accessibility Audit · WCAG |
| **7. Optimize** | AI Optimizer (MAB + creative refresh) · Auto Operator · Conversion Boosters · CRO Lab · Safe Agent · iROAS Incrementality |
| **8. Scale** | Media Mix Modeler · Revenue Forecast Engine · Digital Twin · Budget Board · Acquisition Engine |
| **9. Report** | Investor Mode · Weekly Report · Daily Digest · C-Suite Reports · PPTX/PDF/XLSX exports · White-label Reports |
| **10. Learn** | Benchmark Intelligence (data moat) · Experiment Suite · Model Comparison · Content Autopilot (performance → next cycle) |

---

### Coverage vs The 20-Category Marketing Intelligence Framework

| # | Category | InfoGenie Coverage Level |
|---|---|---|
| 1 | Business Intelligence | ✅ Comprehensive (Brand Foundation, Benchmark, Investor Mode, Revenue Intelligence) |
| 2 | Customer Intelligence | ✅ Strong (VoC, Dynamic Audiences, Identity Spine, Churn Scorer, Journey Builder) |
| 3 | Competitor Intelligence | ✅ Deepest category in the platform (15+ tools) |
| 4 | Market Intelligence | ✅ Good (Real-Time News, Trending Topics, Emerging Signals, Dataset Marketplace) |
| 5 | Brand Intelligence | ✅ Strong (SoV, AI Answer SOV, Crisis Radar, Brand Safety, Brand Foundation) |
| 6 | Product Intelligence | ✅ Complete (Product Library T118 + Brand Foundation) |
| 7 | Website Intelligence | ✅ Strong (Web Vitals, SEO Auditor, Heatmaps, CRO Lab, Conversion Recovery) |
| 8 | SEO Intelligence | ✅ Comprehensive (8 dedicated SEO tools) |
| 9 | Content Intelligence | ✅ Strong (7 content creation tools + creative analysis) |
| 10 | Advertising Intelligence | ✅ Strong (Meta/Google/TikTok + AI Optimizer + Benchmarks) |
| 11 | Sales Intelligence | ✅ Good (Lead Finder, Acquisition Engine, Revenue Intelligence, HubSpot) |
| 12 | CRM Intelligence | ⚠️ Intentional gap (syncs TO HubSpot; not a CRM) |
| 13 | Social Media Intelligence | ✅ Strong (15-platform publisher + 5 monitoring tools) |
| 14 | Email Marketing Intelligence | ✅ Complete (Deliverability + Broadcast + Analytics T119) |
| 15 | Reputation Intelligence | ✅ Strong (Reviews + Deleted Detection + Glassdoor + Crisis + Press Release) |
| 16 | Analytics & Attribution | ✅ Complete (T117 multi-touch attribution dashboard) |
| 17 | Operational Intelligence | ✅ Good (Projects, Budget Board, Calendar, Playbook, Approval Workflows) |
| 18 | Creative Intelligence | ✅ Strong (A/B Designer, Headline Tester, Creative Intel, Creative Scoring, Auto Operator) |
| 19 | AI & Automation Intelligence | ✅ Deepest alongside Competitor (Journey Builder, Safe Agent, Auto Operator, Acquisition Engine, AI Optimizer, Model Compare) |
| 20 | Executive Dashboards | ✅ Good (Investor Mode, C-Suite Reports, Weekly Report, Daily Digest, Decision Engine) |

---

*Document generated: July 2026. Covers T1–T119 (119 feature tiers). Platform version aligns with Next.js 15 + Express.js architecture with full React migration complete for all views.*
