# InfoGenie MVP

Greenfield **thin-and-deep** rebuild of the InfoGenie Day 1–7 loop.

This project is intentionally separate from the full InfoGenie platform (`/` in this repo).  
Do not import or modify the legacy Express / SPA app from here.

## The loop

| Day | Surface | Job |
|-----|---------|-----|
| 1 | Analyse → Dashboard | Understand market, competitors, ads, keywords |
| 2 | Campaigns + Landing | Launch from one brief |
| 3 | Brand + Create | Voice, content, cold email, creative |
| 5 | Reach | Email sequences / journey steps |
| 7 | Results | ROAS / funnel snapshot + weekly report draft |

## Run

```bash
cd mvp
npm install
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).

Demo access: any email + password `mvp` (local session cookie; no shared auth with the main app).

## Stack

- Next.js 15 App Router + React 18
- File-backed workspace store under `mvp/.data/` (gitignored)
- Optional `OPENAI_API_KEY` for richer analysis; otherwise deterministic scaffolds

## Scope rules

- Only MVP nav routes exist
- No AI Team / CTV / GSC mirrors / 200-panel sprawl
- Empty and unavailable states are explicit — never silent dummy metrics dressed as live data
