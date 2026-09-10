'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('client reporting portal UI and routes are wired', () => {
  const profiles = fs.readFileSync(path.join(__dirname, '../components/features/manage/ClientReportingProfiles.tsx'), 'utf8');
  assert.match(profiles, /ClientReportingPortal/);
  assert.ok(fs.existsSync(path.join(__dirname, '../components/features/manage/ClientReportingPortal.tsx')));
  assert.ok(fs.existsSync(path.join(__dirname, '../app/client-report/invite/[token]/page.tsx')));
  assert.ok(fs.existsSync(path.join(__dirname, '../app/client-report/view/page.tsx')));
  const lib = fs.readFileSync(path.join(__dirname, '../lib/clientReportingPortal.ts'), 'utf8');
  assert.match(lib, /\/api\/client-reporting\/portal/);
});
