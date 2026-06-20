// AI visibility/brand/content generation suite routes.
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
  const { _tkvCtx, anthropic, callDataForSEO, callRapidAPI, getDataForSEOAuth, getRapidApiKey, https, loadAivisHistory, openai, path } = ctx;

app.get('/api/ai-visibility-trend', async (req, res) => {
  try {
    const cleanDomain = String(req.query.domain || '').replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase();
    if (!cleanDomain) return res.json({ ok:true, domain:'', runs:[], series:{}, deltas:{} });
    const tid = await _tkvCtx.resolveTenantId(req, { label: 'aivis:trend' });
    const h = await loadAivisHistory(tid);
    const runs = (h[cleanDomain] || []).slice(-30); // last 30 runs

    // Build per-model series.
    const series = { overall: runs.map(r => ({ ts:r.ts, value: Math.round((r.overallCoverage||0)*100) })) };
    const allModels = new Set();
    runs.forEach(r => Object.keys(r.coverageByModel || {}).forEach(k => allModels.add(k)));
    allModels.forEach(mk => {
      series[mk] = runs.map(r => ({ ts:r.ts, value: Math.round(((r.coverageByModel||{})[mk]||0)*100) }));
    });

    // Compute week-over-week deltas.
    const deltas = {};
    const last = runs[runs.length - 1];
    const prev = runs.length >= 2 ? runs[runs.length - 2] : null;
    if (last) {
      const lastOverall = Math.round((last.overallCoverage||0)*100);
      const prevOverall = prev ? Math.round((prev.overallCoverage||0)*100) : null;
      deltas.overall = { current:lastOverall, previous:prevOverall, change: prevOverall != null ? lastOverall - prevOverall : null };
      Object.keys(last.coverageByModel || {}).forEach(mk => {
        const cur = Math.round((last.coverageByModel[mk]||0)*100);
        const pre = prev?.coverageByModel?.[mk] != null ? Math.round(prev.coverageByModel[mk]*100) : null;
        deltas[mk] = { current:cur, previous:pre, change: pre != null ? cur - pre : null };
      });
    }

    res.json({ ok:true, domain:cleanDomain, runs:runs.length, series, deltas, latestRun: last || null });
  } catch (err) {
    console.error('/api/ai-visibility-trend error:', err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// ── POST /api/ai-visibility-audit ─────────────────────────────────────────────
app.post('/api/ai-visibility-audit', async (req, res) => {
  try {
    const { domain = 'yourdomain.com', industry = 'your industry' } = req.body;
    const prompt = `You are an AI visibility strategist specialising in LLM optimisation (LLMO) and Generative Engine Optimisation (GEO).

Analyse the brand "${domain}" in the "${industry}" industry and produce a concise AI Visibility Audit report.

Structure your response EXACTLY as plain text (no markdown headers, use emoji bullets):

🔴 CRITICAL GAPS (2-3 specific issues preventing AI citation)
• [specific gap with metric estimate]

🟡 IMPROVEMENT OPPORTUNITIES (3-4 actionable areas)
• [opportunity with expected uplift]

🟢 CURRENT STRENGTHS (1-2 things working well)
• [strength]

📋 30-DAY ACTION PLAN
1. [Week 1 action]
2. [Week 2 action]
3. [Week 3 action]
4. [Week 4 action]

Keep the entire response under 350 words. Be specific and actionable.`;
    const completion = await openai.chat.completions.create({ model:'gpt-4o', messages:[{ role:'user', content:prompt }], max_tokens:500 });
    const audit = completion.choices[0]?.message?.content?.trim() || '';
    res.json({ audit });
  } catch(err) {
    res.json({ audit: null, error: err.message });
  }
});

// ── POST /api/ai-brand-monitor ────────────────────────────────────────────────
app.post('/api/ai-brand-monitor', async (req, res) => {
  try {
    const { domain = 'yourdomain.com', industry = 'your industry' } = req.body;
    const prompt = `You are an elite AI brand monitoring expert specialising in LLM Optimisation (LLMO), brand perception analysis and Generative Engine Optimisation (GEO).

Produce a comprehensive Brand Monitor report for the brand "${domain}" in the "${industry}" industry.

Format as plain text (no markdown, use emoji bullets). Structure EXACTLY as below:

🔵 BRAND PERCEPTION SUMMARY
• How AI engines currently perceive ${domain} (2-3 sentences, be specific about the brand narrative)
• Overall brand sentiment in AI: positive / mixed / absent
• The "narrative frame" AI has formed around this brand

🔴 CRITICAL BRAND GAPS (2-3 specific issues)
• [specific gap affecting AI brand perception with context]

🟡 CITATION OPPORTUNITIES (3-4 specific actions to get more AI mentions)
• [action with expected impact]

🟢 BRAND STRENGTHS IN AI (1-2 things already working)
• [strength]

📣 COMPETITOR THREAT IN AI
• Which competitor currently dominates AI share of voice in this category and why
• One specific tactic to reclaim citations from them

📋 30-DAY BRAND MONITOR ACTION PLAN
1. [Week 1 — highest priority]
2. [Week 2 — brand narrative]
3. [Week 3 — citation building]
4. [Week 4 — measurement]

⭐ BRAND VISIBILITY SCORE: [X/100] — [1-line explanation]

Keep the entire response under 420 words. Be specific and actionable.`;
    const completion = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], max_tokens: 620 });
    const report = completion.choices[0]?.message?.content?.trim() || '';
    res.json({ report });
  } catch(err) {
    res.json({ report: null, error: err.message });
  }
});

// ── POST /api/ai-build-content ────────────────────────────────────────────────
app.post('/api/ai-build-content', async (req, res) => {
  try {
    const { topic, intent='Informational', domain='yourdomain.com', industry='your industry', contentType='article' } = req.body;

    const typeInstructions = {
      article:    `Write a comprehensive, authoritative blog article. Include: engaging H1 title, intro paragraph (hook + problem + promise), 3-4 main H2 sections each with 2-3 paragraphs, a FAQ section with 4 questions and detailed answers, and a conclusion with a clear CTA mentioning ${domain}.`,
      howto:      `Write a practical step-by-step how-to guide. Include: clear H1 title, brief intro, 5-7 numbered steps each with explanation and tips, common mistakes to avoid, a FAQ section with 3 questions, and a conclusion with CTA mentioning ${domain}.`,
      comparison: `Write a detailed comparison article. Include: H1 title, intro explaining why the comparison matters, comparison table (formatted as text rows), pros and cons of each option, a "Who Should Choose What" section, and a verdict/conclusion mentioning ${domain}.`,
      landing:    `Write a high-converting landing page. Include: powerful H1 headline, value proposition paragraph, 3 key benefits with descriptions, social proof section, FAQ with 3 questions, and a strong CTA paragraph mentioning ${domain}.`,
    };
    const instruction = typeInstructions[contentType] || typeInstructions.article;

    const gptPrompt = `You are an expert content writer specialising in SEO, LLM optimisation, and conversion. 
Topic: "${topic}"
Intent: ${intent}
Brand: ${domain}
Industry: ${industry}

${instruction}

Format using plain text with section markers:
- Use # for H1 (main title)
- Use ## for H2 (sections)
- Use ### for H3 (subsections)
- Use **text** for bold
- Use regular paragraphs for body text
- Use - for bullet points
- Keep the full piece 700–900 words
- Tone: professional, authoritative, helpful`;

    const claudePrompt = `You are a content strategy expert. For the topic "${topic}" in the ${industry} industry:

Provide ONLY the following additions (do not rewrite the full article):
1. Two alternative H1 title options (punchier/more click-worthy)
2. Three additional FAQ questions with concise answers not typically covered
3. One "Expert Insight" paragraph that adds a unique angle or surprising statistic

Return ONLY raw JSON: {
  "altTitles": ["title1","title2"],
  "extraFAQs": [{"q":"question","a":"answer"},{"q":"question","a":"answer"},{"q":"question","a":"answer"}],
  "expertInsight": "one insightful paragraph"
}`;

    // gpt-5-mini drops typical generation time from ~60–110s down to ~10–18s with no
    // meaningful quality drop for 700–900 word SEO articles. Claude Sonnet stays for
    // the small extras call (alt titles, expert insight, extra FAQs).
    const [gptRes, claudeRes] = await Promise.allSettled([
      openai.chat.completions.create({ model:'gpt-5-mini', messages:[{role:'user',content:gptPrompt}], max_tokens:1800 }),
      anthropic.messages.create({ model:'claude-sonnet-4-6', max_tokens:600, messages:[{role:'user',content:claudePrompt}] })
    ]);

    let article = '';
    if (gptRes.status === 'fulfilled') {
      article = gptRes.value.choices[0]?.message?.content?.trim() || '';
    }

    let claudeExtras = null;
    if (claudeRes.status === 'fulfilled') {
      try {
        const raw = claudeRes.value.content?.[0]?.text || '{}';
        claudeExtras = JSON.parse(raw.replace(/```json|```/g,'').trim());
      } catch {}
    }

    res.json({ article, claudeExtras, dualAI: !!claudeExtras });
  } catch(err) {
    res.json({ article: null, error: err.message });
  }
});

// ── POST /api/ai-content-brief ────────────────────────────────────────────────
app.post('/api/ai-content-brief', async (req, res) => {
  try {
    const { type = 'what-is', domain = 'yourdomain.com', industry = 'your industry' } = req.body;
    const typeGuides = {
      'what-is':    `a "What Is ${industry}?" definitional page. This page should clearly define the category, how it works, who uses it, and contain FAQ schema. It is the #1 most-cited content type by LLMs.`,
      'comparison': `a "${domain} vs Alternatives" comparison page. Include a side-by-side feature table, honest pros/cons, and a clear verdict section. These are cited in 73% of comparison-intent AI queries.`,
      'how-to':     `a step-by-step "How to Get Started with ${domain}" guide with numbered steps (≤7), HowTo schema markup, time estimates, and an FAQ section. How-to guides earn 3× more LLM citations for task-based queries.`,
    };
    const guide = typeGuides[type] || typeGuides['what-is'];
    const prompt = `You are a content strategist specialising in LLM Optimisation (LLMO) and Generative Engine Optimisation (GEO). Create a detailed, actionable content brief for ${guide}

Brand: ${domain}
Industry: ${industry}

Structure your brief as plain text with these sections (use ALL CAPS for section headers, no markdown):

CONTENT BRIEF: [Page Title]
TARGET URL: /suggested-url-slug
TARGET LLMs: [which AI platforms this will rank on]

PRIMARY GOAL
[1–2 sentences on the exact outcome]

RECOMMENDED TITLE
[SEO + LLM optimised title]

META DESCRIPTION (≤155 chars)
[meta description]

CONTENT STRUCTURE
[H1, H2, H3 outline with bullet points under each — be specific and detailed]

SCHEMA MARKUP REQUIRED
[list schema types needed]

INTERNAL LINKS
[3–4 suggested internal links]

E-E-A-T SIGNALS
[specific trust signals to include]

WORD COUNT TARGET
[recommended length]

Keep the total response under 500 words. Be specific, not generic.`;
    const completion = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], max_tokens: 700 });
    const brief = completion.choices[0]?.message?.content?.trim() || '';
    res.json({ brief });
  } catch(err) {
    res.json({ brief: null, error: err.message });
  }
});

