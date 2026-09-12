# Canonical metrics consumers (PR10G.2)

Audit of services that read `computeCanonicalMetrics`, `readMetric`, or `/api/metrics/*`.

## Checked consumers

| Consumer | Status | Notes |
|---|---|---|
| `services/canonical_metrics/api.js` | OK (PR10G.1) | Exposes `availability`, `availability_reason`, `is_proxy` on metric endpoint |
| `components/features/manage/CanonicalMetrics.tsx` | OK (PR10G.1) | KPI cards show partial/unavailable suffixes and proxy labels |
| `services/weekly_report/api.js` | OK (PR10G.1) | `_metricDisplay` preserves availability; narrative skips unavailable facts |
| `services/ask_copilot/api.js` | **Updated** | Contribution budget recs gated when inputs not fully available |
| `services/growth_ops/routes.js` | **Updated** | Goals no longer fall back to legacy ad fetchers when canonical says unavailable |
| `services/okr/api.js` | **Updated** | ROAS family uses canonical detail; no legacy fallback on unavailable |
| `services/anomaly_detector/api.js` | **Updated** | Spend-scan skips waste/ROAS anomalies unless inputs are available (not partial) |
| `services/canonical_metrics/contribution.js` | **Updated** | Budget recommendations require fully available spend + ROAS inputs |
| `services/budget_board/api.js` | OK | Uses `computePacing` on spend events only — not canonical economics |
| `services/growth_ops/routes.js` (drip/amp legacy) | OK | Non-canonical metrics unchanged |

## Changes (PR10G.2)

- Added `services/canonical_metrics/consumer.js` shared helpers (`resolveConsumerMetric`, `formatMetricDisplay`, `isUsableForRecommendations`, `safeAvailabilityReason`).
- Growth Ops goals (`/api/goals/check`, `/api/goals/suggest`) return `metric_availability`, `metric_availability_reason`, `metric_is_proxy` for canonical ad metrics.
- OKR refresh returns the same metadata on auto-tracked key results.
- Anomaly spend-scan annotates skipped checks when canonical inputs are partial/unavailable.
- Contribution omits `budget_recommendations` when canonical spend or reported ROAS is not fully available.
- Ask Copilot omits contribution budget lines when `input_availability.usable_for_recommendations` is false.

## Deferred

| Consumer | Reason |
|---|---|
| `components/features/grow/Goals.tsx` | Backend now supplies metadata; UI badges deferred to keep diff small |
| `components/features/manage/MarketingOKR.tsx` | Same — refresh API carries metadata for a follow-up UI pass |
| `services/canonical_metrics/compute.js` `goals_vs_actuals` | Reads stored OKR/agent goal rows, not live canonical recompute |
| Budget Board pacing anomalies in `anomaly_detector` | Uses `spend_events` directly (out of canonical economics scope) |

## Rules for new consumers

1. Use `readMetricDetail` or `resolveConsumerMetric` — not raw snapshot fields with `\|\| 0`.
2. Valid measured zero displays as `0`; unavailable displays as unavailable with `safeAvailabilityReason`.
3. Partial values keep a visible partial label; proxies keep a proxy label.
4. Automated recommendations require `isUsableForRecommendations(availability)` (fully available only).
