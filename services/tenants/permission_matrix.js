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
  { prefix: '/api/workspaces',                view: 'tenant.settings.manage' },

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
  { prefix: '/api/company-overview',          view: 'dashboard.view' },
  // Analysis snapshot restore — every logged-in role can restore their own workspace.
  { prefix: '/api/diag-capture',              view: 'dashboard.view', write: 'dashboard.view' },
  { prefix: '/api/attribution',               view: 'analytics.view' },
  { prefix: '/api/web-vitals',                view: 'analytics.view' },
  { prefix: '/api/heatmaps',                  view: 'analytics.view' },
  { prefix: '/api/scroll-tracker',            view: 'analytics.view' },
  { prefix: '/api/site-search',               view: 'analytics.view' },
  { prefix: '/api/true-roas',                 view: 'analytics.view' },
  { prefix: '/api/iroas',                     view: 'analytics.view' },
  { prefix: '/api/metrics',                   view: 'analytics.view' },
  { prefix: '/api/capacity',                  view: 'manage.projects.view', write: 'manage.projects.edit' },
  { prefix: '/api/technical-manager',         view: 'dashboard.view', write: 'dashboard.view' },
  { prefix: '/api/ops-tooling',               view: 'dashboard.view', write: 'dashboard.view' },
  { prefix: '/api/weekly-report',             view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/bulk-reports',              view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/digest',                    view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/marketing-brief',           view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/strategic',                 view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/exports',                   view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/infographics',              view: 'reports.view', write: 'reports.export' },

  // ── Brand ─────────────────────────────────────────────────────────────────
  { prefix: '/api/brand-foundation',          view: 'brand.view',          write: 'brand.edit' },
  { prefix: '/api/customer-360',              view: 'brand.view',          write: 'brand.edit' },
  { prefix: '/api/brand-calendar',            view: 'brand.calendar.view', write: 'brand.calendar.edit' },
  { prefix: '/api/content-calendar',          view: 'brand.calendar.view', write: 'brand.calendar.edit' },
  { prefix: '/api/calendar-assistant',        view: 'brand.calendar.view', write: 'brand.calendar.edit' },

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
  { prefix: '/api/lead-intelligence',          view: 'grow.optimizer.view',     write: 'grow.optimizer.control' },
  { prefix: '/api/remarketing',               view: 'grow.campaigns.view',     write: 'grow.campaigns.edit' },
  { prefix: '/api/marketing-spine',           view: 'grow.campaigns.view',     write: 'grow.campaigns.edit' },
  // Existing Agent Orchestrator hub — unchanged. The newer `orchestrator.workflows.*`
  // catalog keys are NOT a group gate: gate granularity (per-gate approve, recover)
  // is finer than one prefix, so the workflow handlers carry requirePermission()
  // per action on top of whatever group covers their mount.
  { prefix: '/api/agent-orchestrator',        view: 'brand.calendar.view',     write: 'brand.calendar.edit' },
  // Longer prefix wins. write=view so approve-only roles are not blocked by a
  // coarse create key; handlers still call requirePermission() per action.
  { prefix: '/api/agent-orchestrator/workflows', view: 'orchestrator.workflows.view', write: 'orchestrator.workflows.view' },
  { prefix: '/api/agent-orchestrator/credits', view: 'orchestrator.credits.view', write: 'orchestrator.credits.view' },
  { prefix: '/api/agent-orchestrator/research', view: 'orchestrator.workflows.view', write: 'orchestrator.workflows.view' },
  { prefix: '/api/agent-orchestrator/proposals', view: 'orchestrator.workflows.view', write: 'orchestrator.workflows.view' },
  { prefix: '/api/agent-orchestrator/static-images', view: 'orchestrator.workflows.view', write: 'orchestrator.workflows.view' },
  { prefix: '/api/agent-orchestrator/video-jobs', view: 'orchestrator.workflows.view', write: 'orchestrator.workflows.view' },
  { prefix: '/api/agent-orchestrator/campaign-drafts', view: 'orchestrator.workflows.view', write: 'orchestrator.workflows.view' },
  { prefix: '/api/agent-orchestrator/reconciliation-reviews', view: 'advertising.reconciliation.review', write: 'advertising.reconciliation.review' },
  { prefix: '/api/agent-orchestrator/meta-activation-capabilities', view: 'advertising.campaign.activate', write: 'advertising.campaign.activate' },
  { prefix: '/api/agent-orchestrator/meta-delivery-monitoring', view: 'advertising.campaign.monitor', write: 'advertising.campaign.monitor' },
  { prefix: '/api/agent-orchestrator/delivery-discrepancies', view: 'advertising.campaign.delivery.resolve', write: 'advertising.campaign.delivery.resolve' },
  { prefix: '/api/agent-orchestrator/optimization-recommendations', view: 'advertising.campaign.optimization.review', write: 'advertising.campaign.optimization.review' },
  { prefix: '/api/advertising/optimization-executions', view: 'advertising.campaign.optimization.execute', write: 'advertising.campaign.optimization.execute' },
  // PR 6F-0 provider-draft challenge/confirm routes mounted under campaign_api.
  // Both require the least-privilege advertising.provider_drafts.create key,
  // which no read-only role and no Marketer holds. Do NOT relax either key back
  // to a workflow key — that would let a workflow author authorise touching the
  // ad account.
  //
  // `view` carries the same key on purpose. Both prefixes are POST-only today,
  // so `view` is unreachable; pinning it here means a GET added under either
  // prefix later is denied to a Marketer by default instead of being exposed by
  // the fallback. Relaxing `view` is a deliberate review, not a default.
  //
  // These rows only bite because the action name sits ahead of the variable
  // draft id. This matrix matches by prefix only, so an action nested *behind*
  // a variable id (…/campaign-drafts/<id>/…/confirm-provider-draft) is
  // unreachable by any row and would silently fall back to the coarse
  // /api/agent-orchestrator/campaign-drafts row above. Any future confirm
  // surface must keep its action segment ahead of the ids, or take a mount
  // prefix of its own. See docs/security-guardrails.md (PR 6F-0).
  { prefix: '/api/agent-orchestrator/campaign-drafts/provider-draft-confirmation-challenge', view: 'advertising.provider_drafts.create', write: 'advertising.provider_drafts.create' },
  { prefix: '/api/agent-orchestrator/campaign-drafts/confirm-provider-draft', view: 'advertising.provider_drafts.create', write: 'advertising.provider_drafts.create' },
  { prefix: '/api/agent-orchestrator/campaign-drafts/execute-provider-draft', view: 'advertising.provider_drafts.create', write: 'advertising.provider_drafts.create' },
  { prefix: '/api/ai-governance',             view: 'grow.campaigns.view',     write: 'tenant.integrations.manage' },
  { prefix: '/api/ai-traces',                 view: 'grow.campaigns.view',     write: 'tenant.integrations.manage' },
  { prefix: '/api/ai-feedback',               view: 'grow.campaigns.view',     write: 'grow.campaigns.view' },
  { prefix: '/api/channel-studios',           view: 'reach.audiences.view',    write: 'reach.audiences.edit' },
  { prefix: '/api/execution-hub',             view: 'tenant.integrations.manage', write: 'tenant.integrations.manage' },
  { prefix: '/api/segment',                   view: 'tenant.integrations.manage', write: 'tenant.integrations.manage' },
  { prefix: '/api/autoclaw',                   view: 'tenant.integrations.manage', write: 'tenant.integrations.manage' },
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
  { prefix: '/api/referrals',                 view: 'reach.audiences.view', write: 'reach.audiences.edit' },
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
  { prefix: '/api/mcp-client',                view: 'tenant.integrations.manage', write: 'tenant.integrations.manage' },
  // AI Segments + Audience↔Ad Sync ride on the existing /api/audiences group;
  // Inbox Monitor rides on /api/deliverability — both already mapped above.

  // ── Creator Studio ────────────────────────────────────────────────────────
  { prefix: '/api/studio',                    view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/ecom-video',                view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/tools',                     view: 'creator.view', write: 'creator.edit' },
  { prefix: '/api/social-publisher',          view: 'creator.view', write: 'creator.publish' },
  { prefix: '/api/social-drafts',             view: 'creator.view', write: 'creator.publish' },
  { prefix: '/api/social-workflows',          view: 'creator.view', write: 'creator.publish' },
  { prefix: '/api/social-evergreen',          view: 'creator.view', write: 'creator.publish' },
  { prefix: '/api/gsc-social-search',         view: 'creator.view', write: 'creator.publish' },
  { prefix: '/api/social-inbox',              view: 'reach.inbox.view', write: 'reach.inbox.reply' },
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
  { prefix: '/api/seo-autopilot',             view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/aeo',                       view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/zero-click',                view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/voice-seo',                 view: 'seo.view', write: 'seo.run' },
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
  { prefix: '/api/affiliates',                view: 'manage.projects.view', write: 'manage.projects.edit' },
  { prefix: '/api/roadmap',                   view: 'manage.projects.view', write: 'manage.projects.edit' },
  { prefix: '/api/meeting-notes',             view: 'manage.projects.view', write: 'manage.projects.edit' },
  { prefix: '/api/budget',                    view: 'manage.budget.view',   write: 'manage.budget.edit' },
  { prefix: '/api/budget-caps',               view: 'manage.budget.view',   write: 'manage.budget.edit' },
  { prefix: '/api/budget-arbitrage',          view: 'manage.budget.view',   write: 'manage.budget.edit' },
  { prefix: '/api/okr',                       view: 'dashboard.view',       write: 'dashboard.view' },
  { prefix: '/api/ask',                       view: 'manage.ask.use',       write: 'manage.ask.use' },
  { prefix: '/api/officer',                   view: 'dashboard.view',       write: 'dashboard.view' },
  { prefix: '/api/safe-agent',                view: 'grow.optimizer.view',  write: 'grow.optimizer.control' },
  { prefix: '/api/model-compare',             view: 'manage.ai_providers.view', write: 'manage.ai_providers.view' },
  { prefix: '/api/playbook',                  view: 'manage.playbook.use',  write: 'manage.playbook.use' },
  { prefix: '/api/playbooks',                 view: 'manage.playbook.use',  write: 'manage.playbook.use' },
  { prefix: '/api/signal-triggers',           view: 'manage.signals.manage', write: 'manage.signals.manage' },
  { prefix: '/api/alert-routing',             view: 'manage.signals.manage', write: 'manage.signals.manage' },
  { prefix: '/api/ai-providers',              view: 'manage.ai_providers.view', write: 'manage.ai_providers.view' },
  { prefix: '/api/flywheel',                  view: 'dashboard.view' },

  // ── Catch-up: previously unmapped mounts (enforcement gaps) ───────────────
  { prefix: '/api/auth',                      view: 'dashboard.view' },
  { prefix: '/api/approvals',                 view: 'dashboard.view', write: 'dashboard.view' },
  { prefix: '/api/auto-operator',             view: 'grow.optimizer.view', write: 'grow.optimizer.control' },
  { prefix: '/api/self-healing',              view: 'grow.optimizer.view', write: 'grow.optimizer.control' },
  { prefix: '/api/conversion-recovery',       view: 'analytics.view', write: 'analytics.view' },
  { prefix: '/api/bulk-rewriter',             view: 'creator.edit', write: 'creator.edit' },
  { prefix: '/api/content-brief',             view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/gsc-data',                  view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/period-comparison',         view: 'analytics.view' },
  { prefix: '/api/pixel-manager',             view: 'manage.projects.view', write: 'manage.projects.edit' },
  { prefix: '/api/utm-builder',               view: 'manage.projects.view', write: 'manage.projects.edit' },
  { prefix: '/api/visitor-intel',             view: 'analytics.view' },
  { prefix: '/api/launch-compliance',         view: 'grow.campaigns.view', write: 'grow.campaigns.edit' },
  { prefix: '/api/post-launch-audit',         view: 'grow.campaigns.view', write: 'grow.campaigns.edit' },
  { prefix: '/api/funnel-analytics',          view: 'analytics.view' },
  { prefix: '/api/insta-reports',             view: 'reports.view', write: 'reports.export' },
  { prefix: '/api/email-warmup',              view: 'reach.email.view', write: 'reach.email.send' },
  { prefix: '/api/linkedin-outreach',         view: 'reach.leads.view', write: 'reach.leads.manage' },
  { prefix: '/api/rcs',                       view: 'reach.email.view', write: 'reach.email.send' },
  { prefix: '/api/ctv',                       view: 'grow.campaigns.view', write: 'grow.campaigns.launch' },
  { prefix: '/api/digital-twin',              view: 'analytics.view' },
  { prefix: '/api/mmm',                       view: 'analytics.view' },
  { prefix: '/api/revenue-forecast',          view: 'analytics.view' },
  { prefix: '/api/war-room',                  view: 'compete.intel.view', write: 'compete.intel.manage' },
  { prefix: '/api/benchmarks',                view: 'compete.intel.view' },
  { prefix: '/api/realtime-news',             view: 'compete.intel.view' },
  { prefix: '/api/change-monitor',            view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/semrush',                   view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/ahrefs',                    view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/spyfu',                     view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/majestic',                  view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/serpstat',                  view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/contentking',               view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/bing-webmaster',            view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/google-trends',             view: 'compete.intel.view' },
  { prefix: '/api/biz-scanner',               view: 'compete.intel.view' },
  { prefix: '/api/web-extractor',             view: 'compete.intel.view' },
  { prefix: '/api/recipe-scraper',            view: 'compete.intel.view' },
  { prefix: '/api/dataset-market',            view: 'compete.intel.view' },
  { prefix: '/api/resilient-tracker',         view: 'compete.intel.view' },
  { prefix: '/api/ad-comments',               view: 'grow.campaigns.view', write: 'grow.campaigns.edit' },
  { prefix: '/api/comments',                  view: 'grow.campaigns.view', write: 'grow.campaigns.edit' },
  { prefix: '/api/brand-safety',              view: 'compete.intel.view', write: 'compete.intel.manage' },
  { prefix: '/api/brand-dna',                 view: 'brand.view', write: 'brand.edit' },
  { prefix: '/api/privacy-compliance',        view: 'tenant.settings.manage' },
  { prefix: '/api/workflow-builder',          view: 'reach.journeys.view', write: 'reach.journeys.edit' },
  { prefix: '/api/swarm',                     view: 'grow.optimizer.view', write: 'grow.optimizer.control' },
  { prefix: '/api/ss-events',                 view: 'dashboard.view' },
  { prefix: '/api/llm-kb',                    view: 'manage.ask.use' },
  { prefix: '/api/knowledge-graph',           view: 'analytics.view' },
  { prefix: '/api/predictions',               view: 'analytics.view' },
  { prefix: '/api/decision-engine',           view: 'grow.optimizer.view' },
  { prefix: '/api/experiments',               view: 'grow.cro.view', write: 'grow.cro.edit' },
  { prefix: '/api/data-provenance',           view: 'analytics.view' },
  { prefix: '/api/data-products',             view: 'analytics.view' },
  { prefix: '/api/products',                  view: 'manage.projects.view' },
  { prefix: '/api/marketplace',               view: 'manage.projects.view' },
  { prefix: '/api/investor-mode',             view: 'reports.view' },
  { prefix: '/api/revenue-intel',             view: 'analytics.view' },
  { prefix: '/api/roi-ledger',                view: 'analytics.view' },
  { prefix: '/api/ai-answer-sov',             view: 'seo.view', write: 'seo.run' },
  { prefix: '/api/acquisition-engine',        view: 'reach.leads.view', write: 'reach.leads.manage' },
  { prefix: '/api/lead-aggregator',           view: 'reach.leads.view', write: 'reach.leads.manage' },
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
  'growth-hub':           'dashboard.view',
  'kpi-tracker':          'dashboard.view',
  'growth-methodology':   'dashboard.view',
  'flywheel':             'dashboard.view',
  'capacity':             'manage.projects.view',
  'canonical-metrics':    'analytics.view',
  'contribution-record':  'analytics.view',
  'intelligence':         'dashboard.view',
  'csuite':               'dashboard.view',
  'finance-officer':      'dashboard.view',
  'ops-officer':          'dashboard.view',
  'technical-manager':    'manage.projects.view',
  'ai-team':              'dashboard.view',
  'ai-audit-suite':       'dashboard.view',
  'amplitude-agents':     'dashboard.view',
  'seo-ai-visibility':    'seo.view',
  'creative-hub':         'creator.view',
  'pages-hub':            'grow.landing_pages.view',
  'organic-performance':  'creator.view',
  'marketing-okr':        'dashboard.view',
  'budget-caps':          'manage.budget.view',
  'action-queue':         'dashboard.view',
  'ad-comment-monitor':   'grow.campaigns.view',
  'ahrefs':               'seo.view',
  'audio-summary':        'creator.view',
  'auto-operator':        'grow.optimizer.view',
  'benchmarks':           'compete.intel.view',
  'brand-safety':         'compete.intel.view',
  'bulk-rewriter':        'creator.view',
  'change-monitor':       'seo.view',
  'content-brief':        'seo.view',
  'conversion-recovery':  'analytics.view',
  'ctv-streaming':        'grow.campaigns.view',
  'data-provenance':      'analytics.view',
  'digital-twin':         'analytics.view',
  'email-analytics':      'reach.email.view',
  'email-warmup':         'reach.email.view',
  'funnel-analytics':     'analytics.view',
  'gsc-data':             'seo.view',
  'insta-reports':        'reports.view',
  'investor-mode':        'reports.view',
  'landing-pages':        'grow.landing_pages.view',
  'launch-compliance':    'grow.campaigns.view',
  'linkedin-outreach':    'reach.leads.view',
  'marketing-memory':     'manage.ask.use',
  'marketplace':          'manage.projects.view',
  'mmm':                  'analytics.view',
  'model-compare':        'manage.ai_providers.view',
  'period-comparison':    'analytics.view',
  'post-launch-audit':    'grow.campaigns.view',
  'predictive-intelligence': 'manage.ask.use',
  'product-library':      'manage.projects.view',
  'rcs-campaigns':        'reach.email.view',
  'realtime-news':        'compete.intel.view',
  'revenue-forecast':     'analytics.view',
  'safe-agent':           'grow.optimizer.view',
  'self-healing':         'grow.optimizer.view',
  'semrush':              'seo.view',
  'utm-builder':          'manage.projects.view',
  'vertical-playbooks':   'manage.playbook.use',
  'visitor-intel':        'analytics.view',
  'war-room':             'compete.intel.view',

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
  'calendar-assistant':   'brand.calendar.view',

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
  'paid-search-social':   'grow.campaigns.view',
  'launches':             'grow.campaigns.view',
  'import-campaigns':     'grow.campaigns.view',
  'google-ads-insights':  'grow.campaigns.view',
  'meta-insights':        'grow.campaigns.view',
  'tiktok-ads-insights':  'grow.campaigns.view',
  'linkedin-ads':         'grow.campaigns.view',
  'agent-goals':          'grow.campaigns.view',
  'optimizer':            'grow.optimizer.view',
  'lead-intelligence':    'grow.optimizer.view',
  'remarketing-suite':    'grow.campaigns.view',
  'ecosystem-spine':      'grow.campaigns.view',
  'agent-orchestrator':   'brand.calendar.view',
  'ai-governance':        'manage.ai_providers.view',
  'newsletter-studio':    'reach.email.view',
  'podcast-studio':       'creator.view',
  'interactive-leads':    'reach.audiences.view',
  'execution-hub':        'tenant.integrations.manage',
  'opt-folders':          'grow.optimizer.view',
  'cro-lab':              'grow.cro.view',
  'conversion-lab':       'grow.cro.view',
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
  'messaging-channels':   'reach.email.view',
  'email-broadcast':      'reach.email.view',
  'cold-email':           'reach.email.view',
  'email-personalizer':   'reach.email.view',
  'deliverability':       'reach.email.view',
  'reengage':             'reach.email.view',
  'lifecycle-email':      'reach.email.view',
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
  'referral-manager':     'reach.audiences.view',
  'push-marketing':       'reach.audiences.view',
  'social-commerce':      'reach.audiences.view',
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
  'content-studio':       'creator.view',
  'content-autopilot':    'creator.view',
  'content-modes':        'creator.view',
  'social':               'creator.view',
  'organic-social':       'creator.view',
  'social-publisher':     'creator.view',
  'social-command-center':'creator.view',
  'employee-advocacy':    'creator.view',
  'video-script':         'creator.view',
  'short-form-video':     'creator.view',
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
  'seo-growth-autopilot': 'seo.view',
  'technical-suite':      'seo.view',
  'seo-auditor':          'seo.view',
  'seo-crawler':          'seo.view',
  'seo-roadmap':          'seo.view',
  'seo-tasks':            'seo.tasks.manage',
  'seo-widget':           'seo.view',
  'serp':                 'seo.view',
  'serp-tracker':         'seo.view',
  'geo-audit':            'seo.view',
  'aeo-optimizer':        'seo.view',
  'zero-click-hub':       'seo.view',
  'voice-seo':            'seo.view',
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
  'budget':               'manage.budget.view',
  'budget-board':         'manage.budget.view',
  'budget-arbitrage':     'manage.budget.view',
  'customer-360':         'brand.view',
  'ask-infogenie':        'manage.ask.use',
  'conversational-ai':    'manage.ask.use',
  'strategic-intelligence':'manage.ask.use',
  'playbook-7day':        'manage.playbook.use',
  'ai-providers':         'manage.ai_providers.view',
  'autoclaw':             'tenant.integrations.manage',
  'pixel-manager':        'manage.projects.view',
  'affiliate-hub':        'manage.projects.view',
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
