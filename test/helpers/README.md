# InfoGenie Integration Test Harness (`test/helpers/`)

A reusable harness for integration-style tests that exercise the real Express
API surface against a real Postgres database. It removes the per-test
boilerplate (booting an app, hand-rolling `http.request`, seeding tenants/users,
intercepting mail) so feature-test waves can focus on assertions.

> **DB-gated.** Every database helper mirrors `db.hasDb()`: when `DATABASE_URL`
> is absent they are inert and your test should `skip`. The harness never
> fabricates data.

## Quick start

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { bootApp, request, login, makeFixtures, installMailCapture, hasDb } = require('../helpers');

test('my feature', { skip: !hasDb() && 'no DATABASE_URL' }, async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  t.after(() => fx.cleanup());

  const tenant = await fx.seedTenant();
  const owner  = await fx.seedUser({ tenantId: tenant.id, owner: true });

  const app = await bootApp({ mount: (a) => a.use('/api/my-feature', require('../../services/my_feature/api')) });
  t.after(() => app.close());

  // Cookie-session call
  const { cookie } = await login(app.baseUrl, owner.email, owner.password);
  const res = await request(app.baseUrl, 'GET', '/api/my-feature', { cookie });
  assert.strictEqual(res.status, 200);

  // API-key call (programmatic, owner principal + default tenant)
  const res2 = await request(app.baseUrl, 'GET', '/api/my-feature', { apiKey: true });
  assert.strictEqual(res2.status, 200);
});
```

Run the integration layer:

```
npm run test:integration      # node --test --test-force-exit test/integration/
```

(`--test-force-exit` is required — open DB pool handles otherwise keep the
runner alive after the tests pass. See `.agents/memory/test-suite-force-exit.md`.)

## Why a hand-built app (and not `require('../server')`)

`server.js` does **not** export its Express `app`, and requiring it is unsafe:
at load time it runs the `BOOT_TASKS` schema-ensures, starts the drip
`setInterval`, and — via `services/competitor_detect/routes.js` — calls
`app.listen()` on the internal port. So the harness composes the **same
middleware chain** from the real modules in the same order `server.js` uses:

```
express.json (rawBody) → express-session → loadUserFromSession →
loadTenantContext → /api/auth → /api/tenants → api-key gate (+ tenant
injection) → enforceMatrix → [your feature routers]
```

This keeps auth, tenant scoping (`MULTITENANT_ENFORCEMENT`) and permission
enforcement (`PERMISSION_ENFORCEMENT`) behaving as they do in production.

### Known missing seam

`server.js` exports neither `app` nor an app-factory, and binds a port at
require-time. If product code is ever refactored to export a `buildApp()` that
doesn't listen or start crons, this harness should switch to it instead of
duplicating the middleware order. Until then the duplication in
`test/helpers/app.js` is deliberate and must be kept in sync with `server.js`
(the api-key gate and middleware order in particular).

## API

### `env.js` (auto-loaded)
Sets a deterministic test `CREDENTIAL_ENCRYPTION_KEY` and `SESSION_SECRET`
**before** vault/session code loads — but only when not already set, so real
project keys always win. Requiring the harness loads this first.

### `bootApp(opts) → { app, server, port, baseUrl, close() }`
Boots the app on an ephemeral port (`listen(0)`).
- `opts.mount(app)` — mount your feature routers (runs after the api-key gate +
  `enforceMatrix`, like `server.js`).
- `opts.enforceMatrix` (default `true`) — include the real permission gate.
- `opts.includeAuthRoutes` (default `true`) — mount `/api/auth` + `/api/tenants`.
- `close()` — stop the server; call in `t.after(...)`.

### `request(baseUrl, method, path, opts) → { status, headers, json, text, cookies }`
One HTTP call. `json` is `null` for non-JSON bodies.
- `opts.body` — object (JSON-encoded) or string.
- `opts.apiKey` — `true` (uses `INFOGENIE_API_KEY`) or an explicit key string →
  sent as `Authorization: Bearer …`.
- `opts.cookie` — session cookie string from `login()`.
- `opts.headers` — extra headers.

### `login(baseUrl, email, password) → { cookie, status, json }`
POSTs `/api/auth/login` and returns the `infogenie.sid` cookie to replay.

### `makeFixtures() → fixtures`
Per-suite fixture set with its own cleanup registry.
- `ensureSchemas()` — idempotent auth + tenant + credentials schema ensure
  (also seeds the system roles `seedUser` looks up). Call once per suite.
- `seedTenant(label?) → { id, name, slug }` — isolated active workspace with a
  unique suffix. Call twice for cross-tenant tests.
- `seedUser({ tenantId, owner, password, email, name, verified, roleKey }) →
  { id, email, name, password, isOwner, tenantId }` — `owner:true` →
  `is_owner=TRUE` + `tenant_owner` role; `owner:false` → `client_viewer`.
  The plaintext `password` is returned for `login()`.
- `latestEmailToken(userId, purpose) → token|null` — reads the newest
  `email_tokens` row (`'verify' | 'reset' | 'invite'`) straight from the DB.
- `cleanup()` — deletes everything seeded (relies on `ON DELETE CASCADE`;
  clears `user_integrations` explicitly). Safe to call more than once.

### `installMailCapture() → { messages, latestTo(email), reset(), restore() }`
Monkeypatches `global.fetch` so auth mail to `api.resend.com/emails` is
**captured, never sent** (returns a fake 200). Each entry is
`{ to, subject, html, text, token, at }`. Always `restore()` in `t.after(...)`.

### `hasDb() → boolean`
Mirrors `db.hasDb()` — use it for the `skip` condition.

## Conventions

- Always pair `bootApp()`/`makeFixtures()`/`installMailCapture()` with a
  `t.after(...)` teardown.
- Gate DB-touching tests on `{ skip: !hasDb() && 'no DATABASE_URL' }`.
- Seeded rows carry unique suffixes and never touch real data; `cleanup()`
  removes them.
