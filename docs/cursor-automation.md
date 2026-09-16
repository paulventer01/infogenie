# Cursor automation bridge

This integration turns authorised GitHub issue commands into Cursor Cloud Agent tasks for `paulventer01/infogenie`. GitHub Actions launches tasks, accepts explicit follow-ups, periodically refreshes signed tracking state, opens a draft PR when a finished run has a pushed feature branch and none exists, evaluates required CI on the current PR head SHA, and may send one bounded automatic CI correction when a task opted in at start. It does not merge, approve PRs, mark PRs ready, deploy, dispatch independent reviewers, or treat green CI as human-merge readiness. PR #195 and product routes are unaffected. This is Phase A plus B1 of issue #196, not a claim that the full automation lifecycle is complete.

## Activate after reviewing and merging this integration

1. In GitHub repository **Settings → Secrets and variables → Actions → Secrets**, store the existing Cursor key as `CURSOR_API_KEY`. Never put it in an issue, prompt, source file, or chat. The Cursor account also needs access to this repository.
2. Open **Actions → Cursor automation → Run workflow**, select the default branch and action `verify`. This makes read-only authentication checks, without launching a billable agent. It verifies Cursor authentication and GitHub repository access; it does not prove the Cursor account can clone the repository.
3. In the same Settings page, under **Variables**, add `CURSOR_AUTOMATION_ENABLED` with value `true`. Until enabled, tasks and scheduled monitoring are disabled.
4. The allowed sender defaults to `paulventer01`. Optionally set `CURSOR_AUTOMATION_ACTORS` to a comma-separated list of explicitly trusted GitHub logins. These actors can launch billable coding tasks. Do not add a shared bot without understanding who can operate it.
5. Draft-PR creation uses `GITHUB_TOKEN` with `pull-requests: write` and `contents: read` (cannot merge or push). Repository **Settings → Actions → General** must allow GitHub Actions to create pull requests. If GitHub returns 401/403, the tracking issue reports that exact blocker; the bridge will not bypass it with another credential.
6. Start one small task and inspect the tracking issue, Cursor result, draft PR, and notification comment before assigning larger work. The automation workflow only runs its definition and checked-out code from the default branch, so a draft PR cannot live-test secret-bearing control jobs. The dedicated `Cursor automation tests` workflow (no `CURSOR_API_KEY`) still runs on the PR to validate this file.

Keep repository branch protections and required reviews enabled. Instructions tell Cursor to use feature branches and draft PRs, but prompts do not enforce permissions: the Cursor GitHub integration has its own repository access. Set spending controls in the Cursor account; tasks use its configured default model.

## Commands

Create a new GitHub issue whose body begins exactly:

```text
/cursor start
Implement the bounded task described here. Include acceptance criteria and exclusions.
```

Use comments on that tracking issue for subsequent commands:

```text
/cursor follow-up
Fix the specific review finding described here and rerun the affected tests.
```

```text
/cursor status
```

```text
/cursor cancel
```

Alternatively use **Actions → Cursor automation → Run workflow**. Choose `start` and provide a prompt to create a tracking issue automatically. For `follow-up`, `status`, or `cancel`, supply its issue number; follow-up also needs a prompt. Editing old comments does not execute them. PR comments are not control commands.

ChatGPT can submit these commands through an authenticated GitHub integration when you authorise a task. The event sender must match the allowlist. This bridge does not install a direct Cursor tool in ChatGPT. Automatic CI corrections run only when the **start** command opts in using the reserved headers below; they are not invented from edited comments, PR files, or unsigned configuration.

## Automatic CI correction authorization (Phase B1)

Old tasks and ordinary `/cursor start` bodies stay **manual**. Automatic correction is captured once into HMAC-signed control state at start. Later edits to the issue body or comments cannot enable it.

Place these two lines immediately after `/cursor start` (or at the start of a workflow_dispatch prompt), then the task text:

```text
/cursor start
ci-correction: authorized
ci-correction-window: 24h
Implement the bounded task described here. Include acceptance criteria and exclusions.
```

- `ci-correction: authorized` then `ci-correction-window:` must be the **first two lines** of the start prompt (immediately after `/cursor start`). Order is required. Duplicate, swapped, malformed, or out-of-range headers leave the task manual.
- Quoted examples or the same lines later in the task body never enable correction.
- `ci-correction-window:` must be an integer `1h`–`72h`. Missing or invalid window means the task stays manual.
- The window starts at the accepted start timestamp stored in signed state. After the deadline, failing CI is reported as exhausted; no further automatic POST is sent.
- Manual and automatic follow-ups share one cap of **three follow-up slots** per tracking issue. Automatic rejection consumes a slot.
- Authorization headers are stripped from the Cursor prompt. They are not read again after start.

