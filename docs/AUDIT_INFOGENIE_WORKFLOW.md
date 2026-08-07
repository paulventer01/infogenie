# InfoGenie deep audit — navigation, overlap, and live checks

**Date:** 2026-08-07  
**Branch:** `cursor/priority-gaps-complete-767a`  
**Scope:** All 6 nav groups, migrated React registry, major `/api/*` mounts, live smoke tests.

---

## Executive verdict

InfoGenie is a large, mostly-wired marketing OS (~246 unique nav destinations, ~292 React panels, ~256 API mounts). **Navigation destinations resolve**, but the product surface had **real duplication and workflow sprawl**. Exact menu duplicates, Grow section-order, and hub consolidations (Budget / SEO / Goals / Calendars / Create hubs) were addressed in this pass.

| Layer | Count |
|-------|------:|
| Menu items (unique views) | ~246 |
| Exact duplicate view IDs (after fix) | 0 |
| React registry panels | ~292 |
| API mounts | ~256 |
| Permission matrix route groups | ~270+ |
| Unmapped API mounts (after catch-up) | ~0–5 (auth edge cases) |
| Nav views missing matrix permission (after catch-up) | ~0 |

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

## Fixes applied

1. **Removed exact nav duplicates** — `analytics-hub`, `bulk-rewriter`, `social-publisher`, `agent-goals`
2. **Fixed Grow section order** — SEO/conversion before next-gen channels
3. **AI Team Team ops** — capacity, minutes, providers, governance under AI Team
4. **Budget Hub** — Overview / Board / Caps tabs; API family `/api/budget`, `/api/budget/caps`, `/api/budget/arbitrage` (legacy mounts kept)
5. **Search & AI Visibility hub** — GEO / AEO / zero-click / voice / auditor / crawler / Autoseo / Autopilot / Content Score; children demoted from Analyse/Reach/Grow sidebars
6. **`contentscorer` → `content-score`** — alias + registry points at Content Score
7. **Goals Hub** — full tabs: Marketing Goals · Targets · Metrics SSOT · OKRs · KPI Tracker
8. **Master Calendar shell** — Brand / Content / Social / Launches / Assistant / Publisher layers; Content Calendar demoted from Create nav
9. **Creative Studio / Pages & Sites / Organic Social Performance hubs** — Create/Analyse start-here entries; child tools deep-link only
10. **Label clarity** — Sales Meeting Notes (BANT) vs AI Team Minutes; Customer Referral vs Partner Affiliate; Technical Suite (admin toolkit) vs Technical Manager (officer desk)
11. **Permission matrix catch-up** — previously unmapped API prefixes + missing COMPONENT_MATRIX views; `ai-governance` / `technical-manager` re-gated
12. **Thin pack** — Autoseo tagged “Coming soon” on hub; Analyse scorelets/spies remain `SIDEBAR_HIDDEN_VIEWS`

---

## Live smoke results

### Pages
- Unique nav paths return HTTP 200/3xx via Next (`:5000`) when authenticated.
- Sample shells: `/manage/budget`, `/manage/budget-caps`, `/grow/agent-goals`, `/manage/marketing-okr`, `/grow/kpi-tracker`, `/create/creative-hub`, `/create/pages-hub`, `/analyse/organic-performance`, `/analyse/seo-ai-visibility`.

### APIs (authenticated demo tenant)
| Endpoint | Result |
|----------|--------|
| `/api/health` | 200 |
| `/api/budget` family (board + `/caps` + `/arbitrage`) | 200 when mounted |
| `/api/capacity/summary` | 200 |
| `/api/technical-manager/scan` | 200 |
| `/api/metrics/canonical` | 200 |
| `/api/officer/meetings` | 200 |
| `/api/agent-goals` | 200 |

**Caveat:** HTTP 200 on a page shell ≠ every button/integration works. Many features need third-party keys.

---

## Remaining / backlog (lower priority)

- Omnichannel channels that return `stub: true` without providers — keep behind Messaging Channels hub; hide stubs when no provider.
- Archive scorelet pack behind Intelligence Hub search only (already sidebar-hidden).
- Optional: embed calendar layer editors inside Master Calendar (currently tile launchers).
- Optional: Budget Hub Arbitrage tab UI (API already nested under `/api/budget/arbitrage`).

---

## How to re-run smoke checks

```bash
npx tsx -e 'import { NAV_GROUPS, ALL_VIEW_IDS } from "./lib/viewRoutes";
const seen = new Map();
for (const g of NAV_GROUPS) for (const s of g.sections) for (const i of s.items) {
  if (!i.view) continue;
  if (seen.has(i.view)) console.log("DUP", i.view, seen.get(i.view), g.key);
  else seen.set(i.view, g.key);
}
console.log([...ALL_VIEW_IDS].length, "views", seen.size, "nav items");
'
```
