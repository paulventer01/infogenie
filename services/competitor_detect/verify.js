'use strict';

/**
 * Same-industry + same-business competitor gate.
 * Candidates must pass a deterministic blocklist AND a multi-LLM vote
 * (OpenAI, Claude, Gemini, Perplexity) before they are treated as rivals.
 * No INDUSTRY_DB / simulated names are invented here.
 */

const SKIP = [
  'google.com', 'youtube.com', 'facebook.com', 'wikipedia.org', 'twitter.com',
  'x.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'amazon.com',
  'pinterest.com', 'tiktok.com', 'quora.com', 'medium.com', 'forbes.com',
  'bloomberg.com', 'apple.com', 'microsoft.com', 'cloudflare.com',
];

function normalizeDomain(raw) {
  return String(raw || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
}

function isBlockedDomain(domain, subjectDomain, infoSitePattern) {
  const d = normalizeDomain(domain);
  if (!d || !d.includes('.')) return true;
  if (subjectDomain && d === normalizeDomain(subjectDomain)) return true;
  if (SKIP.some((s) => d === s || d.endsWith('.' + s))) return true;
  if (infoSitePattern && infoSitePattern.test(d)) return true;
  return false;
}

function prefilter(candidates, subjectDomain, infoSitePattern) {
  const seen = new Set();
  const out = [];
  for (const c of candidates || []) {
    const url = normalizeDomain(c.url || c.domain);
    if (isBlockedDomain(url, subjectDomain, infoSitePattern)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      name: String(c.name || url).trim().slice(0, 80),
      url,
      why: String(c.why || '').trim().slice(0, 240),
      source: c.source || null,
    });
  }
  return out;
}

function parseVotes(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    try { obj = JSON.parse(cleaned); } catch { return []; }
  }
  const list = Array.isArray(obj) ? obj : (obj?.votes || obj?.competitors || []);
  if (!Array.isArray(list)) return [];
  return list.map((v) => ({
    url: normalizeDomain(v.url || v.domain),
    sameIndustry: v.sameIndustry === true || v.same_industry === true,
    sameBusiness: v.sameBusiness === true || v.same_business === true,
    accept: v.accept === true,
    reason: String(v.reason || '').slice(0, 200),
  })).filter((v) => v.url);
}

function tally(candidates, ballots) {
  return candidates.map((c) => {
    const votes = [];
    for (const b of ballots) {
      const v = (b.votes || []).find((x) => x.url === c.url);
      if (v) votes.push({ model: b.model, ...v });
    }
    const strict = votes.filter((v) => v.accept && v.sameIndustry && v.sameBusiness);
    const needed = votes.length >= 3 ? 2 : Math.max(1, Math.ceil(votes.length / 2));
    const verified = votes.length > 0 && strict.length >= needed;
    return {
      ...c,
      verified,
      sameIndustry: votes.length ? votes.every((v) => v.sameIndustry) || strict.length >= needed : false,
      sameBusiness: votes.length ? votes.every((v) => v.sameBusiness) || strict.length >= needed : false,
      votes,
    };
  });
}

function buildPrompt(subject, candidates) {
  const list = candidates.map((c, i) => `${i + 1}. ${c.name} — ${c.url}${c.why ? ` (${c.why})` : ''}`).join('\n');
  return `You are a competitive-intelligence analyst. Decide which candidates are DIRECT rivals of the subject company.

SUBJECT DOMAIN: ${subject.domain || '(unknown)'}
INDUSTRY: ${subject.industryName || '(unknown)'}
SUB-NICHE: ${subject.subNiche || '(unknown)'}
WHAT THEY SELL / DO: ${subject.businessSummary || '(unknown)'}

CANDIDATES:
${list}

Rules:
- sameIndustry = they sell into the IDENTICAL industry (not adjacent, not "similar").
- sameBusiness = a typical customer of the subject would actively compare this candidate before buying the same product/service.
- accept = sameIndustry AND sameBusiness. If maybe / adjacent / marketplace / review site / news / generic platform → accept=false.
- Do NOT invent extra companies. Vote only on the listed candidates.
- Prefer false negatives over wrong-industry rivals.

Return ONLY JSON:
{"votes":[{"url":"example.com","sameIndustry":true,"sameBusiness":true,"accept":true,"reason":"one short sentence"}]}`;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function voteOpenAI(openaiChatWithRetry, prompt) {
  if (!openaiChatWithRetry) return null;
  const completion = await openaiChatWithRetry({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'Output strict JSON only. Reject adjacent or different-business candidates.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
  }, { fallbackModel: 'gpt-5-mini', retries: 1 });
  return parseVotes(completion.choices?.[0]?.message?.content || '{}');
}

async function voteClaude(anthropic, prompt) {
  if (!anthropic || !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) return null;
  const key = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (msg.content || []).map((p) => p.text || '').join('');
  return parseVotes(text);
}

async function voteGemini(prompt) {
  const key = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseVotes(text);
}

async function votePerplexity(prompt) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const r = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: 'Use live web knowledge. Output JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 1200,
    }),
  });
  const j = await r.json();
  return parseVotes(j?.choices?.[0]?.message?.content || '{}');
}

/**
 * @returns {{ accepted, rejected, modelsUsed, unverified }}
 */
async function verifyCompetitors({
  subject,
  candidates,
  openaiChatWithRetry,
  anthropic,
  infoSitePattern,
  timeoutMs = 14000,
}) {
  const filtered = prefilter(candidates, subject?.domain, infoSitePattern);
  if (!filtered.length) {
    return { accepted: [], rejected: [], modelsUsed: [], unverified: true };
  }

  const prompt = buildPrompt(subject || {}, filtered);
  const jobs = [
    { model: 'openai', run: () => voteOpenAI(openaiChatWithRetry, prompt) },
    { model: 'claude', run: () => voteClaude(anthropic, prompt) },
    { model: 'gemini', run: () => voteGemini(prompt) },
    { model: 'perplexity', run: () => votePerplexity(prompt) },
  ];

  const settled = await Promise.all(jobs.map(async (j) => {
    try {
      const votes = await withTimeout(j.run(), timeoutMs);
      return votes && votes.length ? { model: j.model, votes } : null;
    } catch (e) {
      console.warn(`[competitor-verify] ${j.model} failed:`, e.message);
      return null;
    }
  }));
  const ballots = settled.filter(Boolean);
  const scored = tally(filtered, ballots);

  if (!ballots.length) {
    // No LLM available — keep live SERP/DFS rows only, never invented names.
    const live = filtered.filter((c) => c.source === 'serp' || c.source === 'dataforseo');
    return {
      accepted: live.map((c) => ({ ...c, verified: false })),
      rejected: filtered.filter((c) => !live.includes(c)),
      modelsUsed: [],
      unverified: true,
    };
  }

  return {
    accepted: scored.filter((c) => c.verified),
    rejected: scored.filter((c) => !c.verified),
    modelsUsed: ballots.map((b) => b.model),
    unverified: false,
  };
}

module.exports = {
  normalizeDomain,
  isBlockedDomain,
  prefilter,
  parseVotes,
  tally,
  verifyCompetitors,
  SKIP,
};
