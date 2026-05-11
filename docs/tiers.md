# Brandwatch-Killer Suite — Tier Index (T1-T19)

Detailed per-feature notes. All tiers follow the same pattern: strict-JSON LLM prompt + `/^_DUMMY/i` key gate + template fallback + Postgres persistence + `_escapeHtml`/`_safeUrl` frontend builder. Full design history is in git.

## Tier 1 — Foundation (Search, Reports, Influencer CRM)

*   **T1 Search & AI Visibility** (Reach → Search & AI Visibility) · `POST /api/search-intel/{ai-visibility,pulse,images}/*` · multi-LLM (GPT-4o-mini + Claude Haiku + Perplexity + Gemini) brand-mention parser, DataForSEO Labs keyword pulse, GPT-4o-mini vision logo recognition · tables `search_intel_{llm_runs,pulse_runs,images}`.
*   **T1 One-Click Reports** (📊/📄/📈 on Search & AI Visibility) · `GET /api/exports/{pptx|pdf|xlsx}/{search-intel|campaigns}` · `services/exports/data_sources.js` declarative pipeline · pptxgenjs / exceljs / pdfkit.
*   **T1 Influencer CRM** (Reach → Influencer CRM) · `/api/influencers` REST + `POST /:id/draft-email` (GPT-4o-mini) · tables `influencers` + `influencer_outreach` · status pipeline prospect→contacted→negotiating→active.

## Tier 2 — Crisis, Battle Cards, Trends

*   **T2 Crisis Radar** (Monitor → Crisis Radar) · `/api/crisis-radar/{watchlist,incidents,snapshots,run-now}` · 6h cron, baseline = 7-snapshot moving avg, Slack alerts via SSRF-guarded webhook · tables `crisis_{watchlist,snapshots,incidents}`.
*   **T2 Battle Cards** (Compete → Battle Cards) · `POST /api/battle-cards/generate` (GPT-4o-mini, 4 strengths + 4 weaknesses + 3 moves + 4 counter-plays) · table `battle_cards`.
*   **T2 Trending Topics** (Monitor → Trending Topics) · `POST /api/trends/detect` (Perplexity sonar, 6-10 7-day topics) · table `trend_runs`.

## Tier 3 — Share of Voice, Influencer Discovery

*   **T3 Share of Voice** (Compete → Share of Voice) · `GET /api/sov/{series,targets}` · auto-populated by Crisis Radar 6h cron · table `sov_snapshots` · Chart.js stacked-area.
*   **T3 Influencer Discovery** (Reach → Influencer Discovery) · `POST /api/discovery/influencers` (Perplexity, ≥5k followers) · one-click "+ Add to Influencer CRM".

## Tier 4 — Daily Digest, Reply Assistant

*   **T4 AI Daily Digest** (Plan → Daily Digest) · `POST /api/digest/{run-now,/:id/send}` + 24h cron per watchlist brand (GPT-4o-mini, sections kind=warning|win|action|highlight) · table `digest_runs` · Slack send.
*   **T4 Reply Assistant** (Reach → Reply Assistant) · `GET /api/reply-assistant/inbox` + `POST /draft` (GPT-4o-mini, tone allowlist) · ranked top-30 mentions, long + 240ch X variant.

## Tier 5 — Press Releases, Alert Routing

*   **T5 Press Release Generator** (Plan → Press Releases) · `POST /api/press-release/generate` (GPT-4o-mini, kind=crisis_response|product_launch|milestone|counter_competitor|partnership|custom) · optional `from_incident_id`/`from_battle_card_id` hydration.
*   **T5 Smart Alert Routing** (Monitor → Alert Routing) · `/api/alert-routing` REST + `POST /test/:id` · trigger kinds `crisis_incident|sov_drop|digest_ready|mention_volume|custom` · channels Slack + email (Resend) · tables `alert_{rules,dispatches}`.

## Tier 6 — Backlinks, Content Calendar

*   **T6 Backlink Intel** (Reach → Backlink Intel) · `POST /api/backlinks/{summary,referring-domains}` (DataForSEO `/v3/backlinks/*/live`).
*   **T6 Content Calendar** (Plan → Content Calendar) · `POST /api/content-calendar/generate` (GPT-4o-mini, 1-30 days, channel allowlist 8) · table `content_calendar_runs` · CSV export.

## Tier 7 — Podcasts, A/B Designer

*   **T7 Podcast Monitor** (Monitor → Podcast Monitor) · `POST /api/podcast-monitor/scan` (Perplexity sonar, episodes with sentiment + platform) · table `podcast_monitor_runs`.
*   **T7 A/B Designer** (Plan → A/B Test Designer) · `POST /api/ab-designer/generate` (GPT-4o-mini, 8 element_kinds, 10 angles, length-aware) · table `ab_designer_runs`.

## Tier 8 — Voice of Customer, Pricing Watcher

*   **T8 Voice of Customer** (Monitor → Voice of Customer) · `POST /api/voc/mine` (GPT-4o-mini, 4-8 themes kind=praise|complaint|question|feature_request|neutral) · table `voc_runs`.
*   **T8 Pricing Watcher** (Compete → Pricing Watcher) · `/api/pricing-watch/{targets,scan/:id,snapshots/:id}` · Firecrawl `/v1/scrape` + GPT-4o-mini extract · tables `pricing_watch_{targets,snapshots}`.

