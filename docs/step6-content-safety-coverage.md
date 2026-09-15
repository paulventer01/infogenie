# Step 6 — Content Safety Coverage Audit

**Status:** Partial  
**Audited from:** `main` @ `9c916358` (2026-09-15)  
**Last updated:** PR #190 revision — adds Email Designer, Site Builder, LinkedIn Outreach, RCS; field-scan review; per-route expansion.  
**Scope:** Content-generation, regeneration, save/edit, approval, and publishing routes that produce or move marketing copy toward external delivery.

This document inventories every in-scope route traced through shared helpers and handler execution order — not function-name grep alone. Routes are classified **covered**, **partial**, **gap**, or **out of scope** with justification.

---

## Executive summary

Step 6 (PR10H) enforces deterministic brand/compliance + PII checks on generated marketing text **before** it is returned, persisted, or externally published. Default is **enforce**; tenants may opt into **warning-only** via AI Governance policy.

### Unique route counts (method + path)

| Classification | Count | Notes |
|----------------|------:|-------|
| **Covered** (full) | 41 | Gate before persist/return/action; field scan complete per normalizer |
| **Partial** | 8 | Gate present but incomplete field scan, timing, status code, or warning persistence |
| **Gap** | 52 | No Step 6 gate on an in-scope lifecycle step |
| **Out of scope** | 34 | Read-only, audit-only, non-copy, or operator-channel deferrals |
| **Total inventoried** | 135 | Each row appears once |

**Step 6 is not complete.**

---

## Shared gate architecture

```
HTTP handler
  → gateRouteText (route_gate.js)
    → gateGeneratedContent (hooks.js)
      → outputGate.scanOutput (PII, brand/compliance, claim citation)
      → governContent → orchestrator.govern (fail-closed for content_generation)
```

| Helper | File | Role |
|--------|------|------|
| `gateRouteText` | `services/ai_governance/route_gate.js` | HTTP wrapper |
| `gateGeneratedContent` | `services/ai_governance/hooks.js` | Scan + govern; blocked text not returned |
| `governContent` | `services/ai_governance/hooks.js` | Fail-closed orchestrator |
| `governSafe` | `services/ai_governance/hooks.js` | **Audit-only; fails open** |
| `content_schemas.*` | `services/ai_governance/content_schemas.js` | Normalize → gate text |

**Indirect:** `chat_router.chatForCategory` gates via `gateGeneratedContent`; used by `social_drafts/self_heal.js` (heuristic + rewrite — not equivalent to full lifecycle gate).

---

## Field-scan completeness review (covered routes)

Traced normalizers in `content_schemas.js` and per-route `_respondGatedJson` scan strings. Goal: all publishable text fields reach `scanOutput`, including secondary JSON fields and delimiter-separated segments.

| Route / normalizer | Fields scanned | Delimiter / encoding | Test evidence | Scan gaps |
|--------------------|----------------|----------------------|---------------|-----------|
| `composerDraftGateText` | name, audience, subject, body, send time, rationale; condition type/op/field/event/metric/source/value | `\n` between sections; conditions joined with spaces | `pr10h5` (value, type, op); `pr10h5-content-schemas` | None known |
| `redditReplyGateText` | `reply`, `tone_note` | `\n` | `pr10h5`, `pr10h7`, `pr10h5-content-schemas` | None known |
| `pressReleaseGateText` | headline, subhead, dateline, body, quote, attribution, boilerplate, contact | `\n` | `pr10h8` | None known |
| `coldEmailGateText` | subject, preview, body, cta, why_this_works per email | `\n` | `pr10h7` | None known |
| `videoScriptGateText` | hook, body line/onscreen_text/cue, cta, viral_pattern, hashtags | `\t` within body lines; `\n` between scripts | `pr10h12` | Literal `\n`/`\t` **inside** a single `line` value scanned as part of field (not split across fields) |
| `carouselGateText` | role, headline, body, visualHint per slide | `\t` within slide; `\n` between slides | `pr10h13` | Same as video script for embedded escapes in one field |
| `channelAdGateText` | headline, body, cta, hashtags | `\n` | `pr10h5` | None known |
| `redditStudioGateText` | persona, titles[] | `\n` | `pr10h5` | None known |
| `contentClusterGateText` | whole cluster object | `JSON.stringify` | `pr10h5` | **Partial:** stringify emits escaped `\n`/`\t` as two-char sequences; phrases split across JSON key boundaries may evade line-oriented heuristics |
| `proofreadGateText` | summary, improved_copy, issue texts | `\n` | `pr10h5` | None known |
| `adCopyGateText` | all leaf values in normalized score/UGC/packages | `\n` | `pr10h9` | None known |
| `reviewReplyGateText` | `reply` only | n/a | `pr10h7` | None known |
| `marketing_brief` `generateBrief` | `JSON.stringify({ headline, greeting, sections, actions })` | JSON | `content-safety-enforcement` | Same JSON.stringify caveat as clusters |
| `ad_creative/generate` | full DALL-E prompt built from headline, body, brand, cta, extra_context | space-joined prompt | `pr10h9` | Image pixels not scanned (copy path only — intentional) |
| `ai_content` `_respondGatedJson` routes | per-route scan string (see §A1 table) | varies | — | See partial rows below |
| `safe_agent/propose` | `JSON.stringify({ proposal, simulation, title })` | JSON | `pr10h4` | JSON.stringify caveat |

