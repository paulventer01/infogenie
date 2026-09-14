# PR10G.5 — Client report metric drilldown

## Scope

Read-only drilldown for scalar client-report metrics in admin preview and the client portal.

- Reuses metric catalog, client mappings, selected metrics and timezone-aware period resolution from PR10G.4.
- Drilldown is available only for scalar totals (`runs`, `successful_runs`, `brand_mentions`, `performance_rows`, `spend`, `impressions`, `clicks`, `conversions`, `revenue`).
- List-style metrics (`mapped_queries`, `recent_*`) remain unsupported and are labelled in the UI.

## APIs

Operator (session + `tenant.settings.manage`):

`GET /api/client-reporting/clients/:clientId/metric-drilldown/:metricKey?cursor=&limit=&currency=&profile_version=&reporting_period=&timezone=&start_date=&end_date=`

Portal (session cookie `infogenie.crp`; tenant/client derived from portal session only):

`GET /api/client-reporting/portal/metric-drilldown/:metricKey?cursor=&limit=&currency=&profile_version=&reporting_period=&timezone=&start_date=&end_date=`

`profile_version` must match the saved profile shown in the preview; mismatches return `report_context_stale`. Relative periods use the preview's resolved `start_date`/`end_date` (not live recalculation). All-time omits date params.

Responses include `total_count`, paginated `records`, stable `ORDER BY id ASC`, resolved `period`, optional `currency`, and a `live_notice` that data may differ from the preview snapshot.

## UI

- Accessible **View contributing records** control on scalar total rows.
- Detail panel with loading, empty, error and pagination states.
- Drilldown clears on client/profile/report/date changes; stale responses are ignored.
- Campaign drilldown requires an explicit currency group.

## Tests

- `test/client-reporting-drilldown.test.js`
- `test/integration/client-reporting-drilldown.test.js` (`PR10G5_REQUIRE_DATABASE=1`)
- `test/browser/client-reporting-drilldown.test.js` (`PR10G5_REQUIRE_BROWSER=1`)

## Deferred

- Canonical availability badges on report metric cells (from PR10G.4).
- Export/email drilldown attachments.
