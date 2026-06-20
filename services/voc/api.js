const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

const _COUNTRY_TO_DFS_LOC = {
  US:2840, GB:2826, CA:2124, AU:2036, DE:2276, FR:2250, ES:2724, IT:2380,
  NL:2528, BE:2056, SE:2752, NO:2578, DK:2208, FI:2246, PL:2616, PT:2620,
  IE:2372, AT:2040, CH:2756, JP:2392, KR:2410, IN:2356, SG:2702, MY:2458,
  TH:2764, ID:2360, PH:2608, VN:2704, BR:2076, MX:2484, AR:2032, CL:2152,
  CO:2170, ZA:2710, AE:2784, SA:2682, IL:2376, TR:2792, EG:2818, NG:2566,
  KE:2404, NZ:2554, RU:2643, UA:2804, CZ:2203, RO:2642, GR:2300, HU:2348
};

async function _fetchMentions(brand, days, callDataForSEO) {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) return [];
  try {
    const dfsParams = { keyword: `"${brand}"`, language_code: 'en', depth: 20 };
    const raw = await callDataForSEO('/v3/serp/google/news/live/advanced', [dfsParams], 12000);
    const items = raw?.tasks?.[0]?.result?.[0]?.items;
    if (!Array.isArray(items)) return [];
    const cutoffMs = Date.now() - (days * 86400 * 1000);
    return items.slice(0, 20).map(it => {
      let host = '';
      try { host = it.url ? new URL(it.url).hostname.replace(/^www\./, '') : ''; } catch {}
      return {
        brand,
        title:   String(it.title || '').slice(0, 220),
        url:     String(it.url || it.source_url || ''),
        source:  String(it.source || it.domain || host || '').slice(0, 80),
        snippet: String(it.snippet || it.description || '').slice(0, 400),
        date:    it.timestamp || it.date_publish || it.date || null,
        thumb:   it.thumbnail_url || it.image_url || null,
        sentiment: 'neutral'
      };
    }).filter(m => {
      if (!m.title || !m.url) return false;
      if (!m.date) return true;
      const t = Date.parse(m.date);
      return isNaN(t) ? true : t >= cutoffMs;
    });
  } catch (e) {
    console.warn('[voc] mentions fetch failed:', e.message);
    return [];
  }
}

async function _aiCluster({ brand, mentions }, openaiChatWithRetry) {
  if (!openaiChatWithRetry) return null;
  try {
    const sample = mentions.slice(0, 80).map((m, i) =>
      `[${i+1}] (${m.sentiment||'?'}) ${(m.title||'').slice(0, 90)} — ${(m.snippet||m.text||'').slice(0, 200)}`
    ).join('\n');
    const sys = `You are a senior customer-insights analyst. Cluster the customer mentions about ${brand} into 4-8 distinct themes.
Return strict JSON in this exact shape:
{"summary":"<2-3 sentence executive read of what customers are saying>","themes":[{"label":"<short 2-5 word theme>","kind":"praise|complaint|question|feature_request|neutral","frequency":<int count of mentions in this theme>,"share":<float 0-1 of total>,"sentiment_score":<float -1..1>,"top_quotes":["<verbatim or near-verbatim 1-line quote>","..."],"recommended_action":"<1 concrete next step the brand should take>"}]}
Rules:
- Themes must be mutually exclusive and cover the most-discussed topics first.
- top_quotes: 2-3 short, real-feeling quotes drawn from the actual snippets.
- recommended_action must be specific (not "do better"); cite the kind of fix (product, comms, support, pricing).`;
    const completion = await openaiChatWithRetry({
      model: 'gpt-5-mini',
      messages: [{ role:'system', content: sys }, { role:'user', content: `Brand: ${brand}\nMentions (${mentions.length}):\n${sample}\n\nCluster now.` }],
      response_format: { type:'json_object' },
      temperature: 0.4,
      max_tokens: 2500,
    }, { fallbackModel:'gpt-3.5-turbo', retries: 2 });
    return JSON.parse(completion.choices[0].message.content);
  } catch (e) {
    console.warn('[voc] ai cluster failed:', e.message);
    return null;
  }
}

