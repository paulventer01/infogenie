# Step 6 — Content Safety Coverage Audit

**Status:** Partial  
**Audited from:** `main` @ `9c916358` (2026-09-15)  
**Scope:** Content-generation, regeneration, save/edit, approval, and publishing routes that produce or move marketing copy toward external delivery.

This document inventories every in-scope route traced through shared helpers and handler execution order — not function-name grep alone. Routes are classified **covered**, **gap**, or **out of scope** with justification.

---

## Executive summary

Step 6 (PR10H) enforces deterministic brand/compliance + PII checks on generated marketing text **before** it is returned, persisted, or externally published. The platform default is **enforce**; tenants may opt into **warning-only** via AI Governance policy (`content_safety_mode`).

**What is done:** Fifteen service modules wire `gateRouteText` / `gateGeneratedContent` on primary creation surfaces (campaign composer, ad/press/cold/video/carousel, review-reply generate, launch proofread, market_signals publishable copy, safe-agent propose, `ai_content` generation suite, marketing brief). Normalizers in `services/ai_governance/content_schemas.js` strip unexpected LLM fields before scanning.

**What remains:** External publish paths (social drafts, WordPress `/api/wordpress/publish`), approve-without-rescan on two modules, user-authored save without gate, seven additional `market_signals` AI copy routes, and ~20 tier-2 `/generate` endpoints. Social drafts use a separate heuristic self-heal loop — not the Step 6 orchestrator gate.

**Step 6 is not complete.** Do not mark Done until the acceptance criteria at the end of this document are met.

---

## Shared gate architecture

Execution path for HTTP handlers using `gateRouteText`:

```
HTTP handler
  → gateRouteText (route_gate.js)
    → gateGeneratedContent (hooks.js)
      → outputGate.scanOutput (deterministic PII, brand/compliance, claim citation)
      → governContent → orchestrator.govern (fail-closed for content_generation)
```

| Helper | File | Behaviour |
|--------|------|-----------|
| `gateRouteText` | `services/ai_governance/route_gate.js` | HTTP wrapper; returns `{ ok, warnings, content_safety_warnings }` or block/unavailable |
| `gateGeneratedContent` | `services/ai_governance/hooks.js` | Scan + govern; blocked text never returned as usable output |
| `governContent` | `services/ai_governance/hooks.js` | Fail-closed orchestrator path for content surfaces |
| `governSafe` | `services/ai_governance/hooks.js` | **Audit-only; fails open** — not a Step 6 execution gate |
| `content_schemas.*` | `services/ai_governance/content_schemas.js` | Normalize LLM JSON → gate text; strip extra fields |

**Warning-only mode:** `gateRouteText` returns `ok: true` with `content_safety_warnings` populated; enforce mode returns 403/503 and omits generated payload fields (`contentSafetyHttpBody`).

**Indirect coverage:** `services/ai/chat_router.js` `chatForCategory` gates LLM output via `gateGeneratedContent` before return. Used by `social_drafts/self_heal.js` AI rewrites (heuristic scan + optional chat rewrite — not equivalent to Step 6 gate on create/edit/publish).

---

## Route inventory

Legend:

| Column | Meaning |
|--------|---------|
| **Gate** | Helper used (`gateRouteText`, `gateGeneratedContent`, `governSafe`, `heuristic`, `none`) |
| **Timing** | `before-persist`, `before-return`, `before-action`, `after-action`, `audit-only`, `n/a` |
| **Warnings** | How `content_safety_warnings` are handled |
| **Tests** | Automated evidence (empty = no dedicated Step 6 test) |
| **Class** | `covered` · `gap` · `out of scope` |

### A. Content generation (AI produces new copy)

#### A1 — Covered generation routes

