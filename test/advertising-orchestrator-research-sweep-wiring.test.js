'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('scripts/start.js still spawns node server.js in production', () => {
  const src = fs.readFileSync(path.join(__dirname, '../scripts/start.js'), 'utf8');
  assert.match(src, /run\(\s*"express"\s*,\s*"node"\s*,\s*\[\s*"server\.js"\s*\]/);
  assert.match(src, /NODE_ENV:\s*"production"/);
});

test('server.js enables background before requiring research_retention', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const bgIdx = src.indexOf('_runtimeFlags.setBackground(require.main === module)');
  const requireIdx = src.indexOf("require('./services/agent_orchestrator/research_retention')");
  assert.ok(bgIdx >= 0, 'setBackground must run from require.main === module');
  assert.ok(requireIdx >= 0, 'research_retention must be required from server.js');
  assert.ok(requireIdx > bgIdx, 'background flag must be set before research_retention is required');
});

test('research-evidence boot task fails closed in production and does not swallow sweep errors', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const schemaIdx = src.indexOf('ensureAgentOrchestratorSchema');
  assert.ok(schemaIdx >= 0, 'ensureAgentOrchestratorSchema must remain registered');
  const schemaPush = src.lastIndexOf('BOOT_TASKS.push', schemaIdx);
  assert.ok(schemaPush >= 0 && schemaPush < schemaIdx);
  const nextPushAfterSchema = src.indexOf('BOOT_TASKS.push', schemaPush + 1);
  const schemaBlock = src.slice(schemaPush, nextPushAfterSchema > 0 ? nextPushAfterSchema : undefined);
  assert.match(schemaBlock, /ensureAgentOrchestratorSchema/);
  assert.match(schemaBlock, /process\.exit\(1\)/);
  assert.match(schemaBlock, /NODE_ENV === 'production'/);
  assert.match(schemaBlock, /captureException/);
  assert.doesNotMatch(schemaBlock, /\[tier28-32\] schema init failed/);
  assert.doesNotMatch(schemaBlock, /console\.warn/);
  assert.doesNotMatch(schemaBlock, /approveLegacyCleanup/);
  assert.doesNotMatch(schemaBlock, /executeLegacyCleanup/);
  assert.match(schemaBlock, /legacy_holds_identified/);
  assert.ok(!/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(schemaBlock), 'schema ensure must not use empty catch');

  const requireIdx = src.indexOf("require('./services/agent_orchestrator/research_retention')");
  assert.ok(requireIdx > schemaIdx, 'research_retention boot task must follow the schema BOOT_TASKS entry');
  const afterRequire = src.slice(requireIdx);
  const sweepPushRel = afterRequire.search(/BOOT_TASKS\.push\s*\(/);
  assert.ok(sweepPushRel >= 0, 'a new BOOT_TASKS.push must follow the research_retention require');
  const sweepPush = requireIdx + sweepPushRel;
  assert.ok(sweepPush > schemaPush, 'a new BOOT_TASKS.push must be added after the schema task');
  const nextPushRel = afterRequire.indexOf('BOOT_TASKS.push', sweepPushRel + 1);
  const block = afterRequire.slice(sweepPushRel, nextPushRel > 0 ? nextPushRel : undefined);
  assert.match(block, /sweepExpiredResearchEvidence\(\)/);
  assert.match(block, /sweepResult\.ok !== true/);
  assert.match(block, /process\.exit\(1\)/);
  assert.match(block, /NODE_ENV === 'production'/);
  assert.match(block, /captureException/);
  assert.match(block, /invalid_expiry/);
  assert.ok(!/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(block), 'boot sweep must not use empty catch');
});

