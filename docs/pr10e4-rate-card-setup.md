# PR10E.4 — Rate Card Setup UI

## Approved scope

Paul approved this slice after the human merge of PR #149. Base:
`5c25a2e873c0fdcde18bb116cf10c3d5c865d498`.

- React manager panel to view and filter persisted rates by capacity member or
  exact role, and add rates through the existing agency-operations GET/POST APIs.
- Explicit member-or-role scope, hourly cost, billing rate, currency, effective
  start date and optional end date. Writable date defaults use the local calendar.
- New dated records preserve existing rows. The server determines effective
  pricing: member before role, then most recent effective date in the same scope.
- Reuse existing tenant billing/project permissions; project-edit additionally
  gates writes. Authenticated user and tenant identity must both remain consistent
  before loading sensitive data or submitting. The server remains authoritative.
- Explicit saves, duplicate-submit prevention, retained drafts on transient
  failures, stale-response protection and distinct saved-but-refresh-failed state.
- Display each rate's currency and disclose the 500-row list limit; no invented
  aggregate totals, exchange conversion or claimed complete pricing coverage.

## Acceptance

Behavioral tests cover list/filter reads, member/role submissions, amounts, dates,
currencies, read/write permissions, user/tenant changes, auth loss, stale responses,
duplicate submission, empty/error states and uncertain save outcomes. Security
verifies route enforcement and tenant-scoped reads/writes. Any reused context/date
helper corrections include regression coverage for existing consumers.

QA runs focused tests and the core gate. Independent Reviewer assesses the frozen
SHA after QA. Security, QA, Reviewer and CI must agree on that SHA before human
handoff; agents keep the PR draft and do not approve or merge.

## Boundaries

At most 1,500 changed lines including tests. Existing API contracts, schemas and
role grants stay in place. No rate deletion, PATCH editing, default-rate creation,
scope/budget editor, invoices, payments, automatic retries or provider actions.
No production-data smoke writes. Unchanged baseline build/type errors remain
outside this slice; verification reports distinguish them from introduced errors.