## Tier 9 — Email Auditor, Landing Pages

*   **T9 Email Deliverability Auditor** (Reach → Email Auditor) · `POST /api/deliverability/audit` (pure DNS — MX + SPF + DKIM 19 selectors + DMARC + MTA-STS + BIMI) · weighted A-F grade.
*   **T9 Landing Page Builder** (Plan → Landing Page Builder) · `POST /api/landing-pages/generate` (GPT-4o-mini, hero + 4-6 features + 3-4 steps + 2-3 testimonials + 4-6 FAQs + final CTA) · `_renderHtml(content,{accent})` server-side responsive HTML · table `landing_pages` · sandboxed iframe preview.

## Tier 10 — Tech Stack, Cold Email

*   **T10 Tech Stack Detector** (Compete → Tech Stack Detector) · `POST /api/tech-stack/{detect,compare}` (BuiltWith Free API, normalised categories + live/dead pills, multi-domain matrix up to 5).
*   **T10 Cold Email Writer** (Reach → Cold Email Writer) · `POST /api/cold-email/generate` (GPT-4o-mini strict-JSON, 1-5 step sequence, tone allowlist, template fallback) · table `cold_email_runs`.

## Tier 11 — Web Vitals, Lead Finder

*   **T11 Web Vitals Auditor** (Compete → Web Vitals Auditor) · `POST /api/web-vitals/audit {url}` (Google PageSpeed Insights v5, mobile+desktop parallel, lab + CrUX field + top 6 opportunities).
*   **T11 B2B Lead Finder** (Reach → B2B Lead Finder) · `POST /api/lead-finder/search` (Perplexity sonar, never invents emails, max 2/company, `window._lfLeads` cache for HubSpot push) · table `lead_finder_runs`.

## Tier 12 — SERP Tracker, HubSpot Sync

*   **T12 SERP Position Tracker** (Compete → SERP Tracker) · `/api/serp-tracker/{keywords,scan/:id,scan-all,history/:id}` (DataForSEO `/v3/serp/google/organic/live/regular`, 15-country location_code map, exact-domain match) · tables `serp_tracker_{keywords,runs}`.
*   **T12 HubSpot Sync** (Reach → HubSpot Sync) · `/api/hubspot-sync/{test,push-lead,push-influencer,push-bulk,recent-contacts}` (`HUBSPOT_PRIVATE_APP_TOKEN` Bearer, batch upsert by email idProperty, scope-error hint).

## Tier 13 — Meta Ads, Keyword Explorer

*   **T13 Meta Ads Insights** (Optimize → Meta Ads Insights) · `/api/meta-insights/{test,account-summary,campaigns,top-ads}` (Graph API v19.0 `/act_{id}/insights`, allowlisted date presets, ROAS = revenue/spend, friendly `ads_read` hint).
*   **T13 Keyword Explorer** (Plan → Keyword Explorer) · `POST /api/keyword-explorer/explore` (DataForSEO Labs `keyword_overview` + `keyword_ideas` parallel, 15 countries, KD/CPC/intent, 5-50 ideas) · table `keyword_explorer_runs`.

## Tier 14 — Google Ads, TikTok Ads

