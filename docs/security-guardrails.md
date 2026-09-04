# InfoGenie — Security & Guardrails

Foundational guardrails for production. See also `docs/capacity.md`.

## Modules (`services/security/`)

| Module | Role | Rollout flag |
|---|---|---|
| `headers.js` | CSP (report-only by default), nosniff, Referrer-Policy, Permissions-Policy, HSTS (prod) | `SECURITY_CSP_ENFORCE=1` to enforce CSP |
| `csrf.js` | Origin/Referer check on cookie-authenticated mutations | prod default `on`; set `SECURITY_CSRF=shadow\|off` |
| `rate_limit.js` | Sliding-window limiter; Redis when `REDIS_URL` set | always on for `/api/auth/{login,signup,request-reset}` |
| `prod_defaults.js` | Production-safe defaults for rollout flags | — |
| `secrets.js` | Timing-safe compare; `SESSION_SECRET` required in prod | boot-time |
| `password.js` | Min 10 chars + letter + number | signup / reset / invite |
| `validate.js` | Zod body/query/params helper for new routes | adopt per-route |

Permission / multitenant enforcement:

| Module | Role | Prod default |
|---|---|---|
| `services/tenants/permission_enforce.js` | RBAC matrix | `PERMISSION_ENFORCEMENT=on` |
| `services/tenants/context.js` | Tenant resolution | `MULTITENANT_ENFORCEMENT=on` |

## Recommended production env

```
NODE_ENV=production
SESSION_SECRET=<openssl rand -hex 32>
CREDENTIAL_ENCRYPTION_KEY=<openssl rand -base64 32>
INFOGENIE_API_KEY=<long random>
PERMISSION_ENFORCEMENT=on
MULTITENANT_ENFORCEMENT=on
SECURITY_CSRF=on
SECURITY_CSP_ENFORCE=1
REDIS_URL=redis://...
SENTRY_DSN=https://...
INFOGENIE_JOBS=1
```

In production, omitting the enforcement env vars still defaults them to `on`.
In development, defaults remain `shadow` / `off` / `shadow` so local work is unblocked.

## Observability

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Liveness |
| `GET /api/ready` | Readiness (Postgres required; Redis if configured) |

Structured JSON logs via `services/infra/logger.js` (`LOG_LEVEL=info|debug|warn|error`).

## Adoption checklist for new features

1. Put mutating routes behind session **or** Bearer API key (never rely on “same origin” alone).
2. Validate request bodies with `validate(schema)` from `services/security/validate.js`.
3. Scope reads/writes with `resolveTenantId` / `req.tenant`.
4. Map the route in `services/tenants/permission_matrix.js`.
5. Rate-limit any new **public** POST surface via `createRateLimiter`.
6. Never log secrets, tokens, or raw credential vault payloads.

## Advertising orchestrator — control-plane authorization (PR 1)

`/api/agent-orchestrator/workflows` is the first surface in the hub that
non-owner roles can reach. Three controls stack, and none of them is optional:

1. **Owner gate exemption** — `_OWNER_GATE_ALLOW` in `server.js` exempts
   `/^\/api\/agent-orchestrator\/workflows(?:\/|$)/` only. Without it every
   non-owner would get a blanket `owner_only` and the per-gate permission split
   below would be unreachable. It is path-anchored: the rest of the hub
   (`suggest`, `resolve`, `apply`, `history`) stays owner-gated, and a look-alike
   prefix such as `/workflows-export` does not inherit the exemption.
2. **Route group** — `{ prefix: '/api/agent-orchestrator/workflows', view/write:
   'orchestrator.workflows.view' }`. `write` equals `view` deliberately: the
   coarse group only decides "may this role touch workflows at all".
3. **Per-action `requirePermission`** — the real boundary. Create, edit,
   request-approval, pause, resume, cancel and recover each require their own
   key; approve/reject require `orchestrator.workflows.approve.<gate>` for the
   gate named in the body. A Marketer can build and drive a workflow and cannot
   approve any gate or recover one. The audit trail is a further separate
   authority: `GET /:id/timeline` requires `orchestrator.workflows.audit.view`,
   which a Marketer does not hold, while state, approvals and steps stay on
   `.view`.

Tenant isolation: every read and write resolves the tenant from the session via
`resolveTenantId(req, { label })` and filters on it. Body `tenant_id` / `user_id`
are stripped from the idempotency hash and ignored by every handler, so a
cross-tenant id is a 404, not a 403 — the existence of another workspace's
workflow is not disclosed.

Approval integrity:

- `content_hash` is server-computed over a canonical snapshot
  (`services/agent_orchestrator/hash.js`); the client never supplies it.
- `object_version` is **required** on approve. It is the approver's statement of
  which revision they read; a mismatch is `approval_stale`.
- The snapshot covers platforms, budget, **currency** and the **targeting
  lists** as well as the brief, so re-denominating or retargeting an approved
  workflow invalidates the approval. `edit` is a weaker grant than
  `approve.<gate>`, and this is what stops an editor from changing what was
  approved out from under it.
- Approvals and audit events are UPDATE-immutable by trigger; DELETE is only
  reachable through the parent workflow/tenant cascade.
- `actor_user_id` is the numeric session user id, never an email. A principal
  with no attributable positive user id cannot mutate a workflow at all.
- Audit `detail` is an **allowlist** of control-plane keys, so brief material
  (offer, objective, comment) cannot reach the trail or the log line.

Execution leases vs. concurrent mutations — `acquireLease` takes `SELECT … FOR
UPDATE` but **commits** before the phase runs, so the row lock does not span the
run. Three rules close that window, and a change to any one of them needs a
re-review:

- The runner re-validates `canTransition`, the advance chain and approval
  freshness against the row it read *under* the lease, not the row it read
  before it.
- **Every state-moving write is guarded on the row the caller validated**, not
  just the runner's. The advance write requires the `version` *and*
  `current_state` it locked; `PATCH`, `request-approval`, `approve`, `resume` and
  `recover` require the state (and, where the decision was version-bound, the
  version) they read. A guarded write that matches no row is classified from the
  live row — `workflow_cancelled`, `workflow_paused`, `approval_stale`,
  `invalid_transition` — and never retried over it. For the runner that also
  means the step is marked `abandoned` and the lease is handed back.
  Read-validate-then-write-unconditionally is the bug class here: it let a
  concurrent `resume` or `PATCH` lift a completed `cancel`, and let a finishing
  runner revert a `pause`.
- Mutations that would move bound fields or state under a live lease refuse with
  409 `execution_in_progress`: material `PATCH`, `request-approval`, `approve`,
  `resume`. `pause` and `cancel` are the stop orders and always land — `pause`
  copies `previous_state` from the row inside its own `UPDATE`, so a resume
  cannot rewind onto a phase that finished after the read and replay it on the
  same approval (that is `recover` authority, owner/admin only).

Accepted residuals:

- Phase side effects are **at-least-once**, not exactly-once. A runner that is
  refused at the guarded write (or whose lease is force-released by `recover`)
  has already invoked its phase handler. PR 1 handlers are stubs with no
  external effect; a phase that calls an ad platform needs a per-step
  idempotency key against that platform before it ships.
- `landing_page_url` was validated in PR 1 as `https:`, credential-free and
  ≤2048 chars only, with no host screening. **PR 2 closed that**:
  `workflows_api.js` now calls `assertSafeHttpsUrl` (see the outbound URL policy
  below) on both write paths and fails the write when it answers
  `{ ok: false }`. Still nothing dereferences the URL — the runner is a stub —
  so there remains no SSRF sink; the screening is now in place ahead of one
  rather than owed.
- `POST /:id/advance` requires `orchestrator.workflows.edit`, not an approve key.
  Execution is mechanical: it refuses to run unless a fresh approval whose
  `content_hash` and `object_version` still match the workflow exists for the
  phase's gate. Running an approved phase is therefore not the same authority as
  approving one.
- Idempotency keys are caller-chosen and scoped `(tenant_id, key)`. There is no
  cross-tenant collision, but inside one tenant a user can claim a key another
  user then reuses (replay of the stored response, or `idempotency_conflict` on a
  different body/endpoint). A request whose process died leaves its key at
  `response_status=0`, which answers `execution_in_progress` for that key.
- `permission_snapshot` on an approval by a platform owner/admin records
  `platform_admin_bypass` plus the gate key rather than an enumerated grant list,
  because those principals bypass `req.can()` entirely.
- `X-Orch-Test-Fail` / `X-Orch-Test-Hold` are honoured only when `NODE_ENV` is
  exactly `test`. They are inert in production, in development and when
  `NODE_ENV` is unset.

## Advertising orchestrator — credits, outbox & outbound URLs (PR 2)

PR 2 lands the credit-accounting schema, the credit engines
(`credits.js`, `limits.js`, `pricing.js`, `usage.js`, `outbox.js`, `money.js`)
and the HTTP surface at `/api/agent-orchestrator/credits`. The React panel is
**not** in this slice. What follows is the boundary as landed, re-reviewed after
Backend implemented inside it.

### Credit permissions

Five tenant-scope keys, all in `services/tenants/permissions.js`:

| Key | Holds |
|---|---|
| `orchestrator.credits.view` | balance, reserved, consumed, daily/monthly usage, per-workflow cost, failed reservations, block reasons |
| `orchestrator.credits.limits.view` | tenant AI rate/cost limits and the credit ceiling |
| `orchestrator.credits.grant` | issue credit grants |
| `orchestrator.credits.adjust` | manual adjustments and refunds |
| `orchestrator.credits.limits.edit` | change limits and the credit ceiling |

Reading spend is a wide grant; changing what may be spent is not. A **Marketer
holds the two `.view` keys only**. `grant`, `adjust` and `limits.edit` stay with
tenant administrators (owner / admin / platform), for the same
separation-of-duty reason as the six `approve.*` gates: the ceiling is what a
later approval is bound to, so a role that could raise its own ceiling could
approve more spend than it was granted. Analyst inherits the two `.view` keys
through `ALL_VIEW_PERMISSION_KEYS`; `content_creator` and `client_viewer` hold
none of the five.

Three controls stack, exactly as they do for workflows:

1. **Owner gate exemption** — `_OWNER_GATE_ALLOW` in `server.js` gains
   `/^\/api\/agent-orchestrator\/credits(?:\/|$)/`, anchored the same way as the
   workflows entry. Without it a non-owner would get a blanket `owner_only` and
   the split above would be unreachable. `suggest`, `resolve`, `apply` and
   `history` stay owner-gated, and `/credits-export` does not inherit it.
2. **Route group** — `{ prefix: '/api/agent-orchestrator/credits', view/write:
   'orchestrator.credits.view' }` in `services/tenants/permission_matrix.js`.
   Longer prefix wins, so it takes precedence over the coarse hub row, which is
   unchanged and still `brand.calendar.view` / `brand.calendar.edit`. `write`
   equals `view` on purpose — the coarse group only decides "may this role touch
   credits at all".
3. **Per-action `requirePermission`** — the real boundary. A grant requires
   `.grant`, an adjustment `.adjust`, a limit change `.limits.edit`. Reads carry
   `.view`, except `GET /limits` which carries `.limits.view`. The permission
   check runs *before* the idempotency key is claimed, so a refused caller
   cannot consume or poison a key.

`orchestrator.credits.view` is authority over cost facts, not over the workflow
catalogue. `GET /api/agent-orchestrator/credits` returns each workflow's id,
state, ceiling and `block_reason` under that key, but withholds the workflow
**name** — free text an operator typed — unless the principal also holds
`orchestrator.workflows.view`.

### Fail-closed rules, as landed

- **A ceiling of 0 blocks, it does not mean unlimited.** `credit_ceiling_micros`
  and every `orchestrator_tenant_limits` column default to `0`, and
  `limits.js:preflight` treats each one as a refusal rather than an absent cap:
  a missing workflow, a zero workflow ceiling or a zero tenant ceiling is
  `credit_ceiling_exceeded`; `requests_per_minute <= 0` is
  `rate_limit_exceeded`; `max_concurrent_ai <= 0` is
  `concurrency_limit_exceeded`; a zero daily, monthly or per-workflow cost cap
  is `tenant_cost_limit_exceeded`. "No row / no ceiling configured" is the same
  answer as "no credit". A missing pricing row estimates at the conservative
  per-request floor rather than free.
- **A failed cost check does not advance the workflow.** Every cost refusal is
  in the runner's no-clobber set, so it pauses the workflow with
  `block_reason = <code>`, writes a `workflow_blocked` audit event, hands the
  lease back and re-raises. It never `markFailed`s over the live row and never
  moves the state forward.
- **`actor_user_id` is the numeric session user id**, never an email, on every
  ledger entry, reservation and limits change. `runner.js:actorId` rejects zero
  and negative — that is the synthetic api-key principal used when no owner row
  exists — and both `credits_api.js` and `workflows_api.js` refuse the mutation
  outright when it yields no id. The ledger read route does not expose
  `actor_user_id` at all.
- **Approval binding.** `approvals.js:approvalSnapshot` folds both
  `credit_ceiling_micros` and `advertising_budget` into the `content_hash`, and
  both are in `MATERIAL_FIELDS`. Raising either after a gate was approved bumps
  `version`, returns the workflow to `research_approval_required` and writes
  `approval_invalidated`; the stored approval then fails `assertApprovalFresh`
  on both `object_version` and `content_hash`. An approval also cannot claim a
  ceiling **above** the workflow's own `credit_ceiling_micros`
  (`approval_scope_mismatch`): spend is enforced against the workflow value, so
  a higher number on the approval row would record authority that preflight
  will never honour — the same rule the advertising budget already had.
- **No client-supplied cost is the final charge.** There is no HTTP route that
  commits a reservation. Amounts come from the versioned pricing catalog
  (`pricing.js`, integer micros, `ceil`), `commit` refuses an actual above the
  amount reserved, and the ledger and usage records are UPDATE-immutable by
  trigger, so a correction is a new `adjustment` / `refund` entry rather than a
  rewrite.
- **The runner's charging path is inert outside tests.** `chargeable` in
  `runner.js` is `isTestCharge(req)` — the `X-Orch-Test-Charge` header, honoured
  only when `NODE_ENV` is exactly `test`. In production, development and with
  `NODE_ENV` unset, `POST /:id/advance` reserves and commits nothing. Read the
  fail-closed rules above as the boundary the first real spending phase will
  land inside, not as spend control that is currently exercising itself.

### Outbox and log hygiene

`orchestrator_outbox.payload` is JSONB and carries **no credentials**. Tokens
are referenced by `credential_ref`, which is an identifier resolved against the
vault at send time — never a token, never a webhook secret. Payloads and
`last_error_code` are written to a table an operator reads, so no PII, no
transcript material and no vault payload may be put in either, and provider
error text must not be interpolated into a log line (same rule as the meeting
notes telemetry below).

Two guards enforce that rather than merely asserting it:

- `credential_ref` must match `^[A-Za-z0-9_:-]{1,128}$` and must not carry a
  known secret prefix (`sk-`, `xoxb-`, `ghp_`, `AKIA`, `AIza`, …).
  `outbox.enqueue` refuses a non-conforming value rather than dropping it, so a
  caller that meant to pass a vault handle and passed the credential sees the
  write fail instead of sending with no credential. `sanitizePayload` applies
  the same rule, so the payload copy cannot carry what the column refuses. The
  character class excludes `.`, `=`, `/`, `+` and whitespace, which is what
  rules out a JWT, base64 or PEM material, a bearer header and a signed URL.
- `last_error_code` is only written when it already matches
  `^[a-z0-9_]{1,40}$`. Anything else — provider error text, which can quote the
  offending account or address — collapses to `outbox_failed` rather than being
  truncated into the row and the log line.

`orchestrator_outbox` has no product caller yet. The engine, its claim/backoff/
dead-letter state machine and these guards are in place ahead of the first
publishing phase.

### Outbound URL policy — `services/security/safe_url.js`

Security-owned, and deliberately separate from `services/_shared/ssrf.js`, which
still allows plain `http:` for older features. Do not merge the two or relax
this one. Policy, failing closed on every ambiguity:

- `https:` only; port 443 only (an explicit `:8443` is refused, not coerced).
- No credentials in the URL, hostname required, ≤2048 characters.
- Blocked literals: loopback, unspecified, RFC1918, link-local (including
  `169.254.169.254`), CGNAT `100.64/10`, multicast/reserved, IPv6 ULA
  (`fc00::/7`, so `fd00:ec2::254`), `fe80::/10`, everything with a leading `::`
  (IPv4-mapped `::ffff:`, IPv4-compatible, `::1`, `::`), NAT64 and 6to4.
- Blocked names: `localhost`, `metadata`, `metadata.google.internal`,
  `metadata.goog`, and the `.local` / `.internal` / `.localhost` suffixes. A
  trailing dot is stripped first so `localhost.` cannot slip past.
- Decimal / hex / octal / short-form IPv4 encodings (`2130706433`,
  `0x7f000001`, `0177.0.0.1`, `127.1`) are refused on the **raw** authority,
  before the URL parser silently canonicalises them.
- DNS is resolved with `dns.promises.lookup(..., { all: true })` and **any**
  blocked answer disqualifies the host. A lookup failure is not safe.
- The lookup is bounded at `DNS_TIMEOUT_MS` (3s) and a hostname that does not
  resolve inside it is refused with `dns_lookup_timeout`. The hostname is
  attacker-chosen, so the resolver wait is too; without the bound, a name
  delegated to a blackholed nameserver holds the calling request open for the
  whole `getaddrinfo` retry schedule.

There is **no fetch sink** in the module — a test asserts it neither calls
`fetch` nor loads an HTTP client. The module is now **wired**:
`workflows_api.js` calls `assertSafeHttpsUrl` through `assertLandingUrl` on both
`POST /workflows` and `PATCH /workflows/:id`, and fails the write with
`validation_failed` when the answer is not `ok`. A test asserts the call site on
both paths, because a landing page that is only shape-checked would pass a
private, loopback or metadata host straight into the row.

A caller that later fetches must: validate, keep the returned `addresses`, call
`assertPinnedAddresses(hostname, addresses)` immediately before connecting (DNS
rebinding — a record set that changed at all is refused, not reconciled),
disable automatic redirect following, and re-run `assertSafeRedirect` on every
`Location` it chooses to follow. Errors are returned as
`{ ok: false, error: 'unsafe_url', reason }`, never thrown, so a caller that
ignores the result fails open by its own choice — check `ok`.

### Tenant-isolation review of the PR 2 schema

Reviewed `services/agent_orchestrator/schema.js` as landed. **No DDL change was
required.**

- All nine new tables carry `tenant_id INTEGER NOT NULL REFERENCES tenants(id)
  ON DELETE CASCADE`. `orchestrator_credit_accounts` and
  `orchestrator_tenant_limits` use `tenant_id` as the primary key, so a tenant
  cannot hold a second account or a second limits row.
- Every unique key leads with `tenant_id`: reservations
  `(tenant_id, idempotency_key)`, pricing `(tenant_id, provider,
  model_or_service, unit_type, pricing_version)`, outbox PK `(tenant_id, id)`
  plus `(tenant_id, destination, operation, idempotency_key)`, and the ledger's
  partial unique index `(tenant_id, idempotency_key)`. There is no cross-tenant
  idempotency-key collision and no cross-tenant replay of another workspace's
  key.
- `orchestrator_credit_ledger` and `orchestrator_usage_records` are
  UPDATE-immutable by trigger and refuse a direct DELETE while the tenant row
  exists, so a correction has to be a new `adjustment` / `refund` entry rather
  than a rewrite of history. Only the tenant cascade removes them.
- `orchestrator_pricing_catalog` is tenant-scoped with no platform-wide rows, so
  a tenant with no price row must fail closed rather than borrow another
  tenant's price.

Three properties the database does **not** enforce were left to Backend.
Re-reviewed after implementation; all three are met:

- `workflow_id` on the ledger, reservations, usage records, outbox and
  `orchestrator_ai_inflight` is a bare `TEXT` with no foreign key. That is
  deliberate on the immutable tables — a cascade from `orchestrator_workflows`
  would collide with the delete-refusing trigger — but it means Postgres will
  not reject a `workflow_id` that belongs to another tenant. Every write that
  takes one resolves the workflow first with `WHERE id = $1 AND tenant_id = $2`
  and fails `not_found`: `credits.reserve`,
  `credits.releaseAllReservedForWorkflow`, `outbox.enqueue` and
  `limits.loadWorkflowOr404` (which `preflight` calls before it reads a ceiling).
- `orchestrator_credit_reservations.id` and `orchestrator_ai_inflight.id` are
  global `TEXT` primary keys, like `orchestrator_workflows.id` in PR 1.
  Uniqueness is global, so ids are not enumerable from another tenant's
  sequence, but a lookup by id alone would cross tenants. Every read and write
  carries the `tenant_id` predicate — `loadReservation`, `commit`, `release`,
  `releaseInflight`, and the outbox claim/complete/fail paths — so a
  cross-tenant id answers 404, never 403, and `commit` on another tenant's
  reservation raises `not_found` rather than moving money.
- Balance arithmetic is guarded only by `CHECK (… >= 0)` and
  `committed_micros <= amount_micros`; nothing in the schema serialises two
  concurrent reservations against one account. `credits.ensureAccount` takes
  `SELECT … FOR UPDATE` on `orchestrator_credit_accounts`, and every mutating
  entry point (`grant`, `reserve`, `commit`, `release`, `adjust`) goes through
  it inside one transaction, always locking the account before the reservation
  row, so there is no lock-order inversion between commit and release.
  `preflight` reuses the row the caller already locked rather than taking a
  second lock. Reads pass `{ lock: false }`: a `GET` that took `FOR UPDATE`
  would let any principal holding `orchestrator.credits.view` queue the reserve
  path behind a viewer.

### Accepted residuals (PR 2)

- **The advance-time credit charge is at-least-once**, inheriting the PR 1
  residual above. Idempotency keys are `(tenant_id, key)` and a request whose
  process dies leaves the key `pending`; once its 30s lease expires a retry
  reclaims it and re-runs the handler. The reservation key is derived from a
  freshly generated `step_id`, so a retry that lands in the window between
  `commit` and the guarded state write charges a second reservation for one
  logical advance. Both charges appear as distinct rows in the immutable ledger
  and are refundable via `adjust`, and both are still bounded by the ceiling and
  the per-workflow cap. This window is **not reachable in production** while
  `chargeable` is the test-only header. Binding the reservation key to the
  request idempotency key instead closes it, but naively reusing a *released*
  reservation would let the retry run free, so it needs the reservation state
  checked at reuse — that is a design change for the first real spending phase,
  not a patch. The money-moving HTTP routes are not affected: `grant` and
  `adjust` key the ledger entry on the request's idempotency key, and the
  ledger's partial unique index on `(tenant_id, idempotency_key)` makes a
  reclaimed retry a replay.
- `orchestrator_tenant_limits.provider_limits` is stored as supplied. There is
  no size or depth cap on the object itself, but credits mutations (`grant`,
  `adjust`, `PUT /limits`) and workflow mutations share the fail-closed 64kb
  `capPayload` middleware in `services/agent_orchestrator/payload_cap.js`
  (Content-Length and actual/raw body). It takes
  `orchestrator.credits.limits.edit`, the blast radius is the editing tenant's
  own preflight, and every numeric field inside it is still read fail-closed.
  A future hardening pass may bound `provider_limits` depth/size inside the
  handler.
- Neither `grant` nor `adjust` has an upper bound beyond `BIGINT`. An absurd
  amount overflows the column and surfaces as `500 internal_error` rather than
  `400 validation_failed`. Admin authority, no state change, but the wrong
  status code. `microsToJson` also clamps responses at 9e15 micros, so a balance
  past that would be under-reported in JSON while the ledger stays exact.
- `credits.commit` accepts a caller-supplied `usage.computedMicros` that is
  written to the usage record as `actual_cost_micros` with
  `usage_source = 'provider'`, and that record — not the ledger — is what the
  daily/monthly caps sum. No HTTP route reaches it; the runner passes only
  server-computed values. A provider-usage adapter must compute it server-side
  from provider units, not accept it from a response body.
- The `credential_ref` guard is a shape rule plus a known-prefix denylist. An
  opaque provider token is shaped exactly like an opaque vault handle, so the
  guard cannot recognise one in general. The substantive control is that the ref
  is resolved against the vault at send time, so a value that is not a vault key
  cannot authenticate anything.
- `DNS_TIMEOUT_MS` bounds how long a caller waits, not the resolver. The
  underlying `getaddrinfo` is not cancellable and keeps its libuv threadpool
  slot (four by default) until the OS gives up, so a burst of blackholed
  hostnames can still contend with other threadpool work.
- `landing_page_url` is re-validated on every `PATCH`, including when the field
  is unchanged. That is deliberate — it is what stops a workflow keeping a URL
  the policy would now refuse — but it means an edit to an unrelated field fails
  while the resolver is unavailable or if the stored host has since started
  answering with a private address.
- `actor_user_id` on the ledger, reservations and limits is
  `REFERENCES users(id) ON DELETE SET NULL`. Deleting a user detaches
  attribution from entries that are otherwise immutable; the amounts and reason
  codes survive, the actor does not.

## Meeting notes — outbound data flow (redaction deferred)

`POST /api/meeting-notes/summarize` still sends **up to 12,000 transcript characters
unredacted** to `api.openai.com`, together with the whitelisted contact fields
(`name`, `company`, `role` only — `email`, `phone` and free-text keys are dropped
before the prompt and before the row). No PII detection or masking runs on the
transcript body today, so a caller who pastes a call transcript containing names,
emails, phone numbers or account identifiers transmits them to the provider.

Pre-transmission transcript redaction is a **separate follow-up PR owned by
AI/LLM**; per-tenant AI rate/cost limiting is the PR after that. Neither is
implemented here.

