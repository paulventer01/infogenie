#!/usr/bin/env node
'use strict';

const path = require('path');
const { collectGitGuardianStatus } = require('../services/ops_tooling/gitguardian');

(async () => {
  const status = await collectGitGuardianStatus(path.join(__dirname, '..'));
  const findings = status.local_scan?.findings || [];
  console.log(JSON.stringify({
    ok: status.local_scan?.ok,
    files_scanned: status.local_scan?.files_scanned,
    findings_count: findings.length,
    critical: status.local_scan?.critical,
    findings: findings.slice(0, 20),
    gitguardian_api: { configured: status.configured, ok: status.api_ok },
  }, null, 2));
  if (!status.local_scan?.ok) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
