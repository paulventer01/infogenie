'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadScheduleLib() {
  const file = path.join(__dirname, '../lib/clientReportingSchedule.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod);
  return mod.exports;
}

test('validDeliveryHistory accepts BIGINT ids serialized as strings', () => {
  const { validDeliveryHistory, normalizeDeliveryHistory } = loadScheduleLib();
  const payload = {
    ok: true,
    client: { id: 11, name: 'Client', slug: null, website: null, status: 'active' },
    deliveries: [{
      id: '42',
      window_key: 'weekly:2026-W10',
      status: 'failed',
      attempted_at: '2026-03-10T09:00:00.000Z',
      recipient_email: 'client@example.com',
      profile_version: 2,
      format: 'pdf',
      error_code: 'mail_unconfigured',
    }],
    has_more: false,
    next_cursor: null,
  };
  assert.equal(validDeliveryHistory(payload, 11), true);
  assert.deepEqual(normalizeDeliveryHistory(payload.deliveries)[0].id, 42);
});

test('validDeliveryHistory rejects malformed delivery rows', () => {
  const { validDeliveryHistory } = loadScheduleLib();
  const base = {
    ok: true,
    client: { id: 11, name: 'Client', slug: null, website: null, status: 'active' },
    deliveries: [],
    has_more: false,
    next_cursor: null,
  };
  assert.equal(validDeliveryHistory({ ...base, deliveries: [{ id: 'abc', status: 'sent' }] }, 11), false);
  assert.equal(validDeliveryHistory({ ...base, client: { ...base.client, id: 12 } }, 11), false);
});
