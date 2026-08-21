// test/tenant-closeout-isolation.test.js — runtime isolation for the four
// closeout write paths Security flagged. Static scan lives in
// test/tenant-closeout-write-audit.test.js; this file proves the handlers
// actually refuse cross-tenant access against live Postgres.
//
//   • custom playbook created by A cannot be activated or read by B (404)
//   • two tenants can both monitor the same domain; ON CONFLICT is per-tenant
//   • checklist items / post_launch_checks insert with tenant_id; cross-tenant
//     item update is 404
//
// Gated on DATABASE_URL. Tenant identity is taken from x-test-tid →
// resolveTenantId (the same trusted-context stamp the handlers use); request
// bodies that spoof tenant_id are ignored.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
require('./helpers/env');

const db = require('../db');
const { hasDb } = require('./helpers');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureLaunchComplianceSchema } = require('../services/launch_compliance/schema');
const { ensurePostLaunchAuditSchema } = require('../services/post_launch_audit/schema');
const { ensureVerticalPlaybooksSchema } = require('../services/vertical_playbooks/schema');
const { ensureBacklinkMonitorSchema } = require('../services/backlink_monitor/schema');
const tenantCtx = require('../services/tenants/context');

const HAS_DB = hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — closeout isolation skipped';

const SUFFIX = `co-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const SHARED_DOMAIN = `shared-${SUFFIX}.example`;

const savedOpenAi = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const savedOpenaiKey = process.env.OPENAI_API_KEY;
const originalResolve = tenantCtx.resolveTenantId;

let tenantA = null;
let tenantB = null;
let server = null;
let PORT = 0;

function req(method, path, { tid, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (tid != null) headers['x-test-tid'] = String(tid);
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

before(async () => {
  if (!HAS_DB) return;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  await ensureTenantSchema();
  await ensureLaunchComplianceSchema();
  await ensurePostLaunchAuditSchema();
  await ensureVerticalPlaybooksSchema();
  await ensureBacklinkMonitorSchema();
  // CREATE TABLE IF NOT EXISTS does not add columns to a pre-existing table.
  // schema.js declares alert_slack_webhook; older installs may lack the ALTER.
  await db.getPool().query(
    `ALTER TABLE backlink_monitors ADD COLUMN IF NOT EXISTS alert_slack_webhook TEXT`
  );

  tenantCtx.resolveTenantId = async (reqObj) => {
    const h = reqObj && reqObj.headers && reqObj.headers['x-test-tid'];
    if (h == null || h === '') return null;
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n : null;
  };

  const p = db.getPool();
  const mk = async (label, slug) => (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [label, slug]
  )).rows[0].id;
  tenantA = await mk(`Closeout A ${SUFFIX}`, `closeout-a-${SUFFIX}`);
  tenantB = await mk(`Closeout B ${SUFFIX}`, `closeout-b-${SUFFIX}`);

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/launch-compliance', require('../services/launch_compliance/api'));
  app.use('/api/post-launch-audit', require('../services/post_launch_audit/api'));
  app.use('/api/playbooks', require('../services/vertical_playbooks/api'));
  app.use('/api/backlink-monitor', require('../services/backlink_monitor/api'));
  await new Promise(r => { server = app.listen(0, '127.0.0.1', () => { PORT = server.address().port; r(); }); });
});

after(async () => {
  tenantCtx.resolveTenantId = originalResolve;
  if (savedOpenAi === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = savedOpenAi;
  if (savedOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedOpenaiKey;

  if (server) await new Promise(r => server.close(r));
  if (!HAS_DB) return;
  const p = db.getPool();
  const ids = [tenantA, tenantB].filter(Boolean);
  if (!ids.length) return;
  await p.query(`DELETE FROM active_playbooks WHERE tenant_id = ANY($1)`, [ids]).catch(() => {});
  await p.query(`DELETE FROM vertical_playbooks WHERE tenant_id = ANY($1)`, [ids]).catch(() => {});
  await p.query(`DELETE FROM backlink_monitors WHERE tenant_id = ANY($1)`, [ids]).catch(() => {});
  await p.query(`DELETE FROM campaign_compliance_checklists WHERE tenant_id = ANY($1)`, [ids]).catch(() => {});
  await p.query(`DELETE FROM post_launch_audits WHERE tenant_id = ANY($1)`, [ids]).catch(() => {});
  await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]).catch(() => {});
});

// ── vertical_playbooks: live cross-tenant activate leak ──────────────────────

test('custom playbook created by A cannot be activated or read by B (404)', { skip }, async () => {
  const created = await req('POST', '/api/playbooks/generate-custom', {
    tid: tenantA,
    body: {
      industry: `iso-${SUFFIX}`,
      business_description: 'isolation fixture',
      tenant_id: tenantB, // spoof — must be ignored
    },
  });
  assert.strictEqual(created.status, 200, created.text);
  assert.ok(created.json && created.json.ok);
  const playbookId = created.json.playbook.id;
  assert.ok(Number.isFinite(playbookId));

  const p = db.getPool();
  const row = (await p.query(
    `SELECT tenant_id, is_system FROM vertical_playbooks WHERE id=$1`, [playbookId]
  )).rows[0];
  assert.strictEqual(row.tenant_id, tenantA, 'custom INSERT stamps resolved tid, not body.tenant_id');
  assert.strictEqual(row.is_system, false);

  const activateB = await req('POST', `/api/playbooks/activate/${playbookId}`, { tid: tenantB });
  assert.strictEqual(activateB.status, 404, 'tenant B must not activate tenant A\'s custom playbook');
  assert.ok(activateB.json && activateB.json.ok === false);
  assert.ok(!/tenant A|workspace/i.test(activateB.text), '404 must not disclose the foreign playbook');

  const listB = await req('GET', '/api/playbooks/active/list', { tid: tenantB });
  assert.strictEqual(listB.status, 200, listB.text);
  const leaked = (listB.json.active || []).some(r =>
    r.title === created.json.playbook.title ||
    (r.content && r.content.title === created.json.playbook.title)
  );
  assert.strictEqual(leaked, false, 'tenant B must not read tenant A custom content via /active/list');

  const activateA = await req('POST', `/api/playbooks/activate/${playbookId}`, { tid: tenantA });
  assert.strictEqual(activateA.status, 200, activateA.text);
  assert.ok(activateA.json && activateA.json.ok);

  const listA = await req('GET', '/api/playbooks/active/list', { tid: tenantA });
  assert.strictEqual(listA.status, 200, listA.text);
  assert.ok((listA.json.active || []).some(r => r.title === created.json.playbook.title),
    'tenant A can read its own custom playbook via /active/list');
});

test('stale active_playbooks mapping does not disclose foreign custom playbook content', { skip }, async () => {
  const created = await req('POST', '/api/playbooks/generate-custom', {
    tid: tenantA,
    body: {
      industry: `stale-${SUFFIX}`,
      business_description: 'stale mapping fixture',
    },
  });
  assert.strictEqual(created.status, 200, created.text);
  assert.ok(created.json && created.json.ok);
  const playbookId = created.json.playbook.id;
  const secretTitle = created.json.playbook.title;
  assert.ok(Number.isFinite(playbookId));
  assert.ok(secretTitle);

  const p = db.getPool();
  // Pre-fix mapping: tenant B paired with tenant A's custom playbook.
  // Keep the row — /active/list must hide the content, not DELETE the mapping.
  await p.query(
    `INSERT INTO active_playbooks(tenant_id,playbook_id,progress)
     VALUES($1,$2,'{}')
     ON CONFLICT(tenant_id,playbook_id) DO NOTHING`,
    [tenantB, playbookId]
  );
  const mapping = (await p.query(
    `SELECT id FROM active_playbooks WHERE tenant_id=$1 AND playbook_id=$2`,
    [tenantB, playbookId]
  )).rows[0];
  assert.ok(mapping, 'stale mapping row must be stored');

  const listB = await req('GET', '/api/playbooks/active/list', { tid: tenantB });
  assert.strictEqual(listB.status, 200, listB.text);
  const leaked = (listB.json.active || []).some(r =>
    r.title === secretTitle ||
    (r.content && (r.content.title === secretTitle || JSON.stringify(r.content).includes(secretTitle)))
  );
  assert.strictEqual(leaked, false, 'tenant B must not receive tenant A custom AI content via stale mapping');

  const stillThere = (await p.query(
    `SELECT id FROM active_playbooks WHERE tenant_id=$1 AND playbook_id=$2`,
    [tenantB, playbookId]
  )).rows[0];
  assert.ok(stillThere, 'list must not DELETE the stale mapping row');

  const listA = await req('GET', '/api/playbooks/active/list', { tid: tenantA });
  assert.strictEqual(listA.status, 200, listA.text);
  assert.ok((listA.json.active || []).some(r => r.title === secretTitle),
    'tenant A can still see its own custom playbook');
});

test('system catalog playbooks remain activatable by any tenant', { skip }, async () => {
  const list = await req('GET', '/api/playbooks/list');
  assert.strictEqual(list.status, 200, list.text);
  assert.ok(list.json.playbooks && list.json.playbooks.length > 0, 'system catalog must seed');
  const sysId = list.json.playbooks[0].id;

  const a = await req('POST', `/api/playbooks/activate/${sysId}`, { tid: tenantA });
  assert.strictEqual(a.status, 200, a.text);
  const b = await req('POST', `/api/playbooks/activate/${sysId}`, { tid: tenantB });
  assert.strictEqual(b.status, 200, b.text);
});

// ── backlink_monitors: per-tenant ON CONFLICT (tenant_id, domain) ────────────

test('two tenants can both monitor the same domain; ON CONFLICT is per-tenant', { skip }, async () => {
  const noTid = await req('POST', '/api/backlink-monitor/domains', {
    body: { domain: SHARED_DOMAIN },
  });
  assert.strictEqual(noTid.status, 400, 'missing tid must 400, not insert');

  const a1 = await req('POST', '/api/backlink-monitor/domains', {
    tid: tenantA,
    body: { domain: SHARED_DOMAIN, alert_email: 'a@example.com', tenant_id: tenantB },
  });
  assert.strictEqual(a1.status, 200, a1.text);
  assert.strictEqual(a1.json.monitor.tenant_id, tenantA);
  assert.strictEqual(a1.json.monitor.alert_email, 'a@example.com');

  const b1 = await req('POST', '/api/backlink-monitor/domains', {
    tid: tenantB,
    body: { domain: SHARED_DOMAIN, alert_email: 'b@example.com' },
  });
  assert.strictEqual(b1.status, 200, b1.text);
  assert.strictEqual(b1.json.monitor.tenant_id, tenantB);
  assert.notStrictEqual(b1.json.monitor.id, a1.json.monitor.id,
    'same domain must be two independent rows');

  const a2 = await req('POST', '/api/backlink-monitor/domains', {
    tid: tenantA,
    body: { domain: SHARED_DOMAIN, alert_email: 'a-updated@example.com' },
  });
  assert.strictEqual(a2.status, 200, a2.text);
  assert.strictEqual(a2.json.monitor.id, a1.json.monitor.id, 'same-tenant upsert, not a new row');
  assert.strictEqual(a2.json.monitor.alert_email, 'a-updated@example.com');

  const p = db.getPool();
  const rows = (await p.query(
    `SELECT tenant_id, alert_email FROM backlink_monitors
      WHERE domain=$1 AND tenant_id = ANY($2) ORDER BY tenant_id`,
    [SHARED_DOMAIN, [tenantA, tenantB]]
  )).rows;
  assert.strictEqual(rows.length, 2);
  const byTid = new Map(rows.map(r => [r.tenant_id, r.alert_email]));
  assert.strictEqual(byTid.get(tenantA), 'a-updated@example.com');
  assert.strictEqual(byTid.get(tenantB), 'b@example.com',
    'tenant A upsert must not clobber tenant B\'s row');
});

// ── launch_compliance + post_launch_audit child stamps ───────────────────────

test('checklist items insert with tenant_id; cross-tenant item update is 404', { skip }, async () => {
  const created = await req('POST', '/api/launch-compliance/checklists', {
    tid: tenantA,
    body: { campaign_name: `iso-check-${SUFFIX}`, tenant_id: tenantB },
  });
  assert.strictEqual(created.status, 200, created.text);
  assert.ok(created.json.checklist && created.json.checklist.items.length > 0);
  assert.strictEqual(created.json.checklist.tenant_id, tenantA);

  const itemId = created.json.checklist.items[0].id;
  const p = db.getPool();
  const itemRow = (await p.query(
    `SELECT tenant_id FROM compliance_checklist_items WHERE id=$1`, [itemId]
  )).rows[0];
  assert.strictEqual(itemRow.tenant_id, tenantA, 'child items stamp resolved tid');

  const foreign = await req('PUT', `/api/launch-compliance/items/${itemId}`, {
    tid: tenantB,
    body: { status: 'pass', tenant_id: tenantA },
  });
  assert.strictEqual(foreign.status, 404, 'tenant B must not update tenant A\'s checklist item');

  const own = await req('PUT', `/api/launch-compliance/items/${itemId}`, {
    tid: tenantA,
    body: { status: 'pass' },
  });
  assert.strictEqual(own.status, 200, own.text);
  assert.ok(own.json && own.json.ok);
  assert.strictEqual(own.json.item.status, 'pass');
});

test('post_launch_checks insert with tenant_id; cross-tenant audit update is 404', { skip }, async () => {
  const created = await req('POST', '/api/post-launch-audit/audits', {
    tid: tenantA,
    body: { campaign_name: `iso-audit-${SUFFIX}`, tenant_id: tenantB },
  });
  assert.strictEqual(created.status, 200, created.text);
  const auditId = created.json.audit.id;
  assert.strictEqual(created.json.audit.tenant_id, tenantA);

  const p = db.getPool();
  const checks = (await p.query(
    `SELECT tenant_id, check_type FROM post_launch_checks WHERE audit_id=$1`, [auditId]
  )).rows;
  assert.ok(checks.length >= 4, 'seeded check slots');
  assert.ok(checks.every(c => c.tenant_id === tenantA), 'every check stamps resolved tid');

  const getB = await req('GET', `/api/post-launch-audit/audits/${auditId}`, { tid: tenantB });
  assert.strictEqual(getB.status, 404);

  const runB = await req('POST', `/api/post-launch-audit/audits/${auditId}/run-live-check`, { tid: tenantB });
  assert.strictEqual(runB.status, 404, 'tenant B must not update tenant A\'s checks');

  const getA = await req('GET', `/api/post-launch-audit/audits/${auditId}`, { tid: tenantA });
  assert.strictEqual(getA.status, 200, getA.text);
  assert.ok((getA.json.audit.checks || []).length >= 4);
});
