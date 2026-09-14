// test/browser/content-safety-governance.test.js — PR10H.1 representative API flow
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const REQUIRE = process.env.PR10H1_REQUIRE_BROWSER === '1';
const HAS_DB = !!process.env.DATABASE_URL;

if (!REQUIRE || !HAS_DB) {
  describe('PR10H.1 governance hub browser', () => {
    it(REQUIRE ? 'skipped — no DATABASE_URL' : 'skipped — set PR10H1_REQUIRE_BROWSER=1', { skip: true }, () => {});
  });
} else {
  const { bootApp, request, login, makeFixtures } = require('../helpers');
  const _aiGovSchema = require('../../services/ai_governance/schema');

  describe('PR10H.1 governance hub browser', () => {
    let app;
    let baseUrl;
    let fx;
    let cookie;
    let tenant;

    before(async () => {
      fx = makeFixtures();
      await fx.ensureSchemas();
      await _aiGovSchema.ensureAiGovernanceSchema();
      tenant = await fx.seedTenant('PR10H1');
      const owner = await fx.seedUser({ tenantId: tenant.id, owner: true });
      app = await bootApp();
      baseUrl = `http://127.0.0.1:${app.port}`;
      const auth = await login(baseUrl, owner.email, owner.password);
      cookie = auth.cookie;
      assert.equal(auth.status, 200);
    });

    after(async () => {
      if (tenant?.id && process.env.DATABASE_URL) {
        const _db = require('../../db');
        const p = _db.getPool();
        await p.query('DELETE FROM ai_governance_output_checks WHERE tenant_id=$1', [tenant.id]).catch(() => {});
        await p.query('DELETE FROM ai_governance_events WHERE tenant_id=$1', [tenant.id]).catch(() => {});
        await p.query('DELETE FROM ai_governance_policies WHERE tenant_id=$1', [tenant.id]).catch(() => {});
      }
      if (app?.close) await app.close();
      if (fx) await fx.cleanup();
    });

    it('status shows content safety enforce by default', async () => {
      const res = await request(baseUrl, 'GET', '/api/ai-governance/status', { cookie });
      assert.equal(res.status, 200);
      assert.equal(res.json.content_safety_mode, 'enforce');
      assert.match(res.json.banner, /enforce|blocked/i);
    });

    it('unauthorised warning-only policy change is rejected', async () => {
      const viewer = await fx.seedUser({ tenantId: tenant.id, owner: false, roleKey: 'client_viewer' });
      const memberAuth = await login(baseUrl, viewer.email, viewer.password);
      const res = await request(baseUrl, 'PUT', '/api/ai-governance/policy', {
        cookie: memberAuth.cookie,
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: { content_safety_mode: 'warning_only' },
      });
      assert.equal(res.status, 403);
      assert.ok(res.json.error, 'expected denial error');
      const status = await request(baseUrl, 'GET', '/api/ai-governance/status', { cookie });
      assert.equal(status.json.content_safety_mode, 'enforce');
    });

    it('owner can opt into warning-only and audit receives policy_change', async () => {
      const put = await request(baseUrl, 'PUT', '/api/ai-governance/policy', {
        cookie,
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: { content_safety_mode: 'warning_only' },
      });
      assert.equal(put.status, 200);
      assert.equal(put.json.policy.content_safety_mode, 'warning_only');

      const audit = await request(baseUrl, 'GET', '/api/ai-governance/audit?limit=10', { cookie });
      assert.equal(audit.status, 200);
      const policyEvent = (audit.json.events || []).find((e) => e.action === 'policy_change');
      assert.ok(policyEvent, 'expected policy_change audit event');
    });
  });
}
