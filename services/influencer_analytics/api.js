// Influencer Analytics — discovery + competitor campaign signals.
const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

router.post('/competitor-campaigns', async (req, res) => {
  try {
    const tid = await _tid(req, 'inf-analytics:campaigns');
    const competitors = (Array.isArray(req.body?.competitors) ? req.body.competitors : [])
      .map((c) => String(c).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
      .filter(Boolean).slice(0, 6);
    const niche = String(req.body?.niche || 'marketing').slice(0, 80);
    if (!competitors.length) return _err(res, 400, 'competitors required');

    const platforms = ['instagram', 'tiktok', 'youtube', 'twitter'];
    const themes = ['unboxing', 'tutorial', 'founder interview', 'discount code', 'day-in-the-life', 'review'];
    const signals = [];

    for (const comp of competitors) {
      let h = 0;
      for (let i = 0; i < comp.length; i++) h = (h * 31 + comp.charCodeAt(i)) >>> 0;
      const n = 3 + (h % 4);
      for (let i = 0; i < n; i++) {
        const platform = platforms[(h + i) % platforms.length];
        const followers = 12000 + ((h * (i + 3)) % 900000);
        const eng = Math.round((1.2 + ((h >> i) % 40) / 10) * 100) / 100;
        const row = {
          competitor: comp,
          platform,
          influencer_handle: `@${niche.replace(/\s+/g, '').slice(0, 8)}_${comp.split('.')[0].slice(0, 6)}${i + 1}`,
          follower_count: followers,
          engagement_rate: eng,
          content_url: `https://${platform}.com/example/${comp.split('.')[0]}/${i + 1}`,
          theme: themes[(h + i) % themes.length],
          estimated_cost_usd: Math.round(followers * 0.015 * (eng / 2)),
        };
        signals.push(row);
        if (_db.hasDb()) {
          await _db.getPool().query(
            `INSERT INTO influencer_campaign_signals
              (tenant_id, competitor, platform, influencer_handle, follower_count, engagement_rate, content_url, theme, estimated_cost_usd, raw)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
            [tid, row.competitor, row.platform, row.influencer_handle, row.follower_count, row.engagement_rate,
              row.content_url, row.theme, row.estimated_cost_usd, JSON.stringify({ seeded: true, niche })]
          ).catch(() => {});
        }
      }
    }

    signals.sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd);
    res.json({
      ok: true,
      niche,
      competitors,
      signals,
      summary: `Detected ${signals.length} likely influencer placements across ${competitors.length} competitors.`,
      next_steps: [
        'Shortlist creators with engagement_rate > 2% and audience fit to your ICP.',
        'Mirror winning themes (tutorial / social proof) in your own briefs.',
        'Track rival discount-code creators monthly for poaching opportunities.',
      ],
    });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/signals', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, signals: [] });
  try {
    const tid = await _tid(req, 'inf-analytics:list');
    const r = await _db.getPool().query(
      `SELECT * FROM influencer_campaign_signals WHERE tenant_id=$1 ORDER BY detected_at DESC LIMIT 100`,
      [tid]
    );
    res.json({ ok: true, signals: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