| Method | Path | Module | Gate | Timing | Warnings | Tests | Class |
|--------|------|--------|------|--------|----------|-------|-------|
| POST | `/api/campaign-composer/generate` | `campaign_composer/api.js` | `gateRouteText` via `_gateDraft` + `composerDraftGateText` | before-persist | DB column + response attach | `pr10h5`, `pr10h10` | covered |
| POST | `/api/ad-creative/score` | `ad_creative/api.js` | `gateRouteText` via `_sendGatedCopy` | before-return | response attach | `pr10h8`, `pr10h9` | covered |
| POST | `/api/ad-creative/ugc-script` | `ad_creative/api.js` | same | before-return | response attach | `pr10h9` | covered |
| POST | `/api/ad-creative/from-landing-page` | `ad_creative/api.js` | same | before-return | response attach | `pr10h9` | covered |
| POST | `/api/ad-creative/generate` | `ad_creative/api.js` | `gateRouteText` on copy before DALL-E | before-persist | DB + attach | `pr10h8`, `pr10h9` | covered |
| POST | `/api/press-release/generate` | `press_release/api.js` | `gateRouteText` + `pressReleaseGateText` | before-return | response attach | `pr10h8` | covered |
| POST | `/api/cold-email/generate` | `cold_email/api.js` | `gateRouteText` via `_gateEmails` | before-persist | DB + attach | `pr10h7` | covered |
| POST | `/api/video-script/generate` | `video_script/api.js` | `gateRouteText` via `_gateScripts` | before-return | response attach | `pr10h12` | covered |
| POST | `/api/carousel/generate` | `carousel/api.js` | `gateRouteText` via `_gateSlides` | before-persist | `meta.content_safety_warnings` + attach | `pr10h13` | covered |
| POST | `/api/review-monitor/replies/generate` | `review_monitor/reply_api.js` | `gateRouteText` via `_gateReply` | before-persist | DB + attach | `pr10h7` | covered |
| POST | `/api/launch-compliance/checklists/:id/proofread` | `launch_compliance/api.js` | `gateRouteText` via `_gateFeedback` | before-persist | DB + attach | `pr10h5` | covered |
| POST | `/api/reddit-reply` | `market_signals/routes.js` | `gateRouteText` + `redditReplyGateText` | before-return | response attach | `pr10h5`, `pr10h7` | covered |
| POST | `/api/reddit-studio-suggest` | `market_signals/routes.js` | `gateRouteText` + `redditStudioGateText` | before-return | response attach | `pr10h5` | covered |
| POST | `/api/ai-channel-ad` | `market_signals/routes.js` | `gateRouteText` + `channelAdGateText` (incl. template fallback) | before-return | response attach | `pr10h5` | covered |
| POST | `/api/ai-content-clusters` | `market_signals/routes.js` | `gateRouteText` + `contentClusterGateText` | before-return | response attach | `pr10h5` | covered |
| POST | `/api/reddit-monitor` | `market_signals/routes.js` | Partial: AI `posts` field gated; HN/scoring ungated | before-return (AI strip) | attach on gated payload | `pr10h5` | covered (partial) |
| POST | `/api/safe-agent/propose` | `safe_agent/api.js` | `gateRouteText` on proposal JSON | before-persist | DB + response | `pr10h4` | covered |
| GET | `/api/marketing-brief/today` | `marketing_brief/api.js` → `generator.js` | `gateGeneratedContent` in `generateBrief` | before-persist | DB column | `content-safety-enforcement` | covered |
| POST | `/api/marketing-brief/generate` | same | same | before-persist | DB column | `content-safety-enforcement` | covered |
| POST | `/api/ai-visibility-audit` | `ai_content/routes.js` | `_respondGatedJson` → `gateRouteText` | before-return | attach | — | covered |
| POST | `/api/ai-brand-monitor` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/ai-build-content` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/ai-content-brief` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/ai-social-caption` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/agency-report` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/reengage-copy` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/ai-creative` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/ai-campaign-brief` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/landing-page` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/generate-seo-article` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/generate-article-topics` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/backlink-opportunities` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/keyword-research` | `ai_content/routes.js` | same | before-return | attach | — | covered |
| POST | `/api/ai-attack-plan` | `ai_content/routes.js` | `_gateRoutePayload` before `_tryPersistAttackPlan` | before-persist | response only (not on stored plan) | — | covered (warning gap) |

**Library (non-HTTP):** `services/ai/chat_router.js` `chatForCategory` — `gateGeneratedContent` before return (`content-safety-enforcement.test.js`).

