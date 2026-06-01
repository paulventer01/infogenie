// services/tenants/phase2_migrate.js — Phase 2 mass migration
//
// One boot-time pass that adds `tenant_id` (+ index, + backfill to default
// tenant) to every business table in the app. Runs ~8s after boot, after
// every other service has had a chance to CREATE TABLE IF NOT EXISTS its
// own schema. Idempotent on every restart — a table that already has the
// column / index / unique constraint is a no-op.
//
// Tables intentionally EXCLUDED (left global by design):
//   • tenants, roles, tenant_users, platform_users  — the tenant infra itself
//   • users, user_identities, email_tokens, user_sessions — cross-tenant auth
//   • user_integrations  — per-user credential vault (not per-tenant)
//   • kv_store           — handled separately via key prefixing
//   • brand_foundation   — already migrated end-to-end as the proof case
//
// Tables that need UNIQUE-constraint rewrites (e.g. landing_pages.slug
// becoming UNIQUE(tenant_id, slug)) are listed in REWRITE_UNIQUE below.
// Those are the only places where the migration touches existing constraints.

const _db = require('../../db');
const { addTenantIdColumn } = require('./migration');

// IMPORTANT — execution timing:
//   This mass migration runs ~8s after boot, AFTER all parallel CREATE
//   TABLE IF NOT EXISTS calls finish. That's safe because no current route
//   reads or writes `tenant_id` yet — Phase 2A is column-only.
//
//   Once a service starts using `tenant_id` in its routes (Phase 2B), that
//   service's own `ensureXSchema()` MUST call `addTenantIdColumn(...)`
//   inline (not rely on this deferred batch). See services/brand_foundation/
//   schema.js for the canonical pattern. The deferred batch then becomes
//   a redundant no-op for that table — exactly what we want.
//
// ── KNOWN PHASE-2 LIMITATIONS (deferred to closeout):
//   • wa_contacts USED to use a single-column PK on wa_id (phone number),
//     so two tenants messaging the same number collided on insert. Now
//     rewritten to UNIQUE (tenant_id, wa_id) via REWRITE_UNIQUE below.
//   • webpush_subs (PK on endpoint) and optimizer_settings (PK on key) had
//     the same risk — a second workspace's INSERT ... ON CONFLICT silently
//     overwrote the first's row. RESOLVED: both rewritten to per-tenant
//     UNIQUE (tenant_id, endpoint) / UNIQUE (tenant_id, key) via
//     REWRITE_UNIQUE below (and inline in their owning ensureXSchema()).
//
// ── Plain additive migrations ────────────────────────────────────────────
// Just add tenant_id + index + backfill. No constraint changes.
const PLAIN_TABLES = [
  // Compete tier
  'crisis_watchlist', 'crisis_snapshots', 'crisis_incidents',
  'battle_cards', 'sov_snapshots', 'ad_swipe',
  'linkedin_ad_searches', 'media_intel_scans',
  'pricing_watch_targets', 'pricing_watch_snapshots',
  // Grow tier
  'ad_performance_hourly', 'optimizer_actions',
  'ad_creatives', 'creative_refreshes',
  'ad_sets', 'ad_set_performance_hourly',
  'bandit_allocations', 'optimizer_dayparting', 'creative_fatigue_forecasts',
  'offline_conversions',
  'cb_widgets', 'cb_events',
  'bookings', 'linksell_leads', 'linksell_orders',
  // Reach tier
  'audience_segments', 'audience_segment_members', 'audience_evaluation_log',
  'audience_drip_bindings', 'audience_hubspot_list_bindings', 'audience_reengage_bindings',
  'alert_rules', 'alert_dispatches',
  'journeys', 'journey_runs',
  'cold_email_runs', 'email_broadcasts', 'email_broadcast_recipients',
  'unified_inbox_items',
  'wa_messages', 'wa_campaigns',
  'voice_calls',
  'digest_runs',
  // Manage tier
  'marketing_projects',
  'crm_sync_logs',
  // Creator Studio / content
  'carousels', 'ab_designer_runs', 'voiceover_runs', 'tiktok_downloads',
  'content_calendar_runs', 'schema_blocks',
  'advocacy_posts', 'advocacy_share_keys', 'advocacy_shares',
  // SEO / intel
  'local_seo_runs', 'geo_audit_runs', 'social_tags_runs',
  'seo_audit_runs', 'seo_crawl_runs', 'seo_crawl_pages',
  'serp_tracker_keywords', 'serp_tracker_runs',
  'content_score_runs',
  'seo_widget_sites', 'seo_widget_leads',
  'seo_annotations', 'site_search_events', 'scroll_events',
  'ai_traffic_sites', 'ai_traffic_hits',
  'keyword_explorer_runs', 'lead_finder_runs',
  'search_intel_llm_runs',
  'search_intel_pulse_runs', 'search_intel_images',
  // Listening / social
  'job_board_runs', 'churn_scores',
  'influencer_outreach',
  'chatbot_configs', 'glassdoor_runs',
  'review_aggregator_runs', 'twitter_pulse_runs', 'reddit_pulse_runs',
  'quora_runs', 'voc_runs',
  'podcast_monitor_runs', 'hunter_searches',
  'newsletter_issues',
  'bulk_audit_runs', 'bulk_audit_items',
  'backlink_snapshots', 'backlink_changes',
  'trend_runs',
];

