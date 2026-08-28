// services/tenants/permissions.js
// Permission catalog — the single source of truth for what permissions exist
// in InfoGenie. Used by:
//   • Role seeder (services/tenants/schema.js) — to grant defaults
//   • Custom role builder UI (Phase 4) — to render the checkbox matrix
//   • Permission middleware (Phase 3) — to validate `req.can(key)` lookups
//
// Naming convention:  <area>.<resource>.<action>
//   action ∈ view | create | edit | delete | export | manage
//   'manage' implies view+create+edit+delete on that resource
//
// Scope:
//   'platform' — applies across all tenants (only Platform roles can hold)
//   'tenant'   — applies within one tenant
//
// IMPORTANT: This is Phase 1. We define the catalog now. Routes are NOT yet
// gated by these — that happens in Phase 3. The catalog being complete now
// lets us build the UI and seed roles without revisiting later.

const PERMISSIONS = [
  // ── Platform-scope (cross-tenant) ─────────────────────────────────────────
  { key:'platform.tenants.manage',   scope:'platform', area:'Platform',  label:'Manage all tenants (create / suspend / delete)' },
  { key:'platform.users.manage',     scope:'platform', area:'Platform',  label:'Manage all users across tenants' },
  { key:'platform.roles.manage',     scope:'platform', area:'Platform',  label:'Edit system roles & global permissions' },
  { key:'platform.billing.manage',   scope:'platform', area:'Platform',  label:'Platform billing & subscription plans' },
  { key:'platform.impersonate',      scope:'platform', area:'Platform',  label:'Impersonate a tenant (view-as for support)' },
  { key:'platform.audit.view',       scope:'platform', area:'Platform',  label:'View platform-wide audit log' },
  { key:'platform.settings.manage',  scope:'platform', area:'Platform',  label:'Edit platform-wide settings (env, providers)' },

  // ── Tenant administration ────────────────────────────────────────────────
  { key:'tenant.settings.manage',    scope:'tenant',   area:'Tenant',    label:'Edit tenant settings (name, branding, defaults)' },
  { key:'tenant.users.view',         scope:'tenant',   area:'Tenant',    label:'View tenant members' },
  { key:'tenant.users.manage',       scope:'tenant',   area:'Tenant',    label:'Invite, edit, remove tenant members' },
  { key:'tenant.roles.manage',       scope:'tenant',   area:'Tenant',    label:'Create & edit custom roles for this tenant' },
  { key:'tenant.billing.manage',     scope:'tenant',   area:'Tenant',    label:'Tenant billing & plan changes' },
  { key:'tenant.delete',             scope:'tenant',   area:'Tenant',    label:'Delete this tenant (destructive)' },
  { key:'tenant.audit.view',         scope:'tenant',   area:'Tenant',    label:'View tenant-scoped audit log' },
  { key:'tenant.integrations.manage',scope:'tenant',   area:'Tenant',    label:'Connect / disconnect ad-platform & CRM integrations' },
  { key:'tenant.credentials.manage', scope:'tenant',   area:'Tenant',    label:'Manage API keys & credentials vault' },

  // ── Brand & strategy (Manage section) ────────────────────────────────────
  { key:'brand.view',                scope:'tenant',   area:'Brand',     label:'View Brand Foundation' },
  { key:'brand.edit',                scope:'tenant',   area:'Brand',     label:'Edit Brand Foundation' },
  { key:'brand.calendar.view',       scope:'tenant',   area:'Brand',     label:'View Brand Calendar' },
  { key:'brand.calendar.edit',       scope:'tenant',   area:'Brand',     label:'Edit Brand Calendar' },
  { key:'brand.assets.view',         scope:'tenant',   area:'Brand',     label:'View brand assets (logos, uploads)' },
  { key:'brand.assets.manage',       scope:'tenant',   area:'Brand',     label:'Upload / delete brand assets' },

  // ── Dashboard & analytics ─────────────────────────────────────────────────
  { key:'dashboard.view',            scope:'tenant',   area:'Dashboard', label:'View main dashboard' },
  { key:'analytics.view',            scope:'tenant',   area:'Dashboard', label:'View web analytics & heatmaps' },
  { key:'analytics.export',          scope:'tenant',   area:'Dashboard', label:'Export analytics data' },
  { key:'reports.view',              scope:'tenant',   area:'Dashboard', label:'View reports' },
  { key:'reports.export',            scope:'tenant',   area:'Dashboard', label:'Export reports (PDF, PPTX, XLSX)' },

  // ── Compete section ───────────────────────────────────────────────────────
  { key:'compete.competitors.view',  scope:'tenant',   area:'Compete',   label:'View competitor profiles & analyses' },
  { key:'compete.competitors.manage',scope:'tenant',   area:'Compete',   label:'Run new analyses, add/remove competitors' },
  { key:'compete.battle_cards.view', scope:'tenant',   area:'Compete',   label:'View battle cards & attack plans' },
  { key:'compete.battle_cards.edit', scope:'tenant',   area:'Compete',   label:'Generate / edit battle cards' },
  { key:'compete.ad_spy.view',       scope:'tenant',   area:'Compete',   label:'View Ad Library Spy & swipe files' },
  { key:'compete.ad_spy.manage',     scope:'tenant',   area:'Compete',   label:'Run ad-library scans, save swipes' },
  { key:'compete.intel.view',        scope:'tenant',   area:'Compete',   label:'View Win/Loss, pricing, reviews, monitoring tools' },
  { key:'compete.intel.manage',      scope:'tenant',   area:'Compete',   label:'Run intel scans (pricing, reviews, monitoring)' },

  // ── Grow section ──────────────────────────────────────────────────────────
  { key:'grow.campaigns.view',       scope:'tenant',   area:'Grow',      label:'View ad campaigns' },
  { key:'grow.campaigns.launch',     scope:'tenant',   area:'Grow',      label:'Launch ad campaigns (spends money)' },
  { key:'grow.campaigns.edit',       scope:'tenant',   area:'Grow',      label:'Edit / pause / scale campaigns' },
  { key:'grow.optimizer.view',       scope:'tenant',   area:'Grow',      label:'View AI Optimizer decisions' },
  { key:'grow.optimizer.control',    scope:'tenant',   area:'Grow',      label:'Toggle optimizer LIVE/dry-run' },
  { key:'grow.landing_pages.view',   scope:'tenant',   area:'Grow',      label:'View landing pages & link-in-bio' },
  { key:'grow.landing_pages.edit',   scope:'tenant',   area:'Grow',      label:'Build / edit landing pages' },
  { key:'grow.cro.view',             scope:'tenant',   area:'Grow',      label:'View CRO Lab tests' },
  { key:'grow.cro.edit',             scope:'tenant',   area:'Grow',      label:'Create / edit CRO tests' },

  // ── Advertising Orchestrator ──────────────────────────────────────────────
  // Per-action keys for the multi-phase advertising workflow engine. The six
  // `approve.*` gates mirror the GATE ENUM in services/agent_orchestrator/schema.js
  // one-for-one and are deliberately separate from `edit`: approving a gate
  // advances a workflow toward publishing or spending money, so authoring a
  // workflow must never imply the authority to release it.
  { key:'orchestrator.workflows.view',             scope:'tenant', area:'Orchestrator', label:'View advertising workflows, phases & pending gates' },
  { key:'orchestrator.workflows.create',           scope:'tenant', area:'Orchestrator', label:'Create advertising workflows' },
  { key:'orchestrator.workflows.edit',             scope:'tenant', area:'Orchestrator', label:'Edit workflow brief, inputs & platform selection' },
  { key:'orchestrator.workflows.request_approval', scope:'tenant', area:'Orchestrator', label:'Submit a workflow gate for approval' },
  { key:'orchestrator.workflows.approve.research_execution',       scope:'tenant', area:'Orchestrator', label:'Approve gate: research execution' },
  { key:'orchestrator.workflows.approve.creative_generation',      scope:'tenant', area:'Orchestrator', label:'Approve gate: creative generation' },
  { key:'orchestrator.workflows.approve.creative_selection',       scope:'tenant', area:'Orchestrator', label:'Approve gate: creative selection' },
  { key:'orchestrator.workflows.approve.campaign_publishing',      scope:'tenant', area:'Orchestrator', label:'Approve gate: publish campaigns to ad platforms' },
  { key:'orchestrator.workflows.approve.campaign_activation',      scope:'tenant', area:'Orchestrator', label:'Approve gate: activate campaigns (starts spend)' },
  { key:'orchestrator.workflows.approve.optimization_application', scope:'tenant', area:'Orchestrator', label:'Approve gate: apply optimizations to live campaigns' },
  { key:'orchestrator.workflows.pause',            scope:'tenant', area:'Orchestrator', label:'Pause a running workflow' },
  { key:'orchestrator.workflows.resume',           scope:'tenant', area:'Orchestrator', label:'Resume a paused workflow' },
  { key:'orchestrator.workflows.cancel',           scope:'tenant', area:'Orchestrator', label:'Cancel a workflow' },
  // Recovery breaks an execution lease and rewrites in-flight run state — an
  // operator-of-last-resort action, so it stays with owner/admin.
  { key:'orchestrator.workflows.recover',          scope:'tenant', area:'Orchestrator', label:'Recover a stuck workflow (break execution lease)' },
  { key:'orchestrator.workflows.audit.view',       scope:'tenant', area:'Orchestrator', label:'View the orchestrator audit trail' },
  // Credit accounting (PR 2). Reading spend is a wide grant; changing what may
  // be spent is not. `grant`, `adjust` and `limits.edit` move real money
  // authority — they raise the ceiling a workflow is later approved against —
  // so they stay with tenant administrators and are withheld from Marketer for
  // the same separation-of-duty reason as the `approve.*` gates.
  { key:'orchestrator.credits.view',        scope:'tenant', area:'Orchestrator', label:'View credit balance, reservations, usage & block reasons' },
  { key:'orchestrator.credits.grant',       scope:'tenant', area:'Orchestrator', label:'Issue credit grants to this tenant (admin)' },
  { key:'orchestrator.credits.adjust',      scope:'tenant', area:'Orchestrator', label:'Make manual credit adjustments & refunds (admin)' },
  { key:'orchestrator.credits.limits.view', scope:'tenant', area:'Orchestrator', label:'View tenant AI rate/cost limits & credit ceiling' },
  { key:'orchestrator.credits.limits.edit', scope:'tenant', area:'Orchestrator', label:'Change tenant AI limits & credit ceiling (admin)' },

  // ── Advertising provider drafts (PR 6F-0) ────────────────────────────────
  // Least-privilege key for the human confirmation that a paused provider draft
  // may later be created on the ad platform. It is separate from
  // `orchestrator.workflows.*` and from every `approve.*` gate on purpose: the
  // gate approval releases the campaign internally, this key names the person
  // who authorised touching the provider account. Marketer does NOT hold it —
  // authoring and approving a workflow must never imply provider authority —
  // and it is not a `.view` key, so read-only roles never inherit it.
  { key:'advertising.provider_drafts.create', scope:'tenant', area:'Advertising', label:'Confirm creation of a paused provider draft on a connected ad account' },
  { key:'advertising.reconciliation.read', scope:'tenant', area:'Advertising', label:'Authorize one bounded read of a completed provider-draft ledger' },
  { key:'advertising.reconciliation.review', scope:'tenant', area:'Advertising', label:'Human review of a reconciliation discrepancy or observation failure' },
  { key:'advertising.campaign.activate', scope:'tenant', area:'Advertising', label:'Authorize one activation attempt for a verified Meta campaign graph' },

  // ── Reach section ─────────────────────────────────────────────────────────
  { key:'reach.audiences.view',      scope:'tenant',   area:'Reach',     label:'View dynamic audiences & segments' },
  { key:'reach.audiences.edit',      scope:'tenant',   area:'Reach',     label:'Build / edit audiences' },
  { key:'reach.journeys.view',       scope:'tenant',   area:'Reach',     label:'View Journey Builder flows' },
  { key:'reach.journeys.edit',       scope:'tenant',   area:'Reach',     label:'Build / edit journeys' },
  { key:'reach.email.view',          scope:'tenant',   area:'Reach',     label:'View drip / cold email / broadcasts' },
  { key:'reach.email.send',          scope:'tenant',   area:'Reach',     label:'Send email broadcasts & cold email' },
  { key:'reach.inbox.view',          scope:'tenant',   area:'Reach',     label:'View Unified Conversation Inbox' },
  { key:'reach.inbox.reply',         scope:'tenant',   area:'Reach',     label:'Reply / change status on inbox items' },
  { key:'reach.leads.view',          scope:'tenant',   area:'Reach',     label:'View leads & influencer CRM' },
  { key:'reach.leads.manage',        scope:'tenant',   area:'Reach',     label:'Add / edit / delete leads & influencers' },

  // ── Creator Studio ────────────────────────────────────────────────────────
  { key:'creator.view',              scope:'tenant',   area:'Creator',   label:'View Creator Studio output' },
  { key:'creator.edit',              scope:'tenant',   area:'Creator',   label:'Generate videos, social posts, scripts' },
  { key:'creator.publish',           scope:'tenant',   area:'Creator',   label:'Publish to connected social accounts' },

  // ── SEO suite ─────────────────────────────────────────────────────────────
  { key:'seo.view',                  scope:'tenant',   area:'SEO',       label:'View SEO audits, GEO, SERP tracker' },
  { key:'seo.run',                   scope:'tenant',   area:'SEO',       label:'Run audits, crawls, content scoring' },
  { key:'seo.tasks.manage',          scope:'tenant',   area:'SEO',       label:'Manage SEO task list' },

  // ── Manage (utilities) ────────────────────────────────────────────────────
  { key:'manage.projects.view',      scope:'tenant',   area:'Manage',    label:'View marketing projects' },
  { key:'manage.projects.edit',      scope:'tenant',   area:'Manage',    label:'Create / edit projects' },
  { key:'manage.budget.view',        scope:'tenant',   area:'Manage',    label:'View Budget Board' },
  { key:'manage.budget.edit',        scope:'tenant',   area:'Manage',    label:'Edit budgets' },
  { key:'manage.ask.use',            scope:'tenant',   area:'Manage',    label:'Use Ask InfoGenie chatbot' },
  { key:'manage.playbook.use',       scope:'tenant',   area:'Manage',    label:'Use 7-Day Playbook' },
  { key:'manage.ai_providers.view',  scope:'tenant',   area:'Manage',    label:'View AI provider usage' },
  { key:'manage.signals.manage',     scope:'tenant',   area:'Manage',    label:'Manage signal triggers' },
];