#### A2 — Generation gaps (AI copy, no Step 6 gate)

| Method | Path | Module | Gate | Timing | Warnings | Tests | Class / justification |
|--------|------|--------|------|--------|----------|-------|----------------------|
| POST | `/api/reddit-autofill` | `market_signals/routes.js` | none | n/a | none | — | **gap** — AI persona/copy for Reddit posts |
| POST | `/api/seed-topic-suggest` | `market_signals/routes.js` | none | n/a | none | — | **gap** — publishable topic titles |
| POST | `/api/templates/recommend` | `market_signals/routes.js` | none | n/a | none | — | **gap** — ad template copy recommendations |
| POST | `/api/intent-map` | `market_signals/routes.js` | none | n/a | none | — | **gap** — content angle copy |
| POST | `/api/keyword-page-map` | `market_signals/routes.js` | none | n/a | none | — | **gap** — page/copy mapping |
| POST | `/api/icp-draft` | `market_signals/routes.js` | none | n/a | none | — | **gap** — ICP narrative copy |
| POST | `/api/icp-voc` | `market_signals/routes.js` | none | n/a | none | — | **gap** — voice-of-customer copy |
| POST | `/api/reengage/generate` | `growth_ops/routes.js` | none | n/a | none | — | **gap** — duplicates gated `/api/reengage-copy` domain |
| POST | `/api/wireframe/generate` | `wireframe/api.js` | none | n/a | none | — | **gap** — landing wireframe copy |
| POST | `/api/content-brief/generate` | `content_brief/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/content-calendar/generate` | `content_calendar/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/content-modes/generate` | `content_modes/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/landing-pages/generate` | `landing_pages/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/pitch-deck/generate` | `pitch_deck/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/battle-cards/generate` | `battle_cards/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/chatbot-builder/generate` | `chatbot_builder/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/brand-dna/generate` | `brand_dna/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/ab-designer/generate` | `ab_designer/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/infographics/generate` | `infographics/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/llm-kb/generate` | `llm_kb/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/reddit-pulse/generate-reply` | `reddit_pulse/api.js` | none | n/a | none | — | **gap** — parallel to gated review/reddit reply |
| POST | `/api/reply-assistant/draft` | `reply_assistant/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/seo-autopilot/reddit-aeo/draft-reply` | `seo_autopilot/api.js` | none | n/a | none | — | **gap** |
| POST | `/api/creator-studio/*/generate` | `creator_studio/api.js` | none | n/a | none | — | **gap** — presentation/signature/case-study |

#### A3 — Generation out of scope

| Method | Path | Justification |
|--------|------|---------------|
| POST | `/api/voiceover/generate` | TTS of user-supplied text; no generative marketing copy |
| POST | `/api/audio-summary/generate` | Spoken summary of supplied text |
| POST | `/api/schema-generator/generate` | Structured data / JSON-LD, not publishable prose |
| POST | `/api/dataset-market/generate` | Synthetic dataset samples for analytics tooling |
| POST | `/api/investor-mode/generate` | Internal investor narrative; not customer-facing publish path (defer unless product declares in-scope) |
| POST | `/api/competitor-news`, `/api/trends`, `/api/reddit-signals` | Research/signal aggregation; not direct publishable copy |
| POST | `/api/launch-compliance/checklists/:id/brand-check` | `governSafe` audit-only by design; does not return gated copy for publish |

---

### B. Regeneration

No dedicated `/regenerate` endpoints exist. Regeneration is modelled as re-invoking generate routes or force-refresh:

| Flow | Route | Gate on regen? | Class |
|------|-------|----------------|-------|
| Campaign composer re-prompt | `POST /api/campaign-composer/generate` | yes (same as generate) | covered |
| Marketing brief force refresh | `POST /api/marketing-brief/generate`, `GET /today?force=1` | yes via `generateBrief` | covered |
| Marketing brief merged auto-refresh | `GET /api/marketing-brief/merged` | yes when `generateBrief` runs; **errors swallowed** (`catch { /* keep stale */ }`) | **gap** (silent stale on block) |
| Social self-heal rewrite | `POST /api/social-drafts/:id/self-heal` | heuristic + `chatForCategory` indirect gate on rewrite only | **gap** (not Step 6 on full draft lifecycle) |
| Ungated `/generate` routes (A2) | various | no | gap |

