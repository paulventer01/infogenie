// AI visibility (accuracy/competitors/entity/sentiment/sge/attribution) routes.
// Extracted verbatim from server.js (pure structural move — no behavior change).
// Shared module-scope helpers are injected via `ctx`.
// __dirname and relative require() are rebased to the app root so the moved code
// (originally at server.js, project root) resolves paths exactly as before.
const __path__ = require('path');
const __APP_ROOT__ = __path__.join(__dirname, '..', '..');
const __root_require__ = (p) =>
  (typeof p === 'string' && (p.startsWith('./') || p.startsWith('../')))
    ? require(__path__.resolve(__APP_ROOT__, p))
    : require(p);

module.exports = function register(app, ctx) {
  const __dirname = __APP_ROOT__;
  const require = __root_require__;
  const { anthropic, openai } = ctx;

app.post('/api/ai-visibility-accuracy', async (req, res) => {
  try {
    const { domain = 'yourdomain.com', industry = 'your industry' } = req.body || {};
    const cleanDomain = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();
    const brandStem = cleanDomain.split('.')[0];

    // 1) Build source-of-truth from the live website.
    const fetchPage = async (u, ms=6000) => {
      try {
        const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), ms);
        const r = await fetch(u, { signal:ctrl.signal, redirect:'follow', headers:{ 'User-Agent':'Mozilla/5.0 (compatible; InfoGenieBot/1.0)' } });
        clearTimeout(t); if (!r.ok) return ''; return (await r.text()).slice(0,120000);
      } catch(e){ return ''; }
    };
    const base = 'https://' + cleanDomain;
    const [home, about, prod, services, pricing] = await Promise.all([
      fetchPage(base, 8000),
      fetchPage(base + '/about', 5000),
      fetchPage(base + '/products', 5000),
      fetchPage(base + '/services', 5000),
      fetchPage(base + '/pricing', 5000),
    ]);
    const allHtml = [home, about, prod, services, pricing].join('\n');
    const sourceText = allHtml
      .replace(/<script[\s\S]*?<\/script>/gi,' ')
      .replace(/<style[\s\S]*?<\/style>/gi,' ')
      .replace(/<[^>]+>/g,' ')
      .replace(/&nbsp;/g,' ')
      .replace(/\s+/g,' ').trim().slice(0, 8000);

    // 2) Ask each connected model the same brand-fact question.
    const factQ = `Describe ${brandStem} (${cleanDomain}) for someone unfamiliar with the brand. Cover: what it does, main products or services, target customer, pricing if known, country/HQ if known, and any key differentiators. Be specific. ~120-180 words.`;

    const probes = {};
    probes.chatgpt = async () => {
      const c = await openai.chat.completions.create({ model:'gpt-4o', max_tokens:380, messages:[{ role:'user', content:factQ }] });
      return c.choices?.[0]?.message?.content?.trim() || '';
    };
    probes.claude = async () => {
      const c = await anthropic.messages.create({ model:'claude-sonnet-4-6', max_tokens:450, messages:[{ role:'user', content:factQ }] });
      return c.content?.[0]?.text?.trim() || '';
    };
    if (process.env.GEMINI_API_KEY) probes.gemini = async () => {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{ parts:[{ text:factQ }] }] }) });
      const d = await r.json(); return d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    };
    if (process.env.PERPLEXITY_API_KEY) probes.perplexity = async () => {
      const r = await fetch('https://api.perplexity.ai/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`}, body: JSON.stringify({ model:'sonar', messages:[{ role:'user', content:factQ }] }) });
      const d = await r.json(); return d?.choices?.[0]?.message?.content || '';
    };
    if (process.env.DEEPSEEK_API_KEY) probes.deepseek = async () => {
      const r = await fetch('https://api.deepseek.com/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.DEEPSEEK_API_KEY}`}, body: JSON.stringify({ model:'deepseek-chat', messages:[{ role:'user', content:factQ }] }) });
      const d = await r.json(); return d?.choices?.[0]?.message?.content || '';
    };

    const modelMeta = { chatgpt:'ChatGPT', claude:'Claude', gemini:'Gemini', perplexity:'Perplexity', deepseek:'DeepSeek' };
    const modelKeys = Object.keys(probes);

    const answers = await Promise.all(modelKeys.map(mk =>
      probes[mk]().then(text => ({ modelKey:mk, name:modelMeta[mk], text, error:null }))
                  .catch(e => ({ modelKey:mk, name:modelMeta[mk], text:'', error:e.message }))
    ));

    // 3) For each answer, use GPT-4o to grade accuracy vs the source.
    const grades = await Promise.all(answers.map(async ans => {
      if (!ans.text) {
        return { ...ans, accuracy:0, confirmedFacts:[], hallucinations:[], unverifiable:[], summary:'No answer received from model' };
      }
      try {
        const gradePrompt = `You are a fact-checker. Below is the AUTHORITATIVE SOURCE TEXT scraped from the company's own website, and an AI MODEL'S DESCRIPTION of the company. Grade the description for factual accuracy against the source.

AUTHORITATIVE SOURCE (from ${cleanDomain} homepage + about/products/services/pricing):
"""
${sourceText || '(could not scrape — treat any specific claim as unverifiable)'}
"""

MODEL: ${ans.name}
MODEL'S DESCRIPTION:
"""
${ans.text}
"""

Return ONLY JSON in this exact shape:
{
  "accuracy": <integer 0-100, where 100 = every specific claim matches the source>,
  "confirmedFacts":   [ "<short factual claim from the model that IS supported by the source>", ... up to 5 ],
  "hallucinations":   [ "<short factual claim the model made that CONTRADICTS the source or is clearly invented>", ... up to 5 ],
  "unverifiable":     [ "<claim that's plausible but the source doesn't confirm it either way>", ... up to 3 ],
  "summary": "<one-sentence verdict on this model's accuracy about the brand>"
}

Rules:
- Only count specific claims (products, prices, locations, headcount, founding year, named features, named customers, country). Ignore generic adjectives.
- A claim is a "hallucination" only if the source clearly says otherwise OR the claim is suspiciously specific with no source support.
- "Unverifiable" = plausible but unconfirmed (don't penalise heavily).
- If the source text is empty, return accuracy ~50 and put almost everything in unverifiable.`;

        const g = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 600,
          temperature: 0.1,
          response_format: { type:'json_object' },
          messages: [
            { role:'system', content:'You are a strict fact-checker. Output ONLY valid JSON.' },
            { role:'user', content: gradePrompt },
          ],
        });
        const raw = g.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);
        return {
          ...ans,
          accuracy: Math.max(0, Math.min(100, parseInt(parsed.accuracy, 10) || 0)),
          confirmedFacts:  Array.isArray(parsed.confirmedFacts)  ? parsed.confirmedFacts.slice(0,5)  : [],
          hallucinations:  Array.isArray(parsed.hallucinations)  ? parsed.hallucinations.slice(0,5)  : [],
          unverifiable:    Array.isArray(parsed.unverifiable)    ? parsed.unverifiable.slice(0,3)    : [],
          summary: String(parsed.summary || '').trim().slice(0, 240),
        };
      } catch (e) {
        return { ...ans, accuracy:0, confirmedFacts:[], hallucinations:[], unverifiable:[], summary:'Grading failed: ' + e.message };
      }
    }));

    const overallAccuracy = grades.length
      ? Math.round(grades.reduce((s,g) => s + (g.accuracy || 0), 0) / grades.length)
      : 0;
    const totalHallucinations = grades.reduce((s,g) => s + (g.hallucinations?.length || 0), 0);

    res.json({
      ok: true,
      domain: cleanDomain,
      sourceLength: sourceText.length,
      sourceFetched: sourceText.length > 200,
      models: grades,
      overallAccuracy,
      totalHallucinations,
      summary: { modelsGraded: grades.length, sourceChars: sourceText.length },
    });
  } catch (err) {
    console.error('/api/ai-visibility-accuracy error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── Shared probe builder used by competitors / sentiment / entity endpoints ──
function buildModelProbes() {
  const probes = {};
  probes.chatgpt = async (q, maxTokens=700) => {
    const c = await openai.chat.completions.create({ model:'gpt-4o', max_tokens:maxTokens, messages:[{ role:'user', content:q }] });
    return c.choices?.[0]?.message?.content?.trim() || '';
  };
  probes.claude = async (q, maxTokens=700) => {
    const c = await anthropic.messages.create({ model:'claude-sonnet-4-6', max_tokens:maxTokens, messages:[{ role:'user', content:q }] });
    return c.content?.[0]?.text?.trim() || '';
  };
  if (process.env.GEMINI_API_KEY) {
    probes.gemini = async (q) => {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{ parts:[{ text:q }] }] }) });
      const d = await r.json();
      return d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    };
  }
  if (process.env.PERPLEXITY_API_KEY) {
    probes.perplexity = async (q) => {
      const r = await fetch('https://api.perplexity.ai/chat/completions',
        { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`}, body: JSON.stringify({ model:'sonar', messages:[{ role:'user', content:q }] }) });
      const d = await r.json();
      return d?.choices?.[0]?.message?.content || '';
    };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    probes.deepseek = async (q) => {
      const r = await fetch('https://api.deepseek.com/chat/completions',
        { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.DEEPSEEK_API_KEY}`}, body: JSON.stringify({ model:'deepseek-chat', messages:[{ role:'user', content:q }] }) });
      const d = await r.json();
      return d?.choices?.[0]?.message?.content || '';
    };
  }
  return probes;
}
const MODEL_NAMES = { chatgpt:'ChatGPT', claude:'Claude', gemini:'Gemini', perplexity:'Perplexity', deepseek:'DeepSeek' };

