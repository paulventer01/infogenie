const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error:msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

function _hasKey(k) { return k && !/^_DUMMY/i.test(k.trim()); }

function _post(options, body) {
  return new Promise(resolve => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = _https.request({ ...options, headers: { ...options.headers, 'Content-Length': Buffer.byteLength(data) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => { req.destroy(); resolve(null); });
    req.write(data); req.end();
  });
}

async function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!_hasKey(key)) return null;
  const body = JSON.stringify({
    model: 'gpt-5',
    messages,
    response_format: { type: 'json_object' },
    reasoning_effort: 'minimal',
    max_completion_tokens: opts.max_tokens || 2000
  });
  const r = await _post({
    hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }
  }, body);
  if (!r || r.status !== 200) return null;
  return r.body?.choices?.[0]?.message?.content || null;
}

async function _anthropic(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!_hasKey(key)) return null;
  const sys = messages.find(m => m.role === 'system')?.content || '';
  const user = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
  const body = JSON.stringify({
    model: 'claude-opus-4-5',
    system: sys,
    messages: user,
    max_tokens: opts.max_tokens || 2000,
    temperature: 0.2
  });
  const r = await _post({
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
  }, body);
  if (!r || r.status !== 200) return null;
  return r.body?.content?.[0]?.text || null;
}

async function _gemini(messages, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!_hasKey(key)) return null;
  const sys = messages.find(m => m.role === 'system')?.content || '';
  const userMsg = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: (sys ? sys + '\n\n' : '') + userMsg }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: opts.max_tokens || 2000, responseMimeType: 'application/json' }
  });
  const r = await _post({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, body);
  if (!r || r.status !== 200) return null;
  return r.body?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function _perplexity(prompt) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!_hasKey(key)) return null;
  const body = JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1200 });
  const r = await _post({
    hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }
  }, body);
  if (!r) return null;
  return r.body?.choices?.[0]?.message?.content || null;
}

async function _predictWithCascade(messages, opts = {}) {
  const attempts = [
    { fn: _openai,    name: 'GPT-5' },
    { fn: _anthropic, name: 'Claude' },
    { fn: _gemini,    name: 'Gemini' },
  ];
  for (const { fn, name } of attempts) {
    try {
      const raw = await fn(messages, opts);
      if (!raw) continue;
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const parsed = JSON.parse(m[0]);
      if (parsed && parsed.prediction) return { prediction: parsed, provider: name };
    } catch { continue; }
  }
  return null;
}

const TEMPLATE = {
  prediction: 'Preparing global expansion — new market entry within 90 days',
  confidence: 72,
  move_type: 'market_expansion',
  threat_level: 'high',
  rationale: 'No AI provider is configured. Add an OpenAI, Anthropic, or Gemini API key via Admin → Platform APIs to get live AI predictions.',
  recommended_counter: 'Pre-empt by launching competitive content in target market now.',
  signals_summary: []
};

router.post('/analyse', async (req, res) => {
  const tid = await _tid(req, 'wr:analyse'); if (!tid) return _err(res, 400, 'no_tenant');
  const { competitor, domain, signals = [] } = req.body || {};
  if (!competitor) return _err(res, 400, 'competitor required');

  const signalPrompt = `Research the company "${competitor}"${domain ? ' (' + domain + ')' : ''} and return a JSON object with these keys:
  "recent_hires": array of notable recent leadership hires (title, implication),
  "ad_spend_change": string describing any observed change in Google/Meta ad spend,
  "new_pages": array of new landing pages or product pages launched recently,
  "pricing_changes": string describing any pricing changes,
  "pr_signals": array of recent press releases or announcements,
  "geographic_signals": string describing any new region targeting observed.
  Return only valid JSON.`;

  let liveSignals = {};
  const signalRaw = await _perplexity(signalPrompt);
  if (signalRaw) {
    const m = signalRaw.match(/\{[\s\S]*\}/);
    if (m) { try { liveSignals = JSON.parse(m[0]); } catch {} }
  }

  const allSignals = [...signals];
  if (liveSignals.recent_hires?.length)    allSignals.push({ type: 'hiring',   data: liveSignals.recent_hires });
  if (liveSignals.ad_spend_change)          allSignals.push({ type: 'ad_spend', data: liveSignals.ad_spend_change });
  if (liveSignals.new_pages?.length)        allSignals.push({ type: 'new_pages', data: liveSignals.new_pages });
  if (liveSignals.pricing_changes)          allSignals.push({ type: 'pricing',  data: liveSignals.pricing_changes });
  if (liveSignals.pr_signals?.length)       allSignals.push({ type: 'pr',       data: liveSignals.pr_signals });
  if (liveSignals.geographic_signals)       allSignals.push({ type: 'geo',      data: liveSignals.geographic_signals });

  const signalsText = allSignals.map(s => `${s.type}: ${JSON.stringify(s.data)}`).join('\n');

  const sys = `You are a strategic competitive intelligence analyst. Given a set of competitor signals, predict their most likely next strategic move with a confidence score.
Return strict JSON:
{
  "prediction": "One sentence describing the predicted move",
  "confidence": <integer 0-100>,
  "move_type": "<market_expansion|product_launch|pricing_war|talent_surge|acquisition|channel_shift|partnership>",
  "threat_level": "<low|medium|high|critical>",
  "timeframe": "e.g. within 60 days",
  "rationale": "2-3 sentence explanation connecting the signals to the prediction",
  "recommended_counter": "Specific action InfoGenie user should take right now to pre-empt this move",
  "signals_summary": [{"signal":"...", "weight":"high|medium|low", "implication":"..."}]
}`;

  const userMsg = `Competitor: ${competitor}\n\nSignals:\n${signalsText || 'No custom signals provided — use your knowledge of this company.'}`;
  const result = await _predictWithCascade([{ role: 'system', content: sys }, { role: 'user', content: userMsg }]);

  const prediction = result ? result.prediction : TEMPLATE;
  const providerUsed = result ? result.provider : null;
  const signalProvider = signalRaw ? 'Perplexity' : null;

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO war_room_analyses(tenant_id,competitor,signals,prediction,confidence) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at`,
    [tid, competitor, JSON.stringify(allSignals), JSON.stringify(prediction), prediction.confidence || 0]
  );

  res.json({
    ok: true,
    id: ins.rows[0].id,
    competitor,
    signals: allSignals,
    prediction,
    provider_used: providerUsed,
    signal_provider: signalProvider,
    created_at: ins.rows[0].created_at
  });
});

router.get('/history', async (req, res) => {
  const tid = await _tid(req, 'wr:history'); if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT id,competitor,confidence,prediction,created_at FROM war_room_analyses WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [tid]
  );
  res.json({ ok: true, runs: rows.rows });
});

module.exports = router;
