'use strict';

/**
 * PR10G.6 — client report metric availability and proxy labels.
 * Reuses canonical availability semantics without tenant-wide substitution.
 */

const { AVAILABILITY, REASON } = require('../canonical_metrics/availability');
const { safeAvailabilityReason } = require('../canonical_metrics/consumer');
const { SEARCH_SCALAR, CAMPAIGN_SCALAR } = require('./metrics');

const SAFE_REASONS = new Set([
  REASON.DATABASE_UNAVAILABLE,
  REASON.SOURCE_QUERY_FAILED,
  REASON.INPUT_UNAVAILABLE,
  REASON.INPUT_PARTIAL,
  'no_data',
  'not_configured',
]);

function controlledReason(reason) {
  if (!reason) return null;
  if (SAFE_REASONS.has(reason)) return reason;
  if (String(reason).startsWith(`${REASON.INPUT_UNAVAILABLE}:`)) return reason;
  if (String(reason).startsWith(`${REASON.SOURCE_QUERY_FAILED}:`)) return reason;
  return REASON.SOURCE_QUERY_FAILED;
}

function availableMeta(value, { is_proxy = false } = {}) {
  return {
    value: value == null ? null : value,
    availability: AVAILABILITY.AVAILABLE,
    availability_reason: null,
    is_proxy: !!is_proxy,
  };
}

function unavailableMeta(reason = REASON.SOURCE_QUERY_FAILED) {
  return {
    value: null,
    availability: AVAILABILITY.UNAVAILABLE,
    availability_reason: controlledReason(reason),
    is_proxy: false,
  };
}

function partialMeta(value, reason = REASON.INPUT_PARTIAL, { is_proxy = false } = {}) {
  return {
    value: value == null ? null : value,
    availability: AVAILABILITY.PARTIAL,
    availability_reason: controlledReason(reason),
    is_proxy: !!is_proxy,
  };
}

function missingMeta() {
  return unavailableMeta('not_configured');
}

function resolveMeta(metricMeta, key, fallbackValue = null) {
  const meta = metricMeta?.[key];
  if (!meta || typeof meta !== 'object' || !meta.availability) return missingMeta();
  return {
    value: Object.hasOwn(meta, 'value') ? meta.value : fallbackValue,
    availability: meta.availability,
    availability_reason: controlledReason(meta.availability_reason),
    is_proxy: !!meta.is_proxy,
  };
}

function resolveCurrencyMeta(metricMeta, currency, key, fallbackValue = null) {
  const compound = `${currency}:${key}`;
  const meta = metricMeta?.[compound] ?? metricMeta?.[key];
  if (!meta || typeof meta !== 'object' || !meta.availability) return missingMeta();
  return {
    value: Object.hasOwn(meta, 'value') ? meta.value : fallbackValue,
    availability: meta.availability,
    availability_reason: controlledReason(meta.availability_reason),
    is_proxy: !!meta.is_proxy,
  };
}

function humanReason(reason) {
  return safeAvailabilityReason(reason).replace(/_/g, ' ');
}

function formatDisplayValue(meta, { numeric = true } = {}) {
  const reason = humanReason(meta?.availability_reason || meta?.availability);
  if (meta?.availability === AVAILABILITY.UNAVAILABLE) {
    return `Unavailable (${reason})`;
  }
  const value = meta?.value;
  if (value == null) {
    if (meta?.availability === AVAILABILITY.PARTIAL) return `Partial (${reason})`;
    return '—';
  }
  let base = value;
  if (numeric && typeof value === 'number' && Number.isFinite(value)) {
    base = Number.isInteger(value)
      ? value.toLocaleString('en-US')
      : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  } else {
    base = String(value);
  }
  const tags = [];
  if (meta?.is_proxy) tags.push('Proxy');
  if (meta?.availability === AVAILABILITY.PARTIAL) tags.push(`Partial (${reason})`);
  return tags.length ? `${base} · ${tags.join(' · ')}` : base;
}

function metricAnnotation(meta) {
  const reason = humanReason(meta?.availability_reason || meta?.availability);
  const tags = [];
  if (meta?.is_proxy) tags.push('Proxy');
  if (meta?.availability === AVAILABILITY.PARTIAL) tags.push(`Partial (${reason})`);
  if (meta?.availability === AVAILABILITY.UNAVAILABLE) tags.push(`Unavailable (${reason})`);
  return tags.length ? tags.join(' · ') : null;
}

function isVerifiedZero(meta) {
  return meta?.availability === AVAILABILITY.AVAILABLE && meta?.value === 0;
}

async function safeQuery(label, queryFn) {
  try {
    const result = await queryFn();
    return { ok: true, rows: result.rows, status: 'ok' };
  } catch (_error) {
    return { ok: false, rows: [], status: 'failed', reason: `${REASON.SOURCE_QUERY_FAILED}:${label}` };
  }
}

