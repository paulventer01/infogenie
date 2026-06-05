const express  = require('express');
const _https   = require('https');
const _db      = require('../../db');
const _tenantCtx = require('../tenants/context');
const PptxGenJS  = require('pptxgenjs');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

const GOALS = ['investor','sales','marketing','product','internal'];

// ── AI slide generation ───────────────────────────────────────────────────
async function _generateSlides(params) {
  const { brand, product, audience, goal, num_slides, extra } = params;
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;

  const goalDescriptions = {
    investor:  'a 12-slide investor pitch deck to raise funding',
    sales:     'a 10-slide sales deck to close enterprise customers',
    marketing: 'a 10-slide marketing/brand story deck',
    product:   'a 10-slide product demo / launch deck',
    internal:  'a 10-slide internal strategy / OKR deck',
  };

  const system = `You are a world-class pitch deck designer and strategist. Create ${goalDescriptions[goal] || 'a professional pitch deck'} for ${brand || 'this company'}.

Return ONLY strict JSON:
{
  "deck_title": "<compelling deck title>",
  "tagline": "<one-line powerful tagline>",
  "slides": [
    {
      "type": "title|problem|solution|market|product|how_it_works|traction|business_model|team|roadmap|cta|custom",
      "headline": "<slide headline (max 8 words)>",
      "subheadline": "<optional subtitle or context line>",
      "bullets": ["<point 1>", "<point 2>", "<point 3>"],
      "stat": "<optional big number/metric e.g. $4.2B TAM>",
      "stat_label": "<label for the stat>",
      "speaker_notes": "<2-3 sentences the presenter should say>",
      "visual_direction": "<what image/graphic would be ideal here>",
      "accent_color": "<optional hex e.g. #6366F1>"
    }
  ]
}

Rules:
- Exactly ${num_slides || 12} slides.
- Slide types must flow logically: title → problem → solution → market → product → how_it_works → traction → business_model → team → roadmap → cta. Add/remove as needed.
- Every slide must have a headline. Bullets are optional (2-4 per slide max). Speaker notes are required on every slide.
- Be specific to the brand/product — no generic filler.
- Bullets must be punchy, specific, and immediately credible. Never say "world-class" or "revolutionary".`;

  const user = `Brand: ${brand || '(startup)'}
Product/Service: ${product || '(not specified)'}
Target audience: ${audience || 'B2B buyers'}
Deck goal: ${goal}
${extra ? `Additional context: ${extra}` : ''}

Build the full ${num_slides || 12}-slide deck now.`;

  const body = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 6000,
  });

  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          if (r.statusCode !== 200) { console.warn('[pitch-deck] AI error', r.statusCode); return resolve(null); }
          resolve(JSON.parse(JSON.parse(d).choices[0].message.content));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(90000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── Template fallback ─────────────────────────────────────────────────────
function _templateSlides(brand, product, goal, n) {
  const templates = {
    investor: [
      { type:'title', headline: brand || 'Your Company', subheadline: product || 'The future of your industry', bullets:[], speaker_notes:`Welcome everyone. Today I'll walk you through why ${brand} is an unmissable opportunity.` },
      { type:'problem', headline:'The Problem', bullets:['Market is fragmented across outdated tools','Customers waste hours on manual processes','Existing solutions cost 10× too much'], speaker_notes:'The core pain is real and growing. We see it in every customer conversation.' },
      { type:'solution', headline:'Our Solution', subheadline: product || 'One platform. Every answer.', bullets:['AI-powered automation','5-minute setup, zero learning curve','Costs 80% less than the alternative'], speaker_notes:'We built the thing we always wished existed.' },
      { type:'market', headline:'$4.2B Market', stat:'$4.2B', stat_label:'Total Addressable Market (2026)', bullets:['18% YoY growth','42,000 potential customers in target segment'], speaker_notes:'The market is large and accelerating — we only need 2% to build a $100M business.' },
      { type:'product', headline:'The Product', bullets:['Dashboard shows everything in one view','AI runs in the background, surfacing insights','One-click integrations with 50+ tools'], speaker_notes:'Let me show you what a user sees on day one.' },
      { type:'how_it_works', headline:'How It Works', bullets:['Step 1: Connect your existing tools','Step 2: AI learns your business in 24h','Step 3: Insights + actions delivered daily'], speaker_notes:'Onboarding takes 5 minutes. Most customers see value within 48 hours.' },
      { type:'traction', headline:'Traction', stat:'$280K', stat_label:'ARR · 140% MoM growth', bullets:['32 paying customers in 6 months','NPS score: 72','3 enterprise pilots live'], speaker_notes:'We went from zero to $280K ARR without spending a dollar on paid ads.' },
      { type:'business_model', headline:'Business Model', bullets:['SaaS: $299/mo per seat','Enterprise: Custom annual contracts from $18K','Services margin: 82%'], speaker_notes:'Simple, predictable, high-margin SaaS. No complicated pricing tiers.' },
      { type:'team', headline:'The Team', bullets:['CEO: 10 years in the space, 1 previous exit','CTO: Ex-Google, built systems at scale','Head of Growth: Grew previous company 0→$5M ARR'], speaker_notes:'We have domain expertise, technical depth, and go-to-market experience.' },
      { type:'roadmap', headline:'Roadmap', bullets:['Q2: Mobile app + API launch','Q3: Enterprise SSO + compliance','Q4: International expansion (EU/APAC)'], speaker_notes:"We're not building features for the sake of it — every item on this roadmap is customer-requested." },
      { type:'cta', headline:'Join Us', subheadline:'Raising $2M to 10× in 18 months', stat:'$2M', stat_label:'Seed Round · $1.4M committed', bullets:['Closing June 30th','2 spots remaining'], speaker_notes:"We'd love to have you on this journey. Let's talk about how you can be part of it." },
    ],
  };
  const base = templates[goal] || templates.investor;
  return { deck_title: brand || 'Pitch Deck', tagline: product || 'Built for what comes next', slides: base.slice(0, n) };
}

// ── PPTX builder ──────────────────────────────────────────────────────────
function _buildPptx(deck, brand_color) {
  const PRIMARY = (brand_color || '#1E1B4B').replace('#','');
  const ACCENT  = '6366F1';
  const WHITE   = 'FFFFFF';
  const LIGHT   = 'F8FAFC';
  const MUTED   = '94A3B8';

  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5
  pres.title = deck.deck_title || 'Pitch Deck';

  for (let idx = 0; idx < deck.slides.length; idx++) {
    const slide = deck.slides[idx];
    const s = pres.addSlide();

    const isTitle = slide.type === 'title';
    const bg = isTitle ? PRIMARY : (idx % 2 === 0 ? 'FFFFFF' : LIGHT);
    s.background = { color: bg };

    // Slide number (non-title)
    if (!isTitle) {
      s.addText(String(idx + 1), {
        x: 12.6, y: 7.0, w: 0.6, h: 0.4, fontSize: 9, color: MUTED, align: 'right',
      });
      // Left accent bar
      s.addShape(pres.ShapeType.rect, {
        x: 0, y: 0, w: 0.06, h: 7.5, fill: { color: ACCENT }, line: { color: ACCENT },
      });
    }

    if (isTitle) {
      // Title slide
      s.addText(deck.deck_title || slide.headline, {
        x: 0.8, y: 1.8, w: 11.7, h: 1.4, fontSize: 48, bold: true, color: WHITE, fontFace: 'Calibri',
      });
      if (deck.tagline || slide.subheadline) {
        s.addText(deck.tagline || slide.subheadline, {
          x: 0.8, y: 3.3, w: 11, h: 0.8, fontSize: 22, color: 'C7D2FE', fontFace: 'Calibri',
        });
      }
      if (slide.subheadline && deck.tagline) {
        s.addText(slide.subheadline, {
          x: 0.8, y: 4.2, w: 11, h: 0.5, fontSize: 16, color: 'A5B4FC',
        });
      }
      s.addText('Powered by InfoGenie', {
        x: 0.8, y: 6.9, w: 12, h: 0.4, fontSize: 11, color: '6366F1', italic: true,
      });
    } else {
      // Content slide header
      s.addText(slide.headline || '', {
        x: 0.4, y: 0.28, w: 10, h: 0.65, fontSize: 26, bold: true, color: '1E293B', fontFace: 'Calibri',
      });
      if (slide.subheadline) {
        s.addText(slide.subheadline, {
          x: 0.4, y: 0.95, w: 10, h: 0.45, fontSize: 15, color: '64748B', italic: true,
        });
      }

      // Big stat
      if (slide.stat) {
        const hasRightContent = (slide.bullets?.length || slide.visual_direction);
        const statX = hasRightContent ? 8.5 : 4.0;
        s.addText(slide.stat, {
          x: statX, y: 1.6, w: 4.5, h: 1.8, fontSize: 60, bold: true, color: ACCENT, align: 'center',
        });
        if (slide.stat_label) {
          s.addText(slide.stat_label, {
            x: statX, y: 3.4, w: 4.5, h: 0.5, fontSize: 12, color: MUTED, align: 'center',
          });
        }
      }

      // Bullets
      if (slide.bullets?.length) {
        const bulletY = slide.subheadline ? 1.5 : 1.2;
        slide.bullets.slice(0, 5).forEach((b, i) => {
          s.addShape(pres.ShapeType.rect, {
            x: 0.4, y: bulletY + i * 0.95, w: 0.12, h: 0.12,
            fill: { color: ACCENT }, line: { color: ACCENT },
          });
          s.addText(String(b), {
            x: 0.65, y: bulletY + i * 0.95 - 0.05, w: slide.stat ? 7.5 : 12, h: 0.8,
            fontSize: 16, color: '334155', valign: 'top', fontFace: 'Calibri',
          });
        });
      }

      // Visual direction note (subtle, bottom right)
      if (slide.visual_direction) {
        s.addShape(pres.ShapeType.roundRect, {
          x: 8.6, y: 1.5, w: 4.5, h: 4.5,
          fill: { color: 'EEF2FF' }, line: { color: 'C7D2FE', pt: 1 },
          rectRadius: 0.1,
        });
        s.addText('🎨 Visual\n' + slide.visual_direction, {
          x: 8.7, y: 1.6, w: 4.3, h: 4.3, fontSize: 11, color: '64748B',
          italic: true, valign: 'middle', align: 'center',
        });
      }

      // Speaker notes
      if (slide.speaker_notes) {
        s.addNotes(slide.speaker_notes);
      }
    }
  }

  return pres;
}

// ── Routes ────────────────────────────────────────────────────────────────

// POST /generate — generate slides JSON + persist
router.post('/generate', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'pitch_deck:generate' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const brand      = String(req.body?.brand   || '').slice(0, 100);
  const product    = String(req.body?.product || '').slice(0, 400);
  const audience   = String(req.body?.audience|| '').slice(0, 200);
  const extra      = String(req.body?.extra   || '').slice(0, 500);
  const goal       = GOALS.includes(req.body?.goal) ? req.body.goal : 'investor';
  const num_slides = Math.min(20, Math.max(6, parseInt(req.body?.num_slides, 10) || 12));

  if (!brand && !product) return _err(res, 400, 'brand or product required');

  let result = await _generateSlides({ brand, product, audience, goal, num_slides, extra });
  let source = 'openai';
  if (!result?.slides?.length) {
    result = _templateSlides(brand, product, goal, num_slides);
    source = 'template';
  }

  let id = null;
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `INSERT INTO pitch_decks (tenant_id, deck_title, goal, brand, product, audience, slide_count, slides, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tid, result.deck_title || brand, goal, brand, product, audience, result.slides.length, JSON.stringify(result.slides), source]);
      id = r.rows[0].id;
    } catch (e) { console.warn('[pitch-deck] persist failed:', e.message); }
  }

  res.json({ ok: true, id, deck_title: result.deck_title, tagline: result.tagline, slides: result.slides, source });
});

// POST /export-pptx — stream PPTX from a saved deck
router.post('/export-pptx', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'pitch_deck:export' });
  const id = parseInt(req.body?.id, 10);
  const brand_color = String(req.body?.brand_color || '#1E1B4B').slice(0, 10);

  let deck;
  if (id && _db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `SELECT * FROM pitch_decks WHERE id=$1 AND tenant_id=$2`, [id, tid]);
      if (r.rows[0]) deck = r.rows[0];
    } catch {}
  }

  // Also accept inline slides
  if (!deck && req.body?.slides) {
    deck = {
      deck_title: req.body.deck_title || 'Pitch Deck',
      tagline: req.body.tagline || '',
      slides: Array.isArray(req.body.slides) ? req.body.slides : [],
    };
  }

  if (!deck) return _err(res, 404, 'deck not found');

  const slides = Array.isArray(deck.slides) ? deck.slides : JSON.parse(deck.slides || '[]');
  const pres = _buildPptx({ deck_title: deck.deck_title, tagline: deck.tagline, slides }, brand_color);

  const fileName = `pitch-deck-${(deck.deck_title||'deck').replace(/[^a-z0-9]/gi,'_').toLowerCase()}.pptx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  const buf = await pres.write({ outputType: 'nodebuffer' });
  res.end(buf);
});

