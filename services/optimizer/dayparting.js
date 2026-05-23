// T34 — Day-part / hour-of-day budget shifting analysis.
//
// For every optimizer-enabled campaign, aggregates the last N days of
// `ad_performance_hourly` by hour-of-day (0-23), computes per-hour CPA + ROAS,
// then surfaces the best/worst windows so the user can apply a day-parting
// schedule. Recommendation-only by default — applying schedules to live
// platforms is a Phase-2 concern (Meta/Google/TikTok schedule APIs differ
// significantly per platform). Persists to optimizer_dayparting.

const _db = require('../../db');
const { getSetting } = require('./schema');

const DEFAULT_WINDOW_DAYS = 14;
const MIN_HOURS_WITH_DATA = 6;   // need at least 6 hour-of-day buckets to make a call
const MIN_TOTAL_SPEND     = 25;  // skip campaigns with < $25 total spend in window

// Aggregate last N days into 24 hour-of-day buckets in the campaign's local
// timezone. Uses Postgres EXTRACT(HOUR FROM bucket_hour) — the bucket_hour
// column is stored as TIMESTAMPTZ and EXTRACT honours the session TZ. We
// keep things UTC for consistency; for region-specific dayparting the user
// can interpret hours via the surfaced UTC-anchored hour numbers.
async function _hourBuckets(campaignId, windowDays) {
  const r = await _db.getPool().query(`
    SELECT
      EXTRACT(HOUR FROM bucket_hour AT TIME ZONE 'UTC')::int AS hour,
      COALESCE(SUM(spend),0)       AS spend,
      COALESCE(SUM(impressions),0) AS impressions,
      COALESCE(SUM(clicks),0)      AS clicks,
      COALESCE(SUM(conversions),0) AS conv,
      COALESCE(SUM(revenue),0)     AS revenue,
      COUNT(*)::int                AS samples
    FROM ad_performance_hourly
    WHERE campaign_id = $1
      AND bucket_hour >= now() - ($2 || ' days')::interval
    GROUP BY 1
    ORDER BY 1
  `, [campaignId, String(windowDays)]);
  // Densify to all 24 hours so the UI can render a clean bar chart.
  const byHour = new Map(r.rows.map(x => [x.hour, x]));
  const buckets = [];
  for (let h = 0; h < 24; h++) {
    const b = byHour.get(h);
    const spend = b ? parseFloat(b.spend || 0) : 0;
    const conv  = b ? parseFloat(b.conv  || 0) : 0;
    const rev   = b ? parseFloat(b.revenue || 0) : 0;
    const clicks = b ? parseInt(b.clicks || 0, 10) : 0;
    const impressions = b ? parseInt(b.impressions || 0, 10) : 0;
    buckets.push({
      hour: h,
      spend: +spend.toFixed(2),
      impressions, clicks,
      conversions: +conv.toFixed(2),
      revenue: +rev.toFixed(2),
      cpa:  conv  > 0 ? +(spend / conv).toFixed(2) : null,
      roas: spend > 0 ? +(rev / spend).toFixed(2)  : null,
      ctr:  impressions > 0 ? +(clicks / impressions).toFixed(4) : null,
      samples: b ? b.samples : 0,
    });
  }
  return buckets;
}

// Score each hour by ROAS first, falling back to inverse-CPA when there's no
// revenue, then to CTR when there are no conversions. Hours with no spend at
// all are scored null so they don't pollute the ranking.
function _scoreHours(buckets) {
  return buckets.map(b => {
    let score = null;
    if (b.spend > 0) {
      if (b.roas !== null && b.revenue > 0) score = b.roas;        // higher better
      else if (b.cpa !== null)                score = -b.cpa;      // lower CPA → higher score
      else if (b.ctr !== null)                score = b.ctr * 100; // CTR % as last-resort proxy
    }
    return { ...b, score };
  });
}

function _formatHour(h) {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12  = ((h % 12) || 12);
  return `${h12}${ampm}`;
}

