const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

// Reuse the same OpenAI integration the rest of the server uses (Replit-managed proxy + key).
const _openai = new OpenAI({
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY || 'dummy',
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
function _openaiAvailable() {
  return !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_API_KEY);
}

async function _openaiCard({ competitor, domain, brand, context }) {
  if (!_openaiAvailable()) return null;
  const sys = `You are a B2B competitive intelligence analyst. Output strict JSON with this exact shape:
{"summary":"2-3 sentence overview","positioning":"how they position themselves in 1-2 sentences","strengths":["s1","s2","s3","s4"],"weaknesses":["w1","w2","w3","w4"],"recent_moves":["m1","m2","m3"],"counter_plays":["c1","c2","c3","c4"]}
Each list item is a single short line (max 140 chars). Counter_plays must be concrete actions ${brand || 'we'} can take to win against this competitor. Be specific and grounded — no fluff.`;
  const user = `Competitor: ${competitor}\nDomain: ${domain || 'unknown'}\nOur brand: ${brand || 'unspecified'}\nExtra context: ${context || 'none'}\n\nWrite the battle card.`;
  try {
    const resp = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role:'system', content: sys }, { role:'user', content: user }],
      response_format: { type:'json_object' },
      temperature: 0.4, max_tokens: 900,
    });
    const txt = resp?.choices?.[0]?.message?.content;
    if (!txt) return null;
    return JSON.parse(txt);
  } catch (e) {
    console.error('[battle-cards] openai error:', e.message);
    return null;
  }
}

router.get('/', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'battle_cards:list', allowFallback:true });
    const brand = req.query.brand ? String(req.query.brand).slice(0, 80) : null;
    const params = [tid]; let where = 'WHERE tenant_id=$1';
    if (brand) { params.push(brand); where += ' AND brand=$2'; }
    const r = await _db.getPool().query(`SELECT * FROM battle_cards ${where} ORDER BY generated_at DESC LIMIT 200`, params);
    res.json({ ok:true, cards: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id); if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'battle_cards:get', allowFallback:true });
    const r = await _db.getPool().query(`SELECT * FROM battle_cards WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found'); res.json({ ok:true, card: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

// AI-suggest extra context for a battle card based on competitor + domain + brand.
// Returns 2-4 short sentences of grounded intel hints (positioning, ICP, pricing tier, recent moves).
router.post('/suggest-context', async (req, res) => {
  const competitor = String(req.body?.competitor || '').trim().slice(0, 120);
  if (!competitor) return _err(res, 400, 'competitor required');
  const domain = req.body?.domain ? String(req.body.domain).slice(0, 200) : '';
  const brand = req.body?.brand ? String(req.body.brand).slice(0, 80) : '';
  if (!_openaiAvailable()) return _err(res, 503, 'OpenAI integration not configured — cannot generate context.');
  const sys = `You are a B2B competitive intelligence analyst. Output strict JSON: {"context":"2-4 short sentences of grounded context about this competitor that would help write a battle card — pricing tier, target ICP, recent strategic moves, notable strengths or weaknesses. Be specific and factual. No fluff, no hedging."}. Maximum 600 characters.`;
  const user = `Competitor: ${competitor}\nDomain: ${domain || 'unknown'}\nOur brand: ${brand || 'unspecified'}\n\nSuggest the extra context.`;
  try {
    const resp = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role:'system', content: sys }, { role:'user', content: user }],
      response_format: { type:'json_object' },
      temperature: 0.4, max_tokens: 400,
    });
    const txt = resp?.choices?.[0]?.message?.content;
    if (!txt) return _err(res, 502, 'AI returned empty response — try again.');
    const parsed = JSON.parse(txt);
    if (!parsed.context) return _err(res, 502, 'AI returned empty context — try again.');
    res.json({ ok: true, context: parsed.context });
  } catch (e) { console.error('[battle-cards] suggest-context error:', e.message); _err(res, 502, 'AI suggest failed: ' + e.message); }
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

    // STRICT validation — no placeholder/empty cards may be persisted.
    const summary     = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const positioning = typeof parsed.positioning === 'string' ? parsed.positioning.trim() : '';
    const strengths    = Array.isArray(parsed.strengths)    ? parsed.strengths.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
    const weaknesses   = Array.isArray(parsed.weaknesses)   ? parsed.weaknesses.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
    const recentMoves  = Array.isArray(parsed.recent_moves) ? parsed.recent_moves.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
    const counterPlays = Array.isArray(parsed.counter_plays)? parsed.counter_plays.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
    const missing = [];
    if (summary.length     < 20) missing.push('summary');
    if (positioning.length < 10) missing.push('positioning');
    if (strengths.length    < 2) missing.push('strengths');
    if (weaknesses.length   < 2) missing.push('weaknesses');
    if (recentMoves.length  < 1) missing.push('recent_moves');
    if (counterPlays.length < 2) missing.push('counter_plays');
    if (missing.length) {
      return _err(res, 502, 'AI returned an incomplete card (missing: ' + missing.join(', ') + '). Nothing was saved. Try again or add Extra context for better grounding.');
    }

    const source = 'openai';
    const tid = await _tenantCtx.resolveTenantId(req, { label:'battle_cards:generate', allowFallback:true });
    if (!tid) return _err(res, 400, 'no_tenant');
    const r = await _db.getPool().query(`
      INSERT INTO battle_cards (tenant_id, competitor, domain, brand, summary, positioning, strengths, weaknesses, recent_moves, counter_plays, generated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (tenant_id, competitor, brand) DO UPDATE SET
        domain=EXCLUDED.domain, summary=EXCLUDED.summary, positioning=EXCLUDED.positioning,
        strengths=EXCLUDED.strengths, weaknesses=EXCLUDED.weaknesses, recent_moves=EXCLUDED.recent_moves,
        counter_plays=EXCLUDED.counter_plays, generated_by=EXCLUDED.generated_by, generated_at=now()
      RETURNING *`,
      [tid, competitor, domain, brand, summary, positioning,
       JSON.stringify(strengths), JSON.stringify(weaknesses),
       JSON.stringify(recentMoves), JSON.stringify(counterPlays), source]);
    res.json({ ok:true, source, card: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id); if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'battle_cards:delete', allowFallback:true });
    const r = await _db.getPool().query(`DELETE FROM battle_cards WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    res.json({ ok:true, deleted: r.rowCount });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
