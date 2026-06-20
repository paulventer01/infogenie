const express = require('express');
const router = express.Router();
const _https = require('https');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasFirecrawl() { const k = process.env.FIRECRAWL_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _firecrawlScrape(url) {
  if (!_hasFirecrawl()) return null;
  return await new Promise(resolve => {
    const data = JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true });
    const req = _https.request({
      hostname:'api.firecrawl.dev', path:'/v1/scrape', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => { try { const j = JSON.parse(d); resolve(j?.data?.markdown ? String(j.data.markdown).slice(0, 6000) : null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(25000, () => { req.destroy(); resolve(null); });
    req.write(data); req.end();
  });
}

async function _gptPersonalize({ template, lead, scrapedContent, tone }) {
  if (!_hasOpenAI()) return null;
  let brandCtx = '';
  try { const bf = require('../brand_foundation/api'); if (bf.getBrandContextBlock) brandCtx = await bf.getBrandContextBlock(); } catch {}
  const system = `${brandCtx ? brandCtx + '\n\n' : ''}You are a senior B2B sales copywriter. Personalize cold emails based on real research. Stay on-brand (respect the brand voice + banned words above). Reply with strict JSON only: {"subject":"...","body":"...","reasoning":"one-line note on what you used to personalize"}. Never invent facts.`;
  const userMsg = `Base email template:
"""
${String(template).slice(0, 2000)}
"""

Lead:
- Name: ${lead.name || 'Unknown'}
- Role: ${lead.role || 'Unknown'}
- Company: ${lead.company || 'Unknown'}
- Website: ${lead.website || 'Unknown'}
- LinkedIn: ${lead.linkedin || 'Unknown'}

${scrapedContent ? `Recent content from their website (use 1-2 specific facts to personalize, NEVER invent):
"""
${scrapedContent.slice(0, 4000)}
"""` : '(No website content available — keep generic but personalize using role/company name only.)'}

Tone: ${tone || 'professional, warm, specific'}

Rules:
- Subject ≤ 60 chars, no clickbait, no emojis
- Body ≤ 130 words, opens with a SPECIFIC observation about THIS company (not generic)
- End with a low-friction CTA (single clear ask)
- Replace any [PLACEHOLDER] tokens in the template with real values
- Never use "I hope this finds you well" or other AI tells
- Output strict JSON only.`;

  return await new Promise(resolve => {
    const body = JSON.stringify({
      model: 'gpt-5-mini', temperature: 0.4, max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [{ role:'system', content: system }, { role:'user', content: userMsg }]
    });
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content;
          if (!txt) return resolve(null);
          const parsed = JSON.parse(txt);
          if (!parsed.subject || !parsed.body) return resolve(null);
          resolve({ subject: String(parsed.subject).slice(0, 200), body: String(parsed.body).slice(0, 2000), reasoning: String(parsed.reasoning || '').slice(0, 300) });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(35000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

function _templateFallback(template, lead) {
  let subject = `Quick question for ${lead.company || 'your team'}`;
  let body = String(template || '')
    .replace(/\[NAME\]/gi, lead.name || 'there')
    .replace(/\[FIRST_NAME\]/gi, (lead.name || 'there').split(' ')[0])
    .replace(/\[COMPANY\]/gi, lead.company || 'your company')
    .replace(/\[ROLE\]/gi, lead.role || 'your role')
    .replace(/\[WEBSITE\]/gi, lead.website || 'your website');
  return { subject, body, reasoning: 'Template fallback (no AI/research) — added for safety.' };
}

router.get('/test', (req, res) => {
  res.json({ ok:true, openai: _hasOpenAI(), firecrawl: _hasFirecrawl(), can_research: _hasFirecrawl() && _hasOpenAI() });
});

router.post('/personalize', async (req, res) => {
  const template = String(req.body?.template || '').trim();
  const lead = req.body?.lead || {};
  const tone = String(req.body?.tone || 'professional');
  const research = req.body?.research !== false;
  if (!template) return _err(res, 400, 'template required');
  if (!lead.company && !lead.name) return _err(res, 400, 'lead must include at least name or company');

  let scraped = null;
  if (research && lead.website && _hasFirecrawl()) {
    const url = /^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`;
    scraped = await _firecrawlScrape(url);
  }

  const ai = await _gptPersonalize({ template, lead, scrapedContent: scraped, tone });
  if (ai) return res.json({ ok:true, source:'ai', research_used: !!scraped, email: ai });
  const fb = _templateFallback(template, lead);
  res.json({ ok:true, source:'template', research_used:false, email: fb, note:'AI unavailable — used template substitution. Set OPENAI key for personalization.' });
});

router.post('/bulk', async (req, res) => {
  const template = String(req.body?.template || '').trim();
  const leads = Array.isArray(req.body?.leads) ? req.body.leads.slice(0, 25) : [];
  const tone = String(req.body?.tone || 'professional');
  const research = req.body?.research !== false;
  if (!template) return _err(res, 400, 'template required');
  if (!leads.length) return _err(res, 400, 'leads array required (max 25)');

  const results = await Promise.all(leads.map(async (lead) => {
    try {
      let scraped = null;
      if (research && lead.website && _hasFirecrawl()) {
        const url = /^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`;
        scraped = await _firecrawlScrape(url);
      }
      const ai = await _gptPersonalize({ template, lead, scrapedContent: scraped, tone });
      return ai ? { ok:true, lead, source:'ai', research_used: !!scraped, email: ai } : { ok:true, lead, source:'template', research_used:false, email: _templateFallback(template, lead) };
    } catch (e) { return { ok:false, lead, error: e.message }; }
  }));
  const ok = results.filter(r => r.ok).length;
  const ai_count = results.filter(r => r.ok && r.source === 'ai').length;
  res.json({ ok:true, total: results.length, succeeded: ok, ai_personalized: ai_count, results });
});

module.exports = router;
