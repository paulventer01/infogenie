# PR10D.5 — Google Ads post-review re-reconciliation

## Outcome

Allow one real human with the tenant-scoped `advertising.reconciliation.review`
grant to request one read-only Google Ads observation after a PR10D.4 case has
been explicitly closed as `external_remediation_required`.

## Required lineage

The request must bind, under database locks, to:

1. the exact closed PR10D.4 review case and its current version;
2. the exact append-only closure event carrying
   `external_remediation_required`;
3. the exact immutable PR10D.3 discrepancy run copied into that case;
4. the original terminal PR10D.2 activation attempt and its complete authority,
   operation, credential, object-ledger, tenant and permission proof.

Any changed, missing, ambiguous or cross-tenant lineage fails closed.

## Provider boundary

PR10D.5 reuses the existing PR10D.3 secret scope and allowlisted GAQL-only
observer. It constructs no caller-supplied query and exposes no generic proxy.
The provider surface has no mutate operation. There is no automatic retry,
remediation, activation, optimization, queue, worker or scheduler.

## Human authority and idempotency

The route accepts exactly `{"invocation_id":"..."}`. API keys, service
principals, workers and agents are rejected. The invocation is bound to the
review case, human user and session. At most one attempt may exist per review
case and replays return stored, sanitized metadata without opening secrets or
contacting Google again.

The observing attempt and audit event commit before credential access. A
terminal result and its audit event commit atomically. An abandoned attempt is
durably failed and cannot be retried.

## Durable output

The attempt table stores internal references, normalized observations,
classifications and timestamps only. It excludes customer and provider object
identifiers, credential references, fingerprints, queries, URLs, tokens, raw
requests, raw responses and raw errors. Every response declares
`external_action_taken: false`.

## Explicitly out of scope

- Google Ads writes or automatic remediation
- repeated polling or retry
- approval, activation, optimization or spend changes
- UI, background jobs, queues, schedulers and webhooks
- Meta or any provider other than the bound Google Ads observer
