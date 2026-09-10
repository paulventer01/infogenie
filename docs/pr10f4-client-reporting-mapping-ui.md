# PR10F.4 — Client Reporting Data Mapping UI

Gap 7 needs a usable way to connect reporting data to a client. PR10F.3 supplies
exclusive mappings and isolated reads; this slice adds controls to the existing
Manage → Client Reporting screen.

## Frozen acceptance

- Select an active client and either Search Intelligence queries or campaigns.
- Browse paginated real records with clear unassigned, selected-client, and
  other-client assignment states.
- Assign only unassigned records through an explicit action. Never overwrite or
  silently move another client's assignment.
- Confirm removal of a selected-client assignment using its current UUID.
- Reload authoritative state after conflicts or unconfirmed writes before
  allowing another mutation; never automatically retry a write.
- Clear stale rows and pending removal when client, source, account, workspace,
  or access changes. Ignore late responses and verify access around operations.
- Preserve profile editing and its existing unsaved-change protection.
- Provide accessible loading, empty, failure, recovery and mobile states.
- Verify real browser persistence, ownership restrictions and conflict recovery
  against PostgreSQL with TLS, alongside focused race/validation regressions.

## Boundaries

Uses existing PR10F.3 APIs and settings permissions. No new schema, provider
execution, report generation, delivery, client portal or automatic reassignment.
Search pulses, image scans and legacy KV launches remain outside supported
mapping sources. Source selection here does not change saved report preferences.

## Verification

The client reporting UI workflow runs focused tests and sequential real-browser
profile/mapping suites with zero skips required. Existing production build,
TypeScript and regression workflows remain the release gates. The pull request
records independent Security, QA and read-only Reviewer outcomes on its final
revision; agents do not merge.
