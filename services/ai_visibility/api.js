// AI Search Visibility — queries the DataForSEO AI Optimization API to
// ask real LLMs (ChatGPT, Perplexity, Gemini, Claude) buyer-intent prompts
// and counts how often the user's brand vs each competitor is mentioned.
//
// Uses the same DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD already configured for
// the rest of InfoGenie. The AI Optimization product is a paid add-on on the
// DataForSEO account; if not subscribed the endpoint returns a clear error.

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => {
  console.warn('[ai-visibility]', e.stack || e.message);
  if (!res.headersSent) _err(res, 500, 'Internal server error');
}); }

const _PROVIDER_ENDPOINTS = {
  chatgpt:    '/v3/ai_optimization/chat_gpt/llm_responses/live',
  perplexity: '/v3/ai_optimization/perplexity/llm_responses/live',
  gemini:     '/v3/ai_optimization/gemini/llm_responses/live',
  claude:     '/v3/ai_optimization/claude/llm_responses/live',
};

const _PROVIDER_MODELS = {
  chatgpt:    'gpt-4o-mini',
  perplexity: 'sonar',
  gemini:     'gemini-2.0-flash-001',
  claude:     'claude-3-5-haiku-20241022',
};

function _auth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const pw    = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pw) return null;
  return 'Basic ' + Buffer.from(`${login}:${pw}`).toString('base64');
}

function _callDfs(endpoint, body, timeoutMs = 60000) {
  const auth = _auth();
  if (!auth) return Promise.reject(new Error('DataForSEO credentials not configured (need DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD)'));
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = _https.request({
      hostname: 'api.dataforseo.com',
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Invalid JSON from DataForSEO (status ' + r.statusCode + ')')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('DataForSEO timeout')); });
    req.write(data); req.end();
  });
}

// Recursively scan a DataForSEO response object for the assistant-output text.
// DataForSEO AI Optimization payload shapes vary per provider/version — we try
// every documented field name and then fall back to deep-traversal so a payload
// shape we haven't seen still yields the text instead of silently returning ''.
const _TEXT_FIELDS = new Set([
  'text', 'content', 'message', 'output', 'output_text', 'answer',
  'response', 'completion', 'assistant_message', 'generated_text', 'value'
]);
function _extractText(node, depth) {
  if (node == null || depth > 8) return '';
  if (typeof node === 'string') return node.length >= 20 ? node : '';
  if (Array.isArray(node)) {
    for (const it of node) {
      const t = _extractText(it, depth + 1);
      if (t) return t;
    }
    return '';
  }
  if (typeof node === 'object') {
    // Try the well-known assistant-text keys first, in priority order.
    for (const k of ['text','output_text','generated_text','answer','completion','content','message','response','output']) {
      if (typeof node[k] === 'string' && node[k].trim().length >= 10) return node[k];
    }
    // Then recurse into every value, preferring keys that often wrap the text.
    const keys = Object.keys(node).sort((a, b) =>
      (_TEXT_FIELDS.has(b) ? 1 : 0) - (_TEXT_FIELDS.has(a) ? 1 : 0)
    );
    for (const k of keys) {
      const v = node[k];
      if (v && typeof v === 'object') {
        const t = _extractText(v, depth + 1);
        if (t) return t;
      } else if (typeof v === 'string' && _TEXT_FIELDS.has(k) && v.trim().length >= 10) {
        return v;
      }
    }
  }
  return '';
}

