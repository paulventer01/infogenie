const express = require('express');
const _https = require('https');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
const URL_RE = /^https?:\/\/[^\s]+$/i;

async function _pagespeed(url, strategy) {
  const key = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const path = `/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo&key=${encodeURIComponent(key)}`;
  return await new Promise((resolve) => {
    const req = _https.request({ hostname:'www.googleapis.com', path, method:'GET' }, r => {
      let d=''; r.on('data', c => d += c); r.on('end', () => {
        try { if (r.statusCode !== 200) { console.warn('[web-vitals]', strategy, r.statusCode, d.slice(0,200)); return resolve(null); } resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.end();
  });
}

function _normalize(raw, strategy) {
  if (!raw || !raw.lighthouseResult) return null;
  const lh = raw.lighthouseResult;
  const cat = lh.categories || {};
  const audits = lh.audits || {};
  const scoreOf = c => Math.round((c?.score||0)*100);
  const m = a => audits[a]?.displayValue || '—';
  const numeric = a => audits[a]?.numericValue ?? null;
  const cwv = (raw.loadingExperience && raw.loadingExperience.metrics) || {};
  return {
    strategy,
    scores: {
      performance: scoreOf(cat.performance),
      accessibility: scoreOf(cat.accessibility),
      best_practices: scoreOf(cat['best-practices']),
      seo: scoreOf(cat.seo),
    },
    metrics: {
      lcp: { display: m('largest-contentful-paint'), value: numeric('largest-contentful-paint'), good: (numeric('largest-contentful-paint')||0) <= 2500 },
      fcp: { display: m('first-contentful-paint'), value: numeric('first-contentful-paint'), good: (numeric('first-contentful-paint')||0) <= 1800 },
      cls: { display: m('cumulative-layout-shift'), value: numeric('cumulative-layout-shift'), good: (numeric('cumulative-layout-shift')||0) <= 0.1 },
      tbt: { display: m('total-blocking-time'), value: numeric('total-blocking-time'), good: (numeric('total-blocking-time')||0) <= 200 },
      tti: { display: m('interactive'), value: numeric('interactive'), good: (numeric('interactive')||0) <= 3800 },
      si:  { display: m('speed-index'), value: numeric('speed-index'), good: (numeric('speed-index')||0) <= 3400 },
    },
    field_data: cwv.LARGEST_CONTENTFUL_PAINT_MS ? {
      lcp_ms: cwv.LARGEST_CONTENTFUL_PAINT_MS?.percentile,
      lcp_cat: cwv.LARGEST_CONTENTFUL_PAINT_MS?.category,
      cls: cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile/100,
      cls_cat: cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category,
      inp_ms: cwv.INTERACTION_TO_NEXT_PAINT?.percentile,
      inp_cat: cwv.INTERACTION_TO_NEXT_PAINT?.category,
    } : null,
    opportunities: Object.values(audits)
      .filter(a => a && a.details && a.details.type === 'opportunity' && (a.numericValue||0) > 100)
      .sort((a,b) => (b.numericValue||0) - (a.numericValue||0))
      .slice(0, 6)
      .map(a => ({ id:a.id, title:a.title, savings_ms: Math.round(a.numericValue||0), description: (a.description||'').replace(/\[[^\]]+\]\([^)]+\)/g,'') })),
  };
}

router.post('/audit', async (req, res) => {
  let url = String(req.body?.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!URL_RE.test(url)) return _err(res, 400, 'Valid URL required (https://example.com)');
  const [mob, desk] = await Promise.all([_pagespeed(url, 'mobile'), _pagespeed(url, 'desktop')]);
  if (!mob && !desk) return res.json({ ok:true, url, source:'placeholder', note:'GOOGLE_PAGESPEED_API_KEY missing or invalid — set the key for real audits.', mobile:null, desktop:null });
  res.json({ ok:true, url, source:'pagespeed', mobile: _normalize(mob, 'mobile'), desktop: _normalize(desk, 'desktop') });
});

module.exports = router;
