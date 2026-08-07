/**
 * Social × Search — GSC pages that look like Instagram/TikTok/YouTube/X earning
 * Google Search / Discover visibility. Feeds evergreen winners + strategic signals.
 */
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { hasGscCredentials, listSites } = require('./client');
const { fetchSocialSearchWinners, insightFromWinners, detectPlatform } = require('./winners');

const _safeAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function _tid(req, label) {
  const tid = await _tenantCtx.resolveTenantId(req, { label });
  if (tid) return tid;
  if (!_db.hasDb()) return 1;
  return null;
}

router.get('/status', _safeAsync(async (req, res) => {
  const configured = hasGscCredentials();
  let sites = [];
  if (configured) {
    const s = await listSites();
    sites = s.sites || [];
  }
  res.json({
    ok: true,
    configured,
    sites_count: sites.length,
    siteUrl: process.env.GSC_SITE_URL || sites[0]?.siteUrl || null,
    note: configured
      ? 'GSC connected — social×search filters Instagram/TikTok/YouTube/X/Facebook/LinkedIn page URLs from Search Analytics.'
      : 'Demo mode — add GOOGLE_SERVICE_ACCOUNT_JSON (and optional GSC_SITE_URL) for live social×search.',
    platforms: ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin'],
  });
}));

router.get('/winners', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'gsc-social:winners');
  if (!tid) return _err(res, 400, 'no_tenant');
  const payload = await fetchSocialSearchWinners({
    siteUrl: req.query.siteUrl || req.query.site_url,
    days: req.query.days,
    limit: req.query.limit,
    allowDemo: req.query.demo !== '0',
  });
  res.json({
    ok: true,
    tenant_id: tid,
    ...payload,
    insight: insightFromWinners(payload),
  });
}));

router.get('/insight', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'gsc-social:insight');
  if (!tid) return _err(res, 400, 'no_tenant');
  const payload = await fetchSocialSearchWinners({
    siteUrl: req.query.siteUrl || req.query.site_url,
    days: req.query.days,
    limit: 8,
    allowDemo: true,
  });
  const insight = insightFromWinners(payload);
  res.json({ ok: true, insight, source: payload.source, configured: payload.configured, winners_preview: (payload.winners || []).slice(0, 3) });
}));

router._fetchSocialSearchWinners = fetchSocialSearchWinners;
router._insightFromWinners = insightFromWinners;
router._detectPlatform = detectPlatform;

module.exports = router;
