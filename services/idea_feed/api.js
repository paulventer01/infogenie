const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const ANGLES = [
  'Mythbuster', 'Before & After', 'Us vs Them', 'Problem-Solution',
  'Statistics', 'Negative Hook', 'What\'s Inside', 'Top Reasons',
  'FAQ', 'Testimonial Story', 'Best-seller Spotlight', 'Behind the Scenes',
  'Media Feature', 'Customer Mistake', 'Quick Win Tip', 'Trend Reaction',
  'Founder Story', 'Product Demo', 'Social Proof', 'Limited Offer',
];

const CHANNELS = ['instagram','tiktok','linkedin','x','facebook','youtube','blog','email'];

// ── AI idea generation ─────────────────────────────────────────────────────
async function _generateIdeas(brandCtx, brand, count = 20) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;

  const angleList = ANGLES.join(', ');
  const today = new Date().toISOString().slice(0, 10);

  const body = JSON.stringify({
    model: 'gpt-5-mini',
    messages: [
      { role: 'system', content: `${brandCtx ? brandCtx + '\n\n' : ''}You are a senior social media strategist. Generate ${count} fresh content ideas for ${brand || 'the brand'}. Use a variety of content angles from this list: ${angleList}. Return strict JSON:
{"ideas":[{"angle":"<one of the angles above>","headline":"<scroll-stopping headline, max 10 words>","copy":"<full post copy, 40-80 words, immediately usable, no placeholders>","channel":"<one of: instagram|tiktok|linkedin|x|facebook|youtube|blog|email>","hashtags":["#tag1","#tag2","#tag3"],"cta":"<clear call-to-action>","visual_concept":"<1-sentence image/video direction>"}]}
Rules: Be specific to the brand. Vary channels. Each idea must be immediately usable. No generic filler. Today: ${today}.` },
      { role: 'user', content: `Generate ${count} content ideas for ${brand || 'the brand'} now.` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.85,
    max_tokens: 4000,
  });

  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          resolve(JSON.parse(JSON.parse(d).choices[0].message.content));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(90000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── Template fallback ──────────────────────────────────────────────────────
function _templateIdeas(brand, count = 20) {
  const ideas = [];
  for (let i = 0; i < count; i++) {
    const angle = ANGLES[i % ANGLES.length];
    const channel = CHANNELS[i % CHANNELS.length];
    ideas.push({
      angle,
      headline: `${angle}: What ${brand || 'we'} discovered`,
      copy: `Here's something most people get wrong about ${brand || 'our industry'}. The truth? [Share your insight here]. Drop a comment if this resonates.`,
      channel,
      hashtags: [`#${(brand || 'brand').replace(/\s+/g, '')}`, '#marketing', '#content'],
      cta: 'Share your thoughts below →',
      visual_concept: `Clean branded graphic with bold headline text over a ${i % 2 === 0 ? 'light' : 'dark'} background.`,
    });
  }
  return { ideas };
}

// ── Routes ────────────────────────────────────────────────────────────────

// GET /ideas  — returns today's batch (generates if not yet created today)
router.get('/ideas', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'idea_feed:ideas' });
  const brand = String(req.query?.brand || '').slice(0, 80);
  const force = req.query?.force === '1';

  if (!_db.hasDb()) {
    const fallback = _templateIdeas(brand);
    return res.json({ ok:true, ideas: fallback.ideas.map((it, i) => ({ id: i+1, ...it, status:'pending' })), source:'template' });
  }

  const today = new Date().toISOString().slice(0,10);

  if (!force) {
    try {
      const existing = await _db.getPool().query(
        `SELECT * FROM idea_feed_items WHERE tenant_id=$1 AND batch_date=$2 AND status='pending' ORDER BY id LIMIT 25`,
        [tid, today]);
      if (existing.rows.length >= 5) {
        return res.json({ ok:true, ideas: existing.rows, source:'cached' });
      }
    } catch {}
  }

  let brandCtx = '';
  try { const bf = require('../brand_foundation/api'); if (bf.getBrandContextBlock) brandCtx = await bf.getBrandContextBlock(tid); } catch {}

  let result = await _generateIdeas(brandCtx, brand, 20);
  let source = 'openai';
  if (!result?.ideas?.length) { result = _templateIdeas(brand, 20); source = 'template'; }

  const inserted = [];
  try {
    await _db.getPool().query(
      `DELETE FROM idea_feed_items WHERE tenant_id=$1 AND batch_date=$2 AND status='pending'`, [tid, today]);
    for (const idea of result.ideas.slice(0, 20)) {
      const r = await _db.getPool().query(
        `INSERT INTO idea_feed_items (tenant_id, angle, headline, copy, channel, hashtags, cta, visual_concept, status, batch_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9) RETURNING *`,
        [tid, idea.angle||'', idea.headline||'', idea.copy||'', idea.channel||'instagram',
         JSON.stringify(Array.isArray(idea.hashtags) ? idea.hashtags : []),
         idea.cta||'', idea.visual_concept||'', today]);
      inserted.push(r.rows[0]);
    }
  } catch (e) {
    console.warn('[idea-feed] persist failed:', e.message);
    return res.json({ ok:true, ideas: result.ideas.map((it, i) => ({ id: i+1, ...it, status:'pending' })), source });
  }

  res.json({ ok:true, ideas: inserted, source });
});