// Quick index by key for O(1) validation
const _byKey = Object.fromEntries(PERMISSIONS.map(p => [p.key, p]));

function isValidPermission(key) { return !!_byKey[key]; }
function getPermission(key)     { return _byKey[key] || null; }
function listPermissions()      { return PERMISSIONS.slice(); }
function listByArea() {
  const out = {};
  for (const p of PERMISSIONS) { (out[p.area] = out[p.area] || []).push(p); }
  return out;
}

// All keys (used to grant Platform Owner '*' equivalent)
const ALL_PERMISSION_KEYS = PERMISSIONS.map(p => p.key);

// All tenant-scope keys (useful for Tenant Owner default grant)
const ALL_TENANT_PERMISSION_KEYS = PERMISSIONS.filter(p => p.scope === 'tenant').map(p => p.key);

// All view-only keys ending in `.view` (Analyst default grant)
const ALL_VIEW_PERMISSION_KEYS = PERMISSIONS.filter(p => p.scope === 'tenant' && /\.view$/.test(p.key)).map(p => p.key);
// Spend-starting activation is never inherited merely by being an owner or
// administrator. It must be placed on the active tenant role deliberately.
const DEFAULT_ROLE_PERMISSION_KEYS = ALL_TENANT_PERMISSION_KEYS.filter(k => k !== 'advertising.campaign.activate');