---

### C. Save / edit (user or API persists copy without new LLM call)

| Method | Path | Gate | Timing | Warnings | Tests | Class |
|--------|------|------|--------|----------|-------|-------|
| PUT | `/api/campaign-composer/drafts/:id` | `gateRouteText` via `_gateDraft` | before-persist | DB + attach | `pr10h10` | covered |
| POST | `/api/launch-compliance/checklists` | none | n/a | none | — | **gap** — `ad_copy` saved ungated |
| PUT | `/api/launch-compliance/items/:itemId` | none | n/a | n/a | — | out of scope — checklist status only, not copy |
| POST | `/api/social-drafts/` | none | n/a | none | `pr10h6` (approval only) | **gap** |
| POST | `/api/social-drafts/bulk` | none | n/a | none | — | **gap** |
| PATCH | `/api/social-drafts/:id` | none | n/a | none | `pr10h6` | **gap** |
| POST | `/api/review-monitor/request-rules` | none | n/a | none | — | **gap** — `message_template` persisted |
| PUT | `/api/review-monitor/request-rules/:id` | none | n/a | none | — | **gap** |
| POST | `/api/brand-foundation/save` | none | n/a | n/a | — | out of scope — brand config, not campaign copy |
| POST | `/api/schema-generator/save` | none | n/a | n/a | — | out of scope — structured schema blocks |

---

### D. Approval (human or workflow promotes copy toward delivery)

| Method | Path | Gate | Timing | Warnings | Tests | Class |
|--------|------|------|--------|----------|-------|-------|
| POST | `/api/campaign-composer/drafts/:id/approve` | `gateRouteText` re-scan via `_gateDraft` | before-segment-create + status update | DB + attach | `pr10h11`, `pr10h5` | covered |
| POST | `/api/campaign-composer/drafts/:id/approve` | `governSafe` | after-commit | audit-only | `pr10h5`, `pr10h11` | out of scope (audit) |
| POST | `/api/review-monitor/replies/:id/approve` | none | n/a | none | — | **gap** — no re-gate (composer pattern not followed) |
| POST | `/api/safe-agent/approve/:id` | none (`governSafe` after) | before-execute | none | `pr10h4` (propose only) | **gap** — executes stored proposal without re-scan |
| POST | `/api/social-drafts/:id/submit-approval` | heuristic `selfHealDraft` only | before status change | in `meta.self_heal` | `pr10h6` | **gap** — not `gateRouteText` |
| POST | `/api/social-drafts/:id/approve` | none | before publish | none | `pr10h6` | **gap** |
| POST | `/api/approval-workflows/approve/:id` | none | workflow state | n/a | — | out of scope — generic workflow shell; content varies |
| POST | `/api/agent-orchestrator/**/approve*` | orchestrator tier | action-tier | n/a | — | out of scope — PR10H action-tier (`default_mode: shadow`); separate from Step 6 content gate |

---

### E. Publishing (external delivery)

| Method | Path | Gate | Timing | Warnings | Tests | Class |
|--------|------|------|--------|----------|-------|-------|
| POST | `/api/publish-to-wordpress` | `gateRouteText` on `content` | before WP API call | block body only; **success omits warnings** | — | covered (warning gap) |
| POST | `/api/wordpress/publish` | none | n/a | none | — | **gap** — second publish path, no scan |
| POST | `/api/social-drafts/:id/publish` | approval authz only | before Zernio | none | `pr10h6` | **gap** |
| POST | `/api/social-publisher/post` | approval block only | before Zernio | none | `pr10h6` | **gap** |
| POST | `/api/marketing-brief/:id/deliver` | none | sends stored brief | n/a | — | **gap** — outbound Slack/email of stored copy without re-gate |
| POST | `/api/whatsapp-channel/send` | none | n/a | n/a | — | out of scope — operator-initiated channel send with user body; defer to channel-specific tranche |

---

## Coverage statistics (in-scope routes)