// ── Tables needing index extras (no constraint changes) ─────────────────
// tenant_id + an extra column makes lookups in busy tables faster.
const INDEX_EXTRAS = {
  ad_performance_hourly:      ['bucket_hour'],
  ad_set_performance_hourly:  ['bucket_hour'],
  audience_segment_members:   ['segment_id'],
  email_broadcast_recipients: ['broadcast_id'],
  seo_crawl_pages:            ['run_id'],
  scroll_events:              ['created_at'],
  site_search_events:         ['created_at'],
  ai_traffic_hits:            ['ts'],
};

// ── Tables that need a UNIQUE constraint rewritten so identifiers are ────
// only unique WITHIN a tenant, not across the whole install.
//
// Format: { table, dropConstraint, uniqueExtras }
// `dropConstraint` is the legacy Postgres-default constraint name created by
// the original CREATE TABLE (table_name + '_' + column + '_key' for single
// columns, named differently for composites). We attempt the drop; if it
// doesn't exist that's fine.
const REWRITE_UNIQUE = [
  // NOTE: landing_pages has no slug column in the live schema — different from
  // the legacy inventory. No rewrite needed; covered by plain tenant_id add.
  // backlink_monitors: domain unique per tenant
  { table:'backlink_monitors', dropConstraint:'backlink_monitors_domain_key',   uniqueExtras:['domain'] },
  // wa_templates: WhatsApp template name unique per tenant
  { table:'wa_templates',      dropConstraint:'wa_templates_name_key',          uniqueExtras:['name'] },
  // wa_contacts: WhatsApp contact phone number unique per tenant. The legacy
  // schema used wa_id as a single-column PRIMARY KEY, so the constraint to
  // drop is the auto-named PK (wa_contacts_pkey), not a *_key.
  { table:'wa_contacts',       dropConstraint:'wa_contacts_pkey',              uniqueExtras:['wa_id'] },
  // influencers: (platform, handle) unique per tenant
  { table:'influencers',       dropConstraint:'influencers_platform_handle_key', uniqueExtras:['platform','handle'] },
  // newsletter_targets: (brand, archive_url) unique per tenant
  { table:'newsletter_targets', dropConstraint:'newsletter_targets_brand_archive_url_key', uniqueExtras:['brand','archive_url'] },
  // roadmap_progress: task_id unique per tenant. Legacy schema used task_id as
  // a single-column PRIMARY KEY, so the constraint to drop is the auto-named PK.
  { table:'roadmap_progress',  dropConstraint:'roadmap_progress_pkey',         uniqueExtras:['task_id'] },
  // ad_campaigns: (platform, platform_camp_id) is platform-scoped already, but
  // two tenants could connect the same ad account by mistake. Scope per-tenant
  // so each tenant's mirror is independent.
  { table:'ad_campaigns',      dropConstraint:'ad_campaigns_platform_platform_camp_id_key',
    uniqueExtras:['platform','platform_camp_id'] },
  // search_intel_queries: (query, brand, locale) was globally unique, so two
  // tenants couldn't track the same prompt independently. Scope per-tenant.
  { table:'search_intel_queries', dropConstraint:'search_intel_queries_query_brand_locale_key',
    uniqueExtras:['query','brand','locale'] },
  // webpush_subs: browser push endpoint unique per tenant. Legacy schema used
  // endpoint as a single-column PRIMARY KEY, so drop the auto-named PK.
  { table:'webpush_subs',      dropConstraint:'webpush_subs_pkey',             uniqueExtras:['endpoint'] },
  // optimizer_settings: setting key unique per tenant. Legacy schema used key as
  // a single-column PRIMARY KEY, so drop the auto-named PK.
  { table:'optimizer_settings', dropConstraint:'optimizer_settings_pkey',      uniqueExtras:['key'] },
];