// ── System role definitions ─────────────────────────────────────────────────
// These are seeded into the `roles` table with tenant_id=NULL (system-wide).
// Custom tenant roles created later have tenant_id set and is_system=false.
const SYSTEM_ROLES = [
  {
    key: 'platform_owner',
    scope: 'platform',
    name: 'Platform Owner',
    description: 'Full control of the entire InfoGenie platform. Can manage all tenants, users, billing, and system settings. Implicitly has all tenant-level permissions when impersonating.',
    permissions: ALL_PERMISSION_KEYS.filter(k => k !== 'advertising.campaign.activate'),
  },
  {
    key: 'platform_admin',
    scope: 'platform',
    name: 'Platform Admin',
    description: 'Manages tenants and users across the platform. Cannot transfer ownership or change platform billing.',
    permissions: [
      'platform.tenants.manage', 'platform.users.manage', 'platform.impersonate',
      'platform.audit.view', 'platform.roles.manage',
      ...DEFAULT_ROLE_PERMISSION_KEYS,
    ],
  },
  {
    key: 'tenant_owner',
    scope: 'tenant',
    name: 'Tenant Owner',
    description: 'Full control of this tenant. Manages users, billing, settings, and can delete the tenant.',
    permissions: DEFAULT_ROLE_PERMISSION_KEYS,
  },
  {
    key: 'tenant_admin',
    scope: 'tenant',
    name: 'Tenant Admin',
    description: 'Manages most tenant settings and users. Cannot delete the tenant or change billing.',
    permissions: DEFAULT_ROLE_PERMISSION_KEYS.filter(k => k !== 'tenant.delete' && k !== 'tenant.billing.manage'),
  },
  {
    key: 'marketer',
    scope: 'tenant',
    name: 'Marketer',
    description: 'Day-to-day marketing operations across Compete, Grow, Reach, Creator Studio and SEO. No user management, no billing, no integration secrets.',
    permissions: [
      'dashboard.view', 'analytics.view', 'reports.view', 'reports.export',
      'brand.view', 'brand.calendar.view', 'brand.calendar.edit', 'brand.assets.view',
      'compete.competitors.view', 'compete.competitors.manage',
      'compete.battle_cards.view', 'compete.battle_cards.edit',
      'compete.ad_spy.view', 'compete.ad_spy.manage',
      'compete.intel.view', 'compete.intel.manage',
      'grow.campaigns.view', 'grow.campaigns.launch', 'grow.campaigns.edit',
      'grow.optimizer.view',
      'grow.landing_pages.view', 'grow.landing_pages.edit',
      'grow.cro.view', 'grow.cro.edit',
      // Advertising Orchestrator — operational control only. Every
      // `orchestrator.workflows.approve.*` gate and `.recover` is withheld: a
      // Marketer builds and drives a workflow but cannot self-approve the step
      // that publishes campaigns or starts spend.
      'orchestrator.workflows.view', 'orchestrator.workflows.create',
      'orchestrator.workflows.edit', 'orchestrator.workflows.request_approval',
      'orchestrator.workflows.pause', 'orchestrator.workflows.resume',
      'orchestrator.workflows.cancel',
      // Credits are read-only for a Marketer: they need to see the balance and
      // the ceiling that will block a run, but issuing a grant, booking a manual
      // adjustment or raising a limit is a tenant-administrator authority.
      'orchestrator.credits.view', 'orchestrator.credits.limits.view',
      'reach.audiences.view', 'reach.audiences.edit',
      'reach.journeys.view', 'reach.journeys.edit',
      'reach.email.view', 'reach.email.send',
      'reach.inbox.view', 'reach.inbox.reply',
      'reach.leads.view', 'reach.leads.manage',
      'creator.view', 'creator.edit',
      'seo.view', 'seo.run', 'seo.tasks.manage',
      'manage.projects.view', 'manage.projects.edit',
      'manage.budget.view',
      'manage.ask.use', 'manage.playbook.use',
    ],
  },
  {
    key: 'content_creator',
    scope: 'tenant',
    name: 'Content Creator',
    description: 'Focused on content production — Creator Studio, Brand Calendar, social publishing. Read-only on analytics and campaigns.',
    permissions: [
      'dashboard.view',
      'brand.view', 'brand.calendar.view', 'brand.calendar.edit',
      'brand.assets.view', 'brand.assets.manage',
      'creator.view', 'creator.edit', 'creator.publish',
      'reach.email.view',
      'manage.ask.use',
    ],
  },
  {
    key: 'analyst',
    scope: 'tenant',
    name: 'Analyst',
    description: 'Read-only access across the entire tenant. Can view everything and export reports, but cannot change anything.',
    permissions: [
      ...ALL_VIEW_PERMISSION_KEYS,
      'reports.export', 'analytics.export',
    ],
  },
  {
    key: 'client_viewer',
    scope: 'tenant',
    name: 'Client Viewer',
    description: 'Limited read-only view for sharing with end clients. Sees dashboard, reports, and brand only.',
    permissions: [
      'dashboard.view', 'analytics.view',
      'reports.view', 'reports.export',
      'brand.view', 'brand.calendar.view',
    ],
  },
];

module.exports = {
  PERMISSIONS,
  SYSTEM_ROLES,
  ALL_PERMISSION_KEYS,
  ALL_TENANT_PERMISSION_KEYS,
  isValidPermission,
  getPermission,
  listPermissions,
  listByArea,
};
