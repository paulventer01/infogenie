const express = require('express');
const fs = require('fs');
const path = require('path');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

// Reuse the same OpenAI integration the rest of the server uses (Replit-managed proxy + key).
const _openaiKey =
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  '';
const _openai = new OpenAI({
  apiKey: _openaiKey || 'dummy',
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});
function _openaiAvailable() {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (key && key !== 'dummy') return true;
  return !!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
}

function _normHost(u) {
  return String(u || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .trim()
    .toLowerCase();
}

function _loadDiagSnapshot() {
  try {
    const dir = path.join(__dirname, '../../data/diag-captures');
    const latestPath = path.join(dir, '_latest.json');
    let file = null;
    if (fs.existsSync(latestPath)) {
      const ptr = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
      file = ptr.file || null;
    }
    if (!file) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
      file = files.sort().pop() || null;
    }
    if (!file) return null;
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) return null;
    const blob = JSON.parse(fs.readFileSync(full, 'utf8'));
    return blob.analysisData || blob;
  } catch (_) {
    return null;
  }
}

function _findCompetitorInSnap(snap, competitor, domain) {
  const comps = Array.isArray(snap?.competitors) ? snap.competitors : [];
  const wantHost = _normHost(domain);
  const wantName = String(competitor || '').trim().toLowerCase();
  if (wantHost) {
    const byHost = comps.find(c => _normHost(c.domain || c.url || c.website) === wantHost);
    if (byHost) return byHost;
  }
  if (wantName) {
    const byName = comps.find(c => {
      const n = String(c.name || c.brand || '').trim().toLowerCase();
      return n === wantName || n.includes(wantName) || wantName.includes(n);
    });
    if (byName) return byName;
  }
  return null;
}

function _strList(arr, limit = 6) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(x => (typeof x === 'string' ? x : x?.headline || x?.body || x?.name || ''))
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * Build a battle card from analysis / diag-capture competitor intel when OpenAI
 * is unavailable. Prefers named campaigns, channels, suggestions, and ad copy
 * already present in the analysis — never invents fake metrics.
 */
