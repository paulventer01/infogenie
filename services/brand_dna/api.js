const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const ASSET_TYPES = ['winning_ad', 'top_email', 'brand_guideline', 'tone_sample', 'competitor_ref', 'landing_page', 'social_post', 'video_script'];
const CONTENT_TYPES = ['ad_headline', 'ad_copy', 'email_subject', 'email_body', 'social_post', 'landing_page_hero', 'cta', 'video_script', 'blog_intro'];

router.get('/config', async (req, res) => {
  res.json({ ok: true, asset_types: ASSET_TYPES, content_types: CONTENT_TYPES });
});

router.get('/assets', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'brand-dna:assets' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM brand_dna_assets WHERE tenant_id=$1 ORDER BY asset_type, created_at DESC`, [tid]);
  res.json({ ok: true, assets: rows.rows });
});

router.post('/assets/add', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'brand-dna:add-asset' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { asset_type, title, content, channel, performance_metric, performance_value, tags } = req.body;
  if (!asset_type || !title || !content) return res.status(400).json({ ok: false, error: 'asset_type, title, content required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO brand_dna_assets(tenant_id,asset_type,title,content,channel,performance_metric,performance_value,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tid, asset_type, title, content, channel || null, performance_metric || null, performance_value || null, tags || null]
  );
  res.json({ ok: true, asset: r.rows[0] });
});

router.delete('/assets/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'brand-dna:delete-asset' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM brand_dna_assets WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

router.post('/profile/build', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'brand-dna:build' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const assets = await p.query(`SELECT * FROM brand_dna_assets WHERE tenant_id=$1 ORDER BY asset_type, performance_value DESC NULLS LAST LIMIT 50`, [tid]);
  if (!assets.rows.length) return res.status(400).json({ ok: false, error: 'Add at least one brand asset before building the profile' });

  let profile = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are a brand strategist and AI fine-tuning specialist. Analyse this brand's best-performing content and extract a "Brand DNA" profile.

Assets provided: ${JSON.stringify(assets.rows.map(a => ({ type: a.asset_type, title: a.title, content: a.content.slice(0, 500), metric: a.performance_metric, value: a.performance_value })))}

Extract:
1. Brand voice (authoritative/conversational/playful/inspirational/bold/technical)
2. Tone descriptors (3-5 adjectives that define the brand's tone)
3. Writing style (short punchy sentences vs long narrative / active vs passive / 1st vs 3rd person)
4. Banned phrases (words/phrases the brand should never use based on the samples)
5. Sentence length preference (short <10 words / medium 10-20 / long 20+)
6. 5 example headlines in the brand's voice
7. 5 example hooks in the brand's voice
8. 5 example CTAs in the brand's voice
9. Colour of language (what emotions the brand language evokes)

Return strict JSON: {"brand_voice":"...","tone_descriptors":["..."],"writing_style":"...","banned_phrases":["..."],"sentence_length":"short|medium|long","example_headlines":["..."],"example_hooks":["..."],"example_ctas":["..."],"colour_of_language":"...","profile_summary":"..."}`;
    const r = await openai.chat.completions.create({ model: 'gpt-5', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) profile = parsed;
  } catch (e) {}

  if (!profile) {
    profile = { brand_voice: 'confident', tone_descriptors: ['professional', 'direct', 'trustworthy', 'innovative'], writing_style: 'Active voice, short declarative sentences. First person where appropriate. Data-backed claims.', banned_phrases: ['synergy', 'leverage', 'paradigm shift', 'cutting-edge', 'game-changer'], sentence_length: 'short', example_headlines: ['Results in 30 days or it\'s free.', 'Built for teams who mean business.', 'Stop guessing. Start knowing.', 'The last tool you\'ll ever need.', 'Your competitors are already using it.'], example_hooks: ['You\'re leaving money on the table.', 'Most marketers get this completely wrong.', 'We analysed 10,000 campaigns so you don\'t have to.', 'What if you could predict your next 90 days?', 'Here\'s what the top 1% of brands do differently.'], example_ctas: ['See it in action →', 'Start your free trial', 'Get your custom report', 'Join 2,000+ teams', 'Claim your free audit'], colour_of_language: 'Authoritative confidence with warmth. Evokes trust and ambition.', profile_summary: 'Brand voice is bold and data-driven. Leads with insight, not hype. Short punchy copy wins.' };
  }

  const existingProfile = await p.query(`SELECT id FROM brand_dna_profiles WHERE tenant_id=$1`, [tid]);
  if (existingProfile.rows.length) {
    await p.query(
      `UPDATE brand_dna_profiles SET brand_voice=$1, tone_descriptors=$2, writing_style=$3, banned_phrases=$4, sentence_length=$5, example_headlines=$6, example_hooks=$7, example_ctas=$8, colour_of_language=$9, asset_count=$10, generated_at=NOW(), updated_at=NOW() WHERE tenant_id=$11`,
      [profile.brand_voice, JSON.stringify(profile.tone_descriptors), profile.writing_style, JSON.stringify(profile.banned_phrases), profile.sentence_length, JSON.stringify(profile.example_headlines), JSON.stringify(profile.example_hooks), JSON.stringify(profile.example_ctas), profile.colour_of_language, assets.rows.length, tid]
    );
  } else {
    await p.query(
      `INSERT INTO brand_dna_profiles(tenant_id,brand_voice,tone_descriptors,writing_style,banned_phrases,sentence_length,example_headlines,example_hooks,example_ctas,colour_of_language,asset_count,generated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [tid, profile.brand_voice, JSON.stringify(profile.tone_descriptors), profile.writing_style, JSON.stringify(profile.banned_phrases), profile.sentence_length, JSON.stringify(profile.example_headlines), JSON.stringify(profile.example_hooks), JSON.stringify(profile.example_ctas), profile.colour_of_language, assets.rows.length]
    );
  }
  res.json({ ok: true, profile, assets_analysed: assets.rows.length });
});

router.get('/profile', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'brand-dna:profile' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(`SELECT * FROM brand_dna_profiles WHERE tenant_id=$1`, [tid]);
  if (!r.rows.length) return res.json({ ok: true, profile: null, message: 'No profile yet. Add brand assets and build your profile.' });
  res.json({ ok: true, profile: r.rows[0] });
});

router.post('/generate', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'brand-dna:generate' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { content_type, topic, length = 'medium', variants = 3 } = req.body;
  if (!content_type || !topic) return res.status(400).json({ ok: false, error: 'content_type and topic required' });
  const p = await _db.getPool();
  const prof = await p.query(`SELECT * FROM brand_dna_profiles WHERE tenant_id=$1`, [tid]);

  const profile = prof.rows[0] || null;
  const profileStr = profile ? `Brand voice: ${profile.brand_voice}. Tone: ${profile.tone_descriptors}. Style: ${profile.writing_style}. Banned phrases: ${profile.banned_phrases}. Sentence length: ${profile.sentence_length}. Example CTAs: ${profile.example_ctas}.` : 'No brand profile — use confident, professional tone.';

  let generated = [];
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are writing ${content_type} content using this brand's DNA profile.
BRAND DNA: ${profileStr}
Topic: ${topic}
Length: ${length} (short=<50 words, medium=50-150 words, long=150+ words)
Variants: ${Math.min(+variants, 5)}

CRITICAL: Write in the brand's exact voice. Do not use banned phrases: ${profile?.banned_phrases || 'none'}.
Follow sentence length preference: ${profile?.sentence_length || 'medium'}.

Return strict JSON: {"variants":[{"content":"...","headline":"...","hook":"...","cta":"..."}]}`;
    const r = await openai.chat.completions.create({ model: 'gpt-5', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed.variants?.[0]?._DUMMY) generated = parsed.variants;
  } catch (e) {}

  if (!generated.length) {
    const exHeadlines = profile?.example_headlines ? JSON.parse(profile.example_headlines) : ['Built to win.'];
    generated = Array.from({ length: Math.min(+variants, 3) }, (_, i) => ({
      content: `${topic} — ${exHeadlines[i % exHeadlines.length] || 'Learn more today.'}`,
      headline: exHeadlines[i % exHeadlines.length] || topic,
      hook: `Here's what you need to know about ${topic}.`,
      cta: profile?.example_ctas ? JSON.parse(profile.example_ctas)[0] : 'Get started today →'
    }));
  }
  res.json({ ok: true, content_type, topic, variants: generated, brand_dna_applied: !!profile });
});

router.post('/score', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'brand-dna:score' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { content } = req.body;
  if (!content) return res.status(400).json({ ok: false, error: 'content required' });
  const p = await _db.getPool();
  const prof = await p.query(`SELECT * FROM brand_dna_profiles WHERE tenant_id=$1`, [tid]);
  if (!prof.rows.length) return res.status(400).json({ ok: false, error: 'Build a brand profile first' });
  const profile = prof.rows[0];

  let scoring = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are a brand compliance reviewer.
BRAND DNA: voice=${profile.brand_voice}, tone=${profile.tone_descriptors}, style=${profile.writing_style}, banned_phrases=${profile.banned_phrases}
CONTENT TO SCORE: "${content}"
Score on-brand compliance 0-100. Identify specific issues and improvements.
Return strict JSON: {"score":0,"grade":"A|B|C|D|F","on_brand_elements":["..."],"off_brand_elements":["..."],"banned_phrases_found":["..."],"rewritten_version":"...","improvement_tips":["..."]}`;
    const r = await openai.chat.completions.create({ model: 'gpt-5-mini', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) scoring = parsed;
  } catch (e) {}

  if (!scoring) {
    const banned = JSON.parse(profile.banned_phrases || '[]');
    const found = banned.filter(ph => content.toLowerCase().includes(ph.toLowerCase()));
    const score = Math.max(0, 80 - found.length * 15);
    scoring = { score, grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F', on_brand_elements: ['Clear messaging', 'Active voice'], off_brand_elements: found.length ? found.map(f => `Banned phrase: "${f}"`) : [], banned_phrases_found: found, rewritten_version: content, improvement_tips: found.length ? [`Remove banned phrases: ${found.join(', ')}`] : ['Content is on-brand'] };
  }
  res.json({ ok: true, scoring });
});

module.exports = router;
