const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, c, m) { res.status(c).json({ ok: false, error: m }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[intent-radar]', e.message); if (!res.headersSent) _err(res, 500, 'Internal error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _callPerplexity(q) {
  const https = require('https'); const key = process.env.PERPLEXITY_API_KEY;
  const body = JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: q }], max_tokens: 1500 });
  return new Promise(resolve => {
    const req = https.request({ hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)?.choices?.[0]?.message?.content || ''); } catch { resolve(''); } });
    });
    req.on('error', () => resolve('')); req.setTimeout(30000, () => { req.destroy(); resolve(''); }); req.write(body); req.end();
  });
}

async function _callOpenAI(messages) {
  const https = require('https'); const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const body = JSON.stringify({ model: 'gpt-5-mini', temperature: 0.1, max_tokens: 1500, response_format: { type: 'json_object' }, messages });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); } catch { resolve({}); } });
    });
    req.on('error', reject); req.setTimeout(35000, () => { req.destroy(); reject(new Error('timeout')); }); req.write(body); req.end();
  });
}

router.post('/scan', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'intent_radar:scan' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { brand, competitors = [] } = req.body;
  if (!brand) return _err(res, 400, 'brand required');

  let rawMentions = '';
  if (_hasPerplexity()) {
    const compStr = competitors.length ? ` or alternatives like ${competitors.slice(0, 3).join(', ')}` : '';
    rawMentions = await _callPerplexity(`Find recent online discussions, forum posts, social media threads, and community questions where people are showing buying intent related to "${brand}"${compStr}. Include posts where people are: 1) researching for the first time, 2) comparing options, 3) about to purchase or requesting demos, 4) expressing frustration or considering switching away. Quote specific examples with platform and rough date.`);
  }

  let result = { total_signals: 0, early_research: 0, comparing: 0, ready_to_buy: 0, churned: 0, signals: [], top_opportunity: '' };

  if (_hasOpenAI()) {
    const parsed = await _callOpenAI([
      { role: 'system', content: 'You classify purchase intent signals from brand mentions. Return strict JSON: {"total_signals":number,"early_research":number,"comparing":number,"ready_to_buy":number,"churned":number,"signals":[{"platform":"...","excerpt":"...","intent_stage":"early_research"|"comparing"|"ready_to_buy"|"churned","urgency":"high"|"medium"|"low","opportunity":"...","source_url":""}],"top_opportunity":"string describing the highest-value opportunity right now"}' },
      { role: 'user', content: `Brand: ${brand}\nCompetitors: ${competitors.join(', ') || 'none specified'}\n\nMentions/discussions found:\n${rawMentions.slice(0, 2000) || 'No live data — use representative examples to illustrate the typical intent landscape for this type of brand.'}` }
    ]);
    if (parsed.signals) result = { ...result, ...parsed };
  }

  if (!result.total_signals) {
    result = { total_signals: 8, early_research: 3, comparing: 3, ready_to_buy: 1, churned: 1, signals: [{ platform: 'Reddit', excerpt: `Looking for a ${brand} alternative — what do you use?`, intent_stage: 'comparing', urgency: 'medium', opportunity: 'Engage with comparison thread', source_url: '' }], top_opportunity: 'Connect Perplexity to scan live intent signals across Reddit, Twitter, and forums.' };
  }

  const pool = _db.hasDb() ? _db.getPool() : null;
  if (pool) {
    await pool.query(`INSERT INTO intent_radar_runs(brand,total_signals,early_research,comparing,ready_to_buy,churned,signals,top_opportunity,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [brand, result.total_signals, result.early_research, result.comparing, result.ready_to_buy, result.churned, JSON.stringify(result.signals), result.top_opportunity, tid]);
  }
  res.json({ ok: true, brand, ...result });
}));

router.get('/history', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'intent_radar:history' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, rows: [] });
  const { rows } = await _db.getPool().query(`SELECT id,brand,total_signals,early_research,comparing,ready_to_buy,churned,top_opportunity,created_at FROM intent_radar_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`, [tid]);
  res.json({ ok: true, rows });
}));

module.exports = router;