**Recommendation (PR-8c):** Add regression tests that place prohibited phrases (a) only in `tone_note`-style secondary fields, (b) only in JSON-escaped `\n`/`\t` sequences, and (c) split across `JSON.stringify` key boundaries — extend normalizers to decode or flatten before scan where needed.

---

## Route inventory

| Column | Meaning |
|--------|---------|
| **Gate** | `gateRouteText`, `gateGeneratedContent`, `governSafe`, `heuristic`, `none` |
| **Timing** | When gate runs relative to persist / return / external action |
| **Warnings** | `content_safety_warnings` handling |
| **Class** | `covered` · `partial` · `gap` · `out of scope` |

---

### A. Content generation

#### A1 — Covered (full)

| Method | Path | Module | Gate | Timing | Warnings | Tests |
|--------|------|--------|------|--------|----------|-------|
| POST | `/api/campaign-composer/generate` | `campaign_composer/api.js` | `gateRouteText` + `composerDraftGateText` | before-persist | DB + attach | `pr10h5`, `pr10h10` |
| POST | `/api/ad-creative/score` | `ad_creative/api.js` | `gateRouteText` + `adCopyGateText` | before-return | attach | `pr10h8`, `pr10h9` |
| POST | `/api/ad-creative/ugc-script` | `ad_creative/api.js` | same | before-return | attach | `pr10h9` |
| POST | `/api/ad-creative/from-landing-page` | `ad_creative/api.js` | same | before-return | attach | `pr10h9` |
| POST | `/api/ad-creative/generate` | `ad_creative/api.js` | `gateRouteText` on built prompt | before DALL-E + persist | DB + attach | `pr10h8`, `pr10h9` |
| POST | `/api/press-release/generate` | `press_release/api.js` | `gateRouteText` + `pressReleaseGateText` | before-return | attach | `pr10h8` |
| POST | `/api/cold-email/generate` | `cold_email/api.js` | `gateRouteText` + `coldEmailGateText` | before-persist | DB + attach | `pr10h7` |
| POST | `/api/video-script/generate` | `video_script/api.js` | `gateRouteText` + `videoScriptGateText` | before-return | attach | `pr10h12` |
| POST | `/api/carousel/generate` | `carousel/api.js` | `gateRouteText` + `carouselGateText` | before-persist | meta + attach | `pr10h13` |
| POST | `/api/review-monitor/replies/generate` | `review_monitor/reply_api.js` | `gateRouteText` + `reviewReplyGateText` | before-persist | DB + attach | `pr10h7` |
| POST | `/api/launch-compliance/checklists/:id/proofread` | `launch_compliance/api.js` | `gateRouteText` + `proofreadGateText` | before-persist | DB + attach | `pr10h5` |
| POST | `/api/reddit-reply` | `market_signals/routes.js` | `gateRouteText` + `redditReplyGateText` | before-return | attach | `pr10h5`, `pr10h7` |
| POST | `/api/reddit-studio-suggest` | `market_signals/routes.js` | `gateRouteText` + `redditStudioGateText` | before-return | attach | `pr10h5` |
| POST | `/api/ai-channel-ad` | `market_signals/routes.js` | `gateRouteText` + `channelAdGateText` (+ template fallback) | before-return | attach | `pr10h5` |
| POST | `/api/ai-content-clusters` | `market_signals/routes.js` | `gateRouteText` + `contentClusterGateText` | before-return | attach | `pr10h5` |
| POST | `/api/safe-agent/propose` | `safe_agent/api.js` | `gateRouteText` on proposal JSON | before-persist | DB + response | `pr10h4` |
| GET | `/api/marketing-brief/today` | `marketing_brief/generator.js` | `gateGeneratedContent` in `generateBrief` | before-persist | DB column | `content-safety-enforcement` |
| POST | `/api/marketing-brief/generate` | `marketing_brief/api.js` | same | before-persist | DB column | `content-safety-enforcement` |
| POST | `/api/ai-visibility-audit` | `ai_content/routes.js` | `_respondGatedJson` (audit text) | before-return | attach | — |
| POST | `/api/ai-brand-monitor` | `ai_content/routes.js` | `_respondGatedJson` (report text) | before-return | attach | — |
| POST | `/api/ai-build-content` | `ai_content/routes.js` | `_respondGatedJson` (scanText) | before-return | attach | — |
| POST | `/api/ai-content-brief` | `ai_content/routes.js` | `_respondGatedJson` (brief) | before-return | attach | — |
| POST | `/api/ai-social-caption` | `ai_content/routes.js` | `_respondGatedJson` (caption) | before-return | attach | — |
| POST | `/api/agency-report` | `ai_content/routes.js` | `_respondGatedJson` (`JSON.stringify` payload) | before-return | attach | — |
| POST | `/api/reengage-copy` | `ai_content/routes.js` | `_respondGatedJson` (counter or scanText) | before-return | attach | — |
| POST | `/api/ai-creative` | `ai_content/routes.js` | `_respondGatedJson` (`JSON.stringify` payload) | before-return | attach | — |
| POST | `/api/ai-campaign-brief` | `ai_content/routes.js` | `_respondGatedJson` (`JSON.stringify` payload) | before-return | attach | — |
| POST | `/api/generate-article-topics` | `ai_content/routes.js` | `_respondGatedJson` (`JSON.stringify` payload) | before-return | attach | — |
| POST | `/api/backlink-opportunities` | `ai_content/routes.js` | `_respondGatedJson` (`JSON.stringify` payload) | before-return | attach | — |
| POST | `/api/keyword-research` | `ai_content/routes.js` | `_respondGatedJson` (`JSON.stringify` payload) | before-return | attach | — |

