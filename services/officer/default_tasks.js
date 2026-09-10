// Default officer responsibilities + InfoGenie view mappings for daily reports
// and autonomous team meetings.

const OFFICER_ROLES = ['marketing', 'sales', 'analyst', 'content', 'seo', 'cro', 'finance', 'ops', 'technical'];

const OFFICER_TITLES = {
  marketing: 'Marketing Officer',
  sales: 'Sales Officer',
  analyst: 'Analyst Officer',
  content: 'Content Officer',
  seo: 'SEO Officer',
  cro: 'CRO Officer',
  finance: 'Finance Officer',
  ops: 'Operations Officer',
  technical: 'Technical Manager',
};

/** Core activated duties (first tranche) — seeded when team is activated. */
const DEFAULT_TASKS = {
  marketing: [
    'Plan and launch monthly campaigns',
    'Write ad copy and creative briefs',
    'Monitor competitor campaigns weekly',
    'Reallocate budget to top-performing channels',
    'Run weekly performance retrospective',
    'Brief content team on campaign themes',
    'Refresh ad creative on fatigue',
    'Coordinate cross-channel launches',
  ],
  sales: [
    'Build weekly outbound prospect lists',
    'Qualify inbound leads within 1 hour',
    'Follow up on stalled deals every 3 days',
    'Run weekly pipeline review',
    'Re-engage cold leads monthly',
    'Update CRM after every touch',
    'Forecast monthly revenue',
    'Track conversion rate by source',
  ],
  analyst: [
    'Build weekly cross-channel performance report',
    'Track attribution model accuracy',
    'Flag KPI anomalies daily',
    'Maintain dashboard data freshness',
    'Surface "why did X change" answers',
    'Calculate true blended ROAS',
    'Audit data sources monthly',
    'Forecast next-quarter pipeline',
  ],
  content: [
    'Plan monthly content calendar',
    'Score every piece before publishing',
    'Schedule social posts across platforms',
    'Track content engagement weekly',
    'Run monthly content gap analysis vs competitors',
    'Repurpose top content into 5 formats',
    'Maintain brand voice guide',
    'Distribute content via newsletter',
  ],
  seo: [
    'Run weekly on-page audit',
    'Track keyword rankings daily',
    'Identify content gaps vs SERPs',
    'Run GEO audit for AI search visibility',
    'Monitor Core Web Vitals',
    'Optimise meta titles + descriptions',
    'Build internal link plan monthly',
    'Schema markup review',
  ],
  cro: [
    'Run weekly A/B tests on top pages',
    'Analyse heatmaps + session recordings',
    'Document every winning experiment',
    'Test pricing page variants',
    'Optimise checkout flow',
    'Run mobile-first usability audits',
    'Test exit-intent overlays',
    'Maintain experiment backlog',
  ],
  finance: [
    'Track marketing P&L weekly',
    'Compute CAC by channel monthly',
    'Calculate LTV/CAC ratio',
    'Flag overspending campaigns',
    'Forecast 90-day cash flow',
    'Report MER monthly',
    'Set channel budget caps',
    'Variance analysis vs plan',
  ],
  ops: [
    'Run weekly campaign QA scan',
    'Audit brand asset library completeness',
    'Check lead routing health daily',
    'Maintain SOPs for every workflow',
    'Onboard new tools + integrations',
    'Track team capacity vs workload',
    'Run incident postmortems',
    'Schedule team standups',
  ],
  technical: [
    'Monitor every page subpage and feature live',
    'Probe every API and readiness endpoint',
    'Watch LLM gateway cost and guardrails',
    'Enforce credential vault and token hygiene',
    'Scan security posture and permission gaps',
    'Monitor connector freshness and silent failures',
    'Report live status in daily management meetings',
    'Publish availability and error-budget posture',
  ],
};

