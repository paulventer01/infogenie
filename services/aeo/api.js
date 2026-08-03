// AEO API — Answer Engine Optimization across four pillars.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { buildAeoReport, PILLARS } = require('./analyzer');
const { chatForCategory } = require('../ai/chat_router');

// Reuse GEO audit HTML fetch + checks (same engine, AEO pillar grouping).
let _runGeoAudit;
try {
  const geoRouter = require('../geo_audit/api');
  _runGeoAudit = geoRouter.runGeoAudit;
} catch {
  _runGeoAudit = null;
}

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[aeo]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'aeo_error' });
    }
  };
}

router.get('/principles', (_req, res) => {
  res.json({
    ok: true,
    principles: PILLARS.map(({ id, label, description }) => ({ id, label, description })),
  });
});

router.post('/run', express.json(), _route(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return _err(res, 400, 'url required');
  if (!/^https?:\/\//i.test(url)) return _err(res, 400, 'url must start with http:// or https://');
  if (!_runGeoAudit) return _err(res, 503, 'audit engine unavailable');

  const geo = await _runGeoAudit(url, { headless: !!req.body?.headless });
  if (!geo.ok) return _err(res, 400, geo.error);

  const report = buildAeoReport(geo);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'aeo:run' });
  const id = 'aeo_' + crypto.randomBytes(6).toString('hex');

  if (_db.hasDb() && tid != null) {
    await _db.getPool().query(`
      INSERT INTO aeo_runs (id, tenant_id, url, score, grade, pillars, checks, fixes, summary)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      id, tid, report.url, report.score, report.grade,
      JSON.stringify(report.pillars),
      JSON.stringify(geo.checks),
      JSON.stringify(report.fixes),
      JSON.stringify(report.summary),
    ]);
  }

  res.json({ ok: true, id, ...report, checks: geo.checks });
}));

router.get('/runs', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'aeo:runs' });
  const r = await _db.getPool().query(`
    SELECT id, url, score, grade, pillars, summary, created_at
    FROM aeo_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30
  `, [tid]);
  res.json({ ok: true, runs: r.rows });
}));

router.get('/runs/:id', _route(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'aeo:run-get' });
  const r = await _db.getPool().query(`SELECT * FROM aeo_runs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!r.rows.length) return _err(res, 404, 'not found');
  res.json({ ok: true, run: r.rows[0] });
}));

router.post('/runs/:id/generate-faq', express.json(), _route(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'aeo:faq' });
  const r = await _db.getPool().query(`SELECT * FROM aeo_runs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!r.rows.length) return _err(res, 404, 'run not found');

  const run = r.rows[0];
  const topic = req.body?.topic || run.url;
  const failedChecks = (run.checks || []).filter((c) => c.id === 'q_headings' || c.id === 'schema' || c.status !== 'pass');

  const prompt = `You are an Answer Engine Optimization (AEO) specialist. For the page "${run.url}" (topic: ${topic}), generate content that helps AI answer engines cite this page.

Return ONLY valid JSON:
{
  "faqs": [
    { "question": string, "answer": string (40-80 words, direct and factual) }
  ],
  "faqPageSchema": { "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [...] },
  "suggestedH2Questions": [string],
  "leadParagraph": string (15-60 words direct answer)
}

Generate 5 FAQs. Answers must be concise snippet-ready paragraphs.`;

  const ai = await chatForCategory('analysis', [
    { role: 'system', content: 'Return only valid JSON for AEO FAQ generation.' },
    { role: 'user', content: prompt },
  ], { tenantId: tid, max_tokens: 1200, response_format: { type: 'json_object' } });

  let faq = null;
  if (ai?.content) {
    try { faq = JSON.parse(ai.content); } catch { faq = { raw: ai.content }; }
  }

  if (faq) {
    await _db.getPool().query(`UPDATE aeo_runs SET faq_suggestions=$2 WHERE id=$1`, [run.id, JSON.stringify(faq)]);
  }

  res.json({ ok: !!faq, faq, model: ai?.model || null });
}));

module.exports = router;
