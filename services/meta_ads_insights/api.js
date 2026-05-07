const express = require('express');
const _https = require('https');
const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

function _hasCreds() {
  const t = process.env.META_ACCESS_TOKEN, a = process.env.META_AD_ACCOUNT_ID;
  return t && a && !/^_DUMMY/i.test(t) && !/^_DUMMY/i.test(a);
}

function _accountId() {
  const a = String(process.env.META_AD_ACCOUNT_ID || '').trim();
  return a.startsWith('act_') ? a : 'act_' + a;
}

async function _metaGet(path) {
  const token = process.env.META_ACCESS_TOKEN;
  const sep = path.includes('?') ? '&' : '?';
  const fullPath = `/v19.0${path}${sep}access_token=${encodeURIComponent(token)}`;
  return await new Promise((resolve) => {
    const req = _https.request({ hostname:'graph.facebook.com', path: fullPath, method:'GET' }, r => {
      let d=''; r.on('data', c => d += c); r.on('end', () => {
        try { const j = d ? JSON.parse(d) : {};
          if (r.statusCode >= 200 && r.statusCode < 300) resolve({ ok:true, data:j });
          else resolve({ ok:false, status:r.statusCode, error: j.error?.message || `meta ${r.statusCode}` });
        } catch (e) { resolve({ ok:false, error:'parse failed' }); }
      });
    });
    req.on('error', e => resolve({ ok:false, error: e.message }));
    req.setTimeout(25000, () => req.destroy());
    req.end();
  });
}

function _friendlyError(err) {
  if (!err) return err;
  if (/ads_management|ads_read/i.test(err)) return `${err} → Generate a new Meta access token with the 'ads_read' permission (or 'ads_management') from a System User in Business Settings.`;
  if (/Invalid OAuth|expired|access token/i.test(err)) return `${err} → Your META_ACCESS_TOKEN is invalid or expired. Generate a new long-lived System User token.`;
  return err;
}

router.post('/test', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'META_ACCESS_TOKEN + META_AD_ACCOUNT_ID required');
  const r = await _metaGet(`/${_accountId()}?fields=name,currency,account_status,timezone_name,amount_spent`);
  if (!r.ok) return _err(res, 400, _friendlyError(r.error));
  res.json({ ok:true, account: r.data });
});

router.get('/account-summary', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', note:'Set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID to see live insights.' });
  const datePreset = String(req.query.date_preset || 'last_30d');
  const allowed = ['today','yesterday','last_7d','last_14d','last_30d','last_90d','this_month','last_month'];
  const dp = allowed.includes(datePreset) ? datePreset : 'last_30d';
  const fields = 'spend,impressions,reach,clicks,ctr,cpm,cpc,actions,action_values,frequency';
  const r = await _metaGet(`/${_accountId()}/insights?fields=${fields}&date_preset=${dp}&level=account`);
  if (!r.ok) return _err(res, 400, _friendlyError(r.error));
  const row = r.data?.data?.[0] || {};
  const purchases = (row.actions || []).find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
  const purchaseValue = (row.action_values || []).find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
  const spend = parseFloat(row.spend || 0);
  const revenue = parseFloat(purchaseValue?.value || 0);
  res.json({ ok:true, source:'meta', date_preset: dp, summary: {
    spend, impressions: parseInt(row.impressions||0,10), reach: parseInt(row.reach||0,10),
    clicks: parseInt(row.clicks||0,10), ctr: parseFloat(row.ctr||0), cpm: parseFloat(row.cpm||0),
    cpc: parseFloat(row.cpc||0), frequency: parseFloat(row.frequency||0),
    purchases: parseInt(purchases?.value||0,10), revenue,
    roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
  }});
});

router.get('/campaigns', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', campaigns:[], note:'Set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID for live campaigns.' });
  const dp = String(req.query.date_preset || 'last_30d');
  const allowed = ['today','yesterday','last_7d','last_14d','last_30d','last_90d','this_month','last_month'];
  const datePreset = allowed.includes(dp) ? dp : 'last_30d';
  const fields = 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,actions,action_values';
  const r = await _metaGet(`/${_accountId()}/insights?fields=${fields}&date_preset=${datePreset}&level=campaign&limit=50`);
  if (!r.ok) return _err(res, 400, _friendlyError(r.error));
  const camps = (r.data?.data || []).map(c => {
    const purch = (c.actions||[]).find(a => a.action_type==='purchase' || a.action_type==='omni_purchase');
    const pv = (c.action_values||[]).find(a => a.action_type==='purchase' || a.action_type==='omni_purchase');
    const spend = parseFloat(c.spend||0); const rev = parseFloat(pv?.value||0);
    return {
      id: c.campaign_id, name: c.campaign_name, spend, impressions: parseInt(c.impressions||0,10),
      clicks: parseInt(c.clicks||0,10), ctr: parseFloat(c.ctr||0), cpc: parseFloat(c.cpc||0), cpm: parseFloat(c.cpm||0),
      purchases: parseInt(purch?.value||0,10), revenue: rev,
      roas: spend > 0 ? +(rev/spend).toFixed(2) : 0,
    };
  }).sort((a,b) => b.spend - a.spend);
  res.json({ ok:true, source:'meta', date_preset: datePreset, campaigns: camps });
});

router.get('/top-ads', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', ads:[], note:'Set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID for top-performing creatives.' });
  const dp = String(req.query.date_preset || 'last_30d');
  const allowed = ['last_7d','last_14d','last_30d','last_90d'];
  const datePreset = allowed.includes(dp) ? dp : 'last_30d';
  const fields = 'ad_id,ad_name,campaign_name,spend,impressions,clicks,ctr,cpc,actions';
  const r = await _metaGet(`/${_accountId()}/insights?fields=${fields}&date_preset=${datePreset}&level=ad&limit=25`);
  if (!r.ok) return _err(res, 400, _friendlyError(r.error));
  const ads = (r.data?.data || []).map(a => {
    const purch = (a.actions||[]).find(x => x.action_type==='purchase' || x.action_type==='omni_purchase');
    return {
      id: a.ad_id, name: a.ad_name, campaign: a.campaign_name,
      spend: parseFloat(a.spend||0), impressions: parseInt(a.impressions||0,10),
      clicks: parseInt(a.clicks||0,10), ctr: parseFloat(a.ctr||0), cpc: parseFloat(a.cpc||0),
      purchases: parseInt(purch?.value||0,10),
    };
  }).sort((a,b) => b.ctr - a.ctr).slice(0, 15);
  res.json({ ok:true, source:'meta', date_preset: datePreset, ads });
});

module.exports = router;
