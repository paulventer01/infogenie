# PR10D.4 — Human review for Google Ads post-activation discrepancies

## Frozen scope

PR10D.4 creates one durable, tenant-scoped human review case when a completed
PR10D.3 real-provider reconciliation still reports `discrepancy_detected`.
It records an operational disposition without changing the immutable PR10D.3
evidence or reaching Google Ads.

## Required behavior

- Require an authenticated real human session, active tenant and membership,
  and the explicit tenant `advertising.reconciliation.review` grant. API keys,
  owners, admins, platform roles, services, workers, automations and agents get
  no implicit bypass.
- Accept only a server-issued PR10D.3 reconciliation-run ID. The source run
  must be terminal `discrepancy_detected`, have a completion timestamp, contain
  the complete three-object observation, and retain at least one bounded
  discrepancy classification. Failed or verified runs are ineligible.
- Persist one review case per logical discrepancy. Enforce tenant-leading
  uniqueness for both the source run and activation attempt, and return the
  existing case on identical retries or concurrent creation.
- Copy only sanitized internal identity, intended state, observed status and
  relationship classifications, source timestamps and audit metadata. Never
  copy or expose provider customer/object IDs, credential references,
  fingerprints, tokens, URLs, queries, payloads, raw responses or raw errors.
- Default every case to `open`. Permit only explicit human transitions:
  `open -> acknowledged|escalated`, `acknowledged -> escalated|closed`, and
  `escalated -> closed`.
- Require a bounded decision ID, optimistic version, approved disposition and
  sanitized non-empty note for every transition. Duplicate decisions with the
  exact payload replay metadata; changed payloads fail closed.
- Persist the case change, append-only decision event and audit event in one
  transaction. A failed event or audit write must roll back the decision.
- Keep source lineage and initial evidence immutable, prevent deletion, and
  enforce deferred case/event/audit consistency in PostgreSQL.
- Expose narrow, rate-limited create, list, get, acknowledge, escalate and
  close endpoints. All output is sanitized and states
  `external_action_taken: false`.
- Add focused security/unit tests and real PostgreSQL integration tests to the
  advertising certification runner. PostgreSQL and certification must report
  zero skips.

## Hard boundaries

No Google endpoint, SDK, connector, OAuth, vault, secret scope, provider read or
write, mutate call, campaign-budget change, activation, optimization,
remediation, retry, queue, worker, scheduler, background trigger, automatic
approval, automatic closure, UI, arbitrary campaign discovery, Meta change, or
redesign of PR10D.1–PR10D.3.

Keep the complete PR at or below 1,500 changed lines. Do not weaken tests. Keep
the PR draft. Agents do not merge.
