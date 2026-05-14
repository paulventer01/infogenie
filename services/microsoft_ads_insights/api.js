// Microsoft Advertising (Bing Ads) — insights router.
// Mirrors the Meta/Google/TikTok pattern: /test, /account-summary, /campaigns.
//
// Microsoft's Reporting API is asynchronous (Submit → Poll → Download CSV),
// so a single live request can take 8-15s. We cap polling at ~14s and fall
// back to a friendly "report still building" response.
//
// Required Replit secrets:
//   MICROSOFT_ADS_DEVELOPER_TOKEN  — from https://developers.ads.microsoft.com/Account
//   MICROSOFT_ADS_CLIENT_ID        — Azure App Registration (Application ID)
//   MICROSOFT_ADS_CLIENT_SECRET    — Azure App Registration secret value
//   MICROSOFT_ADS_REFRESH_TOKEN    — long-lived OAuth refresh token
//   MICROSOFT_ADS_CUSTOMER_ID      — Customer ID (top-right of Bing Ads UI)
//   MICROSOFT_ADS_ACCOUNT_ID       — Account ID (number, no prefix)

const express = require('express');
const router  = express.Router();

const TOKEN_HOST    = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const REPORTING_API = 'https://reporting.api.bingads.microsoft.com/Reporting/v13';
const SCOPE         = 'https://ads.microsoft.com/msads.manage offline_access';

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

function _hasCreds() {
  const need = ['MICROSOFT_ADS_DEVELOPER_TOKEN','MICROSOFT_ADS_CLIENT_ID','MICROSOFT_ADS_CLIENT_SECRET',
                'MICROSOFT_ADS_REFRESH_TOKEN','MICROSOFT_ADS_CUSTOMER_ID','MICROSOFT_ADS_ACCOUNT_ID'];
  return need.every(k => {
    const v = process.env[k];
    return v && !/^_DUMMY/i.test(v);
  });
}

// ── In-process token cache: refresh tokens are long-lived but access tokens
//    expire in ~1h. Cache the access token to avoid hitting the OAuth endpoint
//    on every report submission.
let _tokenCache = { access: null, expiresAt: 0 };
async function _accessToken() {
  if (_tokenCache.access && Date.now() < _tokenCache.expiresAt - 60_000) return _tokenCache.access;
  const body = new URLSearchParams({
    client_id:     process.env.MICROSOFT_ADS_CLIENT_ID,
    client_secret: process.env.MICROSOFT_ADS_CLIENT_SECRET,
    refresh_token: process.env.MICROSOFT_ADS_REFRESH_TOKEN,
    grant_type:    'refresh_token',
    scope:         SCOPE,
  }).toString();
  const r = await fetch(TOKEN_HOST, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    const detail = j.error_description || j.error || `status ${r.status}`;
    throw new Error('Microsoft Ads OAuth failed: ' + detail);
  }
  _tokenCache = { access: j.access_token, expiresAt: Date.now() + (Number(j.expires_in || 3600) * 1000) };
  return _tokenCache.access;
}

function _msHeaders(token) {
  return {
    'Authorization':    `Bearer ${token}`,
    'DeveloperToken':   process.env.MICROSOFT_ADS_DEVELOPER_TOKEN,
    'CustomerId':       process.env.MICROSOFT_ADS_CUSTOMER_ID,
    'CustomerAccountId':process.env.MICROSOFT_ADS_ACCOUNT_ID,
    'Content-Type':     'application/json',
  };
}

// ── Submit a report request, poll until ready, download CSV. Bing's REST
//    Reporting endpoint mirrors the SOAP one: returns a ReportRequestId
//    immediately, then you poll Status with that id, and finally GET the URL
//    in the response body once status === 'Success'.
async function _runReport({ reportType, columns, days, scope = 'AccountReport', timeoutMs = 14000 }) {
  const token = await _accessToken();
  const headers = _msHeaders(token);
  const aggregation = days <= 1 ? 'Hourly' : days <= 31 ? 'Daily' : 'Weekly';
  const submitBody = {
    ReportRequest: {
      ExcludeColumnHeaders: false,
      ExcludeReportFooter:  true,
      ExcludeReportHeader:  true,
      Format: 'Csv',
      ReportName: `IG ${reportType} ${days}d`,
      ReturnOnlyCompleteData: false,
      Type: reportType,
      Aggregation: aggregation,
      Columns: columns,
      Scope: { AccountIds: [Number(process.env.MICROSOFT_ADS_ACCOUNT_ID)] },
      Time: { PredefinedTime: days <= 7 ? 'LastSevenDays' : days <= 30 ? 'LastMonth' : 'LastThreeMonths' },
    },
  };
  const submit = await fetch(`${REPORTING_API}/GenerateReport/Submit`, {
    method:'POST', headers, body: JSON.stringify(submitBody),
  });
  const sj = await submit.json().catch(() => ({}));
  if (!submit.ok || !sj.ReportRequestId) {
    const msg = sj?.[0]?.Message || sj?.Errors?.[0]?.Message || sj?.error?.message || `submit failed (${submit.status})`;
    throw new Error('Microsoft Ads report submit: ' + msg);
  }
  const reqId = sj.ReportRequestId;
  // Poll status — start fast, then back off slightly. Most small reports finish in 4-8s.
  const deadline = Date.now() + timeoutMs;
  const delays = [1500, 2000, 2500, 3000, 3500];
  let pollIdx = 0, statusJson = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delays[Math.min(pollIdx, delays.length-1)]));
    pollIdx++;
    const pr = await fetch(`${REPORTING_API}/GenerateReport/Poll`, {
      method:'POST', headers, body: JSON.stringify({ ReportRequestId: reqId }),
    });
    statusJson = await pr.json().catch(() => ({}));
    const status = statusJson?.ReportRequestStatus?.Status;
    if (status === 'Success') break;
    if (status === 'Error')   throw new Error('Microsoft Ads report errored on platform side');
    // Pending / InProgress → loop
  }
  const finalStatus = statusJson?.ReportRequestStatus?.Status;
  if (finalStatus !== 'Success') return { ok:false, error:'report-pending', detail:`Bing Ads report still building after ${timeoutMs/1000}s — try again in a minute.` };
  const downloadUrl = statusJson.ReportRequestStatus.ReportDownloadUrl;
  if (!downloadUrl) return { ok:false, error:'no-download-url' };
  const dlResp = await fetch(downloadUrl);
  if (!dlResp.ok) return { ok:false, error:`download failed (${dlResp.status})` };
  // Bing returns ZIP for some reports — we requested Csv with no header/footer,
  // which still ships gzipped; node fetch decompresses gzip automatically.
  const csv = await dlResp.text();
  return { ok:true, csv };
}

