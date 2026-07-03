// T118 Product Library — structured product/service catalog per tenant
// Feeds into: cold email, landing page generator, content calendar, brand foundation
const express = require('express');
const router  = express.Router();
const _tenantCtx = require('../tenants/context');
const _db = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[product-library]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

function _safeJsonArray(val) {
  if (Array.isArray(val)) return val.map(v => String(v).slice(0, 500));
  if (typeof val === 'string') {
    try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

const PRICING_MODELS = ['one_time', 'subscription', 'freemium', 'usage', 'custom'];

// ── GET /api/products ─────────────────────────────────────────────────────────
router.get('/', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'products:list' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const db = _db.getPool();
  const { rows } = await db.query(
    `SELECT * FROM products WHERE tenant_id=$1 AND status='active' ORDER BY created_at DESC`,
    [tid]
  );
  res.json({ ok: true, products: rows });
}));

// ── POST /api/products ────────────────────────────────────────────────────────
router.post('/', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'products:create' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const {
    name, tagline = '', category = '', pricing_model = 'one_time', price, currency = 'USD',
    description = '', usp = '', features, benefits, faqs, objections, cross_sell, upsell
  } = req.body;

  if (!name || !name.trim()) return _err(res, 400, 'name required');
  if (!PRICING_MODELS.includes(pricing_model)) return _err(res, 400, 'invalid pricing_model');

  const db = _db.getPool();
  const { rows } = await db.query(
    `INSERT INTO products
       (tenant_id, name, tagline, category, pricing_model, price, currency, description, usp,
        features, benefits, faqs, objections, cross_sell, upsell)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      tid, name.trim().slice(0, 200), tagline.slice(0, 300), category.slice(0, 100),
      pricing_model, price != null ? Number(price) : null, currency.slice(0, 10),
      description.slice(0, 5000), usp.slice(0, 1000),
      JSON.stringify(_safeJsonArray(features)),
      JSON.stringify(_safeJsonArray(benefits)),
      JSON.stringify(_safeJsonArray(faqs)),
      JSON.stringify(_safeJsonArray(objections)),
      JSON.stringify(_safeJsonArray(cross_sell)),
      JSON.stringify(_safeJsonArray(upsell)),
    ]
  );
  res.json({ ok: true, product: rows[0] });
}));

// ── PUT /api/products/:id ─────────────────────────────────────────────────────
router.put('/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'products:update' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const {
    name, tagline, category, pricing_model, price, currency,
    description, usp, features, benefits, faqs, objections, cross_sell, upsell, status
  } = req.body;

  if (pricing_model && !PRICING_MODELS.includes(pricing_model)) return _err(res, 400, 'invalid pricing_model');

  const db = _db.getPool();
  const { rows } = await db.query(
    `UPDATE products SET
       name=$3, tagline=$4, category=$5, pricing_model=$6, price=$7, currency=$8,
       description=$9, usp=$10, features=$11, benefits=$12, faqs=$13, objections=$14,
       cross_sell=$15, upsell=$16, status=COALESCE($17, status), updated_at=now()
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [
      req.params.id, tid,
      (name || '').trim().slice(0, 200),
      (tagline || '').slice(0, 300),
      (category || '').slice(0, 100),
      pricing_model || 'one_time',
      price != null ? Number(price) : null,
      (currency || 'USD').slice(0, 10),
      (description || '').slice(0, 5000),
      (usp || '').slice(0, 1000),
      JSON.stringify(_safeJsonArray(features)),
      JSON.stringify(_safeJsonArray(benefits)),
      JSON.stringify(_safeJsonArray(faqs)),
      JSON.stringify(_safeJsonArray(objections)),
      JSON.stringify(_safeJsonArray(cross_sell)),
      JSON.stringify(_safeJsonArray(upsell)),
      status || null,
    ]
  );
  if (!rows.length) return _err(res, 404, 'product not found');
  res.json({ ok: true, product: rows[0] });
}));

// ── DELETE /api/products/:id ──────────────────────────────────────────────────
router.delete('/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'products:delete' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const db = _db.getPool();
  await db.query(
    `UPDATE products SET status='archived', updated_at=now() WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  res.json({ ok: true });
}));

// ── GET /api/products/:id ─────────────────────────────────────────────────────
router.get('/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'products:get' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const db = _db.getPool();
  const { rows } = await db.query(
    `SELECT * FROM products WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  if (!rows.length) return _err(res, 404, 'product not found');
  res.json({ ok: true, product: rows[0] });
}));

module.exports = router;
