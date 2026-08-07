'use strict';

/**
 * Aggregate ops tooling status for Technical Manager.
 */

const { collectSyntheticsStatus } = require('./checkly');
const { otelStatus } = require('./otel');
const { connectionStatusForTenant } = require('./nango');
const { collectGitGuardianStatus } = require('./gitguardian');
const { collectPromptfooStatus } = require('./promptfoo_gate');
const { collectLlmFinops } = require('./llm_finops');
const { present } = require('./env');

async function collectOpsToolingStatus({ tenantId = null, tenantKey = null } = {}) {
  const [synthetics, nango, gitguardian, promptfoo, finops] = await Promise.all([
    collectSyntheticsStatus().catch((e) => ({ ok: false, error: e.message, checks: [], counts: {} })),
    connectionStatusForTenant(tenantKey || (tenantId != null ? `tenant-${tenantId}` : null))
      .catch((e) => ({ ok: false, error: e.message, configured: false })),
    collectGitGuardianStatus().catch((e) => ({ ok: false, error: e.message })),
    Promise.resolve().then(() => collectPromptfooStatus()).catch((e) => ({ ok: false, error: e.message })),
    collectLlmFinops({ tenantId }).catch((e) => ({ ok: false, error: e.message, alerts: [] })),
  ]);

  const otel = otelStatus();

  const stack = [
    {
      id: 'checkly',
      name: 'Checkly / Better Stack',
      order: 1,
      configured: !!synthetics.external_configured,
      ok: synthetics.ok !== false,
      summary: synthetics.note,
      detail: {
        provider: synthetics.provider,
        counts: synthetics.counts,
        critical_failed: synthetics.counts?.critical_failed ?? 0,
      },
    },
    {
      id: 'otel_signoz',
      name: 'OpenTelemetry → SigNoz',
      order: 2,
      configured: !!otel.configured,
      ok: otel.configured ? otel.enabled : true,
      summary: otel.configured
        ? `OTLP export enabled (${otel.service_name}).`
        : 'Set OTEL_EXPORTER_OTLP_ENDPOINT or SIGNOZ_OTLP_ENDPOINT to export traces/metrics.',
      detail: otel,
    },
    {
      id: 'nango',
      name: 'Nango',
      order: 3,
      configured: !!nango.configured,
      ok: nango.ok !== false,
      summary: nango.note,
      detail: {
        by_provider: nango.by_provider,
        legacy_env_tokens: nango.legacy_env_tokens,
      },
    },
    {
      id: 'gitguardian',
      name: 'GitGuardian',
      order: 4,
      configured: !!gitguardian.configured,
      ok: gitguardian.ok !== false,
      summary: gitguardian.note,
      detail: {
        api_ok: gitguardian.api_ok,
        findings: gitguardian.local_scan?.findings_count,
        critical: gitguardian.local_scan?.critical,
        ci_workflow: gitguardian.ci_workflow,
      },
    },
    {
      id: 'promptfoo',
      name: 'Promptfoo',
      order: 5,
      configured: !!promptfoo.configured,
      ok: promptfoo.ok !== false,
      summary: promptfoo.note,
      detail: {
        gate: promptfoo.gate,
        surfaces: promptfoo.surfaces,
      },
    },
    {
      id: 'llm_finops',
      name: 'Traceloop / LLM FinOps',
      order: 6,
      configured: true,
      ok: finops.ok !== false,
      summary: finops.note,
      detail: {
        metrics: finops.metrics,
        alerts: finops.alerts,
        traceloop: finops.traceloop,
      },
    },
  ];

  const events = [];
  if (synthetics.counts?.critical_failed > 0) {
    events.push({
      severity: 'critical',
      area: 'synthetics',
      message: `${synthetics.counts.critical_failed} critical synthetic journey(s) failing (health/ready/login/dashboard/AI Team).`,
      action: 'Inspect Checkly/Better Stack and local probe failures; fix blank or migrated-panel regressions',
    });
  } else if (!synthetics.external_configured) {
    events.push({
      severity: 'medium',
      area: 'synthetics',
      message: 'External Checkly/Better Stack not configured — only local probes run.',
      action: 'Set CHECKLY_API_KEY (or BETTERSTACK_API_KEY) and point checks at PUBLIC_BASE_URL',
    });
  }

  if (!otel.configured) {
    events.push({
      severity: 'medium',
      area: 'telemetry',
      message: 'OpenTelemetry/SigNoz exporter not configured.',
      action: 'Set SIGNOZ_OTLP_ENDPOINT (or OTEL_EXPORTER_OTLP_ENDPOINT) for API/Postgres/LLM traces',
    });
  }

  if (!nango.configured) {
    events.push({
      severity: 'medium',
      area: 'connectors',
      message: 'Nango not configured — OAuth refresh/reconnect still relies on hand-rolled + env tokens.',
      action: 'Set NANGO_SECRET_KEY and migrate Meta/Google/HubSpot/Shopify connect UX',
    });
  } else {
    const needs = Object.entries(nango.by_provider || {}).filter(([, v]) => v.needs_reconnect);
    for (const [id] of needs) {
      events.push({
        severity: 'high',
        area: 'connectors',
        message: `Nango connection needs reconnect: ${id}.`,
        action: 'Open reconnect flow for the affected workspace',
      });
    }
  }

  if (gitguardian.local_scan?.critical > 0) {
    events.push({
      severity: 'critical',
      area: 'security',
      message: `GitGuardian local scan found ${gitguardian.local_scan.critical} critical secret finding(s).`,
      action: 'Rotate exposed keys immediately; enable GITGUARDIAN_API_KEY CI gate',
    });
  } else if (!gitguardian.configured) {
    events.push({
      severity: 'medium',
      area: 'security',
      message: 'GitGuardian API key not set — secret leak CI gate inactive.',
      action: 'Add GITGUARDIAN_API_KEY and keep .github/workflows/gitguardian.yml enabled',
    });
  }

  if (promptfoo.gate?.passed === false) {
    events.push({
      severity: 'high',
      area: 'ai_quality',
      message: 'Promptfoo eval gate is failing — do not promote prompt/model changes.',
      action: 'Fix failing officer/report/minutes cases in promptfoo/ then re-run npm run eval:prompts',
    });
  } else if (!promptfoo.results_present) {
    events.push({
      severity: 'low',
      area: 'ai_quality',
      message: 'No Promptfoo results on disk yet.',
      action: 'Run npm run eval:prompts to baseline officer briefs, daily reports, and meeting minutes',
    });
  }

  for (const a of finops.alerts || []) {
    events.push({
      severity: a.severity,
      area: 'llm_finops',
      message: a.message,
      action: a.action,
    });
  }

  const critical = events.filter((e) => e.severity === 'critical').length;
  const high = events.filter((e) => e.severity === 'high').length;
  let overall = 'healthy';
  if (critical) overall = 'critical';
  else if (high) overall = 'degraded';
  else if (events.some((e) => e.severity === 'medium')) overall = 'watch';

  return {
    ok: overall === 'healthy' || overall === 'watch',
    overall,
    stack,
    synthetics,
    otel,
    nango,
    gitguardian,
    promptfoo,
    finops,
    events,
    ship_order: ['checkly', 'otel_signoz', 'nango', 'gitguardian', 'promptfoo', 'llm_finops'],
    deferred: ['infisical', 'incident_io', 'pagerduty', 'uptrace'],
    env_presence: {
      CHECKLY_API_KEY: present('CHECKLY_API_KEY'),
      BETTERSTACK_API_KEY: present('BETTERSTACK_API_KEY') || present('BETTER_UPTIME_API_TOKEN'),
      OTEL_EXPORTER_OTLP_ENDPOINT: present('OTEL_EXPORTER_OTLP_ENDPOINT') || present('SIGNOZ_OTLP_ENDPOINT'),
      NANGO_SECRET_KEY: present('NANGO_SECRET_KEY'),
      GITGUARDIAN_API_KEY: present('GITGUARDIAN_API_KEY'),
      TRACELOOP_API_KEY: present('TRACELOOP_API_KEY'),
      PROMPTFOO_ENFORCE: process.env.PROMPTFOO_ENFORCE === '1',
    },
  };
}

module.exports = { collectOpsToolingStatus };
