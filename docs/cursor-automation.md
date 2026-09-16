# Cursor automation bridge

This integration turns authorised GitHub issue commands into Cursor Cloud Agent tasks for `paulventer01/infogenie`. GitHub Actions launches tasks, accepts explicit follow-ups, periodically refreshes signed tracking state, opens a draft PR when a finished run has a pushed feature branch and none exists, and posts a separate GitHub issue notification on meaningful completion/PR/blocker transitions. It does not merge, approve PRs, mark PRs ready, deploy, dispatch independent reviewers, or apply automatic CI corrections. PR #195 and product routes are unaffected. This is Phase A of issue #196, not a claim that the full automation lifecycle is complete.

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

ChatGPT can submit these commands through an authenticated GitHub integration when you authorise a task. The event sender must match the allowlist. This bridge does not install a direct Cursor tool in ChatGPT, and does not automatically invent or send new coding instructions from model output or CI failures.

## Completion, PR handoff, and notifications (Phase A)

On each refresh the bridge binds, in signed control state: tracking issue, agent/run IDs, exact feature branch, discovered or created PR, and current head SHA when known.

- PR discovery uses the exact initiating branch (`GET /pulls?head=paulventer01:<branch>&state=all`) even when Cursor omits `prUrl`. A PR from another branch or repository is never adopted. Merged and closed PRs are recorded as such; a second PR is not opened for that branch.
- Cursor `autoCreatePR` remains false. After a **FINISHED** run with a pushed non-default branch and no same-branch PR, the bridge persists PR-creation intent, then opens **one draft PR**. Uncertain network outcomes are reconciled by branch lookup before any retry. 401/403/other definite GitHub refusals become a stored blocker and are not retried automatically.
- Notifications are a **new issue comment**, separate from the HMAC-signed control comment. They include task/agent/PR links, the exact SHA when known, and the next human action. They are deduplicated across polling and retries. GitHub issue notifications do **not** wake a ChatGPT conversation; subscribe to the issue or GitHub notification settings to receive them.

## Monitoring and limits

- Only one visible active Cursor task for this repository is allowed. This includes manually launched agents visible to the key. Accounts outside that visibility cannot be coordinated by this bridge.
- Up to three accepted follow-ups per tracking issue. Each requires an explicit authorised command after the current run finishes.
- Monitoring wakes on `check_suite` completed, commit `status`, and a `*/5 * * * *` scheduled fallback. GitHub may delay or skip schedules; this is best-effort, not a five-minute SLA. These events load the workflow file from the **default branch** (GitHub: the workflow file must exist on the default branch). The secret-bearing job never uses `pull_request` or `pull_request_target`: `pull_request` runs the workflow from the PR merge ref, so a same-repo PR that edits `.github/workflows/cursor-automation.yml` could execute untrusted steps with `CURSOR_API_KEY`. Checking out `main` inside such a job does not fix that. `pull_request_target` uses the default-branch workflow but is omitted because it is easy to misuse by checking out PR code with secrets. Checkout in this workflow is always `github.event.repository.default_branch` with `persist-credentials: false`.
- Per-task errors are isolated during monitor: one tracking issue failure does not abort refresh of the others. Corrupt signatures still block **starting** a replacement task until tracking is repaired.
- Authorised `/cursor follow-up|status|cancel` comments on an already tracked issue are reconciled on monitor if GitHub coalesced the original job. Each command id is persisted in signed `handled` at acceptance. Status and cancel are consumed so later ticks do not repeat their side effects. Cancel binds `cancelIntent.runId` to the exact run before the Cursor POST; an old cancel is never applied to `latestRunId` after a later follow-up. Uncertain cancel responses are not retried automatically. **Start** commands lost to Actions concurrency coalescing are **not** auto-replayed in this PR; resubmit after the active job finishes.
- Edited comments are not commands. Reconciliation skips a comment when `updated_at` differs from `created_at`, so changing historic text cannot become a fresh authorised follow-up or cancel. Post a new comment instead. The `issue_comment` trigger is `created` only; `edited` events are ignored.
- Run completion is not independent review. Check summaries refer to the current SHA and reported checks (first page only), not a guarantee that every required review or branch rule is satisfied.
- GitHub serialises control jobs and may replace an older pending job. Check Actions if a command has no result.
- Closing an issue does not cancel an active task. Use `cancel`; active closed issues remain monitored. Closed completed issues stop polling.
- Disabling `CURSOR_AUTOMATION_ENABLED` stops bridge commands and polling; it does not stop an already running Cursor agent. Cancel first if needed.

## Failure recovery

The bridge saves signed intent before each billable Cursor request and before draft-PR creation. Network errors and ambiguous responses are never blindly replayed. Use `status` or wait for the next monitor to reconcile. If still unresolved, inspect the agent in Cursor before doing anything else; do not start a replacement blindly.

Definite API rejections (such as invalid credentials or rate limits) are reported separately. Correct the cause, then create a new task issue for a rejected start or send a new follow-up command for a rejected follow-up. Re-running the same command does not replay it.

Do not edit/delete the tracking comment or remove its `cursor-automation` label. State is signed using the API key and bound to the issue/repository. Key rotation invalidates old state signatures: finish/cancel active tasks and reconcile existing tracking issues before rotating. After rotation, close/remove tracking labels from reconciled old issues before starting fresh tasks. Never restore a compromised key just to recover tracking.

Errors are available in the Actions run log and summary. Remote response bodies and keys are not logged or copied into Cursor's environment. Task instructions, tracking comments, and notification comments are visible to repository readers.

## Deferred (issue #196 Phase B and hosted proof)

Not implemented here: automatic failed-CI correction rounds, a separately controlled independent Security/QA reviewer, paginated required-check completeness, `READY_FOR_HUMAN_MERGE`, or hosted end-to-end proof. Self-check and green CI are not independent approval. Do not merge automatically.

## Verification and API contract

Run `node --test test/cursor-automation.test.js` for isolated tests with mocked APIs; no credentials or paid agent runs are needed. The dedicated PR workflow runs this suite, including a regression that a same-repo PR must not add `pull_request`/`pull_request_target` to the secret-bearing control workflow. The normal repository core test gate remains applicable.

The bridge targets [Cursor Cloud Agent API v1](https://cursor.com/docs/cloud-agent/api/endpoints): agent creation with a client-supplied ID, agent/run retrieval, explicit follow-up runs, and cancellation. The API is evolving; inspect contract changes before changing request handling.
