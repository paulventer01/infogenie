# Step 6 — Content Safety Coverage Audit

**Status:** Partial  
**Audited from:** `main` @ `7804cbe9` (2026-09-16)  
**Scope:** Routes that generate, regenerate, save/edit, approve, or publish marketing copy toward external delivery.

One **canonical row** per `method + path`. Lifecycle sections below reference these rows by **ID** only — they do not assign separate classifications.

---

## Executive summary

Step 6 (PR10H) runs deterministic brand/compliance + PII checks (`gateRouteText` / `gateGeneratedContent`) before copy is returned, persisted, or externally delivered. Default: **enforce**; tenants may opt into **warning-only** via AI Governance policy.

### Route totals (from §2 canonical inventory)

| Classification | Count | Meaning |
|----------------|------:|---------|
| **covered** | 30 | Gate before side effect; field scan complete |
| **partial** | 16 | Gate present but incomplete scan, timing, status, or warning handling |
| **gap** | 49 | In-scope lifecycle step with no Step 6 gate |
| **out of scope** | 30 | Deferred with explicit justification (§5) |
| **Total** | **125** | One row per `method + path` (CR-001–CR-124, CR-128) |

| Work queue | Count |
|------------|------:|
| Implementation batches (§4) | **22** batches covering all **65** gap/partial rows |
| Explicit deferrals (§5) | **30** out-of-scope rows (no batch) |
| Covered field-scan deferral | **1** row (CR-007 image pixels — see §5) |

**Step 6 is not complete.**

---

## 1. Shared gate architecture

```
HTTP handler → gateRouteText → gateGeneratedContent → scanOutput → governContent (fail-closed)
```

| Helper | Role |
|--------|------|
| `gateRouteText` | HTTP wrapper (`route_gate.js`) |
| `gateGeneratedContent` | Scan + govern (`hooks.js`) |
| `governSafe` | **Audit-only; fails open** — not an execution gate |
| `content_schemas.*` | Normalize → gate text (`content_schemas.js`) |

**Indirect:** `chat_router.chatForCategory` → `gateGeneratedContent` (library, not HTTP; see CR-128).

---

## 2. Canonical route inventory

### Column legend

| Column | Values |
|--------|--------|
| **Lifecycle** | `gen` generate · `regen` regeneration · `save` save/edit · `approve` approval · `publish` delivery |
| **Class** | `covered` · `partial` · `gap` · `out of scope` |
| **Field scan** | `complete` · `partial:<reason>` · `n/a` |
| **Batch** | Implementation batch ID (§4) or `defer` (§5) |

### Field-scan rules (reconciled with Class)

| Field-scan value | Class must be |
|------------------|---------------|
| `complete` | `covered` |
| `partial:…` | `partial` |
| `n/a` | `gap`, `out of scope`, or route gated on copy-adjacent prompt only (ad image generate) |

Routes using `JSON.stringify` for gate text without flattening are **`partial`** until PR-8c lands.

---

### 2.1 Campaign composer & ad/press/cold/video/carousel

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-001 | POST | `/api/campaign-composer/generate` | gen, regen | covered | `gateRouteText` + `composerDraftGateText` | complete | — | pr10h5, pr10h10 |
| CR-002 | PUT | `/api/campaign-composer/drafts/:id` | save | covered | `gateRouteText` + `composerDraftGateText` | complete | — | pr10h10 |
| CR-003 | POST | `/api/campaign-composer/drafts/:id/approve` | approve | covered | `gateRouteText` re-scan | complete | — | pr10h11 |
| CR-004 | POST | `/api/ad-creative/score` | gen | covered | `gateRouteText` + `adCopyGateText` | complete | — | pr10h8, pr10h9 |
| CR-005 | POST | `/api/ad-creative/ugc-script` | gen | covered | same | complete | — | pr10h9 |
| CR-006 | POST | `/api/ad-creative/from-landing-page` | gen | covered | same | complete | — | pr10h9 |
| CR-007 | POST | `/api/ad-creative/generate` | gen | covered | `gateRouteText` on built prompt | complete (copy); image pixels `defer` | defer | pr10h8, pr10h9 |
| CR-008 | POST | `/api/press-release/generate` | gen | covered | `gateRouteText` + `pressReleaseGateText` | complete | — | pr10h8 |
| CR-009 | POST | `/api/cold-email/generate` | gen | covered | `gateRouteText` + `coldEmailGateText` | complete | — | pr10h7 |
| CR-010 | POST | `/api/video-script/generate` | gen | covered | `gateRouteText` + `videoScriptGateText` | complete | — | pr10h12 |
| CR-011 | POST | `/api/carousel/generate` | gen | covered | `gateRouteText` + `carouselGateText` | complete | — | pr10h13 |

