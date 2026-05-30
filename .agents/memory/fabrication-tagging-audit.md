---
name: Fabrication tagging audit (honesty data-mode)
description: What counts as a taggable fabrication for data-mode enforcement, and the surfaces deliberately left untagged.
---

# Tagging fabricated data for honesty mode

The enforcement interceptor (`services/admin/enforcement.js`) is marker-driven:
it only acts on a response carrying `source ∈ {placeholder, fallback, template,
serp-fallback, demo, mock, sample}`, `_estimated:true`, or `_fabricated:true`,
scanned top-level + 1 level deep (depth 2). To make a fabrication honest you
tag the *response object* (or a nested object within 2 levels) — no per-route
code.

## The rule: tag synthetic data presented as real; do NOT tag legitimate surfaces
**Tag** when the payload is synthetic/hardcoded/ungrounded-LLM data dressed as
real measurements/intel:
- Static fake competitor metrics (INDUSTRY_DB competitors — traffic/ctr/roas/
  budgets). Stamped via an IIFE in `data.js` (`source:'demo'`+`_estimated`).
- Template fallbacks substituting for AI output when AI is unavailable.
- Ungrounded LLM numbers — e.g. a prompt that says "make the data realistic and
  varied" (social_listening `/sentiment-trend`) → `_estimated:true`.

**Do NOT tag** (tagging would wrongly withhold real functionality in strict):
- Product catalogs / UI manifests (roadmap PLAN, signal types, schema TYPES,
  omnichannel channel list, playbook structure, unified_inbox metadata).
- Real config/status responses (env-based "configured?" flags).
- Honest empty states / zeroed DB-unavailable fallbacks (true_roas, voc empty).
- Real-data proxies clearly noted (web_analytics relabels real ad clicks as
  sessions with a transparent `note`).
- Perplexity/web-grounded LLM output — the codebase treats these as real (e.g.
  social_listening `/scan` = `source:'perplexity_sonar'`, media_intel scan).
- Genuine user-requested AI generative content (video scripts, carousels,
  headline tester) — the product working as intended.

## Big false-positive trap: helpers vs routes
Most `_template*` helper functions (`_templateSequence`, `_templateCalendar`,
`_templateVariants`, `_templateSlides`, landing `_templatePage`) look untagged
in isolation, but their **routes already set `source='template'` on the
response** (cold_email, content_calendar, ab_designer, carousel, landing_pages).
Those are already covered — do not re-tag. Likewise tech_stack `/compare`: the
placeholder is inside `results[]` and caught at depth 1.

**Why:** a sweep that tags every helper or every catalog would break strict mode
across the product. Check where the response is actually emitted before tagging.
