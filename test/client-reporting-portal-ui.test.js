'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('client reporting portal UI and routes are wired', () => {
  const profiles = fs.readFileSync(path.join(__dirname, '../components/features/manage/ClientReportingProfiles.tsx'), 'utf8');
  assert.match(profiles, /ClientReportingPortal/);
  assert.match(profiles, /ClientReportingPortalFeedback/);
  assert.match(fs.readFileSync(path.join(__dirname, '../components/features/manage/ClientReportingReport.tsx'), 'utf8'), /ClientReportingApprovals/);
  assert.ok(fs.existsSync(path.join(__dirname, '../components/features/manage/ClientReportingPortal.tsx')));
  assert.ok(fs.existsSync(path.join(__dirname, '../components/features/manage/ClientReportingPortalFeedback.tsx')));
  assert.ok(fs.existsSync(path.join(__dirname, '../components/features/manage/ClientReportingApprovals.tsx')));
  assert.ok(fs.existsSync(path.join(__dirname, '../components/features/shared/ClientPortalFeedbackPanel.tsx')));
  assert.ok(fs.existsSync(path.join(__dirname, '../components/features/shared/ClientPortalApprovalPanel.tsx')));
  assert.ok(fs.existsSync(path.join(__dirname, '../lib/clientReportingApprovals.ts')));
  assert.ok(fs.existsSync(path.join(__dirname, '../app/client-report/invite/[token]/page.tsx')));
  assert.ok(fs.existsSync(path.join(__dirname, '../app/client-report/view/page.tsx')));
  const lib = fs.readFileSync(path.join(__dirname, '../lib/clientReportingPortal.ts'), 'utf8');
  assert.match(lib, /\/api\/client-reporting\/portal/);
});
