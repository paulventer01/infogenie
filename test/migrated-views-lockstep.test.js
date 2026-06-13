'use strict';
// test/migrated-views-lockstep.test.js — Phase 3 panel-migration drift guard
//
// The React panel migration relies on THREE lists staying in perfect lockstep:
//   1. lib/migratedViews.ts      — MIGRATED_VIEWS (the source-of-truth list of
//      ported `data-view` ids, → MIGRATED_VIEW_IDS).
//   2. components/features/registry.tsx — MIGRATED_COMPONENTS (view id → React
//      component map that <MigratedPanel/> renders from).
//   3. lib/viewRoutes.ts         — NAV_GROUPS (the nav definitions, → the derived
//      ALL_VIEW_IDS set of every real `data-view`).
//
// If these drift, a panel silently renders blank (registered as migrated but no
// component) or double-renders (component present but not flagged migrated), or a
// migrated id points at a `data-view` that no longer exists in the nav. A typo or
// a forgotten entry is invisible until a user hits the panel. This test fails
// loudly the moment any of the three fall out of sync.
//
// HOW IT READS TS: the three files are TypeScript/TSX. Rather than fragile regex,
// we transpile each with the real TypeScript compiler and execute the emitted
// CommonJS to read the ACTUAL exported values. migratedViews.ts and viewRoutes.ts
// have no runtime imports (only erased type imports), so they run as-is.
// registry.tsx imports many React components — we stub `require` so each import
// resolves to a dummy, which keeps MIGRATED_COMPONENTS's real KEYS while throwing
// away the (irrelevant here) component bodies.
//
// Run: node --test   (or: npm test — the script adds --test-force-exit so the
// suite exits cleanly; see .agents/memory/test-suite-force-exit.md).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

// Transpile a TS/TSX file to CommonJS and execute it, returning module.exports.
// When `stubRequire` is set, every `require(...)` resolves to a callable Proxy
// that yields a dummy for any property access — enough for an import-heavy module
// like the registry to build its export object without resolving real modules.
function loadTsModule(relPath, { stubRequire = false } = {}) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: relPath,
  });
  const mod = { exports: {} };
  const req = stubRequire
    ? () => new Proxy(function dummy() {}, { get: () => function Dummy() {} })
    : require;
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', outputText)(mod.exports, req, mod);
  return mod.exports;
}

const { MIGRATED_VIEWS, MIGRATED_VIEW_IDS } = loadTsModule('lib/migratedViews.ts');
const { MIGRATED_COMPONENTS } = loadTsModule(
  'components/features/registry.tsx',
  { stubRequire: true },
);
const { ALL_VIEW_IDS } = loadTsModule('lib/viewRoutes.ts');

const componentIds = Object.keys(MIGRATED_COMPONENTS);

test('sanity: all three lists loaded and non-empty', () => {
  assert.ok(MIGRATED_VIEWS.length > 0, 'MIGRATED_VIEWS is non-empty');
  assert.ok(componentIds.length > 0, 'MIGRATED_COMPONENTS is non-empty');
  assert.ok(ALL_VIEW_IDS.size > 0, 'NAV_GROUPS yielded view ids');
});

test('MIGRATED_VIEWS has no duplicate view ids', () => {
  const seen = new Set();
  const dupes = [];
  for (const { view } of MIGRATED_VIEWS) {
    if (seen.has(view)) dupes.push(view);
    seen.add(view);
  }
  assert.deepEqual(dupes, [], `duplicate ids in MIGRATED_VIEWS: ${dupes.join(', ')}`);
});

test('every MIGRATED_VIEWS entry has a matching component in the registry', () => {
  const componentSet = new Set(componentIds);
  const missing = [...MIGRATED_VIEW_IDS].filter((id) => !componentSet.has(id));
  assert.deepEqual(
    missing,
    [],
    `migrated views with NO registry component (will render blank): ${missing.join(', ')}`,
  );
});

test('every registry component has a matching MIGRATED_VIEWS entry', () => {
  const extra = componentIds.filter((id) => !MIGRATED_VIEW_IDS.has(id));
  assert.deepEqual(
    extra,
    [],
    `registry components NOT flagged as migrated (legacy panel will double-render): ${extra.join(', ')}`,
  );
});

test('every migrated view id exists as a data-view in NAV_GROUPS', () => {
  const orphans = [...MIGRATED_VIEW_IDS].filter((id) => !ALL_VIEW_IDS.has(id));
  assert.deepEqual(
    orphans,
    [],
    `migrated views with no matching nav data-view (typo or removed nav item): ${orphans.join(', ')}`,
  );
});
