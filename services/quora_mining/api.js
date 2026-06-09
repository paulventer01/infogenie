const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[quora-mining]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _extractJson(txt) {
  const stripped = txt.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1').trim();
  for (const src of [stripped, txt]) {
    const start = src.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { try { return JSON.parse(src.slice(start, i + 1)); } catch (_) { break; } } }
    }
  }
  return null;
}

async function _mine(topic, brand) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required' };
  const prompt = `Search Quora for the most-engaged questions about "${topic}". Return ONLY a valid JSON object — no prose, no markdown fences.

Use this exact shape:
{"questions":[{"question":"the actual question text","url":"https://www.quora.com/...","answer_count":<int>,"view_count":<int>,"top_answer_summary":"1-2 sentence gist of the highest-voted answer","intent":"informational|comparison|recommendation|complaint|how-to|definition","suggested_response_angle":"specific content angle ${brand ? `for ${brand}` : 'for a brand'} to address this question"}]}

Return 8-15 questions, sorted by engagement (answer_count + view_count). Only include real Quora questions you can find. If no questions found, return {"questions":[]}.`;

  return await new Promise(resolve => {
    const body = JSON.stringify({ model:'sonar-pro', temperature:0.1, max_tokens:3500, messages:[{ role:'user', content: prompt }] });
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) { console.warn('[quora-mining] perplexity error:', j.error); return resolve({ error: String(j.error.message || j.error) }); }
          const txt = j?.choices?.[0]?.message?.content || '';
          const parsed = _extractJson(txt);
          if (!parsed) {
            console.warn('[quora-mining] parse_failed for', topic, '— raw:', txt.slice(0, 300));
            return resolve({ questions: [] });
          }
          resolve(parsed);
        } catch { resolve({ questions: [] }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(45000, () => { req.destroy(); resolve({ error: 'Perplexity timeout' }); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, perplexity: _hasPerplexity(), db: _db.hasDb && _db.hasDb() }));

router.post('/mine', _safeAsync(async (req, res) => {
  const topic = String(req.body?.topic || '').trim().slice(0, 300);
  const brand = String(req.body?.brand || '').trim().slice(0, 200);
  if (!topic) return _err(res, 400, 'topic required');
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required');
  const r = await _mine(topic, brand);
  if (r.error) return _err(res, 502, r.error);
  const questions = Array.isArray(r.questions) ? r.questions.slice(0, 25) : [];

  if (_db.hasDb && _db.hasDb()) {
    try {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'quora_mining:mine' });
      await _db.getPool().query(
        `INSERT INTO quora_runs (tenant_id, topic, total_questions, questions) VALUES ($1,$2,$3,$4)`,
        [tid, topic, questions.length, JSON.stringify(questions)]
      );
    } catch(_) {}
  }
  res.json({ ok:true, topic, brand, total: questions.length, questions });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'quora_mining:runs' });
  const r = await _db.getPool().query('SELECT id, topic, total_questions, created_at FROM quora_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [tid]);
  res.json({ ok:true, runs: r.rows });
}));

module.exports = router;
