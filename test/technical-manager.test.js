'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runTechnicalScan } = require('../services/technical_manager/scan');
const matrix = require('../services/tenants/permission_matrix');

describe('Technical Manager scan', () => {
  it('returns overall status, events, and approval-gated plan', async () => {
    const snap = await runTechnicalScan(null);
    assert.equal(snap.ok, true);
    assert.equal(snap.role, 'technical');
    assert.ok(['healthy', 'watch', 'degraded', 'critical'].includes(snap.overall));
    assert.ok(Array.isArray(snap.events));
    assert.ok(Array.isArray(snap.plan_of_action));
    assert.ok(Array.isArray(snap.tooling_gaps));
    assert.ok(snap.counts);
    assert.match(snap.meeting_note || '', /management meetings/i);
  });

  it('flags missing session secret as critical when unset', async () => {
    const prev = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      const snap = await runTechnicalScan(null);
      assert.ok(snap.events.some((e) => e.area === 'auth' && e.severity === 'critical'));
    } finally {
      if (prev != null) process.env.SESSION_SECRET = prev;
    }
  });
});

describe('Technical Manager registration', () => {
  it('maps API + view permissions', () => {
    assert.equal(matrix.requiredPermissionForRequest('/api/technical-manager/scan', 'POST').matched, true);
    assert.equal(matrix.COMPONENT_MATRIX['technical-manager'], 'dashboard.view');
  });
});
