const express = require('express');
const _https = require('https');
const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

function _hasCreds() {
  const t = process.env.TIKTOK_ACCESS_TOKEN, a = process.env.TIKTOK_ADVERTISER_ID;
  return t && a && !/^_DUMMY/i.test(t) && !/^_DUMMY/i.test(a);
}

const HOST = 'business-api.tiktok.com';

async function _ttGet(path, params) {
  const qs = Object.entries(params).map(([k, v]) => {
    const val = (typeof v === 'object') ? JSON.stringify(v) : String(v);
    return `${encodeURIComponent(k)}=${encodeURIComponent(val)}`;
  }).join('&');
  return await new Promise(resolve => {
    const req = _https.request({
      hostname: HOST, path: `${path}?${qs}`, method: 'GET',
      headers: { 'Access-Token': process.env.TIKTOK_ACCESS_TOKEN }
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          const j = d ? JSON.parse(d) : {};
          if (j.code === 0) resolve({ ok: true, data: j.data });
          else resolve({ ok: false, error: j.message || `tiktok code=${j.code}` });
        } catch (e) { resolve({ ok: false, error: 'parse failed' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(25000, () => req.destroy());
    req.end();
  });
}

function _friendly(err) {
  if (!err) return err;
  if (/permission|access|scope|40105|40103/i.test(err)) return `${err} → Your TIKTOK_ACCESS_TOKEN doesn't have ads-read permission. Re-authorize the app with the 'Ads Management' scope at TikTok for Business → Developers.`;
  if (/advertiser/i.test(err)) return `${err} → Check that TIKTOK_ADVERTISER_ID is the numeric Advertiser ID from TikTok Ads Manager (Account Setup → Account Info).`;
  return err;
}

const ALLOWED_PRESETS = ['today','yesterday','last_7d','last_14d','last_30d','last_90d','this_month','last_month'];
function _dateRange(presetKey) {
  const k = ALLOWED_PRESETS.includes(presetKey) ? presetKey : 'last_30d';
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const back = n => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  let start, end;
  switch (k) {
    case 'today':       start = today;        end = today; break;
    case 'yesterday':   start = back(1);      end = back(1); break;
    case 'last_7d':     start = back(7);      end = back(1); break;
    case 'last_14d':    start = back(14);     end = back(1); break;
    case 'last_30d':    start = back(30);     end = back(1); break;
    case 'last_90d':    start = back(90);     end = back(1); break;
    case 'this_month':  start = startOfMonth(today); end = today; break;
    case 'last_month':  { const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                          start = startOfMonth(lm); end = endOfMonth(lm); break; }
    default:            start = back(30); end = back(1);
  }
  return { start_date: fmt(start), end_date: fmt(end), key: k };
}

const COMMON_METRICS = [
  'spend','impressions','reach','clicks','ctr','cpc','cpm',
  'frequency','conversion','conversion_rate','cost_per_conversion','total_purchase_value'
];

router.post('/test', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID required');
  const r = await _ttGet('/open_api/v1.3/advertiser/info/', {
    advertiser_ids: [process.env.TIKTOK_ADVERTISER_ID],
    fields: ['id','name','currency','timezone','status','company']
  });
  if (!r.ok) return _err(res, 400, _friendly(r.error));
  const acc = (r.data?.list || [])[0] || {};
  res.json({ ok: true, account: { id: acc.id, name: acc.name, currency: acc.currency, timezone: acc.timezone, status: acc.status } });
});

async function _report(level, presetKey, dimensions, extraFields = []) {
  const range = _dateRange(presetKey);
  return await _ttGet('/open_api/v1.3/report/integrated/get/', {
    advertiser_id: process.env.TIKTOK_ADVERTISER_ID,
    report_type: 'BASIC',
    data_level: level,
    dimensions,
    metrics: [...COMMON_METRICS, ...extraFields],
    start_date: range.start_date,
    end_date: range.end_date,
    page_size: 100,
  });
}

function _num(v, kind = 'float') {
  if (v === null || v === undefined || v === '' || v === '-') return 0;
  return kind === 'int' ? parseInt(v, 10) || 0 : parseFloat(v) || 0;
}

router.get('/account-summary', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', note:'Set TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID to see live insights.' });
  const dp = String(req.query.date_preset || 'last_30d');
  const r = await _report('AUCTION_ADVERTISER', dp, ['advertiser_id']);
  if (!r.ok) return _err(res, 400, _friendly(r.error));
  const row = (r.data?.list || [])[0]?.metrics || {};
  const spend = _num(row.spend);
  const revenue = _num(row.total_purchase_value);
  res.json({ ok:true, source:'tiktok', date_preset: dp, summary: {
    spend, revenue,
    roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
    impressions: _num(row.impressions, 'int'),
    reach: _num(row.reach, 'int'),
    clicks: _num(row.clicks, 'int'),
    ctr: _num(row.ctr),
    cpc: _num(row.cpc),
    cpm: _num(row.cpm),
    frequency: _num(row.frequency),
    conversions: _num(row.conversion, 'int'),
    cost_per_conversion: _num(row.cost_per_conversion),
  }});
});

router.get('/campaigns', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', campaigns:[], note:'Set TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID for live campaigns.' });
  const dp = String(req.query.date_preset || 'last_30d');
  const r = await _report('AUCTION_CAMPAIGN', dp, ['campaign_id'], ['campaign_name']);
  if (!r.ok) return _err(res, 400, _friendly(r.error));
  const camps = (r.data?.list || []).map(item => {
    const m = item.metrics || {}, d = item.dimensions || {};
    const spend = _num(m.spend), rev = _num(m.total_purchase_value);
    return {
      id: d.campaign_id, name: m.campaign_name || `Campaign ${d.campaign_id}`,
      spend, revenue: rev,
      roas: spend > 0 ? +(rev / spend).toFixed(2) : 0,
      impressions: _num(m.impressions, 'int'),
      clicks: _num(m.clicks, 'int'),
      ctr: _num(m.ctr), cpc: _num(m.cpc), cpm: _num(m.cpm),
      conversions: _num(m.conversion, 'int'),
    };
  }).sort((a, b) => b.spend - a.spend);
  res.json({ ok:true, source:'tiktok', date_preset: dp, campaigns: camps });
});

router.get('/top-ads', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', ads:[], note:'Set TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID for top ads.' });
  const dp = String(req.query.date_preset || 'last_30d');
  const r = await _report('AUCTION_AD', dp, ['ad_id'], ['ad_name','campaign_name']);
  if (!r.ok) return _err(res, 400, _friendly(r.error));
  const ads = (r.data?.list || []).map(item => {
    const m = item.metrics || {}, d = item.dimensions || {};
    return {
      id: d.ad_id, name: m.ad_name || `Ad ${d.ad_id}`, campaign: m.campaign_name,
      spend: _num(m.spend),
      impressions: _num(m.impressions, 'int'),
      clicks: _num(m.clicks, 'int'),
      ctr: _num(m.ctr), cpc: _num(m.cpc),
      conversions: _num(m.conversion, 'int'),
    };
  }).sort((a, b) => b.ctr - a.ctr).slice(0, 15);
  res.json({ ok:true, source:'tiktok', date_preset: dp, ads });
});

module.exports = router;