// ── POST /api/ai-social-caption ──────────────────────────────────────────────
app.post('/api/ai-social-caption', async (req, res) => {
  try {
    const { prompt, domain = 'your brand', industry = 'your industry', platforms = [] } = req.body;
    const msgs = [
      { role:'system', content:'You are an expert social media copywriter. Write engaging, platform-optimised social media captions that drive engagement. Never mention competitor brand names. Return only the caption text.' },
      { role:'user', content: prompt || `Write an engaging social media caption for ${domain} in the ${industry} industry. Platforms: ${platforms.join(', ')||'Instagram'}. Use relevant emojis, a clear call-to-action, under 200 words.` }
    ];
    const completion = await openai.chat.completions.create({ model:'gpt-4o', messages: msgs, max_tokens: 350 });
    const caption = completion.choices[0]?.message?.content?.trim() || '';
    res.json({ caption });
  } catch(err) {
    res.json({ caption: '', error: err.message });
  }
});

// ── POST /api/agency-report ──────────────────────────────────────────────────
app.post('/api/agency-report', async (req, res) => {
  try {
    const { clientName='Client', domain='client.com', industry='your industry', budget=5000, agencyName='Agency' } = req.body;
    const prompt = `You are a senior marketing analyst at ${agencyName}. Generate a concise monthly performance report for client "${clientName}" (${domain}, ${industry} industry, monthly budget $${budget}).

Return a JSON object with exactly these keys:
{
  "executive_summary": "2-3 sentence overview of the period. Positive but honest.",
  "kpis": { "reach": "e.g. 84.2K", "roas": "e.g. 3.8×", "ctr": "e.g. 3.2%", "conversions": "e.g. 142" },
  "campaign_performance": "2-3 sentences on campaign highlights, wins, and any underperformers.",
  "competitor_intel": "2 sentences on competitor landscape and any notable moves.",
  "social_metrics": "2 sentences on social performance across platforms.",
  "recommendations": "3 numbered, specific, actionable recommendations for next month."
}

Make KPIs realistic for the industry and budget. Use authoritative, professional tone. Return valid JSON only.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 700,
      messages: [
        { role: 'system', content: 'You are a professional marketing report writer. Return valid JSON only, no markdown fences.' },
        { role: 'user', content: prompt }
      ]
    });
    let raw = completion.choices[0]?.message?.content?.trim() || '{}';
    raw = raw.replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```$/,'').trim();
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch(err) {
    res.status(500).json({
      executive_summary: `${clientName} delivered solid results this period with strong campaign efficiency and growing brand presence in the ${industry} space.`,
      kpis: { reach:'72.4K', roas:'3.4×', ctr:'2.9%', conversions:'118' },
      campaign_performance: 'Campaigns performed above benchmark with top-of-funnel cost per click improving 12% versus prior period. Retargeting delivered the strongest ROAS.',
      competitor_intel: 'Primary competitors maintained steady spend levels. One new market entrant identified in the mid-market segment worth monitoring.',
      social_metrics: 'Instagram and LinkedIn drove the highest quality traffic. Engagement rates exceeded industry average by 1.4 percentage points.',
      recommendations: '1. Increase retargeting budget by 20% given strong ROAS signal.\n2. Launch win-back sequence for leads dormant over 30 days.\n3. Test two new creative angles in top-performing campaign sets.'
    });
  }
});

// ── POST /api/reengage-copy ──────────────────────────────────────────────────
app.post('/api/reengage-copy', async (req, res) => {
  try {
    const { name='[First Name]', company='[Company]', channel='Email', reason='inactivity', value=1000,
            domain='yourdomain.com', brandName='', industry='your industry', step='', tone='', sequenceStep=false,
            counterOffer=false, compName='', offer='', angle='' } = req.body;

    if (counterOffer) {
      const prompt = `You are a senior marketing strategist for ${domain} in the ${industry} space.
Competitor "${compName}" is currently offering: "${offer}" (steal angle: ${angle}).
Write a 3-paragraph counter-offer strategy for ${domain} to win back leads that switched to ${compName}.
Be specific, direct, and tactical. Include:
1. How ${domain} should position itself against this specific offer
2. A concrete win-back offer or value prop to counter "${offer}"
3. The exact messaging angle for re-engagement outreach

Keep it under 200 words. Return only the strategy text, no headings.`;
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o', max_tokens: 350,
        messages: [
          { role: 'system', content: 'You are a strategic marketing consultant specialising in competitive re-engagement. Be specific and actionable.' },
          { role: 'user', content: prompt }
        ]
      });
      return res.json({ counter: completion.choices[0]?.message?.content?.trim() || '' });
    }

    const context = sequenceStep
      ? `This is step "${step}" in a re-engagement sequence. Tone: ${tone}.`
      : `This lead has been dormant for some time. Reason they may have left: ${reason}. Their estimated value: $${value}.`;

    const cleanDomain = (domain || '').replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0];
    const isPlaceholderDomain = !cleanDomain || /^yourdomain\.com$/i.test(cleanDomain);
    const senderBrandTitle = brandName && brandName.trim()
      ? brandName.trim()
      : (isPlaceholderDomain
          ? 'Our Team'
          : (cleanDomain.split('.')[0].charAt(0).toUpperCase() + cleanDomain.split('.')[0].slice(1)));
    const senderDomainDisplay = isPlaceholderDomain ? '' : cleanDomain;
    const signatureLine = senderDomainDisplay
      ? `${senderBrandTitle} (${senderDomainDisplay})`
      : senderBrandTitle;

    const senderRefDomain = senderDomainDisplay || senderBrandTitle;

    const prompt = `You are a world-class WIN-BACK copywriter writing ON BEHALF OF ${senderBrandTitle}${senderDomainDisplay ? ' ('+senderDomainDisplay+')' : ''} — a ${industry} brand. Your job is to write outreach that brings a lapsed customer back to ${senderBrandTitle}.

SENDER (the company writing this outreach): ${senderBrandTitle}${senderDomainDisplay ? ' — '+senderDomainDisplay : ''}.
RECIPIENT (the lapsed customer being won back): ${name} (first name only — do NOT use their company name anywhere).
${context}
Primary outreach channel: ${channel}.

Generate win-back re-engagement copy in JSON format:
{
  "email": { "subject": "...", "body": "..." },
  "ad": { "headline": "...", "body": "...", "cta": "..." },
  "social": "..."
}

WIN-BACK STRATEGY — every piece of copy MUST:
1. Acknowledge they've been away (briefly, without guilt-tripping).
2. Give a SPECIFIC reason to come back NOW — pick ONE of: a new feature/product launch since they left, a measurable improvement (faster, cheaper, better results), a tailored offer (free strategy call, exclusive discount, priority access, free upgrade), or fresh ${industry}-specific insight that benefits them.
3. Make the value about THEM ("you", "your goals", "your results") — not about ${senderBrandTitle}.
4. End with ONE clear soft CTA (book a call, reply to this email, claim the offer, see what's new) — never a hard sell.

CRITICAL Rules — DO NOT VIOLATE:
- The message is FROM ${senderBrandTitle}${senderDomainDisplay ? ' ('+senderDomainDisplay+')' : ''} TO ${name}. Never reverse this.
- Address ${name} by first name only. Use "you" / "your" when speaking to them.
- DO NOT mention "${company}" anywhere in the email body, subject, ad, or social message. The recipient's company name is OFF-LIMITS — never write it, never reference "your team at ${company}", never include it in any form.
- Sign off as the ${senderBrandTitle} team. NEVER sign the email as ${name} or as ${company}.
- The email signature MUST be exactly two lines: "Warm regards," then "The ${senderBrandTitle} Team". No extra lines, no titles, no contact details after.
- Reference the sender brand "${senderBrandTitle}"${senderDomainDisplay ? ' (or the website '+senderDomainDisplay+')' : ''} naturally in the body — never use placeholders like "Yourdomain", "yourdomain.com", "[Company]", "[Brand]", or generic stand-ins.
- email.body: 3–4 short paragraphs, warm, specific, empathetic. Max 180 words. End with the exact two-line signature above.
- ad: headline max 8 words (focus on the win-back hook), body max 2 sentences (the specific reason to return), CTA button text 2-4 words.
- social: LinkedIn/social DM sent BY someone at ${senderBrandTitle} TO ${name}. Max 80 words. Lead with value or a specific update — no hard sell. Sign with "— The ${senderBrandTitle} Team" at the end.
- Never mention competitor names.
- Tone: warm, human, confident, professional — like a friend reaching out, not a marketer pitching. ${tone ? 'Requested tone: '+tone+'.' : ''}
Return valid JSON only.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 700,
      messages: [
        { role: 'system', content: 'You are an expert re-engagement copywriter. Return valid JSON only, no markdown code fences.' },
        { role: 'user', content: prompt }
      ]
    });

    let raw = completion.choices[0]?.message?.content?.trim() || '{}';
    raw = raw.replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```$/,'').trim();
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch(err) {
    res.status(500).json({ error: err.message, email: { subject: 'We miss you', body: 'Hi there,\n\nWe noticed you\'ve been away for a while and wanted to reach out personally.\n\nA lot has changed since you last visited — and we\'d love to show you what\'s new.\n\nWould you be open to a quick 10-minute call this week?\n\nBest,\nThe Team' }, ad: { headline: 'We\'d love to have you back', body: 'See what\'s new — you\'re just one click away.', cta: 'Come Back Now' }, social: 'Hi [Name], hope things are going well at [Company]! I\'d love to reconnect and share what\'s new with us. Worth a quick chat?' });
  }
});

