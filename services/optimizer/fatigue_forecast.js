// T34 — Predictive creative fatigue.
//
// For every optimizer-enabled campaign, runs a linear regression on the
// CAMPAIGN's daily CTR over the learning window. If the slope is negative
// AND the projected CTR will drop below CTR_FLOOR within FORECAST_HORIZON_DAYS,
// the campaign is flagged predicted_fatigue=true so the user (or the existing
// creative_refresh worker) can refresh creatives BEFORE performance craters.
//
// IMPORTANT (architect-flagged): until ad_performance_hourly has reliable
// per-ad attribution wired, this is CAMPAIGN-LEVEL fatigue (the same trend
// applies to every active creative under that campaign). We therefore write
// ONE forecast row per campaign (the representative active creative is cited
// for traceability). When per-ad attribution lands, this becomes true
// per-creative without changing the schema.
//
// This is recommendation-only: it does NOT pause/refresh ads. It writes to
// creative_fatigue_forecasts so the UI can surface "These ads are about to
// fade — refresh now" callouts.

const _db = require('../../db');
const { makeSettingsCache } = require('./schema');

const WINDOW_DAYS           = 14;   // learning window
const MIN_SAMPLES           = 5;    // need ≥5 days with impressions to fit a line
const MIN_DAILY_IMPRESSIONS = 50;   // skip days with < 50 impressions (noise)
const CTR_FLOOR             = 0.005;// 0.5% — same floor used by creative_refresh.js
const FORECAST_HORIZON_DAYS = 3;    // alert if predicted to cross floor within 3 days

// Daily CTR for a single creative over the window. We attribute spend/impressions
// to the creative via ad_performance_hourly.raw->>'ad_id' or a join table when
// available; absent that, we group by campaign as a coarse proxy. Real Meta/Google
// per-ad performance lives in raw JSON — keep this simple and aggregate at the
// campaign level for now (matches what creative_refresh.js does today).
async function _dailyCtrForCreative(creative) {
  const r = await _db.getPool().query(`
    SELECT
      date_trunc('day', bucket_hour AT TIME ZONE 'UTC')::date AS d,
      COALESCE(SUM(impressions),0)::bigint AS impressions,
      COALESCE(SUM(clicks),0)::bigint      AS clicks
    FROM ad_performance_hourly
    WHERE campaign_id = $1
      AND bucket_hour >= now() - ($2 || ' days')::interval
    GROUP BY 1
    ORDER BY 1
  `, [creative.campaign_id, String(WINDOW_DAYS)]);
  return r.rows
    .map(x => ({
      day: x.d,
      impressions: parseInt(x.impressions, 10),
      clicks:      parseInt(x.clicks, 10),
      ctr: parseInt(x.impressions, 10) > 0 ? parseInt(x.clicks, 10) / parseInt(x.impressions, 10) : null,
    }))
    .filter(d => d.impressions >= MIN_DAILY_IMPRESSIONS && d.ctr !== null);
}

// Ordinary least-squares regression of y on x. Returns {slope, intercept}.
// x is days-since-first-sample, y is CTR. Slope is per-day change in CTR.
function _linreg(points) {
  const n = points.length;
  if (n < 2) return null;
  const x0 = points[0].day instanceof Date ? points[0].day.getTime() : Date.parse(points[0].day);
  const xs = points.map(p => ((p.day instanceof Date ? p.day.getTime() : Date.parse(p.day)) - x0) / 86_400_000);
  const ys = points.map(p => p.ctr);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2; }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept, lastX: xs[n - 1] };
}

