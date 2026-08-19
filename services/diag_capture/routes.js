// Diagnostics capture routes.
// Extracted verbatim from server.js (pure structural move — no behavior change).
// Shared module-scope helpers are injected via `ctx`.
// __dirname and relative require() are rebased to the app root so the moved code
// (originally at server.js, project root) resolves paths exactly as before.
const __path__ = require('path');
const __APP_ROOT__ = __path__.join(__dirname, '..', '..');
const __root_require__ = (p) =>
  (typeof p === 'string' && (p.startsWith('./') || p.startsWith('../')))
    ? require(__path__.resolve(__APP_ROOT__, p))
    : require(p);

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { _DIAG_CAP_PREFIX, _DIAG_LATEST_KEY, _tkvCtx, _tkvRead, _tkvScope, _tkvWrite, express } = ctx;

function _safeDomainSlug(s) {
  return String(s || 'unknown').toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'')
    .replace(/[^a-z0-9.-]+/g, '_').slice(0, 80) || 'unknown';
}
app.post('/api/diag-capture', express.json({ limit: '4mb' }), async (req, res) => {
  try {
    const _db = require('./db');
    if (!_db.hasDb()) return res.status(503).json({ ok:false, error:'database not configured' });
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'diag-capture:save' });
    if (tid == null) return res.status(400).json({ ok:false, error:'no_tenant' });
    const body = req.body || {};
    const url  = body.url || (body.analysisData && body.analysisData.url) || 'unknown';
    const slug = _safeDomainSlug(url);
    const payload = { capturedAt: new Date().toISOString(), domain: slug, ...body };
    await _db.kvSet(`${_DIAG_CAP_PREFIX}t${tid}:${slug}`, payload);
    await _tkvWrite(_DIAG_LATEST_KEY, tid, { domain: slug, at: payload.capturedAt });
    const bytes = JSON.stringify(payload).length;
    const kb = (bytes / 1024).toFixed(1);
    console.log(`[diag-capture] saved ${slug} (${kb}kb)`);
    res.json({ ok: true, domain: slug, bytes });
  } catch (e) {
    console.warn('[diag-capture] save failed:', e && e.message);
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});
app.get('/api/diag-capture/list', async (req, res) => {
  try {
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'diag-capture:list' });
    if (tid == null) return res.json({ ok: true, captures: [] });
    const rows = await _tkvScope.listTenantPrefix(_DIAG_CAP_PREFIX, tid, 200);
    const captures = rows.map(r => ({
      domain: r.id,
      bytes: JSON.stringify(r.value || {}).length,
      at: r.value?.capturedAt || null
    })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    res.json({ ok: true, captures });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});
app.get('/api/diag-capture/latest', async (req, res) => {
  try {
    const _db = require('./db');
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'diag-capture:latest' });
    if (tid == null) return res.status(404).json({ ok: false, error: 'no captures yet — run Analyse Now once to seed' });
    const ptr = await _tkvRead(_DIAG_LATEST_KEY, tid, null);
    if (!ptr || !ptr.domain) return res.status(404).json({ ok: false, error: 'no captures yet — run Analyse Now once to seed' });
    const data = await _db.kvGet(`${_DIAG_CAP_PREFIX}t${tid}:${ptr.domain}`, undefined);
    if (data == null) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, ...data });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});
app.get('/api/diag-capture/:domain', async (req, res) => {
  try {
    const _db = require('./db');
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'diag-capture:get' });
    if (tid == null) return res.status(404).json({ ok: false, error: 'not found' });
    const slug = _safeDomainSlug(req.params.domain);
    const data = await _db.kvGet(`${_DIAG_CAP_PREFIX}t${tid}:${slug}`, undefined);
    if (data == null) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, ...data });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});
};
