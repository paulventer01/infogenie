/**
 * Execution Integrations Hub — status surface for Canva, Mailchimp, PMax,
 * LinkedIn Ads, and Segment. Deepens scaffolds without inventing fake live APIs.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[execution-hub]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'execution_hub_error' });
    }
  };
}

function _env(...keys) {
  return keys.some((k) => {
    const v = process.env[k];
    return !!(v && !/^_DUMMY/i.test(v));
  });
}

router.get('/status', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'execution:status' });

  const integrations = [
    {
      id: 'canva',
      label: 'Canva',
      category: 'Creative',
      status: _env('CANVA_CLIENT_ID', 'CANVA_API_KEY') ? 'ready' : 'scaffold',
      detail: _env('CANVA_CLIENT_ID', 'CANVA_API_KEY')
        ? 'Credentials present — open Canva bridge to launch templates'
        : 'OAuth bridge scaffolded at /api/canva — set CANVA_CLIENT_ID to go live',
      view: 'canva',
      api: '/api/canva/status',
    },
    {
      id: 'mailchimp',
      label: 'Mailchimp',
      category: 'Email / CRM',
      status: _env('MAILCHIMP_API_KEY') ? 'ready' : 'needs_key',
      detail: _env('MAILCHIMP_API_KEY')
        ? 'Push contacts via CRM Sync (Mailchimp provider)'
        : 'Set MAILCHIMP_API_KEY + MAILCHIMP_SERVER_PREFIX',
      view: 'crm-sync',
      api: '/api/crm-sync/providers',
    },
    {
      id: 'pmax',
      label: 'Google Ads Performance Max',
      category: 'Paid',
      status: _env('GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_REFRESH_TOKEN') ? 'ready' : 'needs_oauth',
      detail: _env('GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_REFRESH_TOKEN')
        ? 'Launch PMax via Advertise Hub (campaignType=pmax)'
        : 'Connect Google Ads OAuth, then launch Performance Max',
      view: 'advertise',
      api: '/api/google-ads-insights/account-summary',
    },
    {
      id: 'linkedin-ads',
      label: 'LinkedIn Ads',
      category: 'Paid',
      status: _env('LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ADS_TOKEN') ? 'partial' : 'research',
      detail: 'Ad Library / research API live; campaign creation is research-first until Ads API OAuth lands',
      view: 'linkedin-ads',
      api: '/api/linkedin-ads/test',
    },
    {
      id: 'segment',
      label: 'Segment (CDP)',
      category: 'Data',
      status: _env('SEGMENT_WRITE_KEY') ? 'ready' : 'scaffold',
      detail: _env('SEGMENT_WRITE_KEY')
        ? 'Write key present — forward spine events via /api/segment/track'
        : 'Set SEGMENT_WRITE_KEY to enable CDP event forwarding',
      view: 'execution-hub',
      api: '/api/segment/status',
    },
  ];

  const ready = integrations.filter((i) => i.status === 'ready').length;
  const score = Math.round((ready / integrations.length) * 100);

  let recentSegment = 0;
  if (tid && _db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `SELECT COUNT(*)::int n FROM segment_event_log WHERE tenant_id=$1 AND created_at > now() - interval '7 days'`,
        [tid],
      );
      recentSegment = r.rows[0]?.n || 0;
    } catch { /* table may not exist yet */ }
  }

  res.json({
    ok: true,
    score,
    ready,
    total: integrations.length,
    integrations,
    segmentEvents7d: recentSegment,
    nextSteps: integrations
      .filter((i) => i.status !== 'ready')
      .map((i) => ({ id: i.id, label: i.label, detail: i.detail, view: i.view })),
  });
}));

module.exports = router;
