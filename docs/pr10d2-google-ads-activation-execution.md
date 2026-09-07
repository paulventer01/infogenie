# PR10D.2 — Human-triggered Google Ads activation execution

## Frozen scope

PR10D.2 may perform exactly one synchronous Google Ads activation attempt for
one verified PR10B PAUSED graph after consuming exactly one PR10D.1 capability.
It is a separately approved provider-write boundary. It must not widen any
other Google, Meta, publishing, optimization, or automation surface.

## Required behavior

- Require an authenticated real human session, active tenant and membership,
  and the explicit tenant `advertising.campaign.activate` grant. No API-key,
  agent, service, owner, admin, platform-role, or global bypass.
- Accept only a server-issued PR10D.1 capability and a bounded invocation ID.
  Caller input cannot supply a customer ID, provider object ID, URL, query,
  mutation payload, status, budget, bid, schedule, or retry instruction.
- Re-lock and revalidate the complete PR10D.1 authority graph immediately
  before reservation and consumption: approval, draft revision and contract,
  publishing request, intent, PAUSED provider-draft operation and its three
  ledger objects, reconciliation or eligible closed-review lineage, credential
  reference/version and fingerprint, active membership/grant, expiry, and both
  activation kill switches.
- Persist one tenant-scoped activation attempt and consume the capability
  atomically before any secret scope, token exchange, or provider traffic.
- Resolve credentials only inside a dedicated last-responsible-moment Google
  activation secret scope after the committed attempt exists.
- Build one internally generated Google Ads mutate request from the immutable
  ledger. It may update only the bound `campaign` and `ad_group` statuses
  from `PAUSED` to `ENABLED`. The bound `campaign_budget` is identity
  evidence only and must never be mutated.
- Use one atomic provider request with partial failure disabled. A determinate
  provider rejection records `failed`; a confirmed complete response records
  `succeeded`; timeout, malformed, ambiguous, or incomplete responses record
  `unknown` and require reconciliation before any later human action.
- Never retry provider mutation automatically. Replay is metadata-only and
  cannot reopen secret scope, exchange tokens, or contact Google.
- Store only sanitized attempt and per-object outcome metadata. Provider
  customer IDs, provider object IDs, account fingerprints, credentials,
  tokens, URLs, raw payloads, and raw provider errors must not be exposed,
  audited, or logged.
- Expose one narrow rate-limited human HTTP activation endpoint only if needed.
  The endpoint accepts no provider-controlled fields.
- Gate live Google mutation behind
  `INFOGENIE_LIVE_GOOGLE_ADS_ACTIVATION=1`; unset is fail-closed.
- Add focused security/unit tests and real PostgreSQL integration tests to the
  advertising certification runner. PostgreSQL and certification runs must
  complete with zero skips.

## Persistence and concurrency

- Activation attempts and outcome events are tenant-leading, append-only or
  immutable as appropriate, and bound to one capability, operation, invocation,
  credential version, account fingerprint, ledger root, and human actor.
- Unique database fences allow only one attempt per capability and one result
  per bound object kind.
- Lifecycle is monotonic: `in_progress` to exactly one of `succeeded`,
  `failed`, or `unknown`. Terminal rows cannot be reopened.
- Attempt creation, capability consumption, and audit evidence commit together.
  Terminal state, normalized object outcomes, and terminal audit commit
  together.
- If the database cannot persist the pre-mutation attempt, no secret access or
  provider traffic is permitted. If terminal persistence fails after provider
  traffic, return an ambiguous failure and do not retry.

## Hard boundaries

No campaign-budget mutation, amount or bid change, object creation or deletion,
publish operation, scheduling, optimization, monitoring worker, background
trigger, queue, automatic retry, automatic remediation, UI, generic mutate
proxy, caller-supplied Google payload, unrelated Meta behavior change, or
additional provider activation.

Keep the complete PR at or below 1,500 changed lines. Do not weaken tests. Keep
the PR draft. Agents do not merge.
