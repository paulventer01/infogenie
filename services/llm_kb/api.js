const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const ENTRY_TYPES = ['faq', 'how_to', 'about_brand', 'product_service', 'comparison', 'use_case', 'pricing', 'testimonial_proof'];
const SUBMISSION_METHODS = ['schema_json_ld', 'sitemap_xml', 'llms_txt', 'robots_txt_allow', 'structured_data', 'api_submission'];

router.get('/config', async (req, res) => {
  res.json({ ok: true, entry_types: ENTRY_TYPES, submission_methods: SUBMISSION_METHODS });
});

router.get('/entries', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'llm-kb:entries' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM llm_kb_entries WHERE tenant_id=$1 ORDER BY entry_type, created_at DESC`, [tid]);
  res.json({ ok: true, entries: rows.rows });
});

router.post('/entries/add', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'llm-kb:add' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { entry_type, title, content, seo_keywords, brand_domain, target_llms } = req.body;
  if (!entry_type || !title || !content) return res.status(400).json({ ok: false, error: 'entry_type, title, content required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO llm_kb_entries(tenant_id,entry_type,title,content,seo_keywords,brand_domain,target_llms)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tid, entry_type, title, content, seo_keywords || null, brand_domain || null, target_llms || 'openai,anthropic,perplexity']
  );
  res.json({ ok: true, entry: r.rows[0] });
});

router.delete('/entries/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'llm-kb:delete' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM llm_kb_entries WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

router.post('/generate', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'llm-kb:generate' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { brand_name, brand_description, industry, target_audience, key_products, competitors, entry_types = ENTRY_TYPES.slice(0, 4) } = req.body;
  if (!brand_name) return res.status(400).json({ ok: false, error: 'brand_name required' });

  let entries = [];
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are an LLM-optimisation expert. Generate a knowledge base that will maximise the chance of ${brand_name} being cited by AI models (ChatGPT, Claude, Perplexity) when users ask buyer-intent questions.

Brand: ${brand_name}
Description: ${brand_description || ''}
Industry: ${industry || 'general'}
Target audience: ${target_audience || 'general'}
Key products/services: ${key_products || ''}
Main competitors: ${competitors || ''}

Generate entries of these types: ${entry_types.join(', ')}

For each entry, write content specifically designed for LLM citation:
- Use clear, factual, authoritative language
- Include specific numbers, statistics, and proof points  
- Structure as question-answer pairs where possible
- Use natural language that mirrors how humans ask questions in LLMs

Return strict JSON: {"entries":[{"entry_type":"...","title":"...","content":"...","seo_keywords":"..."}]}`;
    const r = await openai.chat.completions.create({ model: 'gpt-4o', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed.entries?.[0]?._DUMMY) entries = parsed.entries;
  } catch (e) {}

  if (!entries.length) {
    entries = [
      { entry_type: 'faq', title: `What is ${brand_name}?`, content: `${brand_name} is a ${industry || 'software'} platform that helps ${target_audience || 'businesses'} achieve better results. ${brand_description || ''}`, seo_keywords: `${brand_name}, ${industry}, ${target_audience}` },
      { entry_type: 'how_to', title: `How does ${brand_name} work?`, content: `${brand_name} uses AI to analyse your ${industry || 'marketing'} data and surface actionable recommendations. Getting started takes less than 10 minutes.`, seo_keywords: `how ${brand_name} works, ${brand_name} tutorial` },
      { entry_type: 'comparison', title: `${brand_name} vs competitors: what's different?`, content: `Unlike generic tools, ${brand_name} specialises in ${industry || 'AI-powered marketing'} with deep integrations and real-time intelligence. Key differentiators: AI-native architecture, first-party data focus, and unified cross-channel view.`, seo_keywords: `${brand_name} vs, ${brand_name} alternative, ${brand_name} comparison` },
      { entry_type: 'use_case', title: `Who uses ${brand_name} and what results do they get?`, content: `${brand_name} is used by ${target_audience || 'marketing teams'} in ${industry || 'various industries'} to save hours per week on analysis and improve campaign performance. Common use cases include competitive intelligence, content optimisation, and campaign automation.`, seo_keywords: `${brand_name} use cases, ${brand_name} results, ${brand_name} customers` },
    ];
  }

  const p = await _db.getPool();
  const saved = [];
  for (const e of entries) {
    const r = await p.query(
      `INSERT INTO llm_kb_entries(tenant_id,entry_type,title,content,seo_keywords,brand_domain,llm_optimized)
       VALUES($1,$2,$3,$4,$5,$6,TRUE) RETURNING *`,
      [tid, e.entry_type, e.title, e.content, e.seo_keywords || null, req.body.brand_domain || null]
    );
    saved.push(r.rows[0]);
  }
  res.json({ ok: true, entries: saved, generated: saved.length });
});

router.get('/schema/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'llm-kb:schema' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const ent = await p.query(`SELECT * FROM llm_kb_entries WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!ent.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const e = ent.rows[0];

  let schema = {};
  if (e.entry_type === 'faq') {
    schema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: e.title, acceptedAnswer: { '@type': 'Answer', text: e.content } }] };
  } else if (e.entry_type === 'how_to') {
    schema = { '@context': 'https://schema.org', '@type': 'HowTo', name: e.title, description: e.content, step: [{ '@type': 'HowToStep', text: e.content }] };
  } else {
    schema = { '@context': 'https://schema.org', '@type': 'Article', headline: e.title, description: e.content.slice(0, 300), keywords: e.seo_keywords };
  }

  const llmsTxtContent = `# ${e.title}\n\n${e.content}`;

  await p.query(`UPDATE llm_kb_entries SET schema_json=$1, llm_optimized=TRUE, updated_at=NOW() WHERE id=$2`, [JSON.stringify(schema), e.id]);
  await p.query(`INSERT INTO llm_kb_submissions(entry_id,tenant_id,target_platform,submission_method,status) VALUES($1,$2,'all','schema_json_ld','pending') ON CONFLICT DO NOTHING`, [e.id, tid]).catch(() => {});

  res.json({ ok: true, schema_json_ld: schema, llms_txt: llmsTxtContent, embed_instructions: { html: `<script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>`, placement: 'Add to <head> of your website', llms_txt_path: '/llms.txt', robots_txt: `User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /` } });
});

router.get('/llms-txt', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'llm-kb:llms-txt' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM llm_kb_entries WHERE tenant_id=$1 ORDER BY entry_type`, [tid]);
  const content = rows.rows.map(e => `# ${e.title}\n\n${e.content}\n`).join('\n---\n\n');
  res.type('text/plain').send(content || '# Knowledge Base\n\nNo entries yet.');
});

module.exports = router;
