# InfoGenie Platform — Phase 0 Foundations

The structural base of the InfoGenie multi-tenant marketing-intelligence OS,
built to the **Architecture & Guardrails v1.1** master reference. Phase 0 ships
only the properties that *cannot be retrofitted* — tenant isolation, identity &
access, consent, the audit rail, secrets hygiene and CI — so every capability
above it (the LLM gateway, guardrail gate, autonomy ladder, and the nine product
domains) is built on solid ground.

> Reference stack, realised here: **Node.js + Express modular monolith,
> TypeScript, PostgreSQL with row-level security.** The legacy vanilla-JS
> dashboard in the repo root is the migration source, not part of this package.

## Why Phase 0 first

*"The most expensive mistake available in this category is to build capability
first and controls afterwards."* Tenancy isolation, consent and audit retrofitted
into a live product each cost an order of magnitude more later — and one of them
can end the business. So they come first, and nothing advances without the
[Phase 0 readiness checklist](docs/PHASE_0_READINESS.md) passing.

## What's in it

| Area | Where | Enforced by |
|---|---|---|
| **Tenant isolation** (agency → client) | `db/migrations/0002_tenancy.sql` | Row-level security at the DB (`FORCE`), tenant context set once per transaction (`src/db/tenantContext.ts`) |
| **Identity & access** (RBAC, SSO/MFA state, JIT elevation) | `0003_identity.sql`, `src/modules/identity/*` | `role_permissions`; support has no standing access — only time-boxed, audited JIT grants |
| **Consent & suppression** (per person/channel/purpose) | `0004_consent.sql`, `src/modules/consent/*` | Reachability resolved at send time; hierarchical + global suppression |
| **Audit rail** (append-only, tamper-evident) | `0005_audit.sql`, `src/modules/audit/*` | In-DB per-tenant hash chain; `UPDATE`/`DELETE` blocked |
| **Data-subject erasure** (end to end) | `src/modules/dsr/deletion.ts` | Clears PII, drops consent, retains one-way suppression tombstone, audits |
| **Engineering platform** | `.github/workflows/platform-ci.yml` | Typecheck, lint, `npm audit`, full-history secret scan, gate suite on Postgres |

## Run it

```bash
cd platform
npm install
docker compose up -d db          # Postgres 16 on :5433 (or bring your own)
cp .env.example .env             # then edit if needed
npm run migrate                  # apply migrations (creates the app role + schema)
npm test                         # the Phase 0 gate suite (RLS, audit, consent, DSR)
npm run dev                      # start the API on :4000
```

Every model of trust in this package is backed by an executable test — `npm test`
is the evidence that the isolation, audit, consent and erasure gates actually
hold, not just that the code compiles.

## Two db roles, on purpose

- `infogenie_app` — least-privilege, **RLS is enforced against it**; the only role
  the request path uses.
- the admin/migration role — privileged, bypasses RLS; used **only** for
  migrations and bootstrap, never to serve a request.

This split is why "cross-tenant read fails at the database" is true by
construction and not by careful coding.

## Not here yet (later phases)

The LLM gateway, the governed-action gate, the autonomy ladder and the capability
surface are Phases 2–4. They attach to these foundations; they do not replace
them.
