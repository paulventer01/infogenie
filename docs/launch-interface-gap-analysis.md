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

Merged PR #224 implements audit batch PR-2 / CR-063: `/api/wordpress/publish`
checks the normalized title, content, excerpt and retained tags before any WordPress
request or publish-log insert, for draft, pending and published posts alike. It scans
raw fields plus decoded HTML text within a bounded combined scan ceiling; over-limit
posts are refused even under warning-only policy. Scanner failure returns 503 and
enforced blocks return 403. The Content Modes dialog preserves edits, shows actionable
errors and displays successful warning-only results. Tenant lookup and permissions
remain unchanged. Final-head focused, real PostgreSQL/browser and independent review
evidence belongs in the PR; no real WordPress publishing or production acceptance is
implied. Other safety-audit rows, including `/api/publish-to-wordpress`, remain separate.

Audit batch PR-3a / CR-013 adds approval-time checking to review replies. Older
clients re-scan stored text; the editor submits its exact displayed reply, which
is persisted only with successful approval. Tenant-scoped pending-state and text
comparison reject missing, foreign, already-handled or concurrently changed rows.
Enforced safety refusal returns 403; unavailable checks return 503; neither changes
the draft. Successful warning-only results persist and display warnings. The UI
preserves refused edits and prevents competing actions on the same in-flight draft.
The action is labelled “Approve reply”: this route records approval only and does
not deliver to a review platform. Focused, PostgreSQL/browser and independent
review evidence must be recorded at the final PR head; Step 6 remains Partial.

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
reload. Only account, marketing brief, bounded research quota and synthetic credit prerequisites
are seeded for this extension; its research/proposal/creative approval are not.
Record final-head hosted verification in the acceptance PR. It does not certify live
providers, image/video rendering, persistent hosting or production acceptance.

PR #222 was human-merged on 2026-09-25; its research-to-approved-brief-to-saved
campaign UI acceptance is implemented. Railway deployment is pending according
to the operator, not required to start this isolated test extension. The next
bounded acceptance exercises fixture image/video job submission through that
same UI-created proposal, separate exact approvals and explicit confirmations.
With preview scheduling still disabled, the test explicitly drains the existing
workers for only its synthetic tenant using fixture adapters. It verifies a
labelled 1×1 PNG, labelled video metadata with no finished video, and unchanged
job/output, proposal and saved campaign records after read-only reload. This does
not certify background scheduling, completed media-card UI restoration, rendered
video, live providers, persistent hosting or production acceptance. Record the
exact-head hosted result in the PR before treating this acceptance as verified.

PR-3b / CR-019 adds a stored-content safety check before Safe Agent approval.
Title, proposal and simulation leaf text are scanned without JSON escaping or
truncation; over-limit content is refused even in warning-only mode. Enforced
blocks return 403 and unavailable checks 503 before approval mutations. Approval
compares the scanned snapshot, tenant and pending status, and commits warnings,
the existing simulated outcome and both audit events atomically. Concurrent
changes or duplicate approval return 409. The UI preserves refused proposals and
shows safety errors and successful warnings. Required final-head test/review
evidence belongs in the PR. No live execution or production acceptance is implied;
the proposal-generation flattening gap remains in PR-8c. Step 6 remains Partial.

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

Marketing Brief safety and honest refresh addresses CR-020–022: generation scans
bounded decoded display text (including brand and retained signals) before saving;
blocked/unavailable generations return safe 403/503 responses. The panel preserves
previously saved data with an explicit stale banner until a successful retry,
serializes generation requests, and retains persisted warnings after reload.
Focused deterministic tests pass; real login/Postgres/Chromium coverage is added
to the existing content-safety browser gate and still requires hosted verification.
Marketing Brief delivery safety closes CR-023 at the existing explicit webhook action:
tenant-owned stored display text and the exact outgoing text are re-scanned before
sending; refusals leave the brief untouched, and warnings persist on confirmed delivery.
The panel reports failures and confirmed delivery honestly. A row lock prevents concurrent
sends and content-hash records deduplicate successful delivery of the same snapshot.
Provider acceptance followed by a database failure remains an explicitly reported ambiguous
outcome; this is not a durable outbox or an exactly-once guarantee. Hosted browser coverage
intercepts the HTTPS boundary and sends nothing to a real destination; final-head hosted
verification is still required.

Attack Plan Safety Warning Persistence completes CR-051/PR-8b: gate-provided warnings
are saved with tenant-owned attack plans, returned by latest/by-ID reads, and displayed
in the existing dialog immediately and after reopening/reload. Warningless legacy plans
remain readable. Existing plan scanning, refusals, honesty withholding and permissions
are preserved; JSON flattening and provider/regeneration work remain deferred. Hosted
acceptance uses real login/API/PostgreSQL with a synthetic intercepted provider, checks
cross-tenant isolation and no persistence on refusals, and proves reads do not regenerate.
Local PostgreSQL is unavailable; final-head hosted execution remains required. Inventory:
39 covered, 12 partial, 44 gap, 30 out of scope; 56 remaining rows in 16 paused batches.
PR-8c and broader Step 6 remain incomplete. No CI, production, billing or hosting changes.


Launch Checklist Save Safety completes CR-015/PR-4a: the existing create route gates
all retained text before writing, enforces the 100,000-character aggregate ceiling
even in warning-only mode, and atomically saves tenant-owned checklist/default items
with server-derived warnings. The shared tenant/user limiter fails closed. Refusals
return actionable errors and preserve form text; warnings remain visible after reload.
Focused tests cover blocking, outages, validation, rollback and limiting; the existing
hosted browser chain adds real login/API/PostgreSQL refusal, warning persistence and
tenant/permission acceptance. Final-head hosted verification is required; local
PostgreSQL is unavailable. Inventory: 40 covered, 12 partial, 43 gap, 30 out of scope;
55 remaining rows in 15 paused batches. This does not certify launch readiness,
proofreading accuracy, live providers or production acceptance. No CI, production,
billing, hosting or deployment changes.