// ── POST /api/ai-visibility-competitors ───────────────────────────────────────
// COMPETITIVE CITATION INTELLIGENCE — runs the same prompt set across every
// connected model for the user's brand AND every competitor domain, returning
// who wins each prompt and overall share-of-voice.
app.post('/api/ai-visibility-competitors', async (req, res) => {
  try {
    const { domain = 'yourdomain.com', industry = 'your industry', competitors = [] } = req.body || {};
    const cleanBrand = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();
    // Accept competitor entries as strings, or { domain/url, name, aliases }.
    // We track the domain (key) AND a list of human-readable aliases per brand
    // so detection works for short names like "IG" or "XM" that LLMs don't write
    // as "ig.com" / "xm.com".
    const aliasesByDomain = {};
    const compDomains = [];
    (Array.isArray(competitors) ? competitors : []).forEach(c => {
      const raw = typeof c === 'string' ? c : (c.domain || c.url || c.name || '');
      const dom = String(raw).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();
      if (!dom || !dom.includes('.') || dom === cleanBrand) return;
      if (compDomains.includes(dom)) return;
      compDomains.push(dom);
      const stem = dom.split('.')[0];
      const list = new Set([dom, stem]);
      if (typeof c === 'object' && c) {
        if (c.name)    list.add(String(c.name).toLowerCase().trim());
        if (Array.isArray(c.aliases)) c.aliases.forEach(a => a && list.add(String(a).toLowerCase().trim()));
      }
      aliasesByDomain[dom] = Array.from(list).filter(Boolean);
    });
    const compDomainsTrim = compDomains.slice(0, 8);
    const allDomains = [cleanBrand, ...compDomainsTrim];
    aliasesByDomain[cleanBrand] = aliasesByDomain[cleanBrand] || [cleanBrand, cleanBrand.split('.')[0]];
    if (allDomains.length < 2) return res.json({ ok:true, domains:allDomains, prompts:[], matrix:[], shareOfVoice:{}, note:'No competitor domains supplied.' });

    const indWord = String(industry).split(' ')[0];
    // Build a human-readable brand roster so prompts can FORCE every model to
    // explicitly evaluate each competitor (otherwise smaller brands like
    // Plus500 / AvaTrade are routinely truncated out of "top 5" lists).
    const rosterNames = allDomains.map(d => {
      const aliases = aliasesByDomain[d] || [];
      const human = aliases.find(a => !a.includes('.') && a.length > 2) || d.split('.')[0];
      return human.charAt(0).toUpperCase() + human.slice(1);
    });
    const roster = rosterNames.join(', ');
    const tail = ` Please evaluate EACH of these brands by name and explain why each one is or isn't a leading choice: ${roster}. Mention every brand at least once.`;
    const prompts = [
      { id:'best',        cat:'Best-of',     q:`What are the best ${industry} companies in 2025?` + tail },
      { id:'compare',     cat:'Comparison',  q:`Compare the top ${industry} platforms — pros and cons of each.` + tail },
      { id:'recommend',   cat:'Recommend',   q:`Recommend the right ${industry} solution for a growing business — reviewing each option.` + tail },
      { id:'alternatives',cat:'Alternatives',q:`What are the leading alternatives to ${cleanBrand} for ${industry}? Discuss each candidate.` + tail },
      { id:'reviews',     cat:'Reviews',     q:`Which ${indWord.toLowerCase()} brands get the best customer reviews?` + tail },
      { id:'pricing',     cat:'Pricing',     q:`Most cost-effective ${industry} platforms — who offers the best value?` + tail },
    ];

    const probes = buildModelProbes();
    const modelKeys = Object.keys(probes);
    const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Detect a brand by ANY of its aliases. Short stems (<3 chars) are still
    // accepted but only inside strict word boundaries to avoid false positives.
    const detect = (text, dom) => {
      if (!text) return false;
      const t = text.toLowerCase();
      const aliases = aliasesByDomain[dom] || [dom, dom.split('.')[0]];
      for (const a of aliases) {
        if (!a) continue;
        if (a.includes('.') && t.includes(a)) return true;            // domain literal
        if (a.length >= 2 && new RegExp(`\\b${escapeRe(a)}\\b`).test(t)) return true;
      }
      return false;
    };

    const cellPromises = [];
    prompts.forEach((p, i) => modelKeys.forEach(mk => {
      cellPromises.push(probes[mk](p.q).then(text => ({ promptIdx:i, modelKey:mk, text }))
        .catch(e => ({ promptIdx:i, modelKey:mk, text:'', error:e.message })));
    }));
    const cells = await Promise.all(cellPromises);

    // Per-prompt: who got cited?
    const matrix = prompts.map((p, i) => {
      const cited = {};
      allDomains.forEach(d => { cited[d] = 0; });
      const perModel = modelKeys.map(mk => {
        const c = cells.find(x => x.promptIdx === i && x.modelKey === mk) || { text:'' };
        const hits = allDomains.filter(d => detect(c.text, d));
        hits.forEach(d => { cited[d] = (cited[d] || 0) + 1; });
        return { modelKey:mk, modelName:MODEL_NAMES[mk]||mk, cited:hits, snippet:(c.text||'').slice(0,260), error:c.error };
      });
      const winner = Object.entries(cited).sort((a,b) => b[1] - a[1])[0];
      return { promptId:p.id, cat:p.cat, prompt:p.q, perModel, citedCount:cited, winner:(winner && winner[1]>0)?winner[0]:null };
    });

    // Share of voice across the whole matrix (per domain).
    const shareOfVoice = {};
    allDomains.forEach(d => { shareOfVoice[d] = 0; });
    let totalCells = 0;
    matrix.forEach(row => row.perModel.forEach(m => {
      if (m.error) return;
      totalCells++;
      m.cited.forEach(d => { shareOfVoice[d] = (shareOfVoice[d] || 0) + 1; });
    }));
    const shareOfVoicePct = {};
    Object.entries(shareOfVoice).forEach(([d,n]) => { shareOfVoicePct[d] = totalCells ? Math.round(n / totalCells * 100) : 0; });

    // "Rivals overtaking you" — prompts where a competitor is cited but you are not.
    const rivalAlerts = matrix.filter(row => {
      const yours = row.citedCount[cleanBrand] || 0;
      const rivalsHit = compDomainsTrim.some(d => (row.citedCount[d] || 0) > yours);
      return yours === 0 && rivalsHit;
    }).map(row => ({
      prompt: row.prompt, cat: row.cat,
      winners: Object.entries(row.citedCount).filter(([d,n]) => n>0 && d!==cleanBrand).map(([d,n]) => ({ domain:d, hits:n })).sort((a,b)=>b.hits-a.hits)
    }));

    res.json({ ok:true, domains:allDomains, brand:cleanBrand, competitors:compDomainsTrim, aliasesByDomain, modelKeys, prompts, matrix, shareOfVoice, shareOfVoicePct, rivalAlerts,
      summary:{ promptsRun:prompts.length, modelsRun:modelKeys.length, domainsRun:allDomains.length, rivalAlertCount:rivalAlerts.length } });
  } catch (err) {
    console.error('/api/ai-visibility-competitors error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── POST /api/ai-visibility-entity ────────────────────────────────────────────
// ENTITY IDENTIFICATION & MAPPING — asks each model to describe the brand as a
// knowledge-graph entity (category, attributes, relationships, positioning),
// then GPT-4o consolidates a unified entity profile + flags inconsistencies.
app.post('/api/ai-visibility-entity', async (req, res) => {
  try {
    const { domain = 'yourdomain.com', industry = 'your industry' } = req.body || {};
    const cleanDomain = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();

    const probes = buildModelProbes();
    const modelKeys = Object.keys(probes);
    const entityPrompt = `Describe "${cleanDomain}" as a knowledge-graph entity. Return ONLY strict JSON (no prose, no markdown) with these exact keys:
{
 "category": "primary category (e.g. 'SaaS analytics platform')",
 "subCategories": ["up to 3 sub-categories"],
 "attributes": ["up to 6 short defining attributes"],
 "competitors": ["up to 5 competitor brand names"],
 "customers": ["up to 4 customer segments served"],
 "founded": "year or 'unknown'",
 "headquarters": "city, country or 'unknown'",
 "positioning": "one sentence brand positioning"
}`;

    const calls = await Promise.all(modelKeys.map(async mk => {
      try {
        const text = await probes[mk](entityPrompt, 500);
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return { modelKey:mk, modelName:MODEL_NAMES[mk]||mk, error:'no JSON returned', raw:text.slice(0,200) };
        const parsed = JSON.parse(m[0]);
        return { modelKey:mk, modelName:MODEL_NAMES[mk]||mk, entity:parsed };
      } catch (e) {
        return { modelKey:mk, modelName:MODEL_NAMES[mk]||mk, error:e.message };
      }
    }));

    const valid = calls.filter(c => c.entity);
    // Consolidate via GPT-4o.
    let consolidated = null, inconsistencies = [];
    if (valid.length) {
      try {
        const consolidationPrompt = `You are reconciling how multiple AI models describe the same brand. Below are JSON entity profiles for "${cleanDomain}" from ${valid.length} different models. Build (a) a CONSOLIDATED entity (most-agreed values) and (b) a list of INCONSISTENCIES (specific claims that disagree across models or look wrong).

Profiles:
${valid.map(v => `### ${v.modelName}\n${JSON.stringify(v.entity, null, 2)}`).join('\n\n')}

Return ONLY strict JSON:
{
 "consolidated": { "category":"", "subCategories":[], "attributes":[], "competitors":[], "customers":[], "founded":"", "headquarters":"", "positioning":"" },
 "inconsistencies": [{"field":"category","issue":"Model X says A, Model Y says B"}],
 "agreementScore": 0
}
agreementScore is 0-100 (how well the models agree on this brand's identity).`;
        const c = await openai.chat.completions.create({ model:'gpt-4o', max_tokens:900, messages:[{ role:'user', content:consolidationPrompt }], response_format:{ type:'json_object' } });
        const j = JSON.parse(c.choices?.[0]?.message?.content || '{}');
        consolidated = j.consolidated || null;
        inconsistencies = Array.isArray(j.inconsistencies) ? j.inconsistencies : [];
        var agreementScore = typeof j.agreementScore === 'number' ? j.agreementScore : 50;
      } catch (e) {
        console.warn('[entity] consolidation failed:', e.message);
      }
    }

    res.json({ ok:true, domain:cleanDomain, modelKeys, perModel:calls, consolidated, inconsistencies,
      agreementScore: typeof agreementScore !== 'undefined' ? agreementScore : (valid.length ? 60 : 0),
      summary:{ modelsRun:modelKeys.length, modelsValid:valid.length, inconsistencyCount:inconsistencies.length } });
  } catch (err) {
    console.error('/api/ai-visibility-entity error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── POST /api/ai-visibility-sentiment ─────────────────────────────────────────
// SENTIMENT & CONTEXT ANALYSIS — asks each model how it describes the brand,
// then GPT-4o grades each answer for sentiment + flags narrative gaps
// (mischaracterisations vs. what the brand actually does).
app.post('/api/ai-visibility-sentiment', async (req, res) => {
  try {
    const { domain = 'yourdomain.com', industry = 'your industry' } = req.body || {};
    const cleanDomain = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();

    const probes = buildModelProbes();
    const modelKeys = Object.keys(probes);
    const q = `What do users and the market generally say about ${cleanDomain}? Mention their reputation, strengths, and any common complaints. Be specific in 4-6 sentences.`;

    const answers = await Promise.all(modelKeys.map(mk =>
      probes[mk](q, 350).then(text => ({ modelKey:mk, modelName:MODEL_NAMES[mk]||mk, text }))
        .catch(e => ({ modelKey:mk, modelName:MODEL_NAMES[mk]||mk, text:'', error:e.message }))
    ));

    // Grade each answer.
    const graded = await Promise.all(answers.map(async a => {
      if (!a.text) return { ...a, sentiment:'unknown', score:0, narrativeGap:null, positives:[], negatives:[] };
      try {
        const gp = `Grade this AI-generated description of "${cleanDomain}" (a ${industry} brand). Return ONLY strict JSON:
{"sentiment":"positive|neutral|negative|mixed","score":-100..100,"positives":["short bullets"],"negatives":["short bullets"],"narrativeGap":"one sentence on whether the model mischaracterises the brand or 'none'"}

Description to grade:
"""${a.text}"""`;
        const c = await openai.chat.completions.create({ model:'gpt-4o-mini', max_tokens:400, messages:[{ role:'user', content:gp }], response_format:{ type:'json_object' } });
        const j = JSON.parse(c.choices?.[0]?.message?.content || '{}');
        return { ...a, sentiment:j.sentiment||'neutral', score:Number(j.score)||0, positives:j.positives||[], negatives:j.negatives||[], narrativeGap:j.narrativeGap||null };
      } catch (e) {
        return { ...a, sentiment:'neutral', score:0, narrativeGap:null, positives:[], negatives:[], gradeError:e.message };
      }
    }));

    const valid = graded.filter(g => !g.error && g.sentiment !== 'unknown');
    const dist = { positive:0, neutral:0, negative:0, mixed:0 };
    valid.forEach(g => { dist[g.sentiment] = (dist[g.sentiment] || 0) + 1; });
    const avgScore = valid.length ? Math.round(valid.reduce((s,g)=>s+g.score,0) / valid.length) : 0;
    const narrativeGaps = graded.filter(g => g.narrativeGap && g.narrativeGap.toLowerCase() !== 'none').map(g => ({ model:g.modelName, gap:g.narrativeGap }));

    res.json({ ok:true, domain:cleanDomain, modelKeys, perModel:graded, distribution:dist, avgScore, narrativeGaps,
      summary:{ modelsRun:modelKeys.length, modelsValid:valid.length, narrativeGapCount:narrativeGaps.length } });
  } catch (err) {
    console.error('/api/ai-visibility-sentiment error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── POST /api/ai-visibility-sge ───────────────────────────────────────────────
// REAL GOOGLE AI OVERVIEW / SGE TRACKING — uses DataForSEO `ai_mode` (and
// `ai_overview` items in regular SERP) to detect actual AI Overview presence,
// position, and citation frequency for the brand domain.
app.post('/api/ai-visibility-sge', async (req, res) => {
  try {
    const { domain = 'yourdomain.com', industry = 'your industry' } = req.body || {};
    if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
      return res.json({ ok:true, configured:false, note:'DataForSEO credentials not set — SGE tracking unavailable.', queries:[] });
    }
    const cleanDomain = String(domain).replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();
    const brandStem = cleanDomain.split('.')[0];
    const indWord = String(industry).split(' ')[0].toLowerCase();
    const queries = [
      `best ${industry} platform`,
      `${cleanDomain} review`,
      `how to choose a ${indWord} tool`,
      `${industry} alternatives`,
      `top ${industry} companies 2025`,
    ];
    const auth = 'Basic ' + Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');

    const results = await Promise.all(queries.map(async q => {
      try {
        const r = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
          method:'POST', headers:{ 'Authorization':auth, 'Content-Type':'application/json' },
          body: JSON.stringify([{ keyword:q, location_code:2840, language_code:'en', depth:20 }]),
        });
        const j = await r.json();
        const items = j?.tasks?.[0]?.result?.[0]?.items || [];
        const aiOverview = items.find(it => it.type === 'ai_overview');
        const aiCited = aiOverview ? (aiOverview.references || aiOverview.items || []).some(ref => {
          const u = (ref.url || ref.link || ref.domain || '').toLowerCase();
          return u.includes(cleanDomain) || (brandStem.length>=4 && u.includes(brandStem));
        }) : false;
        const organicPos = items.filter(it => it.type === 'organic').findIndex(it => (it.domain||'').toLowerCase().includes(cleanDomain));
        return {
          query:q,
          aiOverviewPresent: !!aiOverview,
          aiOverviewCitesYou: aiCited,
          aiOverviewSourceCount: aiOverview ? (aiOverview.references?.length || aiOverview.items?.length || 0) : 0,
          organicPosition: organicPos >= 0 ? organicPos + 1 : null,
        };
      } catch (e) {
        return { query:q, error:e.message };
      }
    }));

    const valid = results.filter(r => !r.error);
    const presentCount = valid.filter(r => r.aiOverviewPresent).length;
    const citedCount = valid.filter(r => r.aiOverviewCitesYou).length;
    const presenceRate = valid.length ? Math.round(presentCount/valid.length*100) : 0;
    const citationRate = presentCount ? Math.round(citedCount/presentCount*100) : 0;

    res.json({ ok:true, configured:true, domain:cleanDomain, queries:results,
      summary:{ queriesRun:valid.length, sgePresentCount:presentCount, sgeCitesYouCount:citedCount, sgePresenceRate:presenceRate, sgeCitationRate:citationRate } });
  } catch (err) {
    console.error('/api/ai-visibility-sge error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── POST /api/ai-visibility-attribution ───────────────────────────────────────
// CITATION-TO-TRAFFIC ATTRIBUTION — uses Amplitude Dashboard REST API to count
// sessions whose initial referrer matches a known AI source (chatgpt.com,
// perplexity.ai, gemini.google.com, etc.). Falls back gracefully if the
// AMPLITUDE_SECRET_KEY is missing.
app.post('/api/ai-visibility-attribution', async (req, res) => {
  try {
    const apiKey = process.env.AMPLITUDE_API_KEY;
    const secretKey = process.env.AMPLITUDE_SECRET_KEY;
    const aiSources = [
      { id:'chatgpt',    label:'ChatGPT',    domain:'chat.openai.com|chatgpt.com' },
      { id:'perplexity', label:'Perplexity', domain:'perplexity.ai' },
      { id:'gemini',     label:'Gemini',     domain:'gemini.google.com|bard.google.com' },
      { id:'claude',     label:'Claude',     domain:'claude.ai' },
      { id:'copilot',    label:'Copilot',    domain:'copilot.microsoft.com|bing.com/chat' },
      { id:'googleAi',   label:'Google AI Overview', domain:'google.com' },
    ];

    if (!apiKey || !secretKey) {
      return res.json({ ok:true, connected:false,
        missing: !apiKey ? 'AMPLITUDE_API_KEY' : 'AMPLITUDE_SECRET_KEY',
        note: !apiKey
          ? 'Connect your Amplitude project (API key) to track AI referral traffic.'
          : 'AMPLITUDE_API_KEY found, but the Dashboard REST API also needs an AMPLITUDE_SECRET_KEY (Amplitude → Settings → Projects → API Key + Secret).',
        aiSources, sessions:[], totalAiSessions:0, totalSessions:0, aiShare:0 });
    }

    const auth = 'Basic ' + Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    // Amplitude Dashboard REST API — segmentation by referring_domain for last 30 days.
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30);
    const fmt = d => d.toISOString().slice(0,10).replace(/-/g,'');
    const e = encodeURIComponent(JSON.stringify({ event_type:'_active' }));

    const fetchSessions = async (filterValue) => {
      const seg = filterValue ? '&s=' + encodeURIComponent(JSON.stringify([{ prop:'referring_domain', op:'is', values:[filterValue] }])) : '';
      const url = `https://amplitude.com/api/2/sessions/average?start=${fmt(start)}&end=${fmt(end)}&e=${e}${seg}`;
      const r = await fetch(url, { headers:{ Authorization:auth } });
      const j = await r.json();
      return j;
    };

    let totalSessions = 0;
    try {
      const totalJ = await fetchSessions(null);
      totalSessions = (totalJ?.data?.series?.[0] || []).reduce((s,n)=>s+(Number(n)||0),0);
    } catch (e) { console.warn('[attribution] total fetch failed:', e.message); }

    const sessions = await Promise.all(aiSources.map(async s => {
      try {
        const domains = s.domain.split('|');
        const counts = await Promise.all(domains.map(d => fetchSessions(d).then(j => (j?.data?.series?.[0] || []).reduce((a,n)=>a+(Number(n)||0),0)).catch(()=>0)));
        const total = counts.reduce((a,b)=>a+b,0);
        return { ...s, sessions:total };
      } catch (e) { return { ...s, sessions:0, error:e.message }; }
    }));
    const totalAi = sessions.reduce((s,x)=>s+(x.sessions||0),0);
    const aiShare = totalSessions ? +(totalAi/totalSessions*100).toFixed(2) : 0;

    res.json({ ok:true, connected:true, windowDays:30, sessions, totalAiSessions:totalAi, totalSessions, aiShare });
  } catch (err) {
    console.error('/api/ai-visibility-attribution error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});
};
