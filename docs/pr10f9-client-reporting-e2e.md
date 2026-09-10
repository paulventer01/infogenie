# PR10F.9 — Client Reporting End-to-End Acceptance & Gap 7 Closeout

## Purpose

PR10F.9 closes **Gap 7** (reporting variability) by documenting and verifying the complete client-reporting operator journey in one bounded acceptance slice. No new product behaviour is introduced; this change adds focused browser/PostgreSQL-TLS tests and a closeout record for PR10F.1–PR10F.8.

## End-to-end flow

An authorised workspace owner with `tenant.settings.manage` and an active tenant membership:

1. **Profile** — selects an active client, saves a reporting profile (`PUT /api/client-reporting/clients/:id/profile`).
2. **Mappings** — assigns tenant-scoped Search Intelligence or campaign records to that client (`POST …/mappings/:kind/:recordId`).
3. **Preview / download** — previews the saved snapshot (`GET …/report-preview`) and may generate a download (`POST …/report`). Email delivery is prepared separately.
4. **Recipient / delivery** — configures the delivery recipient (`PUT …/recipient`) and explicitly attempts email send (`POST …/report-email`). With no live mail provider configured, the API returns `mail_unconfigured` and **no outbound Resend traffic** occurs.
5. **Schedule / history** — opts into scheduled delivery (`PUT …/schedule`), pauses it (`POST …/schedule/pause`), and reads recent delivery metadata (`GET …/delivery-history`).
6. **Portal** — creates a single-use invitation (`POST …/portal/invitations`), redeems it (`POST /api/client-reporting/portal/redeem/:token`), and views the read-only report plus delivery history (`GET …/portal/report`, `GET …/portal/delivery-history`).

## Security and isolation guarantees verified

| Concern | Verification |
| --- | --- |
| Tenant isolation | Foreign-workspace clients return `404 client_not_found`; portal sessions cannot read another tenant's report. |
| Permission matrix | Users without `tenant.settings.manage` see access denied; the UI does not call reporting APIs. |
| Membership | Active workspace membership is required; platform admin does not bypass client ownership. |
| CSRF on writes | State-changing reporting routes reject requests without a valid same-origin `Origin` header (`csrf_rejected`). |
| Invite expiry | Expired invitation hashes cannot be redeemed (`invitation_expired`). |
| Invite revocation / replay | Redeemed tokens cannot be reused (`invitation_redeemed`); owner revoke invalidates active portal sessions (`portal_revoked`). |
| Portal read-only | Portal cookie (`infogenie.crp`) grants report/history reads only; profile, invitation and email routes return `401` without an operator session. |
| Zero external sends | Browser harness blocks non-loopback egress; `installMailCapture()` asserts no Resend API calls during delivery attempts. |

## Prior slices (merged)

| PR | Scope |
| --- | --- |
| PR10F.1 | Persistent per-client reporting profiles (API + schema) |
| PR10F.2 | Dashboard profile editor |
| PR10F.3 | Client data mappings (API) |
| PR10F.4 | Mapping UI |
| PR10F.5 | Report preview and generation |
| PR10F.6 | Delivery recipient configuration |
| PR10F.7 | Scheduled delivery and delivery history |
| PR10F.8 | Client portal invitations, redemption and read-only view (#165) |
| PR10F.9 | End-to-end acceptance + Gap 7 closeout (this document) |

## Gap 7 status

**Closed** for the scoped client-reporting vertical: saved profiles, tenant-scoped mappings, explicit preview/generation, recipient configuration, opt-in scheduled delivery with history metadata, and revocable client portal read access — all tenant-isolated, permission-gated and CSRF-protected.

Remaining product gaps outside this vertical (custom metric selection, date-range filtering, logo rendering, workspace-wide export parity) are not part of Gap 7 closeout and remain future scoped work.

## Verification

| Gate | Command / location |
| --- | --- |
| Static wiring | `node --test test/client-reporting-e2e-ui.test.js` |
| Focused API/UI regressions | `client-reporting-ui` workflow `focused-tests` job |
| Browser E2E (Chromium + PostgreSQL/TLS) | `PR10F9_REQUIRE_BROWSER=1` + `test/browser/client-reporting-e2e.test.js` in `client-reporting-ui` workflow |
| Core regressions | `npm run test:core` |
| TypeScript + Next lint/build | `npm run lint:next`, `npm run build:next` |

Local browser run (disposable TLS database `infogenie_agency_browser`):

```bash
export PR10E9_TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/infogenie_agency_browser"
export PR10F9_REQUIRE_BROWSER=1
node --no-experimental-global-navigator --test --test-force-exit test/browser/client-reporting-e2e.test.js
```
