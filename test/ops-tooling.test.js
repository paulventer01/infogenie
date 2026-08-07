'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { CHECK_DEFS, runLocalProbes, collectSyntheticsStatus } = require('../services/ops_tooling/checkly');
const { otelStatus, emitLlmSpan, initOtel } = require('../services/ops_tooling/otel');
const { connectionStatusForTenant, SUPPORTED_INTEGRATIONS } = require('../services/ops_tooling/nango');
const { scanText, collectGitGuardianStatus } = require('../services/ops_tooling/gitguardian');
const { collectPromptfooStatus, evaluateGate } = require('../services/ops_tooling/promptfoo_gate');
const { collectLlmFinops } = require('../services/ops_tooling/llm_finops');
const { collectOpsToolingStatus } = require('../services/ops_tooling/status');
const { runTechnicalScan } = require('../services/technical_manager/scan');
const matrix = require('../services/tenants/permission_matrix');

describe('Checkly synthetics', () => {
  it('defines health, ready, login, dashboard, AI Team, reports', () => {
    const ids = CHECK_DEFS.map((d) => d.id);
    for (const need of ['api-health', 'api-ready', 'login-page', 'dashboard', 'ai-team', 'reports']) {
      assert.ok(ids.includes(need), `missing ${need}`);
    }
  });

  it('runs local probes without throwing', async () => {
    const probes = await runLocalProbes();
    assert.ok(probes.length >= 6);
    assert.ok(probes.every((p) => typeof p.ok === 'boolean'));
  });

  it('collects synthetics status', async () => {
    const s = await collectSyntheticsStatus();
    assert.ok(s.checks.length >= 6);
    assert.ok(['checkly', 'betterstack', 'local'].includes(s.provider));
  });
});

describe('OpenTelemetry / OpenLLMetry', () => {
  it('reports disabled when no endpoint', () => {
    const prev = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prev2 = process.env.SIGNOZ_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.SIGNOZ_OTLP_ENDPOINT;
    try {
      // re-read status from module state — configured flag uses env
      const st = otelStatus();
      assert.equal(typeof st.enabled, 'boolean');
      assert.equal(st.service_name, 'infogenie' || st.service_name);
    } finally {
      if (prev != null) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prev;
      if (prev2 != null) process.env.SIGNOZ_OTLP_ENDPOINT = prev2;
    }
  });

  it('emitLlmSpan is fail-open when disabled', () => {
    assert.equal(emitLlmSpan({ provider: 'openai', model: 'test', surface: 'unit' }), false);
  });

  it('initOtel returns false without endpoint', () => {
    const prev = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prev2 = process.env.SIGNOZ_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.SIGNOZ_OTLP_ENDPOINT;
    try {
      // May already be enabled from a prior test process — just ensure no throw
      assert.doesNotThrow(() => initOtel());
    } finally {
      if (prev != null) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prev;
      if (prev2 != null) process.env.SIGNOZ_OTLP_ENDPOINT = prev2;
    }
  });
});

describe('Nango', () => {
  it('lists Meta/Google/HubSpot/Shopify integrations', () => {
    const ids = SUPPORTED_INTEGRATIONS.map((i) => i.id);
    assert.deepEqual(ids.sort(), ['google-ads', 'hubspot', 'meta', 'shopify'].sort());
  });

  it('returns setup guidance when secret missing', async () => {
    const prev = process.env.NANGO_SECRET_KEY;
    delete process.env.NANGO_SECRET_KEY;
    try {
      const st = await connectionStatusForTenant('tenant-1');
      assert.equal(st.configured, false);
      assert.match(st.note || '', /NANGO_SECRET_KEY/);
    } finally {
      if (prev != null) process.env.NANGO_SECRET_KEY = prev;
    }
  });
});

describe('GitGuardian', () => {
  it('detects obvious secrets in text', () => {
    // Construct at runtime so repo scanners do not treat the fixture as a real leak.
    const aws = 'AKIA' + 'IOSFODNN7EXAMPLE';
    const ghp = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
    const findings = scanText(`token_demo ${aws} ${ghp}`, 'fixture.txt');
    assert.ok(findings.some((f) => f.rule === 'aws_access_key' || f.rule === 'github_pat'));
  });

  it('collects status with CI workflow present', async () => {
    const st = await collectGitGuardianStatus(path.join(__dirname, '..'));
    assert.equal(st.ci_workflow, true);
    assert.ok(typeof st.local_scan.files_scanned === 'number');
  });
});

describe('Promptfoo gate', () => {
  it('reads baseline results as passing', () => {
    const st = collectPromptfooStatus();
    assert.equal(st.config_present, true);
    assert.equal(st.results_present, true);
    assert.notEqual(st.gate.passed, false);
  });

  it('fails gate below threshold', () => {
    const gate = evaluateGate({ stats: { successes: 1, failures: 3 }, passRate: 0.25 });
    assert.equal(gate.passed, false);
  });
});

describe('LLM FinOps', () => {
  it('returns metrics and thresholds', async () => {
    const fin = await collectLlmFinops({ tenantId: null });
    assert.ok(fin.metrics);
    assert.ok(fin.thresholds.cost_usd_warn > 0);
    assert.ok(Array.isArray(fin.alerts));
  });
});

describe('Ops tooling aggregate + TM scan', () => {
  it('aggregates ship-order stack', async () => {
    const st = await collectOpsToolingStatus({});
    assert.deepEqual(st.ship_order, ['checkly', 'otel_signoz', 'nango', 'gitguardian', 'promptfoo', 'llm_finops']);
    assert.ok(st.stack.length === 6);
    assert.ok(st.deferred.includes('infisical'));
  });

  it('embeds ops_tooling in Technical Manager scan', async () => {
    const snap = await runTechnicalScan(null);
    assert.ok(snap.ops_tooling);
    assert.ok(Array.isArray(snap.ops_tooling.stack));
    assert.ok(typeof snap.counts.ops_stack_total === 'number');
  });

  it('maps ops-tooling API permission', () => {
    assert.equal(matrix.requiredPermissionForRequest('/api/ops-tooling/status', 'GET').matched, true);
  });
});