// ── POST /api/ai-attack-plan ─────────────────────────────────────────────────
app.post('/api/ai-attack-plan', async (req, res) => {
  try {
    const { myDomain = 'yourdomain.com', competitor = 'competitor', industry = 'your industry', competitorData = {}, prefillKeywords = [], prefillContext = '' } = req.body;

    const prefillSuffix = (prefillContext ? '\n\nSTRATEGIC CONTEXT — HIGHEST PRIORITY: ' + prefillContext : '') +
      (prefillKeywords.length > 0 ? '\n\nMANDATORY KEYWORDS — MUST appear in keywordTargets as Critical priority: ' + prefillKeywords.join(', ') : '');

    const sharedContext = `
Competitor data context:
- Estimated monthly traffic: ${competitorData.traffic || 'unknown'}
- Ad spend estimate: ${competitorData.adSpend || 'unknown'}
- Top channels: ${(competitorData.channels || []).join(', ') || 'Google, Meta, SEO'}
- Known weaknesses: ${(competitorData.weaknesses || []).join(', ') || 'general market gaps'}`;

    const jsonSchema = `Return ONLY valid JSON (no markdown), structured exactly like this:
{
  "executiveSummary": "2-3 sentence strategic overview of the attack plan and expected outcomes",
  "opportunityScore": 78,
  "estimatedROILift": "+34%",
  "timeToResults": "6-8 weeks",
  "weeklyPlan": [
    { "week": "Week 1–2", "focus": "Foundation & Quick Wins", "actions": ["action 1", "action 2", "action 3"], "kpi": "Metric to track" },
    { "week": "Week 3–4", "focus": "Campaign Launch", "actions": ["action 1", "action 2", "action 3"], "kpi": "Metric to track" },
    { "week": "Week 5–6", "focus": "Scale & Optimise", "actions": ["action 1", "action 2", "action 3"], "kpi": "Metric to track" },
    { "week": "Week 7–8", "focus": "Dominate & Expand", "actions": ["action 1", "action 2", "action 3"], "kpi": "Metric to track" }
  ],
  "keywordTargets": [
    { "keyword": "example keyword", "volume": "8,200/mo", "cpc": "$2.40", "intent": "Commercial", "priority": "Critical" },
    { "keyword": "example keyword 2", "volume": "4,100/mo", "cpc": "$1.80", "intent": "Informational", "priority": "High" },
    { "keyword": "example keyword 3", "volume": "12,500/mo", "cpc": "$3.10", "intent": "Transactional", "priority": "Critical" },
    { "keyword": "example keyword 4", "volume": "2,900/mo", "cpc": "$1.20", "intent": "Navigational", "priority": "Medium" },
    { "keyword": "example keyword 5", "volume": "6,700/mo", "cpc": "$2.80", "intent": "Commercial", "priority": "High" }
  ],
  "channelStrategy": [
    { "channel": "Google Search", "budgetPct": 40, "tactic": "Specific tactic", "expectedROAS": "4.2x" },
    { "channel": "Meta Ads", "budgetPct": 30, "tactic": "Specific tactic", "expectedROAS": "3.8x" },
    { "channel": "SEO / Content", "budgetPct": 20, "tactic": "Specific tactic", "expectedROAS": "6.1x" },
    { "channel": "LinkedIn", "budgetPct": 10, "tactic": "Specific tactic", "expectedROAS": "3.2x" }
  ],
  "contentAttacks": [
    { "title": "Content piece title", "type": "Blog Post", "angle": "Specific angle to attack competitor", "cta": "Call to action" },
    { "title": "Content piece title 2", "type": "Comparison Page", "angle": "Specific angle", "cta": "Call to action" },
    { "title": "Content piece title 3", "type": "Video Ad", "angle": "Specific angle", "cta": "Call to action" }
  ],
  "criticalWins": [
    { "win": "Specific actionable win", "impact": "High", "effort": "Low", "timeframe": "This week" },
    { "win": "Specific actionable win 2", "impact": "High", "effort": "Medium", "timeframe": "Week 2" },
    { "win": "Specific actionable win 3", "impact": "Medium", "effort": "Low", "timeframe": "This week" }
  ]
}`;

    const baseInstruction = `"budgetPct" is whole-number percentage (0-100); all channelStrategy budgetPct values must sum to 100. Make all recommendations highly specific to ${competitor} and ${industry}. Use real marketing tactics. No generic advice.`;

    const gptPrompt = `You are a world-class performance marketing strategist. Create a comprehensive, actionable "Full Attack Plan" for ${myDomain} to outperform their competitor ${competitor} in the ${industry} industry.
${sharedContext}
${jsonSchema}
IMPORTANT: ${baseInstruction}${prefillSuffix}`;

    const claudePrompt = `You are an elite marketing intelligence analyst specialising in competitive strategy. Develop a precise, data-driven "Full Attack Plan" for ${myDomain} to capture market share from ${competitor} in the ${industry} sector. Focus on finding non-obvious strategic angles and underutilised channels.
${sharedContext}
${jsonSchema}
IMPORTANT: ${baseInstruction}${prefillSuffix}`;

    // ── Run GPT-4o and Claude Sonnet in parallel ─────────────────────────────
    const [gptResult, claudeResult] = await Promise.allSettled([
      openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: gptPrompt }],
        max_tokens: 1600,
        response_format: { type: 'json_object' }
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1700,
        messages: [{ role: 'user', content: claudePrompt + '\n\nReturn ONLY the raw JSON object — no markdown fences, no explanation.' }]
      })
    ]);

    let gptPlan = null, claudePlan = null;
    if (gptResult.status === 'fulfilled') {
      try { gptPlan = JSON.parse(gptResult.value.choices[0]?.message?.content?.trim() || '{}'); } catch {}
    }
    if (claudeResult.status === 'fulfilled') {
      const claudeText = claudeResult.value.content?.[0]?.text?.trim() || '{}';
      const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
      try { claudePlan = JSON.parse(jsonMatch ? jsonMatch[0] : claudeText); } catch {}
    }

    // ── If only one succeeded, return it directly ────────────────────────────
    if (!gptPlan && !claudePlan) throw new Error('Both AI models failed to generate a plan');
    if (!gptPlan) return res.json({ plan: claudePlan, sources: ['Claude'] });
    if (!claudePlan) return res.json({ plan: gptPlan, sources: ['GPT-4o'] });

    // ── Both succeeded — merge in code (no extra API call) ───────────────────
    const normKey = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Keywords: GPT-4o base + unique ones from Claude (dedup by keyword text)
    const gptKws    = gptPlan.keywordTargets   || [];
    const claudeKws = claudePlan.keywordTargets || [];
    const seenKw    = new Set(gptKws.map(k => normKey(k.keyword)));
    const extraKws  = claudeKws.filter(k => !seenKw.has(normKey(k.keyword)));
    const mergedKws = [...gptKws, ...extraKws].slice(0, 8);

    // Weekly plan: GPT-4o base + unique actions from Claude per week
    const mergedWeekly = (gptPlan.weeklyPlan || []).map((week, i) => {
      const claudeWeek   = (claudePlan.weeklyPlan || [])[i] || {};
      const existingActs = new Set((week.actions || []).map(a => normKey(a)));
      const newActs      = (claudeWeek.actions || []).filter(a => !existingActs.has(normKey(a)));
      return { ...week, actions: [...(week.actions || []), ...newActs].slice(0, 4) };
    });

    // Channel strategy: GPT-4o wins on budget structure (must sum to 100)
    const mergedChannels = (gptPlan.channelStrategy || []).map(ch => {
      const claudeCh = (claudePlan.channelStrategy || []).find(c => normKey(c.channel) === normKey(ch.channel));
      // Prefer Claude's tactic if it's more detailed
      const tactic = (claudeCh?.tactic?.length || 0) > (ch.tactic?.length || 0) ? claudeCh.tactic : ch.tactic;
      return { ...ch, tactic };
    });

    // Critical wins: merge, dedup, keep up to 5
    const gptWins    = gptPlan.criticalWins   || [];
    const claudeWins = claudePlan.criticalWins || [];
    const seenWin    = new Set(gptWins.map(w => normKey(w.win)));
    const extraWins  = claudeWins.filter(w => !seenWin.has(normKey(w.win)));
    const mergedWins = [...gptWins, ...extraWins].slice(0, 5);

    // Content attacks: merge, dedup, keep up to 5
    const gptContent    = gptPlan.contentAttacks   || [];
    const claudeContent = claudePlan.contentAttacks || [];
    const seenContent   = new Set(gptContent.map(c => normKey(c.title)));
    const extraContent  = claudeContent.filter(c => !seenContent.has(normKey(c.title)));
    const mergedContent = [...gptContent, ...extraContent].slice(0, 5);

    // Scores: take higher opportunity score
    const bestScore = Math.max(gptPlan.opportunityScore || 0, claudePlan.opportunityScore || 0);

    const mergedPlan = {
      ...gptPlan,
      opportunityScore:  bestScore,
      weeklyPlan:        mergedWeekly,
      keywordTargets:    mergedKws,
      channelStrategy:   mergedChannels,
      contentAttacks:    mergedContent,
      criticalWins:      mergedWins
    };

    res.json({ plan: mergedPlan, sources: ['GPT-4o', 'Claude'] });
  } catch(err) {
    res.json({ plan: null, error: err.message });
  }
});

// ── POST /api/ai-creative ─────────────────────────────────────────────────────
// Powers Creative Studio — uses GPT-4 via Replit AI Integrations with smart fallback

