const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

router.get('/questions', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ai-answer-sov:questions' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM sov_questions WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok:true, questions: rows.rows });
});

router.post('/questions/add', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ai-answer-sov:add' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { questions, topic_cluster, brand_domain } = req.body;
  if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ ok:false, error:'questions array required' });
  const p = await _db.getPool();
  let added = 0;
  for (const q of questions.slice(0,50)) {
    if (!q || typeof q !== 'string') continue;
    await p.query(
      `INSERT INTO sov_questions(tenant_id,question,topic_cluster,brand_domain) VALUES($1,$2,$3,$4)`,
      [tid, q.trim(), topic_cluster||null, brand_domain||null]
    );
    added++;
  }
  res.json({ ok:true, added });
});

router.delete('/questions/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ai-answer-sov:delete-question' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM sov_questions WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok:true });
});

router.post('/sweep', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ai-answer-sov:sweep' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { question_ids, brand_domain, providers = ['openai','anthropic'] } = req.body;
  const p = await _db.getPool();

  const qQuery = question_ids?.length
    ? `SELECT * FROM sov_questions WHERE tenant_id=$1 AND id=ANY($2) AND is_active=TRUE LIMIT 10`
    : `SELECT * FROM sov_questions WHERE tenant_id=$1 AND is_active=TRUE LIMIT 10`;
  const qArgs = question_ids?.length ? [tid, question_ids] : [tid];
  const questions = await p.query(qQuery, qArgs);
  if (!questions.rows.length) return res.json({ ok:true, swept:0, message:'No active questions' });

  const results = [];
  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
  const anthropic = new Anthropic({ apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY });

  for (const q of questions.rows) {
    const brand = brand_domain || q.brand_domain || '';
    for (const provider of providers.slice(0,3)) {
      let answer = '';
      try {
        if (provider === 'openai') {
          const r = await openai.chat.completions.create({
            model:'gpt-4o-mini',
            messages:[{role:'user',content:q.question}],
            max_tokens:400
          });
          answer = r.choices[0].message.content || '';
        } else if (provider === 'anthropic') {
          const r = await anthropic.messages.create({
            model:'claude-3-haiku-20240307',
            max_tokens:400,
            messages:[{role:'user',content:q.question}]
          });
          answer = r.content[0]?.text || '';
        } else if (provider === 'perplexity' && process.env.PERPLEXITY_API_KEY) {
          const r = await fetch('https://api.perplexity.ai/chat/completions', {
            method:'POST',
            headers:{ 'Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type':'application/json' },
            body: JSON.stringify({ model:'sonar', messages:[{role:'user',content:q.question}], max_tokens:400 })
          });
          const j = await r.json();
          answer = j.choices?.[0]?.message?.content || '';
        }
      } catch(e) { answer = ''; }

      const answerLower = answer.toLowerCase();
      const brandMentioned = brand ? answerLower.includes(brand.toLowerCase().replace('www.','').split('.')[0]) : false;
      const sentiment = brandMentioned
        ? (answerLower.includes('best') || answerLower.includes('leading') || answerLower.includes('recommend') ? 'positive' : 'neutral')
        : 'not_mentioned';

      const competitorRegex = /([a-z0-9\-]+\.(?:com|io|co|net|ai))/gi;
      const competitorMatches = [...(answer.matchAll(competitorRegex)||[])].map(m=>m[1]).filter(d=>d!==brand).slice(0,5);

      await p.query(
        `INSERT INTO sov_responses(question_id,tenant_id,llm_provider,answer_text,brand_mentioned,brand_sentiment,competitor_citations,citation_rank)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [q.id, tid, provider, answer.slice(0,2000), brandMentioned, sentiment, JSON.stringify(competitorMatches), brandMentioned?1:null]
      );
      results.push({ question_id:q.id, provider, brand_mentioned:brandMentioned, sentiment, competitors:competitorMatches });
    }
  }

  res.json({ ok:true, swept: questions.rows.length, results });
});

router.get('/dashboard', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ai-answer-sov:dashboard' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();

  const [totalQ, totalR, byProvider, brandMentions, topCompetitors, recent] = await Promise.all([
    p.query(`SELECT COUNT(*) as n FROM sov_questions WHERE tenant_id=$1 AND is_active=TRUE`, [tid]),
    p.query(`SELECT COUNT(*) as n FROM sov_responses WHERE tenant_id=$1`, [tid]),
    p.query(`SELECT llm_provider, COUNT(*) as responses, SUM(CASE WHEN brand_mentioned THEN 1 ELSE 0 END) as brand_hits FROM sov_responses WHERE tenant_id=$1 GROUP BY llm_provider`, [tid]),
    p.query(`SELECT COUNT(*) as n, SUM(CASE WHEN brand_mentioned THEN 1 ELSE 0 END) as brand_hits FROM sov_responses WHERE tenant_id=$1`, [tid]),
    p.query(`SELECT competitor_citations FROM sov_responses WHERE tenant_id=$1 AND competitor_citations != '[]' ORDER BY run_at DESC LIMIT 50`, [tid]),
    p.query(`SELECT r.*, q.question, q.topic_cluster FROM sov_responses r JOIN sov_questions q ON q.id=r.question_id WHERE r.tenant_id=$1 ORDER BY r.run_at DESC LIMIT 20`, [tid]),
  ]);

  const citationMap = {};
  for (const row of topCompetitors.rows) {
    try {
      const cites = JSON.parse(row.competitor_citations || '[]');
      for (const c of cites) citationMap[c] = (citationMap[c]||0)+1;
    } catch(e) {}
  }
  const topCitedCompetitors = Object.entries(citationMap).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([domain,count])=>({domain,count}));

  const totalResponses = +brandMentions.rows[0].n;
  const brandHits = +brandMentions.rows[0].brand_hits;
  const sovPct = totalResponses ? Math.round((brandHits/totalResponses)*100) : 0;

  res.json({
    ok:true,
    questions: +totalQ.rows[0].n,
    responses: +totalR.rows[0].n,
    brand_sov_pct: sovPct,
    brand_hits: brandHits,
    by_provider: byProvider.rows,
    top_competitors: topCitedCompetitors,
    recent: recent.rows
  });
});

module.exports = router;
