# InfoGenie deep audit — navigation, overlap, and live checks

**Date:** 2026-08-07  
**Branch:** `cursor/priority-gaps-complete-767a`  
**Scope:** All 6 nav groups, migrated React registry, major `/api/*` mounts, live smoke tests.

---

## Executive verdict

InfoGenie is a large, mostly-wired marketing OS (~246 unique nav destinations, ~292 React panels, ~256 API mounts). **Navigation destinations resolve**, but the product surface has **real duplication and workflow sprawl**. Critical exact menu duplicates and a Grow section-order bug were fixed in this pass. Broader consolidation (budget/SEO/calendar hubs) remains recommended.

| Layer | Count |
|-------|------:|
| Menu items (unique views) | ~246 |
| Exact duplicate view IDs (before fix) | 4 |
| Exact duplicate view IDs (after fix) | 0 |
| React registry panels | ~292 |
| API mounts | ~256 |
| Permission matrix route groups | ~198 |
| Unmapped API mounts (enforcement gaps) | ~70 |
| Nav views missing matrix permission | ~59 |

---

## Intended workflow (canonical)

```
Brief → Analyse (understand) → Create (assets) → Reach (distribute)
  → Grow (optimize ROI) → Manage (calendars · budgets · reports)
  → AI Team (officers · capacity · meetings · AI control)
```

| Group | Job | Keep as primary for |
|-------|-----|---------------------|
| **Brief** | Daily AI director | `marketing-brief` |
| **Analyse** | Market / SEO / competitive truth | Rankings, competitors, GEO/AEO, site health |
| **Create** | Make assets | Content, creative, pages, campaign plans |
| **Reach** | Put assets in market | Audiences, leads, paid, social publish, SEO ops |
| **Grow** | Improve performance | Goals, ad insights, ROAS, CRO/SEO growth |
| **Manage** | Operate the machine | Calendars, budgets, reports, admin |
| **AI Team** | Human+AI operating team | Officers, capacity, minutes, providers, governance |

---

## Fixes applied in this audit pass

1. **Removed exact nav duplicates**
   - `analytics-hub` — Analyse only (removed Grow “GSC & GA4 Hub” re-list)
   - `bulk-rewriter` — Create only (removed Grow re-list)
   - `social-publisher` — Reach only (removed Manage re-list; Manage keeps Social Calendar)
   - `agent-goals` — Grow only (removed Manage re-list)
2. **Fixed Grow section order** — “4 · Improve SEO & conversion” now before “5 · Next-gen ad channels”
3. **AI Team Team ops** — Capacity, Minutes, AI Providers, AI Governance listed under AI Team; removed from Manage duplicates; bookmark paths preserved via `VIEW_TO_PATH` overrides
4. **Migration gap** — Added `aeo-optimizer`, `autoclaw`, `lead-intelligence` to `MIGRATED_VIEWS` (were registry-only → SpaRouter race risk)

---

## Live smoke results

### Pages
- **246/246** unique nav paths returned HTTP 200/3xx via Next (`:5000`) — no dead menu routes at the HTTP layer.
- Sample authenticated shells (`/manage/capacity`, `/ai-team/technical-manager`, `/manage/canonical-metrics`, `/manage/budget-board`, `/grow/agent-goals`, etc.) load the SPA shell successfully.

### APIs (authenticated demo tenant)
| Endpoint | Result | Note |
|----------|--------|------|
| `/api/health` | 200 | OK |
| `/api/capacity/summary` | 200 | OK |
| `/api/technical-manager/scan` | 200 | OK |
| `/api/metrics/canonical` | 200 | OK |
| `/api/officer/meetings` | 200 | OK |
| `/api/ai-providers/list` | 200 | OK |
| `/api/ai-governance/status` | 200 | OK |
| `/api/budget/status` | 200 | OK |
| `/api/optimizer/status` | 200 | OK |
| `/api/agent-goals` | 200 | OK |
| `/api/calendar-assistant/master` | 200 | OK |
| `/api/marketing-brief/today` | 200 | OK |
| `/api/true-roas/summary` | 200 | OK |
| `/api/model-compare/models` | 200 | OK |
| `/api/flywheel/summary` | (use `/summary` not `/status`) | Thin summary API |
| `/api/weekly-report/runs` | (use `/runs` / `/preview`) | No `/latest` |
| `/api/safe-agent/proposals` | (use `/proposals` not `/status`) | OK when correct path |
| `/api/seo-auditor/*`, `/api/content-score/*` | vary | History paths are POST/other — not all have GET `/history` |