app.post('/api/ai-creative', async (req, res) => {
  try {
    const {
      platform = 'Google Ads', campName = 'Campaign', tone = 'Bold & Direct',
      persona = 'business owners', differentiator = 'AI-powered results',
      cta = 'Start Free Trial', topComp = 'competitors', industry = 'your industry',
      domain = 'yourdomain.com', competitors = [], tags = []
    } = req.body;

    const compList = competitors.length > 0 ? competitors.join(', ') : topComp;
    const tagList  = tags.length > 0 ? tags.join(', ') : '';

    const systemPrompt = `You are a world-class performance marketing copywriter with 15 years experience creating ads that achieve 4-6× ROAS on Google, Meta, TikTok, LinkedIn, and YouTube. You write compelling copy that highlights brand strengths, speaks directly to buyer pain-points, and drives high-intent conversions. CRITICAL LEGAL RULE: You must NEVER mention any competitor brand names, product names, or company names in any ad copy — not in headlines, descriptions, scripts, captions, email subjects, or any other field. Use generic terms like "the alternatives", "other solutions", "traditional methods", or "the competition" instead. Always respond with valid JSON only — no markdown, no explanation, just the JSON object.`;

    const userPrompt = `Generate a complete multi-platform creative pack for this campaign:

BRAND: ${domain}
INDUSTRY: ${industry}
CAMPAIGN: ${campName}
PLATFORM FOCUS: ${platform}
MARKET CONTEXT: Competing in ${industry} — focus on our unique strengths vs generic alternatives
AD TONE: ${tone}
TARGET PERSONA: ${persona}
KEY DIFFERENTIATOR: ${differentiator}
CALL-TO-ACTION: ${cta}
CAMPAIGN TAGS/THEMES: ${tagList}

IMPORTANT: Do NOT name any competitor brands. Use "the alternatives", "other ${industry} tools", or "traditional methods" if contrast is needed.

Return ONLY this JSON (no markdown fences, no extra text):
{
  "headlines": [
    "Google headline 1 (MAX 30 chars, high-intent keyword)",
    "Google headline 2 (MAX 30 chars, benefit-led)",
    "Google headline 3 (MAX 30 chars, value contrast — NO competitor names)"
  ],
  "descriptions": [
    "Google description 1 (MAX 90 chars, pain → solution, no competitor names)",
    "Google description 2 (MAX 90 chars, social proof + CTA, no competitor names)"
  ],
  "instagram": "Full Instagram/Meta caption with opening hook, 3 benefit bullets with ✅, social proof stat, CTA, 6-8 relevant hashtags. 150-200 words. No competitor names.",
  "tiktok_script": "15-second TikTok script:\\n[0-3s] HOOK: text\\n[3-8s] PROBLEM: text\\n[8-13s] SOLUTION: text\\n[13-15s] CTA: text. No competitor names.",
  "youtube_script": "25-second YouTube pre-roll:\\n[0-5s] HOOK: text\\n[5-12s] PROBLEM: text\\n[12-20s] SOLUTION: text\\n[20-25s] CTA: text. No competitor names.",
  "linkedin": "LinkedIn Sponsored Content post: professional tone, industry insight opening, 2-3 pain points for ${persona}, how ${domain} solves them, ${cta}. 100-130 words. No competitor names.",
  "email_subjects": [
    "Email subject line 1 — curiosity-led, no competitor names",
    "Email subject line 2 — benefit-led, no competitor names",
    "Email subject line 3 — urgency-led, no competitor names"
  ],
  "strategy_reasoning": "2-sentence explanation of why this creative angle resonates with ${persona} and drives conversions in ${industry}",
  "competitor_angle": "1 ad copy hook that calls out a common industry pain-point WITHOUT naming any competitor brand"
}`;

    // Helper: clean and parse JSON from AI response
    function parseAIResponse(text) {
      if (!text || typeof text !== 'string') return null;
      const clean = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { return JSON.parse(match[0]); } catch { return null; }
    }

    // Safety net: strip any competitor brand name that GPT-4 may have included
    // despite instructions. Replaces names with "the competition" generically.
    const allCompNames = [...new Set([
      ...(competitors || []),
      topComp
    ])].filter(n => n && n.length > 2);

    function sanitiseAdCopy(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      const scrub = str => {
        if (typeof str !== 'string') return str;
        let out = str;
        for (const name of allCompNames) {
          // Case-insensitive whole-word replacement
          const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`, 'gi');
          out = out.replace(re, 'the competition');
        }
        return out;
      };
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') result[k] = scrub(v);
        else if (Array.isArray(v)) result[k] = v.map(i => scrub(i));
        else result[k] = v;
      }
      return result;
    }

    // ── Claude prompt — alternative creative angles ─────────────────────────
    const claudeCreativePrompt = `You are an elite advertising copywriter. Generate ALTERNATIVE ad creative for this campaign — use a completely DIFFERENT angle from standard approaches.

BRAND: ${domain}
INDUSTRY: ${industry}
PLATFORM: ${platform}
TARGET AUDIENCE: ${persona}
KEY DIFFERENTIATOR: ${differentiator}
CTA: ${cta}

RULES:
- NEVER mention any competitor brand names — use "the alternatives" or "traditional solutions" instead
- Write in a fresh, unexpected creative voice that GPT-4 wouldn't write
- Focus on emotional resonance, not just logical benefits

Return ONLY this JSON (no markdown, no explanation):
{
  "claude_headlines": [
    "Alternative headline 1 (MAX 30 chars, emotionally resonant)",
    "Alternative headline 2 (MAX 30 chars, unexpected angle)",
    "Alternative headline 3 (MAX 30 chars, value-driven)"
  ],
  "claude_descriptions": [
    "Alternative description 1 (MAX 90 chars, story-led)",
    "Alternative description 2 (MAX 90 chars, outcome-focused)"
  ],
  "claude_angle": "A single punchy competitor attack hook that calls out industry pain WITHOUT naming any brand — different from the GPT-4 version",
  "claude_instagram": "Alternative Instagram caption opening hook (first 2 sentences only — vivid, scroll-stopping)",
  "claude_strategy": "1-sentence explanation of why this alternative creative angle is compelling for ${persona}"
}`;

    // ── Attempt 1: GPT-4 + Claude in parallel ──────────────────────────────
    if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
      const [gptResult, claudeResult] = await Promise.allSettled([
        openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt }
          ],
          temperature: 0.82,
          max_tokens: 1400,
          response_format: { type: 'json_object' }
        }),
        anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 600,
          messages: [{ role: 'user', content: claudeCreativePrompt }]
        })
      ]);

      let parsed = null;
      if (gptResult.status === 'fulfilled') {
        const text = gptResult.value.choices?.[0]?.message?.content || '';
        parsed = parseAIResponse(text);
      }

      if (parsed && Array.isArray(parsed.headlines) && parsed.headlines.length >= 3) {
        console.log('[ai-creative] GPT-4 success');
        const sanitised = sanitiseAdCopy(parsed);

        // Merge Claude's creative additions
        if (claudeResult.status === 'fulfilled') {
          try {
            const claudeRaw = claudeResult.value.content?.[0]?.text || '{}';
            const claudeData = parseAIResponse(claudeRaw);
            if (claudeData) {
              if (Array.isArray(claudeData.claude_headlines)) sanitised.claude_headlines = claudeData.claude_headlines;
              if (Array.isArray(claudeData.claude_descriptions)) sanitised.claude_descriptions = claudeData.claude_descriptions;
              if (claudeData.claude_angle) sanitised.claude_angle = claudeData.claude_angle;
              if (claudeData.claude_instagram) sanitised.claude_instagram = claudeData.claude_instagram;
              if (claudeData.claude_strategy) sanitised.claude_strategy = claudeData.claude_strategy;
              console.log('[ai-creative] Claude alternative angles merged');
            }
          } catch(e) { console.warn('[ai-creative] Claude merge failed:', e.message); }
        }

        const hasClaude = !!sanitised.claude_angle;
        return res.json({ ...sanitised, source: hasClaude ? 'dual_ai' : 'gpt4' });
      }

      if (gptResult.status === 'rejected') console.warn('[ai-creative] GPT-4 failed:', gptResult.reason?.message);
    }

    // ── Attempt 2: RapidAPI ChatGPT fallback ──────────────────────────────
    const key = process.env.RAPIDAPI_KEY;
    if (key) {
      try {
        const r = await callRapidAPI('chatgpt-42.p.rapidapi.com', '/conversationgpt4-2', 'POST', {
          messages: [{ role: 'user', content: userPrompt }],
          system_prompt: systemPrompt,
          temperature: 0.8, top_k: 5, top_p: 0.9, max_tokens: 1200
        });
        const text = r?.result || r?.response || r?.message || r?.content || '';
        const parsed = parseAIResponse(text);
        if (parsed && Array.isArray(parsed.headlines)) {
          return res.json({ ...sanitiseAdCopy(parsed), source: 'rapidapi_gpt' });
        }
      } catch(e) { console.warn('[ai-creative] RapidAPI failed:', e.message); }
    }

    // ── Smart fallback — always returns professional contextual copy ───────
    const toneWord = tone.includes('Bold') ? 'bold' : tone.includes('Friendly') ? 'friendly'
      : tone.includes('Urgent') ? 'urgent' : tone.includes('Witty') ? 'witty' : 'professional';
    const ctaShort = cta.replace('Start ', '').replace('Get ', '').replace(' Today', '').replace(' Free', '');
    const ind = industry.replace(/\s+/g,'');

    const hSets = [
      [`${ctaShort} — Smarter ${industry}`, `${differentiator.substring(0,25)} Proven`, `${platform} Results That Scale`],
      [`${ctaShort} — Stop Paying More`, `The ${industry} Platform That Wins`, `Outperform the Market in 30 Days`],
      [`${differentiator.substring(0,22)} Now`, `${industry}: Smarter Strategy`, `The Approach Your Market Fears`]
    ];
    const dSets = [
      [`Built for ${persona} — get more from ${platform} while other solutions fall short.`, `${differentiator}. ${cta} and see why ${industry} leaders are making the switch.`],
      [`Stop wasting budget on outdated strategies. ${differentiator} — zero risk, full results.`, `Join 10,000+ ${industry} businesses that chose a smarter approach. ${cta}.`]
    ];
    const pick = Math.floor(Math.random() * hSets.length);

    res.json({
      source: 'smart_fallback',
      headlines: hSets[pick],
      descriptions: dSets[pick % dSets.length],
      instagram: `🚀 Tired of ${industry} strategies that don't deliver?\n\n${differentiator} — built specifically for ${persona}.\n\n✅ ${projectedStat(industry)} ROAS achieved\n✅ ${cta} — no credit card needed\n✅ Real results in your first 30 days\n\n💡 The ${industry} brands growing fastest right now aren't spending more — they're spending smarter.\n\n👉 Link in bio to start free today.\n\n#${ind} #DigitalMarketing #ROAS #MarketingStrategy #${platform.replace(/\s+/g,'')}Ads #GrowthHacking #MarketingROI #Ecommerce`,
      tiktok_script: `[0-3s] HOOK: "Why do most ${industry} brands waste 40% of their ad budget?"\n[3-8s] PROBLEM: Every day you run ads without real intelligence, you leave money on the table.\n[8-13s] SOLUTION: "${differentiator}" — your unfair advantage on ${platform}.\n[13-15s] CTA: "${cta} at ${domain} — link in bio."`,
      youtube_script: `[0-5s] HOOK: "What if your ${platform} budget worked 3× harder — automatically?"\n[5-12s] PROBLEM: Most ${industry} brands overspend on ${platform} with no real optimisation strategy — flat results, wasted budget.\n[12-20s] SOLUTION: ${domain}: ${differentiator}. ROAS graph climbing.\n[20-25s] CTA: "${cta} at ${domain}. Free 14-day trial."`,
      linkedin: `Most ${industry} teams are leaving pipeline on the table — not because their product is worse, but because their ad strategy hasn't kept up.\n\n${differentiator} changes that.\n\nFor ${persona}, this means:\n→ Lower CPA on every channel\n→ Campaigns that adapt to market shifts in real time\n→ ${cta} with measurable results in week one\n\nIf you're running ${platform} campaigns right now, let's talk. ${cta} at ${domain}.`,
      email_subjects: [
        `Why most ${industry} brands waste 40% of their ${platform} budget (and how to fix it)`,
        `${differentiator} — ${persona} are making the switch`,
        `⏰ Last chance: ${cta} before the market moves without you`
      ],
      strategy_reasoning: `${toneWord.charAt(0).toUpperCase() + toneWord.slice(1)} creative targeting ${persona} on ${platform}, leading with "${differentiator}" as the core value proposition. Positioning as the smarter, more ROI-efficient choice drives high-intent clicks from audiences already evaluating their options.`,
      competitor_angle: `"Most ${industry} tools lock you into long contracts with no performance guarantee — we don't. ${cta} and see the difference in week one."`
    });

  } catch(err) {
    console.error('[ai-creative] error:', err.message);
    res.status(500).json({ error: err.message, source: 'error' });
  }
});

function projectedStat(industry) {
  const stats = { 'Fintech': '4.6×', 'E-commerce': '5.2×', 'SaaS': '3.8×', 'Finance': '4.1×', 'Health': '3.9×' };
  for (const [k, v] of Object.entries(stats)) { if (industry.toLowerCase().includes(k.toLowerCase())) return v; }
  return '4.2×';
}

// ── POST /api/backlinks ───────────────────────────────────────────────────────
// Returns backlink summary for one or more competitor domains via DataForSEO

app.post('/api/backlinks', async (req, res) => {
  try {
    const { domains = [] } = req.body;
    if (!domains.length) return res.json({ results: {} });

    const auth = getDataForSEOAuth();
    if (!auth) return res.json({ results: {}, error: 'DataForSEO not configured' });

    // Build batch request — one task per domain (max 10)
    const tasks = domains.slice(0, 10).map(d => ({
      target: d.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase(),
      include_subdomains: true,
      backlinks_status_type: 'live'
    }));

    let parsed;
    try {
      parsed = await callDataForSEO('/v3/backlinks/summary/live', tasks, 20000);
    } catch(e) {
      console.warn('[backlinks] DataForSEO error:', e.message);
      return res.json({ results: {}, error: e.message });
    }

    // Map each task result back to its domain
    const results = {};
    (parsed.tasks || []).forEach((task, i) => {
      const domain = domains[i];
      const r = task?.result?.[0];
      if (!r || task.status_code !== 20000) {
        results[domain] = null;
        return;
      }
      const total    = r.backlinks || 0;
      const domains_ = r.referring_domains || 0;
      const dofollow = r.dofollow || 0;
      const rank     = r.rank || 0;
      results[domain] = {
        total,
        referringDomains: domains_,
        dofollow,
        nofollow: r.nofollow || 0,
        rank,
        dofollowPct: total > 0 ? Math.round((dofollow / total) * 100) : 0,
        newBacklinks:  r.new_backlinks || 0,
        lostBacklinks: r.lost_backlinks || 0
      };
    });

    console.log(`[backlinks] Returned data for ${Object.keys(results).length} domains`);
    res.json({ results });
  } catch(err) {
    console.error('[backlinks] error:', err.message);
    res.json({ results: {}, error: err.message });
  }
});

// ── POST /api/ai-campaign-brief ───────────────────────────────────────────────
// Powers the Launch Campaign modal — generates a full AI campaign brief via GPT-4o

app.post('/api/ai-campaign-brief', async (req, res) => {
  try {
    const {
      campName = 'Campaign', platform = 'Google Ads', budget = '$2,000/mo',
      industry = 'your industry', domain = 'yourdomain.com',
      competitors = [], topComp = 'competitor', description = '',
      persona = 'high-intent buyers', estROAS = '3.8', estCTR = '4.2%', estCPA = '$38', tags = []
    } = req.body;

    const compList = competitors.slice(0, 5).join(', ') || topComp;
    const tagList  = tags.slice(0, 5).join(', ') || '';

    const systemPrompt = `You are a senior performance marketing strategist with 15+ years running campaigns for major brands on Google, Meta, TikTok, YouTube and LinkedIn. You create precise, data-driven campaign briefs that achieve 4-6× ROAS. You write copy that speaks directly to high-intent buyers. IMPORTANT: Never mention competitor brand names in ad headlines or descriptions — focus on the value and benefits. Always respond with valid JSON only — no markdown, no extra text.`;

    const userPrompt = `Create a complete campaign launch brief for this campaign:

BRAND DOMAIN: ${domain}
INDUSTRY: ${industry}
CAMPAIGN NAME: ${campName}
AD PLATFORM: ${platform}
MONTHLY BUDGET: ${budget}
TARGET AUDIENCE / PERSONA: ${persona}
COMPETITORS TO OUTPERFORM: ${compList}
CAMPAIGN DESCRIPTION: ${description || 'AI-powered campaign strategy'}
CAMPAIGN THEMES/TAGS: ${tagList}
PROJECTED METRICS: ROAS ${estROAS}× | CTR ${estCTR} | CPA ${estCPA}

CRITICAL: Do NOT include any competitor brand names in headlines, descriptions, strategy_summary, creative_angle, competitor_gap, or launch_checklist. Use "the competition", "other solutions", or generic industry phrases instead.

Return ONLY this exact JSON structure:
{
  "headlines": [
    "Headline 1 — MAX 30 chars, high-intent keyword focusing on YOUR brand value (NO competitor names)",
    "Headline 2 — MAX 30 chars, benefit-led with a specific stat or differentiator",
    "Headline 3 — MAX 30 chars, strong CTA or value contrast (NO competitor names)"
  ],
  "descriptions": [
    "Description 1 — MAX 90 chars, pain point → your solution (NO competitor names)",
    "Description 2 — MAX 90 chars, social proof stat + call to action"
  ],
  "strategy_summary": "2-3 sentence strategic rationale: why this campaign angle wins on ${platform} specifically, including the targeting method and expected outcome. No competitor names.",
  "target_audience": "Specific audience segment description (demographics, interests, intent signals) — 1-2 sentences.",
  "bid_strategy": "Recommended ${platform} bidding strategy and why it maximises ROAS for this budget.",
  "creative_angle": "The core creative hook/angle — what emotional trigger or insight makes this ad stop the scroll. No competitor names.",
  "competitor_gap": "1-2 sentences on the market opportunity and gap this campaign targets — describe the problem generically, no competitor brand names.",
  "kpi_targets": {
    "roas": "${estROAS}",
    "ctr": "${estCTR}",
    "cpa": "${estCPA}",
    "week1_goal": "Specific measurable goal for the first 7 days",
    "month1_goal": "Specific measurable goal for the first 30 days"
  },
  "launch_checklist": [
    "Specific pre-launch action item 1 for ${platform}",
    "Specific pre-launch action item 2",
    "Specific pre-launch action item 3",
    "Specific pre-launch action item 4"
  ]
}`;

    // Helper to clean/parse AI JSON
    function parseJSON(text) {
      if (!text) return null;
      const clean = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { return JSON.parse(m[0]); } catch { return null; }
    }

    // GPT-4o via Replit AI Integration
    if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt }
          ],
          temperature: 0.75,
          max_tokens: 1200,
          response_format: { type: 'json_object' }
        });
        const text = completion.choices?.[0]?.message?.content || '';
        const parsed = parseJSON(text);
        if (parsed && Array.isArray(parsed.headlines) && parsed.headlines.length >= 2) {
          console.log('[ai-campaign-brief] GPT-4o success');
          return res.json({ ...parsed, source: 'gpt4o' });
        }
      } catch(e) { console.warn('[ai-campaign-brief] GPT-4o failed:', e.message); }
    }

    // Smart fallback — always contextual, never generic
    console.log('[ai-campaign-brief] Using smart fallback');
    const budgetNum = parseInt((budget || '2000').replace(/[^0-9]/g,'')) || 2000;
    res.json({
      source: 'fallback',
      headlines: [
        `Beat ${topComp} — ${platform === 'Google Ads' ? 'Search' : 'Start'} Free`,
        `${industry} Results: ${estROAS}× ROAS Proven`,
        `${topComp} Alternative — Switch Today`
      ],
      descriptions: [
        `Cut wasteful ad spend and beat ${topComp} on the keywords that matter most to ${industry} buyers.`,
        `${domain}: trusted by ${industry} brands. Est. ${estROAS}× ROAS · CPA ${estCPA}. Start free today.`
      ],
      strategy_summary: `Target high-intent ${industry} buyers who are actively evaluating ${topComp} by positioning ${domain} as the smarter, higher-ROI alternative. Use ${platform}'s AI bidding to automatically find the most cost-efficient conversions within the ${budget} budget.`,
      target_audience: `${industry} decision-makers aged 25–55, actively searching for alternatives to ${topComp}. High commercial intent, mid-to-bottom funnel.`,
      bid_strategy: `Target ROAS bidding at ${estROAS}× — let the platform algorithm find conversions while your budget scales only to profitable auctions.`,
      creative_angle: `Lead with the specific cost/efficiency gap vs ${topComp}. Buyers who are already considering ${topComp} respond strongest to direct comparison angles with concrete outcome stats.`,
      competitor_gap: `${topComp} has high brand recognition but weak performance on cost-per-conversion for ${industry} buyers. This gap is your opening — lead with ROI proof.`,
      kpi_targets: {
        roas: estROAS,
        ctr: estCTR,
        cpa: estCPA,
        week1_goal: `Achieve ${estCTR} CTR and collect first 20+ conversion signals to train the algorithm`,
        month1_goal: `Hit ${estROAS}× ROAS at scale with ${Math.round(budgetNum / parseInt(estCPA.replace(/[^0-9]/g,'') || '38'))} conversions`
      },
      launch_checklist: [
        `Upload high-quality video creatives and static image assets for ${platform}`,
        `Set up lookalike audiences from your highest-converting customer segments`,
        `Implement conversion tracking and revenue attribution before launch`,
        `Set daily spend caps to maintain consistent pacing within monthly budget`,
        `Launch A/B test variants for ad copy headlines and audience targeting`
      ]
    });

  } catch(err) {
    console.error('[ai-campaign-brief] error:', err.message);
    res.status(500).json({ error: err.message, source: 'error' });
  }
});