*   **T14 Google Ads Insights** (Optimize → Google Ads Insights) · `/api/google-ads-insights/{test,account-summary,campaigns,top-ads}` (Google Ads API v17 GAQL `searchStream`, OAuth2 refresh-token flow with in-memory access-token cache, allowlisted date presets, friendly errors for dev-token / customer-id / OAuth client / refresh-token issues, optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID` for MCC).
*   **T14 TikTok Ads Insights** (Optimize → TikTok Ads Insights) · `/api/tiktok-ads-insights/{test,account-summary,campaigns,top-ads}` (TikTok Marketing API v1.3 `/report/integrated/get/`, `Access-Token` header, date-preset → start/end YYYY-MM-DD mapping, `AUCTION_ADVERTISER|CAMPAIGN|AD` data levels, friendly scope/advertiser-id hints).

## Tier 15 — Social Publisher + Analytics

*   **T15 Social Publisher** (Reach → Social Publisher) · `/api/social-publisher/{test,profiles,accounts,connect-url,post,posts,schedule-calendar,analytics}` (Zernio API v1, `ZERNIO_API_KEY` Bearer, 15-platform allowlist twitter|instagram|facebook|linkedin|tiktok|youtube|pinterest|reddit|bluesky|threads|googlebusiness|telegram|snapchat|whatsapp|discord, OAuth-via-authUrl, post/schedule with mediaUrls + scheduledFor, bulk Content-Calendar scheduling, friendly 401/quota/profile/account hints).
*   **T15 Social Analytics** (Reach → Social Analytics) · `GET /api/social-publisher/analytics?profileId&range=7d|30d|90d` aggregates per-account engagement (posts/impressions/likes/comments/shares/clicks/engagement-rate/followers/follower-growth) + top post per account · strict per-account post matching (account-ID first, platform-fallback only when platform is unique on profile) · unified engagement extractor (analytics|engagement|stats keys) · tries dedicated `/accounts/:id/analytics` then `/analytics?accountId=` then derives from `/posts`.

## Tier 16 — Email Personalizer, YouTube, Weekly Report

*   **T16 Email Personalizer** (Reach → Email Personalizer) · `POST /api/email-personalizer/{personalize,bulk}` (Firecrawl `/v1/scrape` site research + GPT-4o-mini strict-JSON rewrite per lead, max 25 leads/batch, tokens [NAME]/[FIRST_NAME]/[COMPANY]/[ROLE]/[WEBSITE], one-click pull from `window._lfLeads`, CSV export, template fallback when AI/Firecrawl unavailable).
*   **T16 YouTube Monitor** (Monitor → YouTube Monitor) · `/api/youtube-monitor/{test,channels (GET/POST/DELETE),scan/:id,history/:id}` (Perplexity sonar pulls 3-15 recent videos per channel with views/likes/comments/sentiment/summary, no Google API key needed) · tables `yt_channels` + `yt_snapshots`.
*   **T16 Weekly Report** (Plan → Weekly Report) · `/api/weekly-report/{test,subs (GET/POST/DELETE),runs,preview,pdf,send}` · 7-day auto-cron emails PDF via Resend to all enabled subs · sections aggregate Crisis Radar incidents, SoV 7d-avg, mention volume, press releases, VoC themes, trends, optimizer decisions and YouTube activity from existing tier tables · graceful "no data" sections · uses existing `services/exports/pdf_report.js` `streamPdf()` · cron uses `FOR UPDATE SKIP LOCKED` claim-then-send for safe multi-process · tables `weekly_report_subs` + `weekly_report_runs`.

## Tier 17 — Reddit, Ad Library, Newsletter, Meeting Notes, Headlines

*   **T17 Reddit Pulse** (Monitor → Reddit Pulse) · `POST /api/reddit-pulse/scan` (Reddit public JSON `/r/{sub}/search.json` no-auth, 7-day window, up to 10 subreddits × 5 keywords, batch GPT-4o-mini sentiment classification) · table `reddit_pulse_runs`.
*   **T17 Ad Library Spy** (Compete → Ad Library Spy) · `POST /api/ad-library/{meta,tiktok}` (Meta Graph API v19.0 `/ads_archive` with `META_ACCESS_TOKEN` requiring ads_read scope, TikTok via Perplexity sonar scraping `library.tiktok.com/ads`, friendly scope/rate-limit hints).
*   **T17 Newsletter Tracker** (Compete → Newsletter Tracker) · `/api/newsletter-tracker/{targets (GET/POST/DELETE),scan/:id,history/:id}` (Firecrawl scrape archive URL + GPT-4o-mini extracts subject/sent_date/preview/url for last 10 issues, supports Substack/Beehiiv/Mailchimp) · tables `newsletter_targets` + `newsletter_issues`.
*   **T17 Meeting Notes** (Reach → Meeting Notes) · `POST /api/meeting-notes/summarize` (GPT-4o-mini strict-JSON, returns summary + key_points + action_items + BANT scores 0-10 each + overall_score 0-100 + deal_stage + sentiment + risks + objections + next_step, optional contact context).
*   **T17 Headline Tester** (Plan → Headline Tester) · `POST /api/headline-tester/test-headline` (GPT-4o-mini, scores original headline 0-100 + generates 3-10 variants across 10 kinds curiosity|negative|question|listicle|urgent|specific_number|contrarian|social_proof|how_to|outcome, each with patterns_hit + reasoning, sortable by score).

## Tier 18 — Reviews, Churn, Twitter, Job Boards, Video Scripts

*   **T18 Review Aggregator** (Compete → Review Aggregator) · `POST /api/review-aggregator/{scan,compare,runs}` (Perplexity sonar pulls reviews from Trustpilot/G2/Google/Capterra/TripAdvisor, returns avg_rating + sentiment-tagged reviews + total counts, compare mode 2-4 brands side-by-side) · table `review_aggregator_runs`.
*   **T18 Churn Scorer** (Reach → Churn Scorer) · `POST /api/churn-scorer/{score,bulk,scores}` (GPT-4o-mini scores each contact 0-100 churn risk with risk_level + signals + recommendation, bulk up to 25 contacts, UNIQUE on email upserts on conflict) · table `churn_scores`.
*   **T18 Twitter/X Pulse** (Monitor → Twitter Pulse) · `POST /api/twitter-pulse/scan` (Perplexity sonar searches X for brand+keywords last 7d, returns tweets with author/text/likes/retweets/replies/sentiment + viral flag for >1k likes OR >500 retweets) · table `twitter_pulse_runs`.
*   **T18 Job Board Spy** (Compete → Job Board Spy) · `POST /api/job-board-spy/scan` (Perplexity sonar pulls open roles from LinkedIn+Indeed+careers page, breaks down by department, generates 2-5 strategic signals about company direction from hiring patterns) · table `job_board_runs`.
*   **T18 Video Script Generator** (Plan → Video Scripts) · `POST /api/video-script/generate` (GPT-4o-mini, platforms tiktok|reels|shorts|linkedin, 6 tones, 15-180s, 1-5 variants per call, each with hook/body lines (spoken+onscreen+cue)/cta/viral_pattern/hashtags).

## Tier 19 — Chatbot, Glassdoor, Quora

*   **T19 Chatbot Builder** (Reach → Chatbot Builder) · `POST /api/chatbot/{generate,configs (GET),configs/:id}` (GPT-4o-mini, 5 tones friendly|professional|playful|concise|enthusiastic, returns greeting + 8-15 FAQ Q&A entries with kind tags + fallback + lead-capture fields + suggested quick replies + accent color, generates copy-pasteable embed snippet with copy-to-clipboard) · table `chatbot_configs`.
*   **T19 Glassdoor Sentiment** (Compete → Glassdoor Sentiment) · `POST /api/glassdoor/{scan,runs}` (Perplexity sonar pulls overall_rating + ceo_approval + recommend_pct + reviews with pros/cons/role/tenure/sentiment + top_complaints + top_praises + 2-5 culture_signals strategic insights) · table `glassdoor_runs`.
*   **T19 Quora Mining** (Reach → Quora Mining) · `POST /api/quora-mining/{mine,runs}` (Perplexity sonar finds 8-15 most-engaged questions with answer_count + view_count + intent classification informational|comparison|recommendation|complaint|how-to|definition + top_answer_summary + suggested_response_angle for the user's brand) · table `quora_runs`.

## Tier 20 — TikTok Downloader

*   **T20 TikTok Downloader** (Compete → TikTok Downloader) · `/api/tiktok-downloader/{test,parse,recent,proxy}` · accepts up to 25 TikTok URLs per request (tiktok.com / vm.tiktok.com / vt.tiktok.com — short links auto-resolve), resolves via tikwm.com public no-auth API in parallel, returns no-watermark mp4 URL + cover + caption + hashtags + music + author + views/likes/comments/shares/duration · `/proxy?url=` streams the mp4 through origin with strict allow-list (tikwm.com / tiktokcdn.com / tiktokv.com) so the browser gets a clean `Content-Disposition: attachment` save-as · table `tiktok_downloads`. Pairs with T17 Ad Library Spy — turn discovered competitor URLs into a local swipe file.

## Cross-cutting — Dynamic Audiences

*   **Dynamic Audiences (Reach → Dynamic Audiences)**: Drip-style real-time, rule-based contact segments. Phase 1 = builder UI + live preview. Phase 2 = 15-min sweep cron + HubSpot webhook (HMAC-validated when `HUBSPOT_WEBHOOK_SECRET` is set) + members drill-in. Phase 3 = bind any audience to a Drip email sequence — auto-enrol on join, auto-unsubscribe on leave (only enrollments tagged with the binding id are touched; manual enrollments untouched; mutations under `global._dripStore.lock`). Phase 4A = mirror membership to a HubSpot Static List (auto-creates the list via `POST /crm/v3/lists` on first save when `crm.lists.write` scope is granted; pushes joins/leaves via `/crm/v3/lists/{id}/memberships/add|remove`). Phase 4B = bind a churn-risk audience to a single-touch AI win-back: on join, fires a 1-step drip enrollment with the stored variant (regeneratable via `/api/reengage/generate`), tagged `audienceBindingId='reng:<bindingId>'` so onLeave can selectively auto-unsubscribe just the system-fired win-backs and never manual ones. All three bridges (drip, hs-list, re-engage) run after the membership write commits and are fanned out per-contact in parallel with per-target try/catch.

## Tier 21 — Voiceover

*   **T21 Voiceover** (Plan → Voiceover) · `/api/voiceover/{test,generate,list}` · POST `/generate` {text ≤4000 chars, voice ∈ alloy/echo/fable/onyx/nova/shimmer, model ∈ tts-1/tts-1-hd, label?} → calls `openai.audio.speech.create`, writes mp3 to `uploads/voiceovers/<ts>_<rand>.mp3`, returns `mp3Url` for direct browser playback + download · standard checks: `/^_DUMMY/i` key gate (returns 400 with friendly message), 4000-char limit, character-count display, mkdir-recursive on first call · table `voiceover_runs` (id, label, voice, model, char_count, mp3_url, created_at) · history widget shows last 10 with inline `<audio>` players. Pairs with T18 Video Script Generator — paste a generated script, pick a voice, get an mp3.

## Tier 22 — SEO On-Page Auditor

*   **T22 SEO On-Page Auditor** (Compete → SEO On-Page Auditor) · `/api/seo-auditor/{test,audit,runs}` · POST `/audit` {url} → SSRF-guarded fetch (10s timeout, 2MB cap, real-browser UA, follows up to 5 redirects), regex-parses HTML for 17 page-level checks + 2 root-level probes (robots.txt, sitemap.xml HEAD): https · title 30-60ch · meta-description 70-160ch · single H1 · viewport · html lang · canonical · OG (title/description/image) · twitter:card · JSON-LD · image alt-text % · noindex blocker · favicon · word count ≥600 · ≥3 internal links · no mixed content · H1 not empty · robots.txt · sitemap.xml. Each check is weighted (2-10 pts); pass = full pts, warn = ½, fail = 0. Total normalised to 0-100 with grade A (≥90) / B (≥80) / C (≥70) / D (≥60) / F. Frontend renders a colour-coded score banner + per-check cards sorted fail→warn→pass with the prioritised fix copy. Table `seo_audit_runs` (id, url, score, grade, checks JSONB, summary JSONB, created_at). `runAudit(url)` exported for reuse by T23. Pairs with T11 Web Vitals — speed + SEO twin tools.

## Tier 23 — Embeddable Audit Widget

*   **T23 Embeddable Audit Widget** (Compete → Embeddable Audit Widget) · `/api/seo-widget/{test,sites,sites/:id,sites/:id/leads,embed/:siteId.js,audit/:siteId}` · `POST /sites` {name, accent (#hex), ctaText, ownerEmail?} → returns `id` (`sw_<hex16>`) + paste-once snippet `<div id="infogenie-seo-widget"></div><script src=".../api/seo-widget/embed/sw_xxx.js" async></script>` · `GET /embed/:siteId.js` (public, CORS *, 5-min cache) returns IIFE that injects a styled inline form (URL + email + accent-coloured CTA button) into `#infogenie-seo-widget` (or appends to body) and POSTs to `/audit/:siteId` · `POST /audit/:siteId` {url, email?} runs `runAudit(url)` from T22, persists into `seo_audit_runs`, persists email→site mapping into `seo_widget_leads`, returns `{score, grade, teaser:{passed,warned,failed}, emailQueued, fullReport}` (full check details only when valid email present — gates lead capture) · `GET /sites/:id/leads` returns last 200 (email, url, score, grade, when) · CORS preflight (OPTIONS) handled · all input sanitised (`_safeColor`, `_safeText`, `_emailValid`). Frontend lists every widget with its embed snippet (one-click copy), live lead count, leads drill-in table, and delete (cascades leads). Built directly on T22 — pure lead-gen play for agencies running their own marketing site.

## Tier 24 — SEO Task Manager / Fix Tracker

*   **T24 SEO Task Manager** (Compete → SEO Task Manager) · `/api/seo-tasks/{test,list,stats,import-from-audit,reaudit,:id (PATCH/DELETE)}` · table `seo_tasks` (id, source='seo_audit', source_url, check_id, label, message, fix, priority 1|2|3, status open|in_progress|done|snoozed|wont_fix, assignee, due_date, snoozed_until, notes, audit_run_id, created_at, updated_at, closed_at) with idx on (status, priority, created_at) + (source_url, check_id). `POST /import-from-audit {auditRunId}` reads `seo_audit_runs.checks` JSONB, filters status∈warn|fail, creates one row per issue, dedupes against any existing task for same url+check_id whose status NOT IN done|wont_fix · priority derived from check (fail+weight≥6 → P1, fail or warn+weight≥6 → P2, else P3). `POST /reaudit {url}` re-runs `runAudit(url)` from T22, bulk-updates open tasks where the same check_id is now passing → `status='done', closed_at=now()` with auto-note appended; persists the new audit run; imports any newly-failing checks. `PATCH /:id` validates status enum, accepts priority/assignee/dueDate/snoozedUntil/notes, sets `closed_at` only when transitioning to done|wont_fix. SEO Auditor results page now shows a "📋 Add to Task Manager" button bound to the returned `runId`. Pairs with T22 — turns the audit from a snapshot into a living to-do list.

## Tier 25 — Schema.org / JSON-LD Generator

*   **T25 Schema.org / JSON-LD Generator** (Compete → Schema Generator) · `/api/schema-generator/{test,types,generate,save,list,:id (DELETE)}` · table `schema_blocks` (id, name, type, fields JSONB, jsonld TEXT, created_at) · 8 types served from a single `TYPES` manifest exposing field key/kind/required/placeholder/help/subFields → drives a fully dynamic frontend form. Supported: **Organization** (name*, url*, logo, sameAs[], phone, email, description) · **Article** (headline*, authorName*, datePublished*, dateModified, image, description, publisher, publisherLogo) · **Product** (name*, image, description, brand, sku, price+currency, availability, ratingValue+ratingCount → AggregateRating + Offer) · **FAQPage** (questions[]{question, answer} → mainEntity[Question/Answer]) · **LocalBusiness** (name*, address fields, geo lat/lng, priceRange, openingHours[]) · **BreadcrumbList** (items[]{name, url} → ListItem position) · **Event** (name*, startDate*, endDate, location+address, image, description, offer URL/price) · **Recipe** (name*, image, description, prep/cook time ISO 8601, recipeYield, ingredients[], instructions[] → HowToStep). `POST /generate {type, fields}` validates required fields, builds the @context/@type object, recursively strips empty values, returns `{jsonld: '<script type=\"application/ld+json\">...</script>', object}`. `POST /save` persists named blocks. Frontend has type-pill picker, dynamic per-type form with repeat groups (+/− rows), live JSON-LD preview, copy-to-clipboard, save/list/delete saved blocks. Pairs with T1 AI Visibility — proper schema is what ChatGPT/Perplexity/Gemini parse to cite your site.

## Tier 20 update — RapidAPI fallback

*   **T20 TikTok Downloader** now two-stage: stage 1 = tikwm.com (free, no auth), stage 2 = `tiktok-scraper7.p.rapidapi.com` via `TIKTOK_RAPIDAPI_KEY` env (paid ~$10/mo, much higher rate limits, survives WAF blocks). Stage 2 only attempted on stage 1 failure AND when key is set. Both adapters normalise to identical response shape via `_normalize()` so frontend is unchanged; `via` field reports which resolver served the result. `/test` endpoint surfaces both resolver states.

## Tier 26 — Unified Conversation Inbox

*   **T26 Unified Conversation Inbox** (Compete → Unified Inbox) · `/api/unified-inbox/{test, ingest, list, stats, :id (PATCH/DELETE)}` · table `unified_inbox_items` (id, source, source_id, source_url, author, title, content, sentiment, score, status new|replied|resolved|snoozed, assignee, tags JSONB, notes, raw JSONB, occurred_at, ingested_at, updated_at, handled_at) with `UNIQUE(source, source_id)` for race-safe dedup + indexes on (status,ingested_at), (source,ingested_at), (sentiment). `POST /ingest` scans the most-recent 20 runs of each conversation source — Reddit Pulse (T17), Twitter/X Pulse (T18), Review Aggregator (T18), Quora (T19), Glassdoor (T19), Newsletter mentions (T17), Chatbot conversations (T19) — normalises every payload via `_safeMap` (per-item try/catch so one bad row never aborts a batch) into `{source, source_id, source_url, author, title, content, sentiment, score, raw, occurred_at}` and bulk-upserts via `INSERT ... ON CONFLICT DO NOTHING`. `_sentiment()` coerces numeric (-1..1), short-string (`pos`/`neg`/`neu`) and rating-derived values; `_toDate()` accepts ISO strings, unix epoch seconds and Date objects, returning `null` for garbage. `GET /list` filters by source/status/sentiment/q with allowlist-validated enum filters and `ILIKE`-on-lower content search, all bound parameters (no string interpolation of user input). `PATCH /:id` validates the status enum, sets `handled_at` when transitioning to replied|resolved (and clears it on transition back to new), 404s on missing id. Frontend builder lives at the tail of `app.js` — filter bar (search + source + status + sentiment dropdowns) → status-coloured row list with sentiment dot, source badge, author, content excerpt, "open ↗", inline status select, 📝 Note, 🗑 Delete. Sets up the foundation for #2 (multi-user/role assignment per inbox item) without committing to that build yet. **Outcome:** the 7 monitoring tools that previously lived in separate dashboards now flow into one actionable stream — never lose track of who said what or whether you replied.

## Tier 27 — Conversion Boosters

*   **T27 Conversion Boosters** (Compete → 🚀 Conversion Boosters) · `services/conversion_boosters/{schema,api}.js` · two paste-once embeddable widgets sharing the same admin/storage layer:
    *   **Social Proof popup** — rotating "Sarah from Cape Town just signed up" toasts. Settings: `position` (4 corners, allowlisted), `intervalSeconds` (4-120, clamped), `displaySeconds` (2-30), `accent` (color regex), `items[]` (per-row Name/Location/Action/When, length-clamped, max 50).
    *   **Exit Intent popup** — desktop mouseleave-top + mobile rapid-scroll-up trigger. Modal with email input + CTA. Settings: `headline`, `subheadline`, `ctaText`, `accent`, `dismissCookieDays` (0-365), `redirectUrl` (URL-validated, http/https only).
*   **Tables**: `cb_widgets (id, type, name, settings JSONB, owner_email, created_at, updated_at)` + `cb_events (id, widget_id FK→cb_widgets ON DELETE CASCADE, event_type view|dismiss|lead, email, data JSONB, ip_hash, ua, created_at)` + indexes on `(widget_id, created_at DESC)` and `(widget_id, event_type)`.
*   **Routes**:
    *   Admin (auth-gated when `INFOGENIE_API_KEY` is set): `GET /test`, `GET /defaults`, `GET /widgets`, `POST /widgets`, `PATCH /widgets/:id`, `DELETE /widgets/:id`, `GET /widgets/:id/events`. PATCH/DELETE 404 on missing id. PATCH dynamically composes SET clause from a fixed allowlist of column names with all data parameterised — no SQLi.
    *   Public (allowlisted in `_AUTH_PUBLIC_API_PATHS`, CORS `*`, OPTIONS preflight handled): `GET /embed/:id.js` (5-min cache, IIFE renderer, no globals leaked, settings injected via `JSON.stringify` then DOM-built with `textContent` — no innerHTML on user data), `POST /event/:id` (view|dismiss ping, body capped to 4kb), `POST /lead/:id` (email validated by regex, captured into `cb_events`).
*   **Rate limiting**: `_rlKey()` uses `req.socket.remoteAddress` ALONE, never `req.ip`. server.js sets `trust proxy: true` which makes `req.ip` equal whatever XFF the client sends — fully attacker-controlled. Socket address is the actual TCP peer and unforgeable. Caps: leads 5/IP/5min + 60/widget/5min, events 30/IP/min + 600/widget/min. Verified: 8 sequential lead submits with rotating fake `X-Forwarded-For` headers → first 5 succeed, 6-8 hit 429.
*   **Inbox bridge**: every successful `/lead/:id` submit also `INSERT ... ON CONFLICT DO NOTHING` into `unified_inbox_items` with `source='social_proof'|'exit_intent'`, `source_id='cb-<widget>-<ts>-<rand>'`, so leads land in the T26 Unified Inbox stream automatically. Wrapped in try/catch in case the unified_inbox table is missing — non-fatal.
*   **Frontend builder** (tail of `app.js`): two type-pills (📣 Social Proof / 🚪 Exit Intent) → form with type-specific fields → list of existing widgets with view/lead counters, copy-to-clipboard embed snippet, edit/delete/activity-toggle. Activity panel shows view/lead/dismiss counters + last 200 events with type-coloured row stream. Cache buster bumped to `v=20260511AF`.
*   **Outcome**: paste one `<script src="…/api/conversion-boosters/embed/<id>.js" async></script>` tag onto any external marketing page → social proof toasts or exit-intent modal renders → captured emails flow into Unified Inbox + cb_events. Same architecture as T23, ready for follow-on work (campaign-tagged variants, A/B split, dynamic items pulled from `contacts` table).

---

## T28 — White-Label Reports

*   **Route**: `Reach › 🎨 White-Label Reports` (`view-white-label`, builder `buildWhiteLabel` at tail of `app.js`).
*   **Endpoints**: `GET /api/white-label/profile` · `PUT /api/white-label/profile` · `DELETE /api/white-label/profile` · `GET /api/white-label/preview/{pdf,pptx,xlsx}` (renders a sample report so the user can preview their theme without regenerating real data).
*   **Storage**: single global brand profile in `kv_store` under key `white_label.brand_profile`. No new schema. Shape: `{enabled, agencyName, logoDataUrl, primaryColor, accentColor, textColor, footerText, hideInfoGenieBranding}`. All inputs server-side normalised — colours regex-validated `#RRGGBB`, agency name capped at 80 chars, footer at 200, logo data URL must match `data:image/(png|jpeg|jpg|svg+xml);base64,...` and ≤350,000 chars (~256KB).
*   **Plumbing**: `services/exports/{pptx_report,pdf_report,xlsx_report}.js` each gained an optional final `brand` arg. Cover backgrounds, section/header bars, body text colour, footer line and (optionally) the cover logo are all parameterised. Defaults are unchanged InfoGenie navy/purple when `brand` is null. `services/exports/api.js` lazy-loads the white_label module, calls `getBrand()`, and passes the result through only when `brand.enabled` is true. Filename stem is also slugified from `agencyName` so exports become e.g. `acme-marketing-attack-plan-2026-05-11.pdf`.
*   **PDF logo caveat**: pdfkit can render PNG/JPG only — the PDF exporter rejects `data:image/svg+xml` logos silently. PPTX/XLSX accept any of the four formats.

## T29 — Multi-Page SEO Crawler

*   **Route**: `Reach › 🕸️ Site SEO Crawler` (`view-seo-crawler`, builder `buildSeoCrawler`).
*   **Endpoints**: `POST /api/seo-crawler/run {url, maxPages}` (returns `{id}` and starts BFS in background) · `GET /api/seo-crawler/runs` (list, 40 most recent) · `GET /api/seo-crawler/runs/:id` (full detail with `pages[]` + `live{progress, errors, status}` for in-flight runs) · `DELETE /api/seo-crawler/runs/:id`.
*   **Storage**: `seo_crawl_runs(id, root_url, max_pages, page_count, avg_score, site_grade, status, error, started_at, completed_at)` + `seo_crawl_pages(id BIGSERIAL, run_id REFERENCES, url, score, grade, summary JSONB, checks JSONB)` with index on `(run_id, score)`.
*   **Crawl loop**: 4 concurrent workers BFS-pop from a shared queue. Each iteration: SSRF re-validate → call `runAudit(url)` from T22 (which does its own fetch + 19-check audit) → INSERT row immediately so the user sees pages stream in via polling → if more pages still wanted, fetch HTML once more and `_extractLinks` (regex-based, same-host-only, dedupe via Set, drops asset extensions). Hard caps: `HARD_MAX_PAGES=100` · `HARD_TIMEOUT_MS=5min` · `CONCURRENCY=4` · queue buffer `(visited+queue) < maxPages*3`.
*   **Aggregation**: avg_score = mean of per-page scores, site_grade from same A-F bands as T22. Final status `completed` or `partial` (timeout/cap hit).
*   **In-memory `_runs` Map** holds live progress so the GET endpoint can return `live.progress` between DB writes — read-only side-channel keyed by unique `runId`, no cross-run contention.

## T30 — GEO Audit (Generative Engine Optimization)

*   **Route**: `Reach › 🤖 GEO Audit` (`view-geo-audit`, builder `buildGeoAudit`).
*   **Endpoints**: `POST /api/geo-audit/run {url}` · `GET /api/geo-audit/runs` (30 most recent) · `GET /api/geo-audit/runs/:id`. Module also exports `runGeoAudit(url)` for reuse.
*   **Storage**: `geo_audit_runs(id, url, score, grade, summary JSONB, checks JSONB, created_at)` with index on `(url, created_at DESC)`.
*   **12 weighted checks summing to 100**:
    1. **Question-style H2/H3 headings** (12 pts) — pass if ≥3 headings ending in `?`.
    2. **JSON-LD structured data** (12 pts) — pass if FAQPage present OR ≥2 blocks incl. Article/Organization.
    3. **Concise answer paragraphs** (10 pts) — pass if avg paragraph ≤80 words.
    4. **E-E-A-T author signals** (10 pts) — pass if author meta + bio block class found.
    5. **Freshness** (8 pts) — pass if `article:modified_time` or `<time datetime>` is <1y old.
    6. **Lead paragraph as direct answer** (10 pts) — pass if first `<p>` is 15-60 words and ends in `.!?`.
    7. **Lists & tables** (8 pts) — pass if ≥3 `<ul>/<ol>/<table>` blocks.
    8. **Image alt-text coverage** (6 pts) — pass if ≥90% of images have alt text (or zero images).
    9. **Internal links** (6 pts) — pass if ≥5 same-host links.
    10. **`/llms.txt` at site root** (8 pts) — HEAD probe, warn if missing.
    11. **Title 20-70 chars** (5 pts).
    12. **Meta description 70-160 chars** (5 pts).
*   **Pure regex, no LLM call** — predictable cost, deterministic output. Each check returns `{id, label, status, weight, earned, message, fix}` and the frontend sorts fail→warn→pass so the user sees the most-impactful fixes first. Same A-F grading bands as T22.

## T31 — Local SEO Basics
- **Route**: `/local-seo` (nav under Reach)
- **Endpoints**: `POST /api/local-seo/run`, `GET /api/local-seo/runs`, `GET /api/local-seo/runs/:id`
- **Storage**: `local_seo_runs` (id, url, score, grade, summary jsonb, checks jsonb, created_at)
- **Builder**: `buildLocalSeo` in app.js → `#lsWrap`
- **Service**: `services/local_seo/{schema,api}.js`
- **Checks (11, sum=100)**: phone (12) · click-to-call (8) · address (12) · LocalBusiness schema (15) · GBP/Maps link (10) · Maps embed (8) · hours (8) · contact page (8) · NAP consistency (6) · service area (8) · hygiene HTTPS+canonical (5)
- **Notes**: pure regex, no LLM. Recognises 15 LocalBusiness subtypes (Restaurant, Dentist, AutomotiveBusiness, etc).

## T32 — Social Tags Audit
- **Route**: `/social-tags` (nav under Reach)
- **Endpoints**: `POST /api/social-tags/run`, `GET /api/social-tags/runs`, `GET /api/social-tags/runs/:id`
- **Storage**: `social_tags_runs` (id, url, score, grade, summary jsonb, checks jsonb, created_at)
- **Builder**: `buildSocialTags` in app.js → `#stWrap`
- **Service**: `services/social_tags/{schema,api}.js`
- **Checks (13, sum=100)**: og:title (10) · og:description (8) · og:image (12) · og:type (4) · og:url (4) · twitter:card (8) · twitter:image+title (6) · Facebook Pixel (8) · GA4/GTM (8) · social profile links across 6 platforms (10) · favicon (6) · apple-touch-icon (6) · Organization sameAs[] (4)
- **Notes**: pure regex. UA (deprecated) detection issues warn; GA4/GTM passes. Profile detection excludes share-intent URLs (sharer.php, intent/share, p/, reel/).

## T33 — Headless Rendering + Bigger Check Inventory
- **Routes**: `POST /api/seo-auditor/audit` (now accepts `body.headless:true`) · `GET /api/seo-auditor/headless-status` · `POST /api/{geo-audit,local-seo,social-tags}/run` (all accept `body.headless:true`)
- **Service**: `services/_shared/headless_fetch.js` (shared puppeteer-core wrapper). Existing T22/T30/T31/T32 services updated.
- **Builder**: `buildSeoAuditor`, `buildGeoAudit`, `buildLocalSeo`, `buildSocialTags` — each gained a "Render with real browser" checkbox.
- **Browser**: puppeteer-core driving system Chromium found by probing `process.env.CHROMIUM_PATH`, `/usr/bin/chromium`, `which chromium`, then `/nix/store/*chromium*/bin/chromium`. Singleton instance with `--no-sandbox --disable-dev-shm-usage --single-process --no-zygote`. `--single-process` is what makes it survive Replit's container.
- **Request interception**: drops `image | media | font` to keep page weight low. Initial URL goes through `isUrlSafeToFetch`; cross-origin sub-resources are not individually validated (acceptable per inline comment — bodies of media types are dropped, only the rendered HTML of the requested page is collected).
- **Auto-fallback (T22 only)**: when raw HTML matches the empty-SPA heuristic (`looksLikeEmptySpa` — visible text < 400 chars AND markup contains a root container like `#root`/`#app`/`#__next`/`#__nuxt`/`#svelte`), T22 silently retries through headless and returns `renderMode: "headless-auto"`. Manual `headless:true` returns `renderMode: "headless"`. Default returns `renderMode: "http"`.
- **T22 expanded check inventory (#20-32, 13 new)**: doctype html5 (2) · UTF-8 charset (2) · HSTS response header (4) · X-Robots-Tag header (3) · hreflang (2) · web manifest / PWA (2) · theme-color meta (2) · RSS/Atom feed (2) · inline event handlers (2) · loading="lazy" image % (2) · heading hierarchy with no skipped levels (3) · duplicate `<meta name="description">` (2) · inline `<script>` byte size (2). Total weight grew from ~85 → ~116; final score is still `(earned/totalWeight)*100` so % stays correctly normalised.
- **Notes**: response headers now flow from `_fetchHtml` (and from puppeteer's `resp.headers()`) into `_parseAndScore(html, finalUrl, headers)` so HSTS and X-Robots-Tag can be checked. T30/T31/T32 INSERT statements now `JSON.stringify` summary/checks for JSONB columns (matched T22's pattern; previous bug submitted raw objects on T30).
