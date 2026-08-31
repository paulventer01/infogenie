'use strict';

const { spawnSync } = require('node:child_process');

const files = [
  'test/advertising-optimization-execution-run.test.js',
  'test/integration/meta-activation-capability-postgres.test.js',
  'test/advertising-meta-reconciliation-durability-postgres.test.js',
  'test/advertising-meta-reconciliation-review-postgres.test.js',
  'test/advertising-meta-monitoring-postgres.test.js',
  'test/advertising-meta-delivery-discrepancy-postgres.test.js',
  'test/advertising-optimization-recommendations-postgres.test.js',
  'test/advertising-optimization-execution-postgres.test.js',
  'test/advertising-optimization-execution-run-postgres.test.js',
  'test/advertising-optimization-execution-recovery-postgres.test.js',
  'test/advertising-optimization-execution-stress-postgres.test.js',
];

if (!process.env.DATABASE_URL) {
  console.error('Advertising certification requires DATABASE_URL; refusing to run a skipped suite.');
  process.exit(2);
}

const result = spawnSync(process.execPath, [
  '--test', '--test-force-exit', '--test-concurrency=1', ...files,
], { encoding: 'utf8', env: process.env });

process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
if (!/^# fail 0$/m.test(output) || !/^# skipped 0$/m.test(output)) {
  console.error('Advertising certification did not report zero failures and zero skips.');
  process.exit(1);
}
