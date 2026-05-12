const express = require('express');
const _db = require('../../db');
const _https = require('https');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

async function _openaiCard({ competitor, domain, brand, context }) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sys = `You are a B2B competitive intelligence analyst. Output strict JSON with this exact shape:
{"summary":"2-3 sentence overview","positioning":"how they position themselves in 1-2 sentences","strengths":["s1","s2","s3","s4"],"weaknesses":["w1","w2","w3","w4"],"recent_moves":["m1","m2","m3"],"counter_plays":["c1","c2","c3","c4"]}
Each list item is a single short line (max 140 chars). Counter_plays must be concrete actions ${brand || 'we'} can take to win against this competitor. Be specific and grounded — no fluff.`;
  const user = `Competitor: ${competitor}\nDomain: ${domain || 'unknown'}\nOur brand: ${brand || 'unspecified'}\nExtra context: ${context || 'none'}\n\nWrite the battle card.`;
  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role:'system', content: sys }, { role:'user', content: user }],
    response_format: { type:'json_object' },
    temperature: 0.4, max_tokens: 900,
  });
  return await new Promise((resolve, reject) => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
      try {
        if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d);
        const parsed = JSON.parse(j.choices[0].message.content);
        resolve(parsed);
      } catch { resolve(null); }
    }); });
    req.on('error', reject);
    req.setTimeout(35000, () => req.destroy(new Error('timeout')));
    req.write(body); req.end();
  }).catch(()=>null);
}

router.get('/', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const brand = req.query.brand ? String(req.query.brand).slice(0, 80) : null;
    const params = []; let where = '';
    if (brand) { params.push(brand); where = 'WHERE brand=$1'; }
    const r = await _db.getPool().query(`SELECT * FROM battle_cards ${where} ORDER BY generated_at DESC LIMIT 200`, params);
    res.json({ ok:true, cards: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id); if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try { const r = await _db.getPool().query(`SELECT * FROM battle_cards WHERE id=$1`, [id]);
    if (!r.rows[0]) return _err(res, 404, 'not found'); res.json({ ok:true, card: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/generate', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const competitor = String(req.body?.competitor || '').trim().slice(0, 120);
  if (!competitor) return _err(res, 400, 'competitor required');
  const domain = req.body?.domain ? String(req.body.domain).slice(0, 200) : null;
  const brand = req.body?.brand ? String(req.body.brand).slice(0, 80) : null;
  const context = req.body?.context ? String(req.body.context).slice(0, 2000) : null;
  try {
    const parsed = await _openaiCard({ competitor, domain, brand, context });
    if (!parsed) return _err(res, 502, 'AI generation unavailable — OpenAI key missing or call failed. No placeholder data will be saved. Try again or check your OpenAI integration.');
    const source = 'openai';
    const r = await _db.getPool().query(`
      INSERT INTO battle_cards (competitor, domain, brand, summary, positioning, strengths, weaknesses, recent_moves, counter_plays, generated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (competitor, brand) DO UPDATE SET
        domain=EXCLUDED.domain, summary=EXCLUDED.summary, positioning=EXCLUDED.positioning,
        strengths=EXCLUDED.strengths, weaknesses=EXCLUDED.weaknesses, recent_moves=EXCLUDED.recent_moves,
        counter_plays=EXCLUDED.counter_plays, generated_by=EXCLUDED.generated_by, generated_at=now()
      RETURNING *`,
      [competitor, domain, brand, parsed.summary || '', parsed.positioning || '',
       JSON.stringify(parsed.strengths || []), JSON.stringify(parsed.weaknesses || []),
       JSON.stringify(parsed.recent_moves || []), JSON.stringify(parsed.counter_plays || []), source]);
    res.json({ ok:true, source, card: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id); if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try { await _db.getPool().query(`DELETE FROM battle_cards WHERE id=$1`, [id]); res.json({ ok:true }); }
  catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