// Ask one LLM (via DataForSEO) a single prompt and return { text, error, cost }.
async function _askLlm(provider, prompt) {
  const endpoint = _PROVIDER_ENDPOINTS[provider];
  if (!endpoint) return { text: '', error: 'unknown-provider' };
  const model = _PROVIDER_MODELS[provider];
  try {
    const resp = await _callDfs(endpoint, [{
      user_prompt: prompt,
      model_name: model,
      max_output_tokens: 700,
      temperature: 0.3,
      web_search: provider === 'perplexity' ? true : false,
    }]);
    if (resp.status_code && resp.status_code >= 40000) {
      return { text: '', error: `${resp.status_code} ${resp.status_message || ''}`.trim(), cost: 0 };
    }
    const task = (resp.tasks || [])[0];
    if (!task) return { text: '', error: 'no-task', cost: 0 };
    if (task.status_code && task.status_code >= 40000) {
      return { text: '', error: `${task.status_code} ${task.status_message || ''}`.trim(), cost: 0 };
    }
    const cost = Number(task.cost) || 0;
    const result = (task.result || [])[0];
    if (!result) return { text: '', error: 'no-result', cost };
    const text = _extractText(result, 0);
    if (!text) {
      // Surface a top-level shape summary (keys only — no values) so a future
      // unseen DataForSEO payload shape can be diagnosed without leaking data.
      const shape = Object.keys(result).join(',').slice(0, 120);
      console.warn('[ai-visibility] unparsed-response-shape provider=' + provider + ' keys=' + shape);
      return { text: '', error: 'unparsed-response-shape:' + shape, cost };
    }
    return { text, error: '', cost };
  } catch (e) {
    return { text: '', error: e.message, cost: 0 };
  }
}

// Count how many distinct mentions of `name` appear in `text` — whole-word,
// case-insensitive. Escape regex metacharacters in the brand name.
function _countMentions(text, name) {
  if (!text || !name) return 0;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\b' + esc + '\\b', 'gi');
  const m = text.match(re);
  return m ? m.length : 0;
}

function _detectFirstPosition(text, name) {
  if (!text || !name) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.search(new RegExp('\\b' + esc + '\\b', 'i'));
  return m >= 0 ? m : null;
}