| Class | Count (approx.) | Notes |
|-------|-----------------|-------|
| **covered** | 44 | Includes partial `reddit-monitor` and `ai-attack-plan` warning persistence gap |
| **gap** | 38 | Publish path, ungated generate, save-without-gate, approve-without-rescan |
| **out of scope** | 12 | Audit-only, TTS, research signals, orchestrator action-tier |

---

## Confirmed gaps → bounded implementation PRs

Ordered by **risk** (external exposure × bypass likelihood). Each PR should stay ≤ 1,500 additions + deletions.

### PR-1 — Social publish path (highest risk)

**Routes:** `POST/PATCH /api/social-drafts/*`, `POST /api/social-drafts/:id/{submit-approval,approve,publish}`, `POST /api/social-publisher/post`

**Work:**
- Add `gateRouteText` on create, patch, approve, and publish (scan `text` + normalized platforms).
- Persist `content_safety_warnings` on draft row / `meta`.
- Replace or augment heuristic-only `selfHealDraft` submission gate with orchestrator-aligned scan.
- Wire `ContentSafetyWarnings` in social draft UI panels.
- Tests: `test/pr10h14-social-draft-safety.test.js` + UI harness; extend `content-safety-enforcement.yml`.

**Risk:** User/composer/AI copy reaches external social networks without deterministic Step 6 gate today.

---

### PR-2 — WordPress publish unification

**Routes:** `POST /api/wordpress/publish`

**Work:**
- Gate `title` + `content` + `excerpt` via `gateRouteText` before `_wpRequest`, matching `/api/publish-to-wordpress` behaviour.
- Fail closed on `content_safety_unavailable`.
- Tests: `test/pr10h14-wordpress-publish-safety.test.js`

**Risk:** Ungated duplicate publish path bypasses gated `ai_content` route.

---

### PR-3 — Approve-without-rescan

**Routes:**
- `POST /api/review-monitor/replies/:id/approve`
- `POST /api/safe-agent/approve/:id`

**Work:**
- Re-scan stored copy at approve time (mirror `campaign_composer` `_gateDraft` pattern).
- Block 403/503 before status flip / execution.
- Tests: extend `pr10h7`, `pr10h4`.

**Risk:** Stale or hand-edited DB rows bypass generation-time gate.

---

### PR-4 — User save without gate

**Routes:**
- `POST /api/launch-compliance/checklists` (`ad_copy`)
- `POST/PUT /api/review-monitor/request-rules` (`message_template`)

**Work:**
- Gate on create/update before INSERT/UPDATE.
- Persist warnings on checklist / rules row.

**Risk:** Prohibited copy enters DB and later surfaces in proofread/publish flows.

---

### PR-5 — `market_signals` remaining AI copy routes

**Routes:** `/api/reddit-autofill`, `/api/seed-topic-suggest`, `/api/templates/recommend`, `/api/intent-map`, `/api/keyword-page-map`, `/api/icp-draft`, `/api/icp-voc`

**Work:**
- Add normalizers to `content_schemas.js` where missing.
- Wire `_gateMarketText` before return (same pattern as `reddit-reply`).
- Tests: `test/pr10h14-market-signals-safety.test.js`

**Risk:** Market Signals panel generates publishable copy outside gated subset.

---

### PR-6 — Tier-2 `/generate` surfaces

**Routes:** `content_brief`, `content_calendar`, `content_modes`, `landing_pages`, `pitch_deck`, `battle_cards`, `wireframe`, `growth_ops/reengage`, `reddit_pulse`, `reply_assistant`, `seo_autopilot/reddit-aeo`, `creator_studio` generators, `chatbot_builder`, `brand_dna`, `ab_designer`, `infographics`, `llm_kb`

**Work:** Batch by product tier (see `docs/tiers.md`). Shared helper extraction per module; one tier per PR if needed for size cap.

**Risk:** Medium — internal drafts; lower immediate external exposure than PR-1–3.

---

### PR-7 — Consistency and warning persistence

**Items:**
- `POST /api/publish-to-wordpress` — attach `content_safety_warnings` on success in warning-only mode.
- `POST /api/ai-attack-plan` — persist warnings on saved plan entry.
- `GET /api/marketing-brief/merged` — surface `content_safety_blocked` / `unavailable` instead of silently keeping stale brief.

