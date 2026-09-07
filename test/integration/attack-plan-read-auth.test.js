// test/integration/attack-plan-read-auth.test.js
//
// The saved-attack-plan endpoints must sit behind the same /api/* gate as the
// rest of the app. This drives the REAL server.js middleware chain (api-key /
// session gate → enforceMatrix → feature routers) rather than a hand-mounted
// app, because the finding it guards against lives in the gate's public
// allowlist and not in the router.
//
// `/^\/api\/[^\/]+\/status$/` is allowlisted for per-integration status pings,
// which makes `/api/ai-attack-plan/status` reachable anonymously; having no
// req.user, it is skipped by enforceMatrix too. The router's id guard is what
// stops it from becoming an unauthenticated tenant read. These assertions need
// no database — the gate answers before any handler runs.

const { test } = require('node:test');
const assert = require('node:assert');

const { bootApp, request } = require('../helpers');

const PREFIX = '/api/ai-attack-plan';

test('saved-attack-plan reads require authentication', async (t) => {
  const app = await bootApp();
  t.after(() => app.close());

  for (const path of [
    `${PREFIX}/list`,
    `${PREFIX}/latest`,
    `${PREFIX}/latest?competitor=Rival`,
    `${PREFIX}/ap_1700000000000_0123456789ab`,
  ]) {
    const res = await request(app.baseUrl, 'GET', path);
    assert.strictEqual(res.status, 401, `${path} must not be readable anonymously`);
    assert.strictEqual(res.json.error, 'auth_required');
  }
});

test('generating a plan requires authentication', async (t) => {
  const app = await bootApp();
  t.after(() => app.close());

  const res = await request(app.baseUrl, 'POST', PREFIX, {
    body: { myDomain: 'a.test', competitor: 'b', industry: 'c' },
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.json.error, 'auth_required');
});

test('the allowlisted /status shape cannot read a saved plan', async (t) => {
  const app = await bootApp();
  t.after(() => app.close());

  // Admitted by the public allowlist, so this is NOT a 401 — the router's id
  // guard must answer with a bare not_found and never a plan.
  const res = await request(app.baseUrl, 'GET', `${PREFIX}/status`);
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(res.json, { ok: false, error: 'not_found' });
});
