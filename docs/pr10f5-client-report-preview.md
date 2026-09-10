# PR10F.5 — Client Report Preview & Generation

Continues Gap 7 from the merged reporting profiles and client data mappings.

## Acceptance

- An authorised workspace operator selects an active client and saves its reporting profile before previewing a report.
- Preview and explicit download use the saved source, title, format and permitted text/colour branding. Unsaved profile changes must not become report settings.
- The server reads the active client, saved profile, client-mapped source data and workspace branding in one consistent database snapshot.
- Only mapped Search Intelligence queries or advertising campaigns and their tenant-scoped children contribute. Workspace-wide export collectors are not used.
- Explicit generation downloads PDF, PowerPoint or Excel. It does not send mail, publish, schedule, call an AI model or persist a generated report.
- Missing profiles, empty mappings, stale profile versions and access failures have actionable states. Stale client/account/workspace responses cannot trigger downloads.
- Reports identify stored-data provenance, all-time summaries, bounded record/recent lists and omitted source sections. Monetary totals remain grouped by currency.
- Scope notices survive all formats; table chunks fit the existing renderers. Branding is text and colours only; no remote assets or logos are fetched.

## Contracts

`GET /api/client-reporting/clients/:clientId/report-preview` returns the client, saved profile version, format, generation eligibility, safe branding and a bounded table-based report.

`POST /api/client-reporting/clients/:clientId/report` accepts only `expected_version`, re-reads current authorised data and downloads the saved format. It rejects a changed profile rather than silently applying another version.

Both routes reuse the existing client-reporting membership/permission guard, request limits and no-store responses. Generation uses the existing same-origin CSRF protection.

## Verification

Focused API/renderer and UI tests cover validation, ownership, stale state and explicit generation. Native Chromium through Next and Express with disposable PostgreSQL/TLS verifies the complete journey. Existing profile/mapping regressions, core tests, full TypeScript and the strict production build remain gates. Separate Security, independent QA and a final read-only Reviewer precede human merge.

## Deferred

Scheduled delivery, generated-report history, public/client portal access, custom metric selection, date-range filtering and logo rendering are outside this bounded slice. Gap 7 remains open.