At rest the same route is bound: the 500-character excerpt and the summary are
AES-256-GCM encrypted through `services/credentials/vault.js` with AAD
`meeting_notes_runs:tenant:<id>`, so a row lifted into another tenant fails the
GCM auth tag instead of decrypting. Passing no AAD is byte-for-byte the pre-AAD
behaviour, which is what keeps existing `platform_api_keys` and
`user_integrations` rows readable. Excerpt material is NULLed 30 days after
write by the sweeper (`sweepExpiredExcerpts`, `UPDATE` only — history rows are
never deleted), and `generated_by` holds the numeric session user id, never an
email.

`contact` is narrowed at rest as well as on read. `backfillMeetingNotesEncryption()`
in `services/meeting_notes/schema.js` runs as a boot task, walks each tenant in
batches, and rewrites `contact` to the `{name, company, role}` whitelist — string
values only, each capped at 200 characters — so `email`, `phone` and free-text keys
written before the whitelist existed are removed from the row, not merely hidden.
Values under an allowed key that are not strings (a nested object, say) or that run
past the cap are rewritten too, and an array or scalar `contact` collapses to `{}`.
The API narrows `contact` again on read (`_whitelistedContact` in `api.js`), so a row
the backfill has not reached yet still cannot surface `email` / `phone` through
`/api/meeting-notes/history` or the detail route.

Because it runs on the boot path the sweep must not hang: malformed `summary` JSONB
(an array or a scalar) is encrypted rather than passed over, and any selected row the scrubber
would leave unchanged is excluded from the rest of that tenant's batch loop instead
of being re-selected forever.

### The backfill fails closed

A backfill that logged a warning and returned success would let historical
plaintext sit on disk indefinitely behind a green boot. It does not.
`verifyMeetingNotesEncryption()` re-reads the table after the scrub pass, walking
every distinct `tenant_id` on `meeting_notes_runs` — including ids with no
matching `tenants` row — with a tenant-scoped `COUNT` per tenant. A row is
non-compliant when any of these hold:

| Reason key | Residual it catches |
|---|---|
| `plaintext_excerpt` | `transcript_excerpt` still non-NULL, with or without ciphertext |
| `plaintext_summary` | non-empty `summary` JSONB, with or without ciphertext |
| `email_generated_by` | `generated_by` still looks like an address |
| `contact_non_object` | array / scalar `contact` |
| `contact_extra_keys` | any key outside `{name, company, role}` |
| `contact_non_string` | an allowed key holding a non-string |
| `contact_too_long` | an allowed value past 200 characters |
| `partial_excerpt_crypto` | 1–2 of ciphertext/IV/tag NULL |
| `partial_summary_crypto` | 1–2 of ciphertext/IV/tag NULL |
| `missing_excerpt_ttl` | excerpt material on disk — `transcript_excerpt`, `excerpt_ciphertext`, `excerpt_iv` or `excerpt_tag` — with a NULL `excerpt_expires_at` |
| `verify_query` | the tenant's verification query itself failed |

The two `partial_*_crypto` arms are defence in depth: the
`meeting_notes_runs_{excerpt,summary}_crypto_check` CHECK constraints already
reject a half-written crypto triple at write time, but those `ALTER`s are wrapped
in try/catch so an older database can boot without them.

The first two arms deliberately ignore whether ciphertext exists. A row can hold
plaintext *and* a complete ciphertext triple at once, and gating on
`… IS NULL` would have let that leftover plaintext sit on disk forever while
verification reported success. The backfill selects those rows too and heals them
according to the state of the triple:

| Triple | Backfill action |
|---|---|
| missing (all three NULL) | encrypt, then NULL the plaintext and set the 30-day TTL |
| complete (all three set) | drop the plaintext if any is left, and assign the 30-day TTL when `excerpt_expires_at` is NULL — no re-encryption, so ciphertext, IV and tag stay byte-identical |
| partial (1–2 NULL) | leave the row alone; it stays non-compliant, and it is not TTL-repaired either |

The complete-triple arm is selected on either residual, not just leftover
plaintext: `NEEDS_BACKFILL_SQL` picks up a complete triple whose
`excerpt_expires_at` is NULL even when `transcript_excerpt` is already NULL.
Without that arm a row could be encrypted, plaintext-free, and still retained
forever, because the sweep predicate only matches a non-NULL expiry. The TTL is
written as `COALESCE(excerpt_expires_at, created_at + interval '30 days')`, so an
expiry that already exists is never moved, and a row older than 30 days is
assigned a past-due expiry that the next sweep purges. Nothing else about the
crypto columns is touched on that path — no decrypt, no re-encrypt, no rewrite of
ciphertext, IV, tag or the encrypted summary — and no row is deleted.

The partial case is refused on purpose. A ciphertext with no IV or tag cannot be
decrypted, so the plaintext beside it is the only readable copy — dropping it
would destroy data, and keeping it silently would leave PII at rest. Failing the
boot hands that decision to an operator. The same refusal covers its TTL: a
partial triple with a NULL `excerpt_expires_at` is left as it is and reported
under both `partial_excerpt_crypto` and `missing_excerpt_ttl`. Rows in that state
are selected by the backfill but changed by nothing, so the batch loop's stall
guard excludes them from the rest of the tenant's walk rather than re-selecting
them forever.

Success requires **zero** row errors and **zero** non-compliant rows. Anything
else is a failure:

- **Production** — `backfillMeetingNotesEncryption()` throws a counts-only error
  and the `server.js` boot task calls `process.exit(1)`. The same is true of the
  retention sweep. The process therefore does not stay up with known leftovers,
  and the deployment fails rather than rolling out. Note what this does *not*
  say: `listen` is not gated on boot-task completion. `app.listen` runs
  synchronously while the shared `BOOT_TASKS` loop in
  `services/cloudflare_status/routes.js` is an unawaited async IIFE, so the port
  is already bound when verification runs and there is a brief window in which
  the process accepts connections before it exits. Treat the non-zero exit as the
  control, not the absence of a listening socket.
- **Development** — the call returns `{ ok: false, … }` with the counts so local
  work is not blocked.

Failure telemetry is aggregate-only: per-reason counts plus at most 50 row
references of the form `{tenant_id, id}`. Postgres error text is never
interpolated into a log line or a Sentry event — a constraint or `detail:` string
can quote the offending value, so the pg error object is discarded and a
synthetic `new Error(<event name>)` is captured instead. The boot-task catch in
`server.js` logs the caught message only when it carries a known
`[meeting-notes]` / `meeting_notes_` prefix, and substitutes a generic string
otherwise.

### The 30-day excerpt promise is monitorable

`sweepExpiredExcerpts()` NULLs `transcript_excerpt`, `excerpt_ciphertext`,
`excerpt_iv` and `excerpt_tag` together (so the CHECK constraint stays satisfied)
and stamps `transcript_purged_at`. It is `UPDATE`-only, tenant by tenant, with
`WHERE tenant_id = $1`; the encrypted summary columns are untouched and no
history row is ever deleted.

The sweep is observable rather than best-effort:

- It runs at boot and then on a 6-hour `setInterval`, registered at require time
  behind `runtime_flags.backgroundEnabled()` — that is, only under
  `node server.js` (`npm start`), never under `buildApp()` in tests.
- `verifyOverdueExcerpts()` re-counts overdue rows after the purge. Leftovers log
  `meeting_notes_excerpt_retention_overdue` at error level and raise a Sentry
  event.
- Per-tenant `UPDATE` failures are counted and reported, not swallowed. The
  recurring interval's `.catch` logs and captures too.
- `getExcerptSweepMetrics()` exposes `lastStartAt` / `lastCompletedAt` /
  `lastSuccessAt` / `lastPurged` / `lastFailures` / `lastOverdue` plus running
  totals, in process only — it is not mounted on any route. `lastSuccessAt` is
  stamped only when the run had zero failures **and** zero overdue leftovers, so
  a stale `lastSuccessAt` is the signal that retention has stopped working.

Accepted residuals:

- A dev boot with no `CREDENTIAL_ENCRYPTION_KEY` writes the summary as plaintext
  JSONB. Production refuses to boot without the key, so this is dev-only.
- `transcript_sha256` is retained after the excerpt is purged (integrity /
  dedupe). It is a plain SHA-256, not a keyed HMAC.
- A JSONB `null` `contact` stays `null` at rest instead of being rewritten to `{}`.
  It holds no PII and the API still presents `{}`, so the backfill skips the row
  rather than spending a write on it.
- The sweep predicate requires a non-NULL `excerpt_expires_at`, so excerpt
  material written without a TTL never expires. PR #78 shipped exactly that row:
  its dual-state heal NULLed `transcript_excerpt` beside a complete triple
  without assigning `excerpt_expires_at`, so the encrypted excerpt was retained
  indefinitely and verification still reported the row compliant. The fix is the
  `missing_excerpt_ttl` arm plus the complete-triple TTL repair described above;
  the sweeper was deliberately not relaxed to compensate. It still requires a
  non-NULL expiry and is still `UPDATE`-only, so a row that is missing its TTL is
  skipped, never deleted to make the retention number look right. Until every
  such row is repaired — and a partial triple never is — production fails its
  boot. Any new write path must still set the column: repair on the backfill path
  is a backstop, not the contract.
- Healing a row that already carries a complete triple trusts that triple: the
  leftover plaintext is dropped without first decrypting the ciphertext to check
  the two agree. Confidentiality is the reason — the plaintext is the exposure —
  but if a triple were ever stale or bound to a different tenant's AAD, the
  plaintext is discarded rather than reconciled, and the read path surfaces `{}`
  for a summary it cannot decrypt.
- A row holding plaintext beside a *partial* triple is never repaired
  automatically, so production keeps failing its boot until an operator resolves
  it. That is the intended outcome; see the triple table above.

## Tenant-schema closeout — global vs mixed vs child

Isolation-policy review of the fail-closed `tenant_id` closeout. Every
classification below was checked against a live Postgres built from the real
`ensure*Schema()` functions, not read off the source comments. Verdicts are
**accept** or **reject** per table class; the query predicates Backend still owes
are listed once, at the end, because the schema cannot enforce them.

Nothing in this review loosens `MULTITENANT_ENFORCEMENT`, `PERMISSION_ENFORCEMENT`,
`ROUTE_GROUPS`, or the assertions in `test/tenant-schema-audit.test.js`. No entry
was added to `KNOWN_GLOBAL` or `NULLABLE_OK` for the tables reviewed here. Later
`KNOWN_GLOBAL` additions are justified where they land —
`orchestrator_research_legacy_short_due_snapshot` under the research-retention
residuals, and `orchestrator_advertising_global_kill_switches` in the inventory
below. Neither added anything to `NULLABLE_OK`.

### Global, no `tenant_id` — accepted

- **`benchmark_aggregates`** — accepted. The row *is* the anonymised network
  percentile: `UNIQUE (vertical, region, company_size, metric_key)` has no tenant
  axis, and `_rebuildAggregates` recomputes each bucket from **all**
  `benchmark_submissions` rows. Adding `tenant_id` would either duplicate the
  same percentile per workspace or silo the data-moat into single-tenant
  "benchmarks" that no longer benchmark anything. The tenant-scoped side is
  intact: `POST /submit` writes `benchmark_submissions` with
  `resolveTenantId(req, { label:'benchmarks:submit' })`, and the only cross-tenant
  read of that table is `_rebuildAggregates`, which emits percentiles rather than
  rows — no route returns another workspace's individual submissions. Backfill
  rule: none — the table is derived, so it is rebuilt rather than migrated.
  Residual risk (k-anonymity) is recorded below.
- **`job_queue`** — accepted, conditionally. It is a platform worker queue:
  workers claim rows globally by `(status, run_at)` and nothing keys off a
  workspace. The classification holds only because the payload is empty today —
  the sole production enqueue site is `_enqueueDueSchedules` in
  `services/jobs/scheduler.js`, which calls `enqueue(s.name, {}, …)`. The moment a
  caller enqueues a payload carrying workspace data (or a `tenant_id` field), the
  table stops being platform registry and must be scoped; a job row is readable by
  any worker in the install. Treat a non-empty payload as a schema change, not a
  handler change.
- **`job_schedules`** — accepted. `PRIMARY KEY (name)` is a process-level cron
  registry keyed by schedule name, written by `registerSchedule` at boot. There is
  no per-workspace schedule concept, and `last_enqueued_at` is install-wide
  bookkeeping. Backfill rule: none.
- **`simulation_templates`** — accepted. Seeded shared catalog with
  `UNIQUE (label)`, read by `services/digital_twin/api.js` with no tenant filter
  and never written by a request path. It is product content, not workspace data,
  so the read is a catalog read. Backfill rule: none — seeded, never migrated.
  Tenant-owned simulation *runs* live in separate scoped tables.
- **`orchestrator_advertising_global_kill_switches`** — accepted. It is the
  platform-wide advertising admission singleton, not workspace data:
  `PRIMARY KEY (switch_key)` plus `CONSTRAINT orchestrator_agks_key
  CHECK (switch_key IN ('optimization_execution','google_ads_provider_draft'))`
  bind the table to exactly two operator-owned rows, seeded by
  `INSERT … ON CONFLICT (switch_key) DO NOTHING` in
  `services/agent_orchestrator/schema.js`. Both readers are deliberately
  unscoped — `lockAdmission` in
  `services/agent_orchestrator/optimization_execution_run.js` reads
  `WHERE switch_key='optimization_execution' FOR SHARE`, and
  `services/security/google_ads_provider_draft_capabilities.js` joins
  `ON g.switch_key='google_ads_provider_draft'` — because one workspace must not
  be able to opt itself out of a platform-wide stop. No request path writes the
  table; toggling is operator SQL, so there is no tenant-reachable write to
  scope. The per-workspace half is a **separate** table:
  `orchestrator_advertising_tenant_kill_switches` keeps
  `tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` with
  `PRIMARY KEY (tenant_id, switch_key)`, is read as
  `WHERE tenant_id=$1 AND switch_key=…`, and cascades on tenant deletion while
  the platform rows survive. Backfill rule: none — seeded, never migrated. It is
  `KNOWN_GLOBAL` and **not** `NULLABLE_OK`: a nullable `tenant_id` did briefly
  reach the table because it was listed in `ADVERTISING_ORCH_TABLES` and
  `addTenantIdColumn` injected the column, but `NULLABLE_OK` is for tables that
  hold both global and per-workspace rows, and this one holds no per-workspace
  rows at all. The shared `orchestrator_advertising_kill_switch_guard` trigger
  therefore gates its `NEW.tenant_id` check behind `TG_TABLE_NAME`, so the
  tenantless table stays updatable while `tenant_id` immutability is enforced
  only on the scoped companion.

### Mixed / `NULLABLE_OK` — accepted as a shape, rejected as currently written

**`vertical_playbooks`** follows the `roles` pattern, and the *shape* is right:
system catalog rows keep `tenant_id IS NULL` with `is_system = TRUE`, custom rows
are tenant-owned, and the two partial unique indexes —
`(vertical) WHERE tenant_id IS NULL` and `(tenant_id, title) WHERE tenant_id IS
NOT NULL` — separate the two key spaces cleanly. Keeping it in `NULLABLE_OK` is
correct; the alternative (copying the six-playbook catalog onto every tenant) is
worse.

The classification nonetheless **fails in practice**, because it depends entirely
on a precondition the handler does not meet. `POST /generate-custom` inserts with
`is_system = FALSE` and **no `tenant_id`**, so a custom playbook lands in the
system key space. Confirmed on a live schema — the inserted row came back
`tenant_id=null, is_system=false`, with three consequences:

- **Cross-tenant disclosure.** `POST /activate/:id` resolves the playbook with
  `WHERE id=$1` and nothing else, so any workspace can activate any id. After
  activating another tenant's custom playbook, `GET /active/list` joins
  `vertical_playbooks` and returns its `title` and full `content` — a document
  generated from that tenant's `business_description`, goals and challenges.
  Reproduced end to end: tenant B read tenant A's private playbook body. This is
  the highest-severity finding in the set and it is an authorization bug, not a
  schema bug — the partial index cannot fix it.
- **Cross-tenant denial of service.** The NULL-tenant custom row occupies the
  system slot for its vertical, so a second workspace generating a playbook for
  the same industry gets `23505` on
  `vertical_playbooks_system_vertical_idx`. Two tenants in one industry lock each
  other out.
- **Catalog poisoning.** For the same reason, `seedPlaybooks`' `ON CONFLICT DO
  NOTHING` silently skips a system playbook whose vertical a tenant has already
  claimed. That vertical then never reaches the shared catalog, and because the
  `is_system=TRUE` count never reaches `SYSTEM_PLAYBOOKS.length`, the seed loop
  re-runs on every `/list` and `/:vertical` request.

`seedPlaybooks` itself is correct and must stay as it is: `tenant_id` omitted,
`is_system = TRUE`. That is the one INSERT into this table that may legitimately
skip the tenant stamp, and `test/tenant-closeout-write-audit.test.js` now encodes
exactly that rule rather than allowlisting the file.

### Child, tenant-owned — accepted

`compliance_checklist_items` (← `campaign_compliance_checklists.id` via
`checklist_id`), `post_launch_checks` (← `post_launch_audits.id` via `audit_id`),
`backlink_snapshots` / `backlink_changes` (← `backlink_monitors.id` via
`monitor_id`), `geo_citation_checks` (← `geo_audit_runs.id` via `run_id`),
`hashtag_scans` (← `hashtag_watches.id`), and `yt_snapshots` (←
`yt_channels.id`) are all accepted as tenant-owned children.

- **Why a column and not just the FK.** The parent FK already implies exactly one
  tenant, so a denormalised `tenant_id` is redundant *if* every query joins the
  parent. It is worth carrying anyway: it lets a child read filter on one table,
  it makes an unscoped child query fail closed on `NOT NULL` instead of leaking,
  and it is what the schema audit can actually assert. The cost is that the column
  can now disagree with the parent, which is why the stamp must come from the
  parent row rather than the request.
- **Backfill rule.** Inherit `parent.tenant_id`, and only where the parent's own
  `tenant_id` is non-NULL — which is what `options.backfillFrom` does. A child
  whose parent is missing or itself unowned stays NULL and blocks the flip. No
  child is default-assigned.
- **Child uniqueness does not need to lead with `tenant_id`.**
  `backlink_snapshots UNIQUE (monitor_id, referring_domain)` and
  `idx_blc_dedupe (monitor_id, change_type, referring_domain, utc_date)` are
  tenant-safe as written, because `monitor_id` is owned by exactly one tenant, so
  a conflict can only ever be intra-tenant. The "composite must lead with
  `tenant_id`" rule in `test/tenant-schema-audit.test.js` applies to
  `REWRITE_UNIQUE` **natural** keys (a domain, a handle, a slug — values two
  tenants can independently choose), not to FK-anchored child keys. That is why
  these two tables are correctly absent from `REWRITE_UNIQUE`.

### Tenant-owned closeout — accepted

The 26 previously-nullable feature tables flipped to `NOT NULL` through the
fail-closed path are accepted. On an install already carrying Phase-2 data the
flip is a no-op with respect to ownership — `addTenantIdColumn` had backfilled
those rows to the default tenant long before, so fail-closed finds zero NULLs and
only tightens the column. It is genuinely unmappable rows that now block the
flip, which is the intended trade.

`backlink_monitors` correctly moves from a global `UNIQUE (domain)` to
`UNIQUE (tenant_id, domain)`: two workspaces may monitor the same domain
independently, and neither can address the other's row.

### The fail-closed orphan policy is correct

`enforceTenantIdNotNull` behaves as documented, and the policy is the right one.

- **No default-tenant assignment.** `_getDefaultTenantId` is never called on this
  path. The only write to `tenant_id` is the parent-join `UPDATE`, guarded by
  `AND parent.tenant_id IS NOT NULL`, so an unowned parent cannot launder
  ownership onto its children.
- **No silent delete.** There is no `DELETE` in the function. Leftover rows are
  counted, left in place, logged, and reported as
  `{ ok:false, reason:'orphans', orphanCount }`. Deleting rows to make a
  `NOT NULL` flip succeed would destroy data to improve a schema metric; refusing
  the flip is correct.
- **Skipping the flip is the right failure mode.** The alternative — flip anyway —
  cannot happen (Postgres would reject it), and forcing it by assigning a tenant
  would hand one workspace another's rows. Leaving the column nullable is a
  weaker invariant, not a leak: reads filter `WHERE tenant_id = $1`, so a
  NULL-tenant row is invisible to every tenant. It is inert until someone writes
  a query that omits the predicate.
- **Boot safety is preserved.** The work is one transaction per table, rolled back
  on error, and every failure returns rather than throws, so a single bad table
  cannot take down boot.

No change was required in `services/tenants/migration.js`. One genuine defect
found on the *caller* side is handed back to Database below.

### The backlink IMMUTABLE function is not a privilege-escalation vector

`infogenie_timestamptz_utc_date` is safe, and the `IMMUTABLE` marking is
substantively correct rather than merely convenient. Verified against
`pg_proc`: `prosecdef = false` (SECURITY INVOKER — no `SECURITY DEFINER`),
`provolatile = 'i'`, `lanname = sql`, `proconfig = null`.

- **Invoker rights.** With `prosecdef = false` the body executes with the calling
  role's privileges, so the function grants nothing. The body is a pure
  expression over its argument — no table reference, no `pg_read_*`, no dynamic
  SQL — so even the default `EXECUTE` grant to `PUBLIC` conveys no authority
  beyond arithmetic the caller could already perform inline.
- **The immutability claim is true**, which matters because a falsely-`IMMUTABLE`
  function in a unique-index expression silently corrupts the index.
  `(ts AT TIME ZONE 'UTC')::date` is a fixed conversion and does not read the
  session `TimeZone`. Demonstrated by evaluating one instant under two zones:
  the wrapper returned `2026-08-21` under both `Pacific/Kiritimati` and
  `Pacific/Midway`, while the bare `::date` cast returned `2026-08-22` and
  `2026-08-21`. So the wrapper is both necessary and sound, and `idx_blc_dedupe`
  is trustworthy.
- **No new crypto, no `search_path` dependence on user input.** Hardening
  recommendation, not a finding: pinning `SET search_path = pg_catalog` on the
  function would remove the theoretical shadowing path against an index
  expression. It requires DB-level `CREATE` privilege to exploit, which is
  already game over, so this is defence in depth for Database to fold into a
  future `schema.js` edit.

### Required Backend predicates

**Status: all closed** by `ff81896` / `e0180a0`. The list below is the review
record of what was owed; "Re-review after the Backend stamps" verifies each one
as landed. `Mixed / NULLABLE_OK` above is likewise closed — the rejection there
was of the handler, not the shape.

Confirmed required. Each is either a `NOT NULL` violation reproduced against a
live schema, or a missing predicate that lets one workspace address another's
row. Authoritative `tenant_id` comes from `resolveTenantId(req, { label })` or
from a **trusted parent row already loaded under a tenant predicate** — never
from `req.body.tenant_id`, which no handler below should read.

**`services/launch_compliance/api.js`**

- `POST /checklists` — the seed loop's `INSERT INTO compliance_checklist_items`
  must name `tenant_id` and pass the resolved `tid`. Reproduced: `23502
  null value in column "tenant_id"`. Checklist creation currently 500s at the
  first item, so this is a hard break, and because the parent row is inserted
  first the caller is left with an item-less checklist.
- The follow-up `SELECT … FROM compliance_checklist_items WHERE checklist_id=$1`
  (create and `GET /checklists/:id`) and the summary
  `SELECT … WHERE checklist_id=$1` should add `AND tenant_id=$n`.
- The list query's `LEFT JOIN compliance_checklist_items i ON i.checklist_id=c.id`
  should add `AND i.tenant_id = c.tenant_id`.
- `UPDATE campaign_compliance_checklists SET overall_result=… WHERE id=$2` should
  add `AND tenant_id=$3`; likewise the `ai_feedback` and `brand_score` updates.

  Severity note: these read/update predicates are **defence in depth today, not
  live leaks**. Every one of those ids is derived from a row already fetched or
  updated under `tenant_id=$n` (the `PUT /items/:itemId` update joins
  `campaign_compliance_checklists` on `c.tenant_id=$4` before returning
  `checklist_id`). They are still required: the transitive argument is invisible
  at the call site, so it breaks the moment someone reorders the handler, and the
  `NOT NULL` column is worth nothing if no query reads it.

**`services/post_launch_audit/api.js`**

- `POST /audits` — the seed loop's `INSERT INTO post_launch_checks` must name
  `tenant_id`. Reproduced: `23502 null value in column "tenant_id"`. Same hard
  break as above.
- `UPDATE post_launch_checks … WHERE audit_id=$3 AND check_type IN (…)` (live
  check) and `… WHERE audit_id=$3 AND check_type=$4` (lead flow) should add
  `AND tenant_id=$n`.
- `SELECT * FROM post_launch_checks WHERE audit_id=$1` (`GET /audits/:id`), the
  `LEFT JOIN post_launch_checks c ON c.audit_id=a.id` in the list query, and
  `_updateAuditStatus`'s `SELECT status … WHERE audit_id=$1` /
  `UPDATE post_launch_audits … WHERE id=$3` should carry the tenant. Give
  `_updateAuditStatus` an explicit `tenantId` parameter rather than letting it
  infer scope from its caller — it is a module-level helper, so the transitive
  guarantee is not visible where it executes.

**`services/vertical_playbooks/api.js`**

- `POST /generate-custom` — `INSERT INTO vertical_playbooks` must name
  `tenant_id` and pass the resolved `tid` with `is_system = FALSE`. This is the
  fix that stops a custom playbook occupying the shared system key space.
- `POST /activate/:id` — the lookup must be
  `WHERE id=$1 AND ((is_system = TRUE AND tenant_id IS NULL) OR tenant_id = $2)`.
  Without it, an id from another workspace activates and then discloses through
  `GET /active/list`. Answer `404`, not `403`, so playbook ids stay
  non-enumerable.
- `GET /active/list` — already scoped through `active_playbooks.tenant_id`; once
  `activate` is fixed, no change is needed. If a custom-playbook listing is ever
  added it must filter
  `(is_system = TRUE AND tenant_id IS NULL) OR tenant_id = $1`.
- `seedPlaybooks` — leave unchanged (`tenant_id` omitted, `is_system = TRUE`).
- `GET /list` and `GET /:vertical` — leave unchanged. Both filter
  `is_system = TRUE`, which is a catalog read; they need no tenant.

**`services/backlink_monitor/api.js`**

- `POST /domains` — `ON CONFLICT (domain)` must become
  `ON CONFLICT (tenant_id, domain)`. Confirmed both halves against a live schema:
  the current statement raises `42P10 there is no unique or exclusion constraint
  matching the ON CONFLICT specification`, and the composite target succeeds. On
  a correctly-migrated database this is fail-closed — every create/update 500s,
  nothing leaks. It is nonetheless urgent, because on any install where the
  legacy global `UNIQUE (domain)` survived the drop, the *same* statement takes
  the `DO UPDATE` arm across tenants and `RETURNING *` hands the caller the other
  workspace's `alert_email` and `alert_slack_webhook` — a webhook secret. Do not
  "fix" this by re-adding a global unique on `domain`.
- `_runMonitor` — `DELETE FROM backlink_snapshots WHERE monitor_id=$1` and
  `UPDATE backlink_changes SET notified_at … WHERE monitor_id=$1` should add
  `AND tenant_id=$2` from `monitor.tenant_id`.
- The cron path is **accepted as-is**. `_cronTick` selects due monitors across all
  tenants — correct for a platform worker — and `_runMonitor` then stamps child
  writes with `monitor.tenant_id`, a trusted column read from
  `backlink_monitors`, never from a request body. `POST /run-now` reaches the same
  helper only through `WHERE id=$1 AND tenant_id=$2`, so a caller cannot steer
  the worker at another workspace's monitor.
- `GET /domains`, `POST /domains`, `DELETE /domains/:id`, `GET /changes` and
  `POST /run-now` call `resolveTenantId` without checking the result. Under
  enforcement `on` an api-key caller with no tenant gets `tid = null`, which
  fails closed (reads match nothing, the insert violates `NOT NULL`) but surfaces
  as an empty list or a `500` rather than `400 no_tenant`. Add the
  `if (!tid) return _err(res, 400, 'no_tenant')` guard the other services use.

### Handed back to Database

**Status: closed** by `b30bd63`, which retired the seed rather than adding the
table to `NULLABLE_OK`. Verified below.

**`brand_foundation` never reaches `NOT NULL` on a fresh install, and the
fail-closed switch makes that permanent.** `services/brand_foundation/schema.js`
seeds the legacy `id=1` row *before* `tenant_id` exists (the seed is guarded on
the column's absence), so `enforceTenantIdNotNull` then finds exactly one
unowned row, reports `reason:'orphans'`, and skips the flip. Reproduced on a
clean database: `tenant_id is_nullable = YES` with
`[{"id":1,"tenant_id":null}]`.

This is not a regression from these three commits — the previous
`addTenantIdColumn` call did not pass `notNull` either, and on a fresh install
there is no default tenant to backfill to — but it is now self-perpetuating,
because on an install that *does* have a default tenant the old path would have
adopted the blank row and the new path deliberately will not. `brand_foundation`
is excluded from `phase2_migrate.js` as the "proof case", so nothing else will
ever flip it, and it is absent from both `NULLABLE_OK` and `PHASE2E_NULLABLE_OK` —
so `test/tenant-schema-audit.test.js`'s NOT-NULL assertion fails on any fresh
install, as does `test/tenant-schema-closeout.test.js`'s canonical-path test.

The fix belongs to Database in `services/brand_foundation/schema.js`, not here,
and it is **not** to add the table to `NULLABLE_OK` — a per-tenant singleton has
no legitimate global row. Retire the legacy seed (it exists only for
pre-Phase-2 compatibility and writes an all-defaults row), or delete a
provably-blank unowned row immediately before the closeout call so the flip can
proceed. Deleting a row with tenant data would not be acceptable; this specific
row carries none.

Separately, `test/tenant-schema-closeout.test.js`'s `parent backfill copies
parent tenant, never tenant 1` asserts its fixture tenant is not id 1, which is
true only when the test runs against a database that already has tenants. It
failed on the first run against a clean database and passed on the second. The
assertion is checking the fixture rather than the helper — the helper's real
property is that it copies the parent's id — so it should be rewritten to assert
the child's `tenant_id` equals the parent's regardless of the value. Test-fixture
defect, no policy impact.

### Re-review after the Backend stamps

Second isolation pass over `b30bd63` (Database) and `ff81896` / `e0180a0`
(Backend). **Every predicate this review asked for is present, and the two
reproduced leaks are closed.** Verified by re-running the reproductions against a
live Postgres rather than reading the diffs.

- **Custom playbook disclosure is closed.** `generate-custom` stamps the row from
  `resolveTenantId` — the inserted row came back owned by the creating tenant,
  and the four request bodies that spoof `tenant_id` in
  `test/tenant-closeout-isolation.test.js` are ignored. `activate/:id` now
  matches `id=$1 AND ((is_system=TRUE AND tenant_id IS NULL) OR tenant_id=$2)`:
  the cross-tenant lookup returns zero rows (404, and the response body does not
  name the foreign playbook), the owner still resolves, and the shared catalog is
  still activatable by any tenant. Two tenants can now generate for the same
  industry without colliding, because custom rows use the
  `(tenant_id, title)` index instead of the catalog's `(vertical)` slot.
- **`seedPlaybooks` is unchanged in policy and tighter in practice.** It still
  writes `tenant_id` NULL with `is_system=TRUE`, and the conflict target is now
  the inferred partial index — `ON CONFLICT (vertical) WHERE tenant_id IS NULL`.
  Confirmed valid and idempotent: two passes leave exactly one catalog row.
  `/list` and `/:vertical` additionally require `tenant_id IS NULL`, so a row
  with a stray `is_system=TRUE` cannot reach the shared catalog.
- **Child stamps and parent predicates are complete.** `compliance_checklist_items`
  and `post_launch_checks` INSERTs name `tenant_id`; the item/check SELECTs,
  UPDATEs and both `LEFT JOIN`s carry it; the parent `overall_result`,
  `ai_feedback` and `brand_score` UPDATEs are `id AND tenant_id`; and
  `_updateAuditStatus` now takes `tid` explicitly rather than inheriting scope
  from its caller, with both call sites passing it.
- **Backlink upsert is per-tenant.** `ON CONFLICT (tenant_id, domain)` lets two
  tenants hold the same domain: after both upserted `probe.example`, each row
  kept its own `alert_email`, and the first tenant's `alert_slack_webhook`
  secret was neither overwritten nor returned to the second. Child
  DELETE/UPDATE/SELECT now carry `monitor.tenant_id` (the trusted DB column),
  `_runMonitor` refuses a monitor with no `tenant_id`, and all five routes gained
  the missing `if (!tid) return 400 no_tenant` guard.
- **`brand_foundation` reaches `NOT NULL` on a fresh install** — `is_nullable=NO`
  with zero rows, where it was previously `YES` with one unowned row. The
  fail-closed helper is untouched and still never maps an orphan to tenant 1.
  `test/tenant-schema-audit.test.js` is 4/4 green on a booted database (it was
  failing check 2 on `brand_foundation`), and `tenant-schema-closeout` is 10/10,
  including a new assertion that `brand_foundation` was *not* added to
  `NULLABLE_OK` to silence the audit.
- **No permission work was required.** No new `/api` prefix was added, so no
  `ROUTE_GROUPS` entry is owed, and no enforcement flag, matrix row, or
  `context.js` behaviour changed. `allowFallback` still has no production caller.
- **`test/tenant-closeout-write-audit.test.js` is green, and green for the right
  reason.** Backend added a seven-line skip for `//`-commented matches, because
  the retired seed is still quoted in a `brand_foundation/schema.js` comment.
  Re-running this guard's pre-Backend version against the current tree returns
  exactly one offender — that comment — and no others, so the skip suppresses a
  single false positive rather than masking a finding. The three substantive
  assertions and both meta-guards are unmodified.

