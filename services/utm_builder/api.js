const express = require('express');
const crypto  = require('crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

function buildFullUrl(dest, source, medium, campaign, content, term) {
  try {
    const base = dest.startsWith('http') ? dest : 'https://' + dest;
    const u = new URL(base);
    u.searchParams.set('utm_source', source);
    u.searchParams.set('utm_medium', medium);
    u.searchParams.set('utm_campaign', campaign);
    if (content) u.searchParams.set('utm_content', content);
    if (term)    u.searchParams.set('utm_term', term);
    return u.toString();
  } catch {
    return dest;
  }
}

function generateSlug() {
  return crypto.randomBytes(6).toString('base64url');
}

// GET /api/utm-builder/links
router.get('/links', async (req, res) => {
  const tid = await _tid(req, 'utm:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      'SELECT * FROM utm_links WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200',
      [tid]
    );
    res.json({ ok: true, links: rows });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/utm-builder/links
router.post('/links', async (req, res) => {
  const tid = await _tid(req, 'utm:create');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { label, destination, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body || {};
  if (!destination || !utm_source || !utm_medium || !utm_campaign)
    return _err(res, 400, 'destination, utm_source, utm_medium, utm_campaign are required');
  const full_url = buildFullUrl(destination, utm_source, utm_medium, utm_campaign, utm_content, utm_term);
  // Generate a unique slug (retry once on collision)
  let slug = generateSlug();
  try {
    const p = _db.getPool();
    let rows;
    try {
      ({ rows } = await p.query(
        `INSERT INTO utm_links (tenant_id,label,destination,utm_source,utm_medium,utm_campaign,utm_content,utm_term,full_url,slug)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [tid, label || utm_campaign, destination, utm_source, utm_medium, utm_campaign, utm_content||null, utm_term||null, full_url, slug]
      ));
    } catch (e) {
      if (e.code === '23505') {
        // slug collision — try once more
        slug = generateSlug();
        ({ rows } = await p.query(
          `INSERT INTO utm_links (tenant_id,label,destination,utm_source,utm_medium,utm_campaign,utm_content,utm_term,full_url,slug)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [tid, label || utm_campaign, destination, utm_source, utm_medium, utm_campaign, utm_content||null, utm_term||null, full_url, slug]
        ));
      } else { throw e; }
    }
    res.json({ ok: true, link: rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

// DELETE /api/utm-builder/links/:id
router.delete('/links/:id', async (req, res) => {
  const tid = await _tid(req, 'utm:delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    await p.query('DELETE FROM utm_links WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /api/utm-builder/presets
router.get('/presets', async (req, res) => {
  const tid = await _tid(req, 'utm:presets');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query('SELECT * FROM utm_presets WHERE tenant_id=$1 ORDER BY label', [tid]);
    res.json({ ok: true, presets: rows });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/utm-builder/presets
router.post('/presets', async (req, res) => {
  const tid = await _tid(req, 'utm:preset-create');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { label, source, medium, campaign } = req.body || {};
  if (!label || !source || !medium) return _err(res, 400, 'label, source, medium required');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `INSERT INTO utm_presets (tenant_id,label,source,medium,campaign) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id,label) DO UPDATE SET source=EXCLUDED.source,medium=EXCLUDED.medium,campaign=EXCLUDED.campaign
       RETURNING *`,
      [tid, label, source, medium, campaign||null]
    );
    res.json({ ok: true, preset: rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

// DELETE /api/utm-builder/presets/:id
router.delete('/presets/:id', async (req, res) => {
  const tid = await _tid(req, 'utm:preset-delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    await p.query('DELETE FROM utm_presets WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// Public redirect handler — called from server.js at GET /l/:slug (before auth gate)
async function handleRedirect(req, res) {
  const { slug } = req.params;
  if (!slug || slug.length > 20) return res.redirect(302, '/');
  if (!_db.hasDb()) return res.redirect(302, '/');
  try {
    const p = _db.getPool();
    const { rows } = await p.query('SELECT full_url FROM utm_links WHERE slug=$1', [slug]);
    if (!rows.length) return res.status(404).send('Link not found');
    // Async click increment — don't block the redirect
    p.query('UPDATE utm_links SET click_count=click_count+1,last_clicked=NOW() WHERE slug=$1', [slug]).catch(() => {});
    res.redirect(302, rows[0].full_url);
  } catch {
    res.redirect(302, '/');
  }
}

module.exports = router;
module.exports.handleRedirect = handleRedirect;
