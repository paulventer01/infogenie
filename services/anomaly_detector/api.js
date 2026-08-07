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

// POST /api/anomaly-detector/spend-scan — pacing + waste anomalies from canonical metrics
router.post('/spend-scan', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'anomaly_detector:spend-scan' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const days = Math.min(90, Math.max(7, parseInt(req.body?.days, 10) || 30));
  const anomalies = [];

  let metrics = null;
  try {
    const { computeCanonicalMetrics } = require('../canonical_metrics/compute');
    metrics = await computeCanonicalMetrics(tid, { days });
  } catch (e) {
    console.warn('[anomaly-detector] canonical metrics:', e.message);
  }

  if (metrics) {
    for (const w of metrics.waste_channels || []) {
      anomalies.push({
        anomaly_type: 'spend_waste',
        severity: w.waste_cents >= 50000 ? 'high' : 'medium',
        channel: w.channel,
        spike_factor: w.roas != null && w.roas > 0 ? +(1 / w.roas).toFixed(2) : null,
        baseline_value: w.revenue,
        current_value: w.spend,
        ai_explanation: `Channel “${w.channel}” is underwater — spend $${Number(w.spend).toFixed(0)} vs revenue $${Number(w.revenue).toFixed(0)} (ROAS ${w.roas ?? 'n/a'}).`,
        recommended_action: `Pause or cut budget on “${w.channel}” until creative/audience is refreshed; reallocate to channels with ROAS ≥ 1.`,
      });
    }
    if (metrics.blended_roas != null && metrics.blended_roas < 1 && metrics.spend >= 100) {
      anomalies.push({
        anomaly_type: 'blended_roas_crash',
        severity: metrics.blended_roas < 0.5 ? 'critical' : 'high',
        channel: 'blended',
        spike_factor: metrics.blended_roas,
        baseline_value: 1,
        current_value: metrics.blended_roas,
        ai_explanation: `Blended ROAS is ${metrics.blended_roas}x over the last ${days}d — below break-even.`,
        recommended_action: 'Freeze non-performing campaigns and shift budget to proven winners before next spend cycle.',
      });
    }
  }

  // Budget pacing anomalies (current month)
  if (_db.hasDb()) {
    try {
      const period = new Date().toISOString().slice(0, 7);
      const [y, m] = period.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const dayOfMonth = new Date().getUTCDate();
      const bRow = await _db.getPool().query(
        `SELECT target_cents FROM budgets WHERE tenant_id=$1 AND period_month=$2 ORDER BY created_at DESC LIMIT 1`,
        [tid, period],
      );
      const target = Number(bRow.rows[0]?.target_cents || 0);
      const sRow = await _db.getPool().query(
        `SELECT COALESCE(SUM(amount_cents),0)::bigint AS spent FROM spend_events
          WHERE tenant_id=$1 AND to_char(occurred_at,'YYYY-MM')=$2`,
        [tid, period],
      );
      const spent = Number(sRow.rows[0]?.spent || 0);
      if (target > 0 && dayOfMonth > 0) {
        const expected = Math.round(target * (dayOfMonth / daysInMonth));
        const pacePct = expected > 0 ? Math.round((spent / expected) * 100) : 0;
        const projected = Math.round(spent * (daysInMonth / dayOfMonth));
        if (pacePct >= 120) {
          anomalies.push({
            anomaly_type: 'budget_overspend_pace',
            severity: pacePct >= 150 ? 'critical' : 'high',
            channel: 'budget',
            spike_factor: +(pacePct / 100).toFixed(2),
            baseline_value: expected / 100,
            current_value: spent / 100,
            ai_explanation: `Spend is at ${pacePct}% of expected pace — projected month-end $${(projected / 100).toFixed(0)} vs target $${(target / 100).toFixed(0)}.`,
            recommended_action: 'Throttle daily budgets on the highest-spend channels until pace returns under 105%.',
          });
        } else if (pacePct > 0 && pacePct <= 50 && dayOfMonth >= 10) {
          anomalies.push({
            anomaly_type: 'budget_underspend_pace',
            severity: 'medium',
            channel: 'budget',
            spike_factor: +(pacePct / 100).toFixed(2),
            baseline_value: expected / 100,
            current_value: spent / 100,
            ai_explanation: `Spend is only ${pacePct}% of expected pace with ${daysInMonth - dayOfMonth} days left — risk of missing delivery goals.`,
            recommended_action: 'Scale winning campaigns or release held budget so the month closes on plan.',
          });
        }
      }
    } catch (e) {
      console.warn('[anomaly-detector] budget pace:', e.message);
    }
  }

  // Persist top anomalies
  if (_db.hasDb() && anomalies.length) {
    const pool = _db.getPool();
    for (const a of anomalies.slice(0, 10)) {
      try {
        await pool.query(
          `INSERT INTO anomaly_detections
             (brand,anomaly_type,severity,spike_factor,baseline_value,current_value,ai_explanation,recommended_action,affected_channels,signals,tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            req.body?.brand || 'spend',
            a.anomaly_type, a.severity, a.spike_factor,
            a.baseline_value, a.current_value,
            a.ai_explanation, a.recommended_action,
            JSON.stringify([a.channel]), JSON.stringify([{ channel: a.channel, flagged: true }]),
            tid,
          ],
        );
      } catch (_) { /* table may lack columns in older envs */ }
    }
  }

  const top = anomalies.sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
    return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
  })[0] || null;

  res.json({
    ok: true,
    days,
    anomaly_count: anomalies.length,
    severity: top?.severity || 'none',
    anomaly_type: top?.anomaly_type || 'no_anomaly',
    anomalies,
    metrics: metrics ? {
      spend: metrics.spend,
      blended_roas: metrics.blended_roas,
      true_roas: metrics.true_roas,
      waste_cents: metrics.waste_cents,
    } : null,
  });
}));

module.exports = router;
