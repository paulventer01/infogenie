const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, c, m) { res.status(c).json({ ok: false, error: m }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[anomaly-detector]', e.message); if (!res.headersSent) _err(res, 500, 'Internal error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _callOpenAI(messages) {
  const https = require('https'); const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const body = JSON.stringify({ model: 'gpt-5-mini', temperature: 0.15, max_tokens: 1000, response_format: { type: 'json_object' }, messages });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); } catch { resolve({}); } });
    });
    req.on('error', reject); req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); }); req.write(body); req.end();
  });
}

async function _callPerplexity(q) {
  const https = require('https'); const key = process.env.PERPLEXITY_API_KEY;
  const body = JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: q }], max_tokens: 800 });
  return new Promise(resolve => {
    const req = https.request({ hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)?.choices?.[0]?.message?.content || ''); } catch { resolve(''); } });
    });
    req.on('error', () => resolve('')); req.setTimeout(25000, () => { req.destroy(); resolve(''); }); req.write(body); req.end();
  });
}

// POST /api/anomaly-detector/scan
router.post('/scan', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'anomaly_detector:scan' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { brand } = req.body;
  if (!brand) return _err(res, 400, 'brand required');
  const pool = _db.hasDb() ? _db.getPool() : null;

  // Pull historical baseline from crisis snapshots
  let baseline = 50, current = 50, baselineSentiment = 50, currentSentiment = 50;
  let signals = [];
  if (pool) {
    try {
      const snapR = await pool.query(`SELECT total_count, pos_pct, neg_pct, created_at FROM crisis_snapshots WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 14`, [tid]);
      if (snapR.rows.length >= 4) {
        const counts = snapR.rows.map(r => parseInt(r.total_count || 0));
        const older = counts.slice(4).reduce((a, v) => a + v, 0) / Math.max(1, counts.slice(4).length);
        const recent = counts.slice(0, 4).reduce((a, v) => a + v, 0) / 4;
        baseline = older; current = recent;
        const sentiments = snapR.rows.map(r => parseFloat(r.pos_pct || 50) - parseFloat(r.neg_pct || 0));
        baselineSentiment = sentiments.slice(4).reduce((a, v) => a + v, 0) / Math.max(1, sentiments.slice(4).length);
        currentSentiment = sentiments.slice(0, 4).reduce((a, v) => a + v, 0) / 4;
      }
    } catch (e) { console.warn('[anomaly-detector] snapshot query:', e.message); }
  }

  const spikeFactor = baseline > 0 ? current / baseline : 1;
  const sentimentDrift = currentSentiment - baselineSentiment;
  let anomalyType = 'no_anomaly', severity = 'none';

  if (spikeFactor >= 3) { anomalyType = 'major_mention_spike'; severity = 'critical'; }
  else if (spikeFactor >= 1.8) { anomalyType = 'mention_spike'; severity = 'high'; }
  else if (spikeFactor >= 1.4) { anomalyType = 'moderate_spike'; severity = 'medium'; }
  else if (sentimentDrift <= -25) { anomalyType = 'sentiment_crash'; severity = 'high'; }
  else if (sentimentDrift <= -15) { anomalyType = 'sentiment_drop'; severity = 'medium'; }
  else if (spikeFactor <= 0.4) { anomalyType = 'mention_drop'; severity = 'medium'; }

  // Live context from Perplexity
  let newsContext = '';
  if (_hasPerplexity() && severity !== 'none') {
    newsContext = await _callPerplexity(`What is causing unusual social media or news activity around "${brand}" recently? Any viral posts, controversies, product launches, or press coverage in the past 48 hours?`);
  }

  // AI explanation
  let aiExplanation = '', recommendedAction = '';
  if (_hasOpenAI()) {
    const parsed = await _callOpenAI([
      { role: 'system', content: 'You are a brand monitoring expert. Explain anomalies and give actionable advice. Return strict JSON: {"explanation":"...","recommended_action":"...","affected_channels":["twitter","news","reddit"],"confidence":"high"|"medium"|"low"}' },
      { role: 'user', content: `Brand: ${brand}\nAnomaly: ${anomalyType} (severity: ${severity})\nSpike factor: ${spikeFactor.toFixed(2)}x\nSentiment drift: ${sentimentDrift.toFixed(1)} points\nNews context: ${newsContext.slice(0, 500) || 'No live data available'}` }
    ]);
    aiExplanation = parsed.explanation || '';
    recommendedAction = parsed.recommended_action || '';
    if (parsed.affected_channels) signals = parsed.affected_channels.map(ch => ({ channel: ch, flagged: true }));
  }

  if (!aiExplanation) {
    aiExplanation = severity === 'none' ? `No significant anomalies detected for ${brand}. Mention volume and sentiment are within normal range.` : `Detected ${anomalyType.replace(/_/g, ' ')} for ${brand} — ${spikeFactor.toFixed(1)}× the baseline volume.`;
    recommendedAction = severity === 'critical' ? 'Activate crisis response protocol immediately. Review top mentions and prepare a statement.' : severity === 'high' ? 'Monitor closely. Identify the source and prepare a response if sentiment is negative.' : 'Keep watching. No immediate action required.';
  }

  if (pool && severity !== 'none') {
    await pool.query(`INSERT INTO anomaly_detections(brand,anomaly_type,severity,spike_factor,baseline_value,current_value,ai_explanation,recommended_action,affected_channels,signals,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [brand, anomalyType, severity, spikeFactor, baseline, current, aiExplanation, recommendedAction, JSON.stringify(signals.map(s => s.channel)), JSON.stringify(signals), tid]);
  }

  res.json({ ok: true, brand, anomaly_type: anomalyType, severity, spike_factor: parseFloat(spikeFactor.toFixed(2)), baseline_value: baseline, current_value: current, sentiment_drift: parseFloat(sentimentDrift.toFixed(1)), ai_explanation: aiExplanation, recommended_action: recommendedAction, affected_channels: signals.map(s => s.channel) });
}));

// GET /api/anomaly-detector/history
router.get('/history', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'anomaly_detector:history' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, rows: [] });
  const { rows } = await _db.getPool().query(`SELECT id,brand,anomaly_type,severity,spike_factor,baseline_value,current_value,ai_explanation,recommended_action,affected_channels,resolved,created_at FROM anomaly_detections WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]);
  res.json({ ok: true, rows });
}));

// PATCH /api/anomaly-detector/:id/resolve
router.patch('/:id/resolve', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'anomaly_detector:resolve' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'db_unavailable');
  await _db.getPool().query(`UPDATE anomaly_detections SET resolved=true WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
}));

module.exports = router;
