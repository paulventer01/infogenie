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
