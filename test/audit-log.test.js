// test/audit-log.test.js — Role & membership audit log (Task 21)
//
// Verifies that membership / platform-role mutations in the Admin Portal write
// an audit entry (actor, target, workspace, old role, new role) and that the
// read-only GET /audit view returns them. The DB is replaced with an in-memory
// fake that pattern-matches the SQL each route runs, so no Postgres is needed.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// ── In-memory DB fake ───────────────────────────────────────────────────────
const audited = [];               // captured admin_audit_log inserts
let auditSeq = 0;
let memberAddPrior = [];           // controls POST /members prior-membership lookup

function fakeQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();

  if (/INSERT INTO admin_audit_log/.test(s)) {
    const row = {
      id: ++auditSeq,
      tenant_id: params[0], action: params[1],
      actor_user_id: params[2], actor_email: params[3],
      target_user_id: params[4], target_email: params[5],
      workspace_id: params[6], workspace_name: params[7],
      old_role: params[8], new_role: params[9], detail: params[10],
      created_at: new Date().toISOString(),
    };
    audited.push(row);
    return { rows: [{ id: row.id }] };
  }
  // GET /audit listing
  if (/FROM admin_audit_log a/.test(s) && /SELECT a\.id/.test(s)) {
    return { rows: audited.slice().reverse() };
  }
  if (/FROM admin_audit_log a?\b/.test(s) && /GROUP BY action/.test(s)) {
    return { rows: [] };
  }
  // role lookups
  if (/FROM roles WHERE tenant_id IS NULL AND key='platform_admin'/.test(s)) {
    return { rows: [{ id: 9, name: 'Platform Admin' }] };
  }
  if (/FROM roles WHERE tenant_id IS NULL AND key=\$1/.test(s)) {
    const key = params[0];
    const map = { marketer: 'Marketer', analyst: 'Analyst', tenant_admin: 'Tenant Admin' };
    if (!map[key]) return { rows: [] };
    return { rows: [{ id: 100 + Object.keys(map).indexOf(key), name: map[key], scope: 'tenant' }] };
  }
  // prior membership lookup (PATCH/DELETE member, cancel invite)
  if (/FROM tenant_users tu/.test(s) && /JOIN users u/.test(s)) {
    return { rows: [{ email: 'target@example.com', role_name: 'Analyst', workspace_name: 'Acme', status: 'active' }] };
  }
  // POST /members: user + workspace existence checks
  if (/SELECT email FROM users WHERE id=\$1/.test(s)) return { rows: [{ email: 'target@example.com' }] };
  if (/FROM tenants WHERE id=\$1 AND status/.test(s)) return { rows: [{ name: 'Acme' }] };
  // member add prior lookup (LEFT JOIN, no users join)
  if (/FROM tenant_users tu LEFT JOIN roles r/.test(s)) {
    return { rows: memberAddPrior };
  }
  if (/INSERT INTO tenant_users/.test(s)) return { rows: [{ user_id: params[1] }] };
  if (/UPDATE tenant_users SET role_id/.test(s)) return { rows: [{ user_id: params[1] }] };
  if (/DELETE FROM tenant_users/.test(s)) return { rows: [{ user_id: params[1] }] };
  // platform-role route
  if (/SELECT email, is_owner FROM users/.test(s)) return { rows: [{ email: 'pa@example.com', is_owner: false }] };
  if (/FROM platform_users pu/.test(s)) return { rows: [] };
  if (/DELETE FROM platform_users/.test(s)) return { rows: [] };
  if (/INSERT INTO platform_users/.test(s)) return { rows: [] };

  return { rows: [] };
}

const db = require('../db');
db.hasDb = () => true;
db.getPool = () => ({ query: async (sql, params) => fakeQuery(sql, params) });

// Platform-role changes have no workspace, so the audit attributes them to the
// default tenant via getCronTenantId(); stub it so the fake DB doesn't need the
// tenant-resolution queries.
const tenantCtx = require('../services/tenants/context');
tenantCtx.getCronTenantId = async () => 1;

const audit = require('../services/admin/audit');

let server, PORT;

before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  // Logged-in platform owner so the admin router's self-gate passes.
  app.use((req, _res, next) => { req.user = { id: 1, email: 'owner@example.com', name: 'Owner', isOwner: true }; next(); });
  app.use('/api/admin', require('../services/admin/api'));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: route, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); } catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on('error', reject);
    if (data) req.write(data); req.end();
  });
}

