const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

function _openai(messages, maxTokens = 1800) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({
    model: 'gpt-4o',
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: maxTokens,
  });
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          resolve(JSON.parse(j.choices[0].message.content));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

const SCAN_TYPE_LABEL = {
  all:       'all types (struggling competitors, businesses for sale, fast-growing sectors, franchise opportunities)',
  struggling:'struggling competitors',
  for_sale:  'businesses for sale',
  growing:   'fast-growing sectors',
  franchise: 'franchise opportunities',
};

// POST /scan
router.post('/scan', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'biz-scanner:scan' });
    if (!tid) return _err(res, 400, 'no_tenant');

    const industry     = String(req.body?.industry    || 'SaaS').slice(0, 120);
    const region       = String(req.body?.region      || 'United States').slice(0, 120);
    const scan_type    = String(req.body?.scan_type   || 'all').slice(0, 40);
    const budget_range = String(req.body?.budget_range || '').slice(0, 120);

    const typeLabel = SCAN_TYPE_LABEL[scan_type] || scan_type;

    const systemPrompt = `You are a business acquisition analyst. Given an industry and region, identify 4-6 real market opportunities.
Return strict JSON with this shape:
{
  "market_summary": "<2-3 sentence overview of the current market landscape for acquisitions>",
  "top_pick": "<name + one sentence why it is the best opportunity>",
  "opportunities": [
    {
      "name": "<opportunity name>",
      "category": "<one of: struggling | for_sale | growing | franchise>",
      "opportunity_score": <integer 0-100>,
      "estimated_value": "<e.g. $500K–$2M or N/A>",
      "why_interesting": "<2-3 sentences explaining why this is attractive>",
      "signals": ["<signal 1>", "<signal 2>", "<signal 3>"],
      "action": "<concrete first step to pursue this opportunity>"
    }
  ],
  "sector_trends": ["<trend 1>", "<trend 2>", "<trend 3>"]
}`;

    const userPrompt = `Industry: ${industry}\nRegion: ${region}\nScan focus: ${typeLabel}${budget_range ? `\nBudget range: ${budget_range}` : ''}`;

    const result = await _openai([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ], 1800);

    if (!result) {
      return _err(res, 502, 'AI scan unavailable — try again shortly');
    }

    if (_db.hasDb()) {
      const p = _db.getPool();
      await p.query(
        `INSERT INTO biz_scanner_runs (tenant_id, industry, region, scan_type, budget_range, results)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tid, industry, region, scan_type, budget_range, JSON.stringify(result)]
      );
    }

    res.json({ ok: true, results: result });
  } catch (e) {
    console.error('[biz-scanner] scan error:', e.message);
    res.status(500).json({ ok: false, error: e.message || 'scan_failed' });
  }
});

// GET /history
router.get('/history', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'biz-scanner:history' });
    if (!tid) return res.json({ ok: true, runs: [] });

    if (!_db.hasDb()) return res.json({ ok: true, runs: [] });

    const p = _db.getPool();
    const r = await p.query(
      `SELECT industry, region, scan_type, created_at, results
       FROM biz_scanner_runs
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [tid]
    );
    res.json({ ok: true, runs: r.rows });
  } catch (e) {
    console.error('[biz-scanner] history error:', e.message);
    res.json({ ok: true, runs: [] });
  }
});

module.exports = router;
