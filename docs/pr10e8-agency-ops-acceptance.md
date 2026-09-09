# PR10E.8 — Agency Operations Integration & Acceptance Tests

Paul approved this slice after PR #153 was human-merged into main at
`12e9d8e871d1524057d8aa771aa6416eac21150f`.

## Scope and acceptance

- Exercise the actual Express application through the existing `bootApp`
  harness, real login cookies, tenant memberships and permission middleware.
  Do not replace tenant resolution or inject a successful authorization result.
- Create a team member, rate card, scope/budget baseline and time entry through
  the existing APIs. Verify the resulting agency dashboard data and capacity
  summary against explicit expected amounts.
- Correct time entries and verify changed costs, billable value, margin and
  scope signals. Check missing pricing and mixed-currency handling without
  presenting unavailable figures as valid totals.
- Check assignment allocation separately from logged time, preserving existing
  capacity semantics and explicit human-controlled assignment creation.
- Verify unauthenticated and insufficient-permission denials, non-owner access
  where permitted, tenant isolation and rejection of foreign identifiers or
  client-supplied tenant overrides. Rejected writes must leave data unchanged.
- Run the connected workflow against a disposable PostgreSQL 16 database in CI
  with TLS enabled, required database configuration and zero skipped tests.
  Restrict the acceptance suite to an explicitly configured test database;
  never fall back to an ambient application database.

## Boundaries and verification

At most 1,500 changed lines, including tests and CI. Reuse production schemas,
routes, role grants and the existing test harness. Fix only demonstrated blockers
within this connected workflow, with the appropriate specialist owning each fix.
No new business features, UI redesign, provider calls, production-data writes,
automatic assignments, invoices, payments or deployment changes.

These are HTTP/API integration tests, not browser automation. Existing component
tests continue to cover rendering and interaction. Report the distinction and
identify whether each database result ran locally or in native PostgreSQL CI.

Backend owns workflow acceptance tests; Security assesses isolation and access
controls separately from day one. Lead owns scope and CI. Independent QA checks
the complete frozen SHA; a separate read-only Reviewer follows QA. All verdicts
and CI must agree on the same SHA. Keep the PR draft and unmerged for Paul's
human review and merge decision.
