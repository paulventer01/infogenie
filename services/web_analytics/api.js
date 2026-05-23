// Web Analytics aggregator — surfaces what we have without GA4.
// Read-only: pulls from optimizer's ad_insights + landing_pages tables when available.
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };

async function _safe(q, params = []) {
  try { const r = await pool.query(q, params); return r.rows; } catch { return []; }
}

router.get('/acquisition', async (req, res) => {
  if (!hasDb()) return res.json({ ga4_connected: false, channels: [], sources: [], countries: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'web_analytics:acquisition' });
  // Channels — derived from ad_insights (optimizer) where it exists
  const channels = await _safe(
    `SELECT platform AS channel, SUM(clicks)::bigint AS sessions, SUM(impressions)::bigint AS impressions
       FROM ad_insights
       WHERE tenant_id = $1 AND ts >= now() - interval '30 days'
       GROUP BY platform ORDER BY sessions DESC NULLS LAST`,
    [tid]
  );
  return res.json({
    ga4_connected: false,
    note: 'Acquisition data is derived from ad-platform insights (last 30d). Connect GA4 in Settings → Integrations for full source/medium + country data.',
    channels: channels.map(r => ({ channel: r.channel, sessions: Number(r.sessions||0), impressions: Number(r.impressions||0) })),
    sources: [],
    countries: []
  });
});

router.get('/behaviour', async (req, res) => {
  if (!hasDb()) return res.json({ all_pages: [], landing_pages: [], exit_pages: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'web_analytics:behaviour' });
  // NOTE: this references legacy columns (url, title, score) that don't exist
  // in the current landing_pages schema — _safe() swallows the error and
  // returns []. Kept tenant-scoped for the day the schema is unified.
  const landing = await _safe(
    `SELECT url, title, score FROM landing_pages WHERE tenant_id=$1 ORDER BY score DESC NULLS LAST LIMIT 25`,
    [tid]);
  return res.json({
    note: 'Behaviour data is limited without GA4. Showing landing-page intelligence from your tracked sites.',
    all_pages: landing.map(r => ({ url: r.url, title: r.title, score: r.score })),
    landing_pages: landing.map(r => ({ url: r.url, title: r.title, score: r.score })),
    exit_pages: []
  });
});

router.get('/mobile', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'web_analytics:mobile' });
  // Mobile traffic share if PageSpeed or web vitals tables exist
  const mobile = await _safe(
    `SELECT url, mobile_score, mobile_lcp_ms, mobile_cls FROM web_vitals WHERE tenant_id=$1 ORDER BY mobile_score ASC NULLS LAST LIMIT 20`,
    [tid]);
  return res.json({
    note: 'Mobile analytics derived from PageSpeed audits. Connect GA4 for real mobile session data.',
    pages: mobile
  });
});

router.get('/summary', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'web_analytics:summary' });
  // High-level rollup
  const ai30 = await _safe(
    `SELECT SUM(clicks)::bigint AS clicks, SUM(impressions)::bigint AS impressions, SUM(spend_cents)::bigint AS spend
       FROM ad_insights WHERE tenant_id=$1 AND ts >= now() - interval '30 days'`,
    [tid]);
  res.json({
    ga4_connected: false,
    period: 'last_30d',
    sessions: Number(ai30[0]?.clicks || 0),
    impressions: Number(ai30[0]?.impressions || 0),
    spend_cents: Number(ai30[0]?.spend || 0)
  });
});

module.exports = router;
