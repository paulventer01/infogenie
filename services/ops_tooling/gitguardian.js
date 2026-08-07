'use strict';

/**
 * GitGuardian secret-leak protection.
 * - Status for Technical Manager
 * - Optional live API health when GITGUARDIAN_API_KEY is set
 * - Local heuristic scan helper for CI / pre-commit style gates
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { present } = require('./env');

const SECRET_PATTERNS = [
  { id: 'aws_access_key', re: /AKIA[0-9A-Z]{16}/g, severity: 'critical' },
  { id: 'generic_api_key_assign', re: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/gi, severity: 'high' },
  { id: 'private_key_block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, severity: 'critical' },
  { id: 'slack_token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/g, severity: 'high' },
  { id: 'github_pat', re: /ghp_[0-9A-Za-z]{36}/g, severity: 'critical' },
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  'uploads', 'tmp', '.cache', 'public/avatars',
]);

function gitguardianConfigured() {
  return present('GITGUARDIAN_API_KEY');
}

function _ggHealth() {
  return new Promise((resolve) => {
    if (!gitguardianConfigured()) return resolve({ ok: false, configured: false });
    const req = https.request(
      {
        hostname: 'api.gitguardian.com',
        path: '/v1/health',
        method: 'GET',
        headers: {
          Authorization: `Token ${process.env.GITGUARDIAN_API_KEY}`,
          Accept: 'application/json',
        },
        timeout: 8000,
      },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, configured: true, status: res.statusCode });
      },
    );
    req.on('error', (e) => resolve({ ok: false, configured: true, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, configured: true, error: 'timeout' });
    });
    req.end();
  });
}

function scanText(text, filePath = 'inline') {
  const findings = [];
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      findings.push({
        id: `${p.id}:${filePath}:${m.index}`,
        rule: p.id,
        severity: p.severity,
        path: filePath,
        excerpt: String(m[0]).slice(0, 24) + '…',
      });
      if (findings.length > 50) return findings;
    }
  }
  return findings;
}

function scanTree(rootDir, { maxFiles = 400 } = {}) {
  const findings = [];
  let files = 0;

  function walk(dir) {
    if (files >= maxFiles || findings.length >= 50) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files >= maxFiles || findings.length >= 50) break;
      if (ent.name.startsWith('.') && ent.name !== '.env.example') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(full);
        continue;
      }
      if (!/\.(js|ts|tsx|jsx|json|md|yml|yaml|env|sh)$/i.test(ent.name)) continue;
      // Never scan real .env files into findings output beyond presence
      if (ent.name === '.env' || ent.name.startsWith('.env.')) {
        files += 1;
        continue;
      }
      let text;
      try {
        const st = fs.statSync(full);
        if (st.size > 250_000) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      files += 1;
      const rel = path.relative(rootDir, full);
      findings.push(...scanText(text, rel));
    }
  }

  walk(rootDir);
  return { files_scanned: files, findings: findings.slice(0, 50), ok: findings.length === 0 };
}

async function collectGitGuardianStatus(rootDir = path.join(__dirname, '../..')) {
  const health = await _ggHealth();
  const local = scanTree(rootDir, { maxFiles: 250 });
  const critical = local.findings.filter((f) => f.severity === 'critical').length;

  return {
    configured: gitguardianConfigured(),
    api_ok: health.ok,
    api_error: health.error || null,
    local_scan: {
      ok: local.ok,
      files_scanned: local.files_scanned,
      findings_count: local.findings.length,
      critical,
      findings: local.findings.slice(0, 12),
    },
    ci_workflow: fs.existsSync(path.join(rootDir, '.github/workflows/gitguardian.yml')),
    ok: (gitguardianConfigured() ? health.ok : true) && local.ok,
    note: gitguardianConfigured()
      ? 'GitGuardian API key present; local heuristic scan also runs on Technical Manager refresh.'
      : 'Set GITGUARDIAN_API_KEY and enable .github/workflows/gitguardian.yml to block secret leaks in CI.',
  };
}

module.exports = {
  gitguardianConfigured,
  scanText,
  scanTree,
  collectGitGuardianStatus,
  SECRET_PATTERNS,
};
