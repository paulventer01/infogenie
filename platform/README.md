# InfoGenie Platform — Foundations & the Governed Spine

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

## The governed spine (Phases 1–2)

On top of Phase 0 sits the spine every feature in the Feature & Integration
Reference registers on — so the 130-feature surface is a scale loop, not 130
bespoke builds:

| Piece | Where | What it enforces |
|---|---|---|
| **Brand Foundation** (Block 2) | `0006_brand_context.sql`, `src/modules/brand/` | Versioned, auditable brand context. Generation without it is **blocked** — there is no ungrounded path. |
| **LLM gateway** (Block 3, hardest-to-reverse #7) | `src/gateway/llmGateway.ts` | The *sole* path to model providers: prompt-injection screening, PII redaction, per-tenant cost metering, model routing, mock fallback. Enforced by an ESLint `no-restricted-imports` rule (CI fails if any other module imports a provider SDK); production adds network policy. |
| **Guardrail gate** (§5.6) | `src/gate/guardrailGate.ts` | Seven checks in sequence — brand context, prohibited terms, legal/claims (never auto-corrected), PII leakage, consent/suppression, autonomy ceiling, reversibility. Human-readable reasons; **fails closed**. |
| **Autonomy ladder** (§7.2) | `capabilities` + `tenant_capability_autonomy` | Per capability × per tenant. Entry at A1; A0–A2 queue for human approval; A3 executes within bounds; **irreversible actions never exceed A2** regardless of configuration. |
| **Capability registry + runner** (Block 5, Appendix A) | `src/modules/capabilities/runner.ts` | One governed execution path: context → gateway → gate → action record → audit, atomically. Registering a feature = a registry row + a prompt template + a call into the runner. |

### Governed API surface

```
PUT  /api/brand                       save a new Brand Foundation version (tenant:admin)
POST /api/capabilities/:key/run       run a governed capability (gate + autonomy applied)
POST /api/actions/:id/approve         approve a pending action (send:approve)
GET  /api/actions                     approval queue + action history with gate verdicts
```

## Not here yet (later phases)

Live channel adapters (send/publish/bid), the coordinator agent and domain
specialists, predictions/benchmarks, and white-label surfaces are Phases 3–5.
They attach to this spine — every one of them will execute through the runner,
the gateway and the gate.