async function _safeDropConstraint(p, table, constraint) {
  try {
    await p.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
    return true;
  } catch (e) {
    console.warn(`[tenants/phase2] could not drop ${table}.${constraint}: ${e.message}`);
    return false;
  }
}

async function _runPlain(name) {
  return await addTenantIdColumn(name, {
    indexExtra: INDEX_EXTRAS[name],
  });
}

async function _runRewrite({ table, dropConstraint, uniqueExtras }) {
  if (!_db.hasDb()) return { ok:false, reason:'no_db' };
  const p = _db.getPool();
  // First do the standard migration (adds column, backfills, plain index).
  const base = await addTenantIdColumn(table);
  if (!base.ok) return base;
  // Drop the legacy single-column UNIQUE then add the per-tenant variant.
  await _safeDropConstraint(p, table, dropConstraint);
  const unique = await addTenantIdColumn(table, { uniqueWithExtra: uniqueExtras });
  return Object.assign({}, base, {
    rewriteDropped: true,
    uniqueAdded: unique.uniqueAdded === true,
    uniqueError: unique.uniqueError || null,
  });
}

// Main entry — runs all migrations and prints a one-line summary.
async function runPhase2Migration() {
  if (!_db.hasDb()) {
    console.log('[tenants/phase2] skipped — no DATABASE_URL');
    return { ok:false, reason:'no_db' };
  }
  const t0 = Date.now();
  const results = [];

  for (const name of PLAIN_TABLES) {
    try {
      const r = await _runPlain(name);
      results.push(Object.assign({ name }, r));
    } catch (e) {
      results.push({ name, ok:false, error:e.message });
    }
  }
  for (const spec of REWRITE_UNIQUE) {
    try {
      const r = await _runRewrite(spec);
      results.push(Object.assign({ name:spec.table, rewrite:true }, r));
    } catch (e) {
      results.push({ name:spec.table, rewrite:true, ok:false, error:e.message });
    }
  }

  const summary = {
    durationMs: Date.now() - t0,
    tables: results.length,
    added: results.filter(r => r.added).length,
    backfilled: results.reduce((s, r) => s + (r.backfilled || 0), 0),
    missing: results.filter(r => r.reason === 'table_missing').map(r => r.name),
    errors: results.filter(r => r.ok === false && r.reason !== 'table_missing'),
  };
  console.log(`[tenants/phase2] migration complete — ${summary.added} columns added, ${summary.backfilled} rows backfilled across ${summary.tables} tables (${summary.durationMs}ms)`);
  if (summary.missing.length) {
    console.warn('[tenants/phase2] tables not yet created (will retry next boot):', summary.missing.join(', '));
  }
  if (summary.errors.length) {
    console.warn('[tenants/phase2] errors:', JSON.stringify(summary.errors));
  }

  // Phase 2E integrity assertion: every table that has a tenant_id column
  // must have it NOT NULL and contain zero NULL rows. Drift would mean a
  // migration regressed or a new table was added without going through the
  // multitenant pattern. Log-only (never throws) so a regression in a
  // non-critical table doesn't take down the whole app.
  try {
    const pool = _db.getPool();
    // `roles` is intentionally nullable: system role rows are global (tenant_id
    // IS NULL); per-tenant custom roles are scoped (tenant_id IS NOT NULL),
    // partial unique indexes enforce both. Skip it from the strict check.
    // `email_tokens` is intentionally nullable too: only invite tokens are
    // workspace-bound (tenant_id NOT NULL); password-reset / email-verify
    // tokens have no tenant (tenant_id IS NULL). Skip it from the strict check.
    const PHASE2E_NULLABLE_OK = new Set(['roles', 'email_tokens']);
    const nullable = await pool.query(`
      SELECT table_name FROM information_schema.columns
       WHERE table_schema='public' AND column_name='tenant_id' AND is_nullable='YES'
       ORDER BY table_name`);
    const offenders = nullable.rows.filter(r => !PHASE2E_NULLABLE_OK.has(r.table_name));
    if (offenders.length) {
      console.warn(`[tenants/phase2e] INTEGRITY: ${offenders.length} table(s) still have nullable tenant_id:`,
        offenders.map(r => r.table_name).join(', '));
    } else {
      console.log('[tenants/phase2e] integrity ok — all tenant_id columns NOT NULL');
    }
  } catch (e) {
    console.warn('[tenants/phase2e] integrity check failed:', e.message);
  }

  return { ok:true, summary, results };
}

module.exports = { runPhase2Migration, PLAIN_TABLES, REWRITE_UNIQUE };
