const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { _genCode } = require('./schema');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[referrals]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'referral_error' });
    }
  };
}

router.get('/programs', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'referrals:list' });
  if (!_db.hasDb()) return res.json({ ok: true, programs: [] });
  const r = await _db.getPool().query(
    `SELECT * FROM referral_programs WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]
  );
  res.json({ ok: true, programs: r.rows });
}));

router.post('/programs', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'referrals:create' });
  const { name, reward_type, reward_value, referrer_reward, currency } = req.body || {};
  if (!name) return _err(res, 400, 'name required');
  const r = await _db.getPool().query(`
    INSERT INTO referral_programs (tenant_id, name, reward_type, reward_value, referrer_reward, currency)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [tid, name, reward_type || 'percent', reward_value ?? 10, referrer_reward ?? null, currency || 'USD']);
  res.json({ ok: true, program: r.rows[0] });
}));

router.get('/links', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'referrals:links' });
  const r = await _db.getPool().query(`
    SELECT l.*, p.name AS program_name FROM referral_links l
    JOIN referral_programs p ON p.id = l.program_id
    WHERE l.tenant_id=$1 ORDER BY l.created_at DESC LIMIT 100
  `, [tid]);
  res.json({ ok: true, links: r.rows });
}));

router.post('/links', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'referrals:link-create' });
  const { program_id, referrer_email, referrer_name, code } = req.body || {};
  if (!program_id) return _err(res, 400, 'program_id required');
  const finalCode = (code || _genCode()).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const r = await _db.getPool().query(`
    INSERT INTO referral_links (tenant_id, program_id, code, referrer_email, referrer_name)
    VALUES ($1,$2,$3,$4,$5) RETURNING *
  `, [tid, program_id, finalCode, referrer_email || null, referrer_name || null]);
  res.json({ ok: true, link: r.rows[0] });
}));

router.post('/track/:code', express.json(), _route(async (req, res) => {
  const code = String(req.params.code || '').toLowerCase();
  const { event, referee_email, amount } = req.body || {};
  const r = await _db.getPool().query(`SELECT * FROM referral_links WHERE code=$1`, [code]);
  if (!r.rows.length) return _err(res, 404, 'invalid code');
  const link = r.rows[0];
  if (event === 'click') {
    await _db.getPool().query(`UPDATE referral_links SET clicks = clicks + 1 WHERE id=$1`, [link.id]);
    return res.json({ ok: true, tracked: 'click' });
  }
  if (event === 'conversion') {
    await _db.getPool().query(`UPDATE referral_links SET conversions = conversions + 1 WHERE id=$1`, [link.id]);
    await _db.getPool().query(`
      INSERT INTO referral_conversions (tenant_id, link_id, referee_email, amount, status, meta)
      VALUES ($1,$2,$3,$4,'pending',$5)
    `, [link.tenant_id, link.id, referee_email || null, amount ?? null, JSON.stringify(req.body?.meta || {})]);
    return res.json({ ok: true, tracked: 'conversion' });
  }
  return _err(res, 400, 'event must be click or conversion');
}));

router.get('/stats', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'referrals:stats' });
  const [links, convs] = await Promise.all([
    _db.getPool().query(`SELECT COUNT(*)::int n, COALESCE(SUM(clicks),0)::int clicks, COALESCE(SUM(conversions),0)::int conversions FROM referral_links WHERE tenant_id=$1`, [tid]),
    _db.getPool().query(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float revenue FROM referral_conversions WHERE tenant_id=$1 AND created_at > now() - interval '30 days'`, [tid]),
  ]);
  res.json({
    ok: true,
    links: links.rows[0]?.n || 0,
    clicks: links.rows[0]?.clicks || 0,
    conversions: links.rows[0]?.conversions || 0,
    conversions30d: convs.rows[0]?.n || 0,
    revenue30d: convs.rows[0]?.revenue || 0,
  });
}));

module.exports = router;
