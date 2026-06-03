// AI quick · forecast · budget-efficiency · counter-message routes.
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

app.post('/api/ai-quick', async (req, res) => {
  try {
    const prompt = String((req.body && req.body.prompt) || '').slice(0, 4000);
    if (!prompt) return res.status(400).json({ ok:false, error:'prompt required', text:'' });

    // ── Try OpenAI first ────────────────────────────────────────────────────
    const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || '';
    if (openaiKey && !/^_DUMMY/i.test(openaiKey)) {
      try {
        const c = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role:'user', content: prompt }],
          max_tokens: 200, temperature: 0.6,
        });
        const text = (c.choices && c.choices[0] && c.choices[0].message && c.choices[0].message.content || '').trim();
        return res.json({ ok:true, text });
      } catch (_) { /* fall through to next model */ }
    }

    // ── Fallback: Gemini Flash ──────────────────────────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY || '';
    if (geminiKey) {
      try {
        const gr = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 200, temperature: 0.6 } }) }
        );
        const gj = await gr.json();
        const text = (gj?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (text) return res.json({ ok:true, text });
      } catch (_) { /* fall through */ }
    }

    // ── Fallback: Perplexity ────────────────────────────────────────────────
    const perplexityKey = process.env.PERPLEXITY_API_KEY || '';
    if (perplexityKey) {
      try {
        const pr = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${perplexityKey}` },
          body: JSON.stringify({ model: 'llama-3.1-sonar-small-128k-online',
            messages: [{ role:'user', content: prompt }], max_tokens: 200, temperature: 0.6 }),
        });
        const pj = await pr.json();
        const text = (pj?.choices?.[0]?.message?.content || '').trim();
        if (text) return res.json({ ok:true, text });
      } catch (_) { /* fall through */ }
    }

    return res.status(503).json({ ok:false, error:'No AI model available — configure OpenAI, Gemini, or Perplexity', text:'' });
  } catch (e) { res.status(500).json({ ok:false, error: e.message, text:'' }); }
});

app.post('/api/ai-forecast', async (req, res) => {
  const { domain = 'yourdomain.com', industry = 'marketing', competitors = [], currentROAS = 3.2, monthlyBudget = 5000, trafficMo = 10000 } = req.body;
  const weeklyBase = Math.round((monthlyBudget || 5000) * (currentROAS || 3.2) / 4.33);

  function buildFallbackWeeks(startMultiplier, endMultiplier, wobble = 0.04) {
    return Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      const curve = startMultiplier + (endMultiplier - startMultiplier) * (1 - Math.pow(1 - t, 2.2));
      const noise = 1 + (Math.random() * 2 - 1) * wobble;
      return Math.round(weeklyBase * curve * noise);
    });
  }

  try {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) throw new Error('openai key not configured');
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4o', response_format: { type: 'json_object' }, max_tokens: 1000,
        messages: [
          { role: 'system', content: 'You are a senior performance marketing analyst. Return ONLY valid JSON, no markdown.' },
          { role: 'user', content: `Generate a realistic 90-day WEEKLY revenue forecast for a ${industry} company (${domain}). Current ROAS: ${currentROAS}×, weekly ad budget: ~$${Math.round((monthlyBudget||5000)/4.33)}, monthly traffic: ${trafficMo}.
Rules: values must GROW week-over-week with natural variance (not flat lines). Week 1 starts slow (AI learning phase), accelerates mid-run, levels off slightly near week 13. The 3 scenarios must diverge meaningfully.
Return ONLY this JSON with exactly 13 weekly values each:
{"weeks":["Wk 1","Wk 2","Wk 3","Wk 4","Wk 5","Wk 6","Wk 7","Wk 8","Wk 9","Wk 10","Wk 11","Wk 12","Wk 13"],"projectedRevenue":[13 integers growing from ~${Math.round(weeklyBase*0.9)} to ~${Math.round(weeklyBase*1.55)}],"conservativeRevenue":[13 integers growing from ~${Math.round(weeklyBase*0.78)} to ~${Math.round(weeklyBase*1.28)}],"optimisticRevenue":[13 integers growing from ~${Math.round(weeklyBase*1.05)} to ~${Math.round(weeklyBase*2.1)}],"projectedROAS":[13 floats growing from ${(currentROAS*0.95).toFixed(1)} to ${(currentROAS*1.38).toFixed(1)}],"keyMilestones":[{"week":1,"milestone":"text"},{"week":4,"milestone":"text"},{"week":8,"milestone":"text"},{"week":13,"milestone":"text"}],"totalProjectedRevenue":integer,"confidenceLevel":"High","reasoning":"2 sentences"}` }
        ]
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('openai_timeout_15s')), 15000))
    ]);
    const parsed = JSON.parse(completion.choices[0].message.content);
    if (!Array.isArray(parsed.projectedRevenue) || parsed.projectedRevenue.length < 3) throw new Error('bad shape');
    res.json({ success: true, ...parsed });
  } catch(e) {
    console.error('[ai-forecast]', e.message);
    res.json({ success: true,
      weeks: ['Wk 1','Wk 2','Wk 3','Wk 4','Wk 5','Wk 6','Wk 7','Wk 8','Wk 9','Wk 10','Wk 11','Wk 12','Wk 13'],
      projectedRevenue:    buildFallbackWeeks(0.88, 1.55, 0.03),
      conservativeRevenue: buildFallbackWeeks(0.76, 1.25, 0.02),
      optimisticRevenue:   buildFallbackWeeks(1.02, 2.08, 0.05),
      projectedROAS: Array.from({length:13},(_,i)=> +((currentROAS * (1 + 0.38 * (i/12))).toFixed(2))),
      keyMilestones: [
        { week: 1,  milestone: 'AI campaign optimisation begins, competitor keywords targeted' },
        { week: 4,  milestone: 'CTR improvements visible, keyword gap closed by 40%' },
        { week: 8,  milestone: 'Audience lookalikes refined, CPA dropping 20%' },
        { week: 13, milestone: 'Full 90-day ROAS uplift realised, retargeting maximised' }
      ],
      totalProjectedRevenue: Math.round(weeklyBase * 13 * 1.38), confidenceLevel: 'Medium',
      reasoning: `Based on ${industry} industry benchmarks. AI optimisation typically improves ROAS 15-38% over 90 days through continuous keyword and audience refinement.`
    });
  }
});

// ── AI Budget Efficiency Scorer ───────────────────────────────────────────────
app.post('/api/budget-efficiency', async (req, res) => {
  const { industry = 'marketing', competitors = [], monthlyBudget = 5000 } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', response_format: { type: 'json_object' }, max_tokens: 600,
      messages: [
        { role: 'system', content: 'Return ONLY valid JSON, no markdown.' },
        { role: 'user', content: `Score budget efficiency for 5 ad channels for a ${industry} business with $${monthlyBudget}/mo budget vs competitors: ${competitors.slice(0,4).join(', ')}.
Return only this JSON:
{"channels":[{"name":"Google Search Ads","score":85,"roi":"3.8x","recommendation":"text"},{"name":"Meta/Instagram","score":72,"roi":"2.9x","recommendation":"text"},{"name":"TikTok Ads","score":65,"roi":"2.4x","recommendation":"text"},{"name":"SEO/Content","score":80,"roi":"5.1x","recommendation":"text"},{"name":"YouTube Ads","score":60,"roi":"2.1x","recommendation":"text"}],"topChannel":"Google Search Ads","insight":"1 sentence about the single biggest efficiency opportunity"}` }
      ]
    });
    res.json({ success: true, ...JSON.parse(completion.choices[0].message.content) });
  } catch(e) {
    console.error('[budget-efficiency]', e.message);
    res.json({ success: true,
      channels: [
        { name: 'Google Search Ads', score: 87, roi: '3.8×', recommendation: 'Highest intent traffic — prioritise for direct conversions' },
        { name: 'Meta/Instagram',    score: 74, roi: '2.9×', recommendation: 'Strong retargeting and lookalike audience performance' },
        { name: 'TikTok Ads',        score: 66, roi: '2.4×', recommendation: 'Growing audience, high engagement for brand awareness' },
        { name: 'SEO/Content',       score: 82, roi: '5.1×', recommendation: 'Best long-term ROI — compounding returns over 6-12 months' },
        { name: 'YouTube Ads',       score: 61, roi: '2.1×', recommendation: 'Effective for top-of-funnel brand building at scale' }
      ],
      topChannel: 'Google Search Ads',
      insight: `Allocating 40% of your $${(monthlyBudget||5000).toLocaleString()}/mo to Google Search Ads gives the highest immediate ROI in ${industry}.`
    });
  }
});

// ── AI Counter-Message Generator (Win/Loss Intelligence) ──────────────────────
// Takes a competitor's winning message + exploitable weakness and asks an LLM
// to generate 3 counter-message variants tailored to neutralise the competitor.
// Tries OpenAI first, falls back to Anthropic, then to a deterministic template.
app.post('/api/wl/counter-message', async (req, res) => {
 try {
  const {
    comp     = 'Competitor',
    channel  = 'Google Ads',
    lossRate = '30%',
    message  = '',
    weakness = '',
    yourBrand = '',
    industry  = 'marketing'
  } = req.body || {};

  const yourBrandClean = String(yourBrand || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || 'Your brand';

  const systemPrompt = 'You are a senior performance-marketing copywriter who writes high-converting counter-positioning ad messages. You write tight, punchy copy that exploits a competitor\'s specific weakness. Return ONLY valid JSON, no markdown, no commentary.';

  const userPrompt = `Generate 3 distinct counter-ad-messages for ${yourBrandClean} to deploy against ${comp} on ${channel}.

CONTEXT
- Industry: ${industry}
- Competitor: ${comp}
- Channel: ${channel}
- Current loss rate to this competitor: ${lossRate} of deals
- ${comp}'s winning message: "${message}"
- ${comp}'s exploitable weakness: "${weakness}"

REQUIREMENTS
- Each variant must directly attack the named weakness above (do NOT generate generic copy).
- Each variant should feel native to ${channel} (length, tone, format).
- Headlines: max 60 characters. Body: max 140 characters. CTA: 2-4 words.
- Use a different angle for each variant (e.g. social-proof, contrast, value-prop, FOMO, transparency).
- Mention what ${yourBrandClean} does BETTER — never name ${comp} directly in the ad copy (compliance).

Return ONLY this JSON shape:
{"variants":[{"angle":"short label","headline":"...","body":"...","cta":"...","why":"1 sentence on why this neutralises the weakness"},{"angle":"...","headline":"...","body":"...","cta":"...","why":"..."},{"angle":"...","headline":"...","body":"...","cta":"...","why":"..."}],"strategy":"2-3 sentence overall counter-positioning strategy","targeting":"1 sentence on which audience segment to target with these"}`;

  // ── Run ALL available AIs in PARALLEL ──
  // Each provider returns ONE variant tagged with its source. The blender
  // below merges them into a single response so the user sees genuine
  // multi-LLM output (OpenAI + Claude + Perplexity + Gemini) instead of
  // serial fallback. If a provider fails or is not configured, it's silently
  // dropped — only successful variants make it to the user.
  const _stripFences = t => { const m = String(t||'').match(/\{[\s\S]*\}/); return m ? m[0] : ''; };
  const _normVariants = (parsed, src) => {
    if (!parsed) return [];
    const arr = Array.isArray(parsed.variants) ? parsed.variants : [];
    return arr.slice(0, 2).map(v => ({
      angle:    String(v.angle    || src),
      headline: String(v.headline || ''),
      body:     String(v.body     || ''),
      cta:      String(v.cta      || 'Learn More'),
      why:      String(v.why      || ''),
      _source:  src,
    })).filter(v => v.headline && v.body);
  };

  const tasks = [];
  const sysJsonOnly = systemPrompt + ' Output ONLY the JSON object — no markdown, no surrounding prose.';

  // OpenAI GPT-4o
  const okKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (okKey && !/^_DUMMY/i.test(okKey)) tasks.push((async () => {
    try {
      const c = await openai.chat.completions.create({
        model: 'gpt-4o', response_format: { type: 'json_object' },
        max_tokens: 700, temperature: 0.75,
        messages: [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }],
      });
      const parsed = JSON.parse(c.choices[0].message.content);
      return { provider:'openai', label:'⚡ OpenAI GPT-4o', variants:_normVariants(parsed,'OpenAI GPT-4o'),
               strategy:parsed.strategy||'', targeting:parsed.targeting||'' };
    } catch(e) { console.warn('[wl-counter] OpenAI:', e.message); return null; }
  })());

  // Anthropic Claude
  const akKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (akKey && !/^_DUMMY/i.test(akKey)) tasks.push((async () => {
    try {
      const m = await anthropic.messages.create({
        model:'claude-sonnet-4-6', max_tokens:700,
        system:sysJsonOnly, messages:[{ role:'user', content:userPrompt }],
      });
      const txt = (m.content||[]).map(c=>c&&c.text?c.text:'').join('').trim();
      const j = _stripFences(txt); if (!j) return null;
      const parsed = JSON.parse(j);
      return { provider:'anthropic', label:'🧠 Claude Sonnet', variants:_normVariants(parsed,'Claude Sonnet'),
               strategy:parsed.strategy||'', targeting:parsed.targeting||'' };
    } catch(e) { console.warn('[wl-counter] Claude:', e.message); return null; }
  })());

  // Perplexity Sonar
  if (process.env.PERPLEXITY_API_KEY) tasks.push((async () => {
    try {
      const r = await fetch('https://api.perplexity.ai/chat/completions', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}` },
        body: JSON.stringify({ model:'sonar', max_tokens:700,
          messages:[{ role:'system', content:sysJsonOnly }, { role:'user', content:userPrompt }] }),
      });
      const d = await r.json();
      const txt = d?.choices?.[0]?.message?.content || '';
      const j = _stripFences(txt); if (!j) return null;
      const parsed = JSON.parse(j);
      return { provider:'perplexity', label:'🔎 Perplexity Sonar', variants:_normVariants(parsed,'Perplexity Sonar'),
               strategy:parsed.strategy||'', targeting:parsed.targeting||'' };
    } catch(e) { console.warn('[wl-counter] Perplexity:', e.message); return null; }
  })());

  // Gemini Flash
  if (process.env.GEMINI_API_KEY) tasks.push((async () => {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ contents:[{ parts:[{ text: sysJsonOnly + '\n\n' + userPrompt }] }],
          generationConfig:{ temperature:0.75, maxOutputTokens:700, responseMimeType:'application/json' } }),
      });
      const d = await r.json();
      const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const j = _stripFences(txt); if (!j) return null;
      const parsed = JSON.parse(j);
      return { provider:'gemini', label:'✨ Gemini Flash', variants:_normVariants(parsed,'Gemini Flash'),
               strategy:parsed.strategy||'', targeting:parsed.targeting||'' };
    } catch(e) { console.warn('[wl-counter] Gemini:', e.message); return null; }
  })());

  {
    const settled = await Promise.all(tasks);
    const ok = settled.filter(x => x && x.variants && x.variants.length);
    if (ok.length) {
      // Take the first variant from each provider so the user sees true
      // multi-AI variety. Cap at 6 total.
      const variants = [];
      for (const r of ok) variants.push(...r.variants.slice(0, Math.max(1, Math.ceil(6/ok.length))));
      const trimmed = variants.slice(0, 6);
      // Pick the longest non-empty strategy / targeting from any provider.
      const pickLongest = key => ok.map(r => r[key]||'').sort((a,b)=>b.length-a.length)[0] || '';
      return res.json({
        success: true,
        source:  ok.length > 1 ? 'multi-ai' : ok[0].provider,
        providers: ok.map(r => r.label),
        variants: trimmed,
        strategy:  pickLongest('strategy'),
        targeting: pickLongest('targeting'),
      });
    }
    // No provider succeeded — fall through to template.
    console.error('[wl-counter] All AI providers failed or returned empty');
    {
      const anthropicErr = new Error('all providers failed');
      const openaiErr = anthropicErr;

      // ── Final deterministic fallback ──
      const w = String(weakness || 'over-indexing on brand terms').replace(/^Outflank\s+\w+\s+on\s+/i, '');
      return res.json({
        success: true,
        source:  'fallback',
        variants: [
          {
            angle:    'Direct Contrast',
            headline: `${yourBrandClean}: Where ${comp.split(' ')[0]} Falls Short`,
            body:     `Don't settle for ${w}. Get the full picture — better data, real results.`,
            cta:      'See the Difference',
            why:      `Directly contrasts ${yourBrandClean}'s strength against ${comp}'s identified weakness.`
          },
          {
            angle:    'Social Proof',
            headline: `Why Smart Marketers Switched to ${yourBrandClean}`,
            body:     `Teams who needed more than ${w.split(' ').slice(0,6).join(' ')}… chose us. Here's why.`,
            cta:      'Read the Stories',
            why:      `Leverages credibility to peel away prospects already frustrated by ${comp}'s gap.`
          },
          {
            angle:    'Transparency',
            headline: `No Tricks. No ${w.split(' ').slice(0,3).join(' ')}.`,
            body:     `${yourBrandClean} shows you exactly what works — and what doesn't. Try it free.`,
            cta:      'Start Free',
            why:      `Reframes ${comp}'s weakness as a category-wide problem ${yourBrandClean} solves head-on.`
          }
        ],
        strategy: `Position ${yourBrandClean} as the transparent, results-focused alternative to ${comp}. Lead with the gap their "${(message||'').substring(0,50)}…" leaves open, then close with proof. (AI providers temporarily unavailable — generic counter-positioning template shown.)`,
        targeting: `Target ${comp}'s branded keyword pool + lookalike audiences on ${channel} with this counter-ad.`
      });
    }
  }
 } catch (outerErr) {
   console.error('[wl-counter] outer handler crashed:', outerErr && outerErr.message);
   if (!res.headersSent) return res.status(500).json({ success:false, error: outerErr && outerErr.message || 'unknown error' });
 }
});
};
