// Data-mode effective routes.
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

app.get('/api/data-mode/effective', async (req, res) => {
  try {
    const _dm = require('./services/admin/data_mode');
    const _ctx = require('./services/tenants/context');
    let tenantId = (req.tenant && req.tenant.id) || null;
    if (!tenantId) { try { tenantId = await _ctx.resolveTenantId(req, { label: 'data-mode:effective' }); } catch (_) {} }
    const clientId = Number(req.query.clientId) || null;
    const r = await _dm.resolveDataMode({ clientId, tenantId });
    res.json({ ok: true, mode: (r && r.mode) || 'strict', source: r && r.source, tenantId: tenantId || null, clientId });
  } catch (e) {
    res.json({ ok: true, mode: 'strict', source: 'fallback' });
  }
});
};
