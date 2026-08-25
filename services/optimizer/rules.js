// Rule-based optimizer — every 6h evaluates each enabled campaign on the last
// 7 days of perf and applies changes (pause / scale budget) when thresholds
// are crossed. Every decision is logged to optimizer_actions.
const _db = require('../../db');
const { applyChange, platformConnected } = require('./platforms');

async function _windowStats(campaignId, days = 7) {
  const r = await _db.getPool().query(`
    SELECT
      COALESCE(SUM(spend),0)       AS spend,
      COALESCE(SUM(impressions),0) AS impressions,
      COALESCE(SUM(clicks),0)      AS clicks,
      COALESCE(SUM(conversions),0) AS conv,
      COALESCE(SUM(revenue),0)     AS revenue
    FROM ad_performance_hourly
    WHERE campaign_id = $1 AND bucket_hour >= now() - ($2 || ' days')::interval
  `, [campaignId, String(days)]);
  const s = r.rows[0] || {};
  const spend = parseFloat(s.spend || 0);
  const rev   = parseFloat(s.revenue || 0);
  return {
    spend, impressions: parseInt(s.impressions || 0, 10), clicks: parseInt(s.clicks || 0, 10),
    conversions: parseFloat(s.conv || 0), revenue: rev,
    roas: spend > 0 ? rev / spend : null,
    ctr: parseInt(s.impressions || 0, 10) > 0 ? parseInt(s.clicks || 0, 10) / parseInt(s.impressions || 0, 10) : null,
  };
}

async function _logAction(camp, type, reason, before, after, applied, applyError, runId) {
  // tenant_id is inherited from the parent ad_campaigns row so cron-emitted
  // actions land in the same tenant as the campaign they describe.
  await _db.getPool().query(`
    INSERT INTO optimizer_actions (tenant_id, campaign_id, action_type, reason, before_value, after_value, applied, apply_error, run_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [camp.tenant_id, camp.id, type, reason, JSON.stringify(before||{}), JSON.stringify(after||{}), !!applied, applyError||null, runId]);
}

async function evaluateCampaign(camp, runId, dryRun) {
  const stats = await _windowStats(camp.id, 7);
  const target  = parseFloat(camp.target_roas || 2);
  const floor   = parseFloat(camp.min_spend_floor || 50);
  const maxBud  = parseFloat(camp.max_daily_budget || 500);
  const dailyBud= parseFloat(camp.daily_budget || 0);

  // Not enough data yet — skip silently.
  if (stats.spend < floor) {
    return { decision: 'skip', reason: `Insufficient data: spent $${stats.spend.toFixed(2)} of $${floor} floor` };
  }
  // PAUSE rule
  if (stats.roas !== null && stats.roas < target * 0.5) {
    const change = { action: 'pause' };
    let applied = false, err = null;
    if (!dryRun && await platformConnected(camp.platform)) {
      const r = await applyChange(camp.platform, camp.platform_camp_id, change);
      applied = !!r.ok; err = r.ok ? null : r.error;
    }
    await _logAction(camp, 'pause',
      `7-day ROAS ${stats.roas.toFixed(2)}× is below 50% of target ${target}× (spent $${stats.spend.toFixed(2)}, revenue $${stats.revenue.toFixed(2)})`,
      { status: camp.status, roas: stats.roas, target },
      { status: 'paused' }, applied, err, runId);
    if (applied) await _db.getPool().query(`UPDATE ad_campaigns SET status='paused', updated_at=now() WHERE id=$1 AND tenant_id=$2`, [camp.id, camp.tenant_id]);
    return { decision: 'pause', applied, error: err, stats };
  }
  // SCALE rule
  if (stats.roas !== null && stats.roas > target * 1.5 && dailyBud > 0 && dailyBud < maxBud) {
    const newBud = Math.min(Math.round(dailyBud * 1.20 * 100) / 100, maxBud);
    const change = { action: 'budget', dailyBudget: newBud };
    let applied = false, err = null;
    if (!dryRun && await platformConnected(camp.platform)) {
      const r = await applyChange(camp.platform, camp.platform_camp_id, change);
      applied = !!r.ok; err = r.ok ? null : r.error;
    }
    await _logAction(camp, 'scale_budget',
      `7-day ROAS ${stats.roas.toFixed(2)}× exceeds 1.5× target — raising daily budget $${dailyBud} → $${newBud}`,
      { daily_budget: dailyBud, roas: stats.roas, target },
      { daily_budget: newBud }, applied, err, runId);
    if (applied) await _db.getPool().query(`UPDATE ad_campaigns SET daily_budget=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [newBud, camp.id, camp.tenant_id]);
    return { decision: 'scale_budget', applied, error: err, stats };
  }
  // HOLD — informational only; nothing was applied to any platform
  await _logAction(camp, 'hold',
    `7-day ROAS ${stats.roas?.toFixed(2) ?? 'n/a'}× — within target band, no change`,
    { roas: stats.roas, target }, {}, false, null, runId);
  return { decision: 'hold', applied: false, stats };
}

async function runOptimizerOnce(opts = {}) {
  if (!_db.hasDb()) return { ok: false, error: 'no DB' };
  const runId  = `run_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const camps  = await _db.getPool().query(`SELECT * FROM ad_campaigns WHERE optimizer_enabled = true AND status != 'archived'`);
  const results = [];
  for (const c of camps.rows) {
    try {
      const dryRun = true; // provider writes hard-disabled — analysis/log only
      results.push({ id: c.id, name: c.name, ...(await evaluateCampaign(c, runId, dryRun)) });
    }
    catch (e) { results.push({ id: c.id, name: c.name, decision: 'error', error: e.message }); }
  }
  return { ok: true, runId, evaluated: camps.rows.length, results, ranAt: new Date().toISOString() };
}

let _timer = null, _running = false;
async function _safeRun() {
  if (_running) { console.log('[optimizer] rules skipped — previous run still in flight'); return; }
  _running = true;
  try {
    const s = await runOptimizerOnce();
    console.log('[optimizer] rules run:', JSON.stringify({ ok:s.ok, evaluated:s.evaluated, dryRun:s.dryRun }));
  } catch (e) { console.error('[optimizer] rules err:', e.message); }
  finally { _running = false; }
}
function startOptimizerCron(intervalHours = 6) {
  if (process.env.INFOGENIE_JOBS === '1') {
    console.log('[optimizer] rules cron deferred to job scheduler');
    return false;
  }
  if (_timer) return false;
  setTimeout(_safeRun, 90000);
  _timer = setInterval(_safeRun, intervalHours * 3600 * 1000);
  return true;
}

function stopOptimizerCron() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = { runOptimizerOnce, evaluateCampaign, startOptimizerCron, stopOptimizerCron };
