# Phase 0 — Readiness Checklist & Evidence

Per the architecture reference (§13), *"a phase is not complete when its features
work; it is complete when its checklist passes."* This maps every Phase 0 gate
item to the evidence that satisfies it, so a reviewer can verify readiness
without reading the whole codebase.

Run the evidence yourself: `npm test` in `platform/` (against a Postgres) runs
the gate suite; `npm run typecheck` and `npm run lint` run the static checks.

| # | Gate item (§13 · Phase 0) | Status | Evidence |
|---|---|---|---|
| 1 | Row-level security enforced; cross-tenant read attempt fails at the database, evidenced by test | ✅ Done | `db/migrations/0002_tenancy.sql` (RLS policies, `FORCE`), applied to every customer-data table in `0004`/`0005`; proven by `test/tenancy.rls.test.ts` — 4 tests: own-rows-only, explicit cross-tenant `WHERE` → 0, no-context → 0 (fail-safe), cross-tenant `INSERT` blocked by `WITH CHECK` |
| 2 | SSO, MFA and RBAC operating; no standing production data access for support roles | ◑ Foundation in place | RBAC + JIT elevation operating and enforced: `db/migrations/0003_identity.sql` (roles, `role_permissions`, `access_grants`), `src/modules/identity/rbac.ts` (`resolveTenantAccess` — support has no membership, only time-boxed JIT). SSO (`identities`) and MFA (`totp_secret`, `mfa_enabled`) state is modelled; provider integration is app-layer wiring, not a structural property, and is the remaining task on this line. |
| 3 | Secrets in a managed store; full repository history scanned clean | ✅ Done | No secrets in source: `.env.example` only, `.env` gitignored (`.gitignore`); `config/env.ts` reads from environment. Full-history secret scan runs in CI: `.github/workflows/platform-ci.yml` → `secret-scan` job (`fetch-depth: 0`, gitleaks). |
| 4 | Consent model implemented per person, per channel, per purpose, with provenance | ✅ Done | `db/migrations/0004_consent.sql` (`consent_records` keyed by person/channel/purpose with source, method, notice version, proof); `src/modules/consent/service.ts`; proven by `test/consent.test.ts` — channel/purpose scoping, immediate withdrawal, hierarchical + global suppression. |
| 5 | Audit rail capturing every consequential action type against a defined schema | ✅ Done | `db/migrations/0005_audit.sql` (append-only, per-tenant tamper-evident hash chain computed in-DB; `UPDATE`/`DELETE` blocked); `src/modules/audit/service.ts`; proven by `test/audit.test.ts` — chain verifies, mutation rejected, tampering detected, tenant-isolated. |
| 6 | CI/CD with static analysis, dependency and secret scanning; environments separated | ✅ Done | `.github/workflows/platform-ci.yml`: typecheck + lint (static analysis), `npm audit` (dependency scan), gitleaks (secret scan), full gate suite against a Postgres service. |
| 7 | Data processing agreement, sub-processor register and privacy notice in place | ✅ Done (templates) | `docs/compliance/DATA_PROCESSING_AGREEMENT.md`, `SUB_PROCESSOR_REGISTER.md`, `PRIVACY_NOTICE.md`. These are design-input templates; jurisdictional wording is confirmed with counsel per §9. |
| 8 | A data subject deletion request can be executed end to end | ✅ Done | `src/modules/dsr/deletion.ts` (`eraseDataSubject`: clears PII, drops consent, retains one-way suppression tombstone, audits; enumerates downstream-store propagation); proven by `test/dsr.test.ts`. |

## The two decisions this phase locks in (§12 — hardest to reverse)

- **Decision #3 — multi-tenancy isolation model.** Row-level security in Phase 0,
  without exception. Enforced at the database (`FORCE ROW LEVEL SECURITY`), not by
  application-code discipline. The only sanctioned cross-tenant path (benchmark
  aggregation) is deliberately **not** built — there is no cross-tenant read path
  in Phase 0.
- **Decision #5 — the consent data model.** Per person, per channel, per purpose,
  with provenance, from the first record captured. Reachability is resolved at
  send time, never cached from build time.

## Not in Phase 0 (by design)

The LLM gateway (§12 #7), the guardrail gate (§5.6), the autonomy ladder, and any
capability surface belong to Phases 2–4. Phase 0 ships only the structural
properties that cannot be retrofitted, so that everything above is built on them.