### 2.2 Review, compliance, safe agent, marketing brief

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-012 | POST | `/api/review-monitor/replies/generate` | gen | covered | `gateRouteText` + `reviewReplyGateText` | complete | — | pr10h7 |
| CR-013 | POST | `/api/review-monitor/replies/:id/approve` | approve | gap | none | n/a | PR-3a | — |
| CR-014 | POST | `/api/launch-compliance/checklists/:id/proofread` | gen | covered | `gateRouteText` + `proofreadGateText` | complete | — | pr10h5 |
| CR-015 | POST | `/api/launch-compliance/checklists` | save | gap | none | n/a | PR-4a | — |
| CR-016 | PUT | `/api/launch-compliance/items/:itemId` | save | out of scope | none | n/a | defer | — |
| CR-017 | POST | `/api/launch-compliance/checklists/:id/brand-check` | gen | out of scope | `governSafe` audit | n/a | defer | pr10h5 |
| CR-018 | POST | `/api/safe-agent/propose` | gen | partial | `gateRouteText` on `JSON.stringify` blob | partial:json-flatten | PR-8c | pr10h4 |
| CR-019 | POST | `/api/safe-agent/approve/:id` | approve | gap | none (`governSafe` after) | n/a | PR-3b | pr10h4 |
| CR-020 | GET | `/api/marketing-brief/today` | gen, regen | partial | `gateGeneratedContent` in `generateBrief` | partial:json-flatten | PR-8c | content-safety-enforcement |
| CR-021 | POST | `/api/marketing-brief/generate` | gen, regen | partial | same | partial:json-flatten | PR-8c | content-safety-enforcement |
| CR-022 | GET | `/api/marketing-brief/merged` | regen | partial | indirect via `generateBrief`; errors swallowed | partial:stale-on-block | PR-8b | — |
| CR-023 | POST | `/api/marketing-brief/:id/deliver` | publish | gap | none | n/a | PR-8b | — |

### 2.3 Market signals

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-024 | POST | `/api/reddit-reply` | gen | covered | `gateRouteText` + `redditReplyGateText` | complete | — | pr10h5, pr10h7 |
| CR-025 | POST | `/api/reddit-studio-suggest` | gen | covered | `gateRouteText` + `redditStudioGateText` | complete | — | pr10h5 |
| CR-026 | POST | `/api/ai-channel-ad` | gen | covered | `gateRouteText` + `channelAdGateText` | complete | — | pr10h5 |
| CR-027 | POST | `/api/ai-content-clusters` | gen | partial | `gateRouteText` + `contentClusterGateText` | partial:json-flatten | PR-8c | pr10h5 |
| CR-028 | POST | `/api/reddit-monitor` | gen | partial | AI `posts` only; HN/scoring ungated | partial:subset-fields | PR-5b | pr10h5 |
| CR-029 | POST | `/api/reddit-autofill` | gen | gap | none | n/a | PR-5 | — |
| CR-030 | POST | `/api/seed-topic-suggest` | gen | gap | none | n/a | PR-5 | — |
| CR-031 | POST | `/api/templates/recommend` | gen | gap | none | n/a | PR-5 | — |
| CR-032 | POST | `/api/intent-map` | gen | gap | none | n/a | PR-5 | — |
| CR-033 | POST | `/api/keyword-page-map` | gen | gap | none | n/a | PR-5 | — |
| CR-034 | POST | `/api/icp-draft` | gen | gap | none | n/a | PR-5 | — |
| CR-035 | POST | `/api/icp-voc` | gen | gap | none | n/a | PR-5 | — |
| CR-036 | POST | `/api/competitor-news` | gen | out of scope | none | n/a | defer | — |
| CR-037 | POST | `/api/trends` | gen | out of scope | none | n/a | defer | — |
| CR-038 | POST | `/api/reddit-signals` | gen | out of scope | none | n/a | defer | — |

