// AI Visibility Tracker.
// For each tracked query, we ask 4 different LLMs ("If someone asked you
// '<query>', what would you answer?") and parse the response for:
//   • whether the user's brand is named at all
//   • its position in any ranked list (1 = top of mind)
//   • which competitors got named instead
//   • which URLs got cited (for Perplexity)
// This is the "how does my brand show up in AI?" surface that Brandwatch
// markets but doesn't pair with action — we feed gaps into Content Scorer
// briefs so the user can close them.
const _db = require('../../db');
const _https = require('https');

const OPENAI_KEY    = () => process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = () => process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const PERPLEXITY_KEY= () => process.env.PERPLEXITY_API_KEY;
const GEMINI_KEY    = () => process.env.GEMINI_API_KEY;

function _httpJson(opts, body, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const req = _https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : {}, raw }); }
        catch { resolve({ status: res.statusCode, json: {}, raw }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const PROMPT_PREFIX = (q) => `${q}\n\nAnswer in 4-6 sentences. If you would recommend specific products, services, or brands, list them clearly with a brief reason for each. Be honest and specific.`;

async function _callOpenAI(query) {
  if (!OPENAI_KEY()) return { error:'no-openai-key' };
  const r = await _httpJson({
    hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
    headers:{ 'Authorization':'Bearer '+OPENAI_KEY(), 'Content-Type':'application/json' },
  }, { model:'gpt-4o-mini', messages:[{role:'user', content: PROMPT_PREFIX(query)}], temperature:0.4, max_tokens:400 });
  if (r.status !== 200) return { error: r.json?.error?.message || ('openai '+r.status) };
  return { text: r.json?.choices?.[0]?.message?.content || '', tokens: r.json?.usage?.total_tokens || 0, citations: [] };
}

async function _callAnthropic(query) {
  if (!ANTHROPIC_KEY()) return { error:'no-anthropic-key' };
  const r = await _httpJson({
    hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
    headers:{ 'x-api-key':ANTHROPIC_KEY(), 'anthropic-version':'2023-06-01', 'Content-Type':'application/json' },
  }, { model:'claude-3-5-haiku-20241022', max_tokens:400, messages:[{role:'user', content: PROMPT_PREFIX(query)}] });
  if (r.status !== 200) return { error: r.json?.error?.message || ('anthropic '+r.status) };
  const text = (r.json?.content || []).map(c => c.text || '').join('\n');
  return { text, tokens: (r.json?.usage?.input_tokens||0)+(r.json?.usage?.output_tokens||0), citations: [] };
}

async function _callPerplexity(query) {
  if (!PERPLEXITY_KEY()) return { error:'no-perplexity-key' };
  const r = await _httpJson({
    hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
    headers:{ 'Authorization':'Bearer '+PERPLEXITY_KEY(), 'Content-Type':'application/json' },
  }, { model:'sonar', messages:[{role:'user', content: PROMPT_PREFIX(query)}], temperature:0.4, max_tokens:400 });
  if (r.status !== 200) return { error: r.json?.error?.message || r.json?.detail || ('perplexity '+r.status) };
  const text = r.json?.choices?.[0]?.message?.content || '';
  const citations = Array.isArray(r.json?.citations) ? r.json.citations.slice(0, 12) : [];
  return { text, tokens: r.json?.usage?.total_tokens || 0, citations };
}

async function _callGemini(query) {
  if (!GEMINI_KEY()) return { error:'no-gemini-key' };
  const r = await _httpJson({
    hostname:'generativelanguage.googleapis.com',
    path:'/v1beta/models/gemini-flash-latest:generateContent?key=' + encodeURIComponent(GEMINI_KEY()),
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
  }, { contents:[{ parts:[{ text: PROMPT_PREFIX(query) }] }], generationConfig:{ temperature:0.4, maxOutputTokens:400 } });
  if (r.status !== 200) return { error: r.json?.error?.message || ('gemini '+r.status) };
  const text = (r.json?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n');
  return { text, tokens: r.json?.usageMetadata?.totalTokenCount || 0, citations: [] };
}

const PROVIDERS = {
  openai:    _callOpenAI,
  anthropic: _callAnthropic,
  perplexity:_callPerplexity,
  gemini:    _callGemini,
};

function _parseBrandSignals(text, brand, competitors) {
  const lc = text.toLowerCase();
  const brandLc = String(brand || '').toLowerCase().trim();
  const mentioned = !!brandLc && lc.includes(brandLc);

  // Try to detect rank in a numbered or bulleted list.
  let position = null;
  if (mentioned) {
    const lines = text.split(/\n+/);
    let rank = 0;
    for (const ln of lines) {
      if (/^\s*([0-9]+|[•*\-])[\.\)]?\s+/.test(ln)) {
        rank++;
        if (ln.toLowerCase().includes(brandLc)) { position = rank; break; }
      }
    }
  }

  const compHits = [];
  for (const c of (competitors || [])) {
    const cLc = String(c || '').toLowerCase().trim();
    if (cLc && lc.includes(cLc)) compHits.push(c);
  }
  return { mentioned, position, competitorHits: compHits };
}

async function runQueryAcrossProviders(queryRow) {
  if (!_db.hasDb()) throw new Error('db not configured');
  const pool = _db.getPool();
  const summary = { queryId: queryRow.id, providers: {}, brandHits: 0, competitorTotal: 0 };

  const providerNames = Object.keys(PROVIDERS);
  const settled = await Promise.all(providerNames.map(p => PROVIDERS[p](queryRow.query).catch(e => ({ error: e.message }))));

  for (let i = 0; i < providerNames.length; i++) {
    const provider = providerNames[i];
    const out = settled[i] || {};
    if (out.error) {
      await pool.query(`
        INSERT INTO search_intel_llm_runs (tenant_id, query_id, provider, response_text, brand_mentioned, error)
        VALUES ($1,$2,$3,'',false,$4)
      `, [queryRow.tenant_id, queryRow.id, provider, String(out.error).slice(0, 400)]);
      summary.providers[provider] = { error: out.error };
      continue;
    }
    const { mentioned, position, competitorHits } = _parseBrandSignals(out.text || '', queryRow.brand, queryRow.competitors || []);
    await pool.query(`
      INSERT INTO search_intel_llm_runs (tenant_id, query_id, provider, response_text, brand_mentioned, brand_position, competitor_hits, citations, tokens_used)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [queryRow.tenant_id, queryRow.id, provider, (out.text||'').slice(0, 8000), mentioned, position, JSON.stringify(competitorHits), JSON.stringify(out.citations||[]), out.tokens || null]);
    summary.providers[provider] = { mentioned, position, competitorHits, citations: out.citations||[], textPreview: (out.text||'').slice(0, 220) };
    if (mentioned) summary.brandHits++;
    summary.competitorTotal += competitorHits.length;
  }
  await pool.query(`UPDATE search_intel_queries SET last_run_at = now() WHERE id=$1`, [queryRow.id]);
  return summary;
}

async function listQueries(tenantId) {
  if (!_db.hasDb()) return [];
  const r = await _db.getPool().query(`
    SELECT q.*,
      (SELECT COUNT(*)::int FROM search_intel_llm_runs r WHERE r.query_id=q.id AND r.brand_mentioned) AS hit_count,
      (SELECT COUNT(*)::int FROM search_intel_llm_runs r WHERE r.query_id=q.id) AS run_count
    FROM search_intel_queries q
    WHERE q.tenant_id=$1
    ORDER BY q.created_at DESC LIMIT 200
  `, [tenantId]);
  return r.rows;
}

async function createQuery(payload, tenantId) {
  if (!_db.hasDb()) throw new Error('db not configured');
  if (tenantId == null) throw new Error('no_tenant');
  const query = String(payload?.query || '').trim().slice(0, 500);
  const brand = String(payload?.brand || '').trim().slice(0, 200);
  if (!query || !brand) throw new Error('query and brand required');
  const competitors = Array.isArray(payload?.competitors)
    ? payload.competitors.map(c => String(c || '').trim()).filter(Boolean).slice(0, 10) : [];
  const locale = String(payload?.locale || 'en-US').slice(0, 16);
  const r = await _db.getPool().query(`
    INSERT INTO search_intel_queries (tenant_id, query, brand, competitors, locale)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (tenant_id, query, brand, locale) DO UPDATE SET competitors = EXCLUDED.competitors
    RETURNING *
  `, [tenantId, query, brand, competitors, locale]);
  return r.rows[0];
}

async function deleteQuery(id, tenantId) {
  if (!_db.hasDb()) return false;
  await _db.getPool().query(`DELETE FROM search_intel_queries WHERE id=$1 AND tenant_id=$2`, [Number(id), tenantId]);
  return true;
}

async function getRunHistory(queryId, tenantId, limit = 40) {
  if (!_db.hasDb()) return [];
  const r = await _db.getPool().query(`
    SELECT r.id, r.provider, r.brand_mentioned, r.brand_position, r.competitor_hits, r.citations, r.response_text, r.tokens_used, r.error, r.ran_at
    FROM search_intel_llm_runs r
    JOIN search_intel_queries q ON q.id = r.query_id
    WHERE r.query_id=$1 AND q.tenant_id=$2 ORDER BY r.ran_at DESC LIMIT $3
  `, [Number(queryId), tenantId, Math.min(Math.max(Number(limit)||40, 1), 200)]);
  return r.rows;
}

let _runAllInFlight = false;
async function runAllEnabled() {
  if (_runAllInFlight) { console.warn('[search-intel] runAllEnabled skipped — previous run still in flight'); return { ok:false, skipped:true }; }
  _runAllInFlight = true;
  try { return await _runAllEnabledImpl(); } finally { _runAllInFlight = false; }
}
async function _runAllEnabledImpl() {
  if (!_db.hasDb()) return { ok:false, error:'no-db' };
  const r = await _db.getPool().query(`SELECT * FROM search_intel_queries WHERE enabled=true ORDER BY id ASC LIMIT 100`);
  const summaries = [];
  for (const q of r.rows) {
    try { summaries.push(await runQueryAcrossProviders(q)); }
    catch (e) { summaries.push({ queryId:q.id, error:e.message }); }
  }
  return { ok:true, ranAt: Date.now(), count: summaries.length, summaries };
}

let _cronTimer = null;
function startCron(intervalHours = 24) {
  if (_cronTimer) return false;
  setTimeout(() => { runAllEnabled().catch(e => console.warn('[ai-visibility] cron error:', e.message)); }, 90 * 1000);
  _cronTimer = setInterval(() => {
    runAllEnabled().catch(e => console.warn('[ai-visibility] cron error:', e.message));
  }, intervalHours * 3600 * 1000);
  return true;
}

// ── Suggest 3 prompts to track, based on brand + competitors + locale ──
// Used by the "✨ Suggest" button on the AI Visibility tracker UI.
async function suggestPrompts({ brand = '', competitors = [], locale = 'en-US' } = {}) {
  if (!OPENAI_KEY()) return { ok:false, error:'no-openai-key', prompts: _fallbackPrompts(brand) };
  const compStr = Array.isArray(competitors) && competitors.length
    ? competitors.filter(Boolean).join(', ')
    : '(none provided)';
  const sys = `You are an AI-visibility strategist. Given a brand, competitors, and locale, suggest 3 high-value PROMPTS this brand should track across LLMs (ChatGPT, Claude, Perplexity, Gemini). A good tracked prompt is something a real buyer would actually ask an AI — a category question, a comparison, or an alternatives query — where the brand's appearance (or absence) signals AI search visibility. Avoid prompts that name the brand directly. Locale: ${locale}.`;
  const user = `Brand: "${brand || '(unspecified)'}". Competitors: ${compStr}.

Return ONLY valid JSON (no markdown):
{ "prompts": ["prompt 1", "prompt 2", "prompt 3"] }

Examples for an email marketing SaaS:
{ "prompts": ["best email marketing platforms for small businesses", "alternatives to Mailchimp for startups", "what is the best transactional email service in 2025"] }`;
  try {
    const r = await _httpJson({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+OPENAI_KEY(), 'Content-Type':'application/json' },
    }, {
      model:'gpt-4o-mini',
      messages:[ { role:'system', content: sys }, { role:'user', content: user } ],
      temperature:0.6, max_tokens:260,
      response_format:{ type:'json_object' }
    });
    if (r.status !== 200) return { ok:false, error: r.json?.error?.message || ('openai '+r.status), prompts: _fallbackPrompts(brand) };
    const raw = r.json?.choices?.[0]?.message?.content || '{}';
    let parsed = {}; try { parsed = JSON.parse(raw); } catch {}
    const prompts = Array.isArray(parsed.prompts)
      ? parsed.prompts.filter(p => typeof p === 'string' && p.trim() && !/^_DUMMY/i.test(p)).map(p => p.trim()).slice(0, 3)
      : [];
    if (!prompts.length) return { ok:true, prompts: _fallbackPrompts(brand) };
    return { ok:true, prompts };
  } catch (e) {
    return { ok:false, error: e.message, prompts: _fallbackPrompts(brand) };
  }
}
function _fallbackPrompts(brand) {
  const b = (brand || '').trim();
  return [
    'best tools in this category for small businesses',
    b ? `alternatives to ${b}` : 'top alternatives in my category',
    'what is the best platform in 2025 for my use case'
  ];
}

module.exports = { runQueryAcrossProviders, listQueries, createQuery, deleteQuery, getRunHistory, runAllEnabled, startCron, suggestPrompts };
