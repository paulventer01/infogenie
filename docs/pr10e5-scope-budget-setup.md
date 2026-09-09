# PR10E.5 — Scope & Budget Setup UI

## Approved scope

Paul approved this slice after the human merge of PR #150. Base:
`2c4388e2feddca900ef804e7f4b3c788c4beeb05`.

- React manager panel to list active scope baselines overlapping a chosen period,
  optionally filtered by exact client reference, using the existing agency API.
- Create an active baseline with client reference, optional project reference,
  name, period, contracted hours, additional change hours, contracted value and
  currency. Numeric fields are explicit; blank input is not silently zero.
- Client and project references match those used by time entries. A blank project
  reference applies to all of that client's projects. Contracted value describes
  the agreement; it is not an advertising spend limit.
- Explain that overlapping baselines count work independently and are not
  automatic replacements. The API exposes active baselines only, and a period
  filter selects overlapping baselines rather than prorating their budgets.
- Reuse billing/project access controls and bind sensitive state to both the
  authenticated user and active tenant. Project-edit additionally gates saves.
- Explicit saves, duplicate-submit protection, retained drafts on uncertain
  failures, stale-response guards and a distinct saved-but-refresh-failed state.
- Display currency per baseline; do not combine currencies or invent totals.
- Return scope period dates as calendar strings from SQL, avoiding a server
  timezone shift when PostgreSQL DATE values are serialized for the screen.

## Acceptance

Behavioral tests verify date/client filtering, creation, real calendar dates,
numeric bounds and precision, required fields, raw PostgreSQL date/numeric response
normalization, read-only access, identity changes, permission loss, stale responses,
empty/error states, duplicate submissions and uncertain save outcomes.
Security verifies actual route permission enforcement and tenant-scoped SQL.

QA runs the combined focused tests and core gate on the frozen SHA. Independent
Reviewer follows QA. Security, QA, Reviewer and CI must agree on that exact SHA
before the human handoff. Agents keep the PR draft and never approve or merge it.

## Boundaries

At most 1,500 changed lines including tests. Existing API routes, schema and backend
permission grants remain authoritative; only scope date serialization is corrected.
No editing/deleting saved baselines,
inactive-record management, automatic versions, invoice/payment operations,
advertising budget changes, new providers or production-data smoke writes.
Unchanged baseline build/type failures remain outside this slice and are reported
separately from introduced errors. Mocked tests do not prove live integration.
