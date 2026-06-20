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

## The app comes straight from `server.js` (`buildApp()`)

The harness uses the **real** Express app. `server.js` exports `buildApp()` and,
crucially, gates all of its background work behind a runtime flag set from
`require.main === module` (see `services/runtime_flags.js`). When `server.js` is
*required* (as the harness does) rather than run directly, that flag is off, so:

- no port is bound (the listens in `services/competitor_detect` +
  `services/external_connectors` are skipped),
- no timers start (the drip tick and the `services/officer` /
  `services/assistant_ops` register-time crons are skipped),
- the `BOOT_TASKS` schema-ensure / `start*Cron()` runner does not run.

Requiring `server.js` is therefore side-effect-free beyond constructing `app`,
so `bootApp()`/`buildApp()` hand back the production middleware chain:

```
express.json (rawBody) → express-session → loadUserFromSession →
loadTenantContext → /api/auth → /api/tenants → api-key gate (+ tenant
injection) → enforceMatrix → every feature router → [your mounted probes]
```

This keeps auth, tenant scoping (`MULTITENANT_ENFORCEMENT`) and permission
enforcement (`PERMISSION_ENFORCEMENT`) identical to production — no hand-rebuilt
chain to drift out of sync. `server.js` builds a single `app` at require time, so
`buildApp()` returns that singleton; `opts.mount(app)` appends routers/probes
**after** every server route (where a feature router would sit relative to the
gate). The old `opts.enforceMatrix` / `opts.includeAuthRoutes` toggles are gone —
the real app always includes both.

## API

### `env.js` (auto-loaded)
Sets a deterministic test `CREDENTIAL_ENCRYPTION_KEY` and `SESSION_SECRET`
**before** vault/session code loads — but only when not already set, so real
project keys always win. Requiring the harness loads this first.

### `bootApp(opts) → { app, server, port, baseUrl, close() }`
Boots the app on an ephemeral port (`listen(0)`).
- `opts.mount(app)` — append your feature routers/probes; they run after the
  api-key gate + `enforceMatrix` and after every server route, exactly like a
  feature router in `server.js`.
- `close()` — stop the server; call in `t.after(...)`.

The app is the real one from `server.js` — `/api/auth`, `/api/tenants` and
`enforceMatrix` are always present (the old `opts.enforceMatrix` /
`opts.includeAuthRoutes` toggles no longer exist).

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