**Library:** `services/ai/chat_router.js` `chatForCategory` — `gateGeneratedContent` before return.

#### A2 — Partial coverage (gate present, incomplete)

| Method | Path | Issue | Tests | Class |
|--------|------|-------|-------|-------|
| POST | `/api/reddit-monitor` | Only AI `posts` text gated; HN feed and scoring paths ungated; blocked AI stripped from payload | `pr10h5` | **partial** |
| POST | `/api/ai-attack-plan` | Gate before persist, but `content_safety_warnings` not stored on saved plan entry | — | **partial** |
| POST | `/api/landing-page` | Gates `html` only; response includes unscanned `campName`, `domain` (user inputs echoed) | — | **partial** |
| POST | `/api/generate-seo-article` | Gates generated `content` only; response echoes request `title` without separate scan | — | **partial** |
| POST | `/api/publish-to-wordpress` | Gates `content` only — **`title` not scanned**; blocked path always **403** (never 503 for `content_safety_unavailable` unlike `_respondGatedJson`); success omits `content_safety_warnings` in warning-only mode | — | **partial** |
| GET | `/api/marketing-brief/merged` | `generateBrief` gate errors swallowed (`catch { /* keep stale */ }`) | — | **partial** |
| POST | `/api/ai-content-clusters` | `contentClusterGateText` uses `JSON.stringify` — see field-scan table | `pr10h5` | **partial** (normalizer) |
| POST | `/api/agency-report` | `JSON.stringify` scan — see field-scan table | — | **partial** (normalizer) |

#### A3 — Generation gaps (no Step 6 gate)