### 2.4 `ai_content` routes

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-039 | POST | `/api/ai-visibility-audit` | gen | covered | `_respondGatedJson` (audit text) | complete | — | — |
| CR-040 | POST | `/api/ai-brand-monitor` | gen | covered | `_respondGatedJson` (report text) | complete | — | — |
| CR-041 | POST | `/api/ai-build-content` | gen | covered | `_respondGatedJson` (scanText) | complete | — | — |
| CR-042 | POST | `/api/ai-content-brief` | gen | covered | `_respondGatedJson` (brief) | complete | — | — |
| CR-043 | POST | `/api/ai-social-caption` | gen | covered | `_respondGatedJson` (caption) | complete | — | — |
| CR-044 | POST | `/api/reengage-copy` | gen | covered | `_respondGatedJson` | complete | — | — |
| CR-045 | POST | `/api/agency-report` | gen | partial | `_respondGatedJson` (`JSON.stringify`) | partial:json-flatten | PR-8c | — |
| CR-046 | POST | `/api/ai-creative` | gen | partial | `_respondGatedJson` (`JSON.stringify`) | partial:json-flatten | PR-8c | — |
| CR-047 | POST | `/api/ai-campaign-brief` | gen | partial | `_respondGatedJson` (`JSON.stringify`) | partial:json-flatten | PR-8c | — |
| CR-048 | POST | `/api/generate-article-topics` | gen | partial | `_respondGatedJson` (`JSON.stringify`) | partial:json-flatten | PR-8c | — |
| CR-049 | POST | `/api/backlink-opportunities` | gen | partial | `_respondGatedJson` (`JSON.stringify`) | partial:json-flatten | PR-8c | — |
| CR-050 | POST | `/api/keyword-research` | gen | partial | `_respondGatedJson` (`JSON.stringify`) | partial:json-flatten | PR-8c | — |
| CR-051 | POST | `/api/ai-attack-plan` | gen | partial | `_gateRoutePayload` before persist | partial:warnings-not-persisted | PR-8b | — |
| CR-052 | POST | `/api/landing-page` | gen | partial | `_respondGatedJson` (`html` only) | partial:metadata-echo | PR-8d | — |
| CR-053 | POST | `/api/generate-seo-article` | gen | partial | `_respondGatedJson` (`content` only) | partial:title-echo | PR-8d | — |
| CR-054 | POST | `/api/publish-to-wordpress` | publish | partial | `gateRouteText` on `content` only | partial:title-unscanned; 403-not-503; no success warnings | PR-8a | — |

