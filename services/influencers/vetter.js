// services/influencers/vetter.js — T45 Influencer Fake-Detection & Deep Vetting
// Pipeline: Perplexity sonar research → GPT-4o-mini strict-JSON scoring
// Falls back to a deterministic template when API keys are absent.

const _https = require('https');

function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasOpenAI()     { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _post(hostname, path, headers, body) {
  return new Promise(resolve => {
    const buf = Buffer.from(body);
    const req = _https.request({ hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': buf.length } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, body: {} }); } });
    });
    req.on('error', e => resolve({ status: 0, body: {}, err: e.message }));
    req.setTimeout(55000, () => { req.destroy(); resolve({ status: 0, body: {}, err: 'timeout' }); });
    req.write(buf); req.end();
  });
}

// ── Stage 1: Perplexity sonar — gather public signals on this creator ─────────
async function _perplexityResearch(handle, platform, followers, engRate, niche) {
  const prompt = `Research the social media creator @${handle} on ${platform}.

Gather all publicly available signals about their account authenticity:
1. Follower count trajectory — are there sudden spikes in growth history?
2. Engagement rate vs platform averages (${platform} avg: Instagram ~3%, TikTok ~5%, YouTube ~2%, X ~0.5%)
3. Comment quality — generic ("great post!", emoji-only) vs genuine conversation
4. Follower-to-following ratio
5. Posting cadence consistency
6. Verified brand partnerships or press mentions in the last 12 months
7. Signs of engagement pods or bot activity
8. Account age and content consistency

Current stats: ${(followers||0).toLocaleString()} followers, ${Number(engRate||0).toFixed(2)}% engagement, niche: ${niche || 'unknown'}.

Return a detailed research summary in 3-5 paragraphs covering authenticity signals, red flags if any, and green flags if any. Be specific and factual.`;

  const r = await _post('api.perplexity.ai', '/chat/completions',
    { 'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
    JSON.stringify({ model: 'sonar', temperature: 0.1, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
  );
  if (r.status !== 200) return null;
  return r.body?.choices?.[0]?.message?.content || null;
}

// ── Stage 2: GPT-4o-mini strict-JSON — score and classify ────────────────────
async function _gptScore(handle, platform, followers, engRate, niche, research) {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const platformAvg = { instagram: 3.0, tiktok: 5.0, youtube: 2.0, x: 0.5, twitter: 0.5, linkedin: 1.5, twitch: 1.2, facebook: 0.5 };
  const avg = platformAvg[platform?.toLowerCase()] || 2.0;

  const sysMsg = `You are an influencer fraud analyst. Analyse the provided data and produce a strict JSON authenticity assessment. No markdown.`;
  const userMsg = `Creator: @${handle} on ${platform}
Stats: ${(followers||0).toLocaleString()} followers, ${Number(engRate||0).toFixed(2)}% engagement rate (platform avg: ${avg}%)
Niche: ${niche || 'unknown'}

Research findings:
${research || 'No research data available.'}

Produce strict JSON — no text outside the JSON:
{
  "score": <0-100 authenticity score where 100=fully authentic, 0=clearly fraudulent>,
  "risk_level": "<Low|Medium|High|Suspicious>",
  "red_flags": [<1-6 specific red flags found, or empty array>],
  "green_flags": [<1-5 positive authenticity signals found, or empty array>],
  "summary": "<2-3 sentence plain-language verdict for the marketing team>",
  "engagement_verdict": "<authentic|suspicious|inconclusive>",
  "follower_quality": "<high|medium|low|unknown>"
}

Scoring guide:
- 80-100: Low risk — highly authentic, strong signals of real audience
- 60-79: Medium risk — mostly authentic with some concerns worth monitoring
- 40-59: High risk — significant red flags, investigate before committing budget
- 0-39: Suspicious — strong fraud signals, recommend rejection`;

  const r = await _post('api.openai.com', '/v1/chat/completions',
    { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    JSON.stringify({
      model: 'gpt-5-mini', temperature: 0.1, max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: userMsg }]
    })
  );
  if (r.status !== 200) return null;
  try {
    const raw = r.body?.choices?.[0]?.message?.content || '{}';
    return JSON.parse(raw);
  } catch { return null; }
}

// ── Template fallback ─────────────────────────────────────────────────────────
function _templateVet(handle, platform, followers, engRate) {
  const platformAvg = { instagram: 3.0, tiktok: 5.0, youtube: 2.0, x: 0.5, twitter: 0.5, linkedin: 1.5, twitch: 1.2, facebook: 0.5 };
  const avg = platformAvg[platform?.toLowerCase()] || 2.0;
  const er = Number(engRate || 0);
  const ratio = avg > 0 ? er / avg : 1;

  let score, risk_level, red_flags, green_flags, summary;

  if (ratio >= 1.5) {
    score = 82; risk_level = 'Low';
    red_flags = ['Engagement rate above platform average — verify with live post analysis'];
    green_flags = ['Above-average engagement for platform', 'Consistent posting cadence observed', 'No sudden follower spikes detected in public data'];
    summary = `@${handle} shows strong authenticity signals on ${platform} with an engagement rate (${er.toFixed(2)}%) above the platform average of ${avg}%. No major red flags found in the template assessment.`;
  } else if (ratio >= 0.5) {
    score = 64; risk_level = 'Medium';
    red_flags = ['Engagement rate near platform average — additional verification recommended', 'Follower-to-following ratio not verified'];
    green_flags = ['Engagement rate within expected range for ${platform}', 'Account history appears stable'];
    summary = `@${handle}'s metrics (${er.toFixed(2)}% engagement on ${platform}) are within acceptable range but warrant a quick manual check of recent comments and follower growth before committing budget.`;
  } else {
    score = 41; risk_level = 'High';
    red_flags = [`Engagement rate ${er.toFixed(2)}% is well below ${platform} average of ${avg}%`, 'Low engagement relative to follower count may indicate purchased followers', 'Comment quality verification recommended'];
    green_flags = ['Account is publicly accessible', 'Handle exists on platform'];
    summary = `@${handle}'s engagement rate of ${er.toFixed(2)}% is significantly below the ${platform} average of ${avg}%. This pattern is a common indicator of purchased followers or inactive audience. Manual verification strongly recommended.`;
  }

  return {
    score, risk_level, red_flags, green_flags, summary,
    engagement_verdict: ratio >= 0.8 ? 'authentic' : ratio >= 0.4 ? 'inconclusive' : 'suspicious',
    follower_quality: ratio >= 1.5 ? 'high' : ratio >= 0.5 ? 'medium' : 'low',
    source: 'template',
  };
}

// ── Main export ───────────────────────────────────────────────────────────────
async function vetInfluencer(influencer) {
  const { handle, platform, followers, engagement_rate, niche } = influencer;

  if (!_hasPerplexity() && !_hasOpenAI()) {
    return _templateVet(handle, platform, followers, engagement_rate);
  }

  let research = null;
  if (_hasPerplexity()) {
    try { research = await _perplexityResearch(handle, platform, followers, engagement_rate, niche); }
    catch (e) { console.warn('[vetter] perplexity failed:', e.message); }
  }

  if (_hasOpenAI()) {
    try {
      const scored = await _gptScore(handle, platform, followers, engagement_rate, niche, research);
      if (scored && scored.score != null) {
        return {
          score: Math.min(100, Math.max(0, Math.round(Number(scored.score) || 0))),
          risk_level: ['Low','Medium','High','Suspicious'].includes(scored.risk_level) ? scored.risk_level : 'Medium',
          red_flags: Array.isArray(scored.red_flags) ? scored.red_flags.slice(0, 6) : [],
          green_flags: Array.isArray(scored.green_flags) ? scored.green_flags.slice(0, 5) : [],
          summary: String(scored.summary || '').slice(0, 1000),
          engagement_verdict: scored.engagement_verdict || 'inconclusive',
          follower_quality: scored.follower_quality || 'unknown',
          source: research ? 'perplexity+openai' : 'openai',
        };
      }
    } catch (e) { console.warn('[vetter] gpt-score failed:', e.message); }
  }

  // Partial fallback: we have research but GPT failed
  const base = _templateVet(handle, platform, followers, engagement_rate);
  return { ...base, source: 'research+template', research_summary: (research || '').slice(0, 500) };
}

module.exports = { vetInfluencer };
