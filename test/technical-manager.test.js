'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runTechnicalScan } = require('../services/technical_manager/scan');
const {
  scanSurfaces,
  inventoryNavViews,
  inventoryMigratedViews,
  inventoryRegistry,
} = require('../services/technical_manager/surfaces');
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
    assert.ok(snap.surfaces);
    assert.ok(typeof snap.counts.surfaces_monitored === 'number');
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

  it('reports permission enforcement when PERMISSION_ENFORCEMENT=on', async () => {
    const prev = process.env.PERMISSION_ENFORCEMENT;
    process.env.PERMISSION_ENFORCEMENT = 'on';
    try {
      const snap = await runTechnicalScan(null);
      assert.equal(snap.security.permission_enforcement, true);
      assert.equal(snap.security.PERMISSION_ENFORCEMENT_env_scan, true);
      assert.equal(snap.security.permissionMode_debug, 'on');
      assert.ok(!snap.events.some((e) => String(e.message || '').includes('PERMISSION_ENFORCEMENT is not on')));
    } finally {
      if (prev != null) process.env.PERMISSION_ENFORCEMENT = prev;
      else delete process.env.PERMISSION_ENFORCEMENT;
    }
  });
});

describe('Technical Manager surface monitor', () => {
  it('inventories nav views, migrated panels, and registry loaders', () => {
    const nav = inventoryNavViews();
    const migrated = inventoryMigratedViews();
    const registry = inventoryRegistry();
    assert.ok(nav.length > 50, 'expected a full nav inventory');
    assert.ok(migrated.length > 50, 'expected migrated views inventory');
    assert.ok(registry.keys.length > 50, 'expected registry loaders');
    assert.ok(registry.imports.length > 20, 'expected component imports');
  });

  it('reports surface counts and probe results', async () => {
    const surfaces = await scanSurfaces();
    assert.ok(surfaces.counts.nav_views > 0);
    assert.ok(surfaces.counts.registry_loaders > 0);
    assert.ok(Array.isArray(surfaces.probes));
    assert.ok(surfaces.probes.length >= 4);
    assert.ok(!surfaces.probes.some((p) => String(p.path || '').includes('technical-manager')));
    assert.ok(Array.isArray(surfaces.issues));
    assert.equal(surfaces.counts.missing_permissions, 0, `missing permission-matrix views: ${(surfaces.missing_permissions || []).join(', ')}`);
  });
});

describe('Technical Manager registration', () => {
  it('maps API + view permissions', () => {
    assert.equal(matrix.requiredPermissionForRequest('/api/technical-manager/scan', 'POST').matched, true);
    assert.equal(matrix.COMPONENT_MATRIX['technical-manager'], 'manage.projects.view');
  });

  it('covers every nav view in COMPONENT_MATRIX', () => {
    const nav = inventoryNavViews();
    const mapped = new Set(Object.keys(matrix.COMPONENT_MATRIX));
    const missing = nav.filter((v) => !mapped.has(v));
    assert.deepEqual(missing, [], `nav views missing COMPONENT_MATRIX: ${missing.join(', ')}`);
  });
});

describe('Technical Manager JD task fallback', () => {
  it('prioritises live page/feature monitoring over advisory busywork', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../services/officer/routes.js'),
      'utf8',
    );
    assert.match(src, /Monitor every page subpage and feature live/);
    assert.match(src, /Track tenant isolation and leakage risk/);
    assert.doesNotMatch(src, /Research missing monitoring tools/);
  });
});