## Current-SHA CI evaluation (Phase B1)

On refresh, when a bound same-repo PR (or known SHA) exists, the bridge re-reads the PR head **and base**, pages check-runs and commit statuses (100 per page, 20-page budget), and keeps the latest attempt per check name/app and per status context (a newer in-progress attempt is not hidden behind an older success when `started_at` is missing). This automation only evaluates PRs that still target the repository **default branch**. A non-default base, or a base that changes during evaluation or immediately before a correction POST, is **policy blocked** even if the head SHA is unchanged. Required identities are the union of:

1. Classic branch protection `required_status_checks` on the default branch, when readable.
2. Repository ruleset `required_status_checks` on that branch, when readable.
3. The trusted default-branch floor: commit status `buildkite/infogenie` (a floor only).

Live policy is **complete** only when both protection and ruleset APIs are readable (`ok` or `absent`) or when `TRUSTED_POLICY_COMPLETE` is explicitly true in default-branch controller code with a validated non-empty trusted list. `GITHUB_TOKEN` commonly receives **403** for classic protection. That is **policy blocked**, not “no required checks”, and cannot be reported as CI passed even if the floor status succeeded. Malformed policy bodies, missing required containers, and invalid required rows (including non-string contexts or non-integer app/integration ids) are blocked; they are not dropped down to the floor. Genuinely empty `checks`/`required_status_checks` arrays remain valid. Missing, pending, skipped/neutral, unknown conclusions, truncated pagination, API failures, incomplete policy, a head SHA that moved, or a base that is not the default branch **cannot** be reported as CI passed. If evaluation throws after a previous green result, that green evidence is cleared and a blocked state is persisted. Evidence is sanitized names/conclusions/https links on `github.com` or `buildkite.com` only — no log bodies, credentials, or executable snippets. The secret-bearing workflow still runs only default-branch events and checks out the default branch.

Passed required CI is notified as **ci-passed-awaiting-independent-review**. That is not independent approval and not `READY_FOR_HUMAN_MERGE`. PRs stay draft.

## Bounded automatic correction

When signed opt-in is present, the run is **FINISHED**, the bound PR is open and still targets the default branch, CI verdict is a confirmed actionable failure, the shared follow-up cap and deadline remain, and no other InfoGenie Cursor task is active, the bridge persists correction intent (task, run, PR, head SHA, failure fingerprint) **before** the Cursor POST. Duplicate `schedule` / `check_suite` / `status` ticks do not repeat it. Uncertain network outcomes are reconciled from the observed run (intent becomes accepted when `latestRunId` moved) and are never blindly retried. Cursor 4xx/429 rejections are **terminal** for automatic correction: the rejected intent stays in signed state and no later automatic POST is sent, even if failure metadata changes or a later manual `/cursor follow-up` is accepted. Renewed automatic authorization requires a **new task issue**. A separately authorised `/cursor follow-up` can still send one manual run. Cancellation, closed/merged PRs, non-default bases, disabled automation, and `noOtherWork` still block the POST. Head or base movement after evaluation invalidates that evidence and prevents the POST.

`/cursor status`, `/cursor cancel`, and `/cursor follow-up` observe without launching automatic correction. Monitor consumes those authorised comments first, then may dispatch one automatic correction. Cancel of an already-finished opted-in failure suppresses further automatic POSTs.

## Completion, PR handoff, and notifications (Phase A)

On each refresh the bridge binds, in signed control state: tracking issue, agent/run IDs, exact feature branch, discovered or created PR, and current head SHA when known.

- PR discovery uses the exact initiating branch (`GET /pulls?head=paulventer01:<branch>&state=all`) even when Cursor omits `prUrl`. A PR from another branch or repository is never adopted. Merged and closed PRs are recorded as such; a second PR is not opened for that branch.
- Cursor `autoCreatePR` remains false. After a **FINISHED** run with a pushed non-default branch and no same-branch PR, the bridge persists PR-creation intent, then opens **one draft PR**. Uncertain network outcomes are reconciled by branch lookup before any retry. 401/403/other definite GitHub refusals become a stored blocker and are not retried automatically.
- Notifications are a **new issue comment**, separate from the HMAC-signed control comment. They include task/agent/PR links, the exact SHA when known, CI summary/phase, and the next human action. CI-waiting, correction-running, exhausted/blocked, and ci-passed-awaiting-independent-review transitions are emitted once. They are deduplicated across polling and retries. GitHub issue notifications do **not** wake a ChatGPT conversation; subscribe to the issue or GitHub notification settings to receive them.

## Monitoring and limits