function _buildRecommendation(scored, totals) {
  const haveData = scored.filter(b => b.score !== null);
  if (haveData.length < MIN_HOURS_WITH_DATA) {
    return `Not enough data yet — only ${haveData.length} hour-of-day bucket(s) with spend in the last ${totals.windowDays} days. Recommendation requires ≥${MIN_HOURS_WITH_DATA}.`;
  }
  const sorted = [...haveData].sort((a, b) => b.score - a.score);
  const best   = sorted.slice(0, 4);
  const worst  = sorted.slice(-4).reverse();
  const bestHrs  = best.map(b => _formatHour(b.hour)).join(', ');
  const worstHrs = worst.map(b => _formatHour(b.hour)).join(', ');
  const usingRoas = best[0].roas !== null && best[0].revenue > 0;
  const metric = usingRoas ? 'ROAS' : (best[0].cpa !== null ? 'CPA' : 'CTR');
  // Architect-flagged: in CPA mode scores are negative (-CPA), so the raw
  // best/worst ratio can be negative. Build the multiplier from positive
  // magnitudes so the user-facing string is always sensible. For CPA we
  // show the inverse (lower CPA is better) so the multiplier reflects how
  // much MORE expensive the worst hour is than the best hour.
  let multiplier;
  if (usingRoas) {
    multiplier = best[0].roas / Math.max(0.01, worst[0].roas || 0.01);
  } else if (best[0].cpa !== null && worst[0].cpa !== null) {
    multiplier = (worst[0].cpa || 0) / Math.max(0.01, best[0].cpa || 0.01);
  } else {
    multiplier = Math.abs(best[0].score) / Math.max(0.0001, Math.abs(worst[0].score));
  }
  return `Top 4 hours by ${metric} (UTC): ${bestHrs}. Weakest 4: ${worstHrs}. Consider biasing budget toward the top window and reducing spend during the weakest — historic ${metric} gap is ${multiplier.toFixed(1)}× between best and worst buckets.`;
}

async function analyseCampaign(campaign, runId, windowDays = DEFAULT_WINDOW_DAYS) {
  const buckets = await _hourBuckets(campaign.id, windowDays);
  const totalSpend = buckets.reduce((s, b) => s + b.spend, 0);
  const totalConv  = buckets.reduce((s, b) => s + b.conversions, 0);
  if (totalSpend < MIN_TOTAL_SPEND) {
    return { ok: false, skipped: true, reason: `Total spend $${totalSpend.toFixed(2)} below $${MIN_TOTAL_SPEND} floor` };
  }
  const scored = _scoreHours(buckets);
  const rec    = _buildRecommendation(scored, { windowDays });
  const haveData = scored.filter(b => b.score !== null);
  const sorted   = [...haveData].sort((a, b) => b.score - a.score);
  const best4    = sorted.slice(0, 4).map(b => ({ hour: b.hour, score: b.score, cpa: b.cpa, roas: b.roas, spend: b.spend }));
  const worst4   = sorted.slice(-4).reverse().map(b => ({ hour: b.hour, score: b.score, cpa: b.cpa, roas: b.roas, spend: b.spend }));

  // tenant_id inherited from the parent campaign row.
  await _db.getPool().query(`
    INSERT INTO optimizer_dayparting
      (tenant_id, campaign_id, window_days, total_spend, total_conv, hours_json, best_hours, worst_hours, recommendation, run_id)
    VALUES ($10,$1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    campaign.id, windowDays, totalSpend.toFixed(2), totalConv.toFixed(2),
    JSON.stringify(scored), JSON.stringify(best4), JSON.stringify(worst4),
    rec, runId, campaign.tenant_id,
  ]);
  return { ok: true, campaignId: campaign.id, totalSpend, totalConv, hours: scored, bestHours: best4, worstHours: worst4, recommendation: rec };
}

async function runDaypartingOnce(opts = {}) {
  if (!_db.hasDb()) return { ok: false, error: 'no DB' };
  const windowDays = opts.windowDays || DEFAULT_WINDOW_DAYS;
  const runId  = `dp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const camps  = await _db.getPool().query(`
    SELECT * FROM ad_campaigns WHERE optimizer_enabled = true AND status != 'archived'
  `);
  const results = [];
  for (const c of camps.rows) {
    try { results.push({ id: c.id, name: c.name, ...(await analyseCampaign(c, runId, windowDays)) }); }
    catch (e) { results.push({ id: c.id, name: c.name, ok: false, error: e.message }); }
  }
  return { ok: true, runId, evaluated: camps.rows.length, results, ranAt: new Date().toISOString() };
}

let _timer = null, _running = false;
async function _safeRun() {
  if (_running) { console.log('[optimizer] dayparting skipped — previous run still in flight'); return; }
  _running = true;
  try {
    const enabled = await getSetting('dayparting_enabled', { v: true });
    if (!enabled.v) return;
    const s = await runDaypartingOnce();
    console.log('[optimizer] dayparting run:', JSON.stringify({ ok: s.ok, evaluated: s.evaluated }));
  } catch (e) { console.error('[optimizer] dayparting err:', e.message); }
  finally { _running = false; }
}
function startDaypartingCron(intervalHours = 24) {
  if (_timer) return false;
  setTimeout(_safeRun, 180_000); // 3 min after boot so other crons settle first
  _timer = setInterval(_safeRun, intervalHours * 3600 * 1000);
  return true;
}

module.exports = { runDaypartingOnce, analyseCampaign, startDaypartingCron };