| Method | Path | Module | Notes |
|--------|------|--------|-------|
| POST | `/api/reddit-autofill` | `market_signals/routes.js` | AI persona/copy |
| POST | `/api/seed-topic-suggest` | `market_signals/routes.js` | Topic titles |
| POST | `/api/templates/recommend` | `market_signals/routes.js` | Template copy |
| POST | `/api/intent-map` | `market_signals/routes.js` | Content angles |
| POST | `/api/keyword-page-map` | `market_signals/routes.js` | Page/copy mapping |
| POST | `/api/icp-draft` | `market_signals/routes.js` | ICP narrative |
| POST | `/api/icp-voc` | `market_signals/routes.js` | VOC copy |
| POST | `/api/reengage/generate` | `growth_ops/routes.js` | Duplicate of gated `/api/reengage-copy` |
| POST | `/api/wireframe/generate` | `wireframe/api.js` | Landing wireframe copy |
| POST | `/api/content-brief/generate` | `content_brief/api.js` | Brief copy |
| POST | `/api/content-calendar/generate` | `content_calendar/api.js` | Calendar copy |
| POST | `/api/content-modes/generate` | `content_modes/api.js` | Mode copy |
| POST | `/api/landing-pages/generate` | `landing_pages/api.js` | Page HTML |
| POST | `/api/pitch-deck/generate` | `pitch_deck/api.js` | Slide copy |
| POST | `/api/battle-cards/generate` | `battle_cards/api.js` | Battle card copy |
| POST | `/api/chatbot-builder/generate` | `chatbot_builder/api.js` | Bot scripts |
| POST | `/api/brand-dna/generate` | `brand_dna/api.js` | Brand narrative |
| POST | `/api/ab-designer/generate` | `ab_designer/api.js` | Variant copy |
| POST | `/api/infographics/generate` | `infographics/api.js` | Infographic text |
| POST | `/api/llm-kb/generate` | `llm_kb/api.js` | KB article |
| POST | `/api/reddit-pulse/generate-reply` | `reddit_pulse/api.js` | Reply draft |
| POST | `/api/reply-assistant/draft` | `reply_assistant/api.js` | Mention reply |
| POST | `/api/seo-autopilot/reddit-aeo/draft-reply` | `seo_autopilot/api.js` | Reddit AEO reply |
| POST | `/api/creator-studio/presentation/generate` | `creator_studio/api.js` | Deck copy |
| POST | `/api/creator-studio/signature/generate` | `creator_studio/api.js` | Email signature HTML |
| POST | `/api/creator-studio/case-study/generate` | `creator_studio/api.js` | Case study HTML |
| POST | `/api/email-designer/ai-generate` | `email_designer/api.js` | Block-based email (return only, not persisted) |
| POST | `/api/site-builder/ai-generate` | `site_builder/api.js` | Landing page blocks; **persists to kv before return** |
| POST | `/api/linkedin-outreach/sequences/:id/ai-generate` | `linkedin_outreach/api.js` | 4 messages + angles; **auto-saves to sequence** |
| POST | `/api/rcs/campaigns/:id/ai-generate` | `rcs/api.js` | RCS/Apple message body, rich card, CTAs (return only) |

#### A4 — Generation out of scope

| Method | Path | Justification |
|--------|------|---------------|
| POST | `/api/voiceover/generate` | TTS of user-supplied text |
| POST | `/api/audio-summary/generate` | Spoken summary of supplied text |
| POST | `/api/schema-generator/generate` | Structured data / JSON-LD |
| POST | `/api/dataset-market/generate` | Synthetic analytics samples |
| POST | `/api/competitor-news` | Research aggregation |
| POST | `/api/trends` | Research aggregation |
| POST | `/api/reddit-signals` | Signal aggregation |
| POST | `/api/launch-compliance/checklists/:id/brand-check` | `governSafe` audit-only |

---

### B. Regeneration

| Method | Path | Gate on regen? | Class |
|--------|------|----------------|-------|
| POST | `/api/campaign-composer/generate` | yes | covered |
| POST | `/api/marketing-brief/generate` | yes | covered |
| GET | `/api/marketing-brief/today?force=1` | yes | covered |
| GET | `/api/marketing-brief/merged` | yes when regen runs; errors swallowed | **partial** |
| POST | `/api/social-drafts/:id/self-heal` | heuristic + indirect `chatForCategory` gate on rewrite text only | **gap** |
| POST | `/api/email-designer/:id/versions/:vid/restore` | none | **gap** |
| All A3 generation gaps | — | no | **gap** |

---

### C. Save / edit

