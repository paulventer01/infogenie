'use strict';

const CATALOG = Object.freeze({
  'search-intel': Object.freeze([
    { key: 'runs', label: 'Runs' },
    { key: 'successful_runs', label: 'Successful runs' },
    { key: 'brand_mentions', label: 'Brand mentions' },
    { key: 'mapped_queries', label: 'Mapped queries' },
    { key: 'recent_search_runs', label: 'Recent search runs' },
  ]),
  campaigns: Object.freeze([
    { key: 'performance_rows', label: 'Performance rows' },
    { key: 'spend', label: 'Spend' },
    { key: 'impressions', label: 'Impressions' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'conversions', label: 'Conversions' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'mapped_campaigns', label: 'Mapped campaigns' },
    { key: 'recent_performance', label: 'Recent performance' },
    { key: 'recent_actions', label: 'Recent actions' },
  ]),
});

function fail(status, code) { return Object.assign(new Error(code), { status }); }

function catalog(source) {
  if (!Object.hasOwn(CATALOG, source)) throw fail(400, 'invalid_source');
  return CATALOG[source];
}

function defaultKeys(source) {
  return catalog(source).map((entry) => entry.key);
}

function labelFor(source, key) {
  return catalog(source).find((entry) => entry.key === key)?.label || key;
}

function validateSelection(source, selected) {
  if (!Array.isArray(selected)) throw fail(400, 'invalid_profile');
  if (!selected.length) throw fail(400, 'invalid_profile');
  const allowed = new Set(defaultKeys(source));
  const seen = new Set();
  for (const key of selected) {
    if (typeof key !== 'string' || !allowed.has(key) || seen.has(key)) throw fail(400, 'invalid_profile');
    seen.add(key);
  }
  return selected;
}

function resolveSelection(source, stored) {
  if (!Array.isArray(stored) || !stored.length) return defaultKeys(source);
  const allowed = new Set(defaultKeys(source));
  const resolved = [];
  for (const key of stored) {
    if (typeof key === 'string' && allowed.has(key) && !resolved.includes(key)) resolved.push(key);
  }
  return resolved.length ? resolved : defaultKeys(source);
}

module.exports = { CATALOG, catalog, defaultKeys, labelFor, validateSelection, resolveSelection };
