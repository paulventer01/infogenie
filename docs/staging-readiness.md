# Isolated campaign review workspace: readiness plan

Prepared 2026-09-23 against main `2ca56e82f2e8fbf73fc58c27735d621ab91a40a6`.
This is preparation for the hosted-review gap in
[the launch gap analysis](launch-interface-gap-analysis.md), not a deployment.
No new environment, accounts, credentials, credit grants or hosting changes are
created by this document. Production remains separate.

## What exists and what is still missing

| Surface | Verified implementation | Remaining boundary |
| --- | --- | --- |
| Private Codespaces preview | Dedicated `infogenie_preview` PostgreSQL container; real login, tenant permissions and CSRF; restart persistence | A temporary private preview, not a verified always-on Railway staging service |
| Normal preview reviewer | Synthetic tenant owner with `users.is_owner=false` | Proposal routes correctly return `403 owner_only`; do not promote this account to make the journey pass |
| Campaign browser acceptance | Saves, reloads, validates and approves a synthetic draft; the restart regression compares its exact snapshot, revision history and approval records through a fresh isolated-owner login, proves the ordinary reviewer stays denied, and checks no publish request exists | Seeds approved creative and a synthetic integration row directly in disposable CI; does not prove live Meta authentication or the entire research-to-generation journey |
| Owner creative review acceptance | Separate synthetic owner uses real login, reads persisted research/proposal and saved snapshot | Owner exists only in disposable CI; this is not an operator-accessible owner provisioning feature |
| Production | Operator evidence establishes #217 active and deployed, and earlier fixture steps through draft snapshot | Successful production validation/approval and full reload acceptance remain unverified; missing Meta credentials are still enforced |

The existing preview can be opened using
[the private preview instructions](preview-reporting-workspace.md). Do not
advertise it as completing the owner-only creative generation journey.

## Isolation contract before any persistent hosting

1. Use a separate empty database and synthetic data. Never clone production,
   reuse its database URL, or restore its users, sessions, integration rows or
   encrypted records. Record the database identity without recording credentials.
2. Generate environment-specific session and vault keys. Keep login material
   private to the designated reviewers. Do not copy keys from production or put
   passwords in PRs, logs, screenshots or this document.
3. Keep real tenant, permission and CSRF enforcement enabled. A login must not
   grant access to another synthetic tenant. Retain the existing owner-only
   proposal routes and exact-version approval checks.
4. Disable background scheduling and automatic external delivery. Verify both
   the shared scheduler and register-time cron/listener paths; setting
   `INFOGENIE_JOBS=0` alone is not proof that every background path is disabled.
5. Block outbound provider, email, advertising and publishing traffic before
   exercising writes. Missing provider keys alone are not an isolation boundary.
   Allow only the explicitly required internal services and exact preview origin.
6. Keep the review URL private. Do not create a public demo account or assume
   a hosted application's URL is private because its name includes staging.
7. Treat credits and approval as independent controls. Fixture actions still
   use existing reservation checks. Any synthetic test grant/limit belongs only
   to the disposable environment and must be deliberate, bounded and recorded.

### Existing launcher constraints

`scripts/preview/start.js` rejects production mode and dotenv files, replaces
ambient configuration with an allowlist, verifies the database name and TLS,
and starts Express via `buildApp()`. It retains jobs-off and real access checks.
Private account/key records survive a restart; a missing account record against
a populated database fails instead of resetting users.

`scripts/preview/network.js` intercepts Node socket connections and fetch calls;
it permits only loopback ports 5000, 8000 and 5432. Browser CSP separately blocks
external resources. This is an application-process safeguard, not evidence of
host-level egress control for arbitrary native subprocesses or future adapters.

The launcher is **not a drop-in Railway production launcher**: its database is
loopback-only, its origin choices are localhost or a validated Codespaces host,
and it runs Next development mode. Do not point it at a remote database, bypass
these checks, or replace `npm start` in production. A persistent staging adapter
would require its own scoped implementation and review before hosting changes.

## Synthetic accounts and data plan

| Identity | Purpose | Required restriction |
| --- | --- | --- |
| Tenant A reviewer | Normal campaign/reporting journey | Keep the current non-deployment-owner role; demonstrate proposal denial |
| Tenant B reviewer | Isolation checks | Must not read or mutate Tenant A briefs, workflows, proposals, drafts or reports |
| Separate review owner, if needed | Owner-only fixture proposal/creative steps | Provision only inside the isolated environment through a reviewed process; never upgrade a production user or expose a shared public login |

Use clearly labelled DEMO briefs, research, creative and campaign drafts with
reserved example domains. No production customer lists, provider account IDs or
tokens. Synthetic credential records used by CI are test scaffolding: never
instruct an operator to insert fake credentials into production to pass validation.

## Acceptance record for the exact candidate commit

Record commit, environment, date, role, synthetic tenant, relevant object/revision
IDs, result and a secret-free evidence link for each row. A previous commit's
green result cannot certify the next candidate.

| Check | Expected result |
| --- | --- |
| Login and cross-tenant reads/writes | Real sessions work; foreign-tenant object IDs fail without disclosing content |
| Origin and permissions | Foreign origins fail CSRF; ordinary reviewer is denied owner-only proposals |
| Provider/job isolation | External attempts fail before reaching a provider; no scheduled delivery/provider work occurs, including after restart |
| Guided workspace and handoff | Saved brief opens the intended workflow; stale selections clear without erasing unrelated edits |
| Research and proposal restoration | Read-only refresh restores the correct saved source/proposal after reload; no generation or credit mutation occurs |
| Exact creative approvals | Image/video brief approvals remain distinct; changed proposal identity clears confirmation |
| Fixture image/video | Synthetic output is labelled; video metadata is not presented as a finished rendered video |
| Credit feedback | Success/refusal and terminal job results refresh accounting; unsaved limit edits remain intact |
| Draft save and restart | Saved draft, revision and creative references survive browser reload and process restart |
| Validation refusal | Missing Meta credentials block validation; adding credits is not suggested as the remedy |
| Disposable positive validation | Existing synthetic CI path passes validation/approval of the same revision; no publish request exists |
| Snapshot review | Saved values, platform-labelled placements, zero/missing budget, schedule and creative versions display; unsaved edits are not presented as saved |
| Desktop/mobile review | Navigation and controls are usable; long fields wrap; inspect whole-page overflow as well as the snapshot panel |

