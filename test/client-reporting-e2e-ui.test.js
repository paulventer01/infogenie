'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('PR10F.9 end-to-end acceptance assets are wired', () => {
  const browser = path.join(__dirname, 'browser/client-reporting-e2e.test.js');
  const doc = path.join(__dirname, '../docs/pr10f9-client-reporting-e2e.md');
  const workflow = path.join(__dirname, '../.github/workflows/client-reporting-ui.yml');
  assert.ok(fs.existsSync(browser), 'browser e2e suite exists');
  assert.ok(fs.existsSync(doc), 'Gap 7 closeout doc exists');
  const workflowText = fs.readFileSync(workflow, 'utf8');
  assert.match(workflowText, /PR10F9_REQUIRE_BROWSER/);
  assert.match(workflowText, /client-reporting-e2e/);
  const e2e = fs.readFileSync(browser, 'utf8');
  assert.match(e2e, /PR10F9_REQUIRE_BROWSER/);
  assert.match(e2e, /installMailCapture/);
  assert.match(e2e, /portal\/redeem/);
  assert.match(e2e, /csrf_rejected/);
});
