# InfoGenie Intelligence Audit

Credibility for everything downstream starts with honest data mapping and compounding learning. This audit maps gaps, duplications, and the highest-leverage fixes shipped in this iteration.

## Verdict

InfoGenie already has strong competitive analysis, Decision Engine recommendations, Marketing Brief, predictions, crisis/anomaly detectors, and a Marketing Memory graph — but several surfaces **look authoritative while not learning or not telling the truth about provenance**. The product must: (1) map messy real-world data with least-setup wins and clear provenance, (2) diagnose problems with best-route actions + why, (3) learn from every act/dismiss, (4) surface future risks and opportunities across all pillars.

## Data mapping & credibility

| Area | Status | Problem | Best route |
|------|--------|---------|------------|
| Demo vs strict data modes, OAuth vaults, True ROAS, DataForSEO enrich | Strong | — | Keep as foundation |
| Analytics Hub “Connect” | Weak → fixed | Fake OAuth success overstated trust | Preview mode with explicit seeded provenance; real OAuth remains the upgrade path |
| `/api/live-kpis` | Weak → fixed | Labeled LIVE while ROAS/CTR are SERP + industry-derived | Label **DERIVED / market-derived**; reserve LIVE for ad-account truth |
| Onboarding → data connect | Gap | Users can skip mapping | Least-setup: analysis domain unlocks preview; Settings OAuth for account-truth |
| Provenance on analyse | Gap | Not auto-logged | Next: stamp source + freshness on every KPI card |

**Why this route:** Credibility compounds. Over-labeling “LIVE” poisons Budget, Brief, and Decision Engine trust. Honest derived labels + least-setup preview is better than fake connection theatre.

## Duplications (canonical surfaces)

| Concern | Overlaps | Canonical | Fold / rename |
|---------|----------|-----------|---------------|
| Daily actions | Brief, Action Queue, Decision Engine, Action Center | **Brief** = entry diagnosis; **Action Queue** = workbench | Decision Engine stays engine; Action Center → competitive playbook under Battle Plan |
| Budget | Budget Board, Budget hub, Caps | **Budget Board** | Caps as settings; hub as tab |
| Competitive attack | Battle Plan, War Room, Action Center | **Battle Plan** | Link others into it |
| Analytics | Analyse + Grow nav entries | One nav entry | Dedupe nav |

## Learning loop (was broken)

- Act / dismiss only stamped timestamps — **did not improve** the next Decision Engine run.
- Marketing Memory existed but was not fed act/dismiss outcomes.
- ROI actuals / experiment results largely unused.

**Shipped:** act/dismiss → `ingestMemoryNode`; `/analyse` injects category act-rates, preferred/avoided actions, and memory lessons; recommendations store `why_best`.

## Foresight (risks & opportunities)

Brief previously scanned optimizer, SERP, crisis (24h), SoV, battle cards, vitals, decisions, reviews — but **not** unresolved anomalies, prediction runs, or budget burn trajectory.

**Shipped:** Brief gathers anomaly + prediction + budget-risk + competitive foresight signals; AI/template emit Future Risks / Future Opportunities; Action Queue shows foresight + learning applied after refresh.

## Problem → solution → why (product standard)

Every action surface now aims for:

1. **Answer** — what is wrong / what opportunity exists  
2. **Recommendation** — what to do  
3. **Why best** — why this beats the obvious alternative  
4. **Follow-through** — deep-link to the executing tool  

## Strategic Intelligence moat (shipped)

New Manage surface: **Strategic Intelligence** (`/manage/strategic-intelligence`) + `/api/strategic/*`.

| Capability | What shipped |
|------------|--------------|
| Root-cause decomposition | Cause tree + ranked fix sequence + why-best |
| NL scenario modelling | “What if largest customer churns?” / “+8% price −5% volume” → base/downside/upside |
| Institutional memory | Business facts + decisions with 90-day review + outcome write-back into Marketing Memory |
| External benchmarking | “Should I be worried?” vs sector/network peers (e.g. CAC payback 14 vs ~9) |
| Write-back catalog | Queue mutations to Meta/Google/HubSpot/Slack/GA annotations — competitors stop at read |

Ask InfoGenie auto-routes scenario / root-cause / benchmark questions into this engine. Brief pulls due decision reviews as foresight signals.

## Recommended next waves

1. Wire real GSC/GA4 OAuth into Analytics Hub (replace preview).  
2. Live execute write-backs when OAuth present (today: queue + internal annotation).  
3. Collapse duplicate nav (Analytics Hub, Action Center → Battle Plan).  
4. Feed experiment / True ROAS outcomes into Decision Engine scoring.  
5. Weekly learning rollup: “what we acted on, what worked.”