- Only one visible active Cursor task for this repository is allowed. This includes manually launched agents visible to the key. Accounts outside that visibility cannot be coordinated by this bridge.
- Manual and automatic follow-ups share one cap of **three follow-up slots** per tracking issue. A definite automatic-correction rejection consumes a slot and is not an “accepted” follow-up. It permanently disables further automatic POSTs on that task.
- Monitoring wakes on `check_suite` completed, commit `status`, and a `*/5 * * * *` scheduled fallback. GitHub may delay or skip schedules; this is best-effort, not a five-minute SLA. These events load the workflow file from the **default branch** (GitHub: the workflow file must exist on the default branch). The secret-bearing job never uses `pull_request` or `pull_request_target`: `pull_request` runs the workflow from the PR merge ref, so a same-repo PR that edits `.github/workflows/cursor-automation.yml` could execute untrusted steps with `CURSOR_API_KEY`. Checking out `main` inside such a job does not fix that. `pull_request_target` uses the default-branch workflow but is omitted because it is easy to misuse by checking out PR code with secrets. Checkout in this workflow is always `github.event.repository.default_branch` with `persist-credentials: false`.
- Per-task errors are isolated during monitor: one tracking issue failure does not abort refresh of the others. Corrupt signatures still block **starting** a replacement task until tracking is repaired.
- Authorised `/cursor follow-up|status|cancel` comments on an already tracked issue are reconciled on monitor if GitHub coalesced the original job. Each command id is persisted in signed `handled` at acceptance. Status and cancel are consumed so later ticks do not repeat their side effects. Cancel binds `cancelIntent.runId` to the exact run before the Cursor POST; an old cancel is never applied to `latestRunId` after a later follow-up. Uncertain cancel responses are not retried automatically. **Start** commands lost to Actions concurrency coalescing are **not** auto-replayed in this PR; resubmit after the active job finishes.
- Edited comments are not commands. Reconciliation skips a comment when `updated_at` differs from `created_at`, so changing historic text cannot become a fresh authorised follow-up or cancel. Post a new comment instead. The `issue_comment` trigger is `created` only; `edited` events are ignored.
- Run completion is not independent review. CI evaluation is bound to the current PR head SHA with paginated checks/statuses and the required-check policy above. Green CI is not independent approval and not `READY_FOR_HUMAN_MERGE`.
- GitHub serialises control jobs and may replace an older pending job. Check Actions if a command has no result.
- Closing an issue does not cancel an active task. Use `cancel`; active closed issues remain monitored. Closed completed issues stop polling.
- Disabling `CURSOR_AUTOMATION_ENABLED` stops bridge commands and polling; it does not stop an already running Cursor agent. Cancel first if needed.

## Failure recovery

The bridge saves signed intent before each billable Cursor request, before draft-PR creation, and before automatic CI correction. Network errors and ambiguous responses are never blindly replayed. Use `status` or wait for the next monitor to reconcile. If still unresolved, inspect the agent in Cursor before doing anything else; do not start a replacement blindly.

Definite API rejections (such as invalid credentials or rate limits) are reported separately. Correct the cause, then create a new task issue for a rejected start or send a new follow-up command for a rejected follow-up. Re-running the same command does not replay it.

Do not edit/delete the tracking comment or remove its `cursor-automation` label. State is signed using the API key and bound to the issue/repository. Key rotation invalidates old state signatures: finish/cancel active tasks and reconcile existing tracking issues before rotating. After rotation, close/remove tracking labels from reconciled old issues before starting fresh tasks. Never restore a compromised key just to recover tracking.

Errors are available in the Actions run log and summary. Remote response bodies and keys are not logged or copied into Cursor's environment. Task instructions, tracking comments, and notification comments are visible to repository readers.

## Deferred (issue #196 remaining work)

Not implemented here: separately controlled independent Security/QA reviewer orchestration, `READY_FOR_HUMAN_MERGE`, start-command coalescing recovery, or hosted end-to-end proof. Self-check and green CI are not independent approval. Do not merge automatically. Classic branch protection is typically unreadable to `GITHUB_TOKEN`, so CI stays **policy blocked** until live protection/rulesets are readable or an explicit complete trusted policy is configured in default-branch controller code. The current `buildkite/infogenie` list is a floor, not that complete policy.

## Verification and API contract

Run `node --test test/cursor-automation.test.js` for isolated tests with mocked APIs; no credentials or paid agent runs are needed. The dedicated PR workflow runs this suite, including a regression that a same-repo PR must not add `pull_request`/`pull_request_target` to the secret-bearing control workflow. The normal repository core test gate remains applicable.

The bridge targets [Cursor Cloud Agent API v1](https://cursor.com/docs/cloud-agent/api/endpoints): agent creation with a client-supplied ID, agent/run retrieval, explicit follow-up runs, and cancellation. The API is evolving; inspect contract changes before changing request handling.
