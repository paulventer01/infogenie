# PR10F.2 — Client Reporting Profile Setup UI

## Purpose

Continue Gap 7 of the InfoGenie Gap Analysis by making PR10F.1's saved reporting profiles editable in the dashboard. The Manage navigation opens `/manage/client-reporting` (`view-client-reporting`).

## Accepted behavior

- List real active clients from the current workspace with bounded pagination and an explicit Load more action.
- Load one client's saved profile. An unconfigured profile shows unsaved defaults and requires a title before saving.
- Edit source (Search intelligence or Campaigns), format (PDF, PowerPoint or Excel), title, workspace branding preference or approved custom branding fields.
- Save only on explicit submission. Use version zero for creation and the loaded version for updates; never send tenant, actor or client ownership fields in the body.
- Keep a conflicting or unconfirmed draft available. Disable another save until the user explicitly discards changes and reloads the authoritative profile.
- Confirm before switching clients with unsaved changes. Preserve drafts on ordinary validation errors.
- Verify authenticated account, active workspace membership and workspace-settings access before fetching protected data and before/after saving. Discard state when the account, workspace or access changes; ignore superseded responses.
- Provide loading, empty, access-denied, unavailable-client and retry states, accessible field labels and a responsive layout.

The existing platform permission rules remain in force. A discoverable navigation item does not grant access: the panel checks access and the existing API remains authoritative.

## Verification

Behavioral tests cover form validation, payloads, response identity, stale requests, permissions, pagination and version conflicts. A dedicated GitHub workflow requires the browser acceptance suite to pass with zero skips using Chromium, the real Next/Express routes and disposable PostgreSQL 16 with TLS. It verifies persistence after reload, an actual competing editor's conflict and denied access. Screenshots use synthetic fixtures.

The browser suite reuses the existing isolated agency-browser harness and its dedicated `PR10E9_TEST_DATABASE_URL` database. `PR10F2_REQUIRE_BROWSER=1` makes missing browser prerequisites fail. It neither connects to an ambient application database nor replaces API responses.

Existing CI retains full TypeScript, strict production build, core regression, native profile API and agency browser checks.

## Deliberately deferred

This panel configures reporting preferences. It does not generate reports, assemble client-specific data, preview branding assets, create clients, schedule delivery or grant portal access. Gap 7 remains open for client-specific report assembly and generation; Gap 8 covers later portal access. Existing workspace-wide export data must not be presented as isolated client results.
