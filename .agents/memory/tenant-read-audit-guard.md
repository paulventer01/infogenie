---
name: Tenant read-audit static guard
description: How test/tenant-read-audit.test.js judges unscoped reads, its allowlist key format, and its deliberate blind spot.
---

# Tenant read-audit static guard

`test/tenant-read-audit.test.js` statically flags SELECT/JOIN/UPDATE/DELETE on a
tenant-scoped table (set derived from `phase2_migrate.js` PLAIN_TABLES +
REWRITE_UNIQUE) whose statement lacks a `tenant_id` filter.

**Judgement is per-FUNCTION, not per-statement.** A statement is cleared if EITHER
the statement text contains `tenant_id` OR its enclosing function mentions any
tenant token (`tenant_id|resolveTenantId|getCronTenantId|getDefaultTenantId|ForTenant|_tid`).
This suppresses the dominant safe pattern (resolve tenant + verify parent
ownership, then query child by parent id).

**Deliberate blind spot:** because leniency is function-wide, one forgotten
`tenant_id` inside an otherwise tenant-aware function is NOT caught here. That gap
is intended to be covered by runtime per-feature isolation tests
(`test/*-isolation*.test.js`).

**Why:** statement-only detection drowned in false positives from the
parent-ownership pattern; function-context leniency was the trade that kept signal
high without per-route annotations.

**Allowlist** (genuinely cross-tenant reads — crons, scoped-at-creation workers,
public embeds, provider webhooks) is keyed by
`relpath + ' :: ' + normalize(statement).slice(0,160)` where normalize =
flatten `${...}`→`${}`, collapse whitespace, trim. A stale-entry test requires each
key to still match a live offender, so the allowlist can't rot into a blanket bypass.

**How to apply:** when this test fails, either add a `tenant_id` filter +
`resolveTenantId(req,{label})` to the handler, or — only if the read is truly
cross-tenant — add the exact key to ALLOWLIST with a documented reason. The
function-context engine (forward brace-stack distinguishing function bodies from
if/for/catch/object blocks) lives inline in the test; the same logic is duplicated
in the stale-entry test.
