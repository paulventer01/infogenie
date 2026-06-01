// Slack status routes.
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
  const { _slackOrDiscordKind } = ctx;

app.get('/api/slack/status', (_req, res) => {
  const ok = !!process.env.SLACK_WEBHOOK_URL;
  res.json({ ok, configured: ok, kind: _slackOrDiscordKind(process.env.SLACK_WEBHOOK_URL),
    missing: ok ? [] : ['SLACK_WEBHOOK_URL'] });
});
};
