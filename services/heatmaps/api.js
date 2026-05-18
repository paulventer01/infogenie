// Microsoft Clarity wrapper — free heatmaps, session recordings, rage-click data.
// User pastes their Clarity Project ID + optional API token. We:
//   1) emit the Clarity install snippet for them to paste into landing pages
//   2) fetch top pages from our landing_pages table so they see context here
//   3) call the Clarity Data Export API for top urls/devices/rage-clicks
//      ( https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api )

const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[heatmaps]', e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }

async function _loadConfig() {
  if (!_db.hasDb()) return { clarity_project_id: '', clarity_api_token: '' };
  const r = await _db.getPool().query(`SELECT clarity_project_id, clarity_api_token FROM heatmap_config WHERE id=1`);
  return r.rows[0] || { clarity_project_id: '', clarity_api_token: '' };
}

router.get('/config', _safe(async (_req, res) => {
  const c = await _loadConfig();
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
  const pid = String(req.body?.project_id || '').trim().slice(0, 50);
  const tok = String(req.body?.api_token || '').trim().slice(0, 500);
  await _db.getPool().query(
    `UPDATE heatmap_config SET clarity_project_id=$1, clarity_api_token=NULLIF($2,''), updated_at=NOW() WHERE id=1`,
    [pid || null, tok]
  );
  res.json({ ok: true });
}));

// GET /insights?days=3 — calls Clarity Data Export API for top pages + devices + rage-clicks.
// Falls back to our own landing_pages table when no API token is configured.
router.get('/insights', _safe(async (req, res) => {
  const c = await _loadConfig();
  const days = Math.max(1, Math.min(3, parseInt(req.query.days, 10) || 3)); // Clarity API max=3
  const landingPages = _db.hasDb()
    ? (await _db.getPool().query(`SELECT slug, title, traffic_total, conv_total FROM landing_pages ORDER BY traffic_total DESC NULLS LAST LIMIT 10`)).rows
    : [];

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
