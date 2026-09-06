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
  'aeo-optimizer': 'aiSearch',
  backlinks: 'backlinks',
  battleplan: 'marketingPlan',
  'marketing-plan': 'marketingPlan',
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
  const analysed = !!analysis.analysed;
  const flags = {
    overview: true,
    rankings: !!status?.rankings,
    analytics: !!status?.analytics,
    competitors,
    aiSearch: !!status?.aiSearch,
    // Snapshot metrics (backlinks, site health) and the 10-step plan are
    // available as soon as Analyse Now finishes — show the green tick then,
    // not only after the user has opened those tools.
    backlinks: !!(status?.backlinks || analysed),
    marketingPlan: !!(status?.marketingPlan || hasBattlePlan || competitors || analysed),
    websiteAudit: !!(status?.websiteAudit || analysed),
  };
  return steps.map((step) => {
    const key = VIEW_TO_STATUS_KEY[step.view];
    if (!key) return step;
    return { ...step, done: !!flags[key] };
  });
}

module.exports = { normDomain, applyJourneyStatus, VIEW_TO_STATUS_KEY };
