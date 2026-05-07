const express = require('express');
const _https = require('https');
const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

function _hasCreds() {
  const t = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const cid = process.env.GOOGLE_ADS_CLIENT_ID;
  const cs = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const rt = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const cu = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const all = [t, cid, cs, rt, cu];
  return all.every(v => v && !/^_DUMMY/i.test(v));
}

function _customerId() {
  return String(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/[^0-9]/g, '');
}

let _accessTokenCache = { token: null, expiresAt: 0 };

async function _refreshAccessToken() {
  if (_accessTokenCache.token && Date.now() < _accessTokenCache.expiresAt - 60000) {
    return { ok: true, token: _accessTokenCache.token };
  }
  const body = `client_id=${encodeURIComponent(process.env.GOOGLE_ADS_CLIENT_ID)}` +
               `&client_secret=${encodeURIComponent(process.env.GOOGLE_ADS_CLIENT_SECRET)}` +
               `&refresh_token=${encodeURIComponent(process.env.GOOGLE_ADS_REFRESH_TOKEN)}` +
               `&grant_type=refresh_token`;
  return await new Promise(resolve => {
    const req = _https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (r.statusCode >= 200 && r.statusCode < 300 && j.access_token) {
            _accessTokenCache = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
            resolve({ ok: true, token: j.access_token });
          } else {
            resolve({ ok: false, error: j.error_description || j.error || `oauth ${r.statusCode}` });
          }
        } catch (e) { resolve({ ok: false, error: 'oauth parse failed' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => req.destroy());
    req.write(body); req.end();
  });
}

async function _gaQuery(query) {
  const tok = await _refreshAccessToken();
  if (!tok.ok) return { ok: false, error: tok.error };
  const cid = _customerId();
  const body = JSON.stringify({ query });
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Authorization': `Bearer ${tok.token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  };
  const lc = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (lc && !/^_DUMMY/i.test(lc)) headers['login-customer-id'] = String(lc).replace(/[^0-9]/g, '');
  return await new Promise(resolve => {
    const req = _https.request({
      hostname: 'googleads.googleapis.com',
      path: `/v17/customers/${cid}/googleAds:searchStream`,
      method: 'POST', headers
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          const j = d ? JSON.parse(d) : {};
          if (r.statusCode >= 200 && r.statusCode < 300) resolve({ ok: true, data: j });
          else {
            const arr = Array.isArray(j) ? j : [j];
            const msg = arr[0]?.error?.message || arr[0]?.error?.details?.[0]?.errors?.[0]?.message || `google ads ${r.statusCode}`;
            resolve({ ok: false, status: r.statusCode, error: msg });
          }
        } catch (e) { resolve({ ok: false, error: 'parse failed' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(30000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _friendly(err) {
  if (!err) return err;
  if (/developer-token|developer token/i.test(err)) return `${err} → Your GOOGLE_ADS_DEVELOPER_TOKEN is missing or not approved. Get it from your Google Ads MCC under Tools → API Center.`;
  if (/PERMISSION_DENIED|not authorized|customer/i.test(err)) return `${err} → Make sure GOOGLE_ADS_CUSTOMER_ID is the 10-digit account number (no dashes). If using an MCC, also set GOOGLE_ADS_LOGIN_CUSTOMER_ID.`;
  if (/invalid_grant|refresh|token/i.test(err)) return `${err} → Refresh token is invalid or revoked. Re-authorize via OAuth Playground with the AdWords scope.`;
  if (/OAuth client was not found|client.*not found|invalid_client/i.test(err)) return `${err} → GOOGLE_ADS_CLIENT_ID and/or GOOGLE_ADS_CLIENT_SECRET are wrong. Create OAuth credentials in Google Cloud Console (APIs & Services → Credentials → OAuth 2.0 Client ID).`;
  return err;
}

const ALLOWED_PRESETS = {
  today: 'TODAY', yesterday: 'YESTERDAY',
  last_7d: 'LAST_7_DAYS', last_14d: 'LAST_14_DAYS', last_30d: 'LAST_30_DAYS',
  this_month: 'THIS_MONTH', last_month: 'LAST_MONTH'
};
function _preset(req) {
  const k = String(req.query.date_preset || 'last_30d');
  return ALLOWED_PRESETS[k] || 'LAST_30_DAYS';
}

function _flat(rows, picker) {
  const out = []; for (const stream of rows) for (const r of (stream.results || [])) out.push(picker(r));
  return out;
}

router.post('/test', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID required');
  const r = await _gaQuery('SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1');
  if (!r.ok) return _err(res, 400, _friendly(r.error));
  const row = (r.data?.[0]?.results?.[0]?.customer) || {};
  res.json({ ok: true, account: { id: row.id, name: row.descriptiveName, currency: row.currencyCode, timezone: row.timeZone } });
});

router.get('/account-summary', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', note:'Set GOOGLE_ADS_* credentials to see live insights.' });
  const dp = _preset(req);
  const q = `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.average_cpm, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date DURING ${dp}`;
  const r = await _gaQuery(q);
  if (!r.ok) return _err(res, 400, _friendly(r.error));
  let spend = 0, impressions = 0, clicks = 0, conversions = 0, revenue = 0;
  _flat(r.data || [], x => x.metrics || {}).forEach(m => {
    spend += (parseInt(m.costMicros || 0, 10) / 1e6);
    impressions += parseInt(m.impressions || 0, 10);
    clicks += parseInt(m.clicks || 0, 10);
    conversions += parseFloat(m.conversions || 0);
    revenue += parseFloat(m.conversionsValue || 0);
  });
  const ctr = impressions > 0 ? +(clicks / impressions * 100).toFixed(2) : 0;
  const cpc = clicks > 0 ? +(spend / clicks).toFixed(2) : 0;
  const cpm = impressions > 0 ? +(spend / impressions * 1000).toFixed(2) : 0;
  res.json({ ok:true, source:'google_ads', date_preset: req.query.date_preset || 'last_30d', summary: {
    spend: +spend.toFixed(2), impressions, clicks, ctr, cpc, cpm,
    conversions: +conversions.toFixed(2), revenue: +revenue.toFixed(2),
    roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
  }});
});

router.get('/campaigns', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', campaigns:[], note:'Set GOOGLE_ADS_* credentials for live campaigns.' });
  const dp = _preset(req);
  const q = `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING ${dp} ORDER BY metrics.cost_micros DESC LIMIT 50`;
  const r = await _gaQuery(q);
  if (!r.ok) return _err(res, 400, _friendly(r.error));
  const camps = _flat(r.data || [], x => {
    const m = x.metrics || {}, c = x.campaign || {};
    const spend = parseInt(m.costMicros || 0, 10) / 1e6;
    const rev = parseFloat(m.conversionsValue || 0);
    return {
      id: c.id, name: c.name, status: c.status,
      spend: +spend.toFixed(2), impressions: parseInt(m.impressions || 0, 10),
      clicks: parseInt(m.clicks || 0, 10), ctr: parseFloat(m.ctr || 0) * 100,
      cpc: parseInt(m.averageCpc || 0, 10) / 1e6,
      conversions: +parseFloat(m.conversions || 0).toFixed(2),
      revenue: +rev.toFixed(2),
      roas: spend > 0 ? +(rev / spend).toFixed(2) : 0,
    };
  });
  res.json({ ok:true, source:'google_ads', date_preset: req.query.date_preset || 'last_30d', campaigns: camps });
});

router.get('/top-ads', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', ads:[], note:'Set GOOGLE_ADS_* credentials for top ads.' });
  const dp = _preset(req);
  const q = `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group.name, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.conversions FROM ad_group_ad WHERE segments.date DURING ${dp} ORDER BY metrics.ctr DESC LIMIT 25`;
  const r = await _gaQuery(q);
  if (!r.ok) return _err(res, 400, _friendly(r.error));
  const ads = _flat(r.data || [], x => {
    const m = x.metrics || {};
    return {
      id: x.adGroupAd?.ad?.id,
      name: x.adGroupAd?.ad?.name || `Ad ${x.adGroupAd?.ad?.id || ''}`,
      ad_group: x.adGroup?.name, campaign: x.campaign?.name,
      spend: +(parseInt(m.costMicros || 0, 10) / 1e6).toFixed(2),
      impressions: parseInt(m.impressions || 0, 10),
      clicks: parseInt(m.clicks || 0, 10),
      ctr: parseFloat(m.ctr || 0) * 100,
      conversions: +parseFloat(m.conversions || 0).toFixed(2),
    };
  }).slice(0, 15);
  res.json({ ok:true, source:'google_ads', date_preset: req.query.date_preset || 'last_30d', ads });
});

module.exports = router;
