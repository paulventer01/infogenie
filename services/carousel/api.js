// T38 — Carousel Generator API
//
// Hook → Context → Value → Action framework with 4 proven structures
// (Pure Info / Storytelling / Problem-Solution / Listicle).
// Outputs 10 slides of paste-ready copy + suggested visual.

const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

const STRUCTURES = {
  'pure-info': {
    label: 'Pure Info',
    description: 'Straight value, no fluff, just results.',
    template: [
      { role: 'Hook',    note: 'Bold statement / contrarian take / shocking stat' },
      { role: 'Context', note: 'Why this matters right now' },
      { role: 'Value',   note: 'Key point #1' },
      { role: 'Value',   note: 'Key point #2' },
      { role: 'Value',   note: 'Key point #3' },
      { role: 'Value',   note: 'Key point #4' },
      { role: 'Value',   note: 'Key point #5' },
      { role: 'Recap',   note: 'TL;DR of all points' },
      { role: 'Climax',  note: 'The single biggest insight' },
      { role: 'CTA',     note: 'Comment / DM / Save / Share' },
    ],
  },
  'storytelling': {
    label: 'Storytelling',
    description: 'Take them on a journey. End with the lesson.',
    template: [
      { role: 'Hook',          note: 'Emotional opener / cliff-hanger' },
      { role: 'Setup',         note: 'The context or problem you faced' },
      { role: 'Journey',       note: 'The struggle, process, or challenges (1)' },
      { role: 'Journey',       note: 'The struggle, process, or challenges (2)' },
      { role: 'Turning Point', note: 'The shift — what changed' },
      { role: 'Turning Point', note: 'How you applied it' },
      { role: 'Turning Point', note: 'The result that proved it' },
      { role: 'Lesson',        note: 'What I learned' },
      { role: 'Lesson',        note: 'How you can apply this' },
      { role: 'CTA',           note: 'Comment / DM / Save / Share' },
    ],
  },
  'problem-solution': {
    label: 'Problem-Solution',
    description: 'Agitate, educate, and deliver the answer.',
    template: [
      { role: 'Hook',         note: 'The painful symptom your audience knows' },
      { role: 'Problem',      note: 'Make the problem relatable' },
      { role: 'Why It Happens', note: 'Root cause #1' },
      { role: 'Why It Happens', note: 'Root cause #2' },
      { role: 'Solution',     note: 'Framework / step / strategy (1)' },
      { role: 'Solution',     note: 'Framework / step / strategy (2)' },
      { role: 'Solution',     note: 'Framework / step / strategy (3)' },
      { role: 'Outcome',      note: 'The result the reader can expect' },
      { role: 'Outcome',      note: 'A mini-proof or before/after' },
      { role: 'CTA',          note: 'Comment / DM / Save / Share' },
    ],
  },
  'listicle': {
    label: 'Listicle',
    description: 'List-based content always performs.',
    template: [
      { role: 'Hook',        note: 'Number + benefit (e.g. "7 ways to…")' },
      { role: 'Context',     note: 'Why these matter' },
      { role: 'List Item',   note: 'Tip / tool / strategy / mistake #1' },
      { role: 'List Item',   note: 'Tip / tool / strategy / mistake #2' },
      { role: 'List Item',   note: 'Tip / tool / strategy / mistake #3' },
      { role: 'List Item',   note: 'Tip / tool / strategy / mistake #4' },
      { role: 'List Item',   note: 'Tip / tool / strategy / mistake #5' },
      { role: 'List Item',   note: 'Tip / tool / strategy / mistake #6' },
      { role: 'Bonus / Recap', note: 'Bonus tip or quick takeaway' },
      { role: 'CTA',         note: 'Comment / DM / Save / Share' },
    ],
  },
};

function _hasOpenAI() {
  const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  return k && !/^_DUMMY/i.test(k);
}

function _openaiChat(messages, opts = {}) {
  return new Promise((resolve, reject) => {
    const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const body = JSON.stringify({
      model: opts.model || 'gpt-5-mini',
      messages,
      temperature: opts.temperature ?? 0.7,
      response_format: { type: 'json_object' },
      max_tokens: opts.max_tokens || 2200,
    });
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content || '';
          resolve(JSON.parse(txt));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(45000, () => { req.destroy(new Error('OpenAI timeout')); });
    req.write(body); req.end();
  });
}

