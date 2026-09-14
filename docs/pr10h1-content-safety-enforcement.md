# PR10H.1 — Default Content Safety Enforcement

## Summary

Generated marketing content is checked before it is returned. **Enforce** is the platform default; tenants may opt into **warning-only** mode with `tenant.settings.manage`, CSRF-protected policy updates, and an audit event.

## Enforced surfaces

| Surface | Hook | Checks |
|---------|------|--------|
| `services/ai/chat_router.js` `chatForCategory` | `gateGeneratedContent` after LLM response | PII, brand/compliance patterns, claim citation |
| `services/marketing_brief/generator.js` `generateBrief` | `gateGeneratedContent` before persist | Same |
| `services/ai_governance/orchestrator.js` `govern` | All `generate_*` / content surfaces | Same + action-tier rules for publish/send/launch |

## Checks (deterministic)

| Check | Source | Verdict |
|-------|--------|---------|
| `pii` | `services/ai_governance/brand_rules.js` (privacy-style patterns) | `block` |
| `brand_compliance` | FTC/FCA/ASA-themed phrase rules | `block` or `caution` |
| `claim_citation` | Uncited `%` / `ROAS` | `caution` |
| `gate_health` | Gate/orchestrator failure | `unavailable` → fail closed for content |

LLM-based `services/brand_safety/check` is **not** invoked on every generation (latency); deterministic rules mirror its themes.

## Policy fields

- `content_safety_mode`: `enforce` (default) \| `warning_only`
- `content_safety_explicit`: `true` when tenant authorised warning-only
- `default_mode`: unchanged (`shadow`) — action-tier publish/send/launch behaviour

## Existing tenants

Rows without `content_safety_explicit` migrate to `enforce` on schema boot. Explicit `warning_only` choices are preserved.

## Not in scope

- Replacing Safe Agent, launch compliance, or orchestrator human approval flows
- Global action-tier enforce flip
- LLM brand-safety on every token stream

## Tests

- `test/content-safety-enforcement.test.js`
- `test/browser/content-safety-governance.test.js` (when `PR10H1_REQUIRE_BROWSER=1`)