### Accepted residuals (tenant-schema closeout)

- **The fail-closed guarantee covers the closeout set, not the whole install.**
  `enforceTenantIdNotNull` is used by the child/closeout tables. The ~120 tables
  in `PLAIN_TABLES` still run `addTenantIdColumn`, which backfills NULLs to the
  default tenant on **every** boot. That was the deliberate Phase-1 decision for
  pre-multi-tenancy data (all of it was owner-gated), and it is not being
  reversed here. The consequence to keep in mind: a row that acquires a NULL
  `tenant_id` *after* Phase 2 — through a bug or a restore — is silently adopted
  by the first owner's tenant on the next boot rather than reported. Boot logs
  `rows backfilled`; a non-zero count on a mature install deserves
  investigation. `geo_audit_runs` is on this path by design (it is in
  `PLAIN_TABLES`) even though its child is fail-closed, so the parent can be
  default-assigned while the child inherits that assignment.
- **A blocked flip leaves a nullable column, and nothing alerts on it.**
  `runPhase2Migration`'s phase-2E integrity check and the orphan message are
  `console.warn` / `console.error` only; a table stuck with `reason:'orphans'`
  degrades quietly and is caught by `test/tenant-schema-audit.test.js` in CI, not
  in production. `b30bd63` improved this for one table — `brand_foundation` now
  logs an explicit operator instruction on the orphan path — but the general
  pattern is unchanged.
- **An install that already ran the retired `brand_foundation` seed still holds
  the orphan.** `b30bd63` stops the row being *created*; it does not remediate a
  row that exists. Such an install keeps failing closed (the singleton stays,
  `NOT NULL` is not applied, nothing is mapped to tenant 1) and keeps failing
  audit check 2 until an operator stamps a real `tenant_id` or deletes the row.
  That is the intended trade and is derived from the code path plus the
  `brand_foundation old-shape id=1 orphan` test — the dev database carried no such
  row, so it was not observed live here.
- **Pre-fix custom playbooks are stranded, and one pre-fix leak is not
  retroactively closed.** A custom playbook created before `ff81896` has
  `tenant_id IS NULL` with `is_system=FALSE`. Under the new `activate/:id`
  predicate it now matches for nobody — confirmed zero rows for both its original
  owner and a second tenant — which is fail-closed but orphans that content. Two
  consequences need a data decision rather than a code change: such a row still
  occupies the catalog's `(vertical) WHERE tenant_id IS NULL` slot, so
  `seedPlaybooks` can never seed that vertical. **The disclosure half is now
  closed** by `440bdbd`: `/active/list` joins on
  `(vp.is_system AND vp.tenant_id IS NULL) OR vp.tenant_id = $tid`, so a stale
  pre-fix pairing returns no row. Verified against a seeded pre-fix state — a
  tenant holding three mappings (a foreign custom playbook, a legacy unowned one,
  and a legitimate catalog entry) sees only the catalog entry, and the foreign
  content does not appear anywhere in the response. The mapping rows are
  deliberately kept rather than swept, which is the right call: hiding the content
  needs no destructive migration. What remains is housekeeping, not a leak —
  unowned `is_system=FALSE` rows still squat a catalog vertical slot, and the
  stale `active_playbooks` rows are inert.
- **`benchmark_aggregates` published single-workspace buckets. CLOSED** by
  `bd7625e` + `7dd418c`. The finding: the p25/median/p75 for a
  `(vertical, region, company_size, metric_key)` bucket with one contributor *is*
  that workspace's exact submitted value, re-served to every other workspace
  through `POST /compare`, `GET /leaderboard` and `strategic_intelligence`'s
  benchmark read. The global classification was always right; the aggregation
  needed a k-anonymity floor.

  The first attempt (`440bdbd`) added `K = 5` and wired it into every read path
  plus the rebuild, but gated on `sample_count`, which `_rebuildAggregates`
  computed as `COUNT(*)` over `benchmark_submissions`. Since `POST /submit` is a
  plain `INSERT` and the table has no unique key on
  `(tenant_id, vertical, region, company_size, metric_key)`, that counter counts
  **rows**, so one workspace reached the floor alone: five submissions of the same
  metric published `p25 = median = p75 = 12.3400`, its own private cost-per-lead,
  readable by an unrelated workspace as a five-sample network benchmark. Four rows
  from one workspace plus **one** submission from anybody else had the same
  effect. Recording that here because it is the instructive part: the wiring was
  complete and every read path was covered — the counter was the wrong measure,
  and no value of `K` fixes a `COUNT(*)`.

  The floor now counts workspaces. `benchmark_aggregates` gained a
  `contributor_count INT NOT NULL DEFAULT 0` column (still no `tenant_id` — the
  table stays GLOBAL), `_rebuildAggregates` computes it as
  `COUNT(DISTINCT tenant_id)`, percentiles are taken over one value per workspace
  (`DISTINCT ON (tenant_id, metric_key)` ordered by `submitted_at DESC`), and all
  three read paths plus the publish/delete decision gate on `contributor_count`.
  `sample_count` is left as raw rows. Verified across six cases: one workspace with
  five rows is suppressed and unreadable from both `/compare` and `/leaderboard`;
  two workspaces with five rows between them stay suppressed, so the
  one-submission unmasking is gone; five distinct workspaces publish correctly
  (median 30 of 10/20/30/40/50); a workspace adding forty rows to a legitimate
  bucket moves the median by one position and no further, with
  `contributor_count` still 5 against `sample_count` 45, confirming one workspace
  contributes exactly one value; and a bucket that falls back under the floor is
  deleted on the next rebuild.

  Two things about this that are correct but worth knowing. The `DEFAULT 0`
  fail-closes the upgrade: every bucket published before the migration is
  suppressed until a fresh submission rebuilds it, verified with a pre-upgrade row
  carrying `sample_count = 9`. Nothing guesses a contributor count for historical
  data, which is the right trade — the network simply goes quiet per bucket until
  it re-earns publication. And `GET /leaderboard` resolves no tenant at all; it is
  matrix-gated on `compete.intel.view`, which is the intended control.

  `test/benchmark-contributor-anonymity.test.js` locks all three properties and is
  now green: a static check that refuses a floor applied to a bare row count, plus
  runtime checks for the single-workspace publication and the one-submission
  unmasking. It is not in the `test:core` file list.

  Residual, accepted: `K` counts distinct `tenant_id`, so anyone able to stand up
  five workspaces can still surround a single real contributor and recover its
  value from the order statistics. That is the standard limit of k-anonymity
  without contributor vetting, it costs five workspace registrations, and it is
  auditable from `benchmark_submissions.tenant_id`. Not worth further code here;
  worth remembering before this data is ever marketed as anonymised.

  Minor, for Backend and not a disclosure: `/compare` and `/leaderboard` return
  `sample_count` but not `contributor_count`, so a client sees `sample_count: 45`
  for a percentile computed over five values. Under the honesty rules the number
  presented next to a statistic should describe that statistic — return
  `contributor_count` (as `strategic_intelligence` does, where it also drives the
  `network` vs `sector_estimate` tag) or relabel it.
- **`resolveTenantId` still honours `opts.allowFallback`.** No production caller
  passes it — verified across the tree — but the escape hatch remains in
  `services/tenants/context.js`, and a future handler could reinstate
  default-tenant fallback under enforcement `on` with one word. Left in place
  rather than removed mid-review, since removing it is a behaviour change with no
  live caller to justify it here; the property is now locked by test instead.
- **Static write/read audits do not see the closeout tables.** Both
  `test/tenant-write-audit.test.js` and `test/tenant-read-audit.test.js` derive
  their scoped-table set from `PLAIN_TABLES + REWRITE_UNIQUE`, and the
  child/closeout tables are in neither list. That blind spot is why the two
  missing-`tenant_id` INSERTs above shipped unnoticed.
  `test/tenant-closeout-write-audit.test.js` closes it by deriving the audited
  set from the `enforceTenantIdNotNull` call sites in `services/**/schema.js`, so
  a new fail-closed table is audited with no extra wiring. Neither existing audit
  was modified or weakened.
- **The read audit is deliberately lenient within a tenant-aware function.** Once
  a handler mentions the tenant anywhere, all of its statements are trusted, so
  the individual missing predicates listed above are invisible to it by design.
  That is why they are enumerated here rather than left to the scanner.

Three items found during the re-review that are **not** isolation defects,
recorded so they are not mistaken for tenancy bugs later:

- `generate-custom` has no `ON CONFLICT` on the `(tenant_id, title)` partial
  unique index, and the template fallback title is deterministic
  (`<industry> Growth Playbook (AI-Generated)`). A tenant generating twice for the
  same industry while the AI provider is down therefore hits `23505` and a 500.
  Reproduced. Same-tenant functional bug for Backend; correctly *not* fixed by
  loosening the index, which is what keeps custom titles per-workspace.
- `test/tenant-closeout-isolation.test.js` creates the tenant schema but not the
  auth schema `tenants` depends on, so on a database that has never booted the app
  all five tests fail in setup with `relation "users" does not exist`. Against a
  booted database they pass 5/5. Fixture bootstrap gap, no product impact — the
  same class as the fixture assertion `b30bd63` corrected in
  `tenant-schema-closeout`.
- **The two DB-backed schema suites race each other, and the loser looks like a
  tenancy regression.** `tenant-schema-closeout` drops
  `backlink_changes` / `backlink_snapshots` / `backlink_monitors` to build its
  old-shape fixture. `node --test` runs test files in parallel processes against
  one `DATABASE_URL`, so `tenant-schema-audit` can introspect mid-fixture: run
  the two files separately and they are 4/4 and 10/10, run them in one invocation
  and audit checks 3 and 4 fail reporting those two tables "absent from the
  database". Nothing was wrong with the schema — but a red tenant-schema-audit is
  the signal this review relies on, so it must not be reachable by a fixture race.
  **Closed** by `80d7c52`, and closed the right way: both suites take a shared
  Postgres session advisory lock, the destructive suite restores the canonical
  schema in `t.after`, and no assertion, allowlist or table set was touched — in
  particular the tables were not allowlisted to make the audit quiet. Verified by
  re-running the exact invocation that used to fail: 14/14 in one parallel
  `node --test`, stable across three consecutive runs, and faster than the
  serialised workaround.

## Deployment-safety re-review of the closeout preflight (`3d50e43`, `3dfaf96`)

Security pass over the read-only preflight, the fail-before-DDL abort, and the
two global-table CHECK constraints. Nothing in `services/security/`,
`services/auth*/`, `services/credentials/`, `middleware.ts`,
`permission_enforce.js`, `permissions.js`, `permission_matrix.js` or
`context.js` moved on this branch, and no audit assertion was relaxed — the
`tenant-schema-closeout` edits in `3d50e43` only tighten existing expectations
(`backfilled`, `indexed`, `notNullSet` now asserted false on abort, the index
asserted absent, the singleton CHECK asserted kept). `PERMISSION_ENFORCEMENT`
and `MULTITENANT_ENFORCEMENT` are untouched.

Confirmed against live Postgres, and locked by
`test/tenant-preflight-isolation.test.js`:

- **The preflight cannot write, by privilege and not just by intent.** It runs to
  completion under a role granted `CONNECT`, `USAGE` and `SELECT` and nothing
  else — exit 1 with the findings on a dirty database, exit 0 once clean, no
  `permission denied` and no `read-only transaction` error anywhere in the run.
  That is a stronger statement than the existing SQL spy, which can only observe
  the statements the current code happens to emit.
- **The operator report is identifiers only.** Seeded a job payload holding an
  email and an `sk-live-` token, a legacy custom playbook whose `description` and
  `content` carry a contact address and a private strategy blurb, and a legacy
  `brand_foundation` singleton with prose in `purpose_why`. All three are
  enumerated; none of that text reaches the report, which contains no string
  matching an email address at all. Every fixture row is still present and
  unmodified afterwards — the payload is not stripped, the playbook is not
  assigned a tenant, and the singleton is not mapped to tenant 1.
- **`enforceTenantIdNotNull` aborts before any DDL.** On an unmapped table it
  returns `{ reason:'preflight' }` with `added`, `indexed`, `droppedCheck`,
  `uniqueAdded`, `notNullSet` and `fkAdded` all false, the `tenant_id` column
  still absent, and the legacy `brand_foundation_singleton` CHECK intact.
- **The in-transaction guard behind it also holds.** A NULL `tenant_id` arriving
  *after* a clean preflight — modelled with a statement trigger that inserts
  inside the migration transaction, which is what a concurrent write would look
  like — returns `{ reason:'orphans' }` and rolls the whole transaction back:
  no index survives, `tenant_id` stays nullable, and the parent backfill UPDATE
  is undone rather than left committed against a half-migrated table.
- **`job_queue_global_empty_payload` blocks the caller, not just raw SQL.**
  `services/jobs/queue.enqueue` with a tenant payload fails `23514` on that
  constraint and stores nothing; the only live enqueue site,
  `services/jobs/scheduler.js`, passes `{}` and still succeeds. The CHECK is
  re-evaluated on every UPDATE, so the worker path was checked end to end —
  `claimJobs` → `completeJob` → `failJob` → `queueStats` all still run with the
  constraint in place.
- **`vertical_playbooks_system_xor_tenant` is a true xor.** Catalog
  (`is_system` true, `tenant_id` NULL) and custom (`is_system` false, `tenant_id`
  set) insert; both inverses are refused. `is_system` is nullable and the
  expression is written with `IS TRUE` / `IS FALSE`, so a NULL flag evaluates
  false and is rejected rather than passing as unknown — the fail-closed
  direction. Legacy violators are reported (`playbook_custom_unmapped`,
  `playbook_system_with_tenant`, `playbook_is_system_null`) and left alone; the
  ADD CONSTRAINT skips instead of repairing them.
- **Identifiers are validated, not interpolated.** `_safeIdent` rejects a table
  name and a `backfillFrom.parentTable` carrying `"; DROP TABLE tenants; --`
  before either reaches SQL.

### Closed — the shared-database race is back, as a deadlock

`80d7c52` closed the two-suite fixture race by putting `tenant-schema-closeout`,
`tenant-schema-audit` and later `tenant-schema-preflight` on one Postgres session
advisory lock. `test/tenant-schema-preflight.test.js` takes that lock but then
does part of its cleanup outside it, so the property `80d7c52` established is
only partly true again.

`node:test` runs `after` hooks in registration order. The
`parent-mappable child` test calls `guardMutatingTest(t)` first, which registers
the hook that restores the fixtures and *releases the advisory lock*; it then
registers a second `t.after` that drops the two probe tables and runs
`DELETE FROM tenants WHERE id=$1`. That second hook therefore executes with the
lock already released. `tenants` is the cascade parent for the tenant-scoped
tables, so the DELETE takes `RowExclusiveLock` on `brand_foundation`, while
`tenant-schema-closeout` — holding the advisory lock — is issuing
`DROP TABLE IF EXISTS brand_foundation CASCADE` and waiting for
`AccessExclusiveLock`. Postgres reports the cycle verbatim:

```
ERROR:  deadlock detected
DETAIL: Process A waits for AccessExclusiveLock on brand_foundation; blocked by process B.
        Process B waits for RowExclusiveLock on brand_foundation; blocked by process A.
        Process A: DROP TABLE IF EXISTS brand_foundation CASCADE
        Process B: DELETE FROM tenants WHERE id=$1
```

`brand_foundation fresh empty table tenant_id is NOT NULL` is the victim and
fails `40P01`. Measured on the branch: 3 failures in 12 runs of the parallel
invocation that includes `tenant-schema-preflight`, and 0 in 6 runs of the same
invocation with only that file removed — so the suite is the trigger, not
pre-existing flakiness. Nothing is wrong with the schema, and the deadlock is
strictly worse than the `80d7c52` race it reopens: an intermittent red that
clears on retry teaches the operator to re-run until green, and that habit will
swallow a genuine red just as readily.

The recommendation to Database was: register the fixture cleanup inside
`guardMutatingTest` (or acquire the lock again in the second hook) so nothing
mutating runs after the release, and do not paper over it by widening
allowlists, dropping the `DELETE FROM tenants` assertion, or serialising the
whole suite. `test/tenant-preflight-isolation.test.js` already sidesteps the
shared database by provisioning its own; that was named as the other half of the
answer, not a substitute for the hook order.

**Closed by `e2c15fa` (hook order) and `467cbf9` (scratch isolation, rethrow,
regression).** Both halves shipped:

- `e2c15fa` collapses the cleanup into the single `t.after` that
  `guardMutatingTest` registers: restore runs while the advisory lock is still
  held, the unlock happens last, and per-test extras go through
  `addLockedCleanup` instead of a second hook. Nothing mutating executes after
  the release.
- `029e4c0` / `467cbf9` move the destructive DDL off the shared database.
  `tenant-schema-closeout` and `tenant-schema-preflight` reassign
  `process.env.DATABASE_URL` to a per-file scratch database **before**
  `require('../db')` — `db.js` reads the variable lazily in `getPool()`, so
  every `DROP TABLE IF EXISTS brand_foundation CASCADE`, every `ensure*Schema()`
  and the `spawnSync` of `scripts/tenant-schema-preflight.js` land on the
  scratch database. `DELETE FROM tenants` in a parallel worker can no longer
  take `RowExclusiveLock` on the same relation a closer holds
  `AccessExclusiveLock` on, because they are not the same relation.
- The swallowing that hid the cycle is gone. `restorePreflightFixtures` rethrows
  when `isDeadlockError(err)`, and the tenant `DELETE` teardowns in
  `tenant-closeout-isolation`, `benchmark-k-anonymity` and
  `benchmark-contributor-anonymity` use `.catch(rethrowDeadlock)` instead of
  `.catch(() => {})`. A future deadlock fails a test rather than printing a
  warning under a green run.
- `467cbf9` also drops `require('./helpers')` from those three files. That
  module loads `server.js`, whose register-time `ensure*Schema()` calls raced
  each other on `pg_class_relname_nsp_index` (`23505`) on the live database.
  Only `advertising-orchestrator-credits`, `advertising-orchestrator-workflows`
  and `diag-capture-restore` still load it.