function _templateCluster({ brand, mentions }) {
  const buckets = { praise:[], complaint:[], neutral:[] };
  for (const m of mentions) {
    const s = (m.sentiment||'').toLowerCase();
    const k = s === 'positive' ? 'praise' : s === 'negative' ? 'complaint' : 'neutral';
    buckets[k].push(m);
  }
  const total = mentions.length || 1;
  const themes = Object.entries(buckets).filter(([_,arr]) => arr.length).map(([kind, arr]) => ({
    label: kind === 'praise' ? 'Positive sentiment' : kind === 'complaint' ? 'Customer complaints' : 'Neutral mentions',
    kind, frequency: arr.length, share: arr.length/total,
    sentiment_score: kind==='praise'?0.7:kind==='complaint'?-0.7:0,
    top_quotes: arr.slice(0,3).map(m => (m.snippet||m.title||'').slice(0,140)),
    recommended_action: kind==='complaint' ? 'Triage top complaints with support team and post a public response within 24h.' : kind==='praise' ? 'Amplify the positive themes via social proof in current campaigns.' : 'Monitor for emerging signals.',
  }));
  return { summary: `Sampled ${mentions.length} mentions of ${brand}. ${buckets.complaint.length} negative, ${buckets.praise.length} positive, ${buckets.neutral.length} neutral.`, themes };
}

module.exports = function vocRouter(ctx) {
  const { callDataForSEO, openaiChatWithRetry } = ctx || {};
  const router = express.Router();

  router.post('/mine', async (req, res) => {
    const brand = String(req.body?.brand || '').trim().slice(0, 80);
    const days  = Math.min(60, Math.max(1, parseInt(req.body?.days, 10) || 14));
    if (!brand) return _err(res, 400, 'brand required');

    if (!callDataForSEO || !process.env.DATAFORSEO_LOGIN) {
      return res.json({ ok:true, source:'empty', brand, mention_count:0, summary:'DataForSEO is not configured — cannot fetch mentions.', themes: [] });
    }

    const mentions = await _fetchMentions(brand, days, callDataForSEO);
    if (!mentions.length) {
      return res.json({ ok:true, source:'empty', brand, mention_count:0, summary:'No mentions returned for this brand in the selected window.', themes: [] });
    }

    let result = await _aiCluster({ brand, mentions }, openaiChatWithRetry);
    let source = 'openai';
    if (!result || !Array.isArray(result.themes)) { result = _templateCluster({ brand, mentions }); source = 'template'; }

    if (_db.hasDb()) {
      try {
        const tid = await _tid(req, 'voc:mine');
        await _db.getPool().query(
          `INSERT INTO voc_runs (tenant_id, brand, lookback_days, mention_count, themes, summary, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, brand, days, mentions.length, JSON.stringify(result.themes), result.summary || '', source]);
      } catch (e) { console.warn('[voc] persist failed:', e.message); }
    }
    res.json({ ok:true, source, brand, days, mention_count: mentions.length, summary: result.summary || '', themes: result.themes });
  });

  router.get('/history', async (req, res) => {
    if (!_db.hasDb()) return _err(res, 503, 'no-db');
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    try {
      const tid = await _tid(req, 'voc:history');
      const r = await _db.getPool().query(
        `SELECT id, brand, lookback_days, mention_count, summary, generated_by, created_at FROM voc_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
        [tid, limit]);
      res.json({ ok:true, runs: r.rows });
    } catch (e) { _err(res, 500, e.message); }
  });

  router.get('/:id', async (req, res) => {
    if (!_db.hasDb()) return _err(res, 503, 'no-db');
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
    try {
      const tid = await _tid(req, 'voc:get');
      const r = await _db.getPool().query(
        `SELECT * FROM voc_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
      if (!r.rows[0]) return _err(res, 404, 'not found');
      res.json({ ok:true, run: r.rows[0] });
    } catch (e) { _err(res, 500, e.message); }
  });

  return router;
};
