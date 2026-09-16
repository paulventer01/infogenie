# Cursor automation bridge

This integration turns authorised GitHub issue commands into Cursor Cloud Agent tasks for `paulventer01/infogenie`. GitHub Actions launches tasks, accepts explicit follow-ups, and periodically updates a signed tracking comment with run status and any PR checks returned by Cursor. It does not merge, approve PRs, or deploy. PR #192 and product routes are unaffected.

## Activate after reviewing and merging this integration

1. In GitHub repository **Settings → Secrets and variables → Actions → Secrets**, store the existing Cursor key as `CURSOR_API_KEY`. Never put it in an issue, prompt, source file, or chat. The Cursor account also needs access to this repository.
2. Open **Actions → Cursor automation → Run workflow**, select the default branch and action `verify`. This makes read-only authentication checks, without launching a billable agent. It verifies Cursor authentication and GitHub repository access; it does not prove the Cursor account can clone the repository.
3. In the same Settings page, under **Variables**, add `CURSOR_AUTOMATION_ENABLED` with value `true`. Until enabled, tasks and scheduled monitoring are disabled.
4. The allowed sender defaults to `paulventer01`. Optionally set `CURSOR_AUTOMATION_ACTORS` to a comma-separated list of explicitly trusted GitHub logins. These actors can launch billable coding tasks. Do not add a shared bot without understanding who can operate it.
5. Start one small task and inspect the tracking issue, Cursor result, and draft PR before assigning larger work. The automation workflow only runs code from the default branch, so it cannot be live-tested from this draft PR.

Keep repository branch protections and required reviews enabled. Instructions tell Cursor to use feature branches and draft PRs, but prompts do not enforce permissions: the Cursor GitHub integration has its own repository access. This workflow's GitHub token has only issue-write and code/PR/check-read permissions. Set spending controls in the Cursor account; tasks use its configured default model.

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

## Monitoring and limits

- Only one visible active Cursor task for this repository is allowed. This includes manually launched agents visible to the key. Accounts outside that visibility cannot be coordinated by this bridge.
- Up to three accepted follow-ups per tracking issue. Each requires an explicit authorised command after the current run finishes.
- Status polling is scheduled twice an hour; GitHub may delay schedules. Manual status commands are available.
- Run completion is not independent review. Check summaries refer to the PR's current head and reported checks, not a guarantee that every required review or branch rule is satisfied. PR links depend on Cursor returning them in run metadata.
- GitHub serialises control jobs and may replace an older pending job. Check Actions if a command has no result; submit a new command after the active job finishes. Do not assume every queued command ran.
- Closing an issue does not cancel an active task. Use `cancel`; active closed issues remain monitored. Closed completed issues stop polling.
- Disabling `CURSOR_AUTOMATION_ENABLED` stops bridge commands and polling; it does not stop an already running Cursor agent. Cancel first if needed.

## Failure recovery

The bridge saves signed intent before each billable API request. Network errors and ambiguous responses are never automatically retried, preventing duplicate launches or follow-ups. Use `status` to reconcile with Cursor. If still unresolved, inspect the agent in Cursor before doing anything else; do not start a replacement blindly.

Definite API rejections (such as invalid credentials or rate limits) are reported separately. Correct the cause, then create a new task issue for a rejected start or send a new follow-up command for a rejected follow-up. Re-running the same command does not replay it.

Do not edit/delete the tracking comment or remove its `cursor-automation` label. State is signed using the API key and bound to the issue/repository. Key rotation invalidates old state signatures: finish/cancel active tasks and reconcile existing tracking issues before rotating. After rotation, close/remove tracking labels from reconciled old issues before starting fresh tasks. Never restore a compromised key just to recover tracking.

Errors are available in the Actions run log and summary. Remote response bodies and keys are not logged or copied into Cursor's environment. Task instructions and tracking comments are visible to repository readers.

## Verification and API contract

Run `node --test test/cursor-automation.test.js` for isolated tests with mocked APIs; no credentials or paid agent runs are needed. The dedicated PR workflow runs this suite. The normal repository core test gate remains applicable.

The bridge targets [Cursor Cloud Agent API v1](https://cursor.com/docs/cloud-agent/api/endpoints): agent creation with a client-supplied ID, agent/run retrieval, explicit follow-up runs, and cancellation. The API is evolving; inspect contract changes before changing request handling. Monitoring uses scheduled reads rather than webhooks.