/** InfoGenie panels each officer must analyse in daily reports / meetings. */
const OFFICER_VIEWS = {
  marketing: [
    { view: 'optimizer', label: 'AI Optimizer' },
    { view: 'battleplan', label: 'Battle Plan' },
    { view: 'action-center', label: 'Action Center' },
    { view: 'campaigns', label: 'Campaign Strategy' },
    { view: 'advertise', label: 'Paid Ads' },
  ],
  sales: [
    { view: 'lead-finder', label: 'B2B Lead Finder' },
    { view: 'lead-qualifier', label: 'Lead Qualifier' },
    { view: 'reengage', label: 'Re-Engage' },
    { view: 'bookings', label: 'Bookings' },
    { view: 'hubspot-sync', label: 'HubSpot Sync' },
  ],
  analyst: [
    { view: 'cross-channel', label: 'Cross-Channel Report' },
    { view: 'attribution', label: 'Attribution & ROI' },
    { view: 'analytics-hub', label: 'Analytics Hub' },
    { view: 'true-roas', label: 'True ROAS' },
    { view: 'canonical-metrics', label: 'Canonical Metrics' },
  ],
  content: [
    { view: 'content-score', label: 'Content Scorer' },
    { view: 'content-calendar', label: 'Content Calendar' },
    { view: 'social-calendar', label: 'Social Calendar' },
    { view: 'content-autopilot', label: 'Content Autopilot' },
    { view: 'content-brief', label: 'SEO Content Brief Studio' },
  ],
  seo: [
    { view: 'seo-auditor', label: 'On-Page Auditor' },
    { view: 'geo-audit', label: 'GEO Audit' },
    { view: 'search-intel', label: 'AI Visibility & Search Pulse' },
    { view: 'serp-tracker', label: 'SERP Tracker' },
    { view: 'seo-tasks', label: 'SEO Task Manager' },
  ],
  cro: [
    { view: 'cro-lab', label: 'CRO Lab' },
    { view: 'conversion-boosters', label: 'Conversion Boosters' },
    { view: 'ab-designer', label: 'A/B Designer' },
    { view: 'conversion-lab', label: 'Conversion Lab' },
    { view: 'heatmaps', label: 'Heatmaps' },
  ],
  finance: [
    { view: 'finance-officer', label: 'Finance Office' },
    { view: 'budget', label: 'Budget Board' },
    { view: 'true-roas', label: 'True ROAS' },
    { view: 'iroas', label: 'Incremental ROAS' },
    { view: 'marketing-okr', label: 'Marketing OKRs' },
  ],
  ops: [
    { view: 'ops-officer', label: 'Operations Office' },
    { view: 'execution-hub', label: 'Execution Hub' },
    { view: 'master-calendar', label: 'Master Calendar' },
    { view: 'settings', label: 'Settings & Integrations' },
    { view: 'team-meetings', label: 'Team Meetings' },
  ],
  technical: [
    { view: 'technical-manager', label: 'Technical Manager desk' },
    { view: 'technical-suite', label: 'Technical Suite' },
    { view: 'ai-governance', label: 'AI Governance' },
    { view: 'data-provenance', label: 'Data Provenance' },
    { view: 'settings', label: 'Integrations & Platform APIs' },
  ],
};

const TASKS_META_KEY_SUFFIX = '_meta';

function viewsForRole(role) {
  const key = String(role || '').toLowerCase();
  return OFFICER_VIEWS[key] || [];
}

function defaultTasksForRole(role, limit = 8) {
  const key = String(role || '').toLowerCase();
  const list = DEFAULT_TASKS[key];
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit);
}

function formatViewsBlock(role) {
  const views = viewsForRole(role);
  if (!views.length) return '';
  return views.map(v => `- ${v.label} (view: ${v.view})`).join('\n');
}

/**
 * Ensure every officer role has activated tasks in the store.
 * Returns { store, meta, seededRoles, changed }.
 */
function ensureActivatedTaskStore(existingStore = {}, existingMeta = {}) {
  const store = (existingStore && typeof existingStore === 'object' && !Array.isArray(existingStore))
    ? { ...existingStore }
    : {};
  const meta = (existingMeta && typeof existingMeta === 'object' && !Array.isArray(existingMeta))
    ? { ...existingMeta }
    : {};
  const seededRoles = [];
  let changed = false;

  for (const role of OFFICER_ROLES) {
    const cur = Array.isArray(store[role]) ? store[role].filter(t => typeof t === 'string') : [];
    if (cur.length === 0) {
      store[role] = defaultTasksForRole(role, 8);
      seededRoles.push(role);
      changed = true;
    }
    if (!meta[role] || meta[role].activated !== true) {
      meta[role] = {
        ...(meta[role] && typeof meta[role] === 'object' ? meta[role] : {}),
        activated: true,
        activatedAt: meta[role]?.activatedAt || new Date().toISOString(),
        cadence: 'daily',
      };
      changed = true;
    }
  }

  if (!meta.teamActivated) {
    meta.teamActivated = true;
    meta.teamActivatedAt = meta.teamActivatedAt || new Date().toISOString();
    changed = true;
  }

  return { store, meta, seededRoles, changed };
}

module.exports = {
  OFFICER_ROLES,
  OFFICER_TITLES,
  DEFAULT_TASKS,
  OFFICER_VIEWS,
  TASKS_META_KEY_SUFFIX,
  viewsForRole,
  defaultTasksForRole,
  formatViewsBlock,
  ensureActivatedTaskStore,
};