function _groundedCard({ competitor, domain, brand, context }) {
  const snap = _loadDiagSnapshot();
  const c = _findCompetitorInSnap(snap, competitor, domain);
  const brandLabel = brand || snap?.brand || snap?.brand_name || snap?.url || 'your brand';
  const host = _normHost(domain || c?.domain || c?.url) || 'their site';
  const name = (c?.name || competitor || 'Competitor').trim();
  const why = String(c?.why || '').trim();
  const channel = c?.topChannel || (Array.isArray(c?.topChannels) && c.topChannels[0]) || null;
  const threat = c?.threatLevel || null;
  const roas = c?.roas != null ? String(c.roas) : null;
  const ctr = c?.ctr != null ? String(c.ctr) : null;
  const traffic = c?.traffic != null ? String(c.traffic) : null;
  const campaigns = Array.isArray(c?.campaigns) ? c.campaigns : [];
  const suggestions = _strList(c?.suggestions, 4);
  const adCopy = _strList(c?.adCopy, 3);
  const campNames = campaigns
    .map(x => x?.name)
    .filter(Boolean)
    .slice(0, 3);

  const summaryParts = [];
  summaryParts.push(
    why ||
      `${name} (${host}) is tracked as a direct competitor to ${brandLabel} in your latest analysis.`
  );
  if (channel || traffic || threat) {
    const bits = [];
    if (channel) bits.push(`primary paid channel ${channel}`);
    if (traffic) bits.push(`~${traffic} estimated traffic`);
    if (threat) bits.push(`${threat} threat level`);
    if (roas) bits.push(`benchmark ROAS ${roas}`);
    if (ctr) bits.push(`CTR ${ctr}`);
    if (bits.length) summaryParts.push(`Signals from your analysis: ${bits.join('; ')}.`);
  }
  if (context && String(context).trim()) {
    summaryParts.push(`Extra context noted: ${String(context).trim().slice(0, 280)}`);
  }
  const summary = summaryParts.join(' ').slice(0, 700);

  const positioning = why
    ? why.slice(0, 280)
    : `${name} competes for the same buyers as ${brandLabel}${channel ? ` with a ${channel}-led acquisition mix` : ''}.`;

  const strengths = [];
  if (channel) strengths.push(`Strong presence on ${channel}`);
  if (traffic) strengths.push(`Meaningful traffic scale (~${traffic})`);
  if (roas) strengths.push(`Competitive paid efficiency signal (ROAS ~${roas})`);
  if (campNames[0]) strengths.push(`Named motion: ${campNames[0]}${campNames[1] ? ` + ${campNames[1]}` : ''}`);
  if (adCopy[0]) strengths.push(`Message pattern in market: "${adCopy[0].slice(0, 90)}"`);
  if (threat === 'critical' || threat === 'high') strengths.push('High threat — already capturing category demand');
  while (strengths.length < 2) {
    strengths.push(strengths.length === 0
      ? `${name} is already in your competitive set for ${brandLabel}`
      : `Established domain presence at ${host}`);
  }

  const weaknesses = [];
  if (channel) weaknesses.push(`Over-indexes on ${channel} — flankable on adjacent channels`);
  if (campNames.some(n => /brand/i.test(n))) {
    weaknesses.push('Brand-search heavy mix leaves long-tail and comparison queries open');
  }
  if (suggestions[0]) weaknesses.push(`Exploit gap: ${suggestions[0].slice(0, 120)}`);
  if (suggestions[1]) weaknesses.push(suggestions[1].slice(0, 120));
  if (!weaknesses.length) {
    weaknesses.push(`Limited public differentiation vs ${brandLabel} outside paid search`);
    weaknesses.push('Comparison and switching intent is under-defended');
  }
  while (weaknesses.length < 2) weaknesses.push('Category buyers still shop alternatives — win on proof and speed');

  const recentMoves = [];
  campaigns.slice(0, 3).forEach((camp) => {
    if (!camp?.name) return;
    const bits = [camp.name];
    if (camp.channel) bits.push(`via ${camp.channel}`);
    if (camp.roas != null) bits.push(`ROAS ${camp.roas}`);
    if (camp.ctr != null) bits.push(`CTR ${camp.ctr}`);
    recentMoves.push(bits.join(' · ').slice(0, 140));
  });
  if (c?.dataNotes) recentMoves.push(String(c.dataNotes).slice(0, 140));
  if (!recentMoves.length) {
    recentMoves.push(
      channel
        ? `Active ${channel} acquisition against ${brandLabel}'s category`
        : `Competing for shared category demand with ${brandLabel}`
    );
  }

  const counterPlays = suggestions.length
    ? suggestions.slice(0, 4)
    : [
        `Launch ${brandLabel} vs ${name} comparison pages targeting mid-funnel queries`,
        `Bid on long-tail variants around ${name}'s brand and category terms`,
        channel
          ? `Diversify away from head-on ${channel} auctions into higher-intent niches`
          : `Attack with proof-led creative where ${name} leads on awareness`,
        `Mirror their strongest ad angles with clearer fee/speed/support claims`,
      ];
  while (counterPlays.length < 2) {
    counterPlays.push(`Use comparison content to capture buyers evaluating ${name}`);
  }

  return {
    summary,
    positioning,
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.slice(0, 4),
    recent_moves: recentMoves.slice(0, 3),
    counter_plays: counterPlays.slice(0, 4),
    _source: c ? 'analysis_grounded' : 'heuristic',
  };
}

function _groundedContext({ competitor, domain, brand }) {
  const snap = _loadDiagSnapshot();
  const c = _findCompetitorInSnap(snap, competitor, domain);
  const brandLabel = brand || snap?.url || 'your brand';
  if (!c) {
    return `${competitor} (${domain || 'unknown domain'}) vs ${brandLabel}. Use your analysis competitors list, paid channel mix, and any recent news when generating the card.`;
  }
  const parts = [];
  if (c.why) parts.push(c.why);
  const channel = c.topChannel || (Array.isArray(c.topChannels) && c.topChannels[0]);
  const bits = [];
  if (channel) bits.push(`top channel ${channel}`);
  if (c.roas != null) bits.push(`ROAS ${c.roas}`);
  if (c.ctr != null) bits.push(`CTR ${c.ctr}`);
  if (c.traffic != null) bits.push(`traffic ${c.traffic}`);
  if (c.threatLevel) bits.push(`threat ${c.threatLevel}`);
  if (bits.length) parts.push(`Analysis signals: ${bits.join('; ')}.`);
  const camps = (Array.isArray(c.campaigns) ? c.campaigns : [])
    .map(x => x?.name)
    .filter(Boolean)
    .slice(0, 3);
  if (camps.length) parts.push(`Observed campaigns: ${camps.join(', ')}.`);
  if (Array.isArray(c.suggestions) && c.suggestions[0]) {
    parts.push(`Suggested angle: ${String(c.suggestions[0]).slice(0, 160)}`);
  }
  return parts.join(' ').slice(0, 600);
}

