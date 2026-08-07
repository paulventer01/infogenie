'use strict';

/**
 * LLM FinOps — cost anomaly alerts from ai_traces (+ Traceloop when configured).
 */

const { present } = require('./env');
const { traceStats, listTraces } = require('../ai_traces/store');

function thresholds() {
  return {
    // USD over the lookback window
    cost_usd_warn: Number(process.env.LLM_COST_WARN_USD || 25),
    cost_usd_critical: Number(process.env.LLM_COST_CRITICAL_USD || 100),
    error_rate_warn: Number(process.env.LLM_ERROR_RATE_WARN || 0.15),
    latency_p95_warn_ms: Number(process.env.LLM_LATENCY_P95_WARN_MS || 15000),
    hours: Number(process.env.LLM_FINOPS_HOURS || 24),
  };
}

function _p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

async function collectLlmFinops({ tenantId = null } = {}) {
  const t = thresholds();
  const stats = await traceStats({ tenantId, hours: t.hours }).catch(() => null);
  const traces = await listTraces({ tenantId, limit: 200 }).catch(() => []);
  const recent = traces.filter((r) => {
    const age = Date.now() - new Date(r.created_at).getTime();
    return age <= t.hours * 3600 * 1000;
  });

  const latencies = recent.map((r) => Number(r.latency_ms)).filter((n) => Number.isFinite(n) && n >= 0);
  const errors = recent.filter((r) => r.status === 'error' || r.error).length;
  const errorRate = recent.length ? errors / recent.length : 0;
  const cost = Number(stats?.cost_usd_total ?? recent.reduce((s, r) => s + Number(r.cost_usd || r.meta?.cost_usd || 0), 0));
  const p95 = _p95(latencies);

  const alerts = [];
  if (cost >= t.cost_usd_critical) {
    alerts.push({
      severity: 'critical',
      message: `LLM spend $${cost.toFixed(2)} in ${t.hours}h exceeds critical threshold $${t.cost_usd_critical}.`,
      action: 'Inspect per-tenant AI usage; tighten plan limits or cascade tiers',
    });
  } else if (cost >= t.cost_usd_warn) {
    alerts.push({
      severity: 'high',
      message: `LLM spend $${cost.toFixed(2)} in ${t.hours}h exceeds warn threshold $${t.cost_usd_warn}.`,
      action: 'Review Officer / Ask InfoGenie / Optimizer / reports cost by tenant',
    });
  }
  if (errorRate >= t.error_rate_warn && recent.length >= 5) {
    alerts.push({
      severity: 'high',
      message: `LLM error rate ${(errorRate * 100).toFixed(1)}% over ${recent.length} calls.`,
      action: 'Check provider keys, cascade fallbacks, and SigNoz LLM traces',
    });
  }
  if (p95 != null && p95 >= t.latency_p95_warn_ms) {
    alerts.push({
      severity: 'medium',
      message: `LLM p95 latency ${Math.round(p95)}ms exceeds ${t.latency_p95_warn_ms}ms.`,
      action: 'Inspect slow surfaces in ai_traces and SigNoz',
    });
  }

  const bySurface = {};
  for (const r of recent) {
    const s = r.surface || 'unknown';
    if (!bySurface[s]) bySurface[s] = { calls: 0, cost_usd: 0, errors: 0 };
    bySurface[s].calls += 1;
    bySurface[s].cost_usd += Number(r.cost_usd || r.meta?.cost_usd || 0);
    if (r.status === 'error' || r.error) bySurface[s].errors += 1;
  }

  return {
    configured: true,
    traceloop: !!(process.env.TRACELOOP_API_KEY || process.env.TRACELOOP_BASE_URL),
    otel_cost_export: present('OTEL_EXPORTER_OTLP_ENDPOINT') || present('SIGNOZ_OTLP_ENDPOINT'),
    window_hours: t.hours,
    thresholds: t,
    metrics: {
      calls: recent.length,
      errors,
      error_rate: +errorRate.toFixed(4),
      cost_usd: +cost.toFixed(4),
      latency_p95_ms: p95 != null ? Math.round(p95) : null,
      by_provider: stats?.by_provider || {},
      by_tier: stats?.by_tier || {},
      by_surface: bySurface,
    },
    alerts,
    ok: !alerts.some((a) => a.severity === 'critical' || a.severity === 'high'),
    note: 'Per-tenant LLM cost/latency/error metering from ai_traces; export spans to SigNoz/Traceloop when configured.',
  };
}

module.exports = { collectLlmFinops, thresholds };