test('research_retention.js registers setInterval only when backgroundEnabled, period 6h', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/agent_orchestrator/research_retention.js'),
    'utf8'
  );
  assert.match(src, /backgroundEnabled\(\)/);
  assert.match(src, /setInterval/);
  assert.match(src, /6 \* 3600 \* 1000/);
  assert.match(src, /startResearchEvidenceSweepInterval/);
  assert.match(src, /sweepExpiredResearchEvidence\(\)\.catch\(/);
  assert.match(src, /phase:\s*'interval'/);
  assert.ok(!/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(src), 'recurring sweep must not use empty catch');
  assert.match(src, /FOR UPDATE SKIP LOCKED/);
  assert.match(src, /p\.connect\s*\(\s*\)/);
  assert.match(src, /client\.query\(\s*['"]BEGIN['"]\s*\)/);
  assert.match(src, /client\.query\(\s*['"]COMMIT['"]\s*\)/);
  assert.match(src, /client\.query\(\s*['"]ROLLBACK['"]\s*\)/);
  assert.match(src, /client\.release\s*\(/);
  assert.match(src, /LIMIT \$2/);
  assert.match(src, /WITH doomed AS/);
  assert.match(src, /DELETE FROM \$\{table\} t/);
  assert.match(src, /orchestrator_research_legacy_holds/);
  assert.match(src, /lock_timeout/);
  assert.match(src, /55P03/);
  assert.match(src, /tenant_id=\$1/);
  assert.match(src, /retention_class IN \('standard','short'\)/);
  assert.match(src, /expires_at IS NULL/);
  assert.match(src, /invalid_expiry/);
  assert.match(src, /NOT EXISTS/);
});

test('research_cleanup.js is a module required from tests, not an HTTP route', () => {
  const cleanupSrc = fs.readFileSync(
    path.join(__dirname, '../services/agent_orchestrator/research_cleanup.js'),
    'utf8'
  );
  assert.match(cleanupSrc, /previewLegacyCleanup/);
  assert.match(cleanupSrc, /approveLegacyCleanup/);
  assert.match(cleanupSrc, /executeLegacyCleanup/);
  assert.match(cleanupSrc, /DELETE_LEGACY_RESEARCH_EVIDENCE/);
  assert.match(cleanupSrc, /timingSafeEqual/);
  assert.match(cleanupSrc, /infogenie\.research_cleanup/);
  assert.doesNotMatch(cleanupSrc, /\b(?:express|Router|app\.use|app\.(?:get|post|put|patch|delete))\b/);
  assert.doesNotMatch(cleanupSrc, /\bfetch\s*\(/);
  assert.doesNotMatch(cleanupSrc, /require\(\s*['"](?:https|http|node-fetch|undici)['"]\s*\)/);

  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.doesNotMatch(serverSrc, /approveLegacyCleanup/);
  assert.doesNotMatch(serverSrc, /executeLegacyCleanup/);
  assert.match(serverSrc, /research_cleanup/);
  assert.match(serverSrc, /countLegacyHolds/);
  assert.doesNotMatch(serverSrc, /app\.use\(\s*['"]\/api\/.*research_cleanup/);

  const testSrc = fs.readFileSync(
    path.join(__dirname, 'advertising-orchestrator-research-cleanup.test.js'),
    'utf8'
  );
  assert.match(testSrc, /require\('\.\.\/services\/agent_orchestrator\/research_cleanup'\)/);
});

test('ensureAgentOrchestratorSchema remains inside a BOOT_TASKS.push', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const orchIdx = serverSrc.indexOf('ensureAgentOrchestratorSchema');
  assert.ok(orchIdx >= 0, 'server.js must call ensureAgentOrchestratorSchema');
  const pushIdx = serverSrc.lastIndexOf('BOOT_TASKS.push', orchIdx);
  assert.ok(pushIdx >= 0 && pushIdx < orchIdx,
    'ensureAgentOrchestratorSchema must sit inside a BOOT_TASKS.push');
  const nextPushIdx = serverSrc.indexOf('BOOT_TASKS.push', pushIdx + 1);
  const window = serverSrc.slice(pushIdx, nextPushIdx > 0 ? nextPushIdx : undefined);
  assert.match(window, /process\.exit\(1\)/);
  assert.match(window, /NODE_ENV === 'production'/);
  assert.match(window, /captureException/);
  assert.doesNotMatch(window, /\[tier28-32\] schema init failed/);
});
