const express = require('express');
const _https  = require('https');
const { normalizeChatParams } = require('../ai_compat');
const _url    = require('url');
const _dns    = require('dns').promises;
const router  = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

// ── AI helpers ────────────────────────────────────────────────────────────────

function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify(normalizeChatParams({
    model: opts.model || 'gpt-4o-mini',
    messages,
    response_format: opts.json ? { type: 'json_object' } : undefined,
    temperature: 0.2,
    max_tokens: opts.max_tokens || 2000,
  }));
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) { console.warn('[web-extractor] openai status', r.statusCode, d.slice(0, 200)); return resolve(null); }
          const j = JSON.parse(d);
          resolve(j.choices[0].message.content);
        } catch { resolve(null); }
      });
    });
    req.on('error', e => { console.warn('[web-extractor] openai error', e.message); resolve(null); });
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _anthropic(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const systemMsg = messages.find(m => m.role === 'system');
  const userMsgs  = messages.filter(m => m.role !== 'system');
  const body = JSON.stringify({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: opts.max_tokens || 2000,
    ...(systemMsg ? { system: systemMsg.content } : {}),
    messages: userMsgs,
  });
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': key, 'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) { console.warn('[web-extractor] anthropic status', r.statusCode, d.slice(0, 200)); return resolve(null); }
          const j = JSON.parse(d);
          const text = j.content?.[0]?.text || '';
          // extract JSON object from response
          const match = text.match(/\{[\s\S]*\}/);
          resolve(match ? match[0] : text || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', e => { console.warn('[web-extractor] anthropic error', e.message); resolve(null); });
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _gemini(messages, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const parts = messages.map(m => ({ text: (m.role === 'system' ? '[SYSTEM] ' : '') + m.content }));
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseMimeType: opts.json ? 'application/json' : 'text/plain', maxOutputTokens: opts.max_tokens || 2000 },
  });
  const path = `/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'generativelanguage.googleapis.com', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) { console.warn('[web-extractor] gemini status', r.statusCode, d.slice(0, 200)); return resolve(null); }
          const j = JSON.parse(d);
          const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const match = text.match(/\{[\s\S]*\}/);
          resolve(match ? match[0] : text || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', e => { console.warn('[web-extractor] gemini error', e.message); resolve(null); });
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

async function _callAI(messages, opts = {}) {
  let raw = await _openai(messages, opts);
  if (!raw) raw = await _anthropic(messages, opts);
  if (!raw) raw = await _gemini(messages, opts);
  return raw;
}

// ── SSRF guard ────────────────────────────────────────────────────────────────

async function _ssrfGuard(rawUrl) {
  try {
    const p = new _url.URL(rawUrl);
    if (!['http:', 'https:'].includes(p.protocol)) return false;
    const host = p.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|0\.0\.0\.0)/i.test(host)) return false;
    const recs = await _dns.lookup(host, { all: true }).catch(() => []);
    for (const r of recs) {
      const ip = r.address;
      if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1') return false;
    }
    return true;
  } catch { return false; }
}

// ── Firecrawl fetch ───────────────────────────────────────────────────────────

async function _firecrawlFetch(url) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const body = JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true });
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.firecrawl.dev', path: '/v1/scrape', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { const j = JSON.parse(d); resolve(j.data?.markdown || j.markdown || null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.setTimeout(30000, () => req.destroy()); req.write(body); req.end();
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/extract', async (req, res) => {
  const { url, instruction } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) return _err(res, 400, 'invalid_url');
  if (!instruction || instruction.trim().length < 5) return _err(res, 400, 'instruction_required');
  const safe = await _ssrfGuard(url);
  if (!safe) return _err(res, 400, 'url_blocked');

  const markdown = await _firecrawlFetch(url);
  if (!markdown) return _err(res, 503, 'Could not fetch the page. Make sure FIRECRAWL_API_KEY is set and the URL is publicly accessible.');

  const sys = `You are an AI data extraction specialist. The user provides a webpage's content and an extraction instruction in plain English. Extract exactly what is requested and return structured JSON.

Return: {"columns":["<col1>","<col2>"],"rows":[{"col1":"val","col2":"val"}],"summary":"<1-2 sentence summary of what was found>","total_found":<number>}

Rules: Be exhaustive. If the requested data doesn't exist, return empty rows with a clear summary. Never invent data that isn't on the page.`;
  const user = `URL: ${url}\n\nEXTRACTION INSTRUCTION: ${instruction}\n\nPAGE CONTENT:\n${markdown.slice(0, 6000)}`;

  const raw = await _callAI([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true, max_tokens: 2000 });

  if (!raw) {
    return res.json({
      ok: true, source: 'unavailable',
      columns: ['content'], rows: [{ content: markdown.slice(0, 500) }],
      summary: 'No AI provider available. Configure one under Manage → AI Providers.',
      total_found: 1,
    });
  }

  try {
    const data = JSON.parse(raw);
    res.json({ ok: true, source: 'ai', url, instruction, ...data });
  } catch {
    res.json({ ok: false, error: 'Could not parse extracted data from AI response.' });
  }
});

module.exports = router;
