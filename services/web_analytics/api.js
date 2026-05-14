// Web Analytics aggregator — surfaces what we have without GA4.
// Read-only: pulls from optimizer's ad_insights + landing_pages tables when available.
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };

async function _safe(q, params = []) {
  try { const r = await pool.query(q, params); return r.rows; } catch { return []; }
}

router.get('/acquisition', async (_req, res) => {
  if (!hasDb()) return res.json({ ga4_connected: false, channels: [], sources: [], countries: [] });
  // Channels — derived from ad_insights (optimizer) where it exists
  const channels = await _safe(
    `SELECT platform AS channel, SUM(clicks)::bigint AS sessions, SUM(impressions)::bigint AS impressions
       FROM ad_insights
       WHERE ts >= now() - interval '30 days'
       GROUP BY platform ORDER BY sessions DESC NULLS LAST`
  );
  return res.json({
    ga4_connected: false,
    note: 'Acquisition data is derived from ad-platform insights (last 30d). Connect GA4 in Settings → Integrations for full source/medium + country data.',
    channels: channels.map(r => ({ channel: r.channel, sessions: Number(r.sessions||0), impressions: Number(r.impressions||0) })),
    sources: [],
    countries: []
  });
});

router.get('/behaviour', async (_req, res) => {
  if (!hasDb()) return res.json({ all_pages: [], landing_pages: [], exit_pages: [] });
  // Landing pages — pulled from competitor_pages or landing_pages table if available
  const landing = await _safe(`SELECT url, title, score FROM landing_pages ORDER BY score DESC NULLS LAST LIMIT 25`);
  return res.json({
    note: 'Behaviour data is limited without GA4. Showing landing-page intelligence from your tracked sites.',
    all_pages: landing.map(r => ({ url: r.url, title: r.title, score: r.score })),
    landing_pages: landing.map(r => ({ url: r.url, title: r.title, score: r.score })),
    exit_pages: []
  });
});

router.get('/mobile', async (_req, res) => {
  // Mobile traffic share if PageSpeed or web vitals tables exist
  const mobile = await _safe(`SELECT url, mobile_score, mobile_lcp_ms, mobile_cls FROM web_vitals ORDER BY mobile_score ASC NULLS LAST LIMIT 20`);
  return res.json({
    note: 'Mobile analytics derived from PageSpeed audits. Connect GA4 for real mobile session data.',
    pages: mobile
  });
});

router.get('/summary', async (_req, res) => {
  // High-level rollup
  const ai30 = await _safe(`SELECT SUM(clicks)::bigint AS clicks, SUM(impressions)::bigint AS impressions, SUM(spend_cents)::bigint AS spend FROM ad_insights WHERE ts >= now() - interval '30 days'`);
  res.json({
    ga4_connected: false,
    period: 'last_30d',
    sessions: Number(ai30[0]?.clicks || 0),
    impressions: Number(ai30[0]?.impressions || 0),
    spend_cents: Number(ai30[0]?.spend || 0)
  });
});

module.exports = router;
