// Brand Monitoring hub — aggregates mentions, crisis, media, SoV.
const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

router.get('/dashboard', async (req, res) => {
  try {
    const tid = await _tid(req, 'brand-monitor:dash');
    const brand = String(req.query.brand || '').trim();

    const empty = { ok: true, brand, mentions: [], crisis: [], media: [], sov: [], inbox_new: 0, alerts: [] };

    if (!_db.hasDb()) return res.json(empty);

    const [mentions, crisis, media, sov, inbox] = await Promise.all([
      _db.getPool().query(
        `SELECT id, source, author, title, content, sentiment, occurred_at, source_url
         FROM unified_inbox_items
         WHERE tenant_id=$1 AND source IN ('reddit','twitter','newsletter','review','email')
         ORDER BY COALESCE(occurred_at, created_at) DESC NULLS LAST LIMIT 30`,
        [tid]
      ).catch(() => ({ rows: [] })),
      _db.getPool().query(
        `SELECT id, severity, title, summary, created_at FROM crisis_alerts
         WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`,
        [tid]
      ).catch(() => ({ rows: [] })),
      _db.getPool().query(
        `SELECT id, title, source, url, sentiment, published_at FROM media_intel_items
         WHERE tenant_id=$1 ORDER BY published_at DESC NULLS LAST LIMIT 20`,
        [tid]
      ).catch(() => ({ rows: [] })),
      _db.getPool().query(
        `SELECT brand, mentions, pos_count, neu_count, neg_count, taken_at
         FROM sov_snapshots WHERE tenant_id=$1 ORDER BY taken_at DESC LIMIT 20`,
        [tid]
      ).catch(() => ({ rows: [] })),
      _db.getPool().query(
        `SELECT COUNT(*)::int AS n FROM unified_inbox_items WHERE tenant_id=$1 AND status='new'`,
        [tid]
      ).catch(() => ({ rows: [{ n: 0 }] })),
    ]);

    const alerts = [];
    for (const c of crisis.rows || []) {
      alerts.push({ type: 'crisis', severity: c.severity || 'medium', text: c.title || c.summary, at: c.created_at });
    }
    const neg = (mentions.rows || []).filter((m) => m.sentiment === 'negative').slice(0, 5);
    for (const m of neg) {
      alerts.push({ type: 'sentiment', severity: 'medium', text: m.title || m.content?.slice(0, 120), at: m.occurred_at });
    }

    res.json({
      ok: true,
      brand,
      inbox_new: inbox.rows?.[0]?.n || 0,
      mentions: mentions.rows || [],
      crisis: crisis.rows || [],
      media: media.rows || [],
      sov: sov.rows || [],
      alerts: alerts.slice(0, 15),
      summary: `Monitoring live — ${mentions.rows?.length || 0} recent mentions, ${crisis.rows?.length || 0} crisis alerts, ${inbox.rows?.[0]?.n || 0} new inbox items.`,
    });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
