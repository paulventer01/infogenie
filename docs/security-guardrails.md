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
was added to `KNOWN_GLOBAL` or `NULLABLE_OK`.

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
  `seedPlaybooks` can never seed that vertical; and any `active_playbooks` row
  written by the old activate path still pairs a tenant with a foreign playbook,
  which `/active/list` joins without re-checking ownership. New leaks are
  prevented; existing pairings are not swept. A remediation pass should stamp or
  delete unowned `is_system=FALSE` rows and drop `active_playbooks` rows whose
  playbook is neither shared catalog nor owned by that tenant.
- **`benchmark_aggregates` publishes small-sample buckets.** With
  `sample_count = 1` the p25/median/p75 for a `(vertical, region, company_size,
  metric_key)` bucket *is* the single contributing workspace's exact submitted
  value, re-served to every other workspace through `POST /compare` and
  `GET /leaderboard`. A tenant submitting into a rare bucket therefore discloses
  a precise business metric, which is not what "anonymised percentiles" promises.
  The global classification is still right; the aggregation needs a k-anonymity
  floor. Recommended for Backend as a follow-up, and deliberately not folded into
  this review: suppress or refuse to publish buckets below a minimum
  `sample_count` (5 is the usual floor), and prefer widening to the
  vertical-level bucket over emitting a one-sample "benchmark".
  `GET /leaderboard` additionally resolves no tenant at all; it is
  matrix-gated on `compete.intel.view`, which is the intended control.
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

Two items found during the re-review that are **not** isolation defects, recorded
so they are not mistaken for tenancy bugs later:

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

## Related existing systems

- Auth gate: `services/auth_gate/`
- Static allow-list: `services/static_guard/`
- Permission matrix: `services/tenants/permission_enforce.js`
- Credential vault: `services/credentials/vault.js`