### 2.5 Social drafts & publisher

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-055 | POST | `/api/social-drafts/` | save | covered | `gateRouteText` + `socialDraftGateText` | complete | — | pr10h1a |
| CR-056 | POST | `/api/social-drafts/bulk` | save | covered | `gateRouteText` + `socialDraftGateText` (atomic) | complete | — | pr10h1a |
| CR-057 | PATCH | `/api/social-drafts/:id` | save | covered | `gateRouteText` on merged draft | complete | — | pr10h1a |
| CR-058 | POST | `/api/social-drafts/:id/self-heal` | regen | covered | `gateRouteText` + `socialDraftGateText` on healed candidate | complete | — | pr10h1b |
| CR-059 | POST | `/api/social-drafts/:id/submit-approval` | approve | covered | `gateRouteText` on final copy (post self-heal) | complete | — | pr10h1b, pr10h6 |
| CR-060 | POST | `/api/social-drafts/:id/approve` | approve, publish | covered | `gateRouteText` re-scan before approve/publish | complete | — | pr10h1b, pr10h6 |
| CR-061 | POST | `/api/social-drafts/:id/publish` | publish | covered | `gateRouteText` re-scan before delivery | complete | — | pr10h1b, pr10h6 |
| CR-062 | POST | `/api/social-publisher/post` | publish | gap | approval block only | n/a | PR-1c | pr10h6 |

### 2.6 WordPress, review rules, tier-2 generate

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-063 | POST | `/api/wordpress/publish` | publish | gap | none | n/a | PR-2 | — |
| CR-064 | POST | `/api/review-monitor/request-rules` | save | gap | none | n/a | PR-4b | — |
| CR-065 | PUT | `/api/review-monitor/request-rules/:id` | save | gap | none | n/a | PR-4b | — |
| CR-066 | POST | `/api/reengage/generate` | gen | gap | none | n/a | PR-7c | — |
| CR-067 | POST | `/api/wireframe/generate` | gen | gap | none | n/a | PR-7b | — |
| CR-068 | POST | `/api/content-brief/generate` | gen | gap | none | n/a | PR-7a | — |
| CR-069 | POST | `/api/content-calendar/generate` | gen | gap | none | n/a | PR-7a | — |
| CR-070 | POST | `/api/content-modes/generate` | gen | gap | none | n/a | PR-7a | — |
| CR-071 | POST | `/api/landing-pages/generate` | gen | gap | none | n/a | PR-7b | — |
| CR-072 | POST | `/api/pitch-deck/generate` | gen | gap | none | n/a | PR-7b | — |
| CR-073 | POST | `/api/battle-cards/generate` | gen | gap | none | n/a | PR-7c | — |
| CR-074 | POST | `/api/chatbot-builder/generate` | gen | gap | none | n/a | PR-7e | — |
| CR-075 | POST | `/api/brand-dna/generate` | gen | gap | none | n/a | PR-7e | — |
| CR-076 | POST | `/api/ab-designer/generate` | gen | gap | none | n/a | PR-7e | — |
| CR-077 | POST | `/api/infographics/generate` | gen | gap | none | n/a | PR-7e | — |
| CR-078 | POST | `/api/llm-kb/generate` | gen | gap | none | n/a | PR-7e | — |
| CR-079 | POST | `/api/reddit-pulse/generate-reply` | gen | gap | none | n/a | PR-7c | — |
| CR-080 | POST | `/api/reply-assistant/draft` | gen | gap | none | n/a | PR-7c | — |
| CR-081 | POST | `/api/seo-autopilot/reddit-aeo/draft-reply` | gen | gap | none | n/a | PR-7c | — |
| CR-082 | POST | `/api/creator-studio/presentation/generate` | gen | gap | none | n/a | PR-7d | — |
| CR-083 | POST | `/api/creator-studio/signature/generate` | gen | gap | none | n/a | PR-7d | — |
| CR-084 | POST | `/api/creator-studio/case-study/generate` | gen | gap | none | n/a | PR-7d | — |
| CR-085 | POST | `/api/voiceover/generate` | gen | out of scope | none | n/a | defer | — |
| CR-086 | POST | `/api/audio-summary/generate` | gen | out of scope | none | n/a | defer | — |
| CR-087 | POST | `/api/schema-generator/generate` | gen | out of scope | none | n/a | defer | — |
| CR-088 | POST | `/api/dataset-market/generate` | gen | out of scope | none | n/a | defer | — |

