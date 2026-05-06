// Hourly performance ingest — pulls latest metrics from each connected
// platform for every tracked campaign and upserts into ad_performance_hourly.
const _db = require('../../db');
const { fetchPerf } = require('./platforms');

async function ingestOnce() {
  if (!_db.hasDb()) return { ok: false, error: 'no DB' };
  const pool = _db.getPool();
  const camps = await pool.query(`SELECT id, platform, platform_camp_id, name FROM ad_campaigns WHERE optimizer_enabled = true`);
  const summary = { campaigns: camps.rows.length, ok: 0, failed: 0, rows: 0, errors: [] };
  for (const c of camps.rows) {
    try {
      const res = await fetchPerf(c.platform, c.platform_camp_id, 168);
      if (!res.ok) { summary.failed++; summary.errors.push({ id: c.id, name: c.name, error: res.error }); continue; }
      for (const row of res.rows) {
        await pool.query(`
          INSERT INTO ad_performance_hourly (campaign_id, bucket_hour, spend, impressions, clicks, conversions, revenue, raw, fetched_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
          ON CONFLICT (campaign_id, bucket_hour) DO UPDATE SET
            spend=EXCLUDED.spend, impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks,
            conversions=EXCLUDED.conversions, revenue=EXCLUDED.revenue, raw=EXCLUDED.raw, fetched_at=now()
        `, [c.id, row.bucket_hour, row.spend, row.impressions, row.clicks, row.conversions, row.revenue, row.raw || {}]);
        summary.rows++;
      }
      summary.ok++;
    } catch (e) {
      summary.failed++;
      summary.errors.push({ id: c.id, name: c.name, error: e.message });
    }
  }
  return { ok: true, ...summary, ranAt: new Date().toISOString() };
}

let _timer = null, _running = false;
async function _safeRun() {
  if (_running) { console.log('[optimizer] ingest skipped — previous run still in flight'); return; }
  _running = true;
  try {
    const s = await ingestOnce();
    console.log('[optimizer] ingest:', JSON.stringify({ ok: s.ok, rows: s.rows, failed: s.failed }));
  } catch (e) { console.error('[optimizer] ingest err:', e.message); }
  finally { _running = false; }
}
function startIngestCron(intervalMinutes = 60) {
  if (_timer) return false;
  setTimeout(_safeRun, 30000);
  _timer = setInterval(_safeRun, intervalMinutes * 60 * 1000);
  return true;
}

module.exports = { ingestOnce, startIngestCron };