function _parseCsv(csv) {
  if (!csv || typeof csv !== 'string') return { headers:[], rows:[] };
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers:[], rows:[] };
  const split = (line) => {
    // Minimal CSV parser — handles quoted fields with commas
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]).map(h => h.replace(/^"|"$/g,'').trim());
  const rows = lines.slice(1).map(l => {
    const cells = split(l);
    const obj = {};
    headers.forEach((h,i) => { obj[h] = (cells[i] || '').replace(/^"|"$/g,''); });
    return obj;
  });
  return { headers, rows };
}

function _toNum(v) { const n = Number(String(v||'').replace(/[^0-9.\-]/g,'')); return isFinite(n) ? n : 0; }

// ── Routes ───────────────────────────────────────────────────────────────────

router.post('/test', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'Microsoft Ads credentials missing — set MICROSOFT_ADS_* secrets in Settings.');
  try {
    const tok = await _accessToken();
    res.json({ ok:true, account: {
      customerId: process.env.MICROSOFT_ADS_CUSTOMER_ID,
      accountId:  process.env.MICROSOFT_ADS_ACCOUNT_ID,
      tokenAcquired: true,
      expiresInSec: Math.round((_tokenCache.expiresAt - Date.now()) / 1000),
    }});
  } catch (e) { _err(res, 400, e.message); }
});

router.get('/account-summary', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', note:'Set MICROSOFT_ADS_* secrets to see live Bing Ads insights.' });
  const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
  try {
    const r = await _runReport({
      reportType: 'AccountPerformanceReport',
      columns: ['AccountId','TimePeriod','Spend','Impressions','Clicks','Ctr','AverageCpc','AverageCpm','Conversions','Revenue'],
      days,
    });
    if (!r.ok) return res.json({ ok:false, source:'microsoft', error: r.error, detail: r.detail });
    const { rows } = _parseCsv(r.csv);
    let spend=0, imp=0, clk=0, conv=0, rev=0;
    for (const row of rows) {
      spend += _toNum(row.Spend);
      imp   += _toNum(row.Impressions);
      clk   += _toNum(row.Clicks);
      conv  += _toNum(row.Conversions);
      rev   += _toNum(row.Revenue);
    }
    res.json({ ok:true, source:'microsoft', days, summary:{
      spend: +spend.toFixed(2), impressions: imp, clicks: clk, conversions: conv, revenue: +rev.toFixed(2),
      ctr:  imp>0 ? +((clk/imp)*100).toFixed(2) : 0,
      cpc:  clk>0 ? +(spend/clk).toFixed(2) : 0,
      cpm:  imp>0 ? +((spend/imp)*1000).toFixed(2) : 0,
      roas: spend>0 ? +(rev/spend).toFixed(2) : 0,
    }});
  } catch (e) { _err(res, 400, e.message); }
});

router.get('/campaigns', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok:true, source:'placeholder', campaigns:[], note:'Set MICROSOFT_ADS_* secrets for live Bing Ads campaigns.' });
  const days = Math.max(7, Math.min(90, parseInt(req.query.days, 10) || 30));
  try {
    const r = await _runReport({
      reportType: 'CampaignPerformanceReport',
      columns: ['CampaignId','CampaignName','Spend','Impressions','Clicks','Ctr','AverageCpc','Conversions','Revenue'],
      days,
    });
    if (!r.ok) return res.json({ ok:false, source:'microsoft', error: r.error, detail: r.detail });
    const { rows } = _parseCsv(r.csv);
    const agg = new Map();
    for (const row of rows) {
      const id = row.CampaignId || row.CampaignName;
      if (!id) continue;
      const c = agg.get(id) || { id, name: row.CampaignName || id, spend:0, impressions:0, clicks:0, conversions:0, revenue:0 };
      c.spend += _toNum(row.Spend); c.impressions += _toNum(row.Impressions);
      c.clicks += _toNum(row.Clicks); c.conversions += _toNum(row.Conversions);
      c.revenue += _toNum(row.Revenue);
      agg.set(id, c);
    }
    const camps = [...agg.values()].map(c => ({
      ...c,
      ctr:  c.impressions>0 ? +((c.clicks/c.impressions)*100).toFixed(2) : 0,
      cpc:  c.clicks>0 ? +(c.spend/c.clicks).toFixed(2) : 0,
      roas: c.spend>0 ? +(c.revenue/c.spend).toFixed(2) : 0,
    })).sort((a,b) => b.spend - a.spend);
    res.json({ ok:true, source:'microsoft', days, campaigns: camps });
  } catch (e) { _err(res, 400, e.message); }
});

module.exports = router;
