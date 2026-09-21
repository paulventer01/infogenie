# Preview workspace and client reporting journey

This branch adds a disposable review workspace and a first interface slice:
client → reporting profile/data → report preview/approval → portal/follow-up.
It does not deploy production or enable autonomous sending.

## Open the preview

1. On this branch in GitHub, choose **Code → Codespaces → Create codespace**.
   The included devcontainer starts a dedicated PostgreSQL container and installs
   the application. Wait for port **5000** to open. Keep its visibility **Private**.
2. Run **`npm run preview:access`** in the Codespace terminal once to open the
   private login file in the editor. Copy its email and password, then close it. The account is unique to this workspace;
   it does not use your production login or the old hard-coded demo password.
3. Open port **5000 → Open in Browser**, sign in to the **Workspace** home screen. Choose a client and follow
   **Set up this client’s report** or **Continue this client’s report**. This is the usable preview URL; bookmark that browser address.
4. Choose **DEMO — Cedar & Coast**. Save the report preferences, map the synthetic
   search query, preview the report, then use the approval and portal controls.
   No performance results are fabricated: the initial report has empty metrics.
   Delivery and provider-dependent operations cannot send externally.

The URL works while the Codespace is running. Stopping and restarting the same
Codespace retains the database and test account. Deleting the Codespace deletes
this disposable workspace. A reviewer needs permission to access a private
forwarded port; this is not a public staging deployment.

## Restart and diagnostics

Startup is automatic through `postStartCommand`. To restart manually, stop the
existing preview process and run `npm run preview`. Do not also run `npm run dev`:
both would compete for ports and the `.next` directory. Startup output is in
`/tmp/infogenie-preview.log`; `npm run preview:access` opens the generated
account file in the editor after seeding; it never prints credentials.
If automatic opening fails, press **Ctrl+P**, enter
**`.preview-workspace/access.json`**, and open that private file. Database initialization or Next compilation may still
be in progress at that point.

Initial account creation uses one transaction and a private pending record so
a restart can recover a committed seed interrupted before its final file rename.
The app refuses production mode, dotenv files, a non-preview database identity,
or a database without TLS. If an old database exists but its private account file
is missing, it stops without resetting existing users. Start a new Codespace for
a clean disposable workspace; do not point this launcher at a real database.

## Isolation and persistence

- Next listens on 5000; Express is loopback-only on 8000. PostgreSQL shares the
  app's container network and has no host-published port in the devcontainer.
- Only PATH, HOME and temporary-directory settings survive into the app process.
  For Codespaces, the platform-provided name and forwarding domain are validated
  to derive one exact HTTPS origin on port 5000 for CSRF checks. Other Codespaces
  origins are not trusted; ambient PUBLIC_BASE_URL/APP_URL values are discarded.
  Provider keys, ambient database URLs and runtime overrides are discarded.
- Random session/vault/API keys and the synthetic login are stored locally in
  ignored `.preview-workspace/` files, with directory mode 0700 and file mode 0600.
  They are never printed by startup or the access command, or included in CI
  artifacts. The access command refuses non-interactive use and opens only a
  regular, owner-only file owned by the current user.
- Real session, tenant permissions and CSRF checks remain enabled. The seeded
  reviewer is a tenant owner, not a platform administrator.
- Jobs are disabled; server-side network connections are limited to the three
  loopback service ports. Preview browser CSP blocks external scripts, images
  and fetch connections. External email, AI, advertising and publishing are not
  part of this review environment.

## Verification

`node --test test/preview-workspace.test.js` checks environment isolation and
actual blocked network attempts. The **Preview workspace** PR workflow builds
the same database image, starts the real launcher, signs in with Chromium,
saves a report, checks mobile overflow and verifies the saved report and account
after restart. It uploads synthetic desktop/mobile screenshots.

The existing **Client reporting UI** workflow separately verifies the complete
reporting/approval/portal journey, tenant isolation and stale-response handling
with real PostgreSQL/TLS. The preview test complements that acceptance suite.

The visual slice preserves existing API contracts and approval requirements.
Other panels, provider integration setup, production deployment and a public
always-on staging URL remain separate work.

## Workspace home

The root URL `/` now opens a React workspace overview. The InfoGenie logo and
Workspace sidebar shortcut return there. Existing `/analyse` bookmarks still
open the analysis form. Reporting links carry the selected client ID; the
reporting page validates it through the existing tenant-scoped API.

Client lists and saved profile status require existing workspace settings access.
Loading, empty, denied and failed states are distinct. Focus or workspace-access
changes clear the prior selection and revalidate access. The overview does not
claim live performance, pending approval counts or report delivery status.

A report profile being saved is not approval to send. The existing reporting
journey retains its approval and sharing checks. Marketing brief-to-campaign
redesign, an all-role dashboard and consolidated cross-tool approval counts are
follow-up work.