// POST /from-storyboard — convert video storyboard frames → pitch deck
router.post('/from-storyboard', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'pitch_deck:from-storyboard' });
  const frames = Array.isArray(req.body?.frames) ? req.body.frames : [];
  const brand  = String(req.body?.brand || '').slice(0, 80);
  const brand_color = String(req.body?.brand_color || '#1E1B4B').slice(0, 10);
  if (!frames.length) return _err(res, 400, 'frames required');

  const slides = frames.slice(0, 18).map((f, i) => ({
    type: i === 0 ? 'title' : 'custom',
    headline: f.title || f.heading || `Scene ${i + 1}`,
    subheadline: f.subtitle || '',
    bullets: f.voiceover ? [f.voiceover.slice(0, 120)] : (Array.isArray(f.bullets) ? f.bullets : []),
    speaker_notes: f.voiceover || f.narration || '',
    visual_direction: f.visual || f.scene || f.description || '',
  }));

  const deck = { deck_title: brand || 'Pitch Deck', tagline: '', slides };
  const pres = _buildPptx(deck, brand_color);
  const fileName = `storyboard-deck-${Date.now()}.pptx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  const buf = await pres.write({ outputType: 'nodebuffer' });
  res.end(buf);
});

// GET /history
router.get('/history', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'pitch_deck:history' });
  if (!_db.hasDb()) return res.json({ ok: true, decks: [] });
  try {
    const r = await _db.getPool().query(
      `SELECT id, deck_title, goal, brand, slide_count, source, created_at
       FROM pitch_decks WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]);
    res.json({ ok: true, decks: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'pitch_deck:get' });
  if (!_db.hasDb() || !id) return _err(res, 404, 'not found');
  try {
    const r = await _db.getPool().query(
      `SELECT * FROM pitch_decks WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok: true, deck: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