// ── GET /api/serp — Google Search via RapidAPI (multi-endpoint fallback) ──────
app.get('/api/serp', async (req, res) => {
  const { q, gl = 'us', hl = 'en', num = 10, type = 'search' } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query param q' });

  const rapidKey = getRapidApiKey('GOOGLE_SEARCH_API_KEY') || getRapidApiKey('RAPIDAPI_KEY');
  if (!rapidKey) return res.status(503).json({ error: 'Google Search API key not configured' });

  // Helper: make one HTTPS request and parse JSON
  function rapidFetch(hostname, path) {
    return new Promise((resolve, reject) => {
      const options = { hostname, path, method: 'GET',
        headers: { 'x-rapidapi-key': rapidKey, 'x-rapidapi-host': hostname, 'Accept': 'application/json' } };
      const r = https.request(options, resp => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => { try { resolve({ status: resp.statusCode, data: JSON.parse(body) }); } catch { reject(new Error('Bad JSON')); } });
      });
      r.on('error', reject);
      r.end();
    });
  }

  // Normalise results from any of the four schemas various APIs return
  function normalise(data, host) {
    let results = [];
    // Schema A: { results:[{title,url,description}] }  (google-search74, real-time-web-search)
    if (Array.isArray(data.results)) results = data.results;
    // Schema B: { data:[{title,url,snippet}] }
    else if (Array.isArray(data.data)) results = data.data;
    // Schema C: { organic_results:[...] } (googlesearch-api)
    else if (Array.isArray(data.organic_results)) results = data.organic_results;
    // Schema D: { items:[...] } (google-search3)
    else if (Array.isArray(data.items)) results = data.items;

    const organic = results.slice(0, Number(num)).map((r, i) => {
      const rawUrl = r.url || r.link || r.href || '';
      const domain = (() => { try { return new URL(rawUrl).hostname.replace(/^www\./,''); } catch { return ''; } })();
      return {
        position: i + 1,
        title:    r.title || '',
        url:      rawUrl,
        domain,
        snippet:  r.description || r.snippet || r.body || '',
        date:     r.date || r.published || null,
        favicon:  domain ? `https://www.google.com/s2/favicons?sz=32&domain=${domain}` : ''
      };
    });

    const related = (data.related_keywords || data.related_searches || data.suggestions || [])
      .map(r => typeof r === 'string' ? r : (r.query || r.keyword || r.text || '')).filter(Boolean);

    return { organic, relatedSearches: related };
  }

  // Candidate endpoints in priority order — try each until one succeeds
  const candidates = [
    // 1. google-search3 (apigeek)
    { host: 'google-search3.p.rapidapi.com',          path: `/api/v1/search/q=${encodeURIComponent(q)}&num=${num}&hl=${hl}&gl=${gl}&safe=off` },
    // 2. real-time-web-search
    { host: 'real-time-web-search.p.rapidapi.com',    path: `/search?q=${encodeURIComponent(q)}&limit=${num}` },
    // 3. google-search74
    { host: 'google-search74.p.rapidapi.com',         path: `/search?query=${encodeURIComponent(q)}&limit=${num}&related_keywords=true` },
    // 4. googlesearch-api
    { host: 'googlesearch-api.p.rapidapi.com',        path: `/search?q=${encodeURIComponent(q)}&num=${num}&gl=${gl}&hl=${hl}` },
    // 5. google72
    { host: 'google72.p.rapidapi.com',                path: `/search?q=${encodeURIComponent(q)}&num=${num}&gl=${gl}&hl=${hl}` },
    // 6. google-web-search1
    { host: 'google-web-search1.p.rapidapi.com',      path: `/search?query=${encodeURIComponent(q)}&limit=${num}` },
    // 7. web-search13
    { host: 'web-search13.p.rapidapi.com',            path: `/search?q=${encodeURIComponent(q)}&limit=${num}` },
    // 8. contextualwebsearch
    { host: 'contextualwebsearch.p.rapidapi.com',     path: `/api/Search?q=${encodeURIComponent(q)}&count=${num}&safeSearch=Off&textFormat=Raw` },
    // 9. bing-web-search1
    { host: 'bing-web-search1.p.rapidapi.com',        path: `/search?q=${encodeURIComponent(q)}&count=${num}&mkt=${hl}-${gl.toUpperCase()}` },
    // 10. google-search-master
    { host: 'google-search-master.p.rapidapi.com',    path: `/search?q=${encodeURIComponent(q)}&num=${num}` },
    // 11. web-search21
    { host: 'web-search21.p.rapidapi.com',            path: `/search?query=${encodeURIComponent(q)}&limit=${num}` },
    // 12. all-search-api
    { host: 'all-search-api.p.rapidapi.com',          path: `/search?q=${encodeURIComponent(q)}&eng=google&limit=${num}&gl=${gl}&hl=${hl}` },
  ];

  let lastErr = 'No subscribed Google Search endpoint found';
  for (const { host, path } of candidates) {
    try {
      const { status, data } = await rapidFetch(host, path);
      const notSubscribed = data.message?.toLowerCase().includes('subscri') || data.error?.toLowerCase().includes('subscri') || data.message?.toLowerCase().includes('not found for api');
      if (status === 200 && !data.error && !notSubscribed) {
        const { organic, relatedSearches } = normalise(data, host);
        if (organic.length > 0) {
          console.log(`[SERP] ✓ success via ${host}`);
          return res.json({ query: q, total: data.totalResults || null, organic, news: [], ads: [], relatedSearches, knowledgeGraph: null, source: host });
        }
      }
      const errMsg = data.message || data.error || `HTTP ${status}`;
      console.log(`[SERP] ${host}: ${errMsg}`);
      if (notSubscribed) lastErr = `Not subscribed to ${host}`;
      else lastErr = `${host}: ${errMsg}`;
    } catch (e) { lastErr = e.message; console.log(`[SERP] ${e.message}`); }
  }

  // ── AI Fallback: generate intelligence-grade search results via OpenAI ────────
  console.log('[SERP] All RapidAPI endpoints failed — using AI fallback');
  try {
    const aiRes = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [{
        role: 'user',
        content: `You are a search intelligence engine. Generate ${num} realistic search results for the query: "${q}".
Return ONLY valid JSON with this structure (no markdown, no explanation):
{"organic":[{"position":1,"title":"...","url":"https://example.com/page","domain":"example.com","snippet":"..."}],"relatedSearches":["term1","term2","term3"]}
Make results realistic, authoritative (well-known domains), and directly relevant to the query. Include a mix of brand sites, industry publications, and review/comparison sites.`
      }],
      max_tokens: 1200,
      temperature: 0.3
    });
    const raw = (aiRes.choices?.[0]?.message?.content || '').trim().replace(/^```json|^```|```$/gm, '').trim();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.organic) && parsed.organic.length > 0) {
      // Ensure favicons are added
      parsed.organic = parsed.organic.map((r, i) => ({
        ...r, position: i + 1,
        favicon: r.domain ? `https://www.google.com/s2/favicons?sz=32&domain=${r.domain}` : ''
      }));
      console.log('[SERP] ✓ AI fallback success');
      return res.json({ query: q, organic: parsed.organic, relatedSearches: parsed.relatedSearches || [], news: [], ads: [], knowledgeGraph: null, source: 'ai-fallback', aiGenerated: true });
    }
  } catch(aiErr) {
    console.error('[SERP] AI fallback failed:', aiErr.message);
  }

  console.error('[SERP] All fallbacks exhausted:', lastErr);
  res.status(503).json({ error: lastErr, hint: 'Subscribe to a Google Search API on RapidAPI (rapidapi.com/search) or check your GOOGLE_SEARCH_API_KEY' });
});