// ── POST /api/ai-visibility/run ─────────────────────────────────────────────
// body: { brand, competitors:[], prompts:[], providers:['chatgpt','perplexity',...] }
router.post('/run', _safe(async (req, res) => {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const brand = String(body.brand || '').trim().slice(0, 80);
  if (!brand) return _err(res, 400, 'brand required');
  const competitors = (Array.isArray(body.competitors) ? body.competitors : [])
    .map(c => String(c || '').trim().slice(0, 80)).filter(Boolean).slice(0, 10);
  const prompts = (Array.isArray(body.prompts) ? body.prompts : [])
    .map(p => String(p || '').trim()).filter(Boolean).slice(0, 6);
  if (prompts.length === 0) return _err(res, 400, 'at least one prompt required');
  let providers = (Array.isArray(body.providers) ? body.providers : ['chatgpt','perplexity'])
    .map(p => String(p || '').toLowerCase()).filter(p => _PROVIDER_ENDPOINTS[p]);
  if (providers.length === 0) providers = ['chatgpt','perplexity'];
  providers = Array.from(new Set(providers)).slice(0, 4);

  if (!_auth()) return _err(res, 503, 'DataForSEO credentials not configured');

  const allBrands = [brand, ...competitors];
  // results structure: { [provider]: { [prompt]: { text, error, mentions:{ brand: count } } } }
  const results = {};
  let totalCost = 0;

  // Run all (provider × prompt) pairs in parallel for speed.
  const jobs = [];
  for (const provider of providers) {
    results[provider] = {};
    for (const prompt of prompts) {
      jobs.push((async () => {
        const r = await _askLlm(provider, prompt);
        const mentions = {};
        const positions = {};
        for (const b of allBrands) {
          mentions[b] = _countMentions(r.text, b);
          const pos = _detectFirstPosition(r.text, b);
          positions[b] = pos;
        }
        results[provider][prompt] = {
          text: r.text,
          error: r.error || null,
          mentions,
          positions,
        };
        totalCost += r.cost || 0;
      })());
    }
  }
  await Promise.all(jobs);

  // Build a summary: total mentions per brand across all (provider × prompt),
  // SoV %, and how many runs each brand was the "first cited" (smallest position).
  const totalsByBrand = {};
  const firstCiteByBrand = {};
  let answeredRuns = 0;
  for (const provider of providers) {
    for (const prompt of prompts) {
      const cell = results[provider][prompt];
      if (!cell.text) continue;
      answeredRuns++;
      let best = null;
      for (const b of allBrands) {
        totalsByBrand[b] = (totalsByBrand[b] || 0) + (cell.mentions[b] || 0);
        const p = cell.positions[b];
        if (p != null && (best === null || p < best.pos)) best = { brand: b, pos: p };
      }
      if (best) firstCiteByBrand[best.brand] = (firstCiteByBrand[best.brand] || 0) + 1;
    }
  }
  const grand = Object.values(totalsByBrand).reduce((s, n) => s + n, 0);
  const sov = allBrands.map(b => ({
    brand: b,
    mentions: totalsByBrand[b] || 0,
    share: grand ? ((totalsByBrand[b] || 0) / grand) : 0,
    firstCites: firstCiteByBrand[b] || 0,
    presentIn: providers.reduce((s, p) => s + prompts.reduce(
      (n, q) => n + ((results[p][q].mentions[b] || 0) > 0 ? 1 : 0), 0), 0),
  })).sort((a, b) => b.mentions - a.mentions);

  const summary = {
    answeredRuns,
    totalRuns: providers.length * prompts.length,
    sov,
    youMentions: totalsByBrand[brand] || 0,
    youShare: grand ? ((totalsByBrand[brand] || 0) / grand) : 0,
    topProvider: (() => {
      const tally = {};
      for (const p of providers) {
        tally[p] = prompts.reduce((s, q) => s + (results[p][q].mentions[brand] || 0), 0);
      }
      const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      return sorted[0] ? { provider: sorted[0][0], mentions: sorted[0][1] } : null;
    })(),
  };

  const id = 'aiv_' + crypto.randomBytes(6).toString('hex');
  if (_db.hasDb()) {
    try {
      const tid = await _tid(req, 'ai-vis:run');
      await _db.getPool().query(
        `INSERT INTO ai_visibility_runs (tenant_id, id, brand, competitors, prompts, providers, results, summary, cost_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tid, id, brand, JSON.stringify(competitors), JSON.stringify(prompts),
         JSON.stringify(providers), JSON.stringify(results), JSON.stringify(summary), totalCost.toFixed(4)]
      );
    } catch (e) { console.warn('[ai-visibility] insert failed', e.message); }
  }
  res.json({ ok: true, id, brand, competitors, prompts, providers, results, summary, cost_usd: Number(totalCost.toFixed(4)) });
}));

// ── GET /api/ai-visibility/runs ─────────────────────────────────────────────
router.get('/runs', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tid(req, 'ai-vis:runs-list');
  const r = await _db.getPool().query(
    `SELECT id, brand, competitors, prompts, providers, summary, cost_usd, created_at
     FROM ai_visibility_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`, [tid]
  );
  res.json({ ok: true, runs: r.rows });
}));

// ── GET /api/ai-visibility/runs/:id ─────────────────────────────────────────
router.get('/runs/:id', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tid(req, 'ai-vis:runs-get');
  const r = await _db.getPool().query(`SELECT * FROM ai_visibility_runs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!r.rowCount) return _err(res, 404, 'Run not found');
  res.json({ ok: true, run: r.rows[0] });
}));

// ── POST /api/ai-visibility/probe ───────────────────────────────────────────
// Lightweight single-prompt single-provider probe used by GEO Audit.
// body: { brand, competitors:[], prompt, provider }
router.post('/probe', _safe(async (req, res) => {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const brand = String(body.brand || '').trim().slice(0, 80);
  const prompt = String(body.prompt || '').trim().slice(0, 600);
  const provider = String(body.provider || 'chatgpt').toLowerCase();
  if (!brand || !prompt) return _err(res, 400, 'brand + prompt required');
  if (!_PROVIDER_ENDPOINTS[provider]) return _err(res, 400, 'unknown provider');
  if (!_auth()) return _err(res, 503, 'DataForSEO credentials not configured');
  const competitors = (Array.isArray(body.competitors) ? body.competitors : [])
    .map(c => String(c || '').trim().slice(0, 80)).filter(Boolean).slice(0, 10);
  const r = await _askLlm(provider, prompt);
  const mentions = {};
  for (const b of [brand, ...competitors]) mentions[b] = _countMentions(r.text, b);
  res.json({ ok: true, provider, prompt, text: r.text, error: r.error || null, mentions, cost_usd: r.cost || 0 });
}));

// ── GET /api/ai-visibility/leaderboard ──────────────────────────────────────
// Returns the latest run's SOV ranking plus Δ vs the previous run for the
// same brand, so the frontend can render a rank table with trend arrows.
router.get('/leaderboard', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, leaderboard: [], run: null, prevRun: null });
  const pool = _db.getPool();
  const tid = await _tid(req, 'ai-vis:leaderboard');

  // Latest run (optionally filter by brand query param) — tenant-scoped.
  const brand = String(req.query.brand || '').trim();
  const latest = brand
    ? await pool.query(`SELECT * FROM ai_visibility_runs WHERE brand=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 1`, [brand, tid])
    : await pool.query(`SELECT * FROM ai_visibility_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [tid]);

  if (!latest.rowCount) return res.json({ ok: true, leaderboard: [], run: null, prevRun: null });
  const run = latest.rows[0];
  const summary = typeof run.summary === 'string' ? JSON.parse(run.summary) : run.summary;
  const sov = Array.isArray(summary.sov) ? summary.sov : [];

  // Previous run for same brand (to compute deltas) — tenant-scoped.
  const prev = await pool.query(
    `SELECT summary FROM ai_visibility_runs WHERE brand=$1 AND tenant_id=$2 AND created_at < $3 ORDER BY created_at DESC LIMIT 1`,
    [run.brand, tid, run.created_at]
  );
  let prevSov = [];
  let prevRun = null;
  if (prev.rowCount) {
    const ps = typeof prev.rows[0].summary === 'string' ? JSON.parse(prev.rows[0].summary) : prev.rows[0].summary;
    prevSov = Array.isArray(ps.sov) ? ps.sov : [];
    prevRun = prev.rows[0];
  }

  // Build leaderboard rows with rank + delta
  const leaderboard = sov.map((entry, i) => {
    const prevEntry = prevSov.find(p => p.brand === entry.brand);
    const prevShare = prevEntry ? prevEntry.share : null;
    const deltaShare = prevShare !== null ? Math.round((entry.share - prevShare) * 1000) / 10 : null; // Δ in pp
    const prevRank = prevEntry ? prevSov.findIndex(p => p.brand === entry.brand) : null;
    const rankDelta = prevRank !== null ? (prevRank - i) : null; // positive = climbed
    return {
      rank: i + 1,
      brand: entry.brand,
      mentions: entry.mentions,
      share: Math.round(entry.share * 1000) / 10, // as %
      firstCites: entry.firstCites || 0,
      presentIn: entry.presentIn || 0,
      deltaShare,
      rankDelta,
      isYou: entry.brand === run.brand,
    };
  });

  res.json({
    ok: true,
    brand: run.brand,
    run: { id: run.id, created_at: run.created_at, providers: run.providers, prompts: run.prompts },
    prevRun: prevRun ? { created_at: prevRun.created_at } : null,
    leaderboard,
    summary: { answeredRuns: summary.answeredRuns, totalRuns: summary.totalRuns, youShare: Math.round((summary.youShare || 0) * 1000) / 10, youMentions: summary.youMentions || 0 },
  });
}));

module.exports = router;
module.exports.askLlm = _askLlm;
module.exports.countMentions = _countMentions;
