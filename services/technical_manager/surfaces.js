'use strict';
/**
 * Technical Manager — real-time page / subpage / feature surface inventory.
 *
 * Interprets the CTM job description strictly: if a client-visible surface can
 * fail, the scan must observe it. This module inventories every nav view,
 * migrated React panel, registry loader, permission mapping, and on-disk
 * component file, then probes core API readiness endpoints.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');

function _uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function _read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

function _extractQuoted(re, src) {
  const out = [];
  let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(src))) out.push(m[1]);
  return out;
}

function inventoryNavViews() {
  const src = _read('lib/viewRoutes.ts');
  return _uniq(_extractQuoted(/view:\s*"([^"]+)"/g, src));
}

function inventoryMigratedViews() {
  const src = _read('lib/migratedViews.ts');
  return _uniq(_extractQuoted(/\{\s*view:\s*"([^"]+)"/g, src));
}

function inventoryRegistry() {
  const src = _read('components/features/registry.tsx');
  const keys = _uniq([
    ..._extractQuoted(/"([^"]+)":\s*L\(/g, src),
    ..._extractQuoted(/^\s*([a-z0-9-]+):\s*L\(/gm, src),
  ]);
  const imports = [];
  const importRe = /L\(\s*(?:"[^"]+"|[a-z0-9-]+)\s*,\s*\(\)\s*=>\s*import\(\s*"(@\/[^"]+)"\s*\)/g;
  let m;
  while ((m = importRe.exec(src))) imports.push(m[1]);
  return { keys, imports: _uniq(imports) };
}

function inventoryPermissionViews() {
  try {
    const matrix = require('../tenants/permission_matrix');
    return _uniq(Object.keys(matrix.COMPONENT_MATRIX || {}));
  } catch {
    return [];
  }
}

function resolveImportToFile(importPath) {
  // @/components/... → components/...
  const rel = importPath.replace(/^@\//, '');
  const candidates = [
    rel + '.tsx',
    rel + '.ts',
    rel + '.jsx',
    rel + '.js',
    path.join(rel, 'index.tsx'),
    path.join(rel, 'index.ts'),
  ];
  for (const c of candidates) {
    const abs = path.join(ROOT, c);
    if (fs.existsSync(abs)) return { ok: true, file: c };
  }
  return { ok: false, file: rel };
}

function probeLocal(pathname, timeoutMs = 2500) {
  const port = Number(process.env.EXPRESS_PORT || process.env.PORT || 8000);
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(
      { hostname: '127.0.0.1', port, path: pathname, timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve({
          path: pathname,
          ok: res.statusCode >= 200 && res.statusCode < 500,
          status: res.statusCode,
          ms: Date.now() - started,
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ path: pathname, ok: false, status: 0, ms: Date.now() - started, error: 'timeout' });
    });
    req.on('error', (e) => {
      resolve({ path: pathname, ok: false, status: 0, ms: Date.now() - started, error: e.message });
    });
  });
}

/**
 * Build a surfaces report for the Technical Manager scan.
 * @returns {Promise<object>}
 */
async function scanSurfaces() {
  const navViews = inventoryNavViews();
  const migrated = inventoryMigratedViews();
  const registry = inventoryRegistry();
  const permissionViews = inventoryPermissionViews();

  const missingRegistry = migrated.filter((v) => !registry.keys.includes(v));
  const orphanRegistry = registry.keys.filter((v) => !migrated.includes(v));
  const missingPermissions = navViews.filter((v) => permissionViews.length && !permissionViews.includes(v));

  const missingComponents = [];
  for (const imp of registry.imports) {
    const check = resolveImportToFile(imp);
    if (!check.ok) missingComponents.push(check.file);
  }

  // Core client journeys — always probed live (JD synthetic monitoring).
  // Do NOT probe /api/technical-manager/* here: that re-enters runTechnicalScan
  // and deadlocks the scan under its own HTTP probe.
  const probes = await Promise.all([
    probeLocal('/api/health'),
    probeLocal('/api/ready'),
    probeLocal('/api/auth/me'),
    probeLocal('/api/officer/avatars'),
  ]);
  const failedProbes = probes.filter((p) => !p.ok);

  const issues = [];
  if (missingRegistry.length) {
    issues.push({
      severity: 'critical',
      area: 'surfaces',
      message: `${missingRegistry.length} migrated page(s)/subpage(s) lack a React registry loader — those surfaces will blank.`,
      action: `Register missing views in components/features/registry.tsx: ${missingRegistry.slice(0, 8).join(', ')}`,
      samples: missingRegistry.slice(0, 20),
    });
  }
  if (missingComponents.length) {
    issues.push({
      severity: 'critical',
      area: 'surfaces',
      message: `${missingComponents.length} feature component file(s) missing on disk — linked pages cannot render.`,
      action: `Restore component files: ${missingComponents.slice(0, 6).join(', ')}`,
      samples: missingComponents.slice(0, 20),
    });
  }
  if (failedProbes.length) {
    issues.push({
      severity: 'high',
      area: 'surfaces',
      message: `${failedProbes.length} core API journey probe(s) failed — clients may see broken features.`,
      action: `Restore failing endpoints: ${failedProbes.map((p) => p.path).join(', ')}`,
      samples: failedProbes,
    });
  }
  if (missingPermissions.length > 12) {
    issues.push({
      severity: 'medium',
      area: 'surfaces',
      message: `${missingPermissions.length} nav views lack COMPONENT_MATRIX permission entries.`,
      action: 'Map missing views in services/tenants/permission_matrix.js',
      samples: missingPermissions.slice(0, 20),
    });
  } else if (missingPermissions.length) {
    issues.push({
      severity: 'low',
      area: 'surfaces',
      message: `${missingPermissions.length} nav view(s) missing permission matrix entries.`,
      action: 'Map missing views in services/tenants/permission_matrix.js',
      samples: missingPermissions.slice(0, 20),
    });
  }
  if (orphanRegistry.length > 30) {
    // Informational only — aliases/deep-links often register without a migratedViews row.
    issues.push({
      severity: 'info',
      area: 'surfaces',
      message: `${orphanRegistry.length} registry loaders are not listed in migratedViews (aliases/deep-links are OK).`,
      action: 'Confirm intentional aliases vs drift',
      samples: orphanRegistry.slice(0, 12),
    });
  }

  const pagesOk =
    missingRegistry.length === 0 &&
    missingComponents.length === 0 &&
    failedProbes.length === 0;

  return {
    ok: pagesOk,
    generated_at: new Date().toISOString(),
    counts: {
      nav_views: navViews.length,
      migrated_views: migrated.length,
      registry_loaders: registry.keys.length,
      permission_mapped: permissionViews.length,
      missing_registry: missingRegistry.length,
      missing_components: missingComponents.length,
      missing_permissions: missingPermissions.length,
      orphan_registry: orphanRegistry.length,
      api_probes: probes.length,
      api_probes_failed: failedProbes.length,
      surfaces_monitored: navViews.length + registry.keys.length,
    },
    missing_registry: missingRegistry.slice(0, 40),
    missing_components: missingComponents.slice(0, 40),
    missing_permissions: missingPermissions.slice(0, 40),
    probes,
    issues,
    note:
      'Real-time surface monitor: every nav page/subpage, React feature panel, permission mapping, and core API journey is checked on each Technical Manager scan.',
  };
}

module.exports = {
  scanSurfaces,
  inventoryNavViews,
  inventoryMigratedViews,
  inventoryRegistry,
  resolveImportToFile,
};