| Method | Path | Gate | Timing | Class |
|--------|------|------|--------|-------|
| PUT | `/api/campaign-composer/drafts/:id` | `gateRouteText` | before-persist | covered |
| POST | `/api/launch-compliance/checklists` | none | n/a | **gap** (`ad_copy`) |
| POST | `/api/social-drafts/` | none | n/a | **gap** |
| POST | `/api/social-drafts/bulk` | none | n/a | **gap** |
| PATCH | `/api/social-drafts/:id` | none | n/a | **gap** |
| POST | `/api/review-monitor/request-rules` | none | n/a | **gap** (`message_template`) |
| PUT | `/api/review-monitor/request-rules/:id` | none | n/a | **gap** |
| POST | `/api/email-designer/` | none | n/a | **gap** (blocks, subject → `rendered_html`) |
| PUT | `/api/email-designer/:id` | none | n/a | **gap** |
| POST | `/api/email-designer/:id/versions/:vid/restore` | none | n/a | **gap** |
| POST | `/api/site-builder/page/:slug` | none | before kv persist | **gap** (all block copy) |
| POST | `/api/linkedin-outreach/sequences` | none | n/a | **gap** (connection + follow-up messages) |
| PUT | `/api/linkedin-outreach/sequences/:id` | none | n/a | **gap** |
| POST | `/api/rcs/campaigns/create` | none | n/a | **gap** (`message_body`, rich_card, cta_buttons) |
| PUT | `/api/launch-compliance/items/:itemId` | none | n/a | out of scope (checklist status) |
| POST | `/api/brand-foundation/save` | none | n/a | out of scope (brand config) |

---

### D. Approval

| Method | Path | Gate | Class |
|--------|------|------|-------|
| POST | `/api/campaign-composer/drafts/:id/approve` | `gateRouteText` re-scan | covered |
| POST | `/api/campaign-composer/drafts/:id/approve` | `governSafe` after commit | out of scope (audit) |
| POST | `/api/review-monitor/replies/:id/approve` | none | **gap** |
| POST | `/api/safe-agent/approve/:id` | none (`governSafe` after) | **gap** |
| POST | `/api/social-drafts/:id/submit-approval` | heuristic `selfHealDraft` only | **gap** |
| POST | `/api/social-drafts/:id/approve` | none | **gap** |
| POST | `/api/approval-workflows/approve/:id` | none | out of scope (generic workflow) |
| POST | `/api/agent-orchestrator/**/approve*` | orchestrator action-tier | out of scope (PR10H action tier) |

---

### E. Publishing / delivery

| Method | Path | Gate | Timing | Class |
|--------|------|------|--------|-------|
| POST | `/api/publish-to-wordpress` | `gateRouteText` on `content` only | before WP POST | **partial** (see A2) |
| POST | `/api/wordpress/publish` | none | n/a | **gap** |
| POST | `/api/social-drafts/:id/publish` | approval authz only | before Zernio | **gap** |
| POST | `/api/social-publisher/post` | approval block only | before Zernio | **gap** |
| POST | `/api/marketing-brief/:id/deliver` | none | sends stored brief | **gap** |
| POST | `/api/rcs/campaigns/:id/send` | none | before message queue insert | **gap** |
| POST | `/api/email-designer/:id/preview` | none | returns stored HTML | **gap** (delivery preview) |
| POST | `/api/email-designer/render` | none | returns live HTML | **gap** (live preview) |
| GET | `/api/site-builder/render/:slug` | none | public HTML response | **gap** (public delivery) |
| PUT | `/api/linkedin-outreach/contacts/:id/status` | none | status tracking only | out of scope (human sends on LinkedIn; no API copy dispatch) |
| POST | `/api/whatsapp-channel/send` | none | n/a | out of scope (operator channel; defer) |
| GET | `/lp/:id` | none | legacy `landing_pages` table serve | out of scope (separate from site-builder kv pages; covered under `landing_pages/generate` gap) |

**Email Designer delivery note:** No first-party `/send` route. Templates persist for drip/campaign export (UI copy: “export to drip campaigns”). In-scope gaps are **save**, **ai-generate**, and **preview/render** paths that materialize HTML without gate.

**Site Builder delivery note:** Public pages live at `kv_store` key `lp:<slug>`. `GET /api/site-builder/render/:slug` serves HTML from stored blocks without re-scan.

**LinkedIn Outreach delivery note:** Copy is stored on sequences for operator manual send; no automated LinkedIn API dispatch. Save and AI-generate paths are in-scope gaps.

**RCS delivery note:** `POST .../send` queues `message_body` / rich card to recipients without gate.

---

## Module trace summaries (new in this revision)

### Email Designer (`/api/email-designer`)