function _templateSlides(topic, structureKey, brandVoice, audience) {
  const tpl = STRUCTURES[structureKey] || STRUCTURES['pure-info'];
  const t = String(topic || 'this topic').slice(0, 80);
  return tpl.template.map((slot, i) => ({
    n: i + 1,
    role: slot.role,
    headline: i === 0 ? `The Truth About ${t}` :
              slot.role === 'CTA' ? `Comment "${(structureKey||'').toUpperCase()}" and I\'ll send the template` :
              `${slot.role}: ${t}`,
    body: slot.note,
    visualHint: i === 0 ? 'Bold heading, bright contrasting background' :
                slot.role === 'CTA' ? 'High-contrast CTA card with arrow' :
                'Single icon + 1-2 lines of body copy',
  }));
}

router.get('/structures', (_req, res) => {
  res.json({ ok: true, structures: STRUCTURES });
});

router.post('/generate', async (req, res) => {
  try {
    const { topic, structure, brandVoice, audience } = req.body || {};
    const topicS = String(topic || '').trim().slice(0, 200);
    const structureKey = String(structure || 'pure-info').toLowerCase();
    if (!topicS) return res.status(400).json({ ok: false, error: 'topic is required' });
    if (!STRUCTURES[structureKey]) return res.status(400).json({ ok: false, error: 'unknown structure' });

    const tpl = STRUCTURES[structureKey];
    let slides;
    let source = 'template';

    if (_hasOpenAI()) {
      const sys = `You are a social-media copywriter producing 10-slide carousels for Instagram and LinkedIn. Follow the Hook → Context → Value → Action framework. Reply ONLY with valid JSON in this exact shape: {"slides":[{"n":1,"role":"Hook","headline":"...","body":"...","visualHint":"..."}, ...]}. Each slide: headline ≤ 70 chars, body 15-40 words, visualHint = one short sentence describing the imagery.`;
      const user = `TOPIC: ${topicS}
STRUCTURE: ${tpl.label} — ${tpl.description}
BRAND VOICE: ${String(brandVoice || 'expert, plain-spoken, no jargon').slice(0, 200)}
AUDIENCE: ${String(audience || 'small business owners and marketers').slice(0, 200)}

Slide template (write copy for each in order):
${tpl.template.map((s, i) => `${i+1}. ${s.role} — ${s.note}`).join('\n')}

Rules:
- Slide 1 (Hook): bold, scroll-stopping. No "In this post we will discuss…".
- Last slide (CTA): clear action — comment a keyword, save, share, or DM.
- No emoji-spam. ≤ 1 emoji per slide max.
- Use second person ("you", "your") where natural.
- No markdown.`;

      try {
        const j = await _openaiChat([{ role:'system', content: sys }, { role:'user', content: user }]);
        if (Array.isArray(j?.slides) && j.slides.length >= 8) {
          slides = j.slides.slice(0, 10).map((s, i) => {
            let n = parseInt(s && s.n, 10);
            if (!Number.isFinite(n) || n < 1 || n > 10) n = i + 1;
            return {
              n,
              role: String((s && s.role) || tpl.template[i]?.role || '').slice(0, 40),
              headline: String((s && s.headline) || '').slice(0, 140),
              body: String((s && s.body) || '').slice(0, 400),
              visualHint: String((s && s.visualHint) || '').slice(0, 200),
            };
          });
          source = 'openai';
        }
      } catch (e) { console.warn('[t38] openai fallback:', e.message); }
    }

    if (!slides) slides = _templateSlides(topicS, structureKey, brandVoice, audience);

    const meta = { source, structureLabel: tpl.label, brandVoice: brandVoice || null, audience: audience || null };
    let id = null;
    if (_db.hasDb()) {
      try {
        const tid = await _tenantCtx.resolveTenantId(req, { label: 'carousel:generate' });
        const r = await _db.getPool().query(
          `INSERT INTO carousels (tenant_id, topic, structure, brand_voice, audience, slides, meta)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING id`,
          [tid, topicS, structureKey, brandVoice || null, audience || null, JSON.stringify(slides), JSON.stringify(meta)],
        );
        id = r.rows[0].id;
      } catch (e) { console.warn('[t38] persist failed:', e.message); }
    }

    res.json({ ok: true, id, topic: topicS, structure: structureKey, structureLabel: tpl.label, slides, source, meta });
  } catch (e) {
    console.warn('[t38] generate error:', e.stack || e.message);
    res.status(500).json({ ok: false, error: e.message || 'generate failed' });
  }
});

router.get('/list', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'carousel:list' });
    const r = await _db.getPool().query(
      `SELECT id, topic, structure, brand_voice, audience, meta, created_at FROM carousels WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [tid],
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'list failed' });
  }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'no-db' });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'carousel:get' });
    const r = await _db.getPool().query(`SELECT * FROM carousels WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'get failed' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'no-db' });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'carousel:delete' });
    await _db.getPool().query(`DELETE FROM carousels WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'delete failed' });
  }
});

module.exports = router;
