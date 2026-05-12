// HTTP routes for Search & AI Visibility Intelligence.
const express = require('express');
const _db = require('../../db');
const _ai = require('./ai_visibility');
const _pulse = require('./search_pulse');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: String(msg||'error') }); }
function _id(v) { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; }

// ─── AI Visibility (tracked queries → multi-LLM citation tracking) ─────────
router.get('/queries', async (_req, res) => {
  try { res.json({ ok:true, queries: await _ai.listQueries() }); }
  catch (e) { _err(res, 500, e.message); }
});
router.post('/queries', async (req, res) => {
  try { res.json({ ok:true, query: await _ai.createQuery(req.body || {}) }); }
  catch (e) { _err(res, 400, e.message); }
});
router.delete('/queries/:id', async (req, res) => {
  const id = _id(req.params.id); if (!id) return _err(res, 400, 'invalid id');
  try { await _ai.deleteQuery(id); res.json({ ok:true }); }
  catch (e) { _err(res, 500, e.message); }
});
router.post('/queries/:id/run', async (req, res) => {
  const id = _id(req.params.id); if (!id) return _err(res, 400, 'invalid id');
  try {
    const r = await _db.getPool().query(`SELECT * FROM search_intel_queries WHERE id=$1`, [id]);
    if (!r.rows[0]) return _err(res, 404, 'query not found');
    res.json({ ok:true, summary: await _ai.runQueryAcrossProviders(r.rows[0]) });
  } catch (e) { _err(res, 500, e.message); }
});
router.get('/queries/:id/history', async (req, res) => {
  const id = _id(req.params.id); if (!id) return _err(res, 400, 'invalid id');
  try { res.json({ ok:true, runs: await _ai.getRunHistory(id, req.query.limit) }); }
  catch (e) { _err(res, 500, e.message); }
});
router.post('/run-all', async (_req, res) => {
  try { res.json(await _ai.runAllEnabled()); }
  catch (e) { _err(res, 500, e.message); }
});
// AI-generated prompt suggestions for the "✨ Suggest" button.
router.post('/suggest-prompts', async (req, res) => {
  try {
    const brand = String(req.body?.brand || '').trim();
    const locale = String(req.body?.locale || 'en-US').trim();
    const competitors = Array.isArray(req.body?.competitors)
      ? req.body.competitors.filter(c => typeof c === 'string').map(c => c.trim()).filter(Boolean)
      : [];
    res.json(await _ai.suggestPrompts({ brand, competitors, locale }));
  } catch (e) { _err(res, 500, e.message); }
});

// ─── Search Pulse (DataForSEO keyword expansion) ───────────────────────────
router.post('/pulse', async (req, res) => {
  const seed = String(req.body?.seed || '').trim();
  const locale = String(req.body?.locale || 'en-US');
  if (!seed) return _err(res, 400, 'seed required');
  try { res.json(await _pulse.runPulse(seed, locale)); }
  catch (e) { _err(res, 502, e.message); }
});
router.get('/pulse/history', async (req, res) => {
  const seed = String(req.query?.seed || '').trim();
  if (!seed) return _err(res, 400, 'seed required');
  try { res.json({ ok:true, history: await _pulse.getPulseHistory(seed, req.query.limit) }); }
  catch (e) { _err(res, 500, e.message); }
});

// ─── Image / logo recognition ──────────────────────────────────────────────
router.post('/image', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return _err(res, 400, 'url required');
  try { res.json(await _pulse.analyzeImage(url, !!req.body?.force)); }
  catch (e) { _err(res, 502, e.message); }
});

module.exports = router;
