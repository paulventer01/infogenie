---
name: WordPress + Content Pro (T47-T50)
description: How WordPress publishing, Content Modes, Autopilot, and Audio Summaries are built and connected
---

**Rule:** All 4 features share a single frontend module (`public/js/ig_content_pro.js`). Do not add WP/audio/modes/autopilot UI anywhere else.

**Services:**
- WordPress: `services/wordpress/api.js` — app passwords encrypted with same CREDENTIAL_ENCRYPTION_KEY as vault. SSRF guard included. Routes: /connect /sites /sites/:id/test /publish /publish-log
- Content Modes: `services/content_modes/api.js` — 6 modes (article/affiliation/ecommerce/local/update/discovery). POST /api/content-modes/generate
- Autopilot: `services/autopilot/api.js` — hourly cron via `startAutopilotCron()`. Internal HTTP call to /api/content-modes/generate using INFOGENIE_API_KEY. Routes: /schedules, /run-now/:id, /logs
- Audio Summary: `services/audio_summary/api.js` — GPT-4o-mini script → OpenAI TTS. Reuses voiceover_runs table.

**Frontend hooks:**
- `_ccEnhanceCards(posts)` called by `_ccGo()` in app.js after rendering content calendar cards (line ~33125)
- `buildContentModes()` + `buildAutopilot()` registered in navigateTo in app.js (~line 3223-3224)
- `_initWordpressSettingsCard()` injects WP panel into Settings integrations
- Views: `#view-content-modes` (id=cmWrap) and `#view-content-autopilot` (id=apWrap) added to index.html

**Why:** WiseWand-inspired gap analysis: InfoGenie had social content generation but no long-form article generator, no CMS publishing, no scheduled automation pipeline, and no audio output from articles.

**How to apply:** Adding a new content mode: add key to MODES array in services/content_modes/api.js, add prompt case in _buildPrompt(), add template case in _template(), add entry to MODE_CONFIG in ig_content_pro.js. Adding a new WP site field: extend wordpress_sites table + api.js /connect handler.

## T51-T55 additions (ig_creative_suite.js)

**T51 Ad Creative:** `services/ad_creative/api.js` — DALL-E 3 via `/v1/images/generations`. Downloads image to `uploads/ad_creatives/`. Placeholder fallback via placehold.co when no key.

**T52 URL Brand Scanner:** Route `POST /api/brand-foundation/scan-url` added directly to `services/brand_foundation/api.js` (end of file, before module.exports). Firecrawl first, raw HTTPS fetch fallback. SSRF guard included. Frontend injected by MutationObserver in `ig_creative_suite.js`.

**T53/T54 Idea Feed:** `services/idea_feed/api.js` — 20 ideas/day cached by `batch_date`. `/angles` is statically returned (no DB). `/ideas?force=1` refreshes batch. Swipe UI in `ig_creative_suite.js → buildIdeaFeed()`.

**T55 Multi-language:** `language` param added to both `services/content_modes/api.js` and `services/content_calendar/api.js`. Injected into AI prompts only when language ≠ 'English'. Dropdown injected by MutationObserver in ig_creative_suite.js watching for `#ccTone` and `#cmTone` elements.

**All UI:** `public/js/ig_creative_suite.js?v=20260604CS1` — loaded between ig_content_pro.js and ig_studio.js in index.html.
