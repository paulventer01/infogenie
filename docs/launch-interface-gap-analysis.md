# Launch and interface gap analysis

Updated 2026-09-21. This replaces the old marketing-taxonomy roadmap as the
priority order for the current interface work. A shipped route or green build
is not evidence of production acceptance. Do not start deferred features.

## Essential before launch

| Gap | Evidence / current status | Acceptance requirement |
| --- | --- | --- |
| Railway acceptance | Operator screenshot shows PR #205 active; authenticated customer journey is not yet verified on Railway. | Sign in, load the intended workspace, save a draft, reload it, validate and approve the same saved revision. Verify migrations and tenant context in the deployed database. |
| Production background jobs | Operator logs from the older #160 deployment showed digest tenant_id failures and mentions 401s. Current #205 behavior needs checking. | Inspect current logs; repair reproducible failures without weakening tenant or authentication checks. |
| Secret handling | Session and credential encryption secrets appeared in operator screenshots. | Rotate the session secret; plan encryption-key migration against existing encrypted records before replacing that key. Never store secret values in this document. |
| Content safety coverage | docs/step6-content-safety-coverage.md records remaining partial/gap routes. | Reconcile against current main; enforce safety on launch-exposed create/save/approve/publish paths, or explicitly exclude incomplete paths from launch. Preserve failure-closed behavior. |
| Release evidence | Local/CI acceptance does not establish production readiness. | Passing final-head checks, tenant/permission regression evidence, working login, and human release approval. |

## Needed for the new interface

| Gap | Evidence / current status | Next action |
| --- | --- | --- |
| Workspace home and navigation | PR #204 remains unmerged. Main includes reporting (#203) and campaign journey (#205). | Reconcile #204 with main; retain both browser journeys and expose campaign journey from the home screen. Human squash-and-merge after final-head checks. |
| Marketing journey prerequisites | #205 selects existing marketing and approved creative briefs/workflows. It does not create every prerequisite in one wizard. | Verify the current experience, then scope guided prerequisite creation using existing APIs and approval contracts. Do not describe assembly as a complete generation/publishing journey. |
| Hosted review workspace | Railway production is running; disposable Codespaces preview exists. A separate Railway staging environment has not been verified. | Prepare an isolated staging database and synthetic account plan; verify provider/job isolation before any hosting changes. |
| Visual acceptance | CI covers responsive behavior; operator review of the combined home and campaign screens remains outstanding. | Review desktop/mobile navigation, missing prerequisites, loading/error states, saved data and approval states. |

## Deferred

- New marketing channels and taxonomy expansion from docs/gap-priority-roadmap.md.
- Broader all-role dashboards and redesign of every existing panel.
- Multi-platform campaign wizard and advanced campaign editing beyond existing contracts.
- New autonomous publishing, ad spend or external delivery behavior.
- Public demo accounts and public previews with production data.

## Execution order

1. Finish the existing workspace PR #204, including compatibility with #205.
2. Verify the hosted login and campaign journey; fix demonstrated blockers.
3. Complete guided prerequisites and staging reliability in bounded PRs.
4. Reconcile and close launch-exposed safety gaps.

One feature branch/PR at a time, maximum 1,500 changed lines. Human merges only.
Keep status evidence explicit; an item above is not complete merely because it
has a plan, route, deployment badge or test fixture.