| Lifecycle | Routes | Gate today | Class |
|-----------|--------|------------|-------|
| Generate | `POST /ai-generate` | none | **gap** |
| Save | `POST /`, `PUT /:id`, `POST /:id/versions/:vid/restore` | none | **gap** |
| Deliver | `POST /:id/preview`, `POST /render` | none | **gap** |
| Read / admin | `GET /`, `GET /:id`, `DELETE /:id`, `GET /:id/versions`, `POST /:id/spam-check` | spam-check uses local heuristics | out of scope |

Execution: `ai-generate` → OpenAI JSON → `res.json({ subject, blocks, global_styles })` with no `gateRouteText`. Save paths call `renderHtml(blocks)` then INSERT/UPDATE without scan.

### Site Builder (`/api/site-builder`)

| Lifecycle | Routes | Gate today | Class |
|-----------|--------|------------|-------|
| Generate | `POST /ai-generate` | none; persists via `kvSet` before return | **gap** |
| Save | `POST /page/:slug` | none | **gap** |
| Deliver | `GET /render/:slug` | none | **gap** |
| Read | `GET /pages`, `GET /page/:slug` | n/a | out of scope |

Execution: `ai-generate` → OpenAI page JSON → `kvSet('lp:'+slug)` → response. All block text (hero, features, FAQ, CTA, etc.) ungated.

### LinkedIn Outreach (`/api/linkedin-outreach`)

| Lifecycle | Routes | Gate today | Class |
|-----------|--------|------------|-------|
| Generate | `POST /sequences/:id/ai-generate` | none; UPDATE sequence messages after LLM | **gap** |
| Save | `POST /sequences`, `PUT /sequences/:id` | none | **gap** |
| Deliver | `PUT /contacts/:id/status` | n/a (tracking) | out of scope |
| Read / CRM | `GET /config`, `GET /sequences`, `GET /contacts/:sequence_id`, `POST /contacts`, `DELETE /contacts/:id` | n/a | out of scope |

Execution: `ai-generate` parses `connection_message`, three follow-ups, `subject_angles`, `tips` → UPDATE `linkedin_sequences` without gate.

### RCS (`/api/rcs`)

| Lifecycle | Routes | Gate today | Class |
|-----------|--------|------------|-------|
| Generate | `POST /campaigns/:id/ai-generate` | none; returns JSON only | **gap** |
| Save | `POST /campaigns/create` | none | **gap** |
| Deliver | `POST /campaigns/:id/send` | none | **gap** |
| Read | `GET /config`, `GET /campaigns`, `GET /stats/:id` | n/a | out of scope |

Execution: `ai-generate` produces `message_body`, `rich_card`, `cta_buttons`, `suggested_replies` → `res.json({ generated })`. `send` INSERTs `rcs_messages` rows without scan.

---

## Implementation PR batches

Each batch ≤ 1,500 additions + deletions. Ordered by risk. Every batch lists **acceptance criteria**.

### PR-1a — Social drafts: create and edit gate

**Routes:** `POST /api/social-drafts/`, `POST /api/social-drafts/bulk`, `PATCH /api/social-drafts/:id`

**Acceptance:**
- `gateRouteText` on `text` (and media alt text if present) before INSERT/UPDATE
- `content_safety_warnings` persisted on draft row / `meta`
- 403/503 block without draft body in response; warning-only returns warnings
- Tests: `test/pr10h14a-social-draft-save-safety.test.js`

---

### PR-1b — Social drafts: approval and publish gate

**Routes:** `POST /api/social-drafts/:id/submit-approval`, `POST /api/social-drafts/:id/approve`, `POST /api/social-drafts/:id/publish`

**Acceptance:**
- Re-scan at submit, approve, and publish (composer approve pattern)
- Self-heal may remain but must not bypass final `gateRouteText` before external delivery
- Tests: `test/pr10h14b-social-draft-publish-safety.test.js`; extend `pr10h6` only for authz — not safety

---

### PR-1c — Social publisher direct post gate

**Routes:** `POST /api/social-publisher/post`

**Acceptance:**
- Gate post `text` before Zernio call when approval not required
- When approval required, behaviour unchanged (blocked with hint)
- Tests: `test/pr10h14c-social-publisher-safety.test.js`

---

### PR-2 — WordPress publish unification

**Routes:** `POST /api/wordpress/publish`