### 2.7 Email Designer (`/api/email-designer`)

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-089 | POST | `/api/email-designer/ai-generate` | gen | gap | none | n/a | PR-6a | — |
| CR-090 | POST | `/api/email-designer/` | save | gap | none | n/a | PR-6a | — |
| CR-091 | PUT | `/api/email-designer/:id` | save | gap | none | n/a | PR-6a | — |
| CR-092 | POST | `/api/email-designer/:id/versions/:vid/restore` | save, regen | gap | none | n/a | PR-6a | — |
| CR-093 | POST | `/api/email-designer/:id/preview` | publish | gap | none | n/a | PR-6a | — |
| CR-094 | POST | `/api/email-designer/render` | publish | gap | none | n/a | PR-6a | — |
| CR-095 | GET | `/api/email-designer/` | — | out of scope | none | n/a | defer | — |
| CR-096 | GET | `/api/email-designer/:id` | — | out of scope | none | n/a | defer | — |
| CR-097 | DELETE | `/api/email-designer/:id` | — | out of scope | none | n/a | defer | — |
| CR-098 | GET | `/api/email-designer/:id/versions` | — | out of scope | none | n/a | defer | — |
| CR-099 | POST | `/api/email-designer/:id/spam-check` | — | out of scope | local heuristics | n/a | defer | — |

### 2.8 Site Builder (`/api/site-builder`)

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-100 | POST | `/api/site-builder/ai-generate` | gen | gap | none; persists before return | n/a | PR-6b | site-builder-isolation |
| CR-101 | POST | `/api/site-builder/page/:slug` | save | gap | none | n/a | PR-6b | site-builder-isolation |
| CR-102 | GET | `/api/site-builder/render/:slug` | publish | gap | none | n/a | PR-6b | — |
| CR-103 | GET | `/api/site-builder/pages` | — | out of scope | none | n/a | defer | — |
| CR-104 | GET | `/api/site-builder/page/:slug` | — | out of scope | none | n/a | defer | — |

### 2.9 LinkedIn Outreach (`/api/linkedin-outreach`)

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-105 | POST | `/api/linkedin-outreach/sequences/:id/ai-generate` | gen | gap | none; auto-saves messages | n/a | PR-6c | — |
| CR-106 | POST | `/api/linkedin-outreach/sequences` | save | gap | none | n/a | PR-6c | — |
| CR-107 | PUT | `/api/linkedin-outreach/sequences/:id` | save | gap | none | n/a | PR-6c | — |
| CR-108 | PUT | `/api/linkedin-outreach/contacts/:id/status` | — | out of scope | none | n/a | defer | — |
| CR-109 | GET | `/api/linkedin-outreach/config` | — | out of scope | none | n/a | defer | — |
| CR-110 | GET | `/api/linkedin-outreach/sequences` | — | out of scope | none | n/a | defer | — |
| CR-111 | GET | `/api/linkedin-outreach/contacts/:sequence_id` | — | out of scope | none | n/a | defer | — |
| CR-112 | POST | `/api/linkedin-outreach/contacts` | — | out of scope | none | n/a | defer | — |
| CR-113 | DELETE | `/api/linkedin-outreach/contacts/:id` | — | out of scope | none | n/a | defer | — |

### 2.10 RCS (`/api/rcs`)

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-114 | POST | `/api/rcs/campaigns/:id/ai-generate` | gen | gap | none | n/a | PR-6d | — |
| CR-115 | POST | `/api/rcs/campaigns/create` | save | gap | none | n/a | PR-6d | — |
| CR-116 | POST | `/api/rcs/campaigns/:id/send` | publish | gap | none | n/a | PR-6d | — |
| CR-117 | GET | `/api/rcs/config` | — | out of scope | none | n/a | defer | — |
| CR-118 | GET | `/api/rcs/campaigns` | — | out of scope | none | n/a | defer | — |
| CR-119 | GET | `/api/rcs/stats/:id` | — | out of scope | none | n/a | defer | — |

