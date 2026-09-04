# PR10C.4 — Human-authorized Google Ads post-review re-reconciliation

## Scope

Add one human-authorized, read-only Google Ads re-reconciliation attempt after a PR10C.3 review case is closed as `external_remediation_required`.

Use `meta_post_review_rereconciliation.js` and its PostgreSQL/tests as the behavioral reference, adapted to the Google Ads PR10C.1–PR10C.3 lineage and fixed object kinds: `campaign_budget`, `campaign`, and `ad_group`. Keep Meta and Google persistence and behavior separate.

## Required precondition corrections

Correct the three genuine P2 findings reported after PR #133 merged:

- reject raw ten-digit Google customer IDs in review notes, including formatted variants;
- bind idempotent decision replay to the complete original payload and reject conflicting reuse;
- enforce deferred PostgreSQL consistency among review-case state/version, append-only decision event, and audit evidence.

Add regression coverage for each correction before building re-reconciliation on the review ledger.

## Required behavior

- Require a real authenticated human session, the active tenant, active membership, and the explicit tenant `advertising.reconciliation.review` grant at invocation.
- Accept only a closed Google review case whose closure classification is `external_remediation_required`, with exactly one matching closure event.
- Re-prove the complete immutable PR10C.1–PR10C.3 lineage and current credential metadata before creating any new authority or run.
- Permit at most one post-review attempt per review case. Make retries metadata-only and reject conflicting invocation reuse.
- In one transaction, create a consume-once `post_review` read authorization, consume it into a new durable `observing` run, persist the attempt and append audit evidence.
- Commit that transaction before opening the existing scoped credential boundary or making Google Ads traffic.
- Perform only the existing internally generated, ledger-bound GAQL Search reads for the three fixed object kinds.
- Persist only sanitized observations and terminal classifications; commit terminal run state and audit atomically.
- Fail closed on credential, lineage, transport, malformed-result, timeout, lease, concurrency, or permission errors. Never retry automatically.
- Return only a strict safe projection without secrets, customer IDs, provider object IDs, account fingerprints, URLs, tokens, session material, or raw provider payloads.
- Add a rate-limited Google-specific human route only if needed, preserving the existing tenant and permission middleware.

## Hard boundaries

No Google Ads mutate RPC, provider write, automatic remediation, provider-draft creation, enablement, activation, publication, optimization, spend change, worker, scheduler, retry loop, background trigger, UI, or Meta behavior change except shared schema boot compatibility.

Keep the complete PR at or below 1,500 changed lines. Do not weaken tests. Keep the PR draft. Agents do not merge.

## Verification

- Focused unit/security tests for authorization, eligibility, lineage, payload-bound idempotency, metadata-only replay, no-write reachability, safe projection, and failure handling.
- Real PostgreSQL tests with zero skips for tenant isolation, one-attempt concurrency, deferred review-ledger consistency, atomic authorization/run/attempt/audit creation, rollback, immutable lineage, and terminal audit atomicity.
- Advertising certification with zero skips.
- `npm run test:core`.
- `node --check` on changed JavaScript, secret scan, and `git diff --check`.
- Independent security, QA, and final review on the frozen head.
