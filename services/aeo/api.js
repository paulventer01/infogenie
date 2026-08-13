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

async function _buildFaqPack({ url, topic, tid }) {
  const pageUrl = String(url || topic || 'https://example.com').trim();
  const prompt = `You are an Answer Engine Optimization (AEO) specialist. For the page "${pageUrl}" (topic: ${topic || pageUrl}), generate content that helps AI answer engines cite this page.

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

  let ai = null;
  try {
    ai = await chatForCategory('analysis', [
      { role: 'system', content: 'Return only valid JSON for AEO FAQ generation.' },
      { role: 'user', content: prompt },
    ], { tenantId: tid, max_tokens: 1200, response_format: { type: 'json_object' } });
  } catch (e) {
    console.warn('[aeo] FAQ AI failed — using offline pack:', e.message || e);
  }

  let faq = null;
  if (ai?.content) {
    try { faq = JSON.parse(ai.content); } catch { faq = null; }
  }
  if (!faq || !Array.isArray(faq.faqs)) {
    // Offline fallback so the button always produces usable output.
    const brand = pageUrl.replace(/^https?:\/\//, '').split('/')[0] || 'this site';
    faq = {
      leadParagraph: `${brand} answers the core question clearly in the first paragraph so AI engines can quote it.`,
      suggestedH2Questions: [
        `What is ${brand}?`,
        `How does ${brand} work?`,
        `Who is ${brand} for?`,
        `How much does ${brand} cost?`,
        `Why choose ${brand}?`,
      ],
      faqs: [
        { question: `What is ${brand}?`, answer: `${brand} helps teams solve a specific customer problem with a clear workflow, measurable outcomes, and documentation that answer engines can cite.` },
        { question: `How does ${brand} work?`, answer: `Users start with a short setup, connect their data sources, then follow guided steps that produce ready-to-publish recommendations and reports.` },
        { question: `Who is ${brand} for?`, answer: `Marketing, SEO, and growth teams that need faster competitive insight and content that ranks in both classic SERPs and AI answer engines.` },
        { question: `How much does ${brand} cost?`, answer: `Pricing depends on workspace size and feature access. Most teams start with a trial, then choose a plan based on seats and monthly analysis volume.` },
        { question: `Why choose ${brand}?`, answer: `It combines research, planning, and execution in one workflow so teams spend less time stitching tools and more time shipping campaigns.` },
      ],
      faqPageSchema: {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          { '@type': 'Question', name: `What is ${brand}?`, acceptedAnswer: { '@type': 'Answer', text: `${brand} helps teams solve a specific customer problem with clear workflows and citable answers.` } },
          { '@type': 'Question', name: `How does ${brand} work?`, acceptedAnswer: { '@type': 'Answer', text: `Connect sources, run guided analysis, and export recommendations ready for publishing.` } },
        ],
      },
      _offline: true,
    };
  }
  return { faq, model: ai?.model || (faq._offline ? 'offline' : null) };
}

router.post('/runs/:id/generate-faq', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'aeo:faq' }).catch(() => null);
  let url = String(req.body?.url || '').trim();
  let topic = req.body?.topic || url;

  if (_db.hasDb() && tid != null) {
    const r = await _db.getPool().query(`SELECT * FROM aeo_runs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (r.rows.length) {
      url = r.rows[0].url || url;
      topic = req.body?.topic || url;
      const built = await _buildFaqPack({ url, topic, tid });
      if (built.faq) {
        await _db.getPool().query(`UPDATE aeo_runs SET faq_suggestions=$2 WHERE id=$1`, [r.rows[0].id, JSON.stringify(built.faq)]);
      }
      return res.json({ ok: !!built.faq, faq: built.faq, model: built.model });
    }
  }

  // Run id missing from DB — still generate from URL if provided.
  if (!url) return _err(res, 404, 'run not found — re-run audit or pass url');
  const built = await _buildFaqPack({ url, topic, tid });
  res.json({ ok: !!built.faq, faq: built.faq, model: built.model });
}));

// Direct FAQ generation (no DB run required)
router.post('/generate-faq', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'aeo:faq-direct' }).catch(() => null);
  const url = String(req.body?.url || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const built = await _buildFaqPack({ url, topic: req.body?.topic || url, tid });
  res.json({ ok: !!built.faq, faq: built.faq, model: built.model });
}));

module.exports = router;
