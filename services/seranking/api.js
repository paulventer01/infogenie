const express  = require('express');
const _https   = require('https');
const _db      = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
const BASE   = 'api.seranking.com';

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

// ── SE Ranking API client ────────────────────────────────────────────────────

function _get(path) {
  return new Promise(resolve => {
    const key = process.env.SERANKING_API_KEY;
    if (!key || /^_DUMMY/i.test(key)) return resolve({ ok: false, error: 'not_configured' });

    const req = _https.request({
      hostname: BASE, path, method: 'GET',
      headers: { 'Accept': 'application/json', 'Authorization': 'Token ' + key },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode === 200 || r.statusCode === 201) {
            return resolve({ ok: true, data: JSON.parse(d), status: r.statusCode });
          }
          const err = JSON.parse(d);
          resolve({ ok: false, error: err.error_description || err.message || d.slice(0,200), status: r.statusCode });
        } catch {
          resolve({ ok: false, error: d.slice(0, 200), status: r.statusCode });
        }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

function _post(path, body) {
  return new Promise(resolve => {
    const key = process.env.SERANKING_API_KEY;
    if (!key || /^_DUMMY/i.test(key)) return resolve({ ok: false, error: 'not_configured' });
    const payload = JSON.stringify(body);
    const req = _https.request({
      hostname: BASE, path, method: 'POST',
      headers: {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        'Authorization': 'Token ' + key, 'Content-Length': Buffer.byteLength(payload),
      },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, data: JSON.parse(d), status: r.statusCode });
        } catch {
          resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, data: {}, status: r.statusCode });
        }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

function _qs(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) v.forEach(x => parts.push(k + '=' + encodeURIComponent(x)));
    else parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /status — check API key, return account info
router.get('/status', async (req, res) => {
  const key = process.env.SERANKING_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) {
    return res.json({ ok: true, configured: false, message: 'SERANKING_API_KEY not set.' });
  }
  const r = await _get('/v1/project-management/users/me');
  if (!r.ok) return res.json({ ok: true, configured: false, error: r.error });
  res.json({ ok: true, configured: true, user: r.data });
});

// GET /sites — list all SE Ranking projects
router.get('/sites', async (req, res) => {
  const r = await _get('/v1/project-management/sites');
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, sites: r.data });
});

// GET /sites/:id/search-engines — search engines configured for a project
router.get('/sites/:id/search-engines', async (req, res) => {
  const r = await _get('/v1/project-management/sites/search-engines' + _qs({ site_id: req.params.id }));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, engines: r.data });
});

// GET /sites/:id/keywords — keywords tracked in a project
// Optional: ?site_engine_id=N
router.get('/sites/:id/keywords', async (req, res) => {
  const params = { site_id: req.params.id };
  if (req.query.site_engine_id) params.site_engine_id = req.query.site_engine_id;
  if (req.query.group_id) params.group_id = req.query.group_id;
  const r = await _get('/v1/project-management/keywords' + _qs(params));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, keywords: r.data });
});

// GET /sites/:id/groups — keyword groups for a project
router.get('/sites/:id/groups', async (req, res) => {
  const r = await _get('/v1/project-management/keywords/groups' + _qs({ site_id: req.params.id }));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, groups: r.data });
});

// GET /sites/:id/positions — current keyword positions
// Required: ?site_engine_id=N  Optional: ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get('/sites/:id/positions', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const params = {
    site_id:        req.params.id,
    date_from:      req.query.date_from || weekAgo,
    date_to:        req.query.date_to   || today,
  };
  if (req.query.site_engine_id) params.site_engine_id = req.query.site_engine_id;
  const r = await _get('/v1/project-management/sites/positions' + _qs(params));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, positions: r.data });
});

// GET /sites/:id/history — avg position history
// Optional: ?site_engine_id=N&type=avg_pos&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get('/sites/:id/history', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const params = {
    site_id:   req.params.id,
    type:      req.query.type       || 'avg_pos',
    date_from: req.query.date_from  || monthAgo,
    date_to:   req.query.date_to    || today,
  };
  if (req.query.site_engine_id) params.site_engine_id = req.query.site_engine_id;
  const r = await _get('/v1/project-management/sites/positions/history' + _qs(params));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, history: r.data });
});

// GET /sites/:id/summary — project-level stats
router.get('/sites/:id/summary', async (req, res) => {
  const params = { site_id: req.params.id };
  if (req.query.site_engine_id) params.site_engine_id = req.query.site_engine_id;
  const r = await _get('/v1/project-management/sites/summary' + _qs(params));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, summary: r.data });
});

// GET /sites/:id/competitors — competitors tracked for a project
router.get('/sites/:id/competitors', async (req, res) => {
  const r = await _get('/v1/project-management/competitors' + _qs({ site_id: req.params.id }));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, competitors: r.data });
});

// GET /sites/:id/check-dates — dates when ranking checks were actually run
router.get('/sites/:id/check-dates', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const params = {
    site_id:   req.params.id,
    date_from: req.query.date_from || monthAgo,
    date_to:   req.query.date_to   || today,
  };
  const r = await _get('/v1/project-management/sites/check-dates' + _qs(params));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, dates: r.data });
});

// POST /sites/:id/recheck — trigger manual re-check for a project
router.post('/sites/:id/recheck', async (req, res) => {
  const r = await _post('/v1/project-management/sites/positions/recheck' + _qs({ site_id: req.params.id }), {});
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, message: 'Re-check triggered. Rankings will update within a few minutes.' });
});

// GET /sites/:id/settings — get/set which site+engine this tenant focuses on
router.get('/sites/:id/settings', async (req, res) => {
  try {
    const tid = await _tid(req, 'seranking:settings-get');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return res.json({ ok: true, settings: null });
    const pool = _db.getPool();
    const row = await pool.query('SELECT * FROM seranking_settings WHERE tenant_id=$1', [tid]);
    res.json({ ok: true, settings: row.rows[0] || null });
  } catch (e) { _err(res, 500, e.message); }
});

// PUT /sites/:id/settings — save preferred site+engine for this tenant
router.put('/sites/:id/settings', async (req, res) => {
  try {
    const tid = await _tid(req, 'seranking:settings-put');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return _err(res, 503, 'Database not connected.');
    const { site_title, site_url, engine_id, engine_label } = req.body || {};
    const pool = _db.getPool();
    await pool.query(`
      INSERT INTO seranking_settings (tenant_id, site_id, site_title, site_url, engine_id, engine_label)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (tenant_id) DO UPDATE SET
        site_id=EXCLUDED.site_id, site_title=EXCLUDED.site_title, site_url=EXCLUDED.site_url,
        engine_id=EXCLUDED.engine_id, engine_label=EXCLUDED.engine_label, updated_at=NOW()
    `, [tid, req.params.id, site_title, site_url, engine_id, engine_label]);
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
