# InfoGenie MVP — Agency tier

Greenfield **thin-and-deep** rebuild for agency marketing managers: multi-client workspaces, command center, reporting, and the Day 1–7 loop per client.

This project is intentionally separate from the full InfoGenie platform (`/` in this repo).  
Do not import or modify the legacy Express / SPA app from here.

## Agency pains covered

| Pain | MVP module | Status |
|------|------------|--------|
| Reporting eats the week | Weekly Reports + **Batch Reports** + white-label export | MVP |
| No single view across clients | **Command Center** — RAG board, alerts, last report, spend | MVP |
| Comp research doesn't scale | Analyse loop per client workspace | MVP |
| Tool sprawl / live data | **Connectors** + sync + anomaly alerts | MVP thin |
| Approvals chaos | **Approvals** queue + client review link | MVP thin |
| Capacity / profitability blind | **Capacity & Margin** dashboard | MVP thin |
| Proving ROI | **ROI narrative** + strict mode withhold | MVP |
| Brand / quality | Brand Foundation per workspace | MVP |
| New business audits | InstaReports + public share link | MVP |

### Thin Phase-2 slices (intentional, not full platform)

- **Connectors**: OAuth stub + live metric sync history; anomaly alerts on CPA/spend/conversions deltas
- **Approvals**: submit draft/campaign/report → pending queue → approve / request changes → `/review/[token]` client link
- **Capacity**: team utilization + retainer vs labor margin (weekly hours × rate × 4.3)

Not included (full-app depth): real Meta/Google OAuth, multi-touch attribution, PDF/Resend, bid optimizer, full automation builder.

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