function buildSearchMetricMeta(summary, status) {
  const meta = {};
  meta.mapped_records = status.mapped_count.ok
    ? availableMeta(summary.mapped_records)
    : unavailableMeta(status.mapped_count.reason);
  const totalsOk = status.search_totals.ok;
  for (const key of SEARCH_SCALAR) {
    meta[key] = totalsOk
      ? availableMeta(summary[key])
      : unavailableMeta(status.search_totals.reason);
  }
  if (status.search_totals.partial && totalsOk) {
    for (const key of SEARCH_SCALAR) {
      if (meta[key].availability === AVAILABILITY.AVAILABLE) {
        meta[key] = partialMeta(summary[key], status.search_totals.partialReason, {
          is_proxy: status.search_totals.proxyMetrics?.has(key) ?? false,
        });
      }
    }
  }
  return meta;
}

function buildCampaignMetricMeta(summary, status) {
  const meta = {};
  meta.mapped_records = status.mapped_count.ok
    ? availableMeta(summary.mapped_records)
    : unavailableMeta(status.mapped_count.reason);
  const totalsOk = status.campaign_totals.ok;
  for (const row of summary.by_currency || []) {
    for (const key of CAMPAIGN_SCALAR) {
      const compound = `${row.currency}:${key}`;
      let entry = totalsOk
        ? availableMeta(row[key])
        : unavailableMeta(status.campaign_totals.reason);
      if (totalsOk && status.campaign_totals.partial) {
        entry = partialMeta(row[key], status.campaign_totals.partialReason, {
          is_proxy: status.campaign_totals.proxyMetrics?.has(key) ?? false,
        });
      } else if (totalsOk && status.campaign_totals.proxyMetrics?.has(key)) {
        entry = { ...entry, is_proxy: true };
      }
      meta[compound] = entry;
    }
  }
  return meta;
}

function buildMetricMeta(source, summary, status = {}) {
  if (source === 'search-intel') return buildSearchMetricMeta(summary, status);
  return buildCampaignMetricMeta(summary, status);
}

function scalarRowMeta(source, metricKey, meta, currency = null) {
  return {
    metric_key: metricKey,
    currency,
    value: meta.value,
    availability: meta.availability,
    availability_reason: meta.availability_reason,
    is_proxy: meta.is_proxy,
    drillable: true,
  };
}

function summarizeReportMetrics(report) {
  const lines = [];
  for (const section of report?.sections || []) {
    if (!Array.isArray(section.row_meta) || !Array.isArray(section.rows)) continue;
    for (let index = 0; index < section.row_meta.length; index++) {
      const meta = section.row_meta[index];
      const row = section.rows[index] || [];
      const labelParts = section.headers?.length === 3 ? row.slice(0, 2) : [row[0]];
      const label = labelParts.filter(Boolean).join(' · ');
      lines.push(`${label}: ${formatDisplayValue(meta)}`);
    }
  }
  return lines;
}

function buildReportEmailBody(snapshot) {
  const { report, client, format, profile_version: profileVersion } = snapshot;
  const metricLines = summarizeReportMetrics(report);
  const text = [
    `Attached is the ${String(format || 'pdf').toUpperCase()} report "${report.title}" for ${client.name}.`,
    metricLines.length ? '' : null,
    metricLines.length ? 'Key metrics:' : null,
    ...metricLines,
    '',
    `Generated from the saved client reporting profile (version ${profileVersion}).`,
  ].filter((line) => line !== null).join('\n');
  const htmlMetrics = metricLines.length
    ? `<ul style="margin:12px 0;padding-left:20px">${metricLines.map((line) => `<li>${line.replace(/</g, '&lt;')}</li>`).join('')}</ul>`
    : '';
  const html = `<div style="font-family:sans-serif;max-width:560px;line-height:1.6">
    <p>Attached is the <strong>${String(format || 'pdf').toUpperCase()}</strong> report <strong>${report.title}</strong> for ${client.name}.</p>
    ${htmlMetrics}
    <p style="color:#64748B;font-size:13px">Generated from the saved client reporting profile (version ${profileVersion}).</p>
  </div>`;
  return { text, html };
}

function availableMetricMetaFromSummary(source, summary) {
  return buildMetricMeta(source, summary, {
    mapped_count: { ok: true },
    search_totals: { ok: true },
    campaign_totals: { ok: true },
  });
}

module.exports = {
  AVAILABILITY,
  REASON,
  SAFE_REASONS,
  availableMeta,
  unavailableMeta,
  partialMeta,
  missingMeta,
  resolveMeta,
  resolveCurrencyMeta,
  formatDisplayValue,
  metricAnnotation,
  isVerifiedZero,
  safeQuery,
  buildMetricMeta,
  scalarRowMeta,
  summarizeReportMetrics,
  buildReportEmailBody,
  controlledReason,
  safeAvailabilityReason,
  availableMetricMetaFromSummary,
};