**Acceptance:**
- Gate `title` + `content` + `excerpt` before `_wpRequest`
- 503 on `content_safety_unavailable`; attach warnings on success
- Tests: `test/pr10h14-wordpress-publish-safety.test.js`

---

### PR-3a — Review reply approve rescan

**Routes:** `POST /api/review-monitor/replies/:id/approve`

**Acceptance:**
- `gateRouteText` on stored `ai_draft_reply` before status flip
- Tests: extend `pr10h7`

---

### PR-3b — Safe Agent approve rescan

**Routes:** `POST /api/safe-agent/approve/:id`

**Acceptance:**
- Re-scan proposal JSON before execution
- Tests: extend `pr10h4`

---

### PR-4a — Launch compliance checklist create gate

**Routes:** `POST /api/launch-compliance/checklists`

**Acceptance:**
- Gate `ad_copy` before INSERT
- Persist warnings on checklist row

---

### PR-4b — Review request-rules gate

**Routes:** `POST /api/review-monitor/request-rules`, `PUT /api/review-monitor/request-rules/:id`

**Acceptance:**
- Gate `message_template` before persist

---

### PR-5 — Market Signals remaining AI copy (7 routes)

**Routes:** `/api/reddit-autofill`, `/api/seed-topic-suggest`, `/api/templates/recommend`, `/api/intent-map`, `/api/keyword-page-map`, `/api/icp-draft`, `/api/icp-voc`

**Acceptance:**
- Normalizers in `content_schemas.js` where needed
- `_gateMarketText` before return on each route
- Tests: `test/pr10h14-market-signals-safety.test.js`

---

### PR-6a — Email Designer lifecycle

**Routes:** `POST /api/email-designer/ai-generate`, `POST /`, `PUT /:id`, `POST /:id/versions/:vid/restore`, `POST /:id/preview`, `POST /render`

**Acceptance:**
- `emailDesignerGateText(blocks, subject)` normalizer flattening all block `content`, button labels, column text
- Gate before return (ai-generate, render) and before persist (save, restore, preview if serving stored)
- UI: `ContentSafetyWarnings` in `EmailDesigner.tsx`
- Tests: `test/pr10h14-email-designer-safety.test.js`

---

### PR-6b — Site Builder lifecycle

**Routes:** `POST /api/site-builder/ai-generate`, `POST /api/site-builder/page/:slug`, `GET /api/site-builder/render/:slug`

**Acceptance:**
- `siteBuilderGateText(page)` across all block types
- Gate before `kvSet` and before public HTML render
- Tests: `test/pr10h14-site-builder-safety.test.js`

---

### PR-6c — LinkedIn Outreach lifecycle

**Routes:** `POST /api/linkedin-outreach/sequences`, `PUT /api/linkedin-outreach/sequences/:id`, `POST /api/linkedin-outreach/sequences/:id/ai-generate`

**Acceptance:**
- `linkedinSequenceGateText` on all message fields + angles
- Gate before UPDATE in ai-generate and before sequence INSERT/UPDATE
- Tests: `test/pr10h14-linkedin-outreach-safety.test.js`

---

### PR-6d — RCS lifecycle

**Routes:** `POST /api/rcs/campaigns/create`, `POST /api/rcs/campaigns/:id/ai-generate`, `POST /api/rcs/campaigns/:id/send`

**Acceptance:**
- `rcsCampaignGateText` on message_body, rich_card, cta_buttons, suggested_replies
- Gate before persist, before ai-generate return, and before send
- Tests: `test/pr10h14-rcs-safety.test.js`

---

### PR-7a — Tier-2 generate: content planning

**Routes:** `POST /api/content-brief/generate`, `POST /api/content-calendar/generate`, `POST /api/content-modes/generate`

**Acceptance:** Shared pattern; one normalizer per module; gate before return/persist; module tests.

---

### PR-7b — Tier-2 generate: pages and decks

**Routes:** `POST /api/landing-pages/generate`, `POST /api/wireframe/generate`, `POST /api/pitch-deck/generate`

**Acceptance:** Gate HTML/copy before persist; tests per module.

---

### PR-7c — Tier-2 generate: outreach and replies

**Routes:** `POST /api/reengage/generate`, `POST /api/reddit-pulse/generate-reply`, `POST /api/reply-assistant/draft`, `POST /api/seo-autopilot/reddit-aeo/draft-reply`, `POST /api/battle-cards/generate`

