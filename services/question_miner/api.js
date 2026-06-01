// AnswerThePublic-style — what questions are people actually asking about a
// topic? Uses DataForSEO SERP API ("people_also_ask" + "related_searches" +
// "related_questions" items) plus a small client-side wh-prefix grouping.

const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const _kvScope = require('../tenants/kv_scope');

// Mined-question records are per-workspace: `question_mine:t<tid>:<id>`.
// Legacy un-namespaced `question_mine:<id>` keys migrate to the default tenant.
const _QM_PREFIX = 'question_mine:';
_kvScope.migrateLegacyPrefix(_QM_PREFIX).catch(() => {});

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[question-miner]', e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }

function _hasDFS() { return process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD; }

function _dfsPost(path, payload) {
  const auth = 'Basic ' + Buffer.from(process.env.DATAFORSEO_LOGIN + ':' + process.env.DATAFORSEO_PASSWORD).toString('base64');
  const body = JSON.stringify(payload);
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.dataforseo.com', path, method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
      try { resolve(JSON.parse(d)); } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => req.destroy());
    req.write(body); req.end();
  });
}

const WH = ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'is', 'are', 'can', 'does', 'do', 'should'];
function _bucket(q) {
  const lower = String(q || '').toLowerCase().trim();
  for (const w of WH) { if (lower.startsWith(w + ' ')) return w; }
  return 'other';
}

function _fallback(seed) {
  const f = (w) => ({ question: `${w} ${seed}?`, source: 'placeholder' });
  return [
    f('what is'), f('why does'), f('how to use'),
    f('when should I use'), f('where to buy'),
    f('is it worth'), f('can I'),
  ];
}

router.post('/mine', _safe(async (req, res) => {
  const seed = String(req.body?.seed || '').trim().slice(0, 100);
  if (!seed) return _err(res, 400, 'seed keyword required');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'question_miner:mine' });
  const locCode = parseInt(req.body?.location_code, 10) || 2840; // US

  let questions = [];
  let source = 'placeholder';

  if (_hasDFS()) {
    const r = await _dfsPost('/v3/serp/google/organic/live/advanced',
      [{ keyword: seed, language_code: 'en', location_code: locCode, depth: 50 }]);
    const items = r?.tasks?.[0]?.result?.[0]?.items || [];
    const out = [];
    for (const it of items) {
      if (it.type === 'people_also_ask' && Array.isArray(it.items)) {
        for (const q of it.items) if (q.title) out.push({ question: q.title, source: 'paa' });
      } else if (it.type === 'related_searches' && Array.isArray(it.items)) {
        for (const q of it.items) if (q.title) out.push({ question: q.title, source: 'related' });
      }
    }
    // dedupe
    const seen = new Set();
    questions = out.filter(x => { const k = x.question.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    source = 'dataforseo';
  }
  if (!questions.length) { questions = _fallback(seed); source = 'placeholder'; }

  const grouped = {};
  for (const q of questions) {
    const b = _bucket(q.question);
    (grouped[b] = grouped[b] || []).push(q);
  }

  // Persist for content-calendar handoff
  const id = 'qmine_' + (require('crypto').randomUUID ? require('crypto').randomUUID().replace(/-/g,'').slice(0,16) : Date.now() + '_' + Math.random().toString(36).slice(2,8));
  if (_db.hasDb() && tid != null) {
    try { await _db.kvSet(`${_QM_PREFIX}t${tid}:${id}`, { seed, source, questions, createdAt: new Date().toISOString() }); } catch {}
  }
  res.json({ ok: true, id, seed, source, total: questions.length, grouped, questions });
}));

router.get('/list', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'question_miner:list' });
  if (tid == null) return res.json({ ok: true, items: [] });
  const rows = await _kvScope.listTenantPrefix(_QM_PREFIX, tid, 20);
  res.json({ ok: true, items: rows.map(row => ({ id: row.id, ...row.value })) });
}));

router.post('/to-calendar', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'db unavailable');
  const question = String(req.body?.question || '').trim().slice(0, 280);
  if (!question) return _err(res, 400, 'question required');
  const channel = String(req.body?.channel || 'blog').slice(0, 40);
  const when = req.body?.scheduled_for || new Date(Date.now() + 7 * 86400000).toISOString();
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'question_miner:to-calendar' });
    await _db.getPool().query(
      `INSERT INTO content_calendar_items (tenant_id, title, channel, scheduled_for, status, body)
       VALUES ($1,$2,$3,$4,'draft',$5)`,
      [tid, question, channel, when, `Article topic: ${question}\n\nSourced from Question Mining tool.`]
    );
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
}));

module.exports = router;
