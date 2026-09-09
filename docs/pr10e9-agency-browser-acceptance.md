# PR10E.9 — Agency Operations Browser Acceptance & Release Readiness

Paul approved this scope after PR #154 was human-merged into main at
`c9acfd630af7c99df8fbd5de2c827721d341892b`.

## Frozen acceptance scope

- Exercise real Chromium against the existing Next.js pages, production Express
  routes, real login/session cookies and disposable PostgreSQL with TLS.
- Follow login → team setup → rates → scope/budget → explicit assignments →
  time entries → dashboard. Create and correct records using visible controls;
  check expected totals and persistence after a page reload.
- Verify permissions and foreign-tenant data separation through real sessions.
  Check desktop/mobile layouts and loading, empty and failure states. Deliberate
  request interruption is permitted only to exercise failure/loading states;
  successful workflow responses must come from the real application/database.
- Add repeatable browser acceptance to CI. Missing required configuration,
  browser startup errors, test failures or skipped scenarios must fail CI.
- Fix only demonstrated blockers within the browser journey. Limit the complete
  diff to 1,500 lines, including tests and CI; preserve existing security checks.

## Isolation and release boundary

Use `PR10E9_TEST_DATABASE_URL` only with the explicitly named loopback database
`infogenie_agency_browser`. Never fall back to ambient `DATABASE_URL`. Use
synthetic fixture accounts and secrets; block external provider traffic, retain
CSRF and permission/tenant enforcement, and clean up fixture data and processes.

The browser gate exercises Next.js development compilation. Report that
separately from the strict production build: a passing browser journey does not
prove deployability. Check the production build against the unchanged main
baseline, document existing blockers, and do not weaken type/lint/build gates.
Production deployment and any broader baseline repair remain separate decisions.

The strict `npm run build:next` baseline was checked on unchanged main
`c9acfd630af7c99df8fbd5de2c827721d341892b` on 9 September 2026. Compilation
reached lint validation and failed on these existing errors:

- `components/features/analyse/MarketingIntelPanels.tsx`: unavailable ESLint
  rule `@typescript-eslint/no-require-imports`.
- `components/features/create/Social.tsx`: internal navigation uses an anchor
  instead of Next.js `Link`.
- `components/features/reach/SocialIdeasPanel.tsx`: `usePreview` is called inside
  a callback, violating the React hooks rule.

These block a production release; browser acceptance alone does not clear them.
The separate `tsc --noEmit --incremental false` baseline also reports nine
existing errors across `EcosystemSpine.tsx`, `AiGovernanceHub.tsx`,
`ExecutionHub.tsx` and `AeoOptimizer.tsx`. Any in-scope product fix must introduce
no additional diagnostics; these existing errors are not waived for release.

## Review workflow

Backend owns the isolated application/fixture harness; Frontend owns browser
journeys and demonstrated UI fixes. Lead owns CI and this scope record. Security
is a separate invocation from day one. Independent QA verifies the frozen commit
and real CI evidence; a read-only Reviewer follows QA. Keep the PR draft and
unmerged for Paul's human review and merge. No automatic assignments, provider
actions, production-data changes or new business features are authorized here.