**Caveat:** HTTP 200 on a page shell ≠ every button/integration works. Many features need third-party keys (Meta, Google Ads, Semrush, etc.) and will degrade gracefully or show empty states without them.

---

## Remaining overlap (consolidate next)

### P0 — high user confusion
1. **Budget trio** — `budget` + `budget-board` + `budget-caps` (+ arbitrage API). Merge into one Budget Hub with tabs.
2. **Goals stack** — `goals` + `agent-goals` + `marketing-okr` + `kpi-tracker` + `canonical-metrics`. Keep Goals + Canonical Metrics; demote the rest to tabs/links.
3. **SEO / AI visibility** — `seo-auditor`, `seo-crawler`, `geo-audit`, `aeo-optimizer`, `zero-click-hub`, `voice-seo`, `search-intel`, `autoseo`, `seo-growth-autopilot`, `content-score` vs `contentscorer`. One Search & AI Visibility hub.
4. **Calendars** — `master-calendar`, `brand-calendar`, `content-calendar`, `calendar-assistant`, `social`, `launches`. Master Calendar as shell; others as layers.

### P1 — product clarity
5. **Meetings** — `meeting-notes` (BANT summarize) vs `team-meetings` (AI Team minutes). Keep both but rename clearly (done partially).
6. **Landing builders** — `landing-pages` / `landing-builder` / `site-builder`.
7. **Creative generators** — `creative` / `smart-creative` / `ad-creative`.
8. **Organic social** — `organic-social` / `social-analytics` / `social-listening` / `post-performance`.
9. **Referrals vs affiliates** — `referral-manager` vs `affiliate-hub`.
10. **Technical Suite vs Technical Manager** — admin toolkit vs officer desk; keep both, clarify labels.

### Low-value / thin candidates (hub or archive)
- AutoSEO “Coming Soon” live rankings (`Autoseo.tsx`)
- Scorelet pack (many 2-route APIs: presence/influence/intent/AVE…)
- Sidebar-hidden Analyse spies (~42 deep-link-only views) — keep behind Intelligence Hub
- Thin wrappers: `voice-seo`, `zero-click` over `geo_audit`
- `seo-roadmap` KV todo tracker
- Omnichannel channels that return `stub: true` without providers

---

## Permission / alignment gaps

- ~**70** API mounts not in `ROUTE_GROUPS` (including `/api/officer`, `/api/ask`, `/api/budget-caps`, `/api/model-compare`, `/api/safe-agent`) — risky if `PERMISSION_ENFORCEMENT=on`.
- ~**59** nav/registry views lack `COMPONENT_MATRIX` keys.
- Mis-gated examples: `ai-governance` → `grow.campaigns.view`; `technical-manager` → bare `dashboard.view`.
- Component folder ≠ nav group for ~20 tools (e.g. AEO under `features/reach` but Analyse nav).

---

## Recommended next build sequence

1. Ship this nav cleanup (done).
2. Budget Hub consolidation + Canonical Metrics as SSOT for spend/ROAS widgets.
3. Search & AI Visibility hub (collapse GEO/AEO/zero-click/voice + auditor).
4. Master Calendar shell.
5. Permission matrix catch-up before turning enforcement on in production.
6. Archive or hub the scorelet/spy pack.

---

## How to re-run smoke checks

```bash
# Login + probe nav paths / key APIs (see agent scripts) against
# Next :5000 and Express :8000 with demo@infogenie.local / preview123
npx tsx -e 'import { NAV_GROUPS, viewToPath, ALL_VIEW_IDS } from "./lib/viewRoutes";
console.log([...ALL_VIEW_IDS].length, "views");
'
```
