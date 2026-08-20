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
- `landing_page_url` is validated as `https:`, credential-free and ≤2048 chars,
  but is **not** screened against private, loopback or link-local hosts. Nothing
  dereferences it in PR 1 — the runner is a stub — so there is no SSRF sink yet.
  A host denylist is required **before** any agent fetches that URL.
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

## Related existing systems

- Auth gate: `services/auth_gate/`
- Static allow-list: `services/static_guard/`
- Permission matrix: `services/tenants/permission_enforce.js`
- Credential vault: `services/credentials/vault.js`
