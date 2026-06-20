// Profound · Shopify · AppsFlyer routes.
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
// Module-scope (real node require) so it resolves correctly even though `require`
// is rebased to __root_require__ inside register(). Gates the port-80 listen on
// whether this is the live server process (off when required for tests).
const _runtimeFlags = require('../runtime_flags');

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { _missingCreds } = ctx;

app.post('/api/profound/visibility', async (req, res) => {
  const key = process.env.PROFOUND_API_KEY;
  if (!key) return _missingCreds(res, 'profound', ['PROFOUND_API_KEY']);
  try {
    const { brand, queries = [] } = req.body || {};
    if (!brand) return res.status(400).json({ ok:false, error:'brand required' });
    const r = await fetch('https://api.profound.ai/v1/visibility', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ brand, queries })
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.json({ ok:false, configured:true, error:`Profound API ${r.status}: ${txt.slice(0,200)}` });
    }
    const j = await r.json();
    res.json({ ok:true, configured:true, brand, raw:j,
      dataOrigin:'live_profound', dataSource:'api.profound.ai/v1/visibility', confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

// ─── Shopify Admin API ──────────────────────────────────────────────────────
app.get('/api/shopify/orders/summary', async (req, res) => {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) return _missingCreds(res, 'shopify', ['SHOPIFY_SHOP','SHOPIFY_ADMIN_TOKEN']);
  try {
    const days = +(req.query.days || 30);
    const since = new Date(Date.now() - days*86400000).toISOString();
    const url = `https://${shop}/admin/api/2024-04/orders.json?status=any&created_at_min=${since}&limit=250&fields=id,total_price,currency,financial_status,created_at,line_items`;
    const r = await fetch(url, { headers:{ 'X-Shopify-Access-Token': token } });
    if (!r.ok) {
      const txt = await r.text();
      return res.json({ ok:false, configured:true, error:`Shopify ${r.status}: ${txt.slice(0,200)}` });
    }
    const j = await r.json();
    const orders = j.orders || [];
    const paid = orders.filter(o => o.financial_status === 'paid');
    const revenue = paid.reduce((a,o) => a + (+o.total_price || 0), 0);
    const aov = paid.length ? revenue / paid.length : 0;
    res.json({ ok:true, configured:true, shop, days,
      orderCount: orders.length, paidCount: paid.length,
      revenue: +revenue.toFixed(2), aov: +aov.toFixed(2),
      currency: orders[0]?.currency || 'USD',
      dataOrigin:'live_shopify', dataSource:`${shop}/admin/api/2024-04`, confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

// ─── AppsFlyer ──────────────────────────────────────────────────────────────
app.get('/api/appsflyer/installs', async (req, res) => {
  const token = process.env.APPSFLYER_API_TOKEN;
  const appId = process.env.APPSFLYER_APP_ID;
  if (!token || !appId) return _missingCreds(res, 'appsflyer', ['APPSFLYER_API_TOKEN','APPSFLYER_APP_ID']);
  try {
    const days = +(req.query.days || 14);
    const end = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now() - days*86400000).toISOString().slice(0,10);
    const url = `https://hq1.appsflyer.com/api/agg-data/export/app/${encodeURIComponent(appId)}/daily_report/v5?from=${start}&to=${end}`;
    const r = await fetch(url, { headers:{ 'Authorization':`Bearer ${token}` } });
    if (!r.ok) {
      const txt = await r.text();
      return res.json({ ok:false, configured:true, error:`AppsFlyer ${r.status}: ${txt.slice(0,200)}` });
    }
    const csv = await r.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return res.json({ ok:true, configured:true, appId, days, rows:[], totalInstalls:0 });
    const header = lines[0].split(',').map(h => h.replace(/^"|"$/g,''));
    const rows = lines.slice(1).map(l => {
      const cells = l.split(',').map(c => c.replace(/^"|"$/g,''));
      return Object.fromEntries(header.map((h,i) => [h, cells[i]]));
    });
    const totalInstalls = rows.reduce((a,r) => a + (+r['Installs'] || 0), 0);
    res.json({ ok:true, configured:true, appId, days, rows: rows.slice(0, 200), totalInstalls,
      dataOrigin:'live_appsflyer', dataSource:'hq1.appsflyer.com agg-data daily_report v5', confidence:'high' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});

// Port 80 — external URL (*.spock.replit.dev / new tab). Only the live server
// binds it; required as a module for tests (buildApp) this is skipped.
if (_runtimeFlags.backgroundEnabled()) {
  app.listen(80, '0.0.0.0', () => {
    console.log('InfoGenie listening on port 80 (external URL)');
  }).on('error', (err) => {
    // Port 80 may be unavailable in some environments; non-fatal
    console.warn(`Port 80 unavailable (${err.code}) — external URL will use port 5000`);
  });
}
};
