// services/tenants/permission_matrix.js
// ─────────────────────────────────────────────────────────────────────────────
// THE permission matrix — the single, reviewable source of truth mapping:
//   (a) every protected API route group  → the permission key it requires, and
//   (b) every app component / view (the `data-view` surfaces) → its permission.
//
// Both halves are drawn from the catalog in ./permissions.js. Nothing here
// invents new keys — `validate()` (and the test suite) assert every value is a
// real catalog key.
//
// WHY a route-GROUP matrix (by mount prefix) rather than per-handler decorators:
//   InfoGenie mounts ~120 feature routers. A central prefix→permission table is
//   far more reviewable than scattering `requirePermission()` across hundreds of
//   handlers, and it keeps "what does this surface require" answerable in one
//   place — which is exactly what the navigation-menu task needs to consume.
//
// Method granularity: each route group declares a `view` permission (the read
// gate) and, optionally, a `write` permission for mutating verbs
// (POST/PUT/PATCH/DELETE). If `write` is omitted it falls back to `view`.
//
// The COMPONENT_MATRIX (data-view → permission) is the half the menu task
// reuses to decide which nav items a user may see. Keep it cleanly exported.

const { isValidPermission } = require('./permissions');

// ── Route groups ────────────────────────────────────────────────────────────
// Longest-prefix wins (see requiredPermissionForRequest). `prefix` matches the
// path itself or any sub-path (`/api/optimizer` matches `/api/optimizer/status`).
const ROUTE_GROUPS = [
  // ── Platform / agency administration ──────────────────────────────────────
  { prefix: '/api/admin',                     view: 'platform.tenants.manage' },
  { prefix: '/api/white-label',               view: 'tenant.settings.manage' },
  // Tenant context/session router (/me, /active, /switch, /roles, /permissions,
  // self-serve create). These are bootstrap endpoints EVERY authenticated user
  // must reach — and each carries its own internal guard (membership checks,
  // self-serve-create is allowed by design) — so gate to the universally-held
  // dashboard.view rather than a restrictive admin key (would 403 normal users).
  { prefix: '/api/tenants',                   view: 'dashboard.view' },

  // ── Tenant integrations & credentials ─────────────────────────────────────
  { prefix: '/api/credentials',               view: 'tenant.credentials.manage' },
  { prefix: '/api/integrations',              view: 'tenant.integrations.manage' },
  { prefix: '/api/integrations/google-ads',   view: 'tenant.integrations.manage' },
  { prefix: '/api/integrations/meta-ads',     view: 'tenant.integrations.manage' },
  { prefix: '/api/integrations/workspace',    view: 'tenant.integrations.manage' },
  { prefix: '/api/crm-sync',                  view: 'tenant.integrations.manage' },
  { prefix: '/api/hubspot-sync',              view: 'tenant.integrations.manage' },
  { prefix: '/api/canva',                     view: 'tenant.integrations.manage' },
  { prefix: '/api/settings',                  view: 'tenant.credentials.manage' },
  // Generic "send to Slack" notify utility — invoked from multiple feature
  // surfaces (e.g. Mentions/Gaps), not integration config. Gate to the
  // universally-held dashboard.view so it works for any authenticated user
  // (the surfaces that expose the button already carry their own permission).
  { prefix: '/api/slack',                     view: 'dashboard.view' },

  // ── Dashboard / analytics / reports ───────────────────────────────────────
  { prefix: '/api/web-analytics',             view: 'analytics.view', write: 'analytics.view' },
  { prefix: '/api/attribution',               view: 'analytics.view' },
  { prefix: '/api/web-vitals',                view: 'analytics.view' },
  { prefix: '/api/heatmaps',                  view: 'analytics.view' },
  { prefix: '/api/scroll-tracker',            view: 'analytics.view' },
  { prefix: '/api/site-search',               view: 'analytics.view' },
  { prefix: '/api/true-roas',                 view: 'analytics.view' },
  { prefix: '/api/iroas',                     view: 'analytics.view' },
  { prefix: '/api/weekly-report',             view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/bulk-reports',              view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/digest',                    view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/marketing-brief',           view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/exports',                   view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/infographics',              view: 'reports.view', write: 'reports.export' },

  // ── Brand ─────────────────────────────────────────────────────────────────
  { prefix: '/api/brand-foundation',          view: 'brand.view',          write: 'brand.edit' },
  { prefix: '/api/customer-360',              view: 'brand.view',          write: 'brand.edit' },
  { prefix: '/api/brand-calendar',            view: 'brand.calendar.view', write: 'brand.calendar.edit' },
  { prefix: '/api/content-calendar',          view: 'brand.calendar.view', write: 'brand.calendar.edit' },

  // ── Compete ───────────────────────────────────────────────────────────────
  { prefix: '/api/battle-cards',              view: 'compete.battle_cards.view', write: 'compete.battle_cards.edit' },
  { prefix: '/api/sov',                       view: 'compete.competitors.view',  write: 'compete.competitors.manage' },
  { prefix: '/api/discovery',                 view: 'compete.competitors.view',  write: 'compete.competitors.manage' },
  { prefix: '/api/competitor-spend',          view: 'compete.competitors.view',  write: 'compete.competitors.manage' },
  { prefix: '/api/competitor-enrich',         view: 'compete.competitors.view',  write: 'compete.competitors.manage' },
  { prefix: '/api/real-competitors',          view: 'compete.competitors.view',  write: 'compete.competitors.manage' },
  { prefix: '/api/builtwith',                 view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/trends',                    view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/ad-library',                view: 'compete.ad_spy.view',       write: 'compete.ad_spy.manage' },
  { prefix: '/api/ad-swipe',                  view: 'compete.ad_spy.view',       write: 'compete.ad_spy.manage' },
  { prefix: '/api/creative-intel',            view: 'compete.ad_spy.view',       write: 'compete.ad_spy.manage' },
  { prefix: '/api/question-miner',            view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/quora-mining',              view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/yt-comment-miner',          view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/pricing-watch',             view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/review-monitor',            view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/local-listings',            view: 'seo.view',                  write: 'seo.run' },
  { prefix: '/api/review-aggregator',         view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/glassdoor',                 view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/job-board-spy',             view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/tech-stack',                view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/crisis-radar',              view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/social-listening',          view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/media-intel',               view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/twitter-pulse',             view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/reddit-pulse',              view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/podcast-monitor',           view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/newsletter-tracker',        view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/youtube-monitor',           view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/hashtag-intel',             view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/maps-intel',                view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/voc',                       view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/churn-scorer',              view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/search-intel',              view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/apify',                     view: 'compete.intel.view',        write: 'compete.intel.manage' },
  // ── Brand Intelligence Suite ──────────────────────────────────────────────
  { prefix: '/api/reputation-score',          view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/ave',                       view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/anomaly-detector',          view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/intent-radar',              view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/hashtag-tracker',           view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/presence-score',            view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/project-compare',           view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/influence-score',           view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/geo-insights',              view: 'compete.intel.view',        write: 'compete.intel.manage' },
  { prefix: '/api/ugc-discovery',             view: 'compete.intel.view',        write: 'compete.intel.manage' },

  // ── Grow ──────────────────────────────────────────────────────────────────
  { prefix: '/api/launch',                    view: 'grow.campaigns.view',     write: 'grow.campaigns.launch' },
  { prefix: '/api/optimizer',                 view: 'grow.optimizer.view',     write: 'grow.optimizer.control' },
  { prefix: '/api/kpi-analysis',              view: 'grow.optimizer.view',     write: 'grow.optimizer.control' },
  { prefix: '/api/landing-pages',             view: 'grow.landing_pages.view', write: 'grow.landing_pages.edit' },
  { prefix: '/api/site-builder',              view: 'grow.landing_pages.view', write: 'grow.landing_pages.edit' },
  { prefix: '/api/linksell',                  view: 'grow.landing_pages.view', write: 'grow.landing_pages.edit' },
  { prefix: '/api/bookings',                  view: 'grow.landing_pages.view', write: 'grow.landing_pages.edit' },
  { prefix: '/api/conversion-boosters',       view: 'grow.cro.view',           write: 'grow.cro.edit' },
  { prefix: '/api/ab-designer',               view: 'grow.cro.view',           write: 'grow.cro.edit' },
  { prefix: '/api/chatbot',                   view: 'grow.cro.view',           write: 'grow.cro.edit' },
  { prefix: '/api/google-ads-insights',       view: 'grow.campaigns.view',     write: 'grow.campaigns.edit' },
  { prefix: '/api/meta-insights',             view: 'grow.campaigns.view',     write: 'grow.campaigns.edit' },
  { prefix: '/api/tiktok-ads-insights',       view: 'grow.campaigns.view',     write: 'grow.campaigns.edit' },
  { prefix: '/api/microsoft-ads-insights',    view: 'grow.campaigns.view',     write: 'grow.campaigns.edit' },
  { prefix: '/api/linkedin-ads',              view: 'grow.campaigns.view',     write: 'grow.campaigns.edit' },
  { prefix: '/api/agent-goals',               view: 'grow.campaigns.view',     write: 'grow.campaigns.edit' },

  // ── Reach ─────────────────────────────────────────────────────────────────
  { prefix: '/api/audiences',                 view: 'reach.audiences.view', write: 'reach.audiences.edit' },
  { prefix: '/api/campaign-composer',         view: 'reach.email.view',     write: 'reach.email.send' },
  { prefix: '/api/geofencing',                view: 'reach.audiences.view', write: 'reach.audiences.edit' },
  { prefix: '/api/personas',                  view: 'reach.audiences.view', write: 'reach.audiences.edit' },
  { prefix: '/api/journeys',                  view: 'reach.journeys.view',  write: 'reach.journeys.edit' },
  { prefix: '/api/omnichannel',               view: 'reach.email.view',     write: 'reach.email.send' },
  { prefix: '/api/email-broadcast',           view: 'reach.email.view',     write: 'reach.email.send' },
  { prefix: '/api/cold-email',                view: 'reach.email.view',     write: 'reach.email.send' },
  { prefix: '/api/email-personalizer',        view: 'reach.email.view',     write: 'reach.email.send' },
  { prefix: '/api/deliverability',            view: 'reach.email.view',     write: 'reach.email.send' },
  { prefix: '/api/unified-inbox',             view: 'reach.inbox.view',     write: 'reach.inbox.reply' },
  { prefix: '/api/whatsapp',                  view: 'reach.inbox.view',     write: 'reach.inbox.reply' },
  { prefix: '/api/voice-caller',              view: 'reach.inbox.view',     write: 'reach.inbox.reply' },
  { prefix: '/api/reply-assistant',           view: 'reach.inbox.view',     write: 'reach.inbox.reply' },
  { prefix: '/api/influencers',               view: 'reach.leads.view',     write: 'reach.leads.manage' },
  { prefix: '/api/lead-finder',               view: 'reach.leads.view',     write: 'reach.leads.manage' },
  { prefix: '/api/lead-runs',                 view: 'reach.leads.view',     write: 'reach.leads.manage' },
  { prefix: '/api/hunter',                    view: 'reach.leads.view',     write: 'reach.leads.manage' },
  { prefix: '/api/brand-deals',               view: 'reach.leads.view',     write: 'reach.leads.manage' },
  { prefix: '/api/apollo',                    view: 'reach.leads.view',     write: 'reach.leads.manage' },
  // ── Reach — newer outreach surfaces ───────────────────────────────────────
  // Surveys: in-app survey builder + response analysis (audience insight).
  { prefix: '/api/surveys',                   view: 'reach.audiences.view', write: 'reach.audiences.edit' },
  // Email Designer: block-based visual email template builder.
  { prefix: '/api/email-designer',            view: 'reach.email.view',     write: 'reach.email.send' },
  // Drip engine (also serves Smart Send `/api/drips/smart-send-time` and
  // Translate `/api/drips/translate`).
  { prefix: '/api/drips',                     view: 'reach.email.view',     write: 'reach.email.send' },
  // Identity Spine: unified first-party customer profiles (import/stitch/merge).
  { prefix: '/api/identity',                  view: 'reach.leads.view',     write: 'reach.leads.manage' },
  // MCP server: exposes InfoGenie as an MCP tool server — an integration
  // surface (tool calls read tenant data), so gate to integrations.manage.
  { prefix: '/api/mcp',                       view: 'tenant.integrations.manage' },
  // AI Segments + Audience↔Ad Sync ride on the existing /api/audiences group;
  // Inbox Monitor rides on /api/deliverability — both already mapped above.

  // ── Creator Studio ────────────────────────────────────────────────────────
  { prefix: '/api/studio',                    view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/ecom-video',                view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/tools',                     view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/social-publisher',          view: 'creator.view', write: 'creator.publish' },
  { prefix: '/api/advocacy',                  view: 'creator.view', write: 'creator.publish' },
  { prefix: '/api/wordpress',                 view: 'creator.view', write: 'creator.publish' },
  { prefix: '/api/video-script',              view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/carousel',                  view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/voiceover',                 view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/audio-summary',             view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/ad-creative',               view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/content-modes',             view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/autopilot',                 view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/idea-feed',                 view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/wireframe',                 view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/pitch-deck',                view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/press-release',             view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/headline-tester',           view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/tiktok-downloader',         view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/tools/remove-bg',           view: 'creator.view', write: 'creator.edit' },

  // ── SEO suite ─────────────────────────────────────────────────────────────
  { prefix: '/api/seo-auditor',               view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/page-audit',                view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/seo-crawler',               view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/seo-roadmap',               view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/seo-widget',                view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/seo-annotations',           view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/seo-tasks',                 view: 'seo.view', write: 'seo.tasks.manage' },
  { prefix: '/api/serp-tracker',              view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/geo-audit',                 view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/ai-visibility',             view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/ai-visibility-coverage',    view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/ai-traffic',                view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/local-seo',                 view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/content-score',             view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/keyword-explorer',          view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/backlinks',                 view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/backlink-monitor',          view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/link-prospector',           view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/schema-generator',          view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/social-tags',               view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/accessibility',             view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/platform-search',           view: 'seo.view', write: 'seo.run' },

  // ── Manage (utilities) ────────────────────────────────────────────────────
  { prefix: '/api/projects',                  view: 'manage.projects.view', write: 'manage.projects.edit' },
  { prefix: '/api/roadmap',                   view: 'manage.projects.view', write: 'manage.projects.edit' },
  { prefix: '/api/meeting-notes',             view: 'manage.projects.view', write: 'manage.projects.edit' },
  { prefix: '/api/budget',                    view: 'manage.budget.view',   write: 'manage.budget.edit' },
  { prefix: '/api/playbook',                  view: 'manage.playbook.use',  write: 'manage.playbook.use' },
  { prefix: '/api/signal-triggers',           view: 'manage.signals.manage', write: 'manage.signals.manage' },
  { prefix: '/api/alert-routing',             view: 'manage.signals.manage', write: 'manage.signals.manage' },
  { prefix: '/api/ai-providers',              view: 'manage.ai_providers.view', write: 'manage.ai_providers.view' },
  { prefix: '/api/flywheel',                  view: 'dashboard.view' },
];

// Pre-sort longest prefix first so the most specific group wins.
const _SORTED_GROUPS = ROUTE_GROUPS.slice().sort((a, b) => b.prefix.length - a.prefix.length);

const _READ_METHODS = /^(GET|HEAD|OPTIONS)$/i;

function _matchGroup(path) {
  for (const g of _SORTED_GROUPS) {
    if (path === g.prefix || path.startsWith(g.prefix + '/')) return g;
  }
  return null;
}

// Returns { matched, permission, group }.
//   matched=false → no group covers this path (caller decides: allow + log as a gap).
//   permission=string → the catalog key required for this method.
function requiredPermissionForRequest(path, method) {
  const g = _matchGroup(path);
  if (!g) return { matched: false, permission: null, group: null };
  const isWrite = !_READ_METHODS.test(method || 'GET');
  const permission = isWrite ? (g.write || g.view) : g.view;
  return { matched: true, permission, group: g };
}

// ── Component / view matrix ──────────────────────────────────────────────────
// Maps each app `data-view` surface to the permission required to see/use it.
// The navigation-menu task consumes this to filter nav items per role.
const COMPONENT_MATRIX = {
  // Dashboard & overview
  'dashboard':            'dashboard.view',
  'action-center':        'dashboard.view',
  'results':              'dashboard.view',
  'goals':                'dashboard.view',
  'kpi-tracker':          'dashboard.view',
  'growth-methodology':   'dashboard.view',
  'flywheel':             'dashboard.view',
  'intelligence':         'dashboard.view',
  'csuite':               'dashboard.view',
  'finance-officer':      'dashboard.view',
  'ops-officer':          'dashboard.view',
  'ai-team':              'dashboard.view',
  'ai-audit-suite':       'dashboard.view',
  'amplitude-agents':     'dashboard.view',

  // Analytics & reports
  'analytics-hub':        'analytics.view',
  'web-analytics':        'analytics.view',
  'web-vitals':           'analytics.view',
  'heatmaps':             'analytics.view',
  'attribution':          'analytics.view',
  'blended-perf':         'analytics.view',
  'cross-channel':        'analytics.view',
  'post-performance':     'analytics.view',
  'social-analytics':     'analytics.view',
  'true-roas':            'analytics.view',
  'iroas':                'analytics.view',
  'bulk-reports':         'reports.view',
  'weekly-report':        'reports.view',
  'digest':               'reports.view',
  'marketing-brief':      'reports.view',
  'infographics':         'reports.view',
  'kpi-dashboard':        'analytics.view',

  // Brand & calendar
  'brand-assets':         'brand.assets.view',
  'brand-calendar':       'brand.calendar.view',
  'master-calendar':      'brand.calendar.view',
  'content-calendar':     'brand.calendar.view',

  // Compete
  'competitors':          'compete.competitors.view',
  'discovery':            'compete.competitors.view',
  'sov-tracker':          'compete.competitors.view',
  'battle-cards':         'compete.battle_cards.view',
  'battleplan':           'compete.battle_cards.view',
  'ad-library':           'compete.ad_spy.view',
  'ad-swipe':             'compete.ad_spy.view',
  'creative-intel':       'compete.ad_spy.view',
  'question-miner':       'compete.intel.view',
  'quora-mining':         'compete.intel.view',
  'crisis-radar':         'compete.intel.view',
  'glassdoor':            'compete.intel.view',
  'job-board-spy':        'compete.intel.view',
  'pricing-watch':        'compete.intel.view',
  'tech-stack':           'compete.intel.view',
  'social-listening':     'compete.intel.view',
  'media-intel':          'compete.intel.view',
  'mentions':             'compete.intel.view',
  'twitter-pulse':        'compete.intel.view',
  'reddit-pulse':         'compete.intel.view',
  'reddit':               'compete.intel.view',
  'podcast-monitor':      'compete.intel.view',
  'newsletter-tracker':   'compete.intel.view',
  'youtube-monitor':      'compete.intel.view',
  'hashtag-intel':        'compete.intel.view',
  'maps-intel':           'compete.intel.view',
  'voc':                  'compete.intel.view',
  'churn-scorer':         'compete.intel.view',
  'search-intel':         'compete.intel.view',
  'review-aggregator':    'compete.intel.view',
  'trending-topics':      'compete.intel.view',
  'content-gaps':         'compete.intel.view',
  'reputation-score':     'compete.intel.view',
  'ave':                  'compete.intel.view',
  'anomaly-detector':     'compete.intel.view',
  'intent-radar':         'compete.intel.view',
  'hashtag-tracker':      'compete.intel.view',
  'presence-score':       'compete.intel.view',
  'project-compare':      'compete.intel.view',
  'influence-score':      'compete.intel.view',
  'geo-insights':         'compete.intel.view',
  'ugc-discovery':        'compete.intel.view',
  'review-automation':    'compete.intel.view',

  // Grow
  'campaigns':            'grow.campaigns.view',
  'advertise':            'grow.campaigns.view',
  'launches':             'grow.campaigns.view',
  'import-campaigns':     'grow.campaigns.view',
  'google-ads-insights':  'grow.campaigns.view',
  'meta-insights':        'grow.campaigns.view',
  'tiktok-ads-insights':  'grow.campaigns.view',
  'linkedin-ads':         'grow.campaigns.view',
  'agent-goals':          'grow.campaigns.view',
  'optimizer':            'grow.optimizer.view',
  'opt-folders':          'grow.optimizer.view',
  'cro-lab':              'grow.cro.view',
  'conversion-boosters':  'grow.cro.view',
  'ab-designer':          'grow.cro.view',
  'headline-tester':      'grow.cro.view',
  'chatbot-builder':      'grow.cro.view',
  'landing-builder':      'grow.landing_pages.view',
  'site-builder':         'grow.landing_pages.view',
  'linksell':             'grow.landing_pages.view',
  'bookings':             'grow.landing_pages.view',

  // Reach
  'audience':             'reach.audiences.view',
  'audiences-dynamic':    'reach.audiences.view',
  'lookalike':            'reach.audiences.view',
  'icp-studio':           'reach.audiences.view',
  'intent-map':           'reach.audiences.view',
  'persona-studio':       'reach.audiences.view',
  'journey-builder':      'reach.journeys.view',
  'automations':          'reach.journeys.view',
  'omnichannel':          'reach.email.view',
  'email-broadcast':      'reach.email.view',
  'cold-email':           'reach.email.view',
  'email-personalizer':   'reach.email.view',
  'deliverability':       'reach.email.view',
  'reengage':             'reach.email.view',
  'unified-inbox':        'reach.inbox.view',
  'whatsapp':             'reach.inbox.view',
  'voice-caller':         'reach.inbox.view',
  'reply-assistant':      'reach.inbox.view',
  'influencers':          'reach.leads.view',
  'lead-gen':             'reach.leads.view',
  'lead-qualifier':       'reach.leads.view',
  'hunter':               'reach.leads.view',
  'brand-deals':          'reach.leads.view',
  'campaign-composer':    'reach.email.view',
  'geofencing':           'reach.audiences.view',
  'surveys':              'reach.audiences.view',
  'ai-segments':          'reach.audiences.view',
  'audience-ad-sync':     'reach.audiences.view',
  'identity-spine':       'reach.leads.view',
  'email-designer':       'reach.email.view',
  'smart-send':           'reach.email.view',
  'translate':            'reach.email.view',
  'inbox-monitor':        'reach.email.view',
  'mcp-server':           'tenant.integrations.manage',

  // Creator Studio
  'studio':               'creator.view',
  'creative':             'creator.view',
  'smart-creative':       'creator.view',
  'content':              'creator.view',
  'content-autopilot':    'creator.view',
  'content-modes':        'creator.view',
  'social':               'creator.view',
  'organic-social':       'creator.view',
  'social-publisher':     'creator.view',
  'employee-advocacy':    'creator.view',
  'video-script':         'creator.view',
  'ecom-video':           'creator.view',
  'ugc-avatars':          'creator.view',
  'carousel':             'creator.view',
  'voiceover':            'creator.view',
  'ad-creative':          'creator.view',
  'idea-feed':            'creator.view',
  'wireframe':            'creator.view',
  'pitch-deck':           'creator.view',
  'press-release':        'creator.view',
  'tiktok-downloader':    'creator.view',
  'localization':         'creator.view',

  // SEO
  'autoseo':              'seo.view',
  'technical-suite':      'seo.view',
  'seo-auditor':          'seo.view',
  'seo-crawler':          'seo.view',
  'seo-roadmap':          'seo.view',
  'seo-tasks':            'seo.tasks.manage',
  'seo-widget':           'seo.view',
  'serp':                 'seo.view',
  'serp-tracker':         'seo.view',
  'geo-audit':            'seo.view',
  'ai-traffic':           'seo.view',
  'vis-leaderboard':      'seo.view',
  'local-seo':            'seo.view',
  'content-score':        'seo.view',
  'contentscorer':        'seo.view',
  'keyword-explorer':     'seo.view',
  'keyword-map':          'seo.view',
  'link-suggester':       'seo.view',
  'link-prospector':      'seo.view',
  'backlinks':            'seo.view',
  'backlink-monitor':     'seo.view',
  'schema-generator':     'seo.view',
  'social-tags':          'seo.view',
  'accessibility':        'seo.view',
  'local-listings':       'seo.view',

  // Manage / utilities
  'new-project':          'manage.projects.edit',
  'roadmap':              'manage.projects.view',
  'meeting-notes':        'manage.projects.view',
  'team-meetings':        'manage.projects.view',
  'stakeholders':         'manage.projects.view',
  'budget-board':         'manage.budget.view',
  'customer-360':         'brand.view',
  'ask-infogenie':        'manage.ask.use',
  'playbook-7day':        'manage.playbook.use',
  'ai-providers':         'manage.ai_providers.view',
  'signal-triggers':      'manage.signals.manage',
  'alert-routing':        'manage.signals.manage',

  // Tenant / platform admin surfaces
  'admin':                'platform.tenants.manage',
  'agency':               'platform.tenants.manage',
  'workspaces':           'tenant.settings.manage',
  'white-label':          'tenant.settings.manage',
  'settings':             'tenant.settings.manage',
  'crm-sync':             'tenant.integrations.manage',
  'hubspot-sync':         'tenant.integrations.manage',
  'canva':                'tenant.integrations.manage',
  'templates':           'creator.view',
};

function requiredPermissionForComponent(view) {
  return COMPONENT_MATRIX[view] || null;
}

// ── Self-validation ──────────────────────────────────────────────────────────
// Asserts every key referenced anywhere in this matrix is a real catalog key.
// Returns an array of problem strings (empty = healthy). The test suite asserts
// this is empty so a typo'd permission key can never ship silently.
function validate() {
  const problems = [];
  for (const g of ROUTE_GROUPS) {
    for (const k of [g.view, g.write]) {
      if (k && !isValidPermission(k)) problems.push(`route ${g.prefix}: unknown permission "${k}"`);
    }
  }
  for (const [view, k] of Object.entries(COMPONENT_MATRIX)) {
    if (!isValidPermission(k)) problems.push(`component ${view}: unknown permission "${k}"`);
  }
  return problems;
}

module.exports = {
  ROUTE_GROUPS,
  COMPONENT_MATRIX,
  requiredPermissionForRequest,
  requiredPermissionForComponent,
  validate,
};
