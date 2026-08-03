'use strict';

/** Normalise a hostname for journey completion lookups. */
function normDomain(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .slice(0, 253);
}

const VIEW_TO_STATUS_KEY = {
  dashboard: 'overview',
  'serp-tracker': 'rankings',
  'analytics-hub': 'analytics',
  competitors: 'competitors',
  'geo-audit': 'aiSearch',
  backlinks: 'backlinks',
  battleplan: 'marketingPlan',
  'seo-auditor': 'websiteAudit',
};

/**
 * Merge server completion flags into journey rail steps.
 * @param {Array<{view:string,done:boolean}>} steps
 * @param {Record<string, boolean>|null|undefined} status
 * @param {{ competitorsCount?: number, hasBattlePlan?: boolean }} [analysis]
 */
function applyJourneyStatus(steps, status, analysis = {}) {
  const competitors = (analysis.competitorsCount || 0) > 0;
  const hasBattlePlan = !!analysis.hasBattlePlan;
  const flags = {
    overview: true,
    rankings: !!status?.rankings,
    analytics: !!status?.analytics,
    competitors,
    aiSearch: !!status?.aiSearch,
    backlinks: !!status?.backlinks,
    marketingPlan: !!(status?.marketingPlan || hasBattlePlan || competitors),
    websiteAudit: !!status?.websiteAudit,
  };
  return steps.map((step) => {
    const key = VIEW_TO_STATUS_KEY[step.view];
    if (!key) return step;
    return { ...step, done: !!flags[key] };
  });
}

module.exports = { normDomain, applyJourneyStatus, VIEW_TO_STATUS_KEY };
