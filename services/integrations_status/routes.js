// Integrations status · OpenAI passthrough routes.
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
  const { openai } = ctx;

app.get('/api/integrations/status', (req, res) => {
  const configured = [];
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_REFRESH_TOKEN) configured.push('google-ads');
  // NOTE: per-user vault connections surface through /api/ad-platforms/status.
  if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
    configured.push('meta-ads');
    configured.push('meta-ad-library');
  }
  if (process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_ADVERTISER_ID) configured.push('tiktok-ads');
  if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) configured.push('openai');
  if (process.env.AMPLITUDE_API_KEY) configured.push('amplitude');
  if (process.env.POSTHOG_API_KEY) configured.push('posthog');
  if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) configured.push('dataforseo');
  if (process.env.RAPIDAPI_KEY) configured.push('rapidapi');
  // ── Newly wired (2026-04-30) ────────────────────────────────────────────
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) { configured.push('ga4'); configured.push('gsc'); }
  if (process.env.SEMRUSH_API_KEY) configured.push('semrush');
  if (process.env.HUBSPOT_PRIVATE_APP_TOKEN) configured.push('hubspot');
  if (process.env.FIRECRAWL_API_KEY) configured.push('firecrawl');
  if (process.env.PROFOUND_API_KEY) configured.push('profound');
  if (process.env.SHOPIFY_SHOP && process.env.SHOPIFY_ADMIN_TOKEN) configured.push('shopify');
  if (process.env.APPSFLYER_API_TOKEN && process.env.APPSFLYER_APP_ID) configured.push('appsflyer');
  res.json({ configured });
});

// ── POST /api/openai — generic chat-completion proxy for client-side AI calls ─
app.post('/api/openai', async (req, res) => {
  try {
    const { model = 'gpt-4o', messages, max_tokens = 800, temperature = 0.7, response_format } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }
    const params = { model, messages, max_tokens, temperature };
    if (response_format) params.response_format = response_format;
    const completion = await openai.chat.completions.create(params);
    res.json(completion);
  } catch (err) {
    console.error('/api/openai error:', err.message);
    res.status(500).json({ error: err.message || 'OpenAI request failed' });
  }
});
};
