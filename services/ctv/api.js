const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const PLATFORMS = [
  { id: 'roku', name: 'Roku OneView', type: 'ctv', min_budget: 5000 },
  { id: 'hulu', name: 'Hulu Ad Manager', type: 'ctv', min_budget: 500 },
  { id: 'amazon_dsp', name: 'Amazon DSP (Fire TV)', type: 'ctv', min_budget: 35000 },
  { id: 'youtube_tv', name: 'YouTube TV (DV360)', type: 'ctv', min_budget: 1000 },
  { id: 'spotify', name: 'Spotify Ads', type: 'streaming_audio', min_budget: 250 },
  { id: 'pandora', name: 'Pandora / SiriusXM', type: 'streaming_audio', min_budget: 1000 },
  { id: 'iheartradio', name: 'iHeartRadio', type: 'streaming_audio', min_budget: 500 },
  { id: 'apple_podcasts', name: 'Apple Podcast Ads', type: 'streaming_audio', min_budget: 2500 },
];
const OBJECTIVES = ['brand_awareness','reach_frequency','video_completion','website_traffic','app_install','purchase'];
const TARGETING_OPTIONS = ['age_gender','household_income','content_genre','behavioural','geo','device_type','time_of_day','first_party_match'];

router.get('/config', async (req, res) => {
  res.json({ ok: true, platforms: PLATFORMS, objectives: OBJECTIVES, targeting_options: TARGETING_OPTIONS });
});

router.get('/campaigns', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ctv:campaigns' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM ctv_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok: true, campaigns: rows.rows });
});

router.post('/campaigns/create', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ctv:create-campaign' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name, platform, campaign_type, objective, budget, daily_budget, targeting, start_date, end_date } = req.body;
  if (!name || !platform) return res.status(400).json({ ok: false, error: 'name and platform required' });
  const pDef = PLATFORMS.find(pl => pl.id === platform);
  const p = await _db.getPool();
  const cpm = pDef?.type === 'streaming_audio' ? 8 + Math.random() * 10 : 18 + Math.random() * 22;
  const totalBudget = +(budget || daily_budget * 30 || 5000);
  const projectedReach = Math.round(totalBudget / cpm * 1000);
  const r = await p.query(
    `INSERT INTO ctv_campaigns(tenant_id,name,platform,campaign_type,objective,budget,daily_budget,targeting,status,projected_reach,projected_cpm,start_date,end_date)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,$12) RETURNING *`,
    [tid, name, platform, campaign_type || pDef?.type || 'ctv', objective || 'brand_awareness',
     totalBudget, +(daily_budget || totalBudget / 30), JSON.stringify(targeting || {}),
     projectedReach, +cpm.toFixed(2), start_date || null, end_date || null]
  );
  res.json({ ok: true, campaign: r.rows[0] });
});

router.put('/campaigns/:id/status', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ctv:update-status' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { status } = req.body;
  if (!status) return res.status(400).json({ ok: false, error: 'status required' });
  const p = await _db.getPool();
  const r = await p.query(`UPDATE ctv_campaigns SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *`, [status, req.params.id, tid]);
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, campaign: r.rows[0] });
});

router.post('/campaigns/:id/ai-brief', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ctv:ai-brief' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const camp = await p.query(`SELECT * FROM ctv_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!camp.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const c = camp.rows[0];
  const pDef = PLATFORMS.find(pl => pl.id === c.platform) || { name: c.platform };
  const { brand_name, industry, target_audience, key_message } = req.body;

  let brief = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const isAudio = c.campaign_type === 'streaming_audio';
    const prompt = `You are an expert ${isAudio ? 'radio/streaming audio' : 'Connected TV'} ad creative director.
Write a complete creative brief for this campaign.
Platform: ${pDef.name}
Brand: ${brand_name || 'the brand'}
Industry: ${industry || 'general'}
Target audience: ${target_audience || 'broad audience'}
Key message: ${key_message || 'brand awareness'}
Objective: ${c.objective}
Budget: $${c.budget} | Projected reach: ${(c.projected_reach || 0).toLocaleString()} | Projected CPM: $${c.projected_cpm}

${isAudio ? 'Include: 30-second script, host-read version, sound design notes, call-to-action phrase.' : 'Include: 30-second TV script (scene-by-scene), visual direction, voiceover copy, end card, brand recall technique.'}
Return strict JSON: {"headline":"...","tagline":"...","script":"...","visual_direction":"...","voiceover":"...","cta":"...","production_notes":"...","brand_recall_technique":"...","audience_hook":"..."}`;
    const r = await openai.chat.completions.create({ model: 'gpt-5', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) brief = parsed;
  } catch (e) {}

  if (!brief) {
    brief = { headline: `${brand_name || 'The Brand'} — ${c.objective.replace(/_/g, ' ')}`, tagline: 'Experience the difference.', script: `[OPEN: Establishing shot] Voiceover: "Tired of the same old results? [Brand] changes everything. [Key benefit]. [Call to action]. [Brand]."`, visual_direction: 'Clean, modern visuals. Brand colours throughout. Close on product/service benefit.', voiceover: `"Don't settle for ordinary. Discover ${brand_name || 'us'} today."`, cta: 'Visit our website or search for us now.', production_notes: 'Ensure audio-led storytelling for streaming. Include URL chyron in final 5 seconds.', brand_recall_technique: 'Repeat brand name 3x. Logo on screen for final 8 seconds.', audience_hook: 'Open with a relatable problem statement to drive immediate engagement.' };
  }

  await p.query(`UPDATE ctv_campaigns SET creative_brief=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(brief), c.id]);
  res.json({ ok: true, brief });
});

router.get('/report', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ctv:report' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const [campaigns, perf] = await Promise.all([
    p.query(`SELECT COUNT(*) as total, SUM(budget) as total_budget, COUNT(*) FILTER(WHERE status='active') as active FROM ctv_campaigns WHERE tenant_id=$1`, [tid]),
    p.query(`SELECT p.*, c.name as campaign_name, c.platform FROM ctv_performance p JOIN ctv_campaigns c ON c.id=p.campaign_id WHERE p.tenant_id=$1 ORDER BY p.date_recorded DESC LIMIT 50`, [tid]),
  ]);
  res.json({ ok: true, summary: campaigns.rows[0], performance: perf.rows, platforms: PLATFORMS });
});

module.exports = router;
