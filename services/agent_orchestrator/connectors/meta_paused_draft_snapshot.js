'use strict';

const { fail } = require('../errors');
const C = require('../campaign_contracts');

const META_PAGE_ID_RE = /^[0-9]{1,32}$/;

const OBJECTIVE_MAP = Object.freeze({
  traffic: Object.freeze({
    campaign_objective: 'OUTCOME_TRAFFIC',
    optimization_goal: 'LINK_CLICKS',
  }),
  awareness: Object.freeze({
    campaign_objective: 'OUTCOME_AWARENESS',
    optimization_goal: 'REACH',
  }),
  leads: Object.freeze({
    campaign_objective: 'OUTCOME_LEADS',
    optimization_goal: 'LANDING_PAGE_VIEWS',
  }),
});

function isPlainRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function assertPageId(pageId) {
  const raw = pageId != null ? String(pageId).trim() : '';
  if (!META_PAGE_ID_RE.test(raw)) {
    fail('validation_failed', { field: 'page_id' });
  }
  return raw;
}

function selectPrimaryCreative(snapshot) {
  const creatives = Array.isArray(snapshot.creatives) ? snapshot.creatives.slice() : [];
  if (!creatives.length) fail('validation_failed', { field: 'creatives' });
  creatives.sort((a, b) => {
    const left = `${String(a.asset_id || '')}\0${Number(a.version || 0)}`;
    const right = `${String(b.asset_id || '')}\0${Number(b.version || 0)}`;
    return left.localeCompare(right);
  });
  const primary = creatives[0];
  if (!primary || primary.kind !== 'creative_brief') {
    fail('validation_failed', { field: 'creatives' });
  }
  return primary;
}

function budgetMinorUnits(snapshot) {
  const budget = snapshot && snapshot.budget;
  if (!budget || !C.CURRENCIES.includes(String(budget.currency || ''))) {
    fail('validation_failed', { field: 'budget.currency' });
  }
  const micros = Number(budget.amount_micros);
  if (!Number.isSafeInteger(micros) || micros <= 0) {
    fail('validation_failed', { field: 'budget.amount_micros' });
  }
  const minor = Math.round(micros / 10000);
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    fail('validation_failed', { field: 'budget.amount_micros' });
  }
  return { daily_budget: String(minor), currency: String(budget.currency) };
}

function landingUrlWithTracking(snapshot) {
  const destination = snapshot && snapshot.destination;
  const tracking = snapshot && snapshot.tracking;
  if (!destination || typeof destination.landing_page_url !== 'string' || !destination.landing_page_url) {
    fail('validation_failed', { field: 'destination.landing_page_url' });
  }
  if (!tracking
      || typeof tracking.utm_source !== 'string'
      || typeof tracking.utm_medium !== 'string'
      || typeof tracking.utm_campaign !== 'string') {
    fail('validation_failed', { field: 'tracking' });
  }
  let url;
  try {
    url = new URL(destination.landing_page_url);
  } catch (_e) {
    fail('validation_failed', { field: 'destination.landing_page_url' });
  }
  url.searchParams.set('utm_source', tracking.utm_source);
  url.searchParams.set('utm_medium', tracking.utm_medium);
  url.searchParams.set('utm_campaign', tracking.utm_campaign);
  return url.toString();
}

function campaignName(snapshot) {
  const audienceName = snapshot.audience && typeof snapshot.audience.name === 'string'
    ? snapshot.audience.name.trim()
    : '';
  if (audienceName) return audienceName.slice(0, 120);
  const utm = snapshot.tracking && typeof snapshot.tracking.utm_campaign === 'string'
    ? snapshot.tracking.utm_campaign.trim()
    : '';
  if (utm) return utm.slice(0, 120);
  return `InfoGenie paused draft (${String(snapshot.objective || 'draft')})`.slice(0, 120);
}

function objectiveMapping(snapshot) {
  const objective = String(snapshot.objective || '');
  if (!C.OBJECTIVES.includes(objective)) fail('validation_failed', { field: 'objective' });
  const mapped = OBJECTIVE_MAP[objective];
  if (!mapped) fail('validation_failed', { field: 'objective' });
  return mapped;
}

