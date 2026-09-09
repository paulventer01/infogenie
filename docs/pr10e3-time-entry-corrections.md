# PR10E.3 — Time Entry & Corrections

## Approved scope

Paul approved this follow-on after PR #148 merged into `main` at
`d00eebb97b3bf29ff7197d1279f5881e9c8f24f5`.

- A React manager panel using the existing agency time-entry list/create/update APIs.
- Explicit date, client-reference and capacity-member filters; no misleading totals
  from the list API's 500-entry cap.
- Add/correct a roster member's client, project, work item, date, hours, billable
  status and notes. No implicit writes, automatic retries, or duplicate submits.
- Require the existing billing and project-read permissions to load the panel;
  project-edit permission additionally gates writes. Server authorization remains
  authoritative. Tenant identity comes from the authenticated session, not the form.
- Preserve unsaved inputs on failure, distinguish saved-but-refresh-failed from
  failed saves, and reject stale list responses. Dashboard reads persisted values
  when revisited.
- Reuse navigation, migrated-view registry and API helpers; no new backend contracts.

## Acceptance and verification

Behavioral tests cover list and filter reads, explicit create/correct requests,
permission denial, validation, server/transport errors, duplicate-submit prevention,
stale responses, empty states and honest limited results. Security verifies the
unchanged API enforcement and the new component permission mapping. QA runs the
targeted tests and core gate; independent Reviewer assesses the final frozen SHA.
CI and all verdicts must agree on that SHA before requesting human approval.

## Boundaries

Maximum 1,500 changed lines including tests. No rates or scope-baseline editing,
invoicing, payments, autonomous time tracking, publishing, schema changes, role
expansion or changes to existing API authorization. No production-data smoke-test
writes. The dashboard itself remains read-only. This PR remains draft and unmerged;
only Paul may approve/merge it. Follow-up scope requires a separate decision.
