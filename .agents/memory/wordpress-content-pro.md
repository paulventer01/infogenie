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