The current preview workflow and `test/helpers/campaign-journey-browser.js`
provide part of this evidence. The process-restart check retains the reporting
assertions, restores the exact campaign and creative choice in the ordinary
reviewer's UI, and confirms the reviewer remains denied both owner-only
proposals and exact snapshot/history reads. A fresh isolated-owner session
performs the before/after record comparison. The restoration performs no campaign
mutation or repeat approval. This is disposable preview
acceptance, not production reload acceptance. They do not certify every row above: in particular,
the campaign helper seeds upstream objects and the normal preview account cannot
perform the full owner-only journey. Extend only missing acceptance in a later
bounded build; do not duplicate tests or weaken gates.

The preview campaign isolation extension adds a second synthetic tenant with an
ordinary reviewer (`users.is_owner=false`) and fresh real logins before and after
the same process restart. The reviewer can read and edit its own unvalidated draft;
the first tenant's workflow/draft reads and draft edits return `404 not_found`,
and brief/creative/draft lists and browser selectors omit foreign objects. The
original approved snapshot, revisions and approvals remain identical after these
attempts. Owner-only proposal denial and absence of publishing requests remain
required. These are disposable CI assertions; the second tenant and its unresolved
synthetic creative reference are not provisioned into operator previews or production.

## Release decision and rollback

The creative-handoff acceptance extension uses a separate real owner login in
the disposable preview. It creates a workflow, requests/approves research, runs
fixture Meta research, generates a fixture proposal and approves its exact image
brief through UI controls. The video brief must remain unapproved. Campaign
Journey selects that image brief and saves its exact ID/version/hash, then
restores it after reload. Proposal and campaign restoration must issue no writes
or credit changes, and no publishing request may exist. Prerequisites are the
synthetic account, marketing brief, a bounded 100,000-micro test grant/limits,
and a 50-record/1-MiB research evidence quota;
no research, proposal or creative approval rows are seeded for this extension.
Final-head hosted verification must be recorded in the acceptance PR. This is not live-provider or rendered-media
acceptance, and does not provision an operator-accessible owner account.

The fixture-media extension continues that UI-created proposal after the saved
campaign check. It verifies explicit image/video confirmations, separate video
approval preserving the image approval, real job submission and UI polling of
completed synthetic outputs. The test explicitly drains the existing workers for
its synthetic tenant with fixture adapters; scheduling stays disabled. The image
must decode as a labelled 1×1 PNG, while video remains labelled metadata with no
video player. Reload must preserve exact job/output, approval and campaign records
through authenticated reads without writes or credit changes, and reset generation
confirmations. This does not claim completed media cards restore automatically,
background workers run in preview, or a finished video exists. Final-head hosted
verification remains required; no production or persistent hosting action is implied.

The runtime isolation acceptance uses a test-only IPC observer in the actual
preview launcher before and after restart, and again after the campaign journey.
It requires the real server to have loaded, jobs/background flags to remain off,
no shared scheduler start, no application register-time timers/listeners and no
application-owned recurring intervals during the observed journey. The observer
delegates to the real implementations; it does not suppress jobs or connections.
Actual fetch/socket probes must fail with the preview guard's refusal, while an
internal Express connection succeeds. A separate local sentinel receives zero
connections on a forbidden port; reserved `.invalid` probes use no live provider.
This covers the launcher process, not arbitrary native subprocesses, host-level
egress, every future adapter or indefinite idle execution. Existing browser CSP
and child preload controls remain separate. Persistent hosting is still unproven.

First review this plan and the missing evidence against current main. Any staging
implementation must preserve the isolation contract, pass applicable PostgreSQL
and browser tests with zero skips, and receive independent read-only Security/QA
review and exact-head CI. Keep it draft until those gates pass.

Before any hosting change, present the concrete separate-service/database setup,
access policy, egress controls, resource cost and evidence to the human operator
for authorization. This plan does not authorize hosting, billing or production
changes. Stop or discard only the disposable staging service/data if its isolation
checks fail; never change production routing or remove production records.

Production acceptance remains a separate human decision. Do not rewind the
existing CMTrading workflow, regenerate its successful fixture steps or bypass
missing credentials to manufacture a passing result.

The Marketing Brief delivery extension exercises only the already reachable explicit
Send to Slack action (CR-023) through the existing content-safety browser chain. Real
login, PostgreSQL and API gates run; the webhook HTTPS boundary is intercepted with
synthetic responses, so no external delivery occurs. It checks owned-content refusal
and scanner outage without brief writes, foreign-row 404, missing configuration,
provider rejection, warning persistence/reload, confirmed success and concurrent
send suppression. Row locking holds the scanned snapshot through the bounded request;
success records deduplicate identical content. A provider-accepted request whose
database record fails remains ambiguous and requires destination inspection before
retry, not an exactly-once guarantee. Final-head hosted verification is required.
This closes CR-023 only; CR-051 remains partial in PR-8b and the 17 remaining batches stay
paused. No new channel, retry engine, autonomous execution or hosting change is added.
