const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error:msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

function _openai(messages, opts={}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({ model:'gpt-4o', messages, response_format:{ type:'json_object' }, temperature:0.2, max_tokens: opts.max_tokens||2000 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if(r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

function _perplexity(prompt) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({ model:'sonar', messages:[{role:'user',content:prompt}], temperature:0.1, max_tokens:1200 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); resolve(j.choices?.[0]?.message?.content||null); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(45000,()=>req.destroy()); req.write(body); req.end();
  });
}

const TEMPLATE = {
  prediction: 'Preparing global expansion — new market entry within 90 days',
  confidence: 72,
  move_type: 'market_expansion',
  threat_level: 'high',
  rationale: 'Template result — connect AI providers for live predictions.',
  recommended_counter: 'Pre-empt by launching competitive content in target market now.',
  signals_summary: []
};

router.post('/analyse', async (req, res) => {
  const tid = await _tid(req, 'wr:analyse'); if (!tid) return _err(res,400,'no_tenant');
  const { competitor, domain, signals=[] } = req.body || {};
  if (!competitor) return _err(res,400,'competitor required');

  // Gather live signals via Perplexity
  const signalPrompt = `Research the company "${competitor}"${domain?' ('+domain+')':''} and return a JSON object with these keys:
  "recent_hires": array of notable recent leadership hires (title, implication),
  "ad_spend_change": string describing any observed change in Google/Meta ad spend,
  "new_pages": array of new landing pages or product pages launched recently,
  "pricing_changes": string describing any pricing changes,
  "pr_signals": array of recent press releases or announcements,
  "geographic_signals": string describing any new region targeting observed.
  Return only valid JSON.`;

  const [signalRaw] = await Promise.all([_perplexity(signalPrompt)]);
  let liveSignals = {};
  if (signalRaw) {
    const m = signalRaw.match(/\{[\s\S]*\}/);
    if (m) { try { liveSignals = JSON.parse(m[0]); } catch {} }
  }

  const allSignals = [...signals];
  if (liveSignals.recent_hires?.length) allSignals.push({ type:'hiring', data: liveSignals.recent_hires });
  if (liveSignals.ad_spend_change) allSignals.push({ type:'ad_spend', data: liveSignals.ad_spend_change });
  if (liveSignals.new_pages?.length) allSignals.push({ type:'new_pages', data: liveSignals.new_pages });
  if (liveSignals.pricing_changes) allSignals.push({ type:'pricing', data: liveSignals.pricing_changes });
  if (liveSignals.pr_signals?.length) allSignals.push({ type:'pr', data: liveSignals.pr_signals });
  if (liveSignals.geographic_signals) allSignals.push({ type:'geo', data: liveSignals.geographic_signals });

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

  const raw = await _openai([{role:'system',content:sys},{role:'user',content:`Competitor: ${competitor}\n\nSignals:\n${signalsText||'No custom signals provided — use your knowledge of this company.'}`}]);
  let prediction = TEMPLATE;
  if (raw) { try { prediction = JSON.parse(raw); } catch {} }

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO war_room_analyses(tenant_id,competitor,signals,prediction,confidence) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at`,
    [tid, competitor, JSON.stringify(allSignals), JSON.stringify(prediction), prediction.confidence||0]
  );
  res.json({ ok:true, id:ins.rows[0].id, competitor, signals:allSignals, prediction, created_at:ins.rows[0].created_at });
});

router.get('/history', async (req, res) => {
  const tid = await _tid(req, 'wr:history'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT id,competitor,confidence,prediction,created_at FROM war_room_analyses WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]);
  res.json({ ok:true, runs: rows.rows });
});

module.exports = router;