### 2.11 Other publish / approval deferrals

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-120 | POST | `/api/approval-workflows/approve/:id` | approve | out of scope | none | n/a | defer | — |
| CR-121 | POST | `/api/agent-orchestrator/**/approve*` | approve | out of scope | action-tier orchestrator | n/a | defer | — |
| CR-122 | POST | `/api/whatsapp-channel/send` | publish | out of scope | none | n/a | defer | — |
| CR-123 | GET | `/lp/:id` | publish | out of scope | none | n/a | defer | — |
| CR-124 | POST | `/api/brand-foundation/save` | save | out of scope | none | n/a | defer | — |

### 2.12 Library (non-HTTP)

| ID | Method | Path | Lifecycle | Class | Gate | Field scan | Batch | Tests |
|----|--------|------|-----------|-------|------|------------|-------|-------|
| CR-128 | — | `chat_router.chatForCategory` | gen | covered | `gateGeneratedContent` | complete | — | content-safety-enforcement |

---

## 3. Lifecycle index

References **CR-###** from §2. No separate classifications here.

| Lifecycle | Route IDs |
|-----------|-----------|
| **Generate** | CR-001,004–011,012,014,018–021,024–035,039–053,066–088,089,100,105,114,128 |
| **Regeneration** | CR-001,020–022,058,092,128 |
| **Save / edit** | CR-002,015,055–057,064–065,090–092,101,106–107,115,124 |
| **Approval** | CR-003,013,019,059–060,120–121 |
| **Publish / delivery** | CR-023,054,061–063,093–094,102,116,122–123 |

### Module lifecycle notes (reference only)

| Module | Generate | Save | Publish | Read/admin (defer) |
|--------|----------|------|---------|-------------------|
| Email Designer | CR-089 | CR-090–092 | CR-093–094 | CR-095–099 |
| Site Builder | CR-100 | CR-101 | CR-102 | CR-103–104 |
| LinkedIn Outreach | CR-105 | CR-106–107 | — (human send; CR-108 defer) | CR-109–113 |
| RCS | CR-114 | CR-115 | CR-116 | CR-117–119 |

**Email Designer:** no first-party `/send`; templates export to drip/campaign flows externally.

**Site Builder:** public HTML at `GET /api/site-builder/render/:slug` from `kv_store` `lp:<slug>`.

---

## 4. Implementation batches

**23 batches** covering all **72** gap/partial rows (every gap/partial row maps to exactly one batch in §4). Batch **size targets are estimates** (~200–800 lines each based on route count and test surface); they are **not guaranteed** to stay within any line budget — split further at implementation time if a batch grows.

| Batch | Routes (IDs) | Est. size | Risk |
|-------|----------------|----------:|------|
| **PR-1a** | — (merged) | — | High |
| **PR-1b** | CR-058,059,060,061 | ~600 lines | High |
| **PR-1c** | CR-062 | ~250 lines | High |
| **PR-2** | CR-063 | ~300 lines | High |
| **PR-3a** | CR-013 | ~200 lines | High |
| **PR-3b** | CR-019 | ~200 lines | High |
| **PR-4a** | CR-015 | ~200 lines | Medium |
| **PR-4b** | CR-064,065 | ~300 lines | Medium |
| **PR-5** | CR-029–035 (7) | ~700 lines | Medium |
| **PR-5b** | CR-028 | ~300 lines | Medium |
| **PR-6a** | CR-089–094 (6) | ~700 lines | High |
| **PR-6b** | CR-100–102 (3) | ~500 lines | High |
| **PR-6c** | CR-105–107 (3) | ~450 lines | Medium |
| **PR-6d** | CR-114–116 (3) | ~500 lines | High |
| **PR-7a** | CR-068,069,070 | ~450 lines | Medium |
| **PR-7b** | CR-067,071,072 | ~450 lines | Medium |
| **PR-7c** | CR-066,073,079,080,081 | ~600 lines | Medium |
| **PR-7d** | CR-082,083,084 | ~400 lines | Medium |
| **PR-7e** | CR-074,075,076,077,078 | ~550 lines | Low |
| **PR-8a** | CR-054 | ~250 lines | Medium |
| **PR-8b** | CR-022,023,051 | ~350 lines | Low |
| **PR-8c** | CR-018,020,021,027,045–050 (10) | ~800 lines | Medium |
| **PR-8d** | CR-052,053 | ~300 lines | Low |