// ── Unit: recordAudit writes the expected columns ───────────────────────────
test('recordAudit persists actor/target/old/new role', async () => {
  audited.length = 0;
  const r = await audit.recordAudit({
    action: 'membership.role_change', actorUserId: 1, actorEmail: 'owner@example.com',
    targetUserId: 7, targetEmail: 't@example.com', tenantId: 3, workspaceId: 3,
    workspaceName: 'Acme', oldRole: 'Analyst', newRole: 'Marketer',
  });
  assert.equal(r.ok, true);
  assert.equal(audited.length, 1);
  const e = audited[0];
  assert.equal(e.action, 'membership.role_change');
  assert.equal(e.actor_email, 'owner@example.com');
  assert.equal(e.target_user_id, 7);
  assert.equal(e.old_role, 'Analyst');
  assert.equal(e.new_role, 'Marketer');
  assert.equal(e.tenant_id, 3);
});

test('recordAudit is best-effort: returns ok:false, never throws, when no DB', async () => {
  const orig = db.hasDb; db.hasDb = () => false;
  const r = await audit.recordAudit({ action: 'x' });
  assert.equal(r.ok, false);
  db.hasDb = orig;
});

// ── Route: changing a workspace role logs an entry ──────────────────────────
test('PATCH member role records membership.role_change', async () => {
  audited.length = 0;
  const { status, body } = await request('PATCH', '/api/admin/workspaces/3/members/7', { roleKey: 'marketer' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(audited.length, 1);
  assert.equal(audited[0].action, 'membership.role_change');
  assert.equal(audited[0].new_role, 'Marketer');
  assert.equal(audited[0].old_role, 'Analyst');
  assert.equal(audited[0].actor_email, 'owner@example.com');
});

// ── Route: removing a member logs an entry ──────────────────────────────────
test('DELETE member records membership.remove', async () => {
  audited.length = 0;
  const { status } = await request('DELETE', '/api/admin/workspaces/3/members/7');
  assert.equal(status, 200);
  assert.equal(audited.length, 1);
  assert.equal(audited[0].action, 'membership.remove');
  assert.equal(audited[0].new_role, null);
  assert.equal(audited[0].old_role, 'Analyst');
});

// ── Route: adding a member logs an entry with the new role ──────────────────
test('POST member (first add) records membership.add with new_role', async () => {
  audited.length = 0;
  memberAddPrior = [];                          // not yet a member
  const { status, body } = await request('POST', '/api/admin/workspaces/3/members', { userId: 7, roleKey: 'marketer' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(audited.length, 1);
  assert.equal(audited[0].action, 'membership.add');
  assert.equal(audited[0].new_role, 'Marketer');   // regression: must not be null/undefined
  assert.equal(audited[0].old_role, null);
});

test('POST member (re-upsert) records membership.role_change with old & new role', async () => {
  audited.length = 0;
  memberAddPrior = [{ role_name: 'Analyst', status: 'active' }];   // already an active member
  const { status, body } = await request('POST', '/api/admin/workspaces/3/members', { userId: 7, roleKey: 'marketer' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(audited.length, 1);
  assert.equal(audited[0].action, 'membership.role_change');
  assert.equal(audited[0].old_role, 'Analyst');
  assert.equal(audited[0].new_role, 'Marketer');
  memberAddPrior = [];
});

// ── Route: granting & revoking platform admin logs entries ──────────────────
test('PATCH platform-role grant records platform_role.grant', async () => {
  audited.length = 0;
  const { status, body } = await request('PATCH', '/api/admin/users/7/platform-role', { roleKey: 'platform_admin' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(audited.length, 1);
  assert.equal(audited[0].action, 'platform_role.grant');
  assert.equal(audited[0].new_role, 'Platform Admin');
  assert.equal(audited[0].target_email, 'pa@example.com');
});

test('PATCH platform-role revoke records platform_role.revoke', async () => {
  audited.length = 0;
  const { status } = await request('PATCH', '/api/admin/users/7/platform-role', { roleKey: null });
  assert.equal(status, 200);
  assert.equal(audited.length, 1);
  assert.equal(audited[0].action, 'platform_role.revoke');
  assert.equal(audited[0].new_role, null);
});

// ── Route: GET /audit returns recorded entries (read-only view) ─────────────
test('GET /audit returns the recorded entries', async () => {
  audited.length = 0;
  await audit.recordAudit({ action: 'membership.add', actorEmail: 'owner@example.com', tenantId: 3, newRole: 'Analyst' });
  const { status, body } = await request('GET', '/api/admin/audit');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.entries));
  assert.ok(body.entries.some((e) => e.action === 'membership.add'));
});
