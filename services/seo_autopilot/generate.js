/**
 * Article + keyword generation for SEO autopilot (fail-open to demo content).
 */
const { chatForCategory } = require('../ai/chat_router');

function _demoKeywords(niche) {
  const n = String(niche || 'your business').toLowerCase();
  return [
    { keyword: `best ${n} for beginners`, monthly_volume: 2400, difficulty: 28, intent: 'Informational', opportunity_score: 82 },
    { keyword: `how to choose ${n}`, monthly_volume: 1900, difficulty: 22, intent: 'Informational', opportunity_score: 88 },
    { keyword: `${n} vs alternatives`, monthly_volume: 1200, difficulty: 35, intent: 'Commercial', opportunity_score: 74 },
    { keyword: `${n} pricing guide`, monthly_volume: 980, difficulty: 31, intent: 'Commercial', opportunity_score: 76 },
    { keyword: `${n} checklist 2026`, monthly_volume: 720, difficulty: 18, intent: 'Informational', opportunity_score: 91 },
    { keyword: `top ${n} mistakes`, monthly_volume: 1600, difficulty: 25, intent: 'Informational', opportunity_score: 85 },
  ];
}

function _demoCalendar(keywords, days = 30) {
  const cal = [];
  const start = new Date();
  start.setHours(9, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const kw = keywords[i % keywords.length];
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    cal.push({
      day: i + 1,
      date: d.toISOString().slice(0, 10),
      title: String(kw.keyword).replace(/\b\w/g, (c) => c.toUpperCase()) + ': A Complete Guide',
      keyword: kw.keyword,
      intent: kw.intent || 'Informational',
      status: i === 0 ? 'queued' : 'planned',
      estimated_volume: kw.monthly_volume || 0,
    });
  }
  return cal;
}

function _demoArticle({ title, keyword, domain, brand }) {
  const b = brand || domain || 'our team';
  const html = `<h1>${title}</h1>
<p>Looking for practical advice on <strong>${keyword}</strong>? ${b} put together this guide so you can act with confidence — not guesswork.</p>
<h2>Why ${keyword} matters now</h2>
<p>Searchers and AI assistants both reward clear, experience-backed answers. This article covers what to do first, what to avoid, and how to measure results.</p>
<h2>Step-by-step approach</h2>
<ul>
<li>Define the outcome you want in the next 30 days</li>
<li>Pick one primary keyword cluster around “${keyword}”</li>
<li>Publish helpful content and update it from real results</li>
</ul>
<h2>Common mistakes</h2>
<p>Chasing volume without intent, ignoring internal links, and publishing once then going silent. Consistency beats perfection.</p>
<!-- INTERNAL LINK: related ${keyword} guide -->
<h2>FAQ</h2>
<p><strong>How long until I see results?</strong> Many teams see early impressions in 2–4 weeks if they publish consistently.</p>
<p><strong>Do I need a big budget?</strong> No — a focused niche and daily (or near-daily) publishing compounds.</p>
<p><strong>How does this help AI search?</strong> Clear structure and original answers make it easier for ChatGPT-style engines to cite you.</p>
<p><strong>Ready to go deeper?</strong> Visit ${domain || b} for tools, examples, and next steps.</p>`;
  return {
    content: html,
    title,
    keyword,
    wordCount: html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length,
    source: 'demo',
  };
}

async function researchKeywords({ tenantId, niche, domain, industry, competitors = [] }) {
  try {
    const r = await chatForCategory(
      'analysis',
      [
        {
          role: 'system',
          content: 'Return ONLY JSON: {"keywords":[{"keyword":"","monthly_volume":0,"difficulty":0,"intent":"Informational|Commercial|Transactional","opportunity_score":0,"content_angle":""}]}',
        },
        {
          role: 'user',
          content: `Niche: ${niche}\nDomain: ${domain || ''}\nIndustry: ${industry || niche}\nCompetitors: ${(competitors || []).slice(0, 4).join(', ') || 'n/a'}\nGenerate 12 high-opportunity SEO/GEO keywords.`,
        },
      ],
      {
        tenantId,
        surface: 'seo_growth_plan',
        tier: 'fast',
        escalate: false,
        useContextPack: true,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      },
    );
    const parsed = JSON.parse(String(r?.content || '{}').replace(/^```json\s*|```$/g, ''));
    if (Array.isArray(parsed.keywords) && parsed.keywords.length) {
      return { keywords: parsed.keywords.slice(0, 20), source: r?.provider || 'ai' };
    }
  } catch (_) {}
  return { keywords: _demoKeywords(niche), source: 'demo' };
}

async function buildCalendar({ keywords, days = 30 }) {
  const list = Array.isArray(keywords) && keywords.length ? keywords : _demoKeywords('business');
  return { calendar: _demoCalendar(list, days), source: 'planner' };
}

async function generateArticle({ tenantId, title, keyword, domain, brand, industry, tone = 'professional', wordCount = 1800 }) {
  try {
    const r = await chatForCategory(
      'writing',
      [
        {
          role: 'system',
          content:
            'You write SEO/GEO long-form articles as clean HTML (h1,h2,p,ul,li,strong). No markdown fences. Include FAQ and CTA.',
        },
        {
          role: 'user',
          content: `Title: ${title}\nKeyword: ${keyword}\nBrand/Domain: ${brand || domain}\nIndustry: ${industry || ''}\nTone: ${tone}\nTarget words: ${wordCount}\nWrite the full article HTML now.`,
        },
      ],
      {
        tenantId,
        surface: 'seo_autopilot_article',
        tier: 'fast',
        escalate: { minChars: 400 },
        max_tokens: 3500,
        temperature: 0.55,
      },
    );
    let content = String(r?.content || '').replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    if (content.length > 400) {
      return {
        content,
        title,
        keyword,
        wordCount: content.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length,
        source: r?.cascade_tier || r?.provider || 'ai',
        call_trace_id: r?.call_trace_id || null,
      };
    }
  } catch (_) {}
  return _demoArticle({ title, keyword, domain, brand });
}

module.exports = {
  researchKeywords,
  buildCalendar,
  generateArticle,
  _demoKeywords,
  _demoCalendar,
  _demoArticle,
};
