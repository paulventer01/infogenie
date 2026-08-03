const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[remarketing]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'remarketing_error' });
    }
  };
}

function _pixelHealth(configs) {
  const platforms = ['meta', 'linkedin', 'tiktok'];
  const configured = configs.filter((c) => c.enabled && c.pixel_id);
  const score = platforms.length
    ? Math.round((configured.length / platforms.length) * 100)
    : 0;
  return { configured: configured.length, total: platforms.length, score, configs };
}

function _audienceHealth(rows) {
  const enabled = rows.filter((r) => r.enabled);
  const retargeting = rows.filter((r) => /retarget|remarket|visitor|cart|abandon/i.test(`${r.name} ${r.description || ''}`));
  return {
    segments: rows.length,
    enabled: enabled.length,
    retargetingSegments: retargeting.length,
    totalMembers: enabled.reduce((s, r) => s + (r.member_count || 0), 0),
  };
}

function buildRecommendations({ pixels, audiences, capiEvents }) {
  const recs = [];
  if (pixels.score < 100) {
    recs.push({
      id: 'pixels-missing',
      priority: 'high',
      title: 'Complete pixel installation',
      detail: `${pixels.configured}/${pixels.total} ad platforms have active pixels. Configure Meta, LinkedIn, and TikTok in Pixel Manager.`,
      actionView: 'pixel-manager',
    });
  }
  if (audiences.retargetingSegments < 2) {
    recs.push({
      id: 'retarget-segments',
      priority: 'high',
      title: 'Create retargeting audiences',
      detail: 'Build at least: (1) all site visitors 30d, (2) cart/checkout abandoners 14d.',
      actionView: 'audiences-dynamic',
    });
  }
  if ((capiEvents || 0) < 5) {
    recs.push({
      id: 'capi-signal',
      priority: 'medium',
      title: 'Enable server-side CAPI events',
      detail: 'Low server-side event volume — iOS and cookie loss may weaken remarketing pools.',
      actionView: 'conversion-recovery',
    });
  }
  if (audiences.enabled > 0 && audiences.totalMembers < 100) {
    recs.push({
      id: 'audience-size',
      priority: 'medium',
      title: 'Grow remarketing pools',
      detail: 'Audience pools are small — sync CRM lists and widen visitor windows before scaling spend.',
      actionView: 'audience-ad-sync',
    });
  }
  recs.push({
    id: 'optimizer',
    priority: 'low',
    title: 'Review remarketing campaign ROAS',
    detail: 'Check AI Optimizer for creative fatigue on retargeting ad sets.',
    actionView: 'optimizer',
  });
  return recs;
}

router.get('/status', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'remarketing:status' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) {
    return res.json({
      ok: true,
      pixels: { configured: 0, total: 3, score: 0, configs: [] },
      audiences: { segments: 0, enabled: 0, retargetingSegments: 0, totalMembers: 0 },
      capiEvents30d: 0,
      healthScore: 0,
      recommendations: buildRecommendations({ pixels: { score: 0, configured: 0, total: 3 }, audiences: { retargetingSegments: 0, enabled: 0, totalMembers: 0 }, capiEvents: 0 }),
    });
  }
  const p = _db.getPool();
  const [px, aud, capi] = await Promise.all([
    p.query(`SELECT id, platform, pixel_id, enabled, test_result, updated_at FROM pixel_configs WHERE tenant_id=$1`, [tid]),
    p.query(`SELECT id, name, description, member_count, enabled, last_evaluated_at FROM audience_segments WHERE tenant_id=$1`, [tid]),
    p.query(`SELECT COUNT(*)::int n FROM capi_event_log WHERE tenant_id=$1 AND created_at > now() - interval '30 days'`, [tid]).catch(() => ({ rows: [{ n: 0 }] })),
  ]);

  const pixels = _pixelHealth(px.rows);
  const audiences = _audienceHealth(aud.rows);
  const capiEvents = capi.rows[0]?.n || 0;
  const healthScore = Math.round((pixels.score * 0.4) + (Math.min(100, audiences.retargetingSegments * 25) * 0.35) + (Math.min(100, capiEvents) * 0.25));

  res.json({
    ok: true,
    pixels,
    audiences,
    capiEvents30d: capiEvents,
    healthScore,
    recommendations: buildRecommendations({ pixels, audiences, capiEvents }),
  });
}));

module.exports = router;