// ── GET /api/status ───────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const hasCredentials = !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const hasRapidAPI = !!process.env.RAPIDAPI_KEY;
  res.json({
    ok: true,
    dataforseo: hasCredentials,
    rapidapi: hasRapidAPI,
    timestamp: new Date().toISOString()
  });
});

// ── GET /api/_debug/multitenant ───────────────────────────────────────────────
// Owner-only observability for the multitenant rollout. Exposes:
//   • current enforcement mode (off | shadow | on)
//   • resolved default tenant id (used by crons & api-key callers)
//   • api-key tenant-injection hit/miss counters (since process start)
//   • principal/tenant on the current request (sanity check)
// Use this to detect drift — e.g. a rising miss counter means an api-key
// caller hit a path before getDefaultTenantId() could resolve a tenant.
app.get('/api/_debug/multitenant', (req, res) => {
  if (!req.user || req.user.isOwner !== true) {
    return res.status(403).json({ ok:false, error:'owner_only' });
  }
  const _ctx = require('./services/tenants/context');
  _ctx.getDefaultTenantId().then((defaultTenantId) => {
    const hits = global.__apiKeyTenantHits || 0;
    const miss = global.__apiKeyTenantMiss || 0;
    const total = hits + miss;
    res.json({
      ok: true,
      mode: _ctx.mode(),
      defaultTenantId,
      apiKeyTenant: {
        hits, miss,
        hitRate: total ? +(hits / total).toFixed(4) : null,
        warn: miss > 0 ? 'non-zero miss — api-key callers reached routes without a resolvable default tenant' : null,
      },
      request: {
        viaApiKey: !!req.viaApiKey,
        principalId: req.user ? req.user.id : null,
        tenantId: req.tenant ? req.tenant.id : null,
      },
      processUptimeSec: Math.round(process.uptime()),
    });
  }).catch((e) => {
    console.error('[_debug/multitenant] failed:', e.message);
    res.status(500).json({ ok:false, error:'debug_failed' });
  });
});

