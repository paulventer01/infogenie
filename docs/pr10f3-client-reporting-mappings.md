# PR10F.3 — Client Reporting Data Mapping & Isolation

Gap 7 requires a reliable relationship between a client and the data included in
its reports. Reporting profiles alone do not establish that relationship.

## Frozen acceptance

- Persist explicit, exclusive mappings from Search Intelligence queries and
  advertising campaigns to canonical clients within the same workspace.
- List mapping candidates for authorized workspace settings managers; support
  deliberate assignment and removal without silent reassignment.
- Bind removal to the current mapping UUID so a stale request cannot remove a
  subsequently recreated assignment.
- Read only mapped client records, including tenant-scoped descendants and
  aggregates. Apply ownership filters before pagination and limits.
- Preserve active membership, settings permission, CSRF, and rate limits.
- Reject foreign or archived clients; preserve canonical deletion behavior and
  return honest empty results for clients without mapped data.
- Prove isolation and concurrency against PostgreSQL with TLS and real sessions.

## Source coverage

| Source | Mapped root | Included descendants |
| --- | --- | --- |
| Search Intelligence | `search_intel_queries` | `search_intel_llm_runs` |
| Campaigns | `ad_campaigns` | `ad_performance_hourly`, `optimizer_actions` |

Search pulse runs, image scans, and legacy KV launches have independent identities
and remain excluded. Responses identify excluded sections. Existing workspace
exports are not a client-scoped reporting API. Mapping UI, report generation,
branding application, delivery, and client portal authorization are later work.

## API contract

All paths below are relative to `/api/client-reporting` and require active
workspace membership plus `tenant.settings.manage`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET/HEAD | `/sources/:source/records` | Paginated candidates and current assignment metadata |
| POST | `/clients/:clientId/mappings/:source/:recordId` | Body `{}`; create an exclusive assignment; 201 or 409 conflict |
| DELETE | `/clients/:clientId/mappings/:source/:recordId` | Body `{mapping_id: UUID}`; remove only that assignment |
| GET/HEAD | `/clients/:clientId/data/:source` | Mapped roots, all-mapped summary, and recent child records |

Read pagination accepts `cursor` and `limit` (1–100). Recent child collections are
limited to 50 independently of root pagination. Campaign monetary totals are
grouped by currency. Multi-query client reads share a repeatable-read snapshot.

## Verification

The client reporting workflow runs focused regressions and native PostgreSQL mapping tests with zero
skips required; the production build workflow provides the existing build gate.
The pull request records the completed Security, independent QA, and Reviewer
outcomes against the submitted revision.
