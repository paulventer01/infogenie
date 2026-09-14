'use strict';
// Policy PUT requires tenant.settings.manage (longest-prefix row), not integrations.
// Run: node --test test/ai-governance-policy-permissions.test.js

const { describe, it, before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const matrix = require('../services/tenants/permission_matrix');
const { isValidPermission } = require('../services/tenants/permissions');
const POLICY_PUT = '/api/ai-governance/policy';
const SETTINGS = 'tenant.settings.manage';
const INTEGRATIONS = 'tenant.integrations.manage';

function freshEnforcer(mode) {
  const prev = process.env.PERMISSION_ENFORCEMENT;
  process.env.PERMISSION_ENFORCEMENT = mode;
  delete require.cache[require.resolve('../services/tenants/permission_enforce')];
  const enforce = require('../services/tenants/permission_enforce');
  if (prev === undefined) delete process.env.PERMISSION_ENFORCEMENT;
  else process.env.PERMISSION_ENFORCEMENT = prev;
  return enforce;
}

function attachGrants(keys, extra = {}) {
  const perms = new Set(keys);
  return (rq, _res, next) => {
    rq.user = { id: 11, email: 'member@test.co', isOwner: false, ...(extra.user || {}) };
    rq.permissions = perms;
    rq.can = (k) => perms.has(k);
    rq.platformRole = extra.platformRole || null;
    next();
  };
}

async function makeServer({ mode, attach }) {
  const enforce = freshEnforcer(mode);
  const app = express();
  app.use(express.json());
  app.use(attach);
  app.use(enforce.enforceMatrix);
  app.put('/api/ai-governance/policy', (req, res) => res.json({ ok: true }));
  app.post('/api/ai-governance/demo-event', (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function req(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(baseUrl + pathname, {
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

describe('ai-governance policy permission matrix', () => {
  it('policy PUT resolves to tenant.settings.manage via longest prefix', () => {
    for (const method of ['PUT', 'PATCH', 'POST']) {
      const m = matrix.requiredPermissionForRequest(POLICY_PUT, method);
      assert.equal(m.matched, true);
      assert.equal(m.permission, SETTINGS);
      assert.equal(m.group.prefix, '/api/ai-governance/policy');
    }
  });

  it('other ai-governance writes still require tenant.integrations.manage', () => {
    const m = matrix.requiredPermissionForRequest('/api/ai-governance/demo-event', 'POST');
    assert.equal(m.permission, INTEGRATIONS);
  });

  it('settings permission is a valid catalog key', () => {
    assert.equal(isValidPermission(SETTINGS), true);
    assert.deepEqual(matrix.validate(), []);
  });
});

test('enforcer: settings-only grant allows policy PUT; integrations-only is denied', async () => {
  const viewKeys = ['dashboard.view', 'grow.campaigns.view'];
  const { server, baseUrl } = await makeServer({
    mode: 'on',
    attach: attachGrants([...viewKeys, SETTINGS]),
  });
  try {
    const allowed = await req(baseUrl, 'PUT', POLICY_PUT, { content_safety_mode: 'warning_only' });
    assert.equal(allowed.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }

  const deniedServer = await makeServer({
    mode: 'on',
    attach: attachGrants([...viewKeys, INTEGRATIONS]),
  });
  try {
    const denied = await req(deniedServer.baseUrl, 'PUT', POLICY_PUT, { content_safety_mode: 'warning_only' });
    assert.equal(denied.status, 403);
  } finally {
    await new Promise((r) => deniedServer.server.close(r));
  }
});

const REQUIRE = process.env.PR10H1_REQUIRE_INTEGRATION === '1';
const HAS_DB = !!process.env.DATABASE_URL;

if (!REQUIRE || !HAS_DB) {
  describe('ai-governance policy HTTP enforcement', () => {
    it(REQUIRE ? 'skipped — no DATABASE_URL' : 'skipped — set PR10H1_REQUIRE_INTEGRATION=1', { skip: true }, () => {});
  });
} else {
  const { bootApp, request, login, makeFixtures } = require('./helpers');
  const _aiGovSchema = require('../services/ai_governance/schema');
  const _db = require('../db');

  describe('ai-governance policy HTTP enforcement', () => {
    let app;
    let baseUrl;
    let fx;
    let tenantA;
    let tenantB;
    let ownerCookie;

    before(async () => {
      process.env.SECURITY_CSRF = 'on';
      process.env.PERMISSION_ENFORCEMENT = 'on';
      process.env.MULTITENANT_ENFORCEMENT = 'on';
      fx = makeFixtures();
      await fx.ensureSchemas();
      await _aiGovSchema.ensureAiGovernanceSchema();
      tenantA = await fx.seedTenant('PR10H1-A');
      tenantB = await fx.seedTenant('PR10H1-B');
      const owner = await fx.seedUser({ tenantId: tenantA.id, owner: true });
      app = await bootApp();
      baseUrl = `http://127.0.0.1:${app.port}`;
      const auth = await login(baseUrl, owner.email, owner.password);
      ownerCookie = auth.cookie;
      assert.equal(auth.status, 200);
    });

    after(async () => {
      const scrub = async (tid) => {
        if (!tid) return;
        const p = _db.getPool();
        await p.query('DELETE FROM ai_governance_output_checks WHERE tenant_id=$1', [tid]).catch(() => {});
        await p.query('DELETE FROM ai_governance_events WHERE tenant_id=$1', [tid]).catch(() => {});
        await p.query('DELETE FROM ai_governance_policies WHERE tenant_id=$1', [tid]).catch(() => {});
      };
      await scrub(tenantA?.id);
      await scrub(tenantB?.id);
      if (app?.close) await app.close();
      if (fx) await fx.cleanup();
    });

    it('owner can opt into warning-only with settings permission path', async () => {
      const put = await request(baseUrl, 'PUT', POLICY_PUT, {
        cookie: ownerCookie,
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: { content_safety_mode: 'warning_only' },
      });
      assert.equal(put.status, 200);
      assert.equal(put.json.policy.content_safety_mode, 'warning_only');
      await request(baseUrl, 'PUT', POLICY_PUT, {
        cookie: ownerCookie,
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: { content_safety_mode: 'enforce' },
      });
    });

    it('unauthorised viewer cannot change policy', async () => {
      const viewer = await fx.seedUser({ tenantId: tenantA.id, owner: false, roleKey: 'client_viewer' });
      const auth = await login(baseUrl, viewer.email, viewer.password);
      const put = await request(baseUrl, 'PUT', POLICY_PUT, {
        cookie: auth.cookie,
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: { content_safety_mode: 'warning_only' },
      });
      assert.equal(put.status, 403);
    });

    it('cross-tenant session cannot mutate another tenant policy', async () => {
      const foreignOwner = await fx.seedUser({ tenantId: tenantB.id, owner: true });
      const auth = await login(baseUrl, foreignOwner.email, foreignOwner.password);
      const put = await request(baseUrl, 'PUT', POLICY_PUT, {
        cookie: auth.cookie,
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: { content_safety_mode: 'warning_only' },
      });
      assert.equal(put.status, 200);
      const statusA = await request(baseUrl, 'GET', '/api/ai-governance/status', { cookie: ownerCookie });
      assert.equal(statusA.json.content_safety_mode, 'enforce');
    });

    it('rejects policy PUT without CSRF Origin', async () => {
      const denied = await request(baseUrl, 'PUT', POLICY_PUT, {
        cookie: ownerCookie,
        headers: { 'Content-Type': 'application/json' },
        body: { content_safety_mode: 'enforce' },
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.json.error, 'csrf_rejected');
    });

    it('blocked content audit preview omits raw synthetic identifier', async () => {
      const syntheticId = '123-45-6789';
      const demo = await request(baseUrl, 'POST', '/api/ai-governance/demo-event', {
        cookie: ownerCookie,
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: { text: `Contact ${syntheticId} for details`, forceBlock: false },
      });
      assert.equal(demo.status, 200);
      const audit = await request(baseUrl, 'GET', '/api/ai-governance/audit?limit=5', { cookie: ownerCookie });
      const hit = (audit.json.events || []).find((e) => e.output_preview && e.output_preview.includes('[redacted]'));
      assert.ok(hit, 'expected redacted preview in audit');
      assert.ok(!JSON.stringify(audit.json.events).includes(syntheticId));
    });
  });
}
