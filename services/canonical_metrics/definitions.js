'use strict';

/**
 * Versioned canonical metric definitions — the dictionary that makes
 * dashboard, Ask InfoGenie, and board reports agree by construction.
 *
 * kind:
 *   measured  — observed from ingested facts (spend, clicks, platform revenue)
 *   modelled  — derived / causal estimate (true ROAS with offline, iROAS, MMM)
 *   projected — forecast / scenario
 */

const DEFINITION_VERSION = '2026.08.1';

/** @typedef {'measured'|'modelled'|'projected'} MetricKind */

const METRIC_DEFINITIONS = {
  spend: {
    key: 'spend',
    aliases: ['ads.totalSpend', 'total_spend'],
    label: 'Ad spend',
    unit: '$',
    kind: 'measured',
    formula: 'SUM(ad_performance_hourly.spend) + additive spend_events for channels without optimizer rows',
    notes: 'Optimizer-ingested spend preferred per channel; Budget Board fills gaps only.',
  },
  online_revenue: {
    key: 'online_revenue',
    aliases: [],
    label: 'Platform-reported revenue',
    unit: '$',
    kind: 'measured',
    formula: 'SUM(ad_performance_hourly.revenue)',
    notes: 'Platform-attributed. Often overstates incremental contribution.',
  },
  offline_revenue: {
    key: 'offline_revenue',
    aliases: [],
    label: 'Offline / CRM revenue',
    unit: '$',
    kind: 'measured',
    formula: 'SUM(offline_conversions.revenue_cents)/100 in window',
    notes: 'Closed deals from CSV/HubSpot sync — not platform-claimed.',
  },
  total_revenue: {
    key: 'total_revenue',
    aliases: ['ads.revenue', 'revenue'],
    label: 'Total attributed revenue',
    unit: '$',
    kind: 'modelled',
    formula: 'online_revenue + offline_revenue',
    notes: 'Still correlational; use incremental_revenue for causal budget defence.',
  },
  reported_roas: {
    key: 'reported_roas',
    aliases: ['platform_roas'],
    label: 'Platform ROAS',
    unit: 'x',
    kind: 'measured',
    formula: 'online_revenue / spend',
    notes: 'Directional only for budget defence (privacy + double-counting).',
  },
  blended_roas: {
    key: 'blended_roas',
    aliases: ['ads.blendedRoas', 'roas'],
    label: 'Blended ROAS',
    unit: 'x',
    kind: 'measured',
    formula: 'online_revenue / spend (same as reported_roas in v1)',
    notes: 'Alias of platform ROAS until cross-channel identity is available.',
  },
  true_roas: {
    key: 'true_roas',
    aliases: ['ads.trueRoas'],
    label: 'True ROAS',
    unit: 'x',
    kind: 'modelled',
    formula: '(online_revenue + offline_revenue) / spend',
    notes: 'Includes offline closes; still not pure incrementality.',
  },
  cpa: {
    key: 'cpa',
    aliases: ['ads.cpa', 'cost_per_acquisition'],
    label: 'CPA',
    unit: '$',
    kind: 'measured',
    formula: 'spend / conversions',
    notes: 'Platform conversion events; definition locked to ad_performance conversions.',
  },
  cac: {
    key: 'cac',
    aliases: ['ads.cac'],
    label: 'CAC',
    unit: '$',
    kind: 'modelled',
    formula: 'spend / customers (customers := conversions until CRM unique buyers available)',
    notes: 'Blended CAC when customer identity is incomplete.',
  },
  blended_cac: {
    key: 'blended_cac',
    aliases: ['ads.blendedCac'],
    label: 'Blended CAC',
    unit: '$',
    kind: 'modelled',
    formula: 'spend / max(conversions, unique offline buyers)',
    notes: 'Prefer offline unique buyers when present; else equals CAC.',
  },
  ltv: {
    key: 'ltv',
    aliases: ['ads.ltv', 'customer_ltv'],
    label: 'Customer LTV',
    unit: '$',
    kind: 'modelled',
    formula: 'avg offline deal value when available; else AOV proxy from online_revenue/conversions',
    notes: 'Coarse until lifecycle cohort tables exist — always labelled modelled.',
  },
  mer: {
    key: 'mer',
    aliases: ['ads.mer'],
    label: 'MER',
    unit: '%',
    kind: 'modelled',
    formula: '(total_revenue / spend) * 100',
    notes: 'Marketing efficiency ratio on total attributed revenue.',
  },
  incremental_revenue: {
    key: 'incremental_revenue',
    aliases: ['causal_revenue'],
    label: 'Incremental revenue',
    unit: '$',
    kind: 'modelled',
    formula: 'Holdout lift × reach × AOV, or MMM response-curve contribution',
    notes: 'System of record for budget defence. Prefer holdout when available.',
  },
  iroas: {
    key: 'iroas',
    aliases: ['incremental_roas'],
    label: 'Incremental ROAS (iROAS)',
    unit: 'x',
    kind: 'modelled',
    formula: 'incremental_revenue / test_spend (holdout) or MMM channel contribution / spend',
    notes: 'Causal estimate — ranks budget recommendations over platform ROAS.',
  },
  conversions: {
    key: 'conversions',
    aliases: ['ads.conversions'],
    label: 'Conversions',
    unit: '',
    kind: 'measured',
    formula: 'SUM(ad_performance_hourly.conversions)',
    notes: 'Platform-reported conversion events.',
  },
  impressions: {
    key: 'impressions',
    aliases: ['ads.impressions'],
    label: 'Impressions',
    unit: '',
    kind: 'measured',
    formula: 'SUM(ad_performance_hourly.impressions)',
  },
  clicks: {
    key: 'clicks',
    aliases: ['ads.clicks'],
    label: 'Clicks',
    unit: '',
    kind: 'measured',
    formula: 'SUM(ad_performance_hourly.clicks)',
  },
  waste: {
    key: 'waste',
    aliases: ['waste_cents', 'ads.waste'],
    label: 'Underwater spend',
    unit: '$',
    kind: 'modelled',
    formula: 'SUM(max(0, spend - online_revenue)) per channel where ROAS < 1',
    notes: 'Heuristic waste — not causal.',
  },
};

function listDefinitions() {
  return {
    version: DEFINITION_VERSION,
    metrics: Object.values(METRIC_DEFINITIONS),
  };
}

function resolveDefinition(key) {
  if (!key) return null;
  const k = String(key).trim();
  if (METRIC_DEFINITIONS[k]) return METRIC_DEFINITIONS[k];
  for (const def of Object.values(METRIC_DEFINITIONS)) {
    if (def.aliases.includes(k)) return def;
  }
  return null;
}

function labelledValue(defKey, value, { confidence = null, evidence = null, overrideKind = null } = {}) {
  const def = resolveDefinition(defKey) || {
    key: defKey,
    label: defKey,
    unit: '',
    kind: 'modelled',
    formula: null,
  };
  return {
    key: def.key,
    label: def.label,
    value: value == null || !Number.isFinite(Number(value)) ? null : Number(value),
    unit: def.unit,
    kind: overrideKind || def.kind,
    definition_version: DEFINITION_VERSION,
    formula: def.formula || null,
    confidence: confidence == null ? null : Number(confidence),
    evidence: evidence || null,
  };
}

module.exports = {
  DEFINITION_VERSION,
  METRIC_DEFINITIONS,
  listDefinitions,
  resolveDefinition,
  labelledValue,
};
