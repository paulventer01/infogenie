# Launch and interface gap analysis

Updated 2026-09-25. This replaces the old marketing-taxonomy roadmap as the
priority order for the current interface work. A shipped route or green build
is not evidence of production acceptance. Do not start deferred features.

## Essential before launch

### Fixture journey accepted through draft preview; live validation remains blocked

PRs #210–#213 were human-merged and deployed. Operator screenshots on
2026-09-23 establish the following production fixture acceptance:

- Meta interrupted-run cancellation and retry (`rr_1c8407425f162eff`).
- In the new CMTrading Creative Test 2 workspace, Meta fixture research
  `rr_318d27ef2e776e06`, saved proposal `pgen_cce17d0c732a7d9e` v1,
  read-only creative refresh feedback, and individual image/video brief approvals.
- Static image job `sij_a75fc37cd1bcc745` succeeded with a synthetic 1×1 PNG.
- Video job `vgj_aed99c56cb8f8461` succeeded with fixture metadata only;
  no finished video is stored and no live provider generated either output.
- Campaign draft `cd_576b284f1e0ca209` revision 1 was saved and its snapshot
  preview loaded with `published: false`. Validation failed with
  `missing_credentials (accounts.meta)`; successful validation, same-revision
  campaign approval and full reload persistence remain unverified in production.

These results do not establish live-provider, Google/TikTok or publishing
acceptance. The operator changed credit limits and granted test credits himself;
no assistant production spending, approval, cancellation or configuration change
is implied. Generic workflow approval is separate from an exact brief approval.
Existing deployment-owner proposal gates remain unchanged.

Human-merged PR #214 refreshes shared credit accounting after proposal,
static-image and video requests, after terminal image/video polling, and after
video cancellation. Operator screenshots showed the old balance until a full
reload after the successful static fixture. This establishes stale UI evidence,
not a ledger defect. Background reads preserve limit edits and reject older
responses. Credit refusals explain the separate balance and ceiling checks.
Campaign validation explains missing Meta advertising credentials in both
campaign screens; the server continues to deny validation without them. Fixture
research does not establish an advertising account connection. No limits are
raised, credentials created, approval gates bypassed or live providers called.
Railway operator screenshots confirm #214 and #215 deployed successfully.
Behavioral acceptance of their credit refresh and field guidance remains separate.

Human-merged and deployed PR #215 adds persistent campaign-draft field labels, groups the
saved creative reference, and explains advertising-budget micros in the campaign
currency separately from AI credits. Account-reference guidance directs credentials
to Settings; date guidance explains browser-local time. Contract values, validation
and approval controls are unchanged. Hosted browser evidence and operator visual
acceptance must be recorded separately; this does not complete live validation.

Human-merged PR #216 is deployed according to the operator's Railway screenshot
on 2026-09-23. Its saved campaign snapshot review exposes the existing contract's
budget, platforms, objective, destination, schedule, targeting, tracking and exact
creative versions in the workspace. It uses server-returned saved values rather
than unsaved form edits. Reads reject mismatched draft/workflow/tenant/revision/hash
or status, discard late workspace responses and clear old content on failure.
This is a read-only review surface; missing credential validation, approval and
publication boundaries remain unchanged. A post-merge review found keyed saved
placements were rendered as missing; the correction displays each known platform
and its saved placement type, with canonical persistence/browser regression coverage.
The correction was human-merged as #217; the operator's Railway screenshot on
2026-09-23 confirms it active and deployed successfully. Its production UI
acceptance remains separate from deployment and hosted fixture verification;
no production validation success is claimed.

| Gap | Evidence / current status | Acceptance requirement |
| --- | --- | --- |
| Railway acceptance | Screenshots establish workspace creation, exact brief approvals, fixture generation, campaign draft save and snapshot preview. Meta credentials block validation. Campaign full reload/approval and deployed database checks remain unverified. | Sign in, load the intended workspace, save a draft, reload it, validate and approve the same saved revision. Verify migrations and tenant context in the deployed database. |
| Production background jobs | Operator logs from the older #160 deployment showed digest tenant_id failures and mentions 401s. Current deployed behavior needs checking. | Inspect current logs; repair reproducible failures without weakening tenant or authentication checks. |
| Secret handling | Session and credential encryption secrets appeared in operator screenshots. | Rotate the session secret; plan encryption-key migration against existing encrypted records before replacing that key. Never store secret values in this document. |
| Content safety coverage | docs/step6-content-safety-coverage.md records remaining partial/gap routes. | Reconcile against current main; enforce safety on launch-exposed create/save/approve/publish paths, or explicitly exclude incomplete paths from launch. Preserve failure-closed behavior. |
| Release evidence | Local/CI acceptance does not establish production readiness. | Passing final-head checks, tenant/permission regression evidence, working login, and human release approval. |

## Needed for the new interface

PR #219 was human-merged on 2026-09-25; the operator's Railway screenshot
confirms it active and deployed. Its disposable preview acceptance proves exact
campaign/approval restoration across an app-process restart. The next acceptance
extension uses a second ordinary reviewer in another synthetic tenant to exercise
foreign campaign read/edit denial and own-draft positive controls before and after
restart, with browser selector isolation. This does not establish production reload
acceptance, persistent staging or the full live-provider journey.

PR #220 was human-merged and the operator's Railway screenshot confirms it active
and deployed on 2026-09-25. Its disposable two-tenant restart isolation checks pass.
The next scoped acceptance adds actual-launcher provider/job isolation probes
before/after restart: external fetch/socket refusals, a working internal connection,
and observation of scheduler starts and application timers/listeners. This remains
disposable runtime evidence, not host-level egress certification or a hosted staging
service; see the exact boundaries in the staging readiness plan.

| Gap | Evidence / current status | Next action |
| --- | --- | --- |
| Workspace home and navigation | PR #204 and #206 are merged; Railway screenshots subsequently show #207 active. Campaign Journey is accessible; the navigation button still needs explicit operator confirmation. | Verify the deployed navigation button and retain both browser journeys. |
| Marketing journey prerequisites | Guided workspace creation (#207) is deployed and operator screenshots confirm creation/selection. The deployed orchestrator review path through #213 is demonstrated. The separate Campaign Journey handoff, refreshed creative selection and preservation of edits still need operator acceptance. | Verify the handoff and refreshed creative choices, complete creative review and save/reload/validate/approve a campaign; verify tenant ownership against the deployed database. Creative generation and approval still use the existing workspace tools. |
| Hosted review workspace | Railway production is running; disposable Codespaces preview exists. The [staging readiness plan](staging-readiness.md) records the separate database/account requirements, current preview limits and acceptance evidence. A persistent staging service has not been provisioned or verified. | Review the plan, implement only missing isolation/acceptance in a scoped build, and obtain authorization for a concrete hosting setup after verification. |
| Visual acceptance | CI covers responsive behavior; operator review of the combined home and campaign screens remains outstanding. | Review desktop/mobile navigation, missing prerequisites, loading/error states, saved data and approval states. |

PR #221 was human-merged on 2026-09-25. Actual-launcher provider/job isolation
acceptance is implemented; production deployment and functional acceptance are
separate. The next acceptance extension exercises fixture research, proposal
generation and exact image-brief approval through the real isolated owner UI,
then hands that creative to Campaign Journey and restores the saved draft after
reload. Only account, marketing brief and bounded synthetic credit prerequisites
are seeded for this extension; its research/proposal/creative approval are not.
Record final-head hosted verification in the acceptance PR. It does not certify live
providers, image/video rendering, persistent hosting or production acceptance.

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
