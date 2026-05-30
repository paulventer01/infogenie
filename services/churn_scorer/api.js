const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[churn]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _scoreContact(c) {
  if (!_hasOpenAI()) return null;
  const sys = 'You are a customer-success churn-prediction analyst. Score churn risk 0-100 (higher = more likely to churn). Strict JSON.';
  const user = `Contact data:
${JSON.stringify(c, null, 2)}

Reply strict JSON:
{
  "score": 0-100,
  "risk_level": "low|medium|high|critical",
  "signals": ["signal 1 explanation","signal 2",...],
  "recommendation": "1-sentence retention play"
}

Heuristics: low engagement (<1 login/wk = +30), declining usage (-MoM = +25), open support tickets unresolved >7d (+20), no recent purchase >90d (+15), NPS <=6 (+15), feature adoption <30% (+10), tenure <90d AND low engagement (+15).`;
  return await new Promise(resolve => {
    const body = JSON.stringify({
      model:'gpt-4o-mini', temperature:0.2, max_tokens:600,
      response_format:{ type:'json_object' },
      messages:[{ role:'system', content: sys }, { role:'user', content: user }]
    });
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => { try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, openai: _hasOpenAI(), db: _db.hasDb && _db.hasDb() }));

function _capContact(c) {
  const out = {};
  for (const k of Object.keys(c || {}).slice(0, 30)) {
    const v = c[k];
    if (typeof v === 'string') out[k] = v.slice(0, 500);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else out[k] = String(v).slice(0, 500);
  }
  return out;
}
router.post('/score', _safeAsync(async (req, res) => {
  const contact = _capContact(req.body?.contact || {});
  const email = String(contact.email || '').trim().toLowerCase().slice(0, 320);
  if (!email) return _err(res, 400, 'contact.email required');
  if (!_hasOpenAI()) return _err(res, 400, 'OPENAI_API_KEY required');
  const result = await _scoreContact(contact);
  if (!result || typeof result.score !== 'number') return _err(res, 502, 'AI scoring failed');

  if (_db.hasDb && _db.hasDb()) {
    try { await _db.getPool().query(
      `INSERT INTO churn_scores (contact_email, contact_name, score, risk_level, signals, recommendation, input_data) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (contact_email) DO UPDATE SET score=EXCLUDED.score, risk_level=EXCLUDED.risk_level, signals=EXCLUDED.signals, recommendation=EXCLUDED.recommendation, input_data=EXCLUDED.input_data, created_at=now()`,
      [email, contact.name||null, result.score, result.risk_level||'medium', JSON.stringify(result.signals||[]), result.recommendation||'', JSON.stringify(contact)]
    ); } catch(_) {}
  }
  res.json({ ok:true, email, ...result });
}));

router.post('/bulk', _safeAsync(async (req, res) => {
  const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts.slice(0, 25) : [];
  if (!contacts.length) return _err(res, 400, 'contacts array required (max 25)');
  if (!_hasOpenAI()) return _err(res, 400, 'OPENAI_API_KEY required');
  const out = [];
  for (const raw of contacts) {
    const c = _capContact(raw || {});
    const email = String(c.email||'').trim().toLowerCase().slice(0, 320);
    if (!email) { out.push({ ok:false, error:'missing email' }); continue; }
    const r = await _scoreContact(c);
    if (!r || typeof r.score !== 'number') { out.push({ ok:false, email, error:'scoring failed' }); continue; }
    if (_db.hasDb && _db.hasDb()) {
      try { await _db.getPool().query(
        `INSERT INTO churn_scores (contact_email, contact_name, score, risk_level, signals, recommendation, input_data) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (contact_email) DO UPDATE SET score=EXCLUDED.score, risk_level=EXCLUDED.risk_level, signals=EXCLUDED.signals, recommendation=EXCLUDED.recommendation, input_data=EXCLUDED.input_data, created_at=now()`,
        [email, c.name||null, r.score, r.risk_level||'medium', JSON.stringify(r.signals||[]), r.recommendation||'', JSON.stringify(c)]
      ); } catch(_) {}
    }
    out.push({ ok:true, email, ...r });
  }
  res.json({ ok:true, count: out.length, results: out });
}));

router.get('/scores', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, scores:[] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'churn_scorer:scores' });
  const minScore = parseInt(req.query.min || 0, 10);
  const r = await _db.getPool().query('SELECT contact_email, contact_name, score, risk_level, signals, recommendation, created_at FROM churn_scores WHERE score >= $1 AND tenant_id=$2 ORDER BY score DESC, created_at DESC LIMIT 200', [minScore, tid]);
  res.json({ ok:true, scores: r.rows });
}));

module.exports = router;
