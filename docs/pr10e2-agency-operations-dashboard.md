# PR10E.2 — Agency Operations Dashboard

## Purpose

Build a read-only, tenant-scoped operations dashboard over the merged Agency Operations APIs. The dashboard should make current operational health visible without creating or changing operational data.

## Required signals

Use the existing API contracts for:

- time: logged hours and period totals
- margins: cost, billable value, and margin
- pricing completeness: pricing/completeness status and gaps
- scope signals: scope changes, risk, and alerts
- capacity: current-week capacity and utilization

The UI may combine values only when the API response provides a safe, unambiguous basis for doing so. Do not invent values or create mixed-currency totals.

## Boundaries

- Keep the feature read-only; no new mutations, publishing, activation, provider actions, or autonomous execution.
- Preserve tenant isolation, permission behavior, strict data handling, and honest error states.
- Prefer the existing dashboard shell, navigation, route, registry, and API helpers.
- Prefer no backend changes. If an API contract gap blocks a required signal, report the gap rather than guessing.
- Keep the implementation focused and within 1,500 changed lines, including tests.

## Acceptance criteria

- The dashboard has loading, empty, error, and permission-safe states.
- It shows the selected reporting period and the available time, margin, pricing, scope, and capacity signals.
- API failures remain visible and are not silently converted into healthy-looking values.
- The route is reachable through the existing application conventions.
- Focused tests cover rendering, API failure handling, strict data behavior, and key metric formatting.
