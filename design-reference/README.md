# InfoGenie design reference

Companion materials for [`DESIGN.md`](../DESIGN.md) at the repository root.

## Purpose

These assets and screenshots illustrate the **implemented** visual design. They are references for redesign fidelity — not a new design system. If a screenshot is missing or stale, `DESIGN.md` remains authoritative.

## Assets (`assets/`)

| File | Role |
|------|------|
| `favicon.svg` | Brand mark / favicon (teal→sky mark) |
| `marketing.webp`, `sales.webp`, `analyst.webp`, `content.webp`, `seo.webp`, `cro.webp`, `finance.webp`, `ops.webp`, `technical.webp` | AI Team officer portrait placeholders used in roster cards |

Originals live under `public/` (e.g. `public/avatars/ai-team/`, `public/favicon.svg`). Copies here are for portability only — do not treat this folder as the runtime source.

## Screenshots (`screenshots/`)

Captured from the running app (desktop 1440×900 unless noted). Filenames:

| File | Demonstrates |
|------|----------------|
| `01-login-desktop.png` | Auth split layout, atmospheric orbs, frosted form panel, brand hero |
| `08-login-mobile.png` | Auth stacked mobile (390×844) |
| `02-shell-dashboard.png` | App rail + topbar + workspace marketing command / analyse home |
| `03-ai-team.png` | AI Team roster, pastel hero, violet tab accent, officer cards |
| `04-technical-manager.png` | TM desk at `/ai-team/technical-manager` — dark tech hero exception |
| `05-goals-hub.png` | Goals Hub chrome — indigo tabs, related pills, empty Targets state |
| `06-metrics-ssot.png` | Metrics SSOT KPI chips (measured/modelled) inside Goals Hub |
| `07-contribution.png` | Contribution record — warm wash, kind chips, channel table |
| `09-shell-mobile.png` | Mobile shell / content (390×844) |
| `10-onboarding-modal.png` | First-run wizard — blue→aqua header (legacy Signal gradient) |

## How to regenerate screenshots

With Next on `:5000`, Express on `:8000`, and demo user available:

```bash
node scripts/capture-design-screenshots.mjs
```

Set `localStorage.ig_onboarded = "1"` (or click Skip) when capturing authenticated tool pages so the welcome modal does not obscure them. Technical Manager URL: `/ai-team/technical-manager`.
