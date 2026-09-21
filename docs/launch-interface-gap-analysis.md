# Launch and interface gap analysis

Updated 2026-09-21. This replaces the old marketing-taxonomy roadmap as the
priority order for the current interface work. A shipped route or green build
is not evidence of production acceptance. Do not start deferred features.

## Essential before launch

| Gap | Evidence / current status | Acceptance requirement |
| --- | --- | --- |
| Railway acceptance | Operator screenshots show #204 active and #206 building. Campaign Journey loads with saved briefs, but its empty workspace selector blocked progression. Save/reload/approval acceptance remains unverified. | Sign in, load the intended workspace, save a draft, reload it, validate and approve the same saved revision. Verify migrations and tenant context in the deployed database. |
| Production background jobs | Operator logs from the older #160 deployment showed digest tenant_id failures and mentions 401s. Current deployed behavior needs checking. | Inspect current logs; repair reproducible failures without weakening tenant or authentication checks. |
| Secret handling | Session and credential encryption secrets appeared in operator screenshots. | Rotate the session secret; plan encryption-key migration against existing encrypted records before replacing that key. Never store secret values in this document. |
| Content safety coverage | docs/step6-content-safety-coverage.md records remaining partial/gap routes. | Reconcile against current main; enforce safety on launch-exposed create/save/approve/publish paths, or explicitly exclude incomplete paths from launch. Preserve failure-closed behavior. |
| Release evidence | Local/CI acceptance does not establish production readiness. | Passing final-head checks, tenant/permission regression evidence, working login, and human release approval. |

## Needed for the new interface

| Gap | Evidence / current status | Next action |
| --- | --- | --- |
| Workspace home and navigation | PR #204 is merged. #206 adds Open Campaign Journey to Agent Orchestrator; its latest operator screenshot shows the Railway build in progress. | Verify the deployed navigation button and retain both browser journeys. |
| Marketing journey prerequisites | Guided workspace creation is implemented for review: inline creation/selection, distinct brief labels, permission checks and creative-review guidance. Deployment and live acceptance remain pending. | Merge only after final checks; verify creation in the intended tenant, then complete creative review and save/reload/validate/approve a campaign. Creative generation and approval still use the existing workspace tools. |
| Hosted review workspace | Railway production is running; disposable Codespaces preview exists. A separate Railway staging environment has not been verified. | Prepare an isolated staging database and synthetic account plan; verify provider/job isolation before any hosting changes. |
| Visual acceptance | CI covers responsive behavior; operator review of the combined home and campaign screens remains outstanding. | Review desktop/mobile navigation, missing prerequisites, loading/error states, saved data and approval states. |

## Deferred

- New marketing channels and taxonomy expansion from docs/gap-priority-roadmap.md.
- Broader all-role dashboards and redesign of every existing panel.
- Multi-platform campaign wizard and advanced campaign editing beyond existing contracts.
- New autonomous publishing, ad spend or external delivery behavior.
- Public demo accounts and public previews with production data.

## Execution order

1. Ship guided campaign workspace setup and verify the navigation added by #206.
2. Complete hosted save/reload/validate/approve acceptance and fix demonstrated blockers.
3. Inspect current production background jobs and repair reproducible failures.
4. Prepare isolated staging with synthetic accounts and provider/job isolation.
5. Reconcile launch content safety and remediate exposed secrets with an encryption migration plan.

One feature branch/PR at a time, maximum 1,500 changed lines. Human merges only.
Keep status evidence explicit; an item above is not complete merely because it
has a plan, route, deployment badge or test fixture.