// POST /save/:id  — save idea (add to calendar optionally)
router.post('/save/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'idea_feed:save' });
  if (!_db.hasDb()) return res.json({ ok:true });
  try {
    await _db.getPool().query(
      `UPDATE idea_feed_items SET status='saved' WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    res.json({ ok:true });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /dismiss/:id
router.post('/dismiss/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'idea_feed:dismiss' });
  if (!_db.hasDb()) return res.json({ ok:true });
  try {
    await _db.getPool().query(
      `UPDATE idea_feed_items SET status='dismissed' WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    res.json({ ok:true });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /saved — saved ideas
router.get('/saved', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'idea_feed:saved' });
  if (!_db.hasDb()) return res.json({ ok:true, ideas:[] });
  try {
    const r = await _db.getPool().query(
      `SELECT * FROM idea_feed_items WHERE tenant_id=$1 AND status='saved' ORDER BY created_at DESC LIMIT 50`, [tid]);
    res.json({ ok:true, ideas: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /angles — static angles library with descriptions
router.get('/angles', (req, res) => {
  const library = [
    { angle:'Mythbuster', icon:'💥', desc:'Bust a common misconception in your niche', example:'Why [popular belief] is actually holding you back' },
    { angle:'Before & After', icon:'🔄', desc:'Show transformation — before using you vs after', example:'Before: [painful state]. After: [dream outcome].' },
    { angle:'Us vs Them', icon:'⚔️', desc:'Compare your approach to the old/competitor way', example:'Old way vs our way — here\'s the difference' },
    { angle:'Problem-Solution', icon:'🔧', desc:'State a pain point then position your solution', example:'Struggling with [X]? Here\'s what actually works.' },
    { angle:'Statistics', icon:'📊', desc:'Share a surprising data point from your industry', example:'[X]% of [audience] don\'t know this stat…' },
    { angle:'Negative Hook', icon:'🚫', desc:'Lead with what NOT to do — pattern interrupt', example:'Stop doing [common thing]. It\'s costing you [X].' },
    { angle:'What\'s Inside', icon:'📦', desc:'Reveal what\'s behind the scenes or in the box', example:'What\'s inside our [product/process]? A look inside.' },
    { angle:'Top Reasons', icon:'🏆', desc:'List-format — top reasons, mistakes, or tips', example:'5 reasons your [X] isn\'t working (and the fix)' },
    { angle:'FAQ', icon:'❓', desc:'Answer the question your customers always ask', example:'The #1 question we get asked every week: [question]' },
    { angle:'Testimonial Story', icon:'⭐', desc:'Tell a real customer success story with specifics', example:'[Name] was [pain]. 30 days later: [outcome].' },
    { angle:'Best-seller Spotlight', icon:'🔦', desc:'Shine a light on your most popular product/service', example:'Why [product] is our best-seller (it\'s not what you think)' },
    { angle:'Behind the Scenes', icon:'🎬', desc:'Show your process, team, or how things are made', example:'What actually goes into making [product/result]' },
    { angle:'Media Feature', icon:'📰', desc:'Share press mentions or third-party validation', example:'[Publication] said this about [brand]. We\'re humbled.' },
    { angle:'Customer Mistake', icon:'🤦', desc:'Highlight a mistake customers make (without being preachy)', example:'The mistake 9/10 of our customers made before finding us' },
    { angle:'Quick Win Tip', icon:'⚡', desc:'Give instant actionable value in one post', example:'Try this for 5 minutes today. You\'ll thank us.' },
    { angle:'Trend Reaction', icon:'📈', desc:'Comment on a current trend in your industry', example:'Everyone\'s talking about [trend]. Here\'s our honest take.' },
    { angle:'Founder Story', icon:'👤', desc:'Share the why behind the company or a decision', example:'The day I almost gave up on [brand] — what stopped me' },
    { angle:'Product Demo', icon:'🎥', desc:'Show the product in action solving a real problem', example:'Watch [product] solve [specific problem] in 60 seconds' },
    { angle:'Social Proof', icon:'💬', desc:'Stack reviews, results, or community wins', example:'[X] customers. [Y] results. Here\'s what they\'re saying.' },
    { angle:'Limited Offer', icon:'⏰', desc:'Create urgency around an offer or deadline', example:'Last [X] hours to get [offer]. Here\'s why it matters.' },
  ];
  res.json({ ok:true, angles: library });
});

module.exports = router;