async function forecastCreative(creative, runId) {
  const points = await _dailyCtrForCreative(creative);
  if (points.length < MIN_SAMPLES) {
    return { ok: false, skipped: true, reason: `Only ${points.length} usable day(s) of CTR data; need ≥${MIN_SAMPLES}` };
  }
  const fit = _linreg(points);
  if (!fit) return { ok: false, skipped: true, reason: 'Could not fit regression (zero variance)' };
  const currentCtr     = points[points.length - 1].ctr;
  // Project CTR FORECAST_HORIZON_DAYS days into the future.
  const projectedCtr3d = fit.intercept + fit.slope * (fit.lastX + FORECAST_HORIZON_DAYS);
  // Days until the line crosses CTR_FLOOR — only meaningful when slope < 0.
  let daysUntilFloor = null;
  if (fit.slope < 0) {
    const xCross = (CTR_FLOOR - fit.intercept) / fit.slope; // x value where y = floor
    daysUntilFloor = +(xCross - fit.lastX).toFixed(2);
    if (!Number.isFinite(daysUntilFloor) || daysUntilFloor < 0) daysUntilFloor = 0;
  }
  const fading = fit.slope < 0;
  // Only mark fatigue if (a) slope is negative AND (b) we project crossing
  // floor within the horizon — current-CTR-already-below isn't "predicted",
  // that's existing decline detection (which creative_refresh.js handles).
  const predictedFatigue = fading
    && currentCtr > CTR_FLOOR
    && projectedCtr3d < CTR_FLOOR;
  let reason;
  if (predictedFatigue) {
    reason = `CTR is trending down ${(fit.slope * 1000).toFixed(2)}‰/day — projected to fall from ${(currentCtr * 100).toFixed(2)}% to ${(projectedCtr3d * 100).toFixed(2)}% within ${FORECAST_HORIZON_DAYS} days, crossing the ${(CTR_FLOOR * 100).toFixed(1)}% floor in ~${daysUntilFloor} days. Refresh creative now.`;
  } else if (fading) {
    reason = `CTR slowly declining ${(fit.slope * 1000).toFixed(2)}‰/day but still healthy — projected ${(projectedCtr3d * 100).toFixed(2)}% in ${FORECAST_HORIZON_DAYS}d. Monitor.`;
  } else {
    reason = `CTR stable or improving (slope ${(fit.slope * 1000).toFixed(2)}‰/day). No action needed.`;
  }

  // tenant_id inherited from the parent ad_creatives row (which was populated
  // from its parent ad_campaigns row during the Phase 2A backfill).
  await _db.getPool().query(`
    INSERT INTO creative_fatigue_forecasts
      (tenant_id, campaign_id, creative_id, platform_ad_id, window_days, samples,
       current_ctr, slope_per_day, projected_ctr_3d, days_until_floor,
       ctr_floor, predicted_fatigue, reason, run_id)
    VALUES ($14,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  `, [
    creative.campaign_id, creative.id, creative.platform_ad_id || null,
    WINDOW_DAYS, points.length,
    +currentCtr.toFixed(5), +fit.slope.toFixed(7),
    +projectedCtr3d.toFixed(5), daysUntilFloor,
    CTR_FLOOR, predictedFatigue, reason, runId, creative.tenant_id,
  ]);

  return {
    ok: true, creativeId: creative.id, platformAdId: creative.platform_ad_id,
    samples: points.length, currentCtr, slopePerDay: fit.slope,
    projectedCtr3d, daysUntilFloor, predictedFatigue, reason,
  };
}

async function runFatigueForecastOnce(opts = {}) {
  if (!_db.hasDb()) return { ok: false, error: 'no DB' };
  const runId = `ff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Architect-flagged: dedupe to ONE representative creative per campaign so
  // we don't write the same campaign-level trend N times. DISTINCT ON picks
  // the most recently-updated active creative as the representative.
  const r = await _db.getPool().query(`
    SELECT DISTINCT ON (cr.campaign_id)
      cr.*, c.optimizer_enabled, c.status AS campaign_status
    FROM ad_creatives cr
    JOIN ad_campaigns c ON c.id = cr.campaign_id
    WHERE cr.status = 'active'
      AND c.optimizer_enabled = true
      AND c.status != 'archived'
    ORDER BY cr.campaign_id, cr.updated_at DESC NULLS LAST, cr.id DESC
    LIMIT 500
  `);
  const results = [];
  // fatigue_forecast_enabled is a per-tenant setting — gate each creative by its
  // own tenant's toggle (cached per run). force=true bypasses the gate.
  const readSetting = makeSettingsCache();
  for (const cr of r.rows) {
    if (!opts.force) {
      const enabled = await readSetting(cr.tenant_id, 'fatigue_forecast_enabled', { v: true });
      if (!enabled.v) continue;
    }
    try { results.push({ id: cr.id, ...(await forecastCreative(cr, runId)) }); }
    catch (e) { results.push({ id: cr.id, ok: false, error: e.message }); }
  }
  const flagged = results.filter(x => x.predictedFatigue).length;
  return { ok: true, runId, evaluated: results.length, flagged, results, ranAt: new Date().toISOString() };
}

let _timer = null, _running = false;
async function _safeRun() {
  if (_running) { console.log('[optimizer] fatigue-forecast skipped — previous run still in flight'); return; }
  _running = true;
  try {
    // fatigue_forecast_enabled is now gated per-tenant inside runFatigueForecastOnce.
    const s = await runFatigueForecastOnce();
    console.log('[optimizer] fatigue-forecast run:', JSON.stringify({ ok: s.ok, evaluated: s.evaluated, flagged: s.flagged }));
  } catch (e) { console.error('[optimizer] fatigue-forecast err:', e.message); }
  finally { _running = false; }
}
function startFatigueForecastCron(intervalHours = 24) {
  if (_timer) return false;
  setTimeout(_safeRun, 240_000); // 4 min after boot
  _timer = setInterval(_safeRun, intervalHours * 3600 * 1000);
  return true;
}

module.exports = { runFatigueForecastOnce, forecastCreative, startFatigueForecastCron };
