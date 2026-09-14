# PR10G.4 — Client Reporting Metric Selection & Date Controls

Continues Gap 7 by letting each client reporting profile save metric selection, ordering, and a default relative reporting period.

## Scope

- Profile fields: `selected_metrics`, `reporting_period`, `reporting_timezone`
- Server-validated metric allowlist per source (`search-intel`, `campaigns`)
- Relative periods: last 7 / 30 completed days, previous calendar month; `all_time` retained for migrated profiles
- Custom `start_date` / `end_date` overrides on manual preview, download and email only
- Scheduled delivery and portal resolve the saved relative period at execution time
- Outputs show queried date boundaries; metrics filtered to client mapped data only

## Deferred

- Canonical-metrics availability badges in client report tables
- Logo rendering in exports
- Workspace-wide export parity
