const express = require('express');
const https  = require('https');
const crypto = require('crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

const PLATFORMS = ['meta', 'linkedin', 'tiktok'];

// GET /api/pixel-manager/configs
router.get('/configs', async (req, res) => {
  const tid = await _tid(req, 'pixel:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `SELECT id,platform,pixel_id,enabled,test_result,created_at,updated_at
       FROM pixel_configs WHERE tenant_id=$1 ORDER BY platform`,
      [tid]
    );
    res.json({ ok: true, configs: rows });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/pixel-manager/configs — upsert pixel config for a platform
router.post('/configs', async (req, res) => {
  const tid = await _tid(req, 'pixel:save');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { platform, pixel_id, access_token, enabled } = req.body || {};
  if (!platform || !pixel_id) return _err(res, 400, 'platform and pixel_id required');
  if (!PLATFORMS.includes(platform)) return _err(res, 400, 'invalid platform');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `INSERT INTO pixel_configs (tenant_id,platform,pixel_id,access_token,enabled,updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (tenant_id,platform) DO UPDATE SET
         pixel_id=EXCLUDED.pixel_id,
         access_token=COALESCE(EXCLUDED.access_token, pixel_configs.access_token),
         enabled=EXCLUDED.enabled,
         updated_at=NOW()
       RETURNING id,platform,pixel_id,enabled,test_result,updated_at`,
      [tid, platform, pixel_id, access_token||null, enabled !== false]
    );
    res.json({ ok: true, config: rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

// DELETE /api/pixel-manager/configs/:id
router.delete('/configs/:id', async (req, res) => {
  const tid = await _tid(req, 'pixel:delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    await p.query('DELETE FROM pixel_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/pixel-manager/test/:platform — verify pixel config is live
router.post('/test/:platform', async (req, res) => {
  const tid = await _tid(req, 'pixel:test');
  if (!tid) return _err(res, 400, 'no_tenant');
  const platform = req.params.platform;
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      'SELECT * FROM pixel_configs WHERE tenant_id=$1 AND platform=$2', [tid, platform]
    );
    if (!rows.length) return _err(res, 404, 'no_config');
    const cfg = rows[0];
    let result = { ok: false, message: 'Verification not available for this platform.' };

    if (platform === 'meta' && cfg.access_token && cfg.pixel_id) {
      result = await testMetaPixel(cfg.pixel_id, cfg.access_token);
    } else if (platform === 'meta') {
      result = { ok: false, message: 'Meta CAPI requires an Access Token to verify.' };
    } else if (platform === 'linkedin') {
      result = { ok: true, message: 'LinkedIn Insight Tag configured. Verify via LinkedIn Campaign Manager → Insight Tag.' };
    } else if (platform === 'tiktok') {
      result = { ok: true, message: 'TikTok Pixel configured. Verify via TikTok Ads Manager → Events.' };
    }

    await p.query(
      'UPDATE pixel_configs SET test_result=$1,updated_at=NOW() WHERE id=$2',
      [JSON.stringify(result), cfg.id]
    );
    res.json({ ok: true, result });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/pixel-manager/capi/meta — send a server-side event to Meta CAPI
router.post('/capi/meta', async (req, res) => {
  const tid = await _tid(req, 'pixel:capi-meta');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { event_name, event_data } = req.body || {};
  if (!event_name) return _err(res, 400, 'event_name required');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      'SELECT * FROM pixel_configs WHERE tenant_id=$1 AND platform=$2 AND enabled=true',
      [tid, 'meta']
    );
    if (!rows.length) return _err(res, 404, 'no_meta_pixel_configured');
    const cfg = rows[0];
    if (!cfg.access_token) return _err(res, 400, 'access_token_required_for_capi');

    const payload = buildMetaCapiPayload(event_name, event_data || {}, req);
    const capiRes = await sendMetaCapi(cfg.pixel_id, cfg.access_token, payload);

    await p.query(
      `INSERT INTO capi_event_log (tenant_id,platform,event_name,payload,status,response)
       VALUES ($1,'meta',$2,$3,$4,$5)`,
      [tid, event_name, JSON.stringify(payload), capiRes.ok ? 'sent' : 'failed', JSON.stringify(capiRes)]
    );

    res.json({ ok: capiRes.ok, capi_response: capiRes });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /api/pixel-manager/capi-log — recent CAPI events
router.get('/capi-log', async (req, res) => {
  const tid = await _tid(req, 'pixel:capi-log');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `SELECT id,platform,event_name,status,created_at
       FROM capi_event_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [tid]
    );
    res.json({ ok: true, events: rows });
  } catch (e) { _err(res, 500, e.message); }
});

function buildMetaCapiPayload(eventName, data, req) {
  const now = Math.floor(Date.now() / 1000);
  const userData = {};
  if (data.email) userData.em = [crypto.createHash('sha256').update(data.email.toLowerCase().trim()).digest('hex')];
  if (data.phone) userData.ph = [crypto.createHash('sha256').update(data.phone.replace(/\D/g,'')).digest('hex')];
  if (data.external_id) userData.external_id = [data.external_id];
  userData.client_ip_address = req.socket?.remoteAddress || '0.0.0.0';
  userData.client_user_agent = req.headers['user-agent'] || '';

  return {
    data: [{
      event_name: eventName,
      event_time: now,
      event_source_url: data.url || '',
      action_source: 'website',
      user_data: userData,
      custom_data: data.custom_data || {},
    }],
  };
}

function sendMetaCapi(pixelId, accessToken, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v18.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; });
      r.on('end', () => {
        try { resolve({ ok: r.statusCode < 300, statusCode: r.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ ok: false, statusCode: r.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

function testMetaPixel(pixelId, accessToken) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v18.0/${pixelId}?access_token=${encodeURIComponent(accessToken)}&fields=id,name,creation_time`,
      method: 'GET',
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; });
      r.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (r.statusCode === 200 && json.id)
            resolve({ ok: true, message: `Connected — Pixel "${json.name || json.id}" verified.` });
          else
            resolve({ ok: false, message: json.error?.message || 'Verification failed.' });
        } catch { resolve({ ok: false, message: 'Verification failed.' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, message: e.message }));
    req.end();
  });
}

module.exports = router;
