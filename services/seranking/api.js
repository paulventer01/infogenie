const express  = require('express');
const _https   = require('https');
const _crypto  = require('crypto');
const _db      = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
const BASE   = 'api.seranking.com';
const MCP_BASE_URL = 'https://api.seranking.com/mcp';

// ── DataForSEO helper ─────────────────────────────────────────────────────────
function _dfsPost(path, body) {
  return new Promise(resolve => {
    const u = process.env.DATAFORSEO_LOGIN;
    const p = process.env.DATAFORSEO_PASSWORD;
    if (!u || !p) return resolve({ ok: false, error: 'DataForSEO not configured' });
    const auth    = 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
    const payload = JSON.stringify(body);
    const req = _https.request({
      hostname: 'api.dataforseo.com', path, method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.status_code !== 20000) return resolve({ ok: false, error: json.status_message || 'DFS error', raw: json });
          resolve({ ok: true, tasks: json.tasks || [] });
        } catch { resolve({ ok: false, error: 'parse error', raw: d.slice(0, 200) }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

function _dfsItem0(r) {
  return r?.tasks?.[0]?.result?.[0] || null;
}

function _dfsItems(r) {
  return r?.tasks?.[0]?.result?.[0]?.items || [];
}

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

// ── In-memory PKCE state store (short-lived, state→{verifier, clientId, tid, redirectUri}) ──
const _pkce = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _pkce.entries()) {
    if (v.expiresAt < now) _pkce.delete(k);
  }
}, 60_000);

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function _pkceVerifier() {
  return _crypto.randomBytes(48).toString('base64url');
}

function _pkceChallenge(verifier) {
  return _crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function _get(path, auth) {
  return new Promise(resolve => {
    const key = process.env.SERANKING_API_KEY;
    const hdrs = auth
      ? { 'Accept': 'application/json', 'Authorization': auth }
      : { 'Accept': 'application/json', 'Authorization': 'Token ' + key };
    if (!key && !auth) return resolve({ ok: false, error: 'not_configured' });

    const req = _https.request({ hostname: BASE, path, method: 'GET', headers: hdrs }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode >= 200 && r.statusCode < 300) return resolve({ ok: true, data: JSON.parse(d), status: r.statusCode });
          const err = JSON.parse(d);
          resolve({ ok: false, error: err.error_description || err.message || d.slice(0, 200), status: r.statusCode });
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

function _post(path, body, auth) {
  return new Promise(resolve => {
    const key = process.env.SERANKING_API_KEY;
    const authHeader = auth || ('Token ' + key);
    const payload = JSON.stringify(body);
    const req = _https.request({
      hostname: BASE, path, method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json',
        'Authorization': authHeader, 'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, data: JSON.parse(d), status: r.statusCode }); }
        catch { resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, data: {}, raw: d, status: r.statusCode }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

function _postForm(path, params) {
  return new Promise(resolve => {
    const body = new URLSearchParams(params).toString();
    const req = _https.request({
      hostname: BASE, path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, data: JSON.parse(d), status: r.statusCode }); }
        catch { resolve({ ok: false, data: {}, raw: d, status: r.statusCode }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
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

// ── DB helpers ────────────────────────────────────────────────────────────────

async function _getSettings(tid) {
  if (!_db.hasDb()) return null;
  const r = await _db.getPool().query('SELECT * FROM seranking_settings WHERE tenant_id=$1', [tid]);
  return r.rows[0] || null;
}

async function _saveSettings(tid, fields) {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  const existing = await _getSettings(tid);
  if (!existing) {
    // Insert with defaults
    await pool.query(
      'INSERT INTO seranking_settings (tenant_id, site_id) VALUES ($1, 0) ON CONFLICT (tenant_id) DO NOTHING',
      [tid]
    );
  }
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(',');
  const vals = keys.map(k => fields[k]);
  await pool.query(
    `UPDATE seranking_settings SET ${sets}, updated_at=NOW() WHERE tenant_id=$1`,
    [tid, ...vals]
  );
}

// ── MCP token management ──────────────────────────────────────────────────────

async function _getToken(tid) {
  const s = await _getSettings(tid);
  if (!s || !s.mcp_access_token) return null;
  // Check expiry (with 60s buffer)
  if (s.mcp_token_expires_at && new Date(s.mcp_token_expires_at) < new Date(Date.now() + 60000)) {
    if (s.mcp_refresh_token) {
      const refreshed = await _refreshToken(tid, s);
      return refreshed;
    }
    return null;
  }
  return s.mcp_access_token;
}

async function _refreshToken(tid, s) {
  const r = await _postForm('/mcp/token', {
    grant_type: 'refresh_token',
    refresh_token: s.mcp_refresh_token,
    client_id: s.mcp_client_id,
  });
  if (!r.ok || !r.data.access_token) return null;
  const expiresAt = r.data.expires_in
    ? new Date(Date.now() + r.data.expires_in * 1000).toISOString()
    : null;
  await _saveSettings(tid, {
    mcp_access_token:    r.data.access_token,
    mcp_refresh_token:   r.data.refresh_token || s.mcp_refresh_token,
    mcp_token_expires_at: expiresAt,
  });
  return r.data.access_token;
}

// ── MCP JSON-RPC client ───────────────────────────────────────────────────────

function _mcpCall(accessToken, method, params = {}) {
  return new Promise(resolve => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const req = _https.request({
      hostname: BASE, path: '/mcp', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer ' + accessToken,
        'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      const isSSE = (r.headers['content-type'] || '').includes('text/event-stream');
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (isSSE) {
            // Parse SSE events — extract the last data: line with a JSON-RPC response
            const events = d.split('\n\n').filter(Boolean);
            for (const ev of events) {
              const dataLine = ev.split('\n').find(l => l.startsWith('data:'));
              if (dataLine) {
                const json = JSON.parse(dataLine.slice(5).trim());
                if (json.result !== undefined) return resolve({ ok: true, result: json.result });
                if (json.error) return resolve({ ok: false, error: json.error.message });
              }
            }
            resolve({ ok: false, error: 'No result in SSE stream' });
          } else {
            const json = JSON.parse(d);
            if (json.result !== undefined) return resolve({ ok: true, result: json.result });
            if (json.error) return resolve({ ok: false, error: json.error.message || JSON.stringify(json.error) });
            resolve({ ok: false, error: 'Unexpected MCP response', raw: d.slice(0, 200) });
          }
        } catch (e) {
          resolve({ ok: false, error: e.message, raw: d.slice(0, 300), status: r.statusCode });
        }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// ── REST API routes ───────────────────────────────────────────────────────────

// GET /status — check REST API key + MCP token state
router.get('/status', async (req, res) => {
  const key = process.env.SERANKING_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) {
    return res.json({ ok: true, configured: false, message: 'SERANKING_API_KEY not set.' });
  }
  const r = await _get('/v1/project-management/users/me');
  if (!r.ok) return res.json({ ok: true, configured: false, error: r.error });

  let mcpConnected = false;
  try {
    const tid = await _tid(req, 'seranking:status');
    if (tid) {
      const token = await _getToken(tid);
      mcpConnected = !!token;
    }
  } catch {}

  res.json({ ok: true, configured: true, user: r.data, mcpConnected });
});

// GET /sites — list all SE Ranking projects
router.get('/sites', async (req, res) => {
  const r = await _get('/v1/project-management/sites');
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, sites: r.data });
});

// GET /sites/:id/search-engines
router.get('/sites/:id/search-engines', async (req, res) => {
  const r = await _get('/v1/project-management/sites/search-engines' + _qs({ site_id: req.params.id }));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, engines: r.data });
});

// GET /sites/:id/keywords
router.get('/sites/:id/keywords', async (req, res) => {
  const params = { site_id: req.params.id };
  if (req.query.site_engine_id) params.site_engine_id = req.query.site_engine_id;
  if (req.query.group_id) params.group_id = req.query.group_id;
  const r = await _get('/v1/project-management/keywords' + _qs(params));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, keywords: r.data });
});

// GET /sites/:id/groups
router.get('/sites/:id/groups', async (req, res) => {
  const r = await _get('/v1/project-management/keywords/groups' + _qs({ site_id: req.params.id }));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, groups: r.data });
});

// GET /sites/:id/positions
router.get('/sites/:id/positions', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const params = {
    site_id:   req.params.id,
    date_from: req.query.date_from || weekAgo,
    date_to:   req.query.date_to   || today,
  };
  if (req.query.site_engine_id) params.site_engine_id = req.query.site_engine_id;
  const r = await _get('/v1/project-management/sites/positions' + _qs(params));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, positions: r.data });
});

// GET /sites/:id/history
router.get('/sites/:id/history', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const params = {
    site_id:   req.params.id,
    type:      req.query.type      || 'avg_pos',
    date_from: req.query.date_from || monthAgo,
    date_to:   req.query.date_to   || today,
  };
  if (req.query.site_engine_id) params.site_engine_id = req.query.site_engine_id;
  const r = await _get('/v1/project-management/sites/positions/history' + _qs(params));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, history: r.data });
});

// GET /sites/:id/summary
router.get('/sites/:id/summary', async (req, res) => {
  const params = { site_id: req.params.id };
  if (req.query.site_engine_id) params.site_engine_id = req.query.site_engine_id;
  const r = await _get('/v1/project-management/sites/summary' + _qs(params));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, summary: r.data });
});

// GET /sites/:id/competitors
router.get('/sites/:id/competitors', async (req, res) => {
  const r = await _get('/v1/project-management/competitors' + _qs({ site_id: req.params.id }));
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, competitors: r.data });
});