function geoTargeting(snapshot) {
  const geo = snapshot && snapshot.geo;
  if (!geo || !Array.isArray(geo.countries) || !geo.countries.length || geo.countries.length > C.MAX_COUNTRIES) {
    fail('validation_failed', { field: 'geo.countries' });
  }
  const countries = geo.countries.map((country, index) => {
    if (typeof country !== 'string' || !C.ISO2.test(country)) {
      fail('validation_failed', { field: `geo.countries[${index}]` });
    }
    return country;
  });
  return Object.freeze({
    geo_locations: Object.freeze({ countries: Object.freeze(countries.slice()) }),
    targeting_automation: Object.freeze({ advantage_audience: 0 }),
  });
}

/**
 * Fail closed before any provider mutation when the approved snapshot cannot
 * be mapped to the bounded one-campaign/one-adset/one-creative/one-ad graph.
 */
function validateApprovedSnapshotForMetaDraft(snapshot, credentials) {
  if (!isPlainRecord(snapshot)) fail('validation_failed', { field: 'snapshot' });
  if (!Array.isArray(snapshot.platforms) || !snapshot.platforms.includes('meta')) {
    fail('validation_failed', { field: 'platforms' });
  }
  assertPageId(credentials && credentials.pageId);
  objectiveMapping(snapshot);
  budgetMinorUnits(snapshot);
  landingUrlWithTracking(snapshot);
  selectPrimaryCreative(snapshot);
  geoTargeting(snapshot);
  return true;
}

function buildMetaPausedDraftRequests(snapshot, credentials) {
  validateApprovedSnapshotForMetaDraft(snapshot, credentials);
  const pageId = assertPageId(credentials.pageId);
  const act = String(credentials.adAccountId || '').replace(/^act_/, '');
  if (!act) fail('missing_credentials');
  const mapped = objectiveMapping(snapshot);
  const budget = budgetMinorUnits(snapshot);
  const link = landingUrlWithTracking(snapshot);
  const name = campaignName(snapshot);
  const targeting = geoTargeting(snapshot);
  const headline = (snapshot.audience && snapshot.audience.name)
    ? String(snapshot.audience.name).slice(0, 40)
    : String(snapshot.tracking.utm_campaign).slice(0, 40);
  const message = (snapshot.audience && snapshot.audience.name)
    ? String(snapshot.audience.name).slice(0, 500)
    : String(snapshot.tracking.utm_campaign).slice(0, 500);

  return Object.freeze([
    Object.freeze({
      kind: 'campaign',
      path: `/act_${encodeURIComponent(act)}/campaigns`,
      params: Object.freeze({
        name,
        objective: mapped.campaign_objective,
        status: 'PAUSED',
        special_ad_categories: '[]',
        is_adset_budget_sharing_enabled: 'false',
      }),
    }),
    Object.freeze({
      kind: 'adset',
      path: `/act_${encodeURIComponent(act)}/adsets`,
      params: Object.freeze({
        name: `${name} ad set`,
        campaign_id: '$campaign_id',
        status: 'PAUSED',
        billing_event: 'IMPRESSIONS',
        optimization_goal: mapped.optimization_goal,
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        daily_budget: budget.daily_budget,
        targeting: JSON.stringify(targeting),
      }),
    }),
    Object.freeze({
      kind: 'creative',
      path: `/act_${encodeURIComponent(act)}/adcreatives`,
      params: Object.freeze({
        name: `${name} creative`,
        object_story_spec: JSON.stringify({
          page_id: pageId,
          link_data: Object.freeze({
            message,
            link,
            name: headline,
          }),
        }),
      }),
    }),
    Object.freeze({
      kind: 'ad',
      path: `/act_${encodeURIComponent(act)}/ads`,
      params: Object.freeze({
        name: `${name} ad`,
        adset_id: '$adset_id',
        creative: JSON.stringify({ creative_id: '$creative_id' }),
        status: 'PAUSED',
      }),
    }),
  ]);
}

module.exports = {
  META_PAGE_ID_RE,
  OBJECTIVE_MAP,
  validateApprovedSnapshotForMetaDraft,
  buildMetaPausedDraftRequests,
  selectPrimaryCreative,
};
