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
| `plaintext_excerpt` | `transcript_excerpt` still non-NULL |
| `plaintext_summary` | non-empty `summary` JSONB with no `summary_ciphertext` |
| `email_generated_by` | `generated_by` still looks like an address |
| `contact_non_object` | array / scalar `contact` |
| `contact_extra_keys` | any key outside `{name, company, role}` |
| `contact_non_string` | an allowed key holding a non-string |
| `contact_too_long` | an allowed value past 200 characters |
| `partial_excerpt_crypto` | 1–2 of ciphertext/IV/tag NULL |
| `partial_summary_crypto` | 1–2 of ciphertext/IV/tag NULL |
| `verify_query` | the tenant's verification query itself failed |

The two `partial_*_crypto` arms are defence in depth: the
`meeting_notes_runs_{excerpt,summary}_crypto_check` CHECK constraints already
reject a half-written crypto triple at write time, but those `ALTER`s are wrapped
in try/catch so an older database can boot without them.

Success requires **zero** row errors and **zero** non-compliant rows. Anything
else is a failure:

- **Production** — `backfillMeetingNotesEncryption()` throws a counts-only error
  and the `server.js` boot task calls `process.exit(1)`. The same is true of the
  retention sweep. A production instance therefore cannot serve traffic while
  known plaintext or extra PII remains.
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
  material written without a TTL would never expire. Both `/summarize` insert
  branches and the backfill set the column, so no such row exists today — any new
  write path must keep setting it.
- Verification flags a non-NULL `transcript_excerpt` even when ciphertext is also
  present, but the backfill's select predicate only picks up plaintext with *no*
  ciphertext. That state is unreachable from the application (the backfill and
  sweep both write the excerpt columns in a single statement, and both insert
  branches write `transcript_excerpt = NULL`); if it were ever produced by hand,
  production would refuse to boot rather than self-heal.

## Related existing systems

- Auth gate: `services/auth_gate/`
- Static allow-list: `services/static_guard/`
- Permission matrix: `services/tenants/permission_enforce.js`
- Credential vault: `services/credentials/vault.js`