function _normalizeCard(parsed) {
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
  return { summary, positioning, strengths, weaknesses, recentMoves, counterPlays, missing };
}

async function _openaiCard({ competitor, domain, brand, context }) {
  if (!_openaiAvailable()) return null;
  const groundedHint = _groundedContext({ competitor, domain, brand });
  const sys = `You are a B2B competitive intelligence analyst. Output strict JSON with this exact shape:
{"summary":"2-3 sentence overview","positioning":"how they position themselves in 1-2 sentences","strengths":["s1","s2","s3","s4"],"weaknesses":["w1","w2","w3","w4"],"recent_moves":["m1","m2","m3"],"counter_plays":["c1","c2","c3","c4"]}
Each list item is a single short line (max 140 chars). Counter_plays must be concrete actions ${brand || 'we'} can take to win against this competitor. Be specific and grounded — no fluff. Prefer facts from the provided analysis context over generic claims.`;
  const user = `Competitor: ${competitor}\nDomain: ${domain || 'unknown'}\nOur brand: ${brand || 'unspecified'}\nExtra context: ${context || 'none'}\nAnalysis grounding: ${groundedHint}\n\nWrite the battle card.`;
  try {
    const resp = await _openai.chat.completions.create({
      model: process.env.BATTLE_CARDS_MODEL || 'gpt-4o-mini',
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
    const tid = await _tenantCtx.resolveTenantId(req, { label:'battle_cards:list' });
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
    const tid = await _tenantCtx.resolveTenantId(req, { label:'battle_cards:get' });
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

  // Prefer grounded analysis context immediately when OpenAI is offline.
  const grounded = _groundedContext({ competitor, domain, brand });

  if (!_openaiAvailable()) {
    return res.json({ ok: true, context: grounded, source: 'analysis_grounded' });
  }
  const sys = `You are a B2B competitive intelligence analyst. Output strict JSON: {"context":"2-4 short sentences of grounded context about this competitor that would help write a battle card — pricing tier, target ICP, recent strategic moves, notable strengths or weaknesses. Be specific and factual. No fluff, no hedging."}. Maximum 600 characters.`;
  const user = `Competitor: ${competitor}\nDomain: ${domain || 'unknown'}\nOur brand: ${brand || 'unspecified'}\nAnalysis grounding: ${grounded}\n\nSuggest the extra context.`;
  try {
    const resp = await _openai.chat.completions.create({
      model: process.env.BATTLE_CARDS_MODEL || 'gpt-4o-mini',
      messages: [{ role:'system', content: sys }, { role:'user', content: user }],
      response_format: { type:'json_object' },
      temperature: 0.4, max_tokens: 400,
    });
    const txt = resp?.choices?.[0]?.message?.content;
    if (!txt) return res.json({ ok: true, context: grounded, source: 'analysis_grounded' });
    const parsed = JSON.parse(txt);
    if (!parsed.context) return res.json({ ok: true, context: grounded, source: 'analysis_grounded' });
    res.json({ ok: true, context: parsed.context, source: 'openai' });
  } catch (e) {
    console.error('[battle-cards] suggest-context error:', e.message);
    res.json({ ok: true, context: grounded, source: 'analysis_grounded' });
  }
});

router.post('/generate', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const competitor = String(req.body?.competitor || '').trim().slice(0, 120);
  if (!competitor) return _err(res, 400, 'competitor required');
  const domain = req.body?.domain ? String(req.body.domain).slice(0, 200) : null;
  const brand = req.body?.brand ? String(req.body.brand).slice(0, 80) : null;
  const context = req.body?.context ? String(req.body.context).slice(0, 2000) : null;
  try {
    let parsed = await _openaiCard({ competitor, domain, brand, context });
    let source = 'openai';
    if (!parsed) {
      parsed = _groundedCard({ competitor, domain, brand, context });
      source = parsed._source || 'analysis_grounded';
      delete parsed._source;
    }

    const { summary, positioning, strengths, weaknesses, recentMoves, counterPlays, missing } =
      _normalizeCard(parsed);
    if (missing.length) {
      return _err(res, 502, 'Could not build a complete battle card (missing: ' + missing.join(', ') + '). Add Extra context or pick a competitor from your analysis, then try again.');
    }

    const tid = await _tenantCtx.resolveTenantId(req, { label:'battle_cards:generate' });
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
    const tid = await _tenantCtx.resolveTenantId(req, { label:'battle_cards:delete' });
    const r = await _db.getPool().query(`DELETE FROM battle_cards WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    res.json({ ok:true, deleted: r.rowCount });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
