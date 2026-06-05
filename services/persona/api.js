const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

function _oa() { return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY }); }

/* ── list ── */
router.get('/', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'persona:list' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { rows } = await _db.getPool().query(
      `SELECT * FROM ai_personas WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
    res.json({ personas: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── create ── */
router.post('/', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'persona:create' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { name, niche, age_range, gender, appearance_prompt, personality, content_voice, posting_style } = req.body;
    if (!name || !niche) return res.status(400).json({ error: 'name and niche required' });
    const { rows } = await _db.getPool().query(
      `INSERT INTO ai_personas (tenant_id,name,niche,age_range,gender,appearance_prompt,personality,content_voice,posting_style)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, name, niche, age_range||'25-30', gender||'female', appearance_prompt||'', personality||'', content_voice||'', posting_style||'']
    );
    res.json({ persona: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── get one ── */
router.get('/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'persona:get' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { rows } = await _db.getPool().query(
      `SELECT * FROM ai_personas WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json({ persona: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── update ── */
router.put('/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'persona:update' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { name, niche, age_range, gender, appearance_prompt, personality, content_voice, posting_style, is_active } = req.body;
    const { rows } = await _db.getPool().query(
      `UPDATE ai_personas SET name=COALESCE($3,name), niche=COALESCE($4,niche), age_range=COALESCE($5,age_range),
       gender=COALESCE($6,gender), appearance_prompt=COALESCE($7,appearance_prompt), personality=COALESCE($8,personality),
       content_voice=COALESCE($9,content_voice), posting_style=COALESCE($10,posting_style),
       is_active=COALESCE($11,is_active), updated_at=now()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, tid, name, niche, age_range, gender, appearance_prompt, personality, content_voice, posting_style, is_active]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json({ persona: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── delete ── */
router.delete('/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'persona:delete' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    await _db.getPool().query(`DELETE FROM ai_personas WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── generate avatar image prompt ── */
router.post('/:id/generate-avatar', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'persona:avatar' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { rows } = await _db.getPool().query(
      `SELECT * FROM ai_personas WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const p = rows[0];

    const imgPrompt = `${p.appearance_prompt || `A ${p.age_range} year old ${p.gender} AI influencer in the ${p.niche} niche`}. 
Portrait photo, professional lifestyle photography, natural lighting, high quality, photorealistic, editorial style. 
Personality: ${p.personality || 'confident, approachable, authentic'}. 
Content style: ${p.content_voice || 'aspirational and relatable'}.`;

    const imgRes = await _oa().images.generate({
      model: 'dall-e-3', prompt: imgPrompt, n: 1, size: '1024x1024', quality: 'standard', style: 'natural'
    });
    const url = imgRes.data[0].url;

    await _db.getPool().query(`UPDATE ai_personas SET avatar_url=$1, updated_at=now() WHERE id=$2`, [url, p.id]);
    res.json({ avatar_url: url, source: 'dall-e-3' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── generate sample content ── */
router.post('/:id/generate-content', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'persona:content' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { content_type = 'instagram_caption', product } = req.body;
    const { rows } = await _db.getPool().query(
      `SELECT * FROM ai_personas WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const p = rows[0];

    const systemPrompt = `You are ${p.name}, an AI influencer in the ${p.niche} niche. 
Age: ${p.age_range}. Personality: ${p.personality || 'confident and relatable'}. 
Voice: ${p.content_voice || 'casual, authentic, aspirational'}. Posting style: ${p.posting_style || 'lifestyle-focused'}.
Write only as this character — never break character. Respond with valid JSON only.`;

    const userPrompt = product
      ? `Create a ${content_type} for a brand deal featuring: ${product}. Include: caption text, 5 hashtags, a CTA. JSON: {"caption":"...","hashtags":["..."],"cta":"..."}`
      : `Create a ${content_type} about ${p.niche}. Include: caption text, 5 hashtags, a CTA. JSON: {"caption":"...","hashtags":["..."],"cta":"..."}`;

    const completion = await _oa().chat.completions.create({
      model: 'gpt-4o', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' }, max_tokens: 600
    });

    let result = {};
    try { result = JSON.parse(completion.choices[0].message.content); } catch (_) { result = { caption: completion.choices[0].message.content }; }
    if (result._DUMMY) result = { caption: `A ${p.niche} moment with ${p.name}`, hashtags: ['#lifestyle'], cta: 'Follow for more!' };

    const entry = { type: content_type, product: product || null, ...result, generated_at: new Date().toISOString() };
    const { rows: updated } = await _db.getPool().query(
      `UPDATE ai_personas SET sample_content = sample_content || $1::jsonb, updated_at=now() WHERE id=$2 RETURNING sample_content`,
      [JSON.stringify([entry]), p.id]
    );
    res.json({ content: entry, all_samples: updated[0]?.sample_content || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── AI build persona from description ── */
router.post('/ai-build', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'persona:ai-build' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { niche, target_audience, brand_vibe } = req.body;
    if (!niche) return res.status(400).json({ error: 'niche required' });

    const completion = await _oa().chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `Design a compelling AI influencer persona for the ${niche} niche.
Target audience: ${target_audience || 'millennials and Gen Z'}.
Brand vibe: ${brand_vibe || 'authentic and aspirational'}.
Return valid JSON with exactly these fields:
{"name":"...","age_range":"...","gender":"...","appearance_prompt":"...","personality":"...","content_voice":"...","posting_style":"..."}`
      }],
      response_format: { type: 'json_object' }, max_tokens: 700
    });

    let result = {};
    try { result = JSON.parse(completion.choices[0].message.content); } catch (_) { result = {}; }
    if (result._DUMMY || !result.name) {
      result = { name: `${niche.charAt(0).toUpperCase() + niche.slice(1)} Queen`, age_range: '24-28', gender: 'female',
        appearance_prompt: `A stylish ${niche} influencer with natural features`, personality: 'confident, authentic, inspiring',
        content_voice: 'casual but aspirational', posting_style: 'daily lifestyle + weekly brand deals' };
    }
    res.json({ suggestion: result, source: 'gpt-4o' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
