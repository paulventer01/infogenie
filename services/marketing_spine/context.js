/**
 * Unified audience + attribution spine context.
 * Aggregates existing domain tables without duplicating them.
 */
const _db = require('../../db');

async function _safeCount(p, sql, params) {
  try {
    const r = await p.query(sql, params);
    return Number(r.rows[0]?.n || 0);
  } catch {
    return 0;
  }
}

async function _safeRows(p, sql, params) {
  try {
    const r = await p.query(sql, params);
    return r.rows || [];
  } catch {
    return [];
  }
}

function _healthFromParts(parts) {
  const weights = {
    audiences: 0.25,
    pixels: 0.2,
    attribution: 0.2,
    leads: 0.15,
    openActions: 0.1,
    briefFresh: 0.1,
  };
  let score = 0;
  for (const [k, w] of Object.entries(weights)) {
    score += (Math.max(0, Math.min(100, parts[k] || 0)) * w);
  }
  return Math.round(score);
}

/**
 * Build a single ecosystem health snapshot for a tenant.
 */
async function buildSpineContext(tid) {
  if (!_db.hasDb() || tid == null) {
    return {
      audiences: { segments: 0, enabled: 0, members: 0, score: 0 },
      pixels: { configured: 0, total: 3, score: 0 },
      attribution: { runs30d: 0, score: 0 },
      leads: { total: 0, scored: 0, score: 0 },
      brief: { hasToday: false, actionCount: 0, score: 0 },
      optimizer: { openActions: 0, campaigns: 0 },
      decisions: { open: 0 },
      actions: { suggested: 0, applied: 0, failed: 0 },
      healthScore: 0,
      gaps: ['Connect database to enable the marketing spine'],
    };
  }

  const p = _db.getPool();
  const [
    audRows,
    pxRows,
    capi30,
    attrRuns,
    leadTotal,
    leadScored,
    briefToday,
    optActions,
    optCamps,
    decOpen,
    actSuggested,
    actApplied,
    actFailed,
  ] = await Promise.all([
    _safeRows(p, `SELECT id, name, member_count, enabled FROM audience_segments WHERE tenant_id=$1`, [tid]),
    _safeRows(p, `SELECT platform, pixel_id, enabled FROM pixel_configs WHERE tenant_id=$1`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM capi_event_log WHERE tenant_id=$1 AND created_at > now() - interval '30 days'`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM attribution_runs WHERE tenant_id=$1 AND created_at > now() - interval '30 days'`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM lead_intel_leads WHERE tenant_id=$1`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM lead_intel_leads WHERE tenant_id=$1 AND classification IS NOT NULL`, [tid]),
    _safeRows(p, `SELECT id, actions, created_at FROM marketing_briefs WHERE tenant_id=$1 AND created_at::date = CURRENT_DATE ORDER BY created_at DESC LIMIT 1`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM optimizer_actions WHERE tenant_id=$1 AND created_at > now() - interval '7 days'`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM ad_campaigns WHERE tenant_id=$1`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM decision_recommendations WHERE tenant_id=$1 AND acted_at IS NULL AND dismissed_at IS NULL`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM marketing_actions WHERE tenant_id=$1 AND status='suggested'`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM marketing_actions WHERE tenant_id=$1 AND status='applied'`, [tid]),
    _safeCount(p, `SELECT COUNT(*)::int n FROM marketing_actions WHERE tenant_id=$1 AND status='failed'`, [tid]),
  ]);

  const enabledAud = audRows.filter((r) => r.enabled);
  const members = enabledAud.reduce((s, r) => s + (r.member_count || 0), 0);
  const audScore = Math.min(100, enabledAud.length * 20 + Math.min(40, Math.floor(members / 25)));

  const platforms = ['meta', 'linkedin', 'tiktok'];
  const configuredPx = pxRows.filter((c) => c.enabled && c.pixel_id);
  const pxScore = Math.round((configuredPx.length / platforms.length) * 100);

  const attrScore = Math.min(100, attrRuns * 25 + (capi30 > 0 ? 20 : 0));
  const leadScore = leadTotal === 0 ? 10 : Math.min(100, Math.round((leadScored / Math.max(1, leadTotal)) * 100));

  let briefActions = [];
  try {
    const raw = briefToday[0]?.actions;
    briefActions = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
    if (!Array.isArray(briefActions)) briefActions = [];
  } catch { briefActions = []; }
  const briefScore = briefToday.length ? Math.min(100, 40 + briefActions.length * 15) : 0;

  // Prefer fewer open unmanaged actions for health
  const openActionScore = Math.max(0, 100 - (actSuggested * 8) - (decOpen * 5));

  const healthScore = _healthFromParts({
    audiences: audScore,
    pixels: pxScore,
    attribution: attrScore,
    leads: leadScore,
    openActions: openActionScore,
    briefFresh: briefScore,
  });

  const gaps = [];
  if (enabledAud.length < 2) gaps.push('Create at least 2 live audience segments');
  if (configuredPx.length < 2) gaps.push('Install pixels on Meta + LinkedIn or TikTok');
  if (attrRuns === 0) gaps.push('Run multi-touch attribution to ground ROI');
  if (!briefToday.length) gaps.push('Generate today\'s Marketing Brief');
  if (decOpen > 5) gaps.push(`${decOpen} open Decision Engine recommendations need action`);
  if (actSuggested > 0) gaps.push(`${actSuggested} spine actions ready to apply`);

  return {
    audiences: {
      segments: audRows.length,
      enabled: enabledAud.length,
      members,
      score: audScore,
    },
    pixels: {
      configured: configuredPx.length,
      total: platforms.length,
      score: pxScore,
      capiEvents30d: capi30,
    },
    attribution: {
      runs30d: attrRuns,
      score: attrScore,
    },
    leads: {
      total: leadTotal,
      scored: leadScored,
      score: leadScore,
    },
    brief: {
      hasToday: briefToday.length > 0,
      actionCount: briefActions.length,
      score: briefScore,
      actions: briefActions.slice(0, 8),
    },
    optimizer: {
      openActions: optActions,
      campaigns: optCamps,
    },
    decisions: { open: decOpen },
    actions: {
      suggested: actSuggested,
      applied: actApplied,
      failed: actFailed,
    },
    healthScore,
    gaps,
  };
}

module.exports = { buildSpineContext };
