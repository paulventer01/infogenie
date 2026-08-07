const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { _genAffCode } = require('./schema');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[affiliates]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'affiliate_error' });
    }
  };
}

router.get('/programs', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'affiliates:programs' });
  const r = await _db.getPool().query(`SELECT * FROM affiliate_programs WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok: true, programs: r.rows });
}));

router.post('/programs', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'affiliates:program-create' });
  const { name, commission_pct, cookie_days, payout_terms } = req.body || {};
  if (!name) return _err(res, 400, 'name required');
  const r = await _db.getPool().query(`
    INSERT INTO affiliate_programs (tenant_id, name, commission_pct, cookie_days, payout_terms)
    VALUES ($1,$2,$3,$4,$5) RETURNING *
  `, [tid, name, commission_pct ?? 15, cookie_days ?? 30, payout_terms || null]);
  res.json({ ok: true, program: r.rows[0] });
}));

router.get('/partners', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'affiliates:partners' });
  const r = await _db.getPool().query(`
    SELECT p.*, pr.name AS program_name, pr.commission_pct
    FROM affiliate_partners p
    JOIN affiliate_programs pr ON pr.id = p.program_id
    WHERE p.tenant_id=$1 ORDER BY p.created_at DESC LIMIT 200
  `, [tid]);
  res.json({ ok: true, partners: r.rows });
}));

router.post('/partners', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'affiliates:partner-create' });
  const { program_id, name, email, code } = req.body || {};
  if (!program_id || !name) return _err(res, 400, 'program_id and name required');
  const r = await _db.getPool().query(`
    INSERT INTO affiliate_partners (tenant_id, program_id, name, email, code)
    VALUES ($1,$2,$3,$4,$5) RETURNING *
  `, [tid, program_id, name, email || null, code || _genAffCode()]);
  res.json({ ok: true, partner: r.rows[0] });
}));

router.post('/track/:code', express.json(), _route(async (req, res) => {
  const code = req.params.code;
  const r = await _db.getPool().query(`SELECT * FROM affiliate_partners WHERE code=$1 AND status='active'`, [code]);
  if (!r.rows.length) return _err(res, 404, 'invalid affiliate code');
  const partner = r.rows[0];
  await _db.getPool().query(`UPDATE affiliate_partners SET clicks = clicks + 1 WHERE id=$1`, [partner.id]);
  await _db.getPool().query(`
    INSERT INTO affiliate_clicks (tenant_id, partner_id, landing_url) VALUES ($1,$2,$3)
  `, [partner.tenant_id, partner.id, req.body?.landing_url || null]);
  if (req.body?.conversion_amount) {
    const prog = await _db.getPool().query(`SELECT commission_pct FROM affiliate_programs WHERE id=$1`, [partner.program_id]);
    const pct = parseFloat(prog.rows[0]?.commission_pct || 15);
    const earned = (parseFloat(req.body.conversion_amount) * pct) / 100;
    await _db.getPool().query(`
      UPDATE affiliate_partners SET conversions = conversions + 1, earned = earned + $2 WHERE id=$1
    `, [partner.id, earned]);
  }
  res.json({ ok: true, partner_id: partner.id });
}));

router.get('/stats', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'affiliates:stats' });
  const r = await _db.getPool().query(`
    SELECT COUNT(*)::int partners,
           COALESCE(SUM(clicks),0)::int clicks,
           COALESCE(SUM(conversions),0)::int conversions,
           COALESCE(SUM(earned),0)::float earned
    FROM affiliate_partners WHERE tenant_id=$1
  `, [tid]);
  res.json({ ok: true, ...r.rows[0] });
}));

module.exports = router;
