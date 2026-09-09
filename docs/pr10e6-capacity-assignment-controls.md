# PR10E.6 — Team Capacity & Assignment Controls

Paul approved this slice after PR #151 was human-merged. Base:
`dfb686749e26e40d2a461c3bec9811b1234e7e0b`.

## Scope and acceptance

- Harden the existing Team Capacity & Workload React screen and capacity APIs.
  Preserve project-view access for reads and project-edit access for writes.
- Add and edit roster names, roles, weekly availability and base allocated hours.
  Preserve explicit zero availability and distinguish base allocation from the
  calculated allocation that includes open assignments.
- Review a chosen member, work item, hours and optional calendar due date before
  explicitly creating an assignment. Recommendations prefill a reviewable draft;
  suggested hours remain labelled estimates. No assignment runs an agent task.
- Explicitly complete or cancel an open capacity assignment. Confirm roster
  deactivation and prevent hiding members who still have open assignments.
  Workspace-user seeding remains an explicit action with its limits disclosed.
- Validate amounts, dates, text, boolean values and allowed assignment states on
  the server. Verify active member ownership and any linked task/goal ownership
  within the authenticated tenant. Missing or foreign records cannot report a
  successful update. Guard duplicate open task assignments.
- Keep reads side-effect-free and expose query failures. Explain the capped task
  list, estimated effort and the difference between weekly availability and open
  allocations across due dates; do not present incomplete data as complete totals.
- Bind displayed data and drafts to the authenticated user and tenant. Recheck
  permissions/context, reject stale responses, block duplicate submissions,
  retain uncertain drafts, and distinguish accepted saves from refresh failures.

## Verification and boundaries

Frontend owns the screen, helper and behavior tests. Backend owns the capacity
handlers. Separate Security owns permission/tenant tests and security assessment.
QA runs the focused and core gates; a fresh read-only Reviewer follows QA. All
gates and CI must agree on one frozen SHA before the human handoff.

At most 1,500 changed lines including tests. Reuse existing routes and schema;
preserve permission grants, enforcement, navigation and other agency screens.
No automatic scheduling/rebalancing, provider actions, publishing, invoices,
payments, schema redesign or production-data smoke writes. Test reports state
whether database/browser behavior is injected or exercised live. Existing
baseline build/type failures are compared with main and reported separately.
Agents keep the PR draft and unmerged; Paul makes the human merge decision.
