# PR10F.1 — Persistent Per-Client Reporting Profiles

## Purpose and scope

The InfoGenie Gap Analysis identifies reporting variability in Gap 7 and prioritizes reporting and client portal work in section 8. This first slice saves reporting preferences against existing canonical clients. It supplies the persistence and API foundation for later reporting work.

One profile belongs to one `(tenant_id, client_id)` pair. A composite foreign key prevents a profile from referencing another workspace's client. The schema is additive and idempotent; existing clients are preserved.

## API contract

All routes are under `/api/client-reporting`. They require an authenticated user, an active workspace, an active membership in that workspace, and `tenant.settings.manage`. The router enforces these conditions even when central permission enforcement is in shadow mode. Platform privileges do not bypass membership or client ownership.

| Method and path | Behavior |
| --- | --- |
| `GET /clients` | Active clients in the current workspace; cursor pagination, at most 100 rows. |
| `GET /clients/:clientId` | One active client; response fields are `id`, `name`, `slug`, `website`, `status`. |
| `GET /clients/:clientId/profile` | Saved profile, or `configured: false` and `profile: null`. Reads do not create defaults. |
| `PUT /clients/:clientId/profile` | Validate and replace the complete saved profile with optimistic version checking. |

Missing, archived and foreign clients return the same `404 client_not_found`. Existing platform administration client CRUD retains its owner/admin gate. Normal session, CSRF and tenant middleware remain in effect.

## Saved fields

| Field | Accepted values |
| --- | --- |
| `report_source` | `search-intel` or `campaigns` |
| `default_format` | `pdf`, `pptx` or `xlsx` |
| `report_title` | Trimmed, nonempty text, at most 160 characters |
| `branding_mode` | `workspace` or `custom` |
| `branding_overrides` | Plain object with optional `agencyName` (80 characters), `footerText` (200), and flat `primaryColor`, `accentColor`, `textColor` (`#RRGGBB`) |
| `expected_version` | `0` to create; the current positive version to update |

Workspace branding requires empty overrides. Unknown keys, tenant/client ownership fields, asset URLs and malformed values are rejected. Writes are limited to 8 KiB and 60 attempts per minute per workspace. Reads, including HEAD requests, share a separate 300-request-per-minute workspace budget across the three read routes. Actor and timestamps are assigned by the server.

A transaction locks the active client row before saving. Archiving and profile writes therefore serialize. Stale versions return `409 version_conflict`; competing writes with the same version cannot silently overwrite each other. The stored version increments after a successful update.

## Verification

Focused tests cover validation, pagination, access controls, tenant resolution, version conflicts, rollback and response fields. The dedicated GitHub workflow runs a disposable PostgreSQL 16 service with TLS and requires the native integration suite to complete with zero skips. That suite exercises real sessions, CSRF, tenant isolation, persistence, database constraints and concurrent updates. Existing production-build CI checks full TypeScript, the strict Next build and core regressions.

Local native integration requires `PR10F1_TEST_DATABASE_URL` pointing to the disposable loopback database `infogenie_client_reporting`. Set `PR10F1_REQUIRE_DATABASE=1` to fail when it is absent. The suite does not use an ambient application database.

## Remaining Gap 7 work

This change saves settings only. It does not generate reports, fetch provider data, schedule delivery, create portal grants, expose share links or add a dashboard panel. Existing export sources filter data by workspace; client-specific data assembly and authorization must precede any claim that a report contains only that client's results. Workspace branding inheritance is saved as a preference, without resolving branding assets during these requests.

Gap 7 remains open. Client-specific report assembly, profile editing in the dashboard and report generation need subsequent scoped tasks; client portal access also addresses Gap 8.
