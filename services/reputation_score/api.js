const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[reputation-score]', e.message); if (!res.headersSent) _err(res, 500, 'Internal error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _callOpenAI(messages, opts = {}) {
  const https = require('https');
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const body = JSON.stringify({ model: opts.model || 'gpt-5-mini', temperature: 0.2, max_tokens: opts.max_tokens || 900, response_format: { type: 'json_object' }, messages });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); } catch { resolve({}); } });
    });
    req.on('error', reject); req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); }); req.write(body); req.end();
  });
}

async function _callPerplexity(query) {
  const https = require('https');
  const key = process.env.PERPLEXITY_API_KEY;
  const body = JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: query }], max_tokens: 1200 });
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)?.choices?.[0]?.message?.content || ''); } catch { resolve(''); } });
    });
    req.on('error', () => resolve('')); req.setTimeout(30000, () => { req.destroy(); resolve(''); }); req.write(body); req.end();
  });
}

function _grade(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// POST /api/reputation-score/calculate
router.post('/calculate', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'reputation_score:calculate' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { brand } = req.body;
  if (!brand) return _err(res, 400, 'brand required');

  // Gather existing data signals
  let sentimentAvg = 50, volScore = 50, sovScore = 50, crisisScore = 80, reachScore = 50;
  const pool = _db.hasDb() ? _db.getPool() : null;

  if (pool) {
    try {
      const crisisR = await pool.query(`SELECT pos_pct, neg_pct, total_count FROM crisis_snapshots WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]);
      if (crisisR.rows.length) {
        const avgPos = crisisR.rows.reduce((a, r) => a + parseFloat(r.pos_pct || 0), 0) / crisisR.rows.length;
        const avgNeg = crisisR.rows.reduce((a, r) => a + parseFloat(r.neg_pct || 0), 0) / crisisR.rows.length;
        sentimentAvg = Math.round(50 + (avgPos - avgNeg) * 0.5);
        const volumes = crisisR.rows.map(r => parseInt(r.total_count || 0));
        if (volumes.length >= 2) {
          const recent = volumes.slice(0, 3).reduce((a, v) => a + v, 0) / Math.min(3, volumes.length);
          const older = volumes.slice(-3).reduce((a, v) => a + v, 0) / Math.min(3, volumes.length);
          volScore = older > 0 ? Math.min(100, Math.round(50 + (recent - older) / older * 30)) : 50;
        }
        const incidentR = await pool.query(`SELECT COUNT(*) as cnt FROM crisis_incidents WHERE tenant_id=$1 AND created_at > now() - interval '30 days'`, [tid]);
        const incidents = parseInt(incidentR.rows[0]?.cnt || 0);
        crisisScore = Math.max(20, 100 - incidents * 15);
      }
    } catch (e) { console.warn('[reputation-score] crisis query:', e.message); }
    try {
      const sovR = await pool.query(`SELECT our_share FROM sov_snapshots WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5`, [tid]);
      if (sovR.rows.length) {
        const avgShare = sovR.rows.reduce((a, r) => a + parseFloat(r.our_share || 0), 0) / sovR.rows.length;
        sovScore = Math.min(100, Math.round(avgShare * 2));
      }
    } catch (e) { console.warn('[reputation-score] sov query:', e.message); }
  }

  // Live AI enrichment
  let aiSummary = '', aiRecs = [];
  if (_hasPerplexity()) {
    const raw = await _callPerplexity(`What is the current online reputation and public perception of "${brand}"? Summarize recent sentiment trends, any controversies or positive press, and their social media standing. Keep it factual and concise (150 words).`);
    if (raw) aiSummary = raw.slice(0, 600);
  }

  if (_hasOpenAI() && aiSummary) {
    const parsed = await _callOpenAI([
      { role: 'system', content: 'You analyse brand reputation. Return strict JSON: {"reputation_adjustment":number(-20 to +20),"trend":"up"|"down"|"stable","recommendations":["string","string","string"]}' },
      { role: 'user', content: `Brand: ${brand}\nContext: ${aiSummary}\nCurrent component scores — sentiment:${sentimentAvg}, volume:${volScore}, sov:${sovScore}, crisis:${crisisScore}` }
    ]);
    if (parsed.reputation_adjustment) {
      sentimentAvg = Math.max(0, Math.min(100, sentimentAvg + (parsed.reputation_adjustment || 0)));
    }
    if (parsed.recommendations) aiRecs = parsed.recommendations.slice(0, 3);
    reachScore = Math.min(100, Math.max(20, sentimentAvg + (parsed.reputation_adjustment || 0) / 2));
  }

  const overall = Math.round((sentimentAvg * 0.35 + volScore * 0.15 + sovScore * 0.20 + crisisScore * 0.20 + reachScore * 0.10));
  const grade = _grade(overall);
  const trend = overall > 65 ? 'up' : overall < 40 ? 'down' : 'stable';

  if (pool) {
    await pool.query(`INSERT INTO reputation_scores(brand,overall_score,grade,sentiment_score,volume_score,sov_score,crisis_score,reach_score,trend,summary,recommendations,components,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [brand, overall, grade, sentimentAvg, volScore, sovScore, crisisScore, reachScore, trend, aiSummary, JSON.stringify(aiRecs),
       JSON.stringify({ sentiment: sentimentAvg, volume: volScore, sov: sovScore, crisis: crisisScore, reach: reachScore }), tid]);
  }
  res.json({ ok: true, brand, overall_score: overall, grade, trend, sentiment_score: sentimentAvg, volume_score: volScore, sov_score: sovScore, crisis_score: crisisScore, reach_score: reachScore, summary: aiSummary, recommendations: aiRecs });
}));

// GET /api/reputation-score/history
router.get('/history', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'reputation_score:history' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, rows: [] });
  const { rows } = await _db.getPool().query(`SELECT id,brand,overall_score,grade,trend,sentiment_score,volume_score,sov_score,crisis_score,reach_score,summary,recommendations,created_at FROM reputation_scores WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]);
  res.json({ ok: true, rows });
}));

module.exports = router;
