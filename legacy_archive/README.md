# Legacy Archive — retired `#view-*` panels

Archived on 2026-07-14. These legacy dashboard views were verified unreachable
(no Next.js route, no nav entry after the legacy navbar strip, no live inbound
`navigateTo` link) and were removed from the served page. Each directory holds
the view's markup (`panel.html`) and its view-builder code (`builder.js`) exactly
as removed, so any view can be restored by re-inserting both and re-adding a
dispatch entry.

| View id | Title | Removed from |
|---|---|---|
| `agent-swarm` | Multi-Agent Swarm (T102) | `public/js/ig_agentic_suite.js` + `index.html` |
| `ai-answer-sov` | AI Answer SOV | `public/js/ig_strategic_features.js` + `index.html` |
| `aivisibility` | AI Visibility (renamed dup of `search-intel`) | `index.html` (builder `buildAiVisibility` kept — still used by live social flows) |
| `approval-workflows` | Approval Workflows | `public/js/ig_strategic_features.js` + `index.html` |
| `brand-dna` | Brand DNA / BYOM (T110) | `public/js/ig_agentic_suite.js` + `index.html` |
| `budget-arbitrage` | Cross-Platform Budget Arbitrage (T104) | `public/js/ig_agentic_suite.js` + `index.html` |
| `ctv` | CTV & Streaming Audio (T106; React replacement: CtvStreaming) | `public/js/ig_agentic_suite.js` + `index.html` |
| `data-products` | Proprietary Data Products | `public/js/ig_strategic_features.js` + `index.html` |
| `experiment-suite` | Experiment Suite | `public/js/ig_strategic_features.js` + `index.html` |
| `llm-kb` | LLM Knowledge Base auto-submit (T108) | `public/js/ig_agentic_suite.js` + `index.html` |
| `llm-scan` | AI Search Visibility — Live LLM Scan | `public/js/ig_intel_pack_b.js` + `index.html` + `app.js` dispatch (AiTeam link retargeted to `search-intel`) |
| `microsoft-ads-insights` | Microsoft Ads Insights (T14 #3) | `public/js/ig_intel_pack_a.js` + `index.html` + `app.js` dispatch (server API routes left in place) |
| `plan` | Competitor Execution Plan | `public/js/ig_plan_view.js` (whole file) + `index.html`; `openCompPlan` in `app.js` now guards |
| `privacy-compliance` | Privacy Auto-Compliance (T109) | `public/js/ig_agentic_suite.js` + `index.html` |
| `rcs` | RCS & Apple Messages (T107; React replacement: RcsCampaigns) | `public/js/ig_agentic_suite.js` + `index.html` |
| `revenue-intel` | Revenue Intelligence | `public/js/ig_strategic_features.js` + `index.html` |
| `roi-ledger` | AI ROI Ledger | `public/js/ig_agentic_suite.js` + `index.html` |
| `ss-events` | Server-Side Event Manager (T105) | `public/js/ig_agentic_suite.js` + `index.html` |
| `voiceovers` | AI Voiceovers (renamed dup of React `voiceover`) | `app.js` (builder + dispatch) + `index.html` |
| `workflow-builder` | Visual Workflow Builder (T111) | `public/js/ig_agentic_suite.js` + `index.html` |

## Verified reachable — flagged and KEPT (not archived)

- **`home`** — live: Navbar "+ Analyse" and `/` / `/analyse` routes show the legacy home panel.
- **`brand-foundation`** — live: React GrowthMethodology / Customer360 / Benchmarks call `navigateTo("brand-foundation")`.
- **`decision-engine`** — live: MarketingBrief's Top Priorities panel opens it via `navigate('decision-engine')` (window.navigateTo, URL unchanged, panel stays visible).

## Dangling links repointed

- `components/features/aiteam/AiTeam.tsx` — `llm-scan` → `search-intel`.
- `components/features/manage/Automations.tsx` — `aivisibility` → `search-intel`.
