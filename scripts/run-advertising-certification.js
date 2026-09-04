'use strict';

const { spawnSync } = require('node:child_process');

const files = [
  'test/google-ads-provider-draft-authority-schema.test.js',
  'test/google-ads-provider-draft-capabilities-security.test.js',
  'test/integration/google-ads-provider-draft-authority-postgres.test.js',
  'test/google-ads-provider-draft-operation-schema.test.js',
  'test/google-ads-provider-draft-operations-security.test.js',
  'test/integration/google-ads-provider-draft-operations-postgres.test.js',
  'test/google-ads-reconciliation-read-schema.test.js',
  'test/integration/google-ads-reconciliation-read-schema-postgres.test.js',
  'test/integration/google-ads-paused-draft-execution-postgres.test.js',
  'test/google-ads-paused-draft-reconciliation-security.test.js',
  'test/integration/google-ads-paused-draft-reconciliation-postgres.test.js',
  'test/advertising-google-ads-reconciliation-review.test.js',
  'test/integration/google-ads-reconciliation-review-postgres.test.js',
  'test/integration/google-ads-credential-persistence-authority-postgres.test.js',
  'test/advertising-google-ads-paused-draft-connector.test.js',
  'test/advertising-google-ads-paused-draft-reconciliation-observer.test.js',
  'test/google-ads-paused-draft-secret-boundary.test.js',
  'test/google-ads-reconciliation-runs.test.js',
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
], { encoding: 'utf8', env: process.env, maxBuffer: 128 * 1024 * 1024 });

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
if (result.error) throw result.error;
if (result.status !== 0) {
  const lines = output.split('\n');
  const failures = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^not ok \d+ - /.test(lines[i])) failures.push(...lines.slice(i, i + 30));
  }
  process.stdout.write(`${(failures.length ? failures : lines.slice(-200)).join('\n')}\n`);
  process.exit(result.status || 1);
}
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (!/^# fail 0$/m.test(output) || !/^# skipped 0$/m.test(output)) {
  console.error('Advertising certification did not report zero failures and zero skips.');
  process.exit(1);
}
