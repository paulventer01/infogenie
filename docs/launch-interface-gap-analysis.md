# Launch and interface gap analysis

Updated 2026-09-23. This replaces the old marketing-taxonomy roadmap as the
priority order for the current interface work. A shipped route or green build
is not evidence of production acceptance. Do not start deferred features.

## Essential before launch

### Research recovery accepted; creative-review journey remains incomplete

PRs #210 and #211 were human-merged and deployed. On 2026-09-23 the operator
exposed the interrupted Meta run, explicitly cancelled it, and completed a fresh
Meta Fixture (safe) run (`rr_1c8407425f162eff`). This accepts the demonstrated
Meta fixture cancel/retry path; it does not establish live-provider, Google,
TikTok, campaign approval or publishing acceptance.

The next operator screenshots expose a creative-review handoff gap: completed
single-platform research did not expose proposal generation, and persisted
proposals were not restored on reload. The workflow reached `creative_approved`
with a zero credit ceiling, but the screenshots do not establish generated or
reviewed creative content. Generic workflow approval is separate from approving
an exact creative brief.

The scoped follow-up restores tenant-scoped completed research and the latest
saved proposal, displays reviewable brief content and explicit source selection,
and explains existing state/credit prerequisites. Fixture proposal generation
still reserves 10,000 micros ($0.01); it is unavailable at `creative_approved`.
No approval, ceiling, production state or provider boundary is changed. Existing
proposal routes remain deployment-owner gated; ordinary preview tenant owners
cannot access them. Browser acceptance covers both the denied tenant-owner read
and a separate synthetic deployment-owner session in the disposable database. An
operator-approved new test workspace may be needed to exercise missing generation
steps. Final-head preview/PostgreSQL/browser certification and human deployed
creative review plus campaign save/reload/validate/approve remain required.

PR #212 was human-merged on 2026-09-23 at 11:03:34 UTC (main `c5930f3`);
Railway reports success for that commit. Subsequent operator screenshots show
the restored review panel and, in a new CMTrading Creative Test 2 workspace,
completed Meta fixture run `rr_318d27ef2e776e06` and fixture proposal
`pgen_cce17d0c732a7d9e` at `pending_review`, version 1. This accepts displayed
fixture proposal generation, not individual brief approval, image/video
generation, live research or the full campaign journey. The operator changed
the test credit limits; no automated production approval or spending is implied.

The next small interface slice addresses the observed “refresh does nothing”
confusion: read-only loading/result feedback, distinct image/video brief labels,
and directions to existing individual approval controls. Refresh does not
generate, approve or spend. Existing tenant, owner, state and credit checks stay
unchanged; deployed acceptance of this feedback remains pending.

| Gap | Evidence / current status | Acceptance requirement |
| --- | --- | --- |
| Railway acceptance | Operator screenshots show #207 active on Railway and the CMTrading test campaign workspace created and selected. The next prerequisite is an approved creative brief. Campaign save/reload/approval and deployed database checks remain unverified. | Sign in, load the intended workspace, save a draft, reload it, validate and approve the same saved revision. Verify migrations and tenant context in the deployed database. |
| Production background jobs | Operator logs from the older #160 deployment showed digest tenant_id failures and mentions 401s. Current deployed behavior needs checking. | Inspect current logs; repair reproducible failures without weakening tenant or authentication checks. |
| Secret handling | Session and credential encryption secrets appeared in operator screenshots. | Rotate the session secret; plan encryption-key migration against existing encrypted records before replacing that key. Never store secret values in this document. |
| Content safety coverage | docs/step6-content-safety-coverage.md records remaining partial/gap routes. | Reconcile against current main; enforce safety on launch-exposed create/save/approve/publish paths, or explicitly exclude incomplete paths from launch. Preserve failure-closed behavior. |
| Release evidence | Local/CI acceptance does not establish production readiness. | Passing final-head checks, tenant/permission regression evidence, working login, and human release approval. |

## Needed for the new interface

| Gap | Evidence / current status | Next action |
| --- | --- | --- |
| Workspace home and navigation | PR #204 and #206 are merged; Railway screenshots subsequently show #207 active. Campaign Journey is accessible; the navigation button still needs explicit operator confirmation. | Verify the deployed navigation button and retain both browser journeys. |
| Marketing journey prerequisites | Guided workspace creation (#207) is deployed and operator screenshots confirm creation/selection. Creative-review handoff (#208) is merged; deployment remains unverified. Follow-up restores review/refresh when approved briefs already exist and requires explicit reselection if the chosen approved version disappears or changes, preserving other campaign edits. | Verify the handoff and refreshed creative choices, complete creative review and save/reload/validate/approve a campaign; verify tenant ownership against the deployed database. Creative generation and approval still use the existing workspace tools. |
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