**Risk:** Low — enforcement works; operator visibility and data hygiene only.

---

## Test evidence index

| Test file | What it proves |
|-----------|----------------|
| `test/content-safety-enforcement.test.js` | `gateGeneratedContent`, `governContent`, marketing brief gate |
| `test/pr10h4-content-safety-approval.test.js` | `route_gate`, safe-agent propose, warning-only mode |
| `test/pr10h5-step6-content-gates.test.js` | Composer generate, launch proofread, market_signals gated paths; documents **partial** Step 6 |
| `test/pr10h5-content-schemas.test.js` | Normalizer / gate-text helpers |
| `test/pr10h6-social-publish-approval.test.js` | Approval **workflow** only — not content-safety gates |
| `test/pr10h7-cold-email-review-reply-safety.test.js` | Cold email + review reply generate |
| `test/pr10h8-press-ad-safety.test.js` | Press release + ad creative |
| `test/pr10h9-ad-copy-safety.test.js` | Ad copy paths + persistence |
| `test/pr10h10-composer-draft-save-safety.test.js` | Composer PUT save |
| `test/pr10h11-composer-draft-approve-safety.test.js` | Composer approve + Postgres integration |
| `test/pr10h12-video-script-safety.test.js` | Video script generate |
| `test/pr10h13-carousel-safety.test.js` | Carousel generate + reload |
| `test/pr10h*-ui.test.js` | React `ContentSafetyWarnings` wiring |
| `test/ai-governance.test.js` | `governSafe` fail-open |
| `test/ai-governance-policy-permissions.test.js` | Policy CSRF, warning-only opt-in |
| `test/browser/content-safety-governance.test.js` | AI Governance Hub browser journey |

**CI:** `.github/workflows/content-safety-enforcement.yml` runs pr10h8–h13 suites + core governance tests. Does **not** yet run `pr10h5`, `pr10h7`, or social paths.

---

## Acceptance criteria — marking Step 6 complete

Step 6 may be marked **Done** only when **all** of the following hold:

1. **Inventory closure** — Every route in sections A–E classified `gap` above is either implemented (`covered`) or explicitly reclassified `out of scope` in this document with product sign-off.

2. **Gate before side effects** — For every in-scope generate, save, approve, and publish route: `gateRouteText` or `gateGeneratedContent` runs **before** INSERT/UPDATE, HTTP response with generated fields, or external API delivery. Blocked responses omit usable copy (`contentSafetyHttpBody`).

3. **Fail-closed unavailable** — Scanner/orchestrator throw → 503 `content_safety_unavailable`; no template fallback that returns prohibited text.

4. **Warning-only parity** — `content_safety_warnings` returned on success and persisted where the route persists copy (including publish success paths).

5. **Normalization** — LLM output passes through `content_schemas` (or equivalent) so gate text includes all publishable fields (nested JSON, secondary fields — see pr10h5 audience_rules / tone_note tests).

6. **Approve rescan** — Any route that transitions copy toward external delivery re-scans at approve time (campaign_composer pattern).

7. **No duplicate ungated publish paths** — Single gated path per destination (WordPress, social, email deliver).

8. **Tests** — Each covered module has API tests proving block-before-persist, unavailable-without-leak, warning-only warnings, and reload persistence where applicable; `content-safety-enforcement.yml` runs the full Step 6 suite with zero skips.

9. **UI** — Panels that display generated or stored copy render `ContentSafetyWarnings` when `content_safety_warnings` is non-empty.

10. **Documentation** — This file updated to **Status: Done** with final route table and PR references; `test/pr10h5-step6-content-gates.test.js` partial-completion assertions removed only after (1)–(9) pass.

Until then: **Step 6 remains Partial.**

---

## Related documents

- `docs/pr10h1-content-safety-enforcement.md` — PR10H.1 platform default and policy fields
- `services/ai_governance/route_gate.js` — HTTP gate helpers
- `services/ai_governance/content_schemas.js` — Allowed shapes and gate-text extractors
- `.github/workflows/content-safety-enforcement.yml` — Focused CI for gated modules