- `test/tenant-closeout-drop-isolation.test.js` pins the contract in source
  (scratch swap ordered before `require('../db')`, restore-before-unlock, no
  `.catch(() => {})` on `DELETE FROM tenants`, no `require('./helpers')`) and
  runs 40 iterations of concurrent DROP-on-scratch against DELETE-tenants-on-live.

Verified independently, not taken on report:

- The mechanism is real and the new assertion is not vacuous. A direct probe
  looping `DROP TABLE brand_foundation CASCADE` against
  `INSERT`/`DELETE FROM tenants` produced 4 `40P01` in 80 iterations when both
  ran on **one** database (the pre-`467cbf9` shape) and **0** when the DROP was
  moved to a second database (the shipped shape).
- 7 consecutive default-parallel `node --test` runs of the 10-file schema/tenant
  set: 51/51 pass, 0 fail, 0 skipped, 0 real `40P01`, 0 `23505`. A wider
  25-file parallel slice (`tenant-*`, `meeting-notes-*`, `benchmark-*`,
  `*-tenant-isolation`) ran 158/158 three times with the same zero counts.
  `meeting-notes-tenant-isolation`, the extra probe file from the previous
  review, is clean.
- Test count went up, not down: the same nine files at `e2c15fa` report 47
  passing; HEAD reports 51 across ten files, and the four new ones are
  `tenant-closeout-drop-isolation`. No assertion, allowlist or table set was
  removed, `npm run test:core` is 70/70, and
  `security-guardrails` + `permission-matrix` + `permission-matrix-coverage` are
  31/31. The delta `e2c15fa..467cbf9` touches only `test/` and this document —
  no `services/`, no `server.js`, no `db.js`.
- The isolation cannot silently degrade back to the live database. When the role
  cannot `CREATE DATABASE`, `tenant-schema-closeout` fails 10/10 in the `before`
  hook rather than skipping or falling back — checked against a `NOCREATEDB`
  role.
- `tenant-schema-audit` still introspects the **live** `DATABASE_URL` with no
  swap, and it still fails loudly rather than passing quietly on a database that
  has no schema: run against an empty database it reports 2/4 failing with
  "absent from the database".

Residual risks, stated plainly:

- **Other suites still `DELETE FROM tenants` on the live database.** That is now
  safe not because the DELETEs changed but because nothing on that database
  `DROP`s the relation they cascade into. If a future test reintroduces
  destructive DDL against a shared app table on the live `DATABASE_URL`, the
  cycle comes back. `tenant-closeout-drop-isolation` guards the two known
  offenders by source; it cannot guard a file that does not exist yet.
- **`CREATE DATABASE` in tests assumes a local-dev or disposable Postgres.**
  `test/helpers/scratch_db.js` connects to the `postgres` maintenance database
  on the same server and issues `CREATE DATABASE` /
  `DROP DATABASE IF EXISTS … WITH (FORCE)` against a generated
  `infogenie_<prefix>_<pid>_<hex>` name, validated against `^[a-z][a-z0-9_]*$`
  at both call sites. Pointing `DATABASE_URL` at a shared or managed instance
  would create and drop databases there. The failure mode is the safe one — a
  role without `CREATEDB` fails the suite instead of dropping live tables — but
  the helper is test-only by convention, not by a runtime guard. It is not
  imported anywhere under `services/` or from `server.js`, and neither
  `services/`, `server.js`, `db.js` nor `scripts/` contains any
  `DROP TABLE` / `DROP DATABASE` / `TRUNCATE`: this whole class of hazard is
  test-isolation only and has never been a production code path.
- **Scratch-database cleanup is best-effort.** The `after` hooks swallow
  `dropScratchDatabase` failures, so a hard-killed run can leave an
  `infogenie_*` database behind. Nothing leaked across 10 parallel runs here,
  but a QA host may need an occasional sweep.
- **The closeout and preflight suites no longer exercise the live schema.**
  Running on an empty scratch database makes their fixtures fully controlled,
  which is what those suites are for (fail-before-DDL behaviour), but it means
  the live schema is now verified solely by `tenant-schema-audit`,
  `tenant-read-audit`, `tenant-write-audit` and `tenant-closeout-write-audit`.
  Those suites still require a database the app has booted against; that
  precondition was already documented in the audit file's header and is now the
  only thing standing behind it.
- **`ensure*Schema()` concurrency on the live database is untouched by this
  change.** Several suites still call `ensureTenantSchema()` in parallel
  workers, and `CREATE INDEX IF NOT EXISTS` is not race-safe in Postgres, so a
  `23505` on `pg_class_relname_nsp_index` remains theoretically reachable
  between two of them. It did not fire in 10 parallel runs, it is pre-existing
  rather than introduced here, and it fails loudly if it ever does.

### Accepted residuals

- **Nothing automatically blocks a deploy.** When violators already exist,
  `ensureJobQueueEmptyPayloadCheck` / `ensureVerticalPlaybooksXorCheck` log and
  skip, and boot continues with the table unconstrained — which is the correct
  boot-safe choice, but it means `npm run tenant:preflight` (exit 1 dirty, exit 2
  with no `DATABASE_URL`, exit 0 clean) is the only gate, and it is an operator
  command rather than a step anything enforces. Wire it into the release
  checklist; a green boot log is not evidence the CHECKs are on.
- **The truncated count over-reports.** Past `ID_CAP` (500) unmapped rows,
  `preflightUnmappedForTable` falls back to `COUNT(*) WHERE tenant_id IS NULL`,
  which drops the parent-JOIN filter and so includes rows that *are* mappable.
  The abort decision is unaffected (it is already aborting) and the direction is
  conservative, but the number an operator sees can be much larger than the
  number of rows they actually have to decide about.
- **`vertical` is echoed and is user-supplied.** For a custom playbook it is the
  raw `industry` string from `POST /generate-custom`. It is the only useful
  disambiguator besides the id, and the report is an operator-console artefact
  rather than a log sink, so it stays — but it is workspace-authored text, and
  `title`, `description` and `content` were correctly kept out for the same
  reason.

## Closeout honesty fixes — FK savepoint, unique drop order, truncation (`6de0bcf`)

Security re-review of Database's answer to the Reviewer rejection. The diff
against `9263261` touches `services/tenants/migration.js`,
`services/backlink_monitor/schema.js`, `services/tenants/preflight.js` and two
test files only. Nothing in `services/security/`, `services/auth*/`,
`services/credentials/`, `middleware.ts`, `permission_enforce.js`,
`permissions.js`, `permission_matrix.js` or `context.js` moved,
`PERMISSION_ENFORCEMENT` and `MULTITENANT_ENFORCEMENT` are untouched, and the
diff contains no new `skip`, no relaxed audit assertion and no `allowFallback`.
The scratch-database isolation closed above still holds: `tenant-schema-closeout`
and `tenant-schema-preflight` still reassign `DATABASE_URL` before
`require('../db')`, and the three tenant-schema suites run 26/26 concurrently
with no `40P01`.

- **The FK savepoint cannot report a rollback as a commit.** `SAVEPOINT
  closeout_fk` wraps the `ADD CONSTRAINT … FOREIGN KEY` statement and nothing
  else, so `ROLLBACK TO SAVEPOINT` restores to the point immediately *after*
  `SET NOT NULL`, and the outer `COMMIT` is a real commit rather than the
  implicit rollback an aborted transaction used to turn it into. Verified with a
  name-clash fixture that occupies `<table>_tenant_id_fkey` with a CHECK (so
  `_tenantFkExists` stays false and the FK ADD must fail): the call returns
  `ok:true, fkAdded:false, fkError:<message>`, and `tenant_id` is `is_nullable:NO`,
  `UNIQUE(tenant_id)` is present and `<table>_tenant_idx` exists on the table
  afterwards. Every field the result claims is now backed by committed state.
  Should the `ROLLBACK TO SAVEPOINT` itself throw, the outer `catch` issues a
  full `ROLLBACK` and returns `ok:false` — there is no path from a broken
  savepoint to `ok:true`.
- **`ok:true` with `fkError` is accepted as the fail-closed policy, not
  weakened.** The FK is defence in depth for referential cleanup on tenant
  delete; isolation itself rests on `tenant_id NOT NULL`, `resolveTenantId` and
  the `WHERE tenant_id = $1` predicates, all of which do commit on this path.
  Requiring `ok:false` on an FK failure would, for `backlink_monitors`, pin the
  legacy global `UNIQUE(domain)` in place forever over a constraint-name clash —
  strictly worse operationally with no isolation gain. `enforceTenantIdNotNull`
  still never calls `_getDefaultTenantId`; the FK path adds no orphan→tenant-1
  route, and the probe row keeps its seeded tenant.
- **`backlink_monitors` can no longer end with neither unique.** The legacy
  `UNIQUE(domain)` is now dropped only when `monitorsCloseout.ok`. Two abort
  shapes were exercised against live Postgres. A preflight abort (one row with
  `tenant_id IS NULL` under the old shape) leaves `UNIQUE(domain)` in place, does
  not add the composite, does not flip `NOT NULL`, and leaves the orphan
  unmapped. A composite-`UNIQUE` failure is not silently survivable either:
  `ADD CONSTRAINT` aborts the transaction, the following `COUNT(*)` fails
  `25P02`, and the helper returns `ok:false, reason:'error'` with `uniqueError`
  recorded — so the drop is skipped there too. The clean path still drops the
  legacy unique and keeps `UNIQUE(tenant_id, domain)`, and the existing
  two-tenant same-domain test still passes.
- **The truncation flag exposes no additional data.** `_finding` still caps ids
  at `ID_CAP` (500) via `_capIds`, and the callers still `LIMIT ID_CAP + 1` and
  slice; the change adds the boolean `truncated` only. `ACTION REQUIRED` is
  driven by `findings.length`, which the flag does not touch, and `(truncated)`
  is appended inside that branch — it cannot suppress the banner. The job-queue
  finding still carries `id`, `name` and `status` and no payload.

### Accepted residuals (`6de0bcf`)

- **`phase2_migrate._runRewrite` still drops before it adds.** For
  `backlink_monitors` it calls `_safeDropConstraint(…, 'backlink_monitors_domain_key')`
  *between* the base closeout and the composite-`UNIQUE` call, which is the
  inverse of the order `schema.js` now uses. It is unchanged by this diff and is
  hard to reach: it early-returns before the drop when the base closeout aborts,
  and while `UNIQUE(domain)` holds a duplicate `(tenant_id, domain)` is
  arithmetically impossible, so only an infrastructural DDL failure between the
  two calls could leave neither unique. It self-heals on the next boot, and the
  degraded window fails closed at the API — `POST /domains` upserts
  `ON CONFLICT (tenant_id, domain)` and errors rather than writing across
  tenants. Worth aligning with the `schema.js` order in a later Database slice.
- **The abort state is a weak cross-tenant existence oracle.** While the legacy
  `UNIQUE(domain)` is retained, one tenant creating a monitor for a domain
  another tenant already watches gets a unique-violation `500` instead of a row.
  That leaks the fact that *somebody* watches the domain, not who; it is the
  pre-migration behaviour of this table, it only occurs in the aborted state an
  operator is being asked to resolve, and the alternative (dropping the unique
  anyway) is what the fix exists to prevent.
- **`_listPlaybookXorViolations` still drops its truncated flag.** It slices to
  `ID_CAP` and computes `truncated` locally, but returns rows only, so a
  `vertical_playbooks` finding past 500 violations reports `count: 500` with no
  marker — the same under-report class that was just fixed for
  `unmapped_tenant_id` and `job_queue_payload`. `ACTION REQUIRED` still fires, so
  no decision changes, but the number an operator reads is wrong.
- **The `reason:'error'` result still echoes pre-rollback progress.** The outer
  `catch` returns the accumulated `result`, so a rolled-back transaction can
  report `indexed:true` beside `ok:false`, unlike the `orphans` branch which
  zeroes those fields explicitly. `ok:false` is the operative signal and no
  caller reads the sub-flags on failure; it is pre-existing and cosmetic.

## CodeQL missing-rate-limiting on `/api/playbooks` — remediated

**Status: remediated.** `/api/playbooks` now carries a fail-closed per-tenant
rate limit. This section previously classified the alert as an accepted residual
and recorded that no limiter had been added; that is no longer the shipped state
and the classification below is kept only as the history of why the fix took the
shape it did.

CodeQL run 96768259245 reported high-severity `js/missing-rate-limiting` against
the handlers in `services/vertical_playbooks/api.js`. The alert list itself was
not readable from this environment (the code-scanning API answers `403 Resource
not accessible by integration`), so the underlying claim was checked against the
code and a running server rather than taken from the report.

### What is enforced now

- **Limiter:** `createRateLimiter` from `services/security/rate_limit.js` — the
  same primitive `authAbuseLimiter()` uses, now implemented on top of
  `express-rate-limit` (see the CodeQL subsection). **Not** `server.js`'s
  `_RL_PATHS` (IP + path, POST-only, no authenticated-caller exemption) and
  **not** the orchestrator's `services/agent_orchestrator/limits.js`.
- **Key:** `playbooks|<tenant_id>` for the whole prefix, plus
  `playbooks-generate|<tenant_id>` on `POST /generate-custom`. The tenant id
  comes **only** from `req.tenant.id`, which `services/tenants/middleware.js`
  sets from a verified membership (or `server.js` injects from
  `getCronTenantId()` for `INFOGENIE_API_KEY` callers). It is never read from the
  body, query string, headers or route params, and never from
  `resolveTenantId()`, which can fall back to the default tenant when
  `MULTITENANT_ENFORCEMENT` is off. The id must be a **positive safe integer**;
  unsafe integers are rejected rather than coerced, so two distinct ids past
  2<sup>53</sup> cannot round to one float and share a bucket.
- **Defaults:** **60 requests / 60 s** shared across the whole prefix, so
  spraying paths cannot multiply a tenant's quota, and an additional **5 requests
  / 60 s** on `POST /generate-custom`. `PLAYBOOKS_RATE_LIMIT_MAX` and
  `PLAYBOOKS_GENERATE_RATE_LIMIT_MAX` override those maxima **only when
  `NODE_ENV === 'test'`**; in production the defaults are not tunable by
  environment.
- **Fail-closed on missing tenant:** `playbooksTenantGuard` runs before every
  handler and answers `400 {ok:false, error:'no_tenant'}` when `req.tenant` is
  absent or its id is `0`, negative, non-integer, `NaN`, unsafe or unparseable.
  There is no fallback to a default tenant, to the client IP, or to an `unknown`
  bucket. Both limiters additionally carry `failClosed: true`, so a key that
  cannot identify the caller is denied instead of collapsing every caller into
  one shared bucket.
- **Ordered before the expensive work:** the guard and the shared limiter are
  router-level `use()` calls registered ahead of every route, so they run before
  the `seedPlaybooks` write loop on `GET /list` and `GET /:vertical`. The
  generate cap runs before the OpenAI call and before both `INSERT`s.
- **429 contract:** `{ ok:false, error:'rate_limited', retryAfterSec }` with a
  `Retry-After` header carrying the same value as bare integer seconds (not an
  HTTP date). `standardHeaders` and `legacyHeaders` are both **off**, so no
  response advertises the policy or the caller's remaining headroom — responses
  are byte-identical to the hand-rolled limiter this replaced.
- **Atomic admissions:** the store increments before the middleware compares
  against the limit, so concurrent requests receive distinct totals and cannot
  both observe spare capacity. Redis `INCR` is atomic; the process-local
  fallback bumps its counter with no `await` in between. The earlier hand-rolled
  limiter needed an explicit admission lock because it was check-then-act across
  the Redis `await`; that lock is gone, and a concurrent-burst test still
  asserts a burst of 12 against a max of 3 admits exactly 3.

`GET /list` and `GET /:vertical` serve the global system catalog and previously
needed no tenant, so they now answer `400 no_tenant` for an authenticated caller
with no resolvable tenant where they used to answer `200`. **This is the intended
fail-closed trade-off, not an auth bypass**: the `/api/*` gate still rejects
anonymous callers with `401` before any of this runs, and `enforceMatrix` still
requires `manage.playbook.use`. The practical exposure is an `INFOGENIE_API_KEY`
caller on a deployment with no default tenant — the case `server.js` already logs
as `[apikey] no default tenant resolvable`.

### The CodeQL check, and why the factory uses `express-rate-limit`

**`js/missing-rate-limiting` fires on a control it cannot see.** The query's
`RateLimitingMiddleware` class recognises a fixed list of packages —
`express-rate-limit`, `express-brute`, `express-limiter`,
`rate-limiter-flexible`, `fastify-rate-limit` — and nothing else. A correct
hand-rolled limiter is invisible to it. Two rounds on PR #83 confirmed this the
hard way: after the limiter shipped the check reported three alerts, and after
the limiter was additionally passed as an explicit argument on every route it
reported seven, while `Analyze (javascript-typescript)` passed both times.

Inline `// codeql[...]` comments do **not** clear default setup. They only
populate SARIF suppression entries for a `dismiss-alerts` workflow, which this
repository does not run.

So `createRateLimiter` is now **implemented with `express-rate-limit`** and
returns that instance directly, with no wrapper function, so CodeQL's type
tracking follows it from the factory through `const lim = createRateLimiter(...)`
into `router.get(path, lim, handler)`. This is **not a second policy** and not a
dummy limiter parked beside a real one:

- There is exactly one limiter per bucket. `express-rate-limit` supplies the
  window bookkeeping that `rate_limit.js` used to implement by hand; every
  policy decision — the keys, the maxima, the fail-closed behaviour, the 429
  body, the Redis store — is still ours.
- The store is `RedisOrMemoryStore` in `rate_limit.js`, which uses the existing
  `services/infra/redis.js` `redisIncr` under the same `rl:` key prefix and
  degrades to the package's `MemoryStore` when `REDIS_URL` is unset or Redis is
  unreachable. Behaviour is unchanged from the hand-rolled version.
- `authAbuseLimiter()` is unchanged: still 30 attempts / 15 minutes keyed on
  IP + path, still `Retry-After: 900`, still fail-open when Redis errors, and it
  opts into none of the playbooks-only settings.
- Responses gain nothing. `standardHeaders` and `legacyHeaders` are off, so no
  `RateLimit-*` or `X-RateLimit-*` header appears on any response.

Two supporting changes exist for the same reason:

- **`playbooksSharedLimiter` is passed explicitly on all five route
  registrations**, in addition to the binding `router.use()` mount, so the
  limiter is on each handler's own middleware chain where the query looks. It is
  the same instance and counts a request at most once (`alreadyCounted` drives
  the package's `skip`), so the 60/60 s ceiling is unchanged. The `router.use()`
  mount stays because it is the one that also covers unmatched paths under the
  prefix.
- **The guard helper is named `tenantIdFromServerContext`, not
  `…FromAuthContext`.** CodeQL scored the old name as an `AuthorizationCall` —
  expensive work deserving its own limit — which is what produced the two alerts
  on `playbooksTenantGuard`. The function only reads context another middleware
  already established; the authorization boundary is `enforceMatrix`.

The inline `// codeql[js/missing-rate-limiting]` dispositions above each handler
are kept as documentation for a reader, pinned to that one query id so they can
never silence an unrelated finding. They are no longer the mechanism: the
modeled middleware is.

`test/playbooks-rate-limit-security.test.js` asserts that all five registrations
keep the limiter argument and the disposition, so neither can be dropped in a
later refactor without a test failing.

**Operator note.** With the limiter now modeled, the check is expected to go
green and **UI dismissal is no longer the primary answer**. It remains available
if the query still disagrees — this environment cannot verify the outcome, since
the code-scanning API answers `403 Resource not accessible by integration` for
this token and no CodeQL CLI is installed, so the alert list cannot be read back
after a run. What must not happen is a *second* limiter, or `/api/playbooks`
being added to `_RL_PATHS`, being introduced to satisfy a scanner: see below for
why that would make the product worse.

### Why the fix did not go into `_RL_PATHS`

The routes were never the anonymous surface the query scores:

- `/api/playbooks` is absent from `_AUTH_PUBLIC_API_PATHS`, so the `/api/*` gate
  requires a session or `INFOGENIE_API_KEY`. Measured against a running server:
  120 anonymous `GET /list` and 60 anonymous `POST /generate-custom` requests all
  returned `401 auth_required`, so an unauthenticated flood reaches no database
  and no provider — the sink the query traces to is unreachable before the
  handler runs.
- All five paths resolve to `manage.playbook.use` for both view and write through
  the `/api/playbooks` `ROUTE_GROUPS` row, enforced by `enforceMatrix`
  (`PERMISSION_ENFORCEMENT=on` in production).
- Each tenant-scoped handler resolves `resolveTenantId(req, { label })` and
  refuses `400 no_tenant` without one.

`js/missing-rate-limiting` matches "handler performs an expensive operation" and
models neither the auth gate, the permission matrix nor tenant resolution, so it
scored these identically to a public POST. The alert was directionally right
about the cost surface and wrong about the exposure, which is why the remediation
is a per-tenant authenticated limiter rather than an IP bucket.

`_RL_PATHS` is "public POST surfaces (cheap; never blocks dashboard usage)".
Adding a dashboard prefix breaks both halves of that, measured rather than
assumed:

- `_rateLimitPublic` keys on IP + path only, with **no authenticated-caller
  exemption**: 25 POSTs to `/api/visitor-intel/ping` carrying a valid
  `X-InfoGenie-Key` returned 20×200 then 5×429. At 20 requests/60s per IP+path
  that 429s real operators, and a NAT'd office shares one bucket.
- The middleware returns early unless `req.method === 'POST'`, so it structurally
  cannot cover `GET /list`, `GET /:vertical` or `GET /active/list` — three of the
  flagged handlers, and the two that carry the `seedPlaybooks` write loop.

So the limiter is a **second policy class**, keyed on authenticated tenant rather
than IP, scoped to this prefix. It is not yet a platform-wide capacity program:
the other ~270 `ROUTE_GROUPS` prefixes are still unlimited, and their thresholds
should come from a capacity decision rather than from this hotfix. Adoption
checklist item 5 is unaffected — it asks for a limiter on new **public** POST
surfaces, and this branch adds none.

### Residuals after the fix

- **Per-tenant AI *spend* caps are still not implemented.** This hotfix caps
  *requests* (5 per tenant per minute on `POST /generate-custom`), which bounds
  the burst but not the cumulative bill: a tenant can still spend 5 `gpt-5`
  completions a minute indefinitely, and no other AI route is capped at all. The
  **per-tenant AI rate/cost limiting** follow-up named under the meeting-notes
  section still stands — the place to generalise the orchestrator's
  `requests_per_minute` and daily/monthly cost caps
  (`services/agent_orchestrator/limits.js`) from. That work is **not** in this
  change and is not the Advertising Orchestrator PR 3.
- **Without Redis the limit is process-local.** `rate_limit.js` prefers an atomic
  Redis `INCR` when `REDIS_URL` (or `UPSTASH_REDIS_URL`) is set and falls back to
  an in-process sliding window otherwise, so with *n* app instances and no Redis
  the effective ceiling is *n* × the configured max. `docs/capacity.md` already
  records Redis as **required for ≥ 2 app instances (rate limits + cache)**; this
  limiter does not change that requirement, it inherits it. No Postgres-backed
  limiter was added — a per-request write to `kv_store` would put a database
  round trip in front of every dashboard read.
- **A Redis outage degrades the limit rather than denying.** When `REDIS_URL` is
  set but `redisIncr` fails, `createRateLimiter` falls back to the process-local
  window, so a multi-instance deployment silently loses the shared counter for
  the duration. This fail-open is **deliberately left in place**: making it deny
  would take `/api/auth/login`, `signup` and `request-reset` down with Redis,
  since `authAbuseLimiter()` shares the primitive. `failClosed` in
  `createRateLimiter` covers only the *missing key* case and is opt-in, so the
  auth limiter's behaviour is byte-for-byte unchanged. Turning the Redis-error
  path into a denial is an explicit, separately-reviewed opt-in if it is ever
  wanted.
- **`seedPlaybooks` still runs on every `GET /list` and `GET /:vertical`.** Where
  a legacy unowned row squats a catalog vertical slot the `is_system` count never
  reaches `SYSTEM_PLAYBOOKS.length`, so each request re-attempts the six-row seed
  loop. That amplification is now bounded at 60 attempts per tenant per minute
  instead of unbounded, but the underlying catalog-poisoning item recorded above
  still needs its housekeeping data decision.
- **The scanner outcome is not verifiable from here.** Building the factory on
  `express-rate-limit` should make the query a true negative, but neither the
  alert list nor a local CodeQL run is available in this environment. If the
  check stays red, dismissing it in the code-scanning UI is an operator action —
  there is no `.github/workflows` CodeQL config to scope the query (scanning runs
  from GitHub default setup).
- **`express-rate-limit` is now a runtime dependency.** It is pinned at
  `^7.5.1`; v8 is ESM-only and `require()` from this CommonJS codebase is not
  verified against it, so a major bump needs checking rather than accepting.

Coverage: `test/playbooks-rate-limit.test.js` (HTTP: 429 contract, per-tenant
isolation, spoofed body/query/header, concurrent burst, API-key caller,
generate-custom ordering) and `test/playbooks-rate-limit-security.test.js`
(fail-closed key validation, source-level guard that the key never reads caller
input, shipped defaults, `serialize` atomicity under an unreachable Redis, and
`authAbuseLimiter` regression).

## Advertising orchestrator — research evidence contracts (PR 3A)

PR 3A adds four tenant-scoped evidence tables (`orchestrator_research_runs`,
`orchestrator_research_competitors`, `orchestrator_research_evidence`,
`orchestrator_research_evidence_assets`), three tenant-scoped operational tables
(`orchestrator_research_quota`, `orchestrator_research_legacy_holds`,
`orchestrator_research_cleanup_ops`), one cluster-wide singleton latch
(`orchestrator_research_legacy_short_due_snapshot`, no tenant data — see the
residuals), and the shared contract modules (`research_contracts.js`,
`research_errors.js`, `research_validate.js`, `research_connector.js`,
`research_retention.js`, `research_cleanup.js`, `research_store.js`) that PR3B/C/D
connectors and later persistence must use. There is **no HTTP route, no
`ROUTE_GROUPS` entry and no fetch sink** in PR 3A, so it adds no permission
surface and no SSRF surface; a test asserts all three absences, plus that the
three connector files do not exist yet. Retention sweeping and volume-limit
INSERTs are in-process helpers, not routes.

### Tenant isolation of the PR 3A schema

Reviewed `services/agent_orchestrator/schema.js` as landed. **No DDL change was
required.** (Isolation-wise. Later BLOCK remediation added the operational
tables, the `NOT VALID` CHECK path, the preflight and the cleanup triggers
described below; every one of them keeps the shape stated here.)

- All four tables carry `tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON
  DELETE CASCADE` and are keyed `PRIMARY KEY (tenant_id, id)`, so an id is only
  ever resolvable inside one tenant.
- Every parent reference is a **composite** FK on `(tenant_id, …)`: runs →
  `orchestrator_workflows (tenant_id, id)` and `orchestrator_approvals
  (tenant_id, id)`, competitors and evidence → runs, evidence → competitors,
  assets → evidence. A row cannot point at another tenant's workflow, approval,
  run, competitor or evidence item, and `supersedes_id` is bound by trigger to
  the same tenant *and* the same run.
- Every unique key leads with `tenant_id` — `(tenant_id, idempotency_key)`,
  `(tenant_id, research_run_id, platform, dedup_key)`, `(tenant_id,
  research_run_id, platform, provider_advertiser_id)`, `(tenant_id,
  research_run_id, dedup_key)`, `(tenant_id, evidence_id, storage_ref)` — so the
  same public advertiser id or ad id may exist for two tenants and neither can
  see or collide with the other's evidence. There are no bare natural-key
  uniques.
- The approval FK is `NO ACTION DEFERRABLE INITIALLY DEFERRED` rather than
  `CASCADE`, so deleting an approval cannot silently delete research history;
  only the tenant cascade removes these rows.
- Validators never read `req` and take no caller tenant. `tenantId` comes from
  authenticated context as an argument; a payload carrying a different
  `tenant_id` fails `validation_failed` rather than winning. That is asserted
  for runs, competitors, evidence, connector requests and connector pages.

### Approval binding

The `orchestrator_research_runs_approval_bind` trigger fires `BEFORE INSERT OR
UPDATE`: a run cannot be inserted without a `research_execution` approval whose
`decision` is `approved`, in the same tenant, on the same `workflow_id`, at the
same `object_version`, whose `approved_platforms` array is non-empty and
**contains every** requested platform. A missing, wrong-gate, rejected,
stale-version or narrower-platform approval raises. The identity-immutable
trigger then freezes `id`, `tenant_id`, `workflow_id`, `approval_id`,
`approval_object_version`, `contract_version`, `requested_platforms`,
`idempotency_key`, `research_brief`, `search_parameters` and `created_at`, so an
approved run cannot be re-pointed at a different workflow or widened to another
platform after the fact. Only state, continuation and error/timestamp columns
move.

### Provenance is append-only

Evidence, competitor and asset rows refuse `UPDATE` outright and refuse `DELETE`
while the parent run (or evidence) still exists — a correction is a new INSERT
carrying `supersedes_id`, never a rewrite. `content_fingerprint` must equal SHA-256
over the frozen canonical subset (`platform`, `source_type`,
`provider_external_id`, `canonical_source_url`, `headline`, `body_text`,
`excerpt`, `advertiser_name`, `creative_format`); a caller-supplied fingerprint that
disagrees is rejected, and the default `dedup_key` is that fingerprint. The
deprecated input alias `evidence_hash` is accepted and must match; validators
never emit it.

### PII, credential and raw-payload minimization

There is no raw-payload column: no `payload`, `raw_response`, `body`, `cookie`,
`email`, `phone` or `BYTEA` column exists on any of the four tables, and assets
store a locator plus checksum, never bytes. `provider_metrics`,
`search_parameters` and `continuation_state` are the only free-form JSONB, each
bounded by both a CHECK and a validator limit (8192 / 8192 / 4096 bytes) that
**fail closed** — oversize is rejected, never truncated, because clipping would
put half a secret in the row.

Hardened during this review, because each of these was accepted before it:

- **Forbidden keys are matched after normalization** (lowercase, separators
  removed), so `access-token`, `Access Token` and `accessToken` are the same
  rejected key. The list previously matched exact snake_case only, so those
  variants reached `provider_metrics` and `continuation_state` unchanged.
- **The reject list now covers the rest of the credential and identity
  vocabulary**: `api_key`, `x_api_key`, `client_secret`, `secret`, `token`,
  `id_token`, `session`/`session_id`/`session_token`, `bearer`, `set_cookie`,
  `password`/`passwd`/`pwd`/`passphrase`, `credential(s)`, `private_key`,
  `signing_key`, `vault`, plus `username`, `user_id`, `first_name`,
  `last_name`, `full_name`, `phone_number`, `address`, `ip`/`ip_address`,
  `ssn`, `national_id`, `date_of_birth`/`dob`.
- **Values are scanned, not just key names.** Every stored string — evidence
  text, `research_brief`, `error_code`, `error_message`, connector `message`,
  cursors, URLs and every string inside the JSONB blobs — is refused if it
  matches a credential shape (`Authorization`, `access_token`/`refresh_token`,
  `Bearer`/`Basic` with a long value, a dotted JWT, a PEM private-key header,
  `Cookie:`/`Set-Cookie`, `api_key=`, `client_secret=`, `password=`,
  `sk-…`, `infogenie.sid`, or userinfo in a URL). Previously only the producer
  helper `research_errors.sanitizeConnectorMessage` scanned anything, and the
  ingest validators did not call it — so a connector error page whose `message`
  carried `Bearer <jwt>` validated cleanly and would have been written to
  `orchestrator_research_runs.error_message`.
- **Honesty flags are rejected at any depth.** `verified`,
  `independently_verified` and `fact` were refused only on the top level of
  `provider_metrics`, so a nested `{ inner: { verified: true } }` passed.
- **Validated payloads are detached and deep-frozen.** `continuation_state` and
  `provider_metrics` were returned by reference inside a shallow `Object.freeze`,
  so a connector could add a forbidden key after validation and before the PR3E
  INSERT into an append-only table. The connector *request* kept that shallow
  freeze one round longer, leaving `requested_platforms` mutable after the
  platform/connector match had already been checked; the returned array is now
  frozen by `assertRequestedPlatforms` itself, for every caller.
- **`connector_version` is scanned, not just measured.** It was the one stored
  string checked for length alone, so a version like
  `1.0.0 Bearer <jwt>` validated and would have been written to every evidence
  row it identified. It now goes through the same bounded-text path as the other
  stored strings (trim, 1–64, no NUL, credential-shape refusal).
- **Named CHECK and FK constraints are redefined atomically.** So that a changed
  CHECK body would actually take effect on an existing database,
  `_ensureNamedCheck` had started dropping every named CHECK on the orchestrator
  tables and re-adding it as two separate autocommit statements. That left the
  table with no CHECK at all between them on *every* boot, and left it
  unconstrained permanently whenever the re-add failed: a row the new definition
  rejects makes `ADD CONSTRAINT` raise `23514`, the boot task then exits in
  production, and the CHECK stays dropped on the live table. Verified by
  redefining `orchestrator_research_evidence_headline_check` over a stored
  600-character headline — before the fix the table went on to accept a
  9000-character headline. `_ensureNamedFk` had the same shape for the
  3-column competitor swap. Both now run the drop and the add in one
  transaction, so the DDL lock spans the whole swap (concurrent readers and
  writers block rather than slipping through an unconstrained window) and a
  failed add rolls back to the previous definition. The error still propagates,
  so boot is still fail-closed — the database just keeps its constraint.
- **A sweep client whose `ROLLBACK` failed is destroyed, not pooled.** Both
  rollbacks on the retention sweeper's failure path are best effort and
  swallowed, so `release()` was reached with no proof the connection was clean.
  `release()` does not roll back: confirmed against node-pg that a client handed
  back mid-transaction keeps the same backend, and the next borrower sees an
  assigned xid and reads the previous borrower's uncommitted writes — meaning an
  unrelated request could have inherited the sweep transaction and its
  `FOR UPDATE` row locks on the evidence table. A redundant `ROLLBACK` is a
  warning rather than an error, so one that returns is proof of a clean client;
  only an unconfirmed rollback destroys the connection, which keeps ordinary
  sweep failures from churning the pool.

The scan deliberately fails closed and rejects the whole object rather than
masking, so a message that genuinely needs the word `token:` in it has to be
rewritten by the connector author. A message that only mentions credentials
("connector credentials rejected") still stores.

### URL handling — syntactic only, no fetch sink

URL checks here are **syntactic**: `https://` only, ≤2048, printable ASCII, no
userinfo, no `data:`/`javascript:`/`http:`, and no credential material in the
query. Nothing in PR 3A dereferences a URL, and no DNS lookup happens at this
layer. **PR3E must call `services/security/safe_url.js` before any fetch** —
that module owns the private/loopback/metadata denylist, the port pin, the
raw-authority encoding checks and the DNS pinning.

Two URL properties were tightened here. The validator stored the raw string
while validating a parsed copy, and `new URL` silently strips tabs and newlines
and rewrites backslash authorities — so `https://evil.example\t/x` and
`https:\\evil.example/x` were accepted and stored in a form that a later parser
could read differently from the one the check approved. Both are now refused,
along with non-ASCII (IDN homograph) forms. `storage_ref` is a locator, not a
fetch target: it now takes only a scheme-less object key or an `https:` /
`research:` scheme, with protocol-relative refs and userinfo refused. It
previously accepted `file:///etc/passwd`, `ftp://…`, `//host/…` and
`https://user@host/…`, which would have become a file-read or SSRF surface for
whatever resolves the ref.

### Re-review after the BLOCK remediation (`b3a7497`)

The five BLOCKs raised against the first PR 3A schema pass were re-checked
against the code as it stands, not against the commit messages that claim to
close them. All five are now closed; the fifth took three passes and its entry
below records what was wrong on each of them.

- **No ungated delete at boot.** `BOOT_TASKS` calls
  `ensureAgentOrchestratorSchema()` (which identifies holds), then
  `countLegacyHolds()`, then one retention sweep. `approveLegacyCleanup` and
  `executeLegacyCleanup` are unreachable from `server.js` and from every
  `services/**/api.js` — the only `require` of `research_cleanup` outside tests
  destructures `countLegacyHolds`, which is a `SELECT COUNT(*)`. The one delete
  boot can still perform is the retention sweep of rows whose own `expires_at`
  has passed, which is the retention policy rather than a legacy purge, and the
  boot call passes `skipHolds: true`, so no held id is deleted on the boot path.
- **No replica-role dependency, and a failed preflight is a no-op.** Proved with
  real `NOSUPERUSER` roles and a before/after `pg_class`/`pg_constraint`
  snapshot, not by reading the SQL.
- **The quota cannot be bought back by corrupting its cache.** The trigger
  recomputes from `COUNT`/`SUM` under `FOR UPDATE`; `0` is fail-closed.
- **PII is redacted before it is stored, fingerprinted or handed to an LLM
  shape**, with the heuristic limits of that redaction written down rather than
  claimed away.
- **`SKIP LOCKED` and the `DELETE` are one statement**, with the held-row
  scenario run 20 consecutive times. The sweeper sets no `lock_timeout` of its
  own, and that scenario now survives a default-parallel test run — see the
  closed entry below.
- **The operator delete is bound to the previewed snapshot**, and the cleanup
  GUC that used to stand beside the hold row is gone.

No new `/api` route, no `ROUTE_GROUPS` entry, no `connectors/` directory and no
edit to `permission_enforce.js`, `permissions.js`, `permission_matrix.js`,
`services/tenants/context.js`, `middleware.ts` or the vault landed with this
work; `PERMISSION_ENFORCEMENT` and `MULTITENANT_ENFORCEMENT` are untouched.

### Accepted residuals (PR 3A)

- **A tenant-scoped retention sweeper now exists.** `research_retention.js`
  deletes expired non-`legal_hold` evidence (assets cascade from evidence, and
  expired assets are also swept independently while the parent is live). It is
  batch-limited, treats `orchestrator_research_legacy_holds` differently on the
  boot path and the interval path (see the next entry),
  is fail-closed on NULL `expires_at` for unheld `standard`/`short` rows
  (counted as `invalid_expiry`, not deleted, no invented TTL), and is wired from
  `server.js` `BOOT_TASKS` plus a 6h `backgroundEnabled()` interval. The boot
  pass fails closed: a sweep that returns `ok !== true`, or throws, logs,
  captures to Sentry and calls `process.exit(1)` when
  `NODE_ENV === 'production'`. `legal_hold` rows are never swept while the
  parent exists. `orchestrator_research_runs` and
  `orchestrator_research_competitors` still have no `expires_at`, so a run's
  `research_brief` and `search_parameters` are retained until the workflow or
  tenant is deleted.
- **A held row is skipped at boot and purged on the interval, and that split is
  what keeps retention from failing open.** `server.js` calls the sweep with
  `{ skipHolds: true }`, so first-boot leftovers stay operator-owned and boot
  never deletes a row an operator has not previewed. The interval and default
  sweep pass no `skipHolds`, so `expiredPurgeSql` emits no hold filter and a row
  that is genuinely expired on its own terms
  (`retention_class <> 'legal_hold' AND expires_at IS NOT NULL AND
  expires_at <= now() AND expires_at > created_at`) is purged **even when a hold
  row names it**, with the matching `orchestrator_research_legacy_holds` rows
  deleted in the same batch transaction so a purged id cannot survive as a
  preview ghost. Without that, a `legacy_short_due` hold written once at boot
  would have pinned an expired row in the database forever. What the interval
  sweep still cannot touch is a `missing_expiry` row: `expires_at IS NULL` fails
  the `IS NOT NULL` predicate, there is no invented TTL, and the row waits for
  the operator preview/approve/execute sequence. That is the deliberate residual
  — a retention overrun an operator has to clear, not a silent deletion.
- **`SKIP LOCKED` and the `DELETE` are now one statement.** Each batch runs
  `BEGIN` → a single CTE
  (`WITH doomed AS (SELECT id … FOR UPDATE SKIP LOCKED LIMIT $2) DELETE …
  USING doomed`) → `COMMIT` on one `pool.connect()` client, so there is no
  window at all between the lock and the delete, and two concurrent sweepers
  take disjoint batches — verified directly against Postgres: a row held by an
  open `FOR UPDATE` transaction was skipped, every unheld expired row was
  purged, the sweep returned promptly rather than blocking, and the held row was
  purged by the next sweep, repeated 20 consecutive times.
  **The sweeper sets no `lock_timeout` at all** — neither a session-level
  `SET lock_timeout = '2s'` nor a per-batch `SET LOCAL lock_timeout`. An earlier
  revision did, and a 2s timeout on the sweep client turned every sibling DDL
  wait into a `55P03` the sweep then retried into another one. `SKIP LOCKED` is
  what makes the sweep prompt; the timeout was doing nothing the CTE did not
  already do, and it left the sweep client carrying a session GUC it then had to
  reset before returning to the pool. `55P03` still joins `40P01`/`40001` in the
  bounded retry, because a `lock_timeout` can still arrive from a server- or
  role-level default. A sweeper that finds every candidate already locked
  commits an empty batch and stops, which is success rather than the old
  `ok: false` noop race. A client whose `ROLLBACK` could not be confirmed is
  destroyed rather than returned to the pool, because `release()` does not roll
  back and the next borrower would otherwise inherit the batch transaction and
  its `FOR UPDATE` row locks.
- **A batch that empties while expired rows are still locked is retried inside
  the same sweep, and exhausting those retries is not a failure.** After both
  tables drain for a tenant, the sweeper re-counts that tenant's remaining
  eligible rows with the **same predicates as the CTE** and no `SKIP LOCKED`; a
  non-zero count means the leftovers are locked rather than ineligible, so it
  sleeps `LOCKED_RETRY_BASE_MS * attempt` (25ms base) and runs another pass, up
  to `LOCKED_RETRY_MAX = 5` attempts, for that tenant only. The count is a plain
  MVCC read, so it never waits on the locks it is counting, and the boot
  `skipHolds` flag is carried into every retry pass, so a boot sweep still
  refuses to delete a held row on attempt five. This is the difference between
  eventual deletion and none: `SKIP LOCKED` alone would have let one concurrent
  reader defer an expired row for a full 6h interval. The bound is deliberate,
  and so is its cost: after the fifth attempt the sweep returns normally, the
  still-locked rows wait for the next interval, and `failures` is **not**
  incremented — unlike an exhausted `40P01`/`40001` retry, a locked leftover
  does not set `ok: false` and does not exit a production boot. That last pass
  also logs nothing, so a persistently locked expired row shows up only as
  `research_evidence_sweep_locked_retry` lines that stop at
  `attempt: 4` rather than as a metric an operator can alert on. Adding that
  terminal count log is retention work, not a security control, and is left to
  the owner of `research_retention.js`.
- **The sweeper/boot-DDL deadlock is broken at the source and retried at the
  edge.** The batch holds locks on `orchestrator_research_evidence` from the
  `SELECT` until `COMMIT`, and the `DELETE` fires
  `orchestrator_research_evidence_immutable()`, whose
  `NOT EXISTS (SELECT 1 FROM orchestrator_research_runs …)` needs a lock on the
  runs table. `ensureAgentOrchestratorSchema` used to send its
  `CREATE OR REPLACE FUNCTION` / `DROP TRIGGER` / `CREATE TRIGGER` block as one
  multi-statement implicit transaction holding `AccessExclusiveLock` on the runs
  table *and* the evidence table, which closed the cycle: Postgres logged
  `deadlock detected` with one side waiting for `AccessExclusiveLock` on
  `orchestrator_research_evidence` / `orchestrator_research_competitors` and the
  other waiting for `RowShareLock` on `orchestrator_research_runs`.
  `_installInTransaction` now installs one table's functions and triggers per
  `BEGIN`/`COMMIT`, so no `ensure()` transaction holds the runs table and the
  evidence table at once. Grouping a table's functions with its own triggers
  costs nothing, because `CREATE OR REPLACE FUNCTION` takes no lock on the
  tables its body names — checked against `pg_locks`, which reported no lock on
  either table for a function whose body selects from both. A failed install
  rolls back, so a `DROP TRIGGER` is never committed without its
  `CREATE TRIGGER`; that is the same fail-open shape `_ensureNamedCheck` had,
  and it was confirmed by forcing a `CREATE TRIGGER` to fail mid-transaction and
  finding the previous trigger definition still installed. The sweeper also
  retries `40P01`/`40001` up to `DEADLOCK_RETRY_MAX = 5` times per batch, and
  only when the `ROLLBACK` was confirmed; every other error, including the
  `removed === 0` noop guard, is rethrown on the first occurrence rather than
  retried. Exhausted retries still increment `failures`, so `ok` is false and
  the boot pass still exits in production. Measured on this branch: 18 parallel
  runs of the two research test files produced 0 test failures and 0
  `deadlock detected` lines in the Postgres log, against 2 logged deadlocks from
  the same harness on the previous commit.
- **That is not a proof the schema suite cannot deadlock.** `ensure()` still
  sends the `CREATE TABLE IF NOT EXISTS` block and the
  `CREATE … INDEX IF NOT EXISTS` block as multi-table implicit transactions, and
  the `_ensureNamedFk` swap of the evidence→runs foreign key takes
  `AccessExclusiveLock` on both tables inside one transaction — measured, not
  assumed. That FK atomicity is deliberate: splitting it back into two
  autocommit statements would restore the fail-open window this review closed,
  and the swap is skipped entirely once the stored column list already matches,
  so it is a one-time migration path rather than a per-boot one. Any other
  writer that holds an exclusive lock spanning these tables can still form a
  cycle. The bounded retry is what covers that residual, and a lost race still
  fails closed rather than mis-deleting or crossing a tenant boundary — the
  victim's transaction is rolled back whole.
- **Boot no longer needs a replica-role or trigger-disabling privilege.** The
  two `session_replication_role = replica` backfills are gone: there is no
  `session_replication_role` and no `ALTER TABLE … DISABLE TRIGGER` anywhere in
  the production path, asserted by `doesNotMatch` on the whole of `schema.js`.
  Boot no longer rewrites legacy rows at all, so it no longer needs a privilege
  that a managed PostgreSQL provider (RDS, Cloud SQL, Neon, Supabase) will not
  grant. Instead, `ensure()` runs a SELECT-only preflight
  (`_preflightAgentOrchestratorSchema`) **before any CREATE/ALTER/UPDATE/DELETE**
  — `has_database_privilege … CONNECT`, `has_schema_privilege(public, CREATE |
  USAGE)` and `has_table_privilege(INSERT | UPDATE | DELETE | REFERENCES |
  TRIGGER)` on every `orchestrator_%` table — and throws
  `orchestrator_schema_preflight_failed` when any probe is false. Proved against
  real Postgres with real roles rather than from the SQL text: a
  `NOSUPERUSER LOGIN` role that owns the orchestrator tables completes a full
  `ensureAgentOrchestratorSchema()`, and a role without `CREATE ON SCHEMA
  public` fails the preflight with a `pg_class`/`pg_constraint` snapshot that is
  byte-identical before and after — no table and no constraint is created on the
  way to the failure.
- **The cleanup GUC `infogenie.research_cleanup` is gone, and the approval
  record is now the whole gate.** The earlier version of this entry described a
  trigger predicate of "GUC is `on` **and** a hold row exists", and argued that
  the hold row carried the boundary because a custom (dotted) GUC is a switch
  any role can set in its own session, not a secret. That argument no longer has
  to be made: `current_setting('infogenie.research_cleanup', …)` appears nowhere
  in `schema.js`, and `SET LOCAL infogenie.research_cleanup` appears nowhere in
  `research_cleanup.js` or any other production JS. The immutability triggers on
  `orchestrator_research_evidence` and `orchestrator_research_evidence_assets`
  now permit a `DELETE` of a row that is not already past its own `expires_at`
  only when an `orchestrator_research_cleanup_ops` row for the same `tenant_id`
  is in state `approved` or `running` **and** an
  `orchestrator_research_cleanup_targets` row for that op names that exact
  `target_kind`/`target_id`. A hold row on its own no longer authorises
  anything. Verified behaviourally against real Postgres: setting the old GUC
  `on` in a session that also has a hold on the row is still refused with
  `orchestrator_research_evidence_immutable`; an `approved` or `running` op
  whose targets list the row permits the `DELETE`; a hold that is absent from
  that op's targets is refused; and `UPDATE` stays refused in every one of those
  cases. The residual is unchanged in shape and smaller in reach: a principal
  with `DELETE` on the evidence tables can also `INSERT` its own `cleanup_ops`
  and `cleanup_targets` rows, so this is a tamper-evident audit boundary against
  an operator mistake, not a privilege boundary against a hostile DB principal.
  PR 3A still has no HTTP surface, and neither `previewLegacyCleanup`,
  `approveLegacyCleanup` nor `executeLegacyCleanup` is called from `server.js`.
- **`ensure()` now bounds its DDL lock waits at 30s, and the advisory wait is
  the part that is still unbounded.** `_runEnsureAgentOrchestratorSchema` runs
  `SET lock_timeout = '30s'` on its dedicated client immediately after
  `pool.connect()` and **before** `pg_advisory_lock(87231402)`, and resets it
  with `SET lock_timeout TO DEFAULT` in the `finally` before the client is
  released or destroyed. So an `ALTER TABLE orchestrator_research_evidence …`
  that queues behind a long-lived `FOR UPDATE` now aborts with `55P03` after 30s
  instead of parking an `AccessExclusiveLock` request in front of every
  subsequent reader; the ensure throws, the boot task logs
  `agent_orchestrator_schema_init_failed` and production exits. That converts an
  indefinite deploy stall into a fail-closed boot, which is the intended
  trade. The sweeper deliberately carries no `lock_timeout`; the operator
  cleanup keeps a per-batch `SET LOCAL lock_timeout = '2s'`, which is scoped to
  its own transaction and never outlives it. Advisory lock 87231402 is **not**
  shared with the sweeper — the sweeper takes no advisory lock at all, so an
  ensure cannot deadlock against a sweeper that is holding evidence rows. What
  `lock_timeout` does not bound is the `pg_advisory_lock(87231402)` call itself:
  measured on this branch, an ensure client with `lock_timeout = '30s'` set
  waited more than 17 minutes for that advisory lock without aborting. In
  production the only contenders for 87231402 are other boot ensures, each of
  whose DDL waits is capped at 30s, so the wait is bounded in practice; a
  session that takes 87231402 and holds it (as the tests do) can still stall a
  boot indefinitely.
- **The migrator role must own the orchestrator tables, and the preflight does
  not prove that.** `DROP TRIGGER` / `CREATE TRIGGER` / `ALTER TABLE … DROP
  CONSTRAINT` need ownership, which `has_table_privilege` cannot express, and
  the probe loop matches `orchestrator_%` so `agent_orchestrator_runs` is not
  covered. A role that passes the preflight but does not own the tables still
  fails later with `42501`. That is a boot-availability residual in the
  fail-closed direction — the ensure throws, the boot task logs the static key
  `agent_orchestrator_schema_init_failed` and exits in production — not a
  half-migrated schema that keeps serving.
- **The orchestrator schema ensure fails closed on its own.** It is a dedicated
  `BOOT_TASKS` entry rather than one `await` inside the tier28-32 block. On a
  throw it logs the static key `agent_orchestrator_schema_init_failed` with no
  fields, captures a synthetic `Error` of the same name — so a Postgres error's
  `message` or `detail`, which can quote a failing row, reaches neither the log
  nor Sentry — and calls `process.exit(1)` under `NODE_ENV === 'production'`.
  `captureException` returns early without `SENTRY_DSN` and swallows its own
  failures, so nothing on that path can throw before the exit and hand control
  to the boot runner's `catch (e) { console.error('[boot] task failed:', …) }`,
  which would otherwise swallow the failure and continue booting. Registration
  order is schema ensure → `require` of `research_retention` → sweep, and the
  runner awaits tasks in registration order, so the sweep cannot run against a
  schema this entry failed to install.
- **Boot identifies legacy rows; it never deletes them.** The earlier version of
  this entry described a boot that backfilled a TTL onto legacy rows and let the
  next sweep delete them in the same boot. That path is gone. `ensure()` now
  only `INSERT … ON CONFLICT DO NOTHING`s the offending ids into
  `orchestrator_research_legacy_holds` with a `reason` of `missing_expiry`,
  `invalid_expiry` or `legacy_short_due`, and boot logs
  `legacy_holds_identified` with two integers. No evidence row and no asset row
  is deleted by identification, the boot sweep passes `skipHolds: true` so its
  CTE excludes held ids, and `invalid_expiry` ignores held rows so the expected
  leftovers do not turn boot into `process.exit(1)`. Deleting them is an
  explicit operator act:
  `previewLegacyCleanup` → `approveLegacyCleanup` (confirmation phrase
  `DELETE_LEGACY_RESEARCH_EVIDENCE`, compared with `crypto.timingSafeEqual`,
  stored only as a SHA-256 hex digest) → `executeLegacyCleanup`. The residual
  moves rather than disappearing: legacy rows now persist past their intended
  TTL until an operator runs that sequence, which is a retention-overrun
  residual instead of an irreversible-deletion one.
- **`legacy_short_due` is a one-shot cluster snapshot, and its latch table is
  deliberately not tenant-scoped.** Without a latch, every boot would re-hold
  every naturally expired `short` row and the sweeper would never be allowed to
  delete anything again. `orchestrator_research_legacy_short_due_snapshot` is
  that latch: `id SMALLINT PRIMARY KEY DEFAULT 1` with a `CHECK (id = 1)`
  singleton constraint and a `taken_at` timestamp. It holds no tenant data, no
  evidence ids and no foreign keys, it is not in `ADVERTISING_ORCH_TABLES`, and
  it is never read to answer a tenant query — the only reads are "does a row
  exist" and "is there any `legacy_short_due` hold". It carries no `tenant_id`
  because there is nothing tenant-shaped in it to leak; the rows it gates are
  still written per tenant into `orchestrator_research_legacy_holds`, which is
  `tenant_id NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` and keyed
  `(tenant_id, target_kind, target_id)`. Cluster scope does mean a tenant
  onboarded after the latch closes never gets a `legacy_short_due` hold, which
  is the intended behaviour: it has no legacy rows, and its `short` rows expire
  and are swept normally.
- **The evidence quota is recomputed from the table, not trusted from a
  counter.** `orchestrator_research_evidence_quota_insert` takes `FOR UPDATE` on
  the tenant's `orchestrator_research_quota` row and then derives `q_count` /
  `q_bytes` from `COUNT(*)` and `SUM(orchestrator_research_evidence_payload_bytes(e))`
  over that tenant's evidence, so a corrupted cache row cannot buy extra
  capacity — verified by writing `evidence_count = 0, payload_bytes = 0` onto a
  tenant already at its record cap and watching the next INSERT still raise
  `orchestrator_research_evidence_limit_exceeded`. A corrupt-high cache is
  ignored for the same reason, and the `AFTER DELETE` trigger recomputes rather
  than decrementing, so the row heals. Limits still live in
  `orchestrator_tenant_limits` and a missing row (or an explicit `0`) is
  fail-closed: `max_records <= 0 OR max_bytes <= 0` raises before any write. The
  cost is write amplification — every evidence INSERT scans that tenant's
  evidence under a row lock, bounded by the 10,000-record default cap — and the
  limits row itself remains the authority, so a raw-SQL write to
  `orchestrator_tenant_limits` still moves the ceiling. Evidence *assets* have
  no volume cap of their own; they are bounded only by the evidence rows they
  hang off and the 1024-character `storage_ref` limit.
- **Execute is bound to the previewed snapshot and to a hash of it; the actor is
  read from the session rather than supplied, and tenant membership of that
  actor is still unchecked.** The earlier version of this entry recorded the
  opposite: `executeLegacyCleanup` used to delete whatever was held for the
  tenant at the moment it ran, so a hold identified after the human read the
  preview could be deleted by that human's approval, and replaying a `completed`
  op could purge a later boot's new holds without a fresh confirmation phrase.
  Both are closed. `previewLegacyCleanup` writes the tenant's holds into
  `orchestrator_research_cleanup_targets` inside the preview transaction and
  **only while the op is in state `previewed`** — the `ON CONFLICT` re-preview
  path leaves the target set untouched once the op has moved on, so `approve`
  freezes it. The same transaction stores
  `orchestrator_research_cleanup_ops.snapshot_sha256`: a SHA-256 over that op's
  stored target rows, canonicalised as `target_kind` + NUL + `target_id` lines,
  sorted and newline-joined, derived from the table and never from a
  caller-supplied list. The framing is unambiguous rather than merely tidy —
  Postgres `text` cannot hold a NUL byte, so the field separator can never occur
  inside a `target_id`, and a row added to the set always adds a line. Both
  `approveLegacyCleanup` and `executeLegacyCleanup` recompute that digest from
  the rows and compare it with `crypto.timingSafeEqual` **before** they change
  state or delete anything; a mismatch fails closed with `validation_failed`
  field `snapshot_sha256`, the op stays where it was, and no `DELETE` is issued.
  `executeLegacyCleanup` then selects strictly from that op's `cleanup_targets`
  rows, and the immutability trigger independently refuses any `DELETE` of a row
  that op does not name, so the snapshot bound holds even if the execute query
  were wrong. An op already in `completed` returns
  `{ purged: 0, idempotent: true }` without opening a transaction, so a replay
  cannot delete leftover or newly identified holds. Verified end to end against
  Postgres: preview hold A, add hold B and an off-snapshot hold afterwards,
  approve and execute — A is purged, B and the off-snapshot hold survive, and
  re-running the completed op leaves both in place; and with a target row
  inserted after preview, approve and execute both refuse on
  `snapshot_sha256`, the op stays `approved`, and A and B are both still in the
  evidence table. `approveLegacyCleanup` refuses a caller-supplied `actorUserId`
  outright (`validation_failed` field `actorUserId`, checked with
  `hasOwnProperty` so an explicit `undefined` is refused too) and reads the
  actor from `req.user.id` under the same rule `runner.js` uses: a missing `req`
  is `validation_failed`, and a non-integer, zero or negative id is
  `auth_required`, so the synthetic api-key principal that exists when no owner
  row does cannot sign an approval. What remains: an approval authorises one
  op's row set for one tenant, the actor is not checked for membership of that
  tenant, and because the module has no HTTP surface the `req` it reads is built
  by the in-process operator caller rather than by the session middleware — so
  the audit row attributes rather than authenticates. The digest is also
  recomputed once per phase and not held under a lock for the duration of the
  delete, so a target row inserted between the execute-time check and a later
  batch of the same run is not re-hashed; there is no DB-level guard that
  refuses a `cleanup_targets` write once the op has left `previewed`, and what
  confines such a row is the immutability trigger, which still requires the same
  tenant and an `approved`/`running` op of that tenant. Both are acceptable for
  a module with no HTTP surface that only an operator with database and process
  access can call; authenticating the actor, and pinning the target set with a
  DB-level state guard, belong with the first UI or API that exposes it.
- **The 64-zero `content_fingerprint` DEFAULT survives only the `ADD COLUMN`
  itself.** The default is what lets the rename from `evidence_hash` add the
  column `NOT NULL` to a populated table; `ensure()` drops it on the next
  statement, so an `INSERT` that omits the column now fails `23502` naming
  `content_fingerprint` instead of storing a well-formed all-zero fingerprint.
  Verified after both a first and a second `ensure()`. Rows the migration
  backfilled still carry the all-zero value: it is a legible placeholder, not a
  fingerprint anyone should treat as content-derived, and re-deriving one for a
  legacy row would require re-reading content that may already be purged.
- **`content_fingerprint` is a content fingerprint, not a signature.** It is an
  unkeyed SHA-256 over the content subset and does not cover `tenant_id`,
  `metrics_kind`, `provenance_method`, `connector_id` or `captured_at`. It
  detects a rewrite of the canonical content (and the immutability triggers
  refuse one anyway); it does not attest that the evidence came from the claimed
  provenance method, and principal-level DB write access could still insert a
  new row with the same content and a different `provenance_method`. It is
  unkeyed by design: there is no HMAC key, so no secret is stored in the row or
  derivable from it, and the column must not be read as an authenticity or
  provenance attestation. A caller-supplied value is accepted only when it
  equals the recomputed one, so it cannot be used to assert a fingerprint the
  content does not have. Callers may still supply the deprecated input alias
  `evidence_hash`; validators never emit it.
- **In-copy emails and phone numbers are redacted before persist, and the
  redaction is pattern-based rather than exhaustive.** `redactContactPii` runs
  inside `sanitizeEvidenceText` — so `headline`, `body_text`, `excerpt`,
  `advertiser_name`, `research_brief` and `error_message` are rewritten to
  `[email]` / `[phone]` before the row is built — and `redactStringLeaves`
  applies it to every string leaf of `provider_metrics`, `search_parameters` and
  `continuation_state`. Redaction happens **before** `content_fingerprint` is
  computed, so the fingerprint commits to the redacted text and a fingerprint
  match cannot be used to confirm a guessed address. `toLlmSafeEvidence(row)`
  returns only those already-redacted fields (no `canonical_source_url`, no
  `provider_external_id`) for any future outbound LLM call; PR 3A has no LLM
  route. Extracted-contact *keys* stay forbidden, so this is not a licence to
  store an email or phone index, and comment threads, commenter identities and
  user profiles are still rejected outright. What it is not: perfect. Measured
  on the shipped regexes, `sales@example.com`, `First.Last+tag@sub.domain.co.uk`,
  `+1 (415) 555-2671`, `(415) 555-2671`, `415.555.2671`, `00442079460958` and a
  bare `4155552671` are all redacted, while `12345`, `987654` and
  `1,234,567,890` survive — but an address obfuscated as `name (at) example.com`
  is not matched, a run of ≥10 digits glued to a word character
  (`ref14155552671x`) is not matched because the pattern is word-boundary
  anchored, and a non-ASCII separator (`415‑555‑2671` with U+2011) is not
  matched. There are false positives in the other direction: two ISO dates in a
  row, or a ≥10-digit identifier, are rewritten to `[phone]`. Free-text PII
  detection is heuristic; the durable controls remain the forbidden-key list,
  the credential-value scanner and the TTL.
- **JSON and text byte limits are measured before redaction, and the DDL CHECKs
  after it.** `[email]` is seven characters, so redacting a six-character
  address (`a@b.co`) grows the value by one byte. A payload sitting exactly on
  the validator's 8192/8192/4096-byte limit can therefore cross the matching
  `octet_length(… ::text) <= …` CHECK and be refused by Postgres with `23514`
  instead of by the validator with `validation_failed`. Both refuse the write;
  only the error class and the layer differ.
- **`search_parameters` and `continuation_state` on the run row are type-checked
  in the DDL** (`jsonb_typeof(…) = 'object'`), matching `provider_metrics`.
- **The producer helper `connectorErrorPage` copies `extra.continuation_state`
  unvalidated.** It is the emit-side convenience; the ingest side
  (`assertConnectorError`) is what validates, and only validated output is
  persisted. A connector that logs its own return value before handing it over
  is outside this contract.
- **The idempotency key is tenant-scoped, not proof of a single run.** The
  partial unique index `(tenant_id, workflow_id, contract_version) WHERE state IN
  ('pending','running')` allows exactly one live run per workflow. Per-tenant
  evidence volume is capped by `orchestrator_tenant_limits`
  (`max_research_evidence_records`, `max_research_evidence_payload_bytes`; 0 =
  fail closed) and the `orchestrator_research_evidence_limit_exceeded` trigger.
  Completed *run* history is still unbounded.

### The live-PostgreSQL suite is now stable in parallel (closed)

This entry was open across two revisions. It is now closed, and the two earlier
descriptions are kept out of the doc deliberately: the first blamed the
constraint-swap `ALTER`, the second blamed `REASSIGN OWNED BY`, and both were
correct at the time. Every `AccessExclusiveLock` taker in the
advertising-orchestrator tests is now serialized against ensure() and against
the concurrency locker on the same advisory lock the production ensure uses.

`test/advertising-orchestrator-research-ops-schema.test.js` routes its DDL
through one helper, `withEnsureDdlGate`: a third connection takes
`pg_advisory_lock(87231402)`, the work client sets `lock_timeout = '30s'`, and
the `finally` resets the timeout and unlocks. The work client never holds
87231402 itself, because ensure() holds that lock for its whole run and a client
that held it and then called `ensureAgentOrchestratorSchema()` would deadlock
against itself. Both role-lifecycle helpers go through it —
`dropLoginRole` (`REASSIGN OWNED BY` / `DROP OWNED BY` / `DROP ROLE`) and
`grantOrchestratorMigrator` (`ALTER TABLE … OWNER TO`,
`ALTER FUNCTION … OWNER TO`) — and the constraint-swap `ALTER`s stay gated as
well.

The victim side is serialized too, which is what the second revision was
missing. `runSkipLockedHeldRowOnce` in both the concurrency and retention files
now takes 87231402 **before** it seeds, so the workflow, competitor and evidence
INSERTs are inside the gate rather than racing outside it, and the lock is held
through the locker's `SELECT … FOR UPDATE` and the first sweep. The
two-concurrent-sweeps tests hold the same lock for their seed. That matters
because the seed INSERT and `REASSIGN OWNED BY` reach for
`orchestrator_research_evidence` and `orchestrator_tenant_limits` — the table
the quota insert trigger reads — in opposite orders, which is exactly the cycle
Postgres reported when this was open.

`GRANT … ON ALL TABLES IN SCHEMA public` is the one remaining un-gated statement
in these files and it does not need a gate: probed against Postgres inside a
transaction, it takes no `AccessExclusiveLock` at all and no lock of any mode on
any `orchestrator_%` relation. There is no `TRUNCATE`, `DROP TABLE`, `CLUSTER`
or `VACUUM FULL` in this suite.

Verified on `8ddfb4fb` rather than accepted: sixteen consecutive
default-parallel `node --test` runs of the complete eight-file research suite —
no `--test-concurrency=1` — all green at 107 of 107, with no hang and no
failure. The stronger signal is the server log for the exact run window, which
recorded **zero** `deadlock detected` lines and zero
`canceling statement due to lock timeout` lines: the lock discipline is clean
rather than merely masked by the sweeper's bounded `40P01` retry. The
`research_evidence_sweep_retry` and `research_evidence_sweep_failed` lines that
do appear are identical in every run (five and four), because they come from the
tests that inject synthetic conflicts through a wrapped pool. At the roughly
one-in-six failure rate measured while this was open, sixteen clean runs would
occur about five percent of the time by luck, and zero logged deadlocks would
not occur at all.

Production never depended on any of this. Its `AccessExclusiveLock` comes from
`ensure()`, whose client carries `lock_timeout = '30s'`, so a boot that queues
behind a long-lived `FOR UPDATE` aborts with `55P03` and fails closed rather
than stalling. `REASSIGN OWNED BY`, `DROP OWNED BY` and `ALTER … OWNER TO` are
test-only role teardown and appear nowhere in the product path. No production
file changed to close this: the fix is entirely in the test layer, and
`schema.js`, `research_retention.js` and `research_cleanup.js` are byte-identical
to the revision that was reviewed for findings 1 through 4.

Coverage: `test/advertising-orchestrator-research-schema.test.js` (15 DDL tests
against real Postgres: tenant FK/PK shape, composite-FK cross-tenant rejection,
approval binding, identity immutability, evidence UPDATE refusal, forbidden
columns, tenant cascade),
`test/advertising-orchestrator-research-ops-schema.test.js` (retention CHECKs,
`NOT VALID` behaviour, quota recompute, fingerprint column, the ensure
`lock_timeout` ordering, the refusal of a GUC-only delete, the approved/running
op plus snapshot target delete, the refusal of an off-snapshot hold,
`NOSUPERUSER` ensure and the no-op failed preflight),
`test/advertising-orchestrator-research-contracts.test.js`,
`test/advertising-orchestrator-research-retention.test.js`,
`test/advertising-orchestrator-research-retention-concurrency.test.js`
(held-row `SKIP LOCKED` 20×, two concurrent sweeps; the held-row scenario wraps
its locker and sweep in `pg_advisory_lock(87231402)` on a third connection so an
`ensure()` in a sibling file cannot start its `ALTER` while the row is locked —
see the open BLOCK above for the DDL that gate does not cover),
`test/advertising-orchestrator-research-cleanup.test.js` (preview → approve →
execute bound to the snapshot, later and off-snapshot holds surviving,
confirmation phrase, digest-only storage, tenant scoping),
`test/advertising-orchestrator-research-store.test.js`,
`test/advertising-orchestrator-research-sweep-wiring.test.js` plus
`test/security-guardrails.test.js` (validator-level tenant authority, credential
scanning, normalized forbidden keys, locator schemes, detachment, no
route/connector/fetch).

## Advertising orchestrator — campaign delivery intents (PR 6C)

PR 6C adds one tenant-scoped table
(`orchestrator_campaign_delivery_intents`), one HTTP route
(`POST /api/agent-orchestrator/campaign-drafts/:id/publishing-requests/:publishingRequestId/delivery-intents`),
two modules (`campaign_delivery_contracts.js`, `campaign_delivery_intents.js`),
one dedicated outbox helper (`outbox.enqueueCampaignDeliveryV1`) and one
read-and-lock helper (`campaign_publish_requests.lockPublishRequest`).

**Nothing in PR 6C talks to a provider.** There is no connector module, no
`fetch`, no `setInterval`/cron, no worker drain and no vault read of secret
material. The route's success body is pinned to `published: false` and
`external_action_taken: false`, and the draft and publish-request statuses are
untouched (`approved_for_publish` and `requested` respectively, verified after a
successful create). Provider work is PR 6D and does not exist yet.

### Auth, permission and CSRF

- **Session only.** The route is wrapped with `{ rejectApiKey: true }`, so an
  `INFOGENIE_API_KEY` caller gets `403 permission_denied` before any tenant or
  permission work. Anonymous callers get `401 auth_required`.
- **`GATE_PERMISSION.campaign_publishing`** (`orchestrator.workflows.approve.campaign_publishing`)
  is required in the handler, matching `/approve`, `/publishing-requests` and
  `/revoke`. A Marketer is refused.
- **No new `ROUTE_GROUPS` prefix was needed, and none was added.**
  `_matchGroup` sorts longest-prefix-first, so the nested path resolves to the
  existing `/api/agent-orchestrator/campaign-drafts` row
  (`orchestrator.workflows.view` for both read and write) rather than to the
  broader `/api/agent-orchestrator` row. The matrix row is the outer boundary;
  the in-handler gate is the real control. `permission_matrix.js` is unchanged
  by this PR and a test asserts it contains no `delivery-intents` string.
- **CSRF covers this route.** `services/security/csrf.js` has no path allowlist,
  so a cookie-authenticated `POST` with a missing or mismatched
  `Origin`/`Referer` is refused with `403 csrf_rejected` when `SECURITY_CSRF` is
  `on` — the production default — and no intent row is written. The module's
  API-key exemption is not a way in here, because `rejectApiKey` already closed
  that door.
- **The tenant is never caller-supplied.** `resolveTenantId(req, { label:
  'orch-campaign-drafts' })` returns `req.tenant.id` or null; there is no
  `allowFallback`. `req.tenant` is set only from `req.session.activeTenantId`
  validated against the caller's active memberships, so no header, query or body
  value selects a tenant. A body `tenant_id` is compared against the resolved id
  and then rejected outright as an unknown field (see below), so even a *correct*
  `tenant_id` fails the request.

**The strongest control on this route does not depend on a rollout flag.** Both
the matrix enforcer and the in-handler `requirePermission` are inert when
`PERMISSION_ENFORCEMENT` is `shadow` (the dev default; production defaults to
`on`). The actor binding is not: `createDeliveryIntent` unconditionally refuses
unless the caller is the same user recorded as `actor_user_id` on **both** the
publish approval row and its snapshot, *and* is the `requested_by` of the publish
request, *and* holds an `active` `tenant_users` row. A shadow-mode deployment
therefore still cannot let a second tenant member create a delivery intent
against someone else's approval.

### Tenant isolation of the PR 6C schema

Reviewed as landed, and probed against real Postgres rather than read only.

- `PRIMARY KEY (tenant_id, id)` and `tenant_id INTEGER NOT NULL REFERENCES
  tenants(id) ON DELETE CASCADE`, so an intent id is only resolvable inside one
  tenant.
- **Every parent reference is a composite FK on `(tenant_id, …)`**: publish
  request, draft and publish approval → `(tenant_id, id)` `ON DELETE CASCADE`;
  workflow approval and outbox → `(tenant_id, id)` `NO ACTION DEFERRABLE
  INITIALLY DEFERRED`. Every target carries a matching `PRIMARY KEY (tenant_id,
  id)` or `orchestrator_approvals_tenant_unique_id`. Binding an intent in tenant
  A to an outbox row in tenant B is refused with `23503` on
  `orchestrator_campaign_delivery_intents_tenant_outbox_fkey`, so the deferred FK
  **cannot orphan across tenants**.
- **The deferred outbox FK cannot orphan within a tenant either.** The intent row
  is written first with a pregenerated `outbox_id`, then the outbox row, inside
  one transaction; an intent that reaches `COMMIT` with no matching outbox row is
  refused with `23503`. The reverse is closed too: deleting the bound outbox row
  while the intent lives is refused by the same FK (`NO ACTION`), so the pending
  row cannot be dropped out from under the intent.
- Every unique key leads with `tenant_id` — `(tenant_id,
  publishing_request_id)`, `(tenant_id, outbox_id)`, `(tenant_id,
  idempotency_key)`. Two tenants may use the same client idempotency key and
  neither can see or collide with the other's intent. There are no bare
  natural-key uniques.
- **No credential, token, header, provider, external-id, snapshot-body or
  raw-payload column exists on the table.** Only ids, `revision`, three hex-64
  hashes, the frozen `contract_version`/`operation`/`status`, the client
  idempotency key, `requested_by` and `created_at`.
- `contract_version`, `operation` and `status` are pinned by CHECK to
  `campaign_delivery_v1` / `create_provider_draft` / `pending`; the three hash
  columns are CHECKed `^[0-9a-f]{64}$`, so an uppercase digest is refused with
  `23514`.

### Immutability and tenant cascade

`orchestrator_campaign_delivery_intents_immutable` fires `BEFORE UPDATE OR
DELETE`: every `UPDATE` raises, and a `DELETE` is allowed only once the owning
`tenants` row is already gone. Probed:

- `UPDATE … SET status='enqueued'` and re-pointing `outbox_id` both raise
  `orchestrator_campaign_delivery_intents_immutable`.
- `DELETE FROM tenants` cascades the intents away cleanly (0 rows remain).
- Deleting the parent publish request while the tenant still exists is refused —
  by `orchestrator_campaign_publish_requests_immutable` on the parent, before the
  intent's `ON DELETE CASCADE` is reached. The cascade is a tenant-teardown path,
  not a way to retract a recorded intent.
- Deleting the requesting `users` row is likewise refused. The declared
  `requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL` is
  self-contradictory (a `SET NULL` into a `NOT NULL` column), but the immutability
  trigger raises first, so the observable behaviour is a refusal rather than a
  silent null. This is a residual, not a new one — see below.

### Request body: strict allowlist, no caller-supplied identity or content

`parseDeliveryBody` accepts exactly four keys — `contract_version`, `operation`,
`platform`, `idempotency_key` — and nothing else. Everything that identifies,
authorizes or describes the delivery comes from the database, not the caller.

- `contract_version` must equal `campaign_delivery_v1` and `operation` must equal
  `create_provider_draft`; both are constants, so the client cannot select a
  different contract or a stronger operation such as `activate_campaign`.
- `platform` must be exactly one of `meta`/`google`/`tiktok` **and** must appear
  on the authoritative approved revision's `platforms`, with exactly one matching
  `accounts` entry. A platform the approval never covered is refused and no row
  is written.
- Forbidden keys are the shared `FORBIDDEN_KEYS` + `POLLUTION_KEYS` lists plus a
  PR 6C list covering `credentials`, `access_token`, `refresh_token`,
  `authorization`, `api_key`, `credential_ref`, `provider*`,
  `external_campaign_id`, `snapshot*`, `confirmation*`, `approval_id`,
  `draft_id`, `publishing_request_id`, `outbox_id` and `payload`/`raw_body`.
  Matching is on `normalizeKey` (lowercase, non-alphanumerics stripped), so
  `Access-Token`, `ACCESS_TOKEN` and `refreshToken` all fail, and the walk
  recurses, so a forbidden key nested inside an accepted key still fails.
- `__proto__` and `constructor` are refused rather than merged, and
  `Object.prototype` is unmodified afterwards.
- Non-objects, arrays, `Buffer`s, an empty key and a key over 256 characters are
  all `validation_failed`. `capPayload` still caps the byte size upstream.
- The route accepts an `Idempotency-Key` header when the body omits the key. The
  header value is treated as the client key like any other — it is stored on the
  intent row, and it does **not** reach the outbox, the audit detail or the
  response body.

### Reauthorization runs before every write *and* before every replay

The transaction does the full authorization pass before it looks for an existing
row, so a replay is not a shortcut past a revoked approval:

1. `lockPublishRequest` — `SELECT … WHERE tenant_id AND draft_id AND id FOR
   UPDATE`. Presence, tenant and draft ownership are all part of the predicate,
   so a request id from another tenant or another draft is `not_found`, not a
   permission error, and the row is held to `COMMIT`. Verified with a competing
   `FOR UPDATE` under `lock_timeout`.
2. `assertPublishAuthorizedOnClient` — locks the draft `FOR UPDATE`, expires it
   if due, and re-derives the current unrevoked publish approval, re-checking
   that the snapshot, the revision and the stored `contract_hash` all agree with
   the authoritative revision.
3. `draft.status` must be `approved_for_publish`.
4. `assertRequestMatchesAuthorized` — status `requested`, `confirmation_version`
   1, and exact equality of `draft_id`, `publish_approval_id`,
   `workflow_approval_id` (against both the approval and the draft), `revision`
   (against both), `contract_hash` (against both) and `snapshot_hash` against
   `sha256Hex(pub.snapshot_json)` recomputed now.
5. Actor: `snapshot.actor_user_id` must equal `pub.actor_user_id`, the caller
   must equal it, and `reqRow.requested_by` must equal the caller.
6. `assertActiveMember` — an `active` `tenant_users` row for this tenant.
7. `checkCredentials` on the transaction client.

Then, before every idempotency lookup *and* every replay, `platform` and the
opaque `credential_ref` are derived from the authoritative revision contract
(`platformAccount` + the `safeReference` return). Replay locks the bound tenant
outbox (`tenant_id` + `outbox_id` `FOR UPDATE`) and compares the stored payload
`contract_version`/`operation`/`platform`/`credential_ref` plus the row
`destination`/`operation`/`state`/`id`; missing, stale, conflicting or
ambiguous values fail closed. A matching replay returns that pending outbox
state.

Revocation, expiry, a draft edit, a tampered `snapshot_json` and credential
removal each fail a *replay* closed with `approval_required`/`approval_revoked`,
`approval_expired`, `approval_stale` or `validation_failed` — never with
`replay: true`.

### Credentials: presence and ownership only, never a decrypt

`campaign_delivery_intents.js` does not require `services/credentials/vault.js`
and never calls `getCredentials`. It calls `checkCredentials(userId, contract,
{ tenantId, client })`, which:

- re-checks active tenant membership for the actor before looking at any
  credential;
- resolves `credential_ref` through `ownedCredentialUserId`, which accepts only
  `user_integrations` or `user_integrations:<callerId>` — a ref naming another
  user's plane is refused, so one member cannot spend another's connection;
- calls `vault.hasCredentials(ownerId, vaultKey, { client, tenantId })`, which on
  a transaction client with a tenant runs `SELECT 1 … JOIN tenant_users … WHERE
  status <> 'disconnected' LIMIT 1 FOR UPDATE OF ui`. That is an existence probe
  that **locks the `user_integrations` row for the rest of the transaction**, so
  a concurrent disconnect or delete cannot land between the check and the
  commit. No ciphertext, IV or tag is read into the process.

Probed with a marker written into `ciphertext`/`iv`/`tag`: the marker appears in
neither the response body, the intent row, the outbox row nor any audit detail.
Disconnecting or deleting the integration fails the create *and* the replay
closed with `missing_credentials`.

Every layer that touches a `credential_ref` on this path screens it with the same
canonical rule. `campaign_delivery_contracts.safeReference` delegates to
`outbox.normalizeCredentialRef` and returns only the value that helper accepts,
so shape (`CREDENTIAL_REF_RE`), emptiness and the known-secret-prefix denylist
(`KNOWN_SECRET_PREFIX_RE`) all fail closed in one place rather than being
duplicated and drifting. A `sk-`/`sk_`, `xox[abps]-`, `xapp-`, `gh[posur]_`,
`github_pat_`, `glpat-`, `shpat_`/`shpss_`, `npm_`, `dop_v1_`, `AKIA`, `ASIA` or
`AIza` value is `validation_failed` at `field: credential_ref` in either casing;
a JWT, a `Bearer …` string, a URL, base64 padding, an embedded newline or tab and
a value over 128 characters are refused on shape. The canonical opaque handles
the platform actually issues — `user_integrations` and
`user_integrations:<callerId>` — are returned byte-for-byte, so `intentHashOf`,
the stored `intent_hash` and the outbox `credential_ref` are unchanged and
already-persisted intents still replay-match. Verified by comparing every
`safeReference` result and `intentHashOf` output across the change: identical.

### Outbox hygiene

`enqueueCampaignDeliveryV1` is a narrow helper, not a second general `enqueue`:

- Its input is allowlisted to nine keys (`id`, `tenantId`, `workflowId`,
  `draftId`, `publishingRequestId`, `intentId`, `platform`, `credentialRef`,
  `idempotencyKey`). A caller-supplied `payload`, `destination` or `operation`
  is `validation_failed`, so the client cannot choose a provider destination or
  smuggle arbitrary JSON into an operator-readable row.
- `destination` and `operation` are literals in the SQL (`'internal'`,
  `'create_provider_draft'`), and `state` is `'pending'`.
- **The stored `idempotency_key` is never the client's key.** It must match
  `^cdv1:[0-9a-f]{64}$`, and the caller derives it as `cdv1:` +
  `sha256Hex({ kind, tenant_id, publishing_request_id, operation, intent_hash })`.
  A raw client key is refused by the helper's own regex, so the client key cannot
  leak into the outbox by mistake later.
- The helper constructs a strict allowlisted `campaign_delivery_v1` payload
  itself (no caller JSON, and not via generic `sanitizePayload`). The payload
  keys are exactly `contract_version`, `operation`, `platform`,
  `credential_ref`, `workflow_id`, `draft_id`, `publishing_request_id` and
  `intent_id`. `credential_ref` goes through `normalizeCredentialRef` (opaque
  shape plus the known-secret-prefix denylist), and a non-conforming value is
  **refused rather than dropped**, so a caller that meant to pass a handle and
  passed a secret sees the write fail instead of an enqueue with no credential.
  The payload carries no raw caller idempotency key, content, secrets, provider
  ids or URLs.
- The workflow is verified to exist *in this tenant* before the insert.
- **Nothing drains it.** The only `outbox.claim` callers are
  `generation_jobs.js` (`static_image_generate`) and `video_jobs.js`
  (`video_generate`); both pass an `operation` filter and re-check
  `ob.operation` before touching the row, and both park a mismatch back to
  `pending`. `services/jobs/scheduler.js` works the unrelated `jobs` table.
  `outbox.processOnce` is test-only.

### Atomicity and bounded concurrency

Intent row, outbox row and audit event are written inside one `SAVEPOINT
sp_campaign_delivery_intent` within a single transaction. On a unique violation
(`23505`) the savepoint is rolled back and the existing row is re-resolved and
re-validated; any other error propagates to a full `ROLLBACK`. There is no path
that leaves an intent without its outbox row, an outbox row without its intent,
or an audit event without either — this is tighter than PR 6B, whose audit insert
sits outside the savepoint.

Two concurrent creates against one publish request converge on **one** intent and
**one** pending outbox row; the loser gets `200` with `replay: true` or `409
idempotency_conflict`, never a second row. Reusing a key with different content,
or against a different publish request, is `409 idempotency_conflict`.

### Response and audit hygiene

The response body is exactly `ok`, `replay`, `published`,
`external_action_taken`, `intent`, and `outbox`. `intent` is the public
immutable refs — ids, `revision`, the frozen version/operation/status,
`requested_by` and `created_at` — and `outbox` is exactly `{ id, state }` with
`state` always `pending` on create and on a verified replay. It carries no
snapshot body, no contract, no hashes, no `credential_ref`, no confirmation
phrase, no client idempotency key, no payload and no `platform`.

Audit rows go to `orchestrator_audit_events` with `tenant_id`, `workflow_id`,
`event = 'campaign_delivery_intent_created'` and `actor_user_id`, and `detail` is
built by a 21-key allowlist that truncates strings to 120 characters and drops
everything else. `idempotency_key` is deliberately absent from that allowlist;
`platform` is present and is a three-value enum, not caller content.

### Accepted residuals (PR 6C)

- **`safeReference` takes any value `normalizeCredentialRef` accepts, including a
  coercible non-string.** The helper no longer type-checks its argument itself;
  it forwards to `normalizeCredentialRef`, which does `String(credentialRef)`
  before matching. `123` therefore yields `'123'` and `['user_integrations']`
  yields `'user_integrations'`, where the previous explicit
  `typeof … !== 'string'` check refused both. This is not a disclosure route —
  coercion happens *before* the denylist, so a secret-shaped non-string
  (`['sk-live-…']`, an object whose `toString` returns `AKIA…`) is still
  `validation_failed` — and it is unreachable on this path, because
  `platformAccount` normalizes the approved contract's ref first and passes only
  the resulting string on, while `ownedCredentialUserId` already refused a
  non-string when the contract was approved. Worth knowing if a PR 6D caller
  hands `safeReference` unparsed input.
- **`assertActiveMember` reads without `FOR UPDATE`.** Membership is checked on a
  plain `SELECT`, so a suspension committing between that check and the
  transaction's commit is not serialized against this write. Inherited verbatim
  from PR 6B's publish-request path; the credential row *is* locked, so the
  practical window is a member who is suspended in the same instant they submit.
- **`requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL`** is
  contradictory as declared, and identical to PR 6B's publish-request column.
  Account erasure for a user who has created a delivery intent (or a publish
  request) is refused while the tenant lives, and the error an operator sees is
  an immutability trigger name rather than a referential message. Deleting the
  tenant is the supported teardown.
- **The pending outbox row accumulates.** Nothing claims
  `create_provider_draft`, so every accepted intent leaves one `pending` row with
  `attempt_count = 0` forever until PR 6D ships a consumer. `next_attempt_at` is
  `now()`, so those rows will be immediately due the moment a consumer exists —
  PR 6D must treat the backlog as intentional queued work and re-authorize at
  send time rather than trusting the row's age.
- **`intent_hash` is a fingerprint, not a signature.** It is an unkeyed SHA-256
  over an eleven-field envelope. It detects a changed platform, revision,
  contract or snapshot on replay; it does not attest that the intent was created
  by a particular actor, and it is not an authenticity proof. `requested_by` and
  the audit row are the actor record.
- **`credential_ref` reaches an operator-readable row.** That is the existing
  outbox design (an opaque vault handle, screened by shape and by the
  known-secret denylist), not a change made here. The row still resolves to a
  secret at send time. PR 6D turned out not to add a resolution step — it
  compares the handle as an opaque string and never dereferences it — so the
  vault boundary gets re-reviewed in PR 6E, not PR 6D. See the PR 6D section
  below.

Coverage: `test/advertising-orchestrator-campaign-delivery-intent-schema.test.js`
and `test/advertising-orchestrator-campaign-delivery-intents.test.js` (session
gate, API-key refusal, permission gate, cross-tenant `not_found`, cross-draft
`not_found`, actor binding, strict body allowlist, platform-against-approval,
revoked/expired/stale/tampered fail-closed, credential and membership
re-checks on create and on replay, replay and conflict behaviour, same-request
concurrency, `FOR UPDATE` hold, immutability, the `safeReference` shape and
secret-prefix denylist, and no secret disclosure in response/outbox/audit), plus
`test/permission-matrix.test.js` and `test/security-guardrails.test.js` for the
matrix and CSRF/production defaults this route inherits. The prose in this
section is not itself pinned by a test.

## Advertising orchestrator — fake campaign delivery worker (PR 6D)

PR 6D adds the consumer that PR 6C deliberately left absent: one tenant-scoped
append-only table (`orchestrator_campaign_delivery_attempts`) and three modules
(`campaign_delivery_worker.js`, `campaign_delivery_attempts.js`,
`campaign_delivery_fake_connector.js`), plus worker constants appended to
`campaign_delivery_contracts.js`. `campaign_api.js` gains exactly one line — a
bare `require('./campaign_delivery_worker')` — and `campaign_delivery_intents.js`
only widens its `module.exports` so the worker can reuse the PR 6C
authorization helpers; neither file changes behaviour.

**The worker simulates. It does not deliver.** There is no connector to a
provider, no `fetch`, no HTTP or SDK client, no vault read and no credential
resolution anywhere on this path. `create_provider_draft` names the *intent*
recorded in PR 6C, not an effect: nothing outside Postgres is contacted, and
every attempt row is written `simulated = TRUE`, `published = FALSE`,
`external_action_taken = FALSE`.

### No HTTP surface and no matrix change

There is **no new route, no drain endpoint, no `ROUTE_GROUPS` entry and no
`permission_matrix.js` change**. The worker is reachable only from its own
`setInterval` and from direct module imports in tests; nothing in `campaign_api.js`
or `server.js` exposes claim, execute or settle to a caller. Because there is no
request, there is no caller-supplied tenant: the tenant is read off the outbox
row the worker itself selected.

### Dual startup gate, default off

`startCampaignDeliveryWorker()` runs at require time and returns `null` — no
timer, no work — unless **both** conditions hold:

1. `services/runtime_flags.backgroundEnabled()` is true. That is set once, at
   `server.js:75`, to `require.main === module`, so it is true only in the real
   Express process and false for every `buildApp()`/`bootApp()` consumer, for the
   Next front door, and for any module that merely imports the router.
2. `process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER === '1'` — an exact string
   compare. Unset, `'0'`, `'true'` and `'yes'` all leave the worker off.

Neither gate alone starts the timer, and the require in `campaign_api.js` happens
well after `setBackground`, so the ordering is not accidental. The default
production posture with the variable unset is **no worker at all**.

### Claim, execute, settle are three separate boundaries

The transaction never spans the simulation.

- **Claim** opens one transaction, selects a due `create_provider_draft` /
  `internal` outbox row `FOR UPDATE SKIP LOCKED`, appends a `started` attempt,
  flips the outbox to `processing` with `claimed_by`/`claimed_until`, and
  `COMMIT`s. It returns a frozen envelope (tenant, outbox, intent, attempt,
  attempt number, generation, `claim_token`, lease holder, lease expiry,
  platform).
- **Execute** runs `simulateDelivery` with **no transaction and no pooled client
  held**. The connector is a pure function over `SCENARIO_MAP` that returns a
  frozen result; it imports nothing but `errors` and the contracts module.
- **Settle** opens a second transaction, re-locks the attempt and the outbox, and
  fences before it writes anything.

`fenceOk` requires the tenant id, attempt id, outbox id, attempt number,
generation, `claim_token` and `lease_holder` from the envelope to match the
locked rows; the attempt to still be `started`; the outbox to still be
`processing` with `claimed_by` equal to the attempt's lease holder and
`claimed_until` equal to `lease_expires_at` to the millisecond; and the lease to
be unexpired. Any mismatch is `ROLLBACK` plus `{ fenced_out: true }` — no
terminalization, no outbox write, no audit row. `terminalizeAttempt` then
compare-and-swaps on `status = 'started'` as a second fence, so two workers
racing the same attempt cannot both settle it.

`claim_token` is 32 bytes from `crypto.randomBytes`, unique per
`(tenant_id, claim_token)`. It is the fencing secret: `publicAttempt` omits it,
the audit allowlist omits it, and no log line carries it.

A worker that dies after claiming leaves an attempt `started`; the next claim
sees the expired lease, terminalizes it `abandoned_lease` /
`simulated_lease_expired`, and appends a fresh attempt. The dead worker's late
settle is then fenced out on `claim_token`.

### Append-only attempt ledger

`PRIMARY KEY (tenant_id, id)`; uniques `(tenant_id, outbox_id, attempt_number)`,
`(tenant_id, outbox_id, generation)` and `(tenant_id, claim_token)`; every parent
reference is a composite `(tenant_id, …)` FK to the intent, outbox, draft and
publish request, so an attempt in tenant A cannot bind to a row in tenant B.

`orchestrator_campaign_delivery_attempts_guard` fires `BEFORE UPDATE OR DELETE`:

- An `UPDATE` is permitted **only** as `started` → non-`started`, and only when
  `id`, `tenant_id`, `intent_id`, `outbox_id`, `draft_id`,
  `publishing_request_id`, `attempt_number`, `generation`, `claim_token`,
  `lease_holder`, `lease_expires_at`, `platform`, `intent_hash`,
  `contract_version`, `operation`, `connector` and `started_at` are all
  unchanged. Re-opening a terminal row, re-terminalizing it, or rewriting its
  identity raises.
- A `DELETE` raises unless the owning `tenants` row is already gone, so history
  is prunable only by tenant teardown.

Retries therefore **append**; they never edit. `connector` is CHECKed to `'fake'`
and `contract_version`/`operation` to `campaign_delivery_v1` /
`create_provider_draft`, so a row produced by some future real connector cannot
be stored under this table's guarantees without a DDL change.

**`published` and `external_action_taken` cannot become true.** A row-level CHECK
asserts `simulated = TRUE AND published = FALSE AND external_action_taken =
FALSE` on insert, and the trigger re-asserts all three on update. A direct `psql`
`UPDATE … SET published = TRUE` is refused.

### Settlement re-authorizes from the database — without touching credentials

PR 6C warned that a queued row must be re-authorized at send time rather than
trusted for its age. `revalidateOnClient` does that inside the settle
transaction, under `FOR UPDATE`, before the fake result is mapped:

- the outbox payload must still parse to the exact eight-key shape with the
  pinned contract version, operation and an enum platform;
- the intent is locked and must still match the outbox, draft, publish request
  and `intent_hash`, and must still be `pending` / `create_provider_draft`;
- the publish request is locked via `lockPublishRequest` and checked against the
  authoritative approval by `assertRequestMatchesAuthorized`;
- `assertPublishAuthorizedOnClient` re-runs the PR 6B/6C approval check — the
  draft must still be `approved_for_publish`, the approval unrevoked and
  unexpired, the snapshot authoritative;
- the actor is re-derived by `boundActorId` from the approval **and** its
  snapshot, must equal both `reqRow.requested_by` and `intent.requested_by`, and
  must still hold an `active` `tenant_users` row;
- the platform and `credential_ref` binding is re-derived from the approved
  revision's contract and must equal both the outbox column and the payload;
- the eleven-field `intent_hash` is recomputed and must equal the intent's and
  the attempt's.

**None of this reads a secret.** The module calls no `checkCredentials`,
`getCredentials` or `hasCredentials`, and does not require
`services/credentials/vault`. `credential_ref` is compared as an opaque string
and is never dereferenced. Any failure is an `OrchError`, and the attempt
terminalizes `authorization_rejected` with the sanitized code and parks — so a
connector that reports success cannot overturn an approval that was revoked,
expired or edited after the row was queued.

### The outbox only ever returns to `pending`

The worker writes exactly two outbox states: `processing` on claim, and
`pending` on every exit path. It does not import `outbox.complete` or
`outbox.fail`, so a `create_provider_draft` row **cannot reach `completed`,
`failed` or `dead_letter`**, and `attempt_count`, `last_error_code` and
`completed_at` are never touched.

- A retryable outcome restores `pending` with `next_attempt_at = now +
  min(300, 2^n)` seconds.
- A terminal outcome restores `pending` with `now + 36500 days`, parking the row
  beyond any operational horizon rather than inventing a terminal state.
- A malformed payload, an intent that no longer matches its outbox, or a latest
  attempt already in `TERMINAL_PARK_STATUSES` parks the same way **without**
  appending an attempt.
- `publicOutbox` still refuses any state other than `pending`, so the settle
  return value is a second check on this property.

The dead-letter concept lives on the attempt row (`dead_letter_permanent`,
`dead_letter_malformed`, `dead_letter_blocked`), not on the shared outbox.
`MAX_ATTEMPTS = 8` converts the eighth retryable outcome to
`dead_letter_permanent` / `simulated_retry_exhausted`. `PER_TENANT_CAP = 20`
bounds one tick per tenant and a module-level `tickActive` latch prevents
overlapping ticks in a process.

Nothing else can drain these rows: `outbox.claim`'s only callers remain
`generation_jobs.js` (`static_image_generate`) and `video_jobs.js`
(`video_generate`), both of which pass an `operation` filter and park a mismatch
back to `pending`.

### Tenant isolation

Every statement in `campaign_delivery_worker.js` and
`campaign_delivery_attempts.js` carries `WHERE tenant_id = $1`, and the tenant is
taken from the selected outbox row rather than from any caller. The single
exception is the tick's `SELECT DISTINCT tenant_id FROM orchestrator_outbox …`
discovery query, which returns tenant ids and no tenant data, and matches the
pattern already used by `generation_jobs.js` and `video_jobs.js`; each id is then
worked in its own tenant-scoped pass. A claim envelope from tenant A cannot
settle a row in tenant B — `lockAttempt` and `lockOutbox` are tenant-scoped and
`fenceOk` re-compares `tenant_id`. The tenant read, write and schema audits pass
with **no new allowlist entry**.

### Audit and log hygiene

One `orchestrator_audit_events` row is written per settled attempt, with
`tenant_id`, the outbox row's `workflow_id`, `event =
'campaign_delivery_attempt_simulated'`, and `actor_user_id` from the revalidated
approval (null when revalidation failed). `detail` is built by a **16-key
allowlist** that truncates strings to 120 characters and drops everything else:
`claim_token`, `credential_ref`, `intent_hash`, the approval snapshot and the
outbox payload are all absent from it. Every row records `simulated: true`,
`published: false`, `external_action_taken: false`. A fenced-out settle writes no
audit row at all.

The worker emits exactly one log line, `campaign_delivery_worker_failed`, with a
tenant id and an error code re-matched against `^[a-z0-9_]{1,40}$` — anything
else becomes `internal_error` — so a driver or provider message cannot reach the
log. `error_code` is CHECKed against the same pattern in the DDL.

### PR 6E / PR 6F boundary — real mutation is still hard-denied

PR 6D creates no provider object. **PR 6E operationalizes the fake worker with a
governed sandbox outcome source; it still does not deliver.** A real provider
mutation — including creating a campaign in `PAUSED` state, which is the obvious
"harmless" first step — is **PR 6F** and remains hard-denied today.
`services/security/advertising_provider_mutations.js` is byte-identical to
`7cd6028a`, has no env escape hatch, and neither PR 6D nor PR 6E calls it or
routes around it, because they perform no mutation to guard.

When PR 6F replaces the fake connector it must:

- call `assertAdvertisingProviderMutationAllowed` **before** credential lookup,
  vault access or network I/O, exactly as every other lowest-level mutation
  helper does;
- resolve `credential_ref` through `services/credentials/vault.js` at send time,
  and never persist, return or log the resolved secret;
- keep `revalidateOnClient` **and** add the credential presence/ownership check
  that PR 6D/6E deliberately omit, since an approval can outlive a disconnected
  integration;
- treat `published` and `external_action_taken` as needing a new DDL story —
  today's CHECK and trigger refuse `TRUE` outright — and re-derive an
  external-id/idempotency story, because the attempt table stores no provider or
  external id;
- keep the outbox pending-only contract or replace it deliberately; a real send
  makes "restore to `pending`" a retry of a possibly-completed external action.

### Accepted residuals (PR 6D, partially closed by PR 6E)

- **PR 6E supplies the governed outcome source.** Production ticks no longer
  claim-and-abandon when no sandbox row (or test `opts.scenario`) is present:
  claim returns `{ skip: true, reason: 'no_outcome_source' }` without appending
  an attempt. `abandoned_lease` is reserved for true expired-lease crash
  recovery. Treat `INFOGENIE_CAMPAIGN_DELIVERY_WORKER=1` as test/staging-only
  until operators intentionally seed sandbox outcomes.
- **`assertActiveMember` still reads without `FOR UPDATE`.** Inherited verbatim
  from PR 6B/6C and now also on the settle path: a suspension committing between
  the check and the commit is not serialized against this write.
- **The park interval is a date, not a state.** A terminal attempt leaves the
  outbox `pending` roughly 100 years out. Any future operator tool that re-drives
  outbox rows by resetting `next_attempt_at` would un-park a dead-lettered
  delivery; the compensating control is the `TERMINAL_PARK_STATUSES` check on
  re-claim, which re-parks without appending an attempt.
- **`setInterval` is not `unref`'d.** While the flag is on, the timer keeps the
  Express event loop alive. Same as the existing generation and video workers.
  PR 6E makes start idempotent (single module-level handle) and exports
  `stopCampaignDeliveryWorker()`.
- **`publicOutbox` runs after `COMMIT`** in settle. If it ever threw, the caller
  would see an exception for a row that is already committed and correctly
  `pending`; no state would be wrong, only the return value lost.
- **`intent_hash` is still a fingerprint, not a signature** (PR 6C residual,
  unchanged). The attempt row copies it and the settle path compares it; that
  detects drift, it does not attest authorship.

Coverage: `test/advertising-orchestrator-campaign-delivery-attempt-schema.test.js`
(tenant-leading PK, composite FKs, cross-tenant FK refusal, the
published/external CHECK, single terminalization, immutability, tenant cascade,
idempotent re-ensure), `test/advertising-orchestrator-campaign-delivery-attempts.test.js`
(claim-token entropy and uniqueness, `publicAttempt` stripping `claim_token` /
`credential_ref` / `intent_hash`, append-only history),
`test/advertising-orchestrator-campaign-delivery-fake-connector.test.js`,
`test/advertising-orchestrator-campaign-delivery-worker.test.js` (flag matrix,
idempotent start/stop, claim-commits-before-execute with a network tripwire,
crash and stale-settle fencing, no-outcome skip, sandbox consume-once,
revalidation refusals, cross-tenant claim and settle, retry/park scheduling,
retry exhaustion, tick overlap, zero-network, corruption, and the audit
secret-hygiene check),
`test/advertising-orchestrator-campaign-delivery-sandbox-outcomes.test.js`,
and `test/security-guardrails.test.js` for the no-provider-sink source scan and
the claims in this section.

## Advertising orchestrator — sandbox delivery ops (PR 6E)

PR 6E keeps the worker **fake/sandbox-only**. It adds
`orchestrator_campaign_delivery_sandbox_outcomes` (tenant-scoped,
append-once / consume-once), `campaign_delivery_sandbox_outcomes.js`, idempotent
`startCampaignDeliveryWorker` / `stopCampaignDeliveryWorker`, and pre-claim
outcome resolution so production ticks do not recycle as `abandoned_lease`.

**Still no HTTP surface.** No drain/claim/settle/sandbox route, no
`ROUTE_GROUPS` entry, no `permission_matrix.js` change, no vault read, no
provider SDK, no network I/O. Dual gate unchanged
(`backgroundEnabled()` **and** `INFOGENIE_CAMPAIGN_DELIVERY_WORKER === '1'`).
Default with the flag unset remains **no worker**.

### Governed outcome source

Before a `started` attempt is inserted, claim resolves an outcome:

1. test `opts.scenario` (in-process override), else
2. an unconsumed sandbox row for `(tenant_id, outbox_id)` locked
   `FOR UPDATE SKIP LOCKED`.

If neither exists: `{ skip: true, reason: 'no_outcome_source' }`, outbox
unchanged, **zero** attempt rows. Sandbox consume
(`consumed_at` + `consumed_attempt_id`) happens in the **same claim
transaction** after the attempt insert. Consumed rows are never reused.
`abandoned_lease` remains only for expired-lease crash recovery; a recovery
claim inserts a new `started` row only when a **new** unconsumed outcome (or
test scenario) is present.

Honesty: every sandbox row, fake-connector result, attempt ledger CHECK, and
audit detail keeps `source: 'sandbox'` (or `test_opts` for overrides),
`simulated: true`, `published: false`, `external_action_taken: false`,
`connector: 'fake'`. Audit event remains `campaign_delivery_attempt_simulated`.

Real provider mutation stays **PR 6F** and hard-denied.

## Advertising orchestrator — Meta provider-draft capability (PR 6F-0)

PR 6F-0 adds **contracts only**. It does not create a provider draft, call Meta,
read a token, refresh an OAuth grant, decrypt a vault row, enable a worker or
open a network socket. `isAdvertisingProviderMutationAllowed()` still returns
`false` and `assertAdvertisingProviderMutationAllowed` still denies every
provider write, with **no env escape hatch**. The PR #99 closure below is intact.

### The capability object

`services/security/advertising_provider_capabilities.js` defines the single
narrow exception path that a future execution worker will have to pass. The
capability is **not** a flag and **not** a payload — it is an object with six
properties that are all enforced in code:

1. **Unforgeable.** Identity is a module-private `WeakSet`. A structurally
   identical plain object, a JSON round-trip, an `Object.create(null)` look-alike,
   a `Proxy` wrapper and a spread of `process.env` are all rejected with
   `advertising_provider_capability_invalid`. There is no shape check that a
   caller can satisfy by construction.
2. **Frozen.** Null prototype, non-extensible, every field non-writable and
   non-configurable. `platform`, `operation`, `contract_version`, `object_kind`
   and `capability_version` are module constants, never caller-chosen.
3. **Single-use.** The first successful `assertMetaCreateProviderDraftCapability`
   marks the capability spent forever; a replay fails
   `advertising_provider_capability_spent`. A **failed** assertion does not spend
   it, so a mismatch cannot be used to burn a legitimate capability.
4. **Short-lived.** `CAPABILITY_TTL_MS = 60_000`, validated at mint (a longer or
   inverted lifetime is refused) and again at assert against a caller-supplied
   `now`. The boundary is closed: a capability is already expired at exactly
   `expires_at_ms`, not one millisecond after it.
5. **Exact-bound.** Every field in `BINDING_FIELDS` must match the locked
   execution context, with **no missing and no extra keys**: tenant, draft,
   revision, publish approval, workflow approval, publishing request, intent,
   outbox, attempt, generation, challenge, confirmation, credential reference id
   and version, account fingerprint, claim-token hash, intent hash, snapshot
   hash, contract hash, request hash, confirmation phrase digest, the confirming
   actor, and the issue/expiry timestamps. String comparison is timing-safe. An
   options bag cannot ride along, because an unknown key is a refusal rather than
   an ignored extra.
6. **Non-serializable.** `toJSON()` and `Symbol.toPrimitive` throw and inspection
   is redacted, so a capability **cannot** be written into the outbox payload, an
   audit row, a log line or an HTTP response even by accident.

### Where a capability can come from

Minting requires a live handle from
`withAdvertisingProviderExecutionTransaction(client, fn)`. That function proves
the connection is inside an explicit transaction with a `SAVEPOINT` probe —
Postgres raises `25P01` for a `SAVEPOINT` outside a transaction block, so an
autocommit connection, and therefore any HTTP handler that never opened a
transaction, cannot obtain a handle. The handle is registered in a module-private
`WeakMap` and **revoked when `fn` settles**, so a handle that escapes the scope
mints nothing. Minting and verification each repeat the authoritative
`SAVEPOINT` round-trip and compare `pg_current_xact_id()` against the transaction
identity captured when the scope opened. If callback code issues `COMMIT` or
`ROLLBACK`—even followed by a fresh `BEGIN` on the same client—a subsequent mint
or use fails closed while the in-memory callback scope is still active.

**PR 6F-0 has no mint site at all.** There is no execution worker and no provider
call, so `mintMetaCreateProviderDraftCapability` and
`withAdvertisingProviderExecutionTransaction` appear nowhere in product code —
`test/advertising-provider-capabilities.test.js` walks the repository and fails
if either name shows up outside the module, its test and this document. Neither
is re-exported from `services/security/index.js`; the broad index carries only
the read-only half (`isAdvertisingProviderCapability`, the error codes and the
platform/operation constants), so no `require('../security')` consumer gains the
mint path. `services/agent_orchestrator/*` does not reference the capability
module at all.

The lowest-level kill switch also **strips capability-branded values** out of
`denyAdvertisingProviderMutation` extras and the
`assertAdvertisingProviderMutationAllowed` context (via
`Symbol.for('infogenie.advertising_provider_capability')`, so the guard keeps
zero imports). A denial can therefore never serialize a capability into a 403
body or an error log.

### Tenant-owned Meta credential-reference boundary

`services/credentials/vault.js` gains a **reference** boundary, not a secret
boundary:

- `resolveTenantMetaCredentialRefForProviderDraft(client, { tenantId, ownerUserId })`
  is the confirmation-time binding: it locks the tenant-owned row `FOR UPDATE`
  and returns which reference a confirmation is bound to.
- `withTenantMetaCredentialForProviderDraft(client, { capability, lockedContext, now }, fn)`
  is the execution-time boundary. It verifies the capability **before** reading
  anything, then re-locks the row and matches the capability's credential
  binding.

Both validate the same predicates: `platform = 'meta'`, `status = 'active'`,
`revoked_at IS NULL`, `environment IN ('test','sandbox')` — **production ad
accounts are unreachable through this boundary** — a 64-hex account fingerprint,
a positive version, and an **active `tenant_users` membership** for the owning
user. More than one matching row is a denial (`validation_failed`), never a
"pick the first". The capability's single use is **not** spent here; spending
belongs to the execution assertion immediately before the provider call, which
PR 6F-0 does not have.

**No secret is read, decrypted, returned, transmitted or logged.** The boundary
reads `orchestrator_tenant_meta_credential_refs`, a metadata table with no
ciphertext, iv, tag, token or account-id column; it never touches
`user_integrations`, `platform_api_keys` or `kv_store`; and it never calls
`_decrypt`, `getCredentials` or `resolveMetaAdsCredentials`. The object it hands
`fn` carries `has_secret_access: false`, no account fingerprint and no token, and
refuses serialization for the same reason a capability does.

### Permission and matrix

`advertising.provider_drafts.create` is a new tenant-scope catalog key. It is
deliberately **not** an `orchestrator.workflows.*` key and **not** a `.view` key:

- Tenant Owner, Tenant Admin, Platform Owner and Platform Admin hold it.
- **Marketer does not.** Authoring and driving a workflow must never imply the
  authority to touch the ad account, the same separation-of-duty rule that keeps
  every `approve.*` gate away from Marketer.
- Analyst, Content Creator and Client Viewer never inherit it.

Two `ROUTE_GROUPS` rows carry it, one per mounted surface:

- `/api/agent-orchestrator/campaign-drafts/provider-draft-confirmation-challenge`
- `/api/agent-orchestrator/campaign-drafts/confirm-provider-draft`

Both rows set **`view` and `write` to the same key**, so every verb at the prefix
and at any depth beneath it requires `advertising.provider_drafts.create`.
Longest-prefix-wins means they shadow the coarse
`/api/agent-orchestrator/campaign-drafts` row rather than being shadowed by it.
Both surfaces are POST-only today, so `view` is unreachable; pinning it to the
same key means a GET added under either prefix later is denied to a Marketer by
default instead of silently inheriting the coarse workflow key. Relaxing `view`
is a deliberate review, not a default.

The handlers agree with the matrix: both `wrap()` on
`D.PERMISSION_PROVIDER_DRAFTS_CREATE`, so the middleware gate and the
handler gate name the same key and cannot drift apart.

Three gates therefore stack on this surface, and today the **narrowest is the
legacy owner gate**: `/api/agent-orchestrator/campaign-drafts` is deliberately
**not** in `_OWNER_GATE_ALLOW` in `server.js`, unlike `/workflows` and
`/credits`, so every non-owner is refused `owner_only` before the matrix is even
consulted. That is why a Marketer denial legitimately answers `owner_only`
rather than `permission_denied`.

Adding `/campaign-drafts` to `_OWNER_GATE_ALLOW` — for example to let a Tenant
Admin confirm without being the deployment owner — would make the matrix row and
the handler key the **sole** gate on a provider-touching action. That is a
security-relevant change to the enforcement stack, not a routing tweak, so
`test/advertising-provider-capabilities.test.js` asserts the exemption is absent
and will fail until the change is reviewed here.

**The matrix matches by prefix only, and that constrains the endpoint shape.**
An action segment placed *behind* a path parameter — for example
`…/campaign-drafts/<draftId>/publishing-requests/<id>/delivery-intents/<id>/confirm-provider-draft`
— matches no row of its own and silently falls back to the coarse
campaign-drafts row, i.e. `orchestrator.workflows.view`, which a Marketer holds.
That is a privilege regression, not a gap that a reviewer would notice in a
diff. So any provider-draft confirmation surface must either keep its action
segment **ahead** of the variable ids (as the two rows above do) or take a mount
prefix of its own.

Security deliberately did **not** add a regex/pattern stage to the matrix to
paper over this. A stage that runs ahead of prefix matching on every request is
new enforcement-path surface, it can be used to *widen* as easily as to narrow,
and it breaks the single "longest prefix wins" invariant that PR 6E's
`test/advertising-orchestrator-campaign-delivery-intents.test.js` locks. The
shape constraint is enforced instead:
`test/advertising-provider-capabilities.test.js` parses the route registrations
in `campaign_api.js` and fails if any provider-draft route hides its action
behind a path parameter, or if the literal prefix it does expose is not gated on
`advertising.provider_drafts.create`.

### Audit hygiene

`auditDetailForCapability` is an allowlist projection: object kind, capability
version, platform, operation, contract version, tenant, draft, publishing
request, intent, attempt, challenge, confirmation, revision, generation and the
confirming actor. **Credential reference id and version, account fingerprint,
claim-token hash, intent/snapshot/contract/request hashes, the confirmation
phrase and its salt/digest, and any payload or snapshot are all absent from it.**
The backend confirmation allowlist (`CONFIRM_AUDIT_DETAIL_KEYS`) is held to the
same list by test.

### What the caller may name, and what the server derives

The request surface names the human-visible chain **only**:

```
POST /api/agent-orchestrator/campaign-drafts/
       {provider-draft-confirmation-challenge,confirm-provider-draft}/
       :draftId/publishing-requests/:publishingRequestId/delivery-intents/:intentId
```

Everything the confirmation is bound to below that is derived inside the locked
graph, so the confirming human cannot choose it:

- **Outbox** — from `intent.outbox_id`, then locked.
- **Attempt** — from `latestAttemptForOutbox(tenant, outbox)` under `FOR UPDATE`,
  which takes the highest `attempt_number`. Nothing keyed on a caller-named
  attempt id survives; there is no `lockAttempt` call on this path. The derived
  attempt is still cross-checked against the named draft, publishing request and
  intent, and against `intent.outbox_id` / `intent.intent_hash`.
- **Attempt liveness** — the attempt must be `started`, not published, and its
  `lease_expires_at` must be in the future **judged on the database clock**
  (`SELECT clock_timestamp()` after the authoritative locks), not the app's or
  the transaction-start timestamp. A settled or lease-lapsed attempt fails
  `lease_conflict`. This is what stops a confirmation attaching to an attempt a
  worker has logically abandoned but `abandonExpiredLease` has not yet settled —
  which matters because nothing enforces a single `started` attempt per outbox
  (`idx_cda_active_lease` is not unique).
- **Credential reference** — from
  `vault.resolveTenantMetaCredentialRefForProviderDraft`, never a local
  `SELECT`. The confirmation path does not name
  `orchestrator_tenant_meta_credential_refs` at all, so revocation, ambiguity,
  environment, version, fingerprint and membership policy cannot drift away from
  the reviewed boundary above.
- **Actor** — re-derived from the bound approval (`boundActorId`) and re-checked
  for active membership; the request cannot assert who is confirming.

`challenge_id` is the one internal-looking id the caller does name, on the
confirm step. That is intended: the challenge is a short-lived artifact issued to
that same actor, and `confirmMatchesChallenge` binds it to the locked graph, so
naming it grants nothing.

Coverage: `test/advertising-provider-capabilities.test.js` (mint scope,
transaction probe, binding validation, freeze/serialization refusal,
forgery/clone/proxy refusal, per-field exact binding, single use, expiry, audit
projection, no-mint-site repository scan, index export surface, no
network/env/vault sink, the vault reference boundary and its refusal matrix, the
least-privilege permission, the exact matrix coverage on every verb, the
route-shape constraint, the exact set of accepted path parameters, the absence of
client-supplied capability/outbox/attempt/credential/account identifiers, and the
server-derivation and lease-liveness checks),
`test/advertising-provider-write-bypass.test.js`,
`test/advertising-provider-runner-denial-behavior.test.js`, and
`test/security-guardrails.test.js` for the claims in this section.

## Advertising provider-write bypass closure

Legacy live provider writes are hard-disabled. The centralized default-deny
guard lives at `services/security/advertising_provider_mutations.js` and is
re-exported from `services/security/index.js`. Every lowest-level mutation
helper (platform apply, bandit budget/bid mutate, creative refresh Meta/Google
mutates, Meta custom-audience create/upload) must call
`assertAdvertisingProviderMutationAllowed` / `denyAdvertisingProviderMutation`
**before** credential lookup, vault access, or network I/O. There is no env
escape hatch.

Hard-disabled HTTP surfaces (403, no vault, no outbound):

- `POST /api/launch/google-ads`
- `POST /api/launch/meta`
- `POST /api/launch/microsoft-ads`
- `POST /api/launch/tiktok`
- `POST /api/audiences/:id/sync-ads` (provider-writing branch)
- `POST /api/pixel-manager/capi/meta`
- `POST /api/pixel-manager/capi/linkedin`
- `POST /api/pixel-manager/capi/tiktok`
- Optimizer live-mode flips (`dryRun: false` on dry-run settings routes)

Lowest-level mutation helpers (including `sendMetaCapi`, `sendLinkedInCapi`,
`sendTikTokCapi`) call `assertAdvertisingProviderMutationAllowed` before any
credential use or `_httpsPost`. Local pixel configuration, status, reporting,
and other read-only pixel-manager routes stay available.

Preserved (not provider mutations): read-only ad insights/analysis, campaign
drafting and human approval, creative generation, guarded publishing requests,
PR 6C delivery intents and the PR 6D/6E fake delivery worker (both
`published: false`, `external_action_taken: false`, no vault read and no
outbound I/O), and request-only guarantees.

Coverage: `test/advertising-provider-write-bypass.test.js` (authenticated
session, `INFOGENIE_API_KEY`, manual HTTP routes, scheduled job/timer entry
points, and direct module import/call — all zero-network).

## Advertising orchestrator — Google Ads provider-operation ledger (PR10B.1)

`services/security/google_ads_provider_draft_operations.js` funds and settles a
metadata-only ledger row for one consumed PR10A Google Ads capability. It is a
substrate, not a delivery path: no Google SDK, no network client, no secret
resolution, no connector, no HTTP route, and no permission-matrix change.

- **Permission and session.** Reuses the PR10A `advertising.provider_drafts.create`
  grant and the same exact-human-session rule (no API key, worker, service or
  agent principal).
- **Authority.** `fund` spends the capability through PR10A `reserve` + `consume`,
  so tenant status, draft status and revision, approval revocation and expiry,
  actor lineage, credential version, account fingerprint, and both kill switches
  are revalidated inside the caller's transaction. The module never issues
  `BEGIN`/`COMMIT`; a savepoint keeps a duplicate-key race recoverable.
- **Credentials.** `vault.assertGoogleAdsProviderDraftCredentialRefMetadata` locks
  the tenant-owned reference row `FOR UPDATE` and matches tenant, owner, id,
  version and fingerprint. It reads no `user_integrations` row, decrypts nothing,
  and returns no customer id.
- **No mutation.** Rows are `published=FALSE`, `activated=FALSE`,
  `external_action_taken=FALSE` (database CHECK), and this PR may settle only
  `failed` / `unknown`. Claiming provider success is deferred to PR10B.2.
- **Hygiene.** The public projection carries no credential, account or session
  material; audit details are exactly `{operation_id, capability_id, status}`.

Coverage: `test/google-ads-provider-draft-operation-schema.test.js`,
`test/google-ads-provider-draft-operations-security.test.js`, and
`test/integration/google-ads-provider-draft-operations-postgres.test.js`
(registered in `scripts/run-advertising-certification.js`).

## Advertising orchestrator — Google Ads paused-draft secret boundary (PR10B.2a)

`vault.withGoogleAdsPausedDraftSecretScope` is the only place a Google Ads refresh token may be decrypted. It re-checks initiating-tenant membership, re-locks and re-matches the credential reference (tenant, owner, id, version, fingerprint, active, not revoked), locks `user_integrations` and requires the frozen `credential_version`, then decrypts immediately before the callback. The refresh-token→access-token exchange uses an **injected** transport against a boundary-pinned endpoint with a hard timeout and no retry, so the module has no network client of its own and never invokes the Ads provider. The customer id is verified by fingerprint only. Handles keep secrets non-enumerable, throw on serialization, redact inspection, memoize nothing, and stop answering once the scope closes.

`google_ads_provider_draft_operations.settle` may now claim `succeeded` / `provider_create_succeeded`, but only against a confirmed paused provider result echoing the operation's own `provider_operation_key` / `idempotency_key`, and only with a live DB-backed `advertising.provider_drafts.create` grant in the initiating tenant re-read immediately before the transition. The created PAUSED objects are written to the append-only, operation-linked `orchestrator_google_ads_provider_draft_objects` table (no UPDATE, no DELETE, `provider_status='PAUSED'`, `serving`/`published`/`activated` FALSE) in the same transaction as the `external_action_taken` flip. `failed` / `unknown` deliberately skip the DB grant check so a revoked membership cannot strand an `in_progress` row. No connector call, no `execute()`, no route, worker, scheduler or retry.

Coverage: `test/google-ads-paused-draft-secret-boundary.test.js` plus the PostgreSQL cases in `test/integration/google-ads-provider-draft-operations-postgres.test.js`.

## Advertising orchestrator — Google Ads paused-draft execution (PR10B.2b)

`google_ads_provider_draft_operations.execute` is the one guarded path that may
actually call the Google Ads paused-draft connector. It creates PAUSED,
non-serving draft objects only; it never enables, activates, publishes,
schedules, launches, optimizes or raises spend, and it has no route, worker,
scheduler or retry.

- **Ordering.** The PR10B.1 ledger row is funded and committed *before* anything
  can act; authority is re-proved inside the transaction that performs the call;
  the credential is decrypted only inside the PR10B.2a secret scope; the
  connector is invoked once; provider evidence is persisted before the
  settlement that may claim `external_action_taken`.
- **Reauthorization immediately before the call.** Tenant, actor, human session,
  draft revision, approval (including expiry), intent, account fingerprint,
  credential ref and version, the consumed capability and its TTL, active
  membership, the explicit `advertising.provider_drafts.create` grant, and both
  the tenant and global kill switches are re-read through the PR10A
  authoritative path. Its `FOR UPDATE` locks are held across the invocation and
  the settlement, so nothing can drift underneath the call.
- **The payload is the approved snapshot.** What the provider is asked to create
  is derived from the approval's `snapshot_json`, whose sha256 the authoritative
  path has just re-proved against this operation's `snapshot_hash`. A
  caller-supplied draft is only an early serving-shape rejection: it is not
  authority, and its name and budget never reach Google.
- **Secrets.** The sealed vault handle is forwarded to the connector, never
  unpacked: no token, client secret or raw customer id is named, copied,
  serialized, logged or persisted by this module, and the handle stops answering
  when the scope closes.
- **Idempotency and replay.** The stable `idempotency_key` /
  `provider_operation_key` label the single request. A duplicate delivery of a
  settled — or still in-flight — operation returns stored metadata and
  reacquires no authority, decrypts no secret, exchanges no token and calls no
  provider. A lineage mismatch is `operation_conflict`.
- **Outcomes.** Provider rejection settles `failed`. A timeout, an unparseable
  or oversized response, a bounded-deadline breach, or a settlement that cannot
  persist its evidence settles `unknown` with reconciliation required. Nothing
  retries automatically, and `succeeded` / `external_action_taken` still require
  a confirmed PAUSED creation plus a live DB-backed grant.
- **Transactions.** `fund`, `settle` and `get` keep their caller-owned
  transaction contract and now assert an open transaction (a savepoint probe)
  before touching the database, so a forgotten `BEGIN` cannot autocommit past a
  `FOR UPDATE` lock. Only `execute` opens transactions, and only because the
  provider call sits between the funding commit and the settlement.
- **Live Google is off by default.** Without an injected provider transport, the
  call requires both an explicit caller opt-in and the connector's
  `INFOGENIE_LIVE_GOOGLE_ADS_PAUSED_DRAFT=1` environment gate. The OAuth token
  transport is always injected; this module has no network client.

Coverage: `test/google-ads-provider-draft-operations-security.test.js` (mocked
pool: replay, live-off default, serving-shaped input, transaction assertion) and
`test/integration/google-ads-paused-draft-execution-postgres.test.js` (mocked
Google client against real PostgreSQL: authorization, revoked permission,
inactive membership, wrong tenant and actor, stale/expired capability, expired
approval, lineage mismatch, credential drift, both kill switches, duplicate and
in-flight requests, provider rejection, timeout, bounded deadline,
persist-before-success, serving-state prevention, and secret-leakage checks),
both registered in `scripts/run-advertising-certification.js`.

## Advertising orchestrator — Google Ads reconciliation reads (PR10C.1)

`services/security/google_ads_paused_draft_reconciliation.js` is read-only: it observes PAUSED objects PR10B.2b already created and never writes to the provider. One consume-once authorization binds one PR10B operation plus its three PAUSED objects; every stored binding is copied from the locked operation row, and the human session, active tenant, active membership and explicit `advertising.reconciliation.read` grant are re-proved from the database. `advertising.provider_drafts.create` is deliberately **not** required, and the create-side kill switches are deliberately **not** consulted — freezing new creations must not strand reconciliation of objects that already exist. Consumption commits in its own transaction before the PR10B.2a secret scope opens at the last responsible moment, so a provider or transport failure can never un-consume the grant; a replay of a consumed authorization returns metadata alone, with no secret scope, decryption, token exchange or network. The only reachable provider surface is the read-only GAQL Search observer (no mutate RPC, provider write, route, worker, scheduler, retry, runs table or review closure), the sealed vault handle never leaves the module, and audit details are exactly `{authorization_id, operation_id, status}`.

Coverage: `test/google-ads-paused-draft-reconciliation-security.test.js` and `test/integration/google-ads-paused-draft-reconciliation-postgres.test.js`, both registered in `scripts/run-advertising-certification.js`.

## Advertising orchestrator — durable Google Ads reconciliation runs (PR10C.2)

PR10C.2 persists one sanitized, tenant-scoped reconciliation run for a consumed PR10C.1 read authorization. Authorization consumption, initial `observing` state and audit evidence must commit atomically before credential scope or GAQL traffic; terminal state and terminal audit must also commit together. Replay is metadata-only, expired observation leases fail deterministically, and the slice adds no route, UI, worker, scheduler, retry, provider mutation or human-review flow.

## Advertising orchestrator — Google Ads reconciliation human review (PR10C.3)

PR10C.3 gives terminal PR10C.2 `discrepancy_detected` and `failed` runs a durable, tenant-scoped human-review case. The flow requires a real human session and the explicit tenant `advertising.reconciliation.review` grant, has no owner or platform-role bypass, copies immutable Google run lineage, and records idempotent optimistic-versioned decisions plus audit atomically. It exposes only sanitized classifications and bounded notes. It cannot read or write Google, open the credential vault, retry reconciliation, remediate, activate, publish, optimize, schedule work or start post-review re-reconciliation.


## Advertising orchestrator — Google Ads activation capability foundation (PR10D.1)

PR10D.1 may issue, reserve, revoke and consume one tenant-scoped authorization for one future human-triggered Google Ads activation attempt. Issuance requires a real human session, active tenant and membership, an explicit tenant `advertising.campaign.activate` grant, open kill switches, and authoritative revalidation of the approved draft, publishing, intent, PAUSED provider-object, reconciliation and closed-review lineage. The authorization is immutable, expiring, optimistic, consume-once and fully audited.

This foundation has no provider connector or Google API reachability. It must not mutate, enable, publish, schedule, optimize, change spend, decrypt credentials, open secret scope, start a worker, retry automatically, or activate anything. A later separately approved slice is required before any provider write can exist.

## Related existing systems

- Auth gate: `services/auth_gate/`
- Static allow-list: `services/static_guard/`
- Permission matrix: `services/tenants/permission_enforce.js`
- Credential vault: `services/credentials/vault.js`
- Advertising provider mutation guard: `services/security/advertising_provider_mutations.js`
- Advertising provider-draft capability: `services/security/advertising_provider_capabilities.js`
