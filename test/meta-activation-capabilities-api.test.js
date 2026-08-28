'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../services/agent_orchestrator/meta_activation_capabilities_api');
const capability = require('../services/security/meta_activation_capabilities');

function request(overrides = {}) {
  return {
    user: { id: 7 }, session: { userId: 7 }, sessionID: 'human-session',
    tenantRole: { permissions: [capability.PERMISSION] }, body: {}, ...overrides,
  };
}

test('adapter requires a real human session and rejects non-human principals', () => {
  assert.equal(api._isHumanSessionRequest(request()), true);
  for (const req of [request({ session: null }), request({ sessionID: '' }),
    request({ viaApiKey: true }), request({ user: { id: 7, principalType: 'worker' } }),
    request({ user: { id: 7, viaApiKey: true } })]) {
    assert.equal(api._isHumanSessionRequest(req), false);
  }
});

test('adapter accepts only the exact active-tenant grant without owner/admin bypass', () => {
  assert.equal(api._hasExplicitTenantGrant(request()), true);
  assert.equal(api._hasExplicitTenantGrant(request({ tenantRole: { key: 'owner', permissions: [] } })), false);
  assert.equal(api._hasExplicitTenantGrant(request({ tenantRole: { key: 'admin', permissions: ['*'] } })), false);
  assert.equal(api._hasExplicitTenantGrant(request({ tenantRole: { permissions: ['advertising.campaign.edit'] } })), false);
});

test('issue adapter maps only immutable request bindings and fixed human authority', () => {
  const req = request({ body: {
    campaign_draft_id: 'draft', campaign_draft_revision: 3, approved_snapshot_hash: 'snapshot',
    publish_approval_id: 'approval', publishing_request_id: 'request', delivery_intent_id: 'intent',
    provider_draft_execution_id: 'execution', reconciliation_run_id: 'reconciliation',
    advertising_account_id: 'account', credential_reference_id: 'credential', credential_reference_version: 4,
    account_fingerprint: 'a'.repeat(64), provider_ledger_root: 'b'.repeat(64),
    final_confirmation_id: 'confirmation', final_confirmation: capability.CONFIRMATION,
    confirmed_at: '2026-08-28T00:00:00.000Z', ttl_ms: 1000,
    principalType: 'service', actorUserId: 999, tenantId: 999,
  } });
  const input = api._issueInput(req, 12);
  assert.equal(input.tenantId, 12); assert.equal(input.actorUserId, 7);
  assert.equal(input.principalType, 'user'); assert.equal(input.sessionId, 'human-session');
  assert.equal(input.executionId, 'execution'); assert.equal(input.credentialRefVersion, 4);
  assert.deepEqual(input.hasExplicitTenantPermission(capability.PERMISSION), true);
});

test('transaction commits success and rolls back failures', async () => {
  const original = require('../db').getPool;
  const calls = [];
  const client = { query: async (sql) => calls.push(sql), release: () => calls.push('RELEASE') };
  require('../db').getPool = () => ({ connect: async () => client });
  try {
    assert.equal(await api._transaction(async () => 'ok'), 'ok');
    assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'RELEASE']);
    calls.length = 0;
    await assert.rejects(api._transaction(async () => { throw new Error('fail'); }), /fail/);
    assert.deepEqual(calls, ['BEGIN', 'ROLLBACK', 'RELEASE']);
  } finally { require('../db').getPool = original; }
});

test('public router exposes issue and revoke only, never reserve, consume or activation', () => {
  const paths = api.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.deepEqual(paths, ['/', '/:capabilityId/revoke']);
  assert.ok(api.stack.filter((layer) => layer.route).every((layer) => layer.route.methods.post));
});
