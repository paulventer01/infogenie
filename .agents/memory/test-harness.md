---
name: Integration test harness
description: Why server.js can't be required in tests, and the harness that replaces it (test/helpers/)
---

# Integration test harness (`test/helpers/`)

There is a reusable harness under `test/helpers/` (entry `require('../helpers')`)
for integration tests that hit the real Express API against real Postgres.
Run via `npm run test:integration` (`node --test --test-force-exit test/integration/`).

## Why the harness builds its own app instead of `require('../server')`

**Rule:** never `require('../server')` in a test. It cannot give you the `app`,
and requiring it has destructive side effects.

**Why:**
- `server.js` does **not** export its Express `app` (and no app-factory).
- Requiring it runs all `BOOT_TASKS` schema-ensures, starts the drip
  `setInterval`, and — critically — calls `app.listen()` at **require time** via
  `services/competitor_detect/routes.js` (and `services/external_connectors/routes.js`).
  So merely requiring it binds a port and spins up crons.

**How to apply:** compose the same middleware chain from the real modules in
`server.js` order: `express.json(rawBody) → express-session →
loadUserFromSession → loadTenantContext → /api/auth → /api/tenants → api-key
gate (+ tenant injection) → enforceMatrix → feature routers`. The api-key gate
(`_injectApiKeyAuth`) and that order are duplicated in `test/helpers/app.js` and
must stay in sync with `server.js`. If product code ever grows a `buildApp()`
that doesn't listen/start crons, switch the harness to it.

## Other gotchas baked into the harness
- Set a test `CREDENTIAL_ENCRYPTION_KEY` + `SESSION_SECRET` **before** requiring
  vault/session (they cache config once). `test/helpers/env.js` does this and is
  loaded first; it only sets vars that aren't already present.
- Auth mail goes out via `global.fetch` → `api.resend.com/emails`. Tests must
  intercept fetch (mail capture) so no real mail is sent when `RESEND_API_KEY`
  is live; the reset/verify token is also always persisted to `email_tokens`.
- DB helpers gate on `db.hasDb()` (skip when `DATABASE_URL` absent).
- Use MemoryStore for sessions in tests to avoid polluting `user_sessions`.
- Cleanup leans on `ON DELETE CASCADE` (tenant→tenant_users/tokens, user→
  identities/tokens) but `user_integrations` has no FK to `users` — delete it
  explicitly before deleting the user.