**Acceptance:** Align with gated cousins (`reengage-copy`, `review-monitor`).

---

### PR-7d — Tier-2 generate: creator studio copy

**Routes:** `POST /api/creator-studio/presentation/generate`, `POST /api/creator-studio/signature/generate`, `POST /api/creator-studio/case-study/generate`

**Acceptance:** Gate slide/signature/case-study text before persist/return.

---

### PR-7e — Tier-2 generate: remaining

**Routes:** `POST /api/chatbot-builder/generate`, `POST /api/brand-dna/generate`, `POST /api/ab-designer/generate`, `POST /api/infographics/generate`, `POST /api/llm-kb/generate`

**Acceptance:** Gate before return/persist per module.

---

### PR-8a — `publish-to-wordpress` hardening

**Routes:** `POST /api/publish-to-wordpress`

**Acceptance:**
- Scan `title` + `content` (and `excerpt` if added to API)
- Return **503** when `gated.error === 'content_safety_unavailable'`
- Attach `content_safety_warnings` on success in warning-only mode
- Tests: `test/pr10h14-publish-to-wordpress-safety.test.js`

---

### PR-8b — Warning persistence and stale-brief surfacing

**Items:** `POST /api/ai-attack-plan` warning persist; `GET /api/marketing-brief/merged` error surfacing

**Acceptance:** Warnings stored on attack-plan kv entry; merged endpoint returns explicit safety error instead of silent stale.

---

### PR-8c — JSON gate-text normalization

**Items:** `contentClusterGateText`, agency-report / ai-creative stringify paths, marketing brief stringify

**Acceptance:**
- Flatten or decode JSON-safe escapes before `scanOutput`
- Tests with prohibited text in (1) secondary fields, (2) literal `\n`/`\t` in JSON strings, (3) split across keys

---

## Test evidence index

| File | Covers |
|------|--------|
| `test/content-safety-enforcement.test.js` | `gateGeneratedContent`, marketing brief |
| `test/pr10h4-content-safety-approval.test.js` | safe-agent propose |
| `test/pr10h5-step6-content-gates.test.js` | composer, proofread, market_signals; **documents partial Step 6** |
| `test/pr10h5-content-schemas.test.js` | Normalizers, tone_note, audience_rules |
| `test/pr10h6-social-publish-approval.test.js` | Approval workflow only — **not** content-safety |
| `test/pr10h7-cold-email-review-reply-safety.test.js` | cold email, review reply generate |
| `test/pr10h8`–`pr10h13` | press/ad, composer save/approve, video, carousel |
| `test/ai-governance*.test.js` | policy, `governSafe` fail-open |
| `test/browser/content-safety-governance.test.js` | AI Governance Hub |

**CI gap:** `.github/workflows/content-safety-enforcement.yml` runs pr10h8–h13 but not pr10h5, pr10h7, or Email Designer / Site Builder / LinkedIn / RCS (ungated today).

---

## Acceptance criteria — marking Step 6 complete

1. **Inventory closure** — All **gap** and **partial** rows in this document resolved or reclassified with product sign-off.
2. **Gate before side effects** — Generate, save, approve, publish: gate runs before INSERT/UPDATE, response with copy, or external API.
3. **Complete field scan** — All publishable fields in normalizers; JSON-escape regression tests pass (PR-8c).
4. **Fail-closed unavailable** — 503 `content_safety_unavailable`; no prohibited template fallback.
5. **Warning-only parity** — Warnings returned and persisted including publish success paths (`publish-to-wordpress` included).
6. **Approve rescan** — Delivery transitions re-scan stored copy.
7. **No duplicate ungated publish paths** — WordPress, social, RCS, email preview/render aligned.
8. **New modules** — Email Designer, Site Builder, LinkedIn Outreach, RCS lifecycles covered (PR-6a–6d).
9. **Tests + CI** — Per-module API tests; workflow runs full Step 6 suite with zero skips.
10. **UI** — `ContentSafetyWarnings` on panels that show gated copy.
11. **Documentation** — This file → **Status: Done**; remove partial assertions from `pr10h5-step6-content-gates.test.js` only after (1)–(10).

**Until then: Step 6 remains Partial.**

---

## Related documents

- `docs/pr10h1-content-safety-enforcement.md` — PR10H.1 platform default
- `services/ai_governance/route_gate.js`
- `services/ai_governance/content_schemas.js`
- `.github/workflows/content-safety-enforcement.yml`