// ── GET /download-source — serves the full source code as a downloadable file ─
app.get('/download-source', (req, res) => {
  const files = ['package.json','server.js','data.js','index.html','style.css','app.js'];
  const sep = '='.repeat(64);
  let out = 'InfoGenie — Complete Source Code Backup\n';
  out += `Generated: ${new Date().toUTCString()}\n\n`;
  for (const f of files) {
    try {
      const content = require('fs').readFileSync(path.join(__dirname, f), 'utf8');
      out += `\n\n${sep}\nFILE: ${f}\n${sep}\n\n${content}`;
    } catch(e) { out += `\n\n[Could not read ${f}: ${e.message}]`; }
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="infogenie-source.txt"');
  res.send(out);
});

// ── GET /source — Syntax-highlighted source code viewer ───────────────────────
app.get('/source', (req, res) => {
  const fs = require('fs');
  const files = [
    { name: 'server.js',   lang: 'javascript' },
    { name: 'app.js',      lang: 'javascript' },
    { name: 'data.js',     lang: 'javascript' },
    { name: 'index.html',  lang: 'html' },
    { name: 'style.css',   lang: 'css' },
    { name: 'package.json', lang: 'json' },
  ];

  const loaded = files.map(f => {
    try {
      const content = fs.readFileSync(path.join(__dirname, f.name), 'utf8');
      const lines   = content.split('\n').length;
      const kb      = (Buffer.byteLength(content, 'utf8') / 1024).toFixed(1);
      return { ...f, content, lines, kb };
    } catch(e) {
      return { ...f, content: `// Could not read ${f.name}: ${e.message}`, lines: 1, kb: '0' };
    }
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>InfoGenie — Source Code</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #0A1628; color: #E5E7EB; min-height: 100vh; }

  .header { background: linear-gradient(135deg, #0A1628, #0D2A5E); border-bottom: 1px solid rgba(255,255,255,0.08); padding: 18px 32px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .logo-dot { width: 32px; height: 32px; background: linear-gradient(135deg, #00C9C8, #0066FF); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; }
  .logo-text { font-family: 'Sora', sans-serif; font-size: 1.1rem; font-weight: 800; color: white; }
  .logo-text span { color: #00C9C8; }
  .header-badge { background: rgba(0,201,200,0.15); border: 1px solid rgba(0,201,200,0.3); padding: 5px 14px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; color: #00C9C8; }
  .stats-bar { display: flex; gap: 24px; }
  .stat { text-align: center; }
  .stat-val { font-family: 'Sora', sans-serif; font-size: 1rem; font-weight: 800; color: #00E5FF; }
  .stat-lbl { font-size: 0.6rem; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: .06em; margin-top: 1px; }

  .tabs-bar { background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.07); padding: 0 24px; display: flex; gap: 2px; overflow-x: auto; }
  .tab { padding: 13px 20px; font-size: 0.78rem; font-weight: 600; color: rgba(255,255,255,0.45); cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; transition: all .15s; display: flex; align-items: center; gap: 8px; border-top: none; border-left: none; border-right: none; background: none; font-family: 'Inter', sans-serif; }
  .tab:hover { color: rgba(255,255,255,0.75); }
  .tab.active { color: #00C9C8; border-bottom-color: #00C9C8; }
  .tab-badge { font-size: 0.58rem; background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; color: rgba(255,255,255,0.4); font-weight: 600; }
  .tab.active .tab-badge { background: rgba(0,201,200,0.15); color: #00C9C8; }

  .file-panel { display: none; }
  .file-panel.active { display: flex; flex-direction: column; height: calc(100vh - 116px); }
  .file-meta { padding: 12px 28px; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
  .file-name { font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; font-weight: 500; color: #93C5FD; }
  .file-stat { font-size: 0.7rem; color: rgba(255,255,255,0.35); }
  .file-stat span { color: rgba(255,255,255,0.6); font-weight: 600; }
  .copy-btn { margin-left: auto; padding: 5px 14px; background: rgba(0,102,255,0.2); border: 1px solid rgba(0,102,255,0.35); border-radius: 7px; font-size: 0.7rem; font-weight: 700; color: #93C5FD; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .copy-btn:hover { background: rgba(0,102,255,0.35); }

  .code-wrap { flex: 1; overflow: auto; }
  pre[class*="language-"] { margin: 0 !important; padding: 24px 28px !important; border-radius: 0 !important; background: #0d1117 !important; font-family: 'JetBrains Mono', monospace !important; font-size: 0.78rem !important; line-height: 1.7 !important; min-height: 100%; }
  code[class*="language-"] { font-family: 'JetBrains Mono', monospace !important; font-size: 0.78rem !important; }

  .icon-js   { color: #F7DF1E; }
  .icon-html { color: #E44D26; }
  .icon-css  { color: #264DE4; }
  .icon-json { color: #10B981; }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="logo-dot">🧞</div>
    <div class="logo-text">Info<span>Genie</span></div>
    <div class="header-badge">Source Code Viewer</div>
  </div>
  <div class="stats-bar">
    <div class="stat"><div class="stat-val">${loaded.length}</div><div class="stat-lbl">Files</div></div>
    <div class="stat"><div class="stat-val">${loaded.reduce((a,f)=>a+f.lines,0).toLocaleString()}</div><div class="stat-lbl">Lines</div></div>
    <div class="stat"><div class="stat-val">${(loaded.reduce((a,f)=>a+parseFloat(f.kb),0)).toFixed(0)} KB</div><div class="stat-lbl">Total Size</div></div>
  </div>
</div>

<div class="tabs-bar">
  ${loaded.map((f,i) => {
    const icons = { javascript:'⬡', html:'◈', css:'◉', json:'{}' };
    const iconCls = { javascript:'icon-js', html:'icon-html', css:'icon-css', json:'icon-json' };
    return `<button class="tab${i===0?' active':''}" onclick="switchTab(${i})" id="tab-${i}">
      <span class="${iconCls[f.lang]||''}">${icons[f.lang]||'·'}</span>
      ${f.name}
      <span class="tab-badge">${f.lines.toLocaleString()} lines</span>
    </button>`;
  }).join('')}
</div>

${loaded.map((f,i) => `
<div class="file-panel${i===0?' active':''}" id="panel-${i}">
  <div class="file-meta">
    <div class="file-name">📄 ${f.name}</div>
    <div class="file-stat"><span>${f.lines.toLocaleString()}</span> lines &nbsp;·&nbsp; <span>${f.kb} KB</span></div>
    <button class="copy-btn" onclick="copyCode(${i})">📋 Copy</button>
  </div>
  <div class="code-wrap">
    <pre class="language-${f.lang} line-numbers"><code class="language-${f.lang}" id="code-${i}">${f.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre>
  </div>
</div>`).join('')}

<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-javascript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-markup.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-css.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-json.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/line-numbers/prism-line-numbers.min.js"></script>
<link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/line-numbers/prism-line-numbers.min.css" rel="stylesheet">
<script>
  function switchTab(idx) {
    document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', i===idx));
    document.querySelectorAll('.file-panel').forEach((p,i) => p.classList.toggle('active', i===idx));
  }
  function copyCode(idx) {
    const el = document.getElementById('code-'+idx);
    const text = el.innerText || el.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = event.target;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = '📋 Copy'; }, 1800);
    });
  }
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ── Generate Landing Page ─────────────────────────────────────────────────────
app.post('/api/landing-page', async (req, res) => {
  try {
    const {
      campName = 'Campaign', platform = 'Google Ads', description = '',
      tags = [], domain = 'yourdomain.com', industry = 'your industry',
      headlines = [], descriptions = [], budget = '$2,000/mo',
      compName = '', brandColor = '#0066FF'
    } = req.body;

    const h1 = headlines[0] || campName;
    const h2 = headlines[1] || `The smarter choice in ${industry}`;
    const h3 = headlines[2] || 'Start for free — results in 7 days';
    const d1 = descriptions[0] || description || `Outperform ${compName || 'competitors'} and win more customers.`;
    const d2 = descriptions[1] || `Join thousands of ${industry} businesses growing with smarter campaigns.`;
    const tagList = tags.slice(0, 5).join(', ') || industry;

    const prompt = `You are an expert conversion-rate-optimised landing page developer.
Generate a complete, self-contained HTML landing page for a ${platform} campaign.

Campaign: ${campName}
Domain: ${domain}
Industry: ${industry}
Headline 1: ${h1}
Headline 2: ${h2}
Headline 3: ${h3}
Description 1: ${d1}
Description 2: ${d2}
Key themes: ${tagList}
Budget: ${budget}
${compName ? `Competitor being targeted: ${compName}` : ''}

Requirements:
- Complete single-file HTML with embedded CSS and JS
- Modern, professional design with color scheme based on ${brandColor}
- Hero section with the H1, H2 headlines and a strong CTA button
- CRITICAL: Every CTA button and link must use href="https://${domain}" — NEVER use href="#" or href="javascript:void(0)"
- Benefits section (3 cards) derived from the campaign themes
- Social proof / trust section with 2–3 testimonial-style quotes
- Simple lead capture form (name, email, CTA button that links to https://${domain})
- Footer with domain name linked to https://${domain}
- Mobile responsive
- Fast-loading (no external dependencies except Google Fonts)
- Include conversion tracking placeholder comments
- The page should feel premium and directly speak to the campaign messaging

Return ONLY the complete HTML — no markdown, no explanation, just the raw HTML starting with <!DOCTYPE html>.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.7
    });

    let html = completion.choices[0]?.message?.content || '';
    // Strip any accidental markdown fences
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    // Post-process: replace all placeholder hrefs with the real domain URL
    const domainUrl = domain.startsWith('http') ? domain : `https://${domain}`;
    html = html.replace(/href=["']#["']/g, `href="${domainUrl}" target="_blank" rel="noopener"`);
    html = html.replace(/href=["']javascript:void\(0\)["']/g, `href="${domainUrl}" target="_blank" rel="noopener"`);
    html = html.replace(/href=["']javascript:;["']/g, `href="${domainUrl}" target="_blank" rel="noopener"`);
    // Replace form action="#" or action="" with domain URL
    html = html.replace(/action=["']#["']/g, `action="${domainUrl}"`);
    html = html.replace(/action=["']["']/g, `action="${domainUrl}"`);

    res.json({ html, campName, domain });
  } catch (err) {
    console.error('Landing page generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AutoSEO: Generate SEO Article ────────────────────────────────────────────
app.post('/api/generate-seo-article', async (req, res) => {
  try {
    const { title, keyword, domain, industry, competitors = [], wordCount = 1200, tone = 'professional' } = req.body;
    const compNames = competitors.slice(0, 3).join(', ') || 'leading competitors';
    const prompt = `You are an expert SEO content writer. Write a ${wordCount}-word, ${tone} SEO-optimized article.

Title: ${title}
Primary keyword: ${keyword}
Domain/Brand: ${domain}
Industry: ${industry}
Competitor context: ${compNames}

Requirements:
- Open with a compelling hook paragraph
- Use the primary keyword naturally 4-6 times
- Include 4-6 H2 subheadings with related long-tail keywords
- Include a FAQ section at the end with 3 questions
- End with a strong CTA directing readers to ${domain}
- Write in a ${tone}, authoritative tone that builds E-E-A-T signals
- Include 2-3 internal link placeholder comments like <!-- INTERNAL LINK: [topic] -->
- Total length: approximately ${wordCount} words
- Format as clean HTML (h1, h2, p, ul, li, strong — no CSS, no full page wrapper)

Return ONLY the article HTML content, no markdown, no explanation.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3000,
      temperature: 0.6
    });
    let content = completion.choices[0]?.message?.content || '';
    content = content.replace(/^```html\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
    const wordCountActual = content.replace(/<[^>]+>/g,'').trim().split(/\s+/).length;
    res.json({ content, title, keyword, wordCount: wordCountActual });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AutoSEO: Generate Article Topics ─────────────────────────────────────────
app.post('/api/generate-article-topics', async (req, res) => {
  try {
    const { domain, industry, competitors = [], count = 30, tone = 'professional' } = req.body;
    const prompt = `You are an expert SEO content strategist. Generate ${count} SEO-optimised article topics for ${domain} in the ${industry} industry.
Competitor context: ${competitors.slice(0,4).join(', ') || 'N/A'}

For each topic provide:
- title: compelling, keyword-rich article title
- keyword: primary target keyword (2-5 words)
- intent: Informational / Commercial / Transactional
- estimated_volume: monthly search volume estimate (number)
- difficulty: ranking difficulty 1-100

Mix of: beginner how-to guides, advanced deep-dives, comparison articles, listicles, and case studies.
Cover the full buyer journey from awareness to decision.

Return a JSON object with a "topics" array of ${count} objects. Return ONLY valid JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.6,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    const topics = parsed.topics || [];
    res.json({ topics });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AutoSEO: Backlink Opportunities ──────────────────────────────────────────
app.post('/api/backlink-opportunities', async (req, res) => {
  try {
    const { domain, industry, competitors = [], keywords = [] } = req.body;
    const prompt = `You are an SEO link-building strategist. Generate 8 high-authority backlink opportunities for ${domain} in the ${industry} industry.

Competitors for context: ${competitors.slice(0,4).join(', ') || 'N/A'}
Target keywords: ${keywords.slice(0,5).join(', ') || industry}

For each opportunity provide:
1. Site name and URL (real, high-DR authority site relevant to the industry)
2. Domain Rating estimate (50-90)
3. Link type (Guest Post / Resource Page / Broken Link / HARO / Directory / Podcast)
4. Outreach angle (1 sentence pitch)
5. Difficulty: Easy / Medium / Hard

Return a JSON array of 8 objects with fields: site, url, dr, type, angle, difficulty.
Return ONLY valid JSON, no markdown.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      temperature: 0.5,
      response_format: { type: 'json_object' }
    });
    let raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    const opportunities = parsed.opportunities || parsed.backlinks || parsed.sites || Object.values(parsed)[0] || [];
    // These targets are AI-generated, NOT verified live backlink data (the
    // DataForSEO Backlinks source is not active for this deployment). Tag the
    // payload as fabricated so the central data-mode enforcement layer can badge
    // it in demo mode or withhold it (data_unavailable) in strict mode.
    res.json({ opportunities, source: 'demo', _estimated: true });
  } catch(err) {
    // Deterministic real-source failure → record an issue for admins (the AI
    // fallback that normally masks this could not be produced at all).
    try {
      require('./services/admin/issues').raiseIssue({
        severity: 'warning',
        source: 'backlinks',
        code: 'backlink-opportunities:generation_failed',
        title: 'Backlink opportunity generation failed',
        detail: `AI generation of backlink opportunities failed: ${err.message}`,
        context: { domain: req.body && req.body.domain },
        route: '/api/backlink-opportunities',
        tenantId: req.tenant ? req.tenant.id : null,
        clientId: require('./services/admin/data_mode').clientIdFromReq(req),
      });
    } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

// ── AutoSEO: Keyword Research ─────────────────────────────────────────────────
app.post('/api/keyword-research', async (req, res) => {
  try {
    const { domain, industry, seedKeyword = '', competitors = [] } = req.body;
    const prompt = `You are an SEO keyword research specialist. Generate 15 high-value, low-competition keyword opportunities for ${domain} in the ${industry} industry.
${seedKeyword ? `Seed keyword: ${seedKeyword}` : ''}
Competitor context: ${competitors.slice(0,3).join(', ') || 'N/A'}

For each keyword provide:
1. keyword (the exact search term)
2. monthly_volume (estimated monthly searches, number)
3. difficulty (1-100, lower = easier to rank)
4. cpc (estimated cost per click in USD)
5. intent: Informational / Commercial / Transactional / Navigational
6. opportunity_score (1-10)
7. content_angle (brief content idea, 1 sentence)

Mix of: long-tail (3-5 words, difficulty < 30), medium (difficulty 30-60), and 2-3 competitor gap keywords.
Return a JSON object with a "keywords" array. Return ONLY valid JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.4,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    const keywords = parsed.keywords || [];
    res.json({ keywords });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WordPress Detection ───────────────────────────────────────────────────────
app.post('/api/detect-wordpress', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.json({ isWordPress: false });
  try {
    const base = url.startsWith('http') ? url.replace(/\/$/, '') : 'https://' + url.replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let isWordPress = false;
    let wpVersion = null;
    let signals = [];

    // Check 1: WP REST API endpoint
    try {
      const apiRes = await fetch(`${base}/wp-json/wp/v2/`, { signal: controller.signal, headers: { 'User-Agent': 'InfoGenie/1.0' } });
      if (apiRes.ok) { isWordPress = true; signals.push('WP REST API active'); }
    } catch(e) {}

    // Check 2: HTML source for wp-content / wp-includes
    if (!isWordPress) {
      try {
        const htmlRes = await fetch(base, { signal: controller.signal, headers: { 'User-Agent': 'InfoGenie/1.0' } });
        const text = await htmlRes.text();
        if (/wp-content|wp-includes|wordpress/i.test(text)) {
          isWordPress = true; signals.push('WP assets in HTML');
          const vMatch = text.match(/wordpress[^"']*ver(?:sion)?[=:]['"]\s*([\d.]+)/i) ||
                         text.match(/WordPress\s+([\d.]+)/i);
          if (vMatch) wpVersion = vMatch[1];
        }
      } catch(e) {}
    }

    // Check 3: /wp-login.php
    if (!isWordPress) {
      try {
        const loginRes = await fetch(`${base}/wp-login.php`, { method:'HEAD', signal: controller.signal });
        if (loginRes.status < 404) { isWordPress = true; signals.push('wp-login.php found'); }
      } catch(e) {}
    }

    clearTimeout(timer);
    res.json({ isWordPress, wpVersion, signals, siteUrl: base });
  } catch (err) {
    res.json({ isWordPress: false, error: err.message });
  }
});

// ── Publish to WordPress ──────────────────────────────────────────────────────
app.post('/api/publish-to-wordpress', async (req, res) => {
  const { siteUrl, username, appPassword, title, content, status = 'draft' } = req.body || {};
  if (!siteUrl || !username || !appPassword || !content) {
    return res.status(400).json({ error: 'siteUrl, username, appPassword and content are required' });
  }
  try {
    const base = siteUrl.startsWith('http') ? siteUrl.replace(/\/$/, '') : 'https://' + siteUrl.replace(/\/$/, '');
    const creds = Buffer.from(`${username}:${appPassword}`).toString('base64');
    const body  = {
      title:   title || 'Campaign Landing Page',
      content: content,
      status:  status,
      comment_status: 'closed'
    };
    const wpRes = await fetch(`${base}/wp-json/wp/v2/pages`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${creds}`
      },
      body: JSON.stringify(body)
    });
    const data = await wpRes.json();
    if (!wpRes.ok) {
      return res.status(400).json({ error: data.message || 'WordPress API error', code: data.code });
    }
    res.json({ success: true, pageId: data.id, pageUrl: data.link, editUrl: `${base}/wp-admin/post.php?post=${data.id}&action=edit`, status: data.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
};
