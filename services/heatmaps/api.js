// Microsoft Clarity wrapper — free heatmaps, session recordings, rage-click data.
// Per-tenant config: each tenant pastes their own Clarity Project ID + token.

const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[heatmaps]', e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

async function _loadConfig(tid) {
  if (!_db.hasDb()) return { clarity_project_id: '', clarity_api_token: '' };
  const r = await _db.getPool().query(
    `SELECT clarity_project_id, clarity_api_token FROM heatmap_config WHERE tenant_id=$1`,
    [tid]
  );
  return r.rows[0] || { clarity_project_id: '', clarity_api_token: '' };
}

router.get('/config', _safe(async (req, res) => {
  const tid = await _tid(req, 'heatmaps:get-config');
  const c = await _loadConfig(tid);
  res.json({
    ok: true,
    configured: !!c.clarity_project_id,
    project_id: c.clarity_project_id || '',
    has_token: !!c.clarity_api_token,
    snippet: c.clarity_project_id ? `<script type="text/javascript">
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${String(c.clarity_project_id).replace(/[^a-zA-Z0-9]/g, '')}");
</script>` : null,
    dashboard_url: c.clarity_project_id ? `https://clarity.microsoft.com/projects/view/${encodeURIComponent(c.clarity_project_id)}/dashboard` : null,
  });
}));

router.post('/config', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'db unavailable');
  const tid = await _tid(req, 'heatmaps:save-config');
  const pid = String(req.body?.project_id || '').trim().slice(0, 50);
  const tok = String(req.body?.api_token || '').trim().slice(0, 500);
  // Upsert per-tenant row.
  await _db.getPool().query(
    `INSERT INTO heatmap_config (tenant_id, clarity_project_id, clarity_api_token, updated_at)
     VALUES ($1, $2, NULLIF($3,''), NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       clarity_project_id = EXCLUDED.clarity_project_id,
       clarity_api_token  = COALESCE(EXCLUDED.clarity_api_token, heatmap_config.clarity_api_token),
       updated_at = NOW()`,
    [tid, pid || null, tok]
  );
  res.json({ ok: true });
}));

// GET /insights?days=3 — calls Clarity Data Export API for top pages + devices + rage-clicks.
// Falls back to this tenant's own landing_pages table when no API token is configured.
router.get('/insights', _safe(async (req, res) => {
  const tid = await _tid(req, 'heatmaps:insights');
  const c = await _loadConfig(tid);
  const days = Math.max(1, Math.min(3, parseInt(req.query.days, 10) || 3));
  // landing_pages schema varies (legacy installs may lack slug/traffic columns);
  // fall back to an empty list so Heatmaps stays usable without breaking.
  let landingPages = [];
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `SELECT title, brand, created_at FROM landing_pages WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`,
        [tid]
      );
      landingPages = r.rows;
    } catch (e) { console.warn('[heatmaps] landing_pages query skipped:', e.message); }
  }

  if (!c.clarity_api_token) {
    return res.json({
      ok: true,
      source: 'fallback',
      note: c.clarity_project_id
        ? 'Project ID saved. Add a Clarity API token in Settings → Heatmaps to pull live data here. Open the Clarity dashboard for the full visualization.'
        : 'Connect Microsoft Clarity in Settings → Heatmaps (free, no card required).',
      landingPages,
      dashboard_url: c.clarity_project_id ? `https://clarity.microsoft.com/projects/view/${encodeURIComponent(c.clarity_project_id)}/dashboard` : null,
    });
  }

  const fetchClarity = (dim) => new Promise(resolve => {
    const path = `/data-export-api/v1/project-live-insights?numOfDays=${days}&dimension1=${encodeURIComponent(dim)}`;
    const reqH = _https.request({
      hostname: 'www.clarity.ms', path, method: 'GET',
      headers: { Authorization: 'Bearer ' + c.clarity_api_token, Accept: 'application/json' },
    }, r => { let d = ''; r.on('data', x => d += x); r.on('end', () => {
      try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: null, raw: d.slice(0, 400) }); }
    }); });
    reqH.on('error', e => resolve({ status: 0, error: e.message }));
    reqH.setTimeout(15000, () => reqH.destroy());
    reqH.end();
  });

  const [byUrl, byDevice, byBrowser] = await Promise.all([fetchClarity('URL'), fetchClarity('Device'), fetchClarity('Browser')]);
  res.json({
    ok: true,
    source: 'clarity',
    days,
    landingPages,
    byUrl: byUrl.data || [],
    byDevice: byDevice.data || [],
    byBrowser: byBrowser.data || [],
    notes: [byUrl, byDevice, byBrowser].filter(x => x.status !== 200).map(x => `Clarity returned ${x.status}: ${x.raw || x.error || ''}`).filter(Boolean),
    dashboard_url: c.clarity_project_id ? `https://clarity.microsoft.com/projects/view/${encodeURIComponent(c.clarity_project_id)}/dashboard` : null,
  });
}));

module.exports = router;