Review Request Template Save Safety completes CR-064/065 / PR-4b. Create and
update scan all retained rule text before writing, with a 100,000-character
aggregate ceiling even under warning-only policy. Partial updates scan the stored
template; foreign IDs are refused before scanning. Warnings persist on the rule
and render after reload. PostgreSQL row-version comparison refuses concurrent
edits during scanning. Disable-only writes preserve copy/warnings and remain
available during scanner outages; enabling and text changes must pass the gate.
A shared tenant/user fail-closed limiter bounds saves. The UI retains refused
input and reports unconfirmed saves honestly. Existing hosted browser coverage
adds real login/API/PostgreSQL refusal, outage, warnings/reload, tenant/permission
and row-lock race acceptance; no request is triggered or sent. Local PostgreSQL
is unavailable; final-head hosted verification remains required. Trigger/delivery
behavior and its provider simulation are outside this save-only build and are not
certified. Inventory: 42 covered, 12 partial, 41 gap, 30 out of scope; 53 rows in
14 paused batches. Step 6 and production acceptance remain incomplete.


WordPress Page Publishing Safety completes CR-054/PR-8a, the separate AutoSEO
`/api/publish-to-wordpress` transport. Exact retained title and body use the same
bounded raw/decoded HTML normalizer as `/api/wordpress/publish`. Over-limit copy
is refused even under warning-only policy; blocking returns 403 and unavailable
checks return 503 before sending. Server warnings reach the response and article
UI. The UI recognizes the actual page response, preserves refused articles,
serializes publishing and stops batches on refusal or uncertainty. Draft creation
is labelled separately from going live; uncertain transport results ask for a
WordPress check before retrying. Existing tenant/permission boundaries remain;
a fail-closed tenant/user limiter bounds attempts. Focused tests and the existing
hosted real-login/PostgreSQL/browser chain cover the change with only reserved
provider transport fixtures. Final-head hosted evidence is required before readiness.
No live publishing, CI, credential, production or hosting changes. AutoSEO articles
remain in-memory: warning restoration after a full reload and durable idempotent
publishing are not claimed. Inventory: 43 covered, 11 partial, 41 gap, 30 out of
scope; 52 rows in 13 paused batches. Step 6 and production acceptance remain incomplete.


A post-merge review of #232 identified that its 20-attempt WordPress page limit
could stop the supported AutoSEO default batch (30 articles). The bounded limit
now permits up to 60 attempts per tenant/user per minute, matching the existing
maximum supported batch. The 61st attempt is still refused before delivery;
missing identities fail closed and users/tenants retain separate allowances.
The UI explains rate-limit refusals and the wait without automatic retries.
The existing real-login/PostgreSQL/browser chain verifies 60 sequential synthetic
drafts and refusal of an additional draft with no provider call. This is a
correction to CR-054, not another completed audit row: totals remain 43 covered,
11 partial, 41 gap, 30 out of scope (52 rows in 13 paused batches). Exact-head
hosted verification is required. No live publishing, production, CI or hosting changes.


Generated Content Metadata Safety completes PR-8d / CR-052–053. The existing
landing-page and SEO-article routes gate every returned copy field (HTML/body,
campaign name/domain or article title/keyword), using bounded raw and decoded HTML
text. Non-text metadata is refused; the aggregate 100,000-character scan ceiling
also applies in warning-only mode. Unsafe output returns 403, unavailable checks
503, without returning generated copy; tenant policy comes from the authenticated
context. Successful warnings reach AutoSEO articles and the legacy landing-page
preview. Refused articles remain unwritten; no publish operation is added.
Focused tests and the existing hosted real-login/API/PostgreSQL/browser chain
cover metadata refusal, outages, clean output, warnings and tenant-policy isolation;
only the upstream generation transport is synthetic. Final-head hosted evidence
is required before readiness. Inventory: 45 covered, 9 partial, 41 gap, 30 out of
scope; 50 rows in 12 paused batches. Step 6 and production acceptance remain partial.
This does not certify HTML sanitization, live-provider output quality, persistent
article/warning restoration or production acceptance. No CI, hosting, billing,
credential or deployment changes.


Safe Agent Proposal Generation Safety completes CR-018, one bounded PR-8c row.
The existing propose route scans decoded title/proposal/simulation text, including
unknown retained keys and values, before proposal or audit writes. A separate leaf
stream detects phrases split across fields; JSON escaping cannot hide newlines or
tabs. Combined text, node and depth ceilings refuse oversized/complex proposals
without truncation, including under warning-only policy. Blocked/unavailable
checks return 403/503 without proposal content. The UI retains objective/context,
shows the server's actionable refusal, and existing saved warnings survive reload.
Focused and hosted real-login/API/PostgreSQL/browser acceptance cover no writes on
refusal/outage, exact saved warnings, pending-approval status, reload without new
generation and authenticated tenant-policy isolation. The provider SDK transport
is synthetic; tests do not approve, execute or call live providers. Final-head
hosted evidence is required before readiness. Existing approval/spend boundaries
and provider fallback behavior are unchanged. Inventory: 46 covered, 8 partial,
41 gap, 30 out of scope; 49 rows in 12 paused batches. Seven PR-8c rows remain;
Step 6 and production acceptance are still incomplete. No CI, hosting, credential,
billing or production change.
