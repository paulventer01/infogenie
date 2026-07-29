# InfoGenie MVP — Agency tier

Greenfield **thin-and-deep** rebuild for agency marketing managers: multi-client workspaces, command center, reporting, and the Day 1–7 loop per client.

This project is intentionally separate from the full InfoGenie platform (`/` in this repo).  
Do not import or modify the legacy Express / SPA app from here.

## Agency pains covered

| Pain | MVP module | Status |
|------|------------|--------|
| Reporting eats the week | **Weekly Reports** — auto narrative, edit, export | MVP |
| No single view across clients | **Command Center** — severity alerts, owners, roster | MVP |
| Comp research doesn't scale | **Analyse loop** per client workspace | MVP |
| Tool sprawl | One Day 1–7 path + per-client integrations panel | Partial |
| Proving ROI | **Results** with honest illustrative mode + report tie-in | MVP |
| Brand / quality | **Brand Foundation** per workspace | MVP |
| New business audits | **InstaReports** + public share link | MVP |

## The loop (per client workspace)

| Day | Surface | Job |
|-----|---------|-----|
| — | Command Center | Monday standup — all clients, ranked alerts |
| — | Weekly Reports | Client-ready brief in minutes |
| — | InstaReports | Prospect audit + share link |
| 1 | Analyse → Dashboard | Market, competitors, ads, keywords |
| 2 | Campaigns + Landing | Launch from one brief |
| 3 | Brand + Create | Voice, content, cold email, creative |
| 5 | Reach | Email sequences / journey steps |
| 7 | Results | Honest funnel snapshot (illustrative until connected) |

## Run

```bash
cd mvp
npm install
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).

Demo access: any email + password `mvp` (local session cookie; no shared auth with the main app).

New sign-ins seed three demo client workspaces (Northwind, Beacon, Summit) for command-center testing.

## Stack

- Next.js 15 App Router + React 18
- File-backed agency store under `mvp/.data/agency.json` (gitignored)
- Optional `OPENAI_API_KEY` for richer analysis; otherwise deterministic scaffolds

## Scope rules

- Agency ops + per-client Day 1–7 nav only
- No AI Team / CTV / GSC mirrors / 200-panel sprawl
- Empty and unavailable states are explicit — never silent dummy metrics dressed as live data
- Phase 2: PDF export, Resend scheduling, live OAuth integrations, full white-label polish