### Batch acceptance criteria (summary)

| Batch | Done when |
|-------|-----------|
| PR-1a | Social create/edit/bulk gated before side effect; warnings persisted; 403/503 block without copy leak; bulk atomic |
| PR-1b–1c | Social approve/publish/post gated before side effect; warnings persisted; 403/503 block without copy leak |
| PR-2 | `wordpress/publish` gates title+content+excerpt; 503 unavailable; success warnings |
| PR-3a–3b | Approve re-scans stored copy before status flip / execution |
| PR-4a–4b | Save paths gate `ad_copy` / `message_template` before persist |
| PR-5, PR-5b | All market_signals copy routes gated; reddit-monitor scans full publishable payload |
| PR-6a–6d | Email Designer, Site Builder, LinkedIn, RCS lifecycles gated + module tests + UI warnings where applicable |
| PR-7a–7e | Tier-2 `/generate` routes gated before return/persist |
| PR-8a | `publish-to-wordpress` scans title+content; 503 unavailable; success warnings |
| PR-8b | Attack-plan warnings persisted; merged/deliver surface safety errors |
| PR-8c | JSON gate-text flattening; regression tests for escaped `\n`/`\t` and key-boundary splits |
| PR-8d | `landing-page` / `generate-seo-article` scan all echoed publishable fields |

---

## 5. Explicit deferrals (no implementation batch)

| ID | Justification |
|----|---------------|
| CR-007 | Image pixels not scanned; copy path gated via prompt — intentional |
| CR-016 | Checklist item status only; no copy mutation |
| CR-017 | `governSafe` audit-only by design (`pr10h1`) |
| CR-036–038 | Research/signal aggregation; not publishable copy |
| CR-085–088 | TTS, structured data, or analytics samples — not marketing prose |
| CR-095–099 | Read/admin; spam-check uses separate heuristics |
| CR-103–104 | Read-only page management |
| CR-108 | LinkedIn copy dispatched manually by operator; status tracking only |
| CR-109–113 | CRM/read paths; no copy generation or delivery |
| CR-117–119 | RCS read/stats |
| CR-120–121 | Generic / action-tier approval shells |
| CR-122 | Operator WhatsApp channel — separate product tranche |
| CR-123 | Legacy `landing_pages` table serve; gate via CR-071 when implemented |
| CR-124 | Brand config, not campaign copy |

---

## 6. Field-scan reference (covered & partial rows)

Aligned with §2 **Field scan** column. `complete` ↔ `covered`; `partial:*` ↔ `partial`.

