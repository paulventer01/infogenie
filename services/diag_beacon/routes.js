// Diagnostics beacon routes.
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
  const { express } = ctx;

app.post('/api/diag-beacon', express.json({ limit: '8kb' }), (req, res) => {
  try {
    const b = req.body || {};
    const rel   = String(b.rel || '').slice(0, 16);
    const kind  = String(b.kind || 'info').slice(0, 8);
    const label = String(b.label || '').slice(0, 200);
    const detail= b.detail == null ? '' : String(b.detail).slice(0, 400);
    const tag = kind === 'error' ? '✖' : kind === 'mark' ? '★' : '·';
    console.log(`[client-diag ${rel}] ${tag} ${label}${detail ? ' · ' + detail : ''}`);
  } catch (_) {}
  res.status(204).end();
});
};
