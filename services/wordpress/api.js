const express = require('express');
const crypto  = require('crypto');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

// ── Encryption helpers (AES-256-GCM, same key as vault) ──────────────────
const ALG = 'aes-256-gcm';
function _getKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) return null;
  try { const b = Buffer.from(raw, 'base64'); return b.length === 32 ? b : null; } catch { return null; }
}
function _encrypt(plain) {
  const key = _getKey();
  if (!key) return plain; // dev mode — store plaintext
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
function _decrypt(stored) {
  const key = _getKey();
  if (!key) return stored; // dev mode
  try {
    const buf = Buffer.from(stored, 'base64');
    const iv  = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const dec = crypto.createDecipheriv(ALG, key, iv);
    dec.setAuthTag(tag);
    return dec.update(enc) + dec.final('utf8');
  } catch { return stored; }
}

// ── WordPress REST API helper ─────────────────────────────────────────────
function _wpRequest(siteUrl, username, appPassword, method, path, body) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
    const bodyStr = body ? JSON.stringify(body) : null;
    const url = new URL(`${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2${path}`);
    const opts = {
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search, method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const proto = url.protocol === 'https:' ? require('https') : require('http');
    const req = proto.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('WP request timed out')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── SSRF guard ────────────────────────────────────────────────────────────
function _isSafeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.endsWith('.local')) return false;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    return true;
  } catch { return false; }
}

// ── Routes ────────────────────────────────────────────────────────────────

// POST /connect — add & test a WordPress site
router.post('/connect', async (req, res) => {
  const name        = String(req.body?.name        || '').trim().slice(0, 100);
  const site_url    = String(req.body?.site_url    || '').trim().slice(0, 300);
  const username    = String(req.body?.username    || '').trim().slice(0, 100);
  const app_password = String(req.body?.app_password || '').trim().slice(0, 500);

  if (!name || !site_url || !username || !app_password)
    return _err(res, 400, 'name, site_url, username, app_password required');
  if (!_isSafeUrl(site_url)) return _err(res, 400, 'Invalid or private site URL');

  // Test credentials
  let wpUser;
  try {
    const r = await _wpRequest(site_url, username, app_password, 'GET', '/users/me', null);
    if (r.status === 401 || r.status === 403) return _err(res, 401, 'WordPress credentials rejected — check username and Application Password');
    if (r.status !== 200) return _err(res, 502, `WordPress returned ${r.status} — verify the site URL`);
    wpUser = r.body;
  } catch (e) { return _err(res, 502, 'Could not reach WordPress site: ' + e.message); }

  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wordpress:connect' });
  const enc = _encrypt(app_password);
  const r = await _db.getPool().query(
    `INSERT INTO wordpress_sites (tenant_id, name, site_url, username, app_password, last_tested_at)
     VALUES ($1,$2,$3,$4,$5,now()) RETURNING id, name, site_url, username, last_tested_at, created_at`,
    [tid, name, site_url.replace(/\/$/, ''), username, enc]
  );
  res.json({ ok: true, site: r.rows[0], wp_user: { name: wpUser.name, email: wpUser.email } });
});

// GET /sites — list connected sites for this tenant
router.get('/sites', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, sites: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wordpress:sites' });
  const r = await _db.getPool().query(
    `SELECT id, name, site_url, username, status, last_tested_at, created_at
       FROM wordpress_sites WHERE tenant_id=$1 AND status='active' ORDER BY created_at DESC`,
    [tid]
  );
  res.json({ ok: true, sites: r.rows });
});

// DELETE /sites/:id
router.delete('/sites/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wordpress:delete-site' });
  await _db.getPool().query(
    `UPDATE wordpress_sites SET status='deleted' WHERE id=$1 AND tenant_id=$2`, [id, tid]
  );
  res.json({ ok: true });
});

// POST /sites/:id/test
router.post('/sites/:id/test', async (req, res) => {
  const id = Number(req.params.id);
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wordpress:test' });
  const r = await _db.getPool().query(
    `SELECT * FROM wordpress_sites WHERE id=$1 AND tenant_id=$2 AND status='active'`, [id, tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'Site not found');
  const { site_url, username, app_password } = r.rows[0];
  const dec = _decrypt(app_password);
  try {
    const resp = await _wpRequest(site_url, username, dec, 'GET', '/users/me', null);
    if (resp.status === 200) {
      await _db.getPool().query(`UPDATE wordpress_sites SET last_tested_at=now() WHERE id=$1`, [id]);
      return res.json({ ok: true, wp_user: { name: resp.body.name, email: resp.body.email } });
    }
    return _err(res, 401, `WordPress returned ${resp.status}`);
  } catch (e) { return _err(res, 502, e.message); }
});

// POST /publish — publish content to a WordPress site
router.post('/publish', async (req, res) => {
  const site_id  = Number(req.body?.site_id);
  const title    = String(req.body?.title    || '').trim().slice(0, 500);
  const content  = String(req.body?.content  || '').trim();
  const status   = ['draft','publish','pending'].includes(req.body?.status) ? req.body.status : 'draft';
  const excerpt  = String(req.body?.excerpt  || '').slice(0, 500);
  const tags     = Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 10).map(t => String(t).slice(0,50)) : [];

  if (!site_id || !title || !content) return _err(res, 400, 'site_id, title, content required');
  if (!_db.hasDb()) return _err(res, 503, 'no-db');

  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wordpress:publish' });
  const sr = await _db.getPool().query(
    `SELECT * FROM wordpress_sites WHERE id=$1 AND tenant_id=$2 AND status='active'`, [site_id, tid]
  );
  if (!sr.rows[0]) return _err(res, 404, 'Site not found');
  const { site_url, username, app_password } = sr.rows[0];
  const dec = _decrypt(app_password);

  let resp;
  try {
    resp = await _wpRequest(site_url, username, dec, 'POST', '/posts', {
      title, content, status, excerpt,
      ...(tags.length ? { tags } : {}),
    });
  } catch (e) { return _err(res, 502, 'WP publish failed: ' + e.message); }

  if (resp.status !== 201) return _err(res, 502, `WordPress returned ${resp.status}: ${JSON.stringify(resp.body).slice(0, 200)}`);

  const postUrl = resp.body.link || resp.body.guid?.rendered || null;
  await _db.getPool().query(
    `INSERT INTO wordpress_publish_log (tenant_id, site_id, wp_post_id, title, status, post_url, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [tid, site_id, resp.body.id, title, status, postUrl, req.body?.source || 'manual']
  );

  res.json({ ok: true, wp_post_id: resp.body.id, post_url: postUrl, status, site_url });
});

// GET /publish-log — recent publish history
router.get('/publish-log', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'wordpress:log' });
  const r = await _db.getPool().query(
    `SELECT l.id, l.wp_post_id, l.title, l.status, l.post_url, l.source, l.created_at,
            s.name as site_name, s.site_url
       FROM wordpress_publish_log l
       LEFT JOIN wordpress_sites s ON s.id = l.site_id
      WHERE l.tenant_id=$1 ORDER BY l.created_at DESC LIMIT 50`,
    [tid]
  );
  res.json({ ok: true, items: r.rows });
});

module.exports = router;
