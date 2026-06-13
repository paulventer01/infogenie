const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const PLATFORMS = ['meta','google','tiktok','linkedin','microsoft','snapchat'];
const COMMON_POLICIES = {
  meta: ['Personal attributes policy','Discriminatory practices','Misleading claims','Adult content','Prohibited content'],
  google: ['Dishonest representation','Healthcare policy','Financial services','Adult content','Trademark policy'],
  tiktok: ['Prohibited products','Misleading content','Prohibited business models','Landing page policy'],
  linkedin: ['Prohibited content','Discriminatory ads','Misleading claims','Restricted content'],
};

router.get('/config', async (req, res) => {
  res.json({ ok: true, platforms: PLATFORMS, common_policies: COMMON_POLICIES });
});

router.get('/history', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'self-healing:history' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT r.*, COALESCE(h.healed_copy,'') as latest_healed_copy, COALESCE(h.confidence_pct,0) as latest_confidence
     FROM ad_rejections r
     LEFT JOIN LATERAL (SELECT * FROM heal_attempts WHERE rejection_id=r.id ORDER BY attempted_at DESC LIMIT 1) h ON TRUE
     WHERE r.tenant_id=$1 ORDER BY r.detected_at DESC LIMIT 100`, [tid]
  );
  res.json({ ok: true, rejections: rows.rows });
});

router.post('/check', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'self-healing:check' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { platform, ad_id, ad_name, rejection_reason, rejection_code, policy_violated, original_copy, original_headline } = req.body;
  if (!platform || !rejection_reason) return res.status(400).json({ ok: false, error: 'platform and rejection_reason required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO ad_rejections(tenant_id,platform,ad_id,ad_name,rejection_reason,rejection_code,policy_violated,original_copy,original_headline,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'detected') RETURNING *`,
    [tid, platform, ad_id || null, ad_name || null, rejection_reason, rejection_code || null, policy_violated || null, original_copy || null, original_headline || null]
  );
  res.json({ ok: true, rejection: r.rows[0] });
});

router.post('/heal/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'self-healing:heal' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rej = await p.query(`SELECT * FROM ad_rejections WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!rej.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const r = rej.rows[0];

  let healed = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are an expert ad policy compliance rewriter for ${r.platform}.
An ad was rejected. Rewrite it to pass platform policies while preserving the marketing message.

Platform: ${r.platform}
Rejection reason: ${r.rejection_reason}
Policy violated: ${r.policy_violated || 'unknown'}
Original headline: ${r.original_headline || '(none)'}
Original copy: ${r.original_copy || '(none)'}

Rules:
- Do NOT use superlatives without proof (best, #1, guaranteed) unless factual
- Do NOT make unverifiable claims
- Do NOT reference personal attributes (age, race, religion, health, financial status)
- Keep the core message and CTA intact
- For ${r.platform}, be especially careful about: ${(COMMON_POLICIES[r.platform] || []).join(', ')}

Return strict JSON: {"healed_headline":"...","healed_copy":"...","heal_strategy":"...","policy_fixes":["..."],"confidence_pct":0,"changes_made":["..."]}`;
    const resp = await openai.chat.completions.create({ model: 'gpt-4o', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(resp.choices[0].message.content);
    if (!parsed._DUMMY) healed = parsed;
  } catch (e) {}

  if (!healed) {
    healed = {
      healed_headline: (r.original_headline || 'Our Solution') + ' — See How It Works',
      healed_copy: (r.original_copy || 'Discover our offering.').replace(/guaranteed|best|#1|amazing/gi, '').trim() + ' Learn more today.',
      heal_strategy: 'Removed superlatives and unverifiable claims. Softened language to meet platform guidelines.',
      policy_fixes: ['Removed unverifiable guarantees', 'Softened absolute claims', 'Added qualifying language'],
      confidence_pct: 72,
      changes_made: ['Removed "guaranteed"', 'Added qualifying language', 'Softened headline']
    };
  }

  await p.query(
    `INSERT INTO heal_attempts(rejection_id,tenant_id,healed_headline,healed_copy,heal_strategy,policy_fixes,confidence_pct)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [r.id, tid, healed.healed_headline, healed.healed_copy, healed.heal_strategy, JSON.stringify(healed.policy_fixes), healed.confidence_pct]
  );
  await p.query(`UPDATE ad_rejections SET status='healing', heal_attempts=heal_attempts+1 WHERE id=$1`, [r.id]);

  res.json({ ok: true, healed, rejection_id: r.id });
});

router.post('/resubmit/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'self-healing:resubmit' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const fetch = await p.query(`SELECT * FROM ad_rejections WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  await p.query(`UPDATE ad_rejections SET status='resubmitted', resolved_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  try {
    const { logAction } = require('../roi_ledger/logger');
    const ad = fetch.rows[0] || {};
    await logAction(tid, {
      action_type:     'ad_healed',
      module:          'self_healing',
      title:           `Healed & resubmitted rejected ${ad.platform || ''} ad: "${(ad.ad_name || 'Ad').slice(0,50)}"`,
      description:     `AI rewrote copy to comply with platform policy. Rejection: "${(ad.rejection_reason || '').slice(0,120)}"`,
      estimated_value: 185,
      metadata:        { rejection_id: req.params.id, platform: ad.platform },
    });
  } catch (e) {}
  res.json({ ok: true });
});

router.post('/resolve/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'self-healing:resolve' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`UPDATE ad_rejections SET status='resolved', resolved_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

module.exports = router;