// POST /sites/:id/competitors — add a competitor domain to the SE Ranking project
router.post('/sites/:id/competitors', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return _err(res, 400, 'url is required');
  // Clean the URL — SE Ranking expects just the domain, no protocol
  const domain = url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  const r = await _post('/v1/project-management/competitors', { site_id: Number(req.params.id), url: domain });
  if (!r.ok) return _err(res, 502, r.data?.error_description || r.error || 'SE Ranking API error');
  res.json({ ok: true, competitor: r.data });
});

// DELETE /sites/:id/competitors/:cid — remove a competitor from the SE Ranking project
router.delete('/sites/:id/competitors/:cid', async (req, res) => {
  // Try the standard REST path first, fall back to query-param style
  const r = await new Promise(resolve => {
    const key = process.env.SERANKING_API_KEY;
    if (!key) return resolve({ ok: false });
    const req2 = _https.request({
      hostname: BASE,
      path: '/v1/project-management/competitors/' + req.params.cid,
      method: 'DELETE',
      headers: { 'Authorization': 'Token ' + key, 'Accept': 'application/json' },
    }, rs => {
      let d = '';
      rs.on('data', c => d += c);
      rs.on('end', () => resolve({ ok: rs.statusCode < 400, status: rs.statusCode, raw: d }));
    });
    req2.on('error', e => resolve({ ok: false, error: e.message }));
    req2.setTimeout(10000, () => { req2.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req2.end();
  });
  if (!r.ok) return _err(res, 502, 'Failed to remove competitor');
  res.json({ ok: true });
});

// POST /sites/:id/keywords — add keywords to the SE Ranking project
router.post('/sites/:id/keywords', async (req, res) => {
  const { keywords, group_id } = req.body || {};
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return _err(res, 400, 'keywords array is required');
  }
  const body = {
    site_id: Number(req.params.id),
    keywords: keywords.map(k => ({ keyword: String(k).trim() })),
  };
  if (group_id) body.group_id = group_id;
  const r = await _post('/v1/project-management/keywords', body);
  if (!r.ok) return _err(res, 502, r.data?.error_description || r.error || 'SE Ranking API error');
  res.json({ ok: true, result: r.data });
});

// POST /sites/:id/competitor-analysis — full competitive intelligence via DataForSEO
router.post('/sites/:id/competitor-analysis', async (req, res) => {
  const { own_domain, competitor_domains = [] } = req.body || {};
  if (!own_domain) return _err(res, 400, 'own_domain is required');

  const allDomains = [own_domain, ...competitor_domains];
  const loc = { location_code: 2710, language_code: 'en' }; // South Africa / en — adjust as needed

  // Run all DataForSEO calls concurrently
  const [overviewRes, ...intersectionResults] = await Promise.all([
    // Domain rank overview for ALL domains at once
    _dfsPost('/v3/dataforseo_labs/google/bulk_traffic_estimation/live', [
      ...allDomains.map(d => ({ target: d, ...loc })),
    ]),
    // Keyword intersection: own domain vs each competitor
    ...competitor_domains.map(comp =>
      _dfsPost('/v3/dataforseo_labs/google/domain_intersection/live', [{
        target1: own_domain, target2: comp,
        filters: ['ranked_serp_element.serp_item.rank_group', '<=', 50],
        order_by: ['ranked_serp_element.serp_item.etv,desc'],
        limit: 20,
        ...loc,
      }])
    ),
  ]);

  // Also get domain rank overview via competitors_domain to suggest new competitors
  const suggestRes = competitor_domains.length === 0
    ? await _dfsPost('/v3/dataforseo_labs/google/competitors_domain/live', [{
        target: own_domain, limit: 8, ...loc,
      }])
    : null;

  // Parse domain overviews
  const overviewItems = overviewRes.ok ? (_dfsItems(overviewRes) || []) : [];
  const overviewMap = {};
  for (const item of overviewItems) {
    if (item.target) overviewMap[item.target] = item;
  }

  // Parse intersections
  const intersections = competitor_domains.map((comp, i) => {
    const r = intersectionResults[i];
    const items = r?.ok ? _dfsItems(r) : [];
    return {
      competitor: comp,
      shared_keywords: items.map(kw => ({
        keyword:      kw.keyword_data?.keyword,
        own_pos:      kw.first_domain_serp_element?.rank_group ?? null,
        comp_pos:     kw.second_domain_serp_element?.rank_group ?? null,
        search_volume: kw.keyword_data?.keyword_info?.search_volume ?? null,
      })).filter(k => k.keyword),
    };
  });

  // Suggested competitors (when none added yet)
  const suggested = suggestRes?.ok
    ? _dfsItems(suggestRes).map(c => ({ domain: c.domain, intersections: c.intersections_count }))
    : [];

  res.json({
    ok: true,
    own_domain,
    domains: allDomains.map(d => ({
      domain:      d,
      is_own:      d === own_domain,
      metrics:     overviewMap[d] || null,
    })),
    intersections,
    suggested_competitors: suggested,
  });
});

// GET /sites/:id/check-dates
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

// POST /sites/:id/recheck
router.post('/sites/:id/recheck', async (req, res) => {
  const r = await _post('/v1/project-management/sites/positions/recheck' + _qs({ site_id: req.params.id }), {});
  if (!r.ok) return _err(res, 502, r.error || 'SE Ranking API error');
  res.json({ ok: true, message: 'Re-check triggered. Rankings will update within a few minutes.' });
});

// GET /sites/:id/settings
router.get('/sites/:id/settings', async (req, res) => {
  try {
    const tid = await _tid(req, 'seranking:settings-get');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return res.json({ ok: true, settings: null });
    res.json({ ok: true, settings: await _getSettings(tid) });
  } catch (e) { _err(res, 500, e.message); }
});

// PUT /sites/:id/settings
router.put('/sites/:id/settings', async (req, res) => {
  try {
    const tid = await _tid(req, 'seranking:settings-put');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return _err(res, 503, 'Database not connected.');
    const { site_title, site_url, engine_id, engine_label } = req.body || {};
    await _saveSettings(tid, { site_id: req.params.id, site_title, site_url, engine_id, engine_label });
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// ── MCP OAuth routes ──────────────────────────────────────────────────────────

// GET /mcp/status — is MCP connected for this tenant?
router.get('/mcp/status', async (req, res) => {
  try {
    const tid = await _tid(req, 'seranking:mcp-status');
    if (!tid) return _err(res, 400, 'no_tenant');
    const token = await _getToken(tid);
    res.json({ ok: true, connected: !!token });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /mcp/auth — start OAuth PKCE flow: register client + redirect to SE Ranking authorize
router.get('/mcp/auth', async (req, res) => {
  try {
    const tid = await _tid(req, 'seranking:mcp-auth');
    if (!tid) return _err(res, 400, 'no_tenant');

    // Build redirect URI — use PUBLIC_URL or reconstruct from Host header
    const publicUrl = process.env.PUBLIC_URL || ('https://' + req.headers.host);
    const redirectUri = publicUrl.replace(/\/$/, '') + '/api/seranking/mcp/callback';

    // Register a fresh public client for this redirect URI
    const regBody = JSON.stringify({
      client_name: 'InfoGenie',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    const clientData = await new Promise(resolve => {
      const r = _https.request({
        hostname: BASE, path: '/mcp/register', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(regBody) },
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
      });
      r.on('error', () => resolve({}));
      r.setTimeout(10000, () => { r.destroy(); resolve({}); });
      r.write(regBody);
      r.end();
    });
    if (!clientData.client_id) return _err(res, 502, 'Failed to register MCP client with SE Ranking.');

    // PKCE
    const verifier  = _pkceVerifier();
    const challenge = _pkceChallenge(verifier);
    const state     = _crypto.randomBytes(16).toString('hex');

    _pkce.set(state, {
      verifier,
      clientId:    clientData.client_id,
      tid,
      redirectUri,
      expiresAt: Date.now() + 5 * 60_000, // 5 min
    });

    const authUrl = 'https://api.seranking.com/mcp/authorize'
      + _qs({
          response_type:         'code',
          client_id:             clientData.client_id,
          redirect_uri:          redirectUri,
          scope:                 'mcp',
          state,
          code_challenge:        challenge,
          code_challenge_method: 'S256',
        });

    res.redirect(302, authUrl);
  } catch (e) { _err(res, 500, e.message); }
});

// GET /mcp/callback — OAuth callback: exchange code → token → store
router.get('/mcp/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.send(`<script>window.opener?.postMessage({serankingMcp:'error',msg:${JSON.stringify(String(error))}},location.origin);window.close();</script>`);
    }
    const pkce = _pkce.get(state);
    if (!pkce) return res.status(400).send('Invalid or expired OAuth state. Please try connecting again.');
    _pkce.delete(state);

    // Exchange code for tokens
    const r = await _postForm('/mcp/token', {
      grant_type:    'authorization_code',
      code:          String(code),
      redirect_uri:  pkce.redirectUri,
      client_id:     pkce.clientId,
      code_verifier: pkce.verifier,
    });

    if (!r.ok || !r.data.access_token) {
      const msg = r.data?.error_description || r.data?.error || 'Token exchange failed';
      return res.send(`<script>window.opener?.postMessage({serankingMcp:'error',msg:${JSON.stringify(msg)}},location.origin);window.close();</script>`);
    }

    const expiresAt = r.data.expires_in
      ? new Date(Date.now() + r.data.expires_in * 1000).toISOString()
      : null;

    await _saveSettings(pkce.tid, {
      mcp_client_id:        pkce.clientId,
      mcp_access_token:     r.data.access_token,
      mcp_refresh_token:    r.data.refresh_token || null,
      mcp_token_expires_at: expiresAt,
    });

    res.send(`<script>window.opener?.postMessage({serankingMcp:'connected'},location.origin);window.close();</script>`);
  } catch (e) {
    res.status(500).send('OAuth callback error: ' + e.message);
  }
});

// DELETE /mcp/disconnect — clear MCP token
router.delete('/mcp/disconnect', async (req, res) => {
  try {
    const tid = await _tid(req, 'seranking:mcp-disconnect');
    if (!tid) return _err(res, 400, 'no_tenant');
    await _saveSettings(tid, {
      mcp_client_id: null, mcp_access_token: null,
      mcp_refresh_token: null, mcp_token_expires_at: null,
    });
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /mcp/tools — list available MCP tools
router.get('/mcp/tools', async (req, res) => {
  try {
    const tid = await _tid(req, 'seranking:mcp-tools');
    if (!tid) return _err(res, 400, 'no_tenant');
    const token = await _getToken(tid);
    if (!token) return _err(res, 401, 'MCP not connected. Connect via the SE Ranking dashboard.');

    // MCP initialize handshake
    await _mcpCall(token, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'InfoGenie', version: '1.0' },
    });

    const r = await _mcpCall(token, 'tools/list', {});
    if (!r.ok) return _err(res, 502, r.error || 'MCP tools/list failed');
    res.json({ ok: true, tools: r.result?.tools || [] });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /mcp/call — call an MCP tool
router.post('/mcp/call', async (req, res) => {
  try {
    const tid = await _tid(req, 'seranking:mcp-call');
    if (!tid) return _err(res, 400, 'no_tenant');
    const token = await _getToken(tid);
    if (!token) return _err(res, 401, 'MCP not connected.');

    const { tool, arguments: args = {} } = req.body || {};
    if (!tool) return _err(res, 400, 'Missing tool name.');

    // Initialize session (MCP requires this before tool calls)
    await _mcpCall(token, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'InfoGenie', version: '1.0' },
    });

    const r = await _mcpCall(token, 'tools/call', { name: tool, arguments: args });
    if (!r.ok) return _err(res, 502, r.error || 'MCP tool call failed');
    res.json({ ok: true, result: r.result });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
