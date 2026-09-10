'use strict';

// Only scalar cells reach renderers: never formula, hyperlink, rich-text or asset objects.
function cell(value, limit = 160) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, limit) : '';
}
function branding(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, limit] of [['agencyName', 80], ['footerText', 200]]) {
    if (typeof value[key] === 'string') result[key] = cell(value[key], limit);
  }
  for (const key of ['primaryColor', 'accentColor', 'textColor']) {
    if (typeof value[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(value[key])) result[key] = value[key];
  }
  return result;
}
function buildReport(client, profile, data, workspaceBrand) {
  const sections = [];
  const table = (title, headers, rows) => {
    const safeRows = rows.length ? rows : [['No recorded data']];
    for (let offset = 0; offset < safeRows.length; offset += 20) sections.push({
      kind: 'table', title: title + (safeRows.length > 20 ? ` ${offset / 20 + 1}` : ''), headers,
      rows: safeRows.slice(offset, offset + 20).map((row) => headers.map((_, index) => cell(row[index]))),
    });
  };
  const summary = data.summary, records = data.records.slice(0, 100), recent = data.recent;
  table('Report scope', ['Item', 'Coverage'], [
    ['Client', client.name], ['Source', data.source], ['Period', 'All-time recorded data'],
    ['Summary', 'All currently mapped records'], ['Mapped records', summary.mapped_records],
    ['Record list', `First ${records.length} of ${summary.mapped_records}; maximum 100`],
    ['Recent lists', 'Latest 50 per list; not full history'],
    ['Excluded', 'Unmapped records; other clients; other workspaces'],
    ['Unsupported', data.source === 'campaigns' ? 'Legacy launches' : 'Search pulses; image scans'],
    ['Evidence', 'Recorded data; freshness and provider accuracy unverified'],
    ['Interpretation', 'No causal lift, incrementality or live verification'],
    ['Branding', 'Text and colours only; logos omitted'],
    ['Layout', 'PDF and slides shorten long cells; spreadsheet keeps bounded text'],
    ['Generation', 'Fresh snapshot at generation; may differ from preview'],
  ]);
  if (data.source === 'search-intel') {
    table('Search totals', ['Metric', 'Recorded value'], [
      ['Runs', summary.runs], ['Successful runs', summary.successful_runs], ['Brand mentions', summary.brand_mentions],
    ]);
    table('Mapped queries', ['ID', 'Query', 'Brand', 'Locale'], records.map((r) => [r.id, r.query, r.brand, r.locale]));
    table('Recent search runs', ['ID', 'Query ID', 'Provider', 'Mentioned', 'Position', 'Failed', 'Recorded at'],
      recent.llm_runs.slice(0, 50).map((r) => [r.id, r.query_id, r.provider, r.brand_mentioned, r.brand_position, r.failed, r.ran_at]));
  } else {
    table('Currency totals', ['Currency', 'Metric', 'Recorded value'], summary.by_currency.slice(0, 100).flatMap((r) =>
      ['performance_rows', 'spend', 'impressions', 'clicks', 'conversions', 'revenue'].map((key) => [r.currency, key, r[key]])));
    table('Currency coverage', ['Item', 'Coverage'], [['Currency groups', `First ${Math.min(100, summary.by_currency.length)} of ${summary.by_currency.length}`],
      ['Money', 'Currencies reported separately; no conversion or combined money total']]);
    table('Mapped campaigns', ['ID', 'Name', 'Platform', 'Currency', 'Status'], records.map((r) => [r.id, r.name, r.platform, r.currency, r.status]));
    table('Recent performance', ['Campaign', 'Recorded at', 'Currency', 'Spend', 'Impressions', 'Clicks', 'Conversions', 'Revenue'],
      recent.performance.slice(0, 50).map((r) => [r.campaign_id, r.bucket_hour, r.currency, r.spend, r.impressions, r.clicks, r.conversions, r.revenue]));
    table('Recent actions', ['Campaign', 'Action', 'Applied', 'Recorded at'],
      recent.optimizer_actions.slice(0, 50).map((r) => [r.campaign_id, r.action_type, r.applied, r.created_at]));
  }
  return { ok: true, client, profile_version: profile.version, format: profile.default_format,
    can_generate: summary.mapped_records > 0,
    report: { title: cell(profile.report_title), generated_at: new Date().toISOString(), sections },
    brand: branding(profile.branding_mode === 'custom' ? profile.branding_overrides : workspaceBrand?.enabled === true ? workspaceBrand : null) };
}
async function streamReport(snapshot, res) {
  const { format, client, report, brand } = snapshot;
  const filename = `client-${client.id}-report-${report.generated_at.slice(0, 10)}.${format}`;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (format === 'pdf') return require('../exports/pdf_report').streamPdf(report, res, filename, brand);
  if (format === 'pptx') return require('../exports/pptx_report').streamPptx(report, res, filename, brand);
  return require('../exports/xlsx_report').streamXlsx(report, res, filename, brand);
}

module.exports = { buildReport, streamReport };
