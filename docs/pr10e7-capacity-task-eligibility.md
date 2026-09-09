# PR10E.7 — Capacity Task Eligibility Fix

Paul approved this correction after the human merge of PR #152. Base:
`27102af2f5ef72194dc2ab9ed8d0de30a7e21a64`.

The capacity queue and count include tasks whose goals are archived, even though
the assignment endpoint rejects them. Align these reads with the existing
assignment eligibility rules.

## Scope and acceptance

- Include tasks only when their goal is active and their state is `pending`,
  `open` or `in_progress`, matching the existing assignment write check.
- Apply the same eligibility to the workload list and its uncapped task count;
  recommendations inherit the filtered workload. Preserve list ordering and its
  100-row limit, and keep total counts accurate above that limit.
- Retain both task and goal tenant predicates with the authenticated tenant.
  Keep current assignment locks, duplicate guards, permissions and write limits.
- Qualify the assignment due-date sort column so PostgreSQL can distinguish it
  from the formatted output column with the same name; preserve date ordering.
- Cover active and archived goals, allowed and rejected task states, cross-tenant
  task/goal relationships, counts beyond the list limit and archive-after-read
  rejection. Execute regression queries against PostgreSQL in CI.

## Boundaries and verification

No schema, UI, permission-grant, assignment execution or provider changes.
Existing capacity assignments retain their current accounting and lifecycle.
The correction does not promise atomicity between a summary read and a later
assignment; the existing write-time check remains authoritative.

Backend owns the API correction and regression tests. Security reviews tenant
and authorization preservation separately; QA runs independent targeted/core
checks; Reviewer assesses the complete frozen SHA after QA. Lead owns this
scope document and CI wiring. All technical gates and CI must agree on the same
SHA. The PR stays draft and unmerged for Paul's human decision.