| Normalizer / route IDs | Fields scanned | Delimiter | Notes |
|------------------------|----------------|-----------|-------|
| `composerDraftGateText` (CR-001–003) | draft + audience_rules conditions | `\n` / spaces | Tested: type, op, value |
| `redditReplyGateText` (CR-024) | reply, tone_note | `\n` | Tested |
| `pressReleaseGateText` (CR-008) | all release fields | `\n` | — |
| `coldEmailGateText` (CR-009) | per-email fields | `\n` | — |
| `videoScriptGateText` (CR-010) | hook, body lines, cta, hashtags | `\t` / `\n` | Escapes inside one field still scanned |
| `carouselGateText` (CR-011) | role, headline, body, visualHint | `\t` / `\n` | Same |
| `channelAdGateText` (CR-026) | headline, body, cta, hashtags | `\n` | — |
| `redditStudioGateText` (CR-025) | persona, titles | `\n` | — |
| `proofreadGateText` (CR-014) | summary, improved_copy, issues | `\n` | — |
| `adCopyGateText` (CR-004–006) | all leaf values | `\n` | — |
| `reviewReplyGateText` (CR-012) | reply | n/a | — |
| `socialDraftGateText` (CR-055–057) | text, meta alt fields | `\n` | Tested: newlines/tabs, alt_text |
| `ad_creative/generate` prompt (CR-007) | all input copy fields in prompt | space-joined | Image defer CR-007 |
| `_respondGatedJson` text routes (CR-039–044) | route-specific primary text | n/a | complete |
| `JSON.stringify` routes (CR-018,020–021,027,045–050) | whole payload | JSON | **partial:json-flatten** → PR-8c |
| CR-028 | AI `posts` subset only | — | **partial:subset-fields** → PR-5b |
| CR-051 | plan JSON | JSON | **partial:warnings-not-persisted** → PR-8b |
| CR-052 | `html` only | n/a | **partial:metadata-echo** → PR-8d |
| CR-053 | `content` only | n/a | **partial:title-echo** → PR-8d |
| CR-054 | `content` only | n/a | **partial:title-unscanned; 403-not-503** → PR-8a |
| CR-022 | brief JSON via `generateBrief` | JSON | **partial:stale-on-block** → PR-8b |

---

## 7. Test evidence index

| File | Canonical IDs |
|------|----------------|
| `test/content-safety-enforcement.test.js` | CR-020,021,128 |
| `test/pr10h4-content-safety-approval.test.js` | CR-018,019 |
| `test/pr10h5-step6-content-gates.test.js` | CR-001,014,024–028; **documents partial Step 6** |
| `test/pr10h5-content-schemas.test.js` | CR-001,024 normalizers |
| `test/pr10h1a-social-draft-save-safety.test.js` | CR-055,056,057 |
| `test/pr10h1a-social-draft-save-safety-ui.test.js` | CR-055,057 UI |
| `test/pr10h1b-social-draft-approval-publish-safety.test.js` | CR-058–061 |
| `test/pr10h1b-social-draft-approval-publish-safety-ui.test.js` | CR-058–061 UI |
| `test/pr10h6-social-publish-approval.test.js` | CR-059–062 (approval authz; safety in pr10h1b for CR-059–061) |
| `test/pr10h7-cold-email-review-reply-safety.test.js` | CR-009,012 |
| `test/pr10h8`–`pr10h13` | CR-004–011,001–003 |
| `test/site-builder-isolation.test.js` | CR-100,101 (tenant isolation, not safety) |
| `test/ai-governance*.test.js` | policy, `governSafe` fail-open |
| `test/browser/content-safety-governance.test.js` | AI Governance Hub |

**CI gap:** `.github/workflows/content-safety-enforcement.yml` runs pr10h8–h13; not pr10h5, pr10h7, or CR-089–116 modules.

---

## 8. Acceptance criteria — marking Step 6 complete

1. Every **gap** and **partial** row in §2 resolved to **covered** or reclassified **out of scope** with sign-off.
2. Gate before all persist / return / external delivery side effects.
3. **Field scan** column `complete` for all covered rows; no `partial:*` remaining.
4. Fail-closed **503** on `content_safety_unavailable`.
5. Warning-only: `content_safety_warnings` returned and persisted on success paths.
6. Approve/publish paths re-scan stored copy (CR-003 pattern).
7. No duplicate ungated publish paths.
8. All PR-1–PR-8 batches merged; module tests + CI zero skips.
9. `ContentSafetyWarnings` on panels showing gated copy.
10. This document → **Status: Done**; remove partial assertions from `pr10h5-step6-content-gates.test.js`.

**Until then: Step 6 remains Partial.**

---

## Related documents

- `docs/pr10h1-content-safety-enforcement.md`
- `services/ai_governance/route_gate.js`
- `services/ai_governance/content_schemas.js`
- `.github/workflows/content-safety-enforcement.yml`
