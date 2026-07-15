const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI  = require('openai');

const SECTIONS = [
  { id: 'seo',           label: 'SEO Health',           icon: '🔍', description: 'On-page SEO score, meta tags, headings, keyword usage' },
  { id: 'pagespeed',     label: 'Page Speed',           icon: '⚡', description: 'Load time, Core Web Vitals, mobile performance' },
  { id: 'content',       label: 'Content Quality',      icon: '📝', description: 'Content gaps, readability, freshness' },
  { id: 'social',        label: 'Social Presence',      icon: '📱', description: 'Social profiles, following, engagement signals' },
  { id: 'competitors',   label: 'Competitor Gaps',      icon: '⚔️', description: 'What competitors do better, keyword gaps' },
  { id: 'local',         label: 'Local SEO',            icon: '📍', description: 'Google Business Profile, local citations, map pack' },
  { id: 'recommendations', label: 'AI Recommendations', icon: '🤖', description: 'Prioritised action plan specific to this business' },
];

function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

router.get('/config', (req, res) => res.json({ ok: true, sections: SECTIONS }));

// ── Prospects ─────────────────────────────────────────────────────────────────

router.get('/prospects', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'insta-reports:prospects' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT pr.*, COUNT(ir.id) AS report_count
     FROM insta_report_prospects pr
     LEFT JOIN insta_reports ir ON ir.prospect_id=pr.id
     WHERE pr.tenant_id=$1 GROUP BY pr.id ORDER BY pr.created_at DESC`,
    [tid]
  );
  res.json({ ok: true, prospects: r.rows });
});

router.post('/prospects', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'insta-reports:create-prospect' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { business_name, contact_name, email, website_url, phone, industry, location, notes, source = 'manual' } = req.body;
  if (!business_name) return res.status(400).json({ ok: false, error: 'business_name required' });
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO insta_report_prospects(tenant_id,business_name,contact_name,email,website_url,phone,industry,location,notes,source)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [tid, business_name, contact_name || null, email || null, website_url || null, phone || null, industry || null, location || null, notes || null, source]
  );
  res.json({ ok: true, prospect: r.rows[0] });
});

// Bulk import from CSV data
router.post('/prospects/bulk', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'insta-reports:bulk-prospects' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { prospects = [] } = req.body;
  const p = await _db.getPool();
  let added = 0;
  for (const pr of prospects.slice(0, 200)) {
    if (!pr.business_name) continue;
    try {
      await p.query(
        `INSERT INTO insta_report_prospects(tenant_id,business_name,contact_name,email,website_url,industry,location,source)
         VALUES($1,$2,$3,$4,$5,$6,$7,'csv')`,
        [tid, pr.business_name, pr.contact_name || null, pr.email || null, pr.website_url || null, pr.industry || null, pr.location || null]
      );
      added++;
    } catch (e) {}
  }
  res.json({ ok: true, added });
});

// ── Reports ───────────────────────────────────────────────────────────────────

router.get('/reports', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'insta-reports:list' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT ir.*, pr.business_name, pr.email, pr.website_url, pr.contact_name,
       (SELECT COUNT(*) FROM insta_report_sends s WHERE s.report_id=ir.id) AS send_count
     FROM insta_reports ir
     JOIN insta_report_prospects pr ON pr.id=ir.prospect_id
     WHERE ir.tenant_id=$1 ORDER BY ir.created_at DESC`,
    [tid]
  );
  res.json({ ok: true, reports: r.rows });
});

router.post('/reports', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'insta-reports:create' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { prospect_id, sections_enabled = ['seo','pagespeed','content','social','competitors','recommendations'] } = req.body;
  if (!prospect_id) return res.status(400).json({ ok: false, error: 'prospect_id required' });
  const p = await _db.getPool();
  const pr = await p.query(`SELECT * FROM insta_report_prospects WHERE id=$1 AND tenant_id=$2`, [prospect_id, tid]);
  if (!pr.rows.length) return res.status(404).json({ ok: false, error: 'prospect not found' });
  const token = genToken();
  const r = await p.query(
    `INSERT INTO insta_reports(tenant_id,prospect_id,sections_enabled,public_token)
     VALUES($1,$2,$3,$4) RETURNING *`,
    [tid, prospect_id, sections_enabled, token]
  );
  res.json({ ok: true, report: r.rows[0], prospect: pr.rows[0] });
});

router.get('/reports/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'insta-reports:get' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT ir.*, pr.business_name, pr.email, pr.website_url, pr.contact_name, pr.industry, pr.location
     FROM insta_reports ir JOIN insta_report_prospects pr ON pr.id=ir.prospect_id
     WHERE ir.id=$1 AND ir.tenant_id=$2`, [req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const sends = await p.query(`SELECT * FROM insta_report_sends WHERE report_id=$1 ORDER BY sent_at DESC`, [req.params.id]);
  res.json({ ok: true, report: r.rows[0], sends: sends.rows });
});

// ── Generate report sections via AI ──────────────────────────────────────────

router.post('/reports/:id/generate', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'insta-reports:generate' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT ir.*, pr.business_name, pr.email, pr.website_url, pr.contact_name, pr.industry, pr.location
     FROM insta_reports ir JOIN insta_report_prospects pr ON pr.id=ir.prospect_id
     WHERE ir.id=$1 AND ir.tenant_id=$2`, [req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const row = r.rows[0];
  const sections = row.sections_enabled || [];

  await p.query(`UPDATE insta_reports SET status='generating' WHERE id=$1`, [row.id]);

  // Try PageSpeed API first for real data
  let pageSpeedData = null;
  if (sections.includes('pagespeed') && row.website_url && process.env.GOOGLE_PAGESPEED_API_KEY) {
    try {
      const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(row.website_url)}&key=${process.env.GOOGLE_PAGESPEED_API_KEY}&strategy=mobile`;
      const psRes = await fetch(url);
      if (psRes.ok) {
        const psData = await psRes.json();
        const cats = psData.lighthouseResult?.categories;
        pageSpeedData = {
          performance: Math.round((cats?.performance?.score || 0) * 100),
          seo:         Math.round((cats?.seo?.score || 0) * 100),
          accessibility:Math.round((cats?.accessibility?.score || 0) * 100),
          best_practices:Math.round((cats?.['best-practices']?.score || 0) * 100),
        };
      }
    } catch (e) {}
  }

  let reportData = {};
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const psContext = pageSpeedData ? `\nReal PageSpeed data: Performance=${pageSpeedData.performance}, SEO=${pageSpeedData.seo}, Accessibility=${pageSpeedData.accessibility}, Best Practices=${pageSpeedData.best_practices}` : '';
    const prompt = `You are an expert digital marketing auditor. Generate a prospect audit report for:

Business: ${row.business_name}
Website: ${row.website_url || 'unknown'}
Industry: ${row.industry || 'unknown'}
Location: ${row.location || 'unknown'}
Contact: ${row.contact_name || 'unknown'}${psContext}

Generate the following sections: ${sections.join(', ')}

For each section, be specific and actionable. Do NOT invent specific traffic numbers or rankings you cannot know — instead give qualitative assessments and ranges.

Return strict JSON with exactly these keys (only include requested sections):
{
  "seo": {
    "score": 0,
    "grade": "A/B/C/D/F",
    "headline": "...",
    "findings": ["..."],
    "issues": ["..."],
    "quick_fixes": ["..."]
  },
  "pagespeed": {
    "score": 0,
    "grade": "A/B/C/D/F",
    "headline": "...",
    "findings": ["..."],
    "issues": ["..."],
    "quick_fixes": ["..."]
  },
  "content": {
    "score": 0,
    "grade": "A/B/C/D/F",
    "headline": "...",
    "findings": ["..."],
    "gaps": ["..."],
    "opportunities": ["..."]
  },
  "social": {
    "score": 0,
    "grade": "A/B/C/D/F",
    "headline": "...",
    "platforms_detected": ["..."],
    "findings": ["..."],
    "opportunities": ["..."]
  },
  "competitors": {
    "score": 0,
    "grade": "A/B/C/D/F",
    "headline": "...",
    "gaps": ["..."],
    "opportunities": ["..."]
  },
  "local": {
    "score": 0,
    "grade": "A/B/C/D/F",
    "headline": "...",
    "findings": ["..."],
    "issues": ["..."]
  },
  "recommendations": {
    "overall_score": 0,
    "overall_grade": "A/B/C/D/F",
    "executive_summary": "...",
    "quick_wins": [
      { "action": "...", "impact": "high/medium/low", "effort": "high/medium/low", "timeline": "..." }
    ],
    "strategic_priorities": ["..."],
    "estimated_opportunity": "..."
  }
}`;

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = JSON.parse(resp.choices[0].message.content);
    if (!parsed._DUMMY) {
      reportData = parsed;
      if (pageSpeedData && reportData.pagespeed) {
        reportData.pagespeed.score = pageSpeedData.performance;
        reportData.pagespeed.real_data = pageSpeedData;
      }
    }
  } catch (e) {
    await p.query(`UPDATE insta_reports SET status='failed' WHERE id=$1`, [row.id]);
    return res.status(500).json({ ok: false, error: 'generation_failed', detail: e.message });
  }

  await p.query(
    `UPDATE insta_reports SET status='ready', report_data=$1, generated_at=NOW() WHERE id=$2`,
    [JSON.stringify(reportData), row.id]
  );
  res.json({ ok: true, report_data: reportData });
});

// ── Send report by email ──────────────────────────────────────────────────────

router.post('/reports/:id/send', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'insta-reports:send' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT ir.*, pr.business_name, pr.email, pr.website_url, pr.contact_name
     FROM insta_reports ir JOIN insta_report_prospects pr ON pr.id=ir.prospect_id
     WHERE ir.id=$1 AND ir.tenant_id=$2`, [req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const row = r.rows[0];
  const { to_email, custom_subject, custom_intro } = req.body;
  const recipient = to_email || row.email;
  if (!recipient) return res.status(400).json({ ok: false, error: 'to_email required' });
  if (row.status !== 'ready') return res.status(400).json({ ok: false, error: 'report not ready yet' });

  const baseUrl = process.env.PUBLIC_URL || `https://${process.env.REPL_SLUG}.replit.app`;
  const reportUrl = `${baseUrl}/report/${row.public_token}`;
  const subject = custom_subject || `Your Free Digital Marketing Audit — ${row.business_name}`;

  // Try Resend
  let emailSent = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
      const intro = custom_intro || `Hi ${row.contact_name || 'there'},\n\nWe've put together a complimentary digital marketing audit for ${row.business_name}. Inside you'll find our assessment of your SEO health, website performance, content gaps, and a prioritised action plan.`;
      await resend.emails.send({
        from: fromEmail,
        to: [recipient],
        subject,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#0A1628">Your Free Digital Marketing Audit</h2>
  <p style="color:#374151;line-height:1.7">${intro.replace(/\n/g, '<br>')}</p>
  <div style="text-align:center;margin:32px 0">
    <a href="${reportUrl}" style="background:linear-gradient(135deg,#0066FF,#00C9C8);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px">
      📊 View Your Full Report
    </a>
  </div>
  <p style="color:#94A3B8;font-size:13px">This report was generated specifically for ${row.business_name}. Click the button above to view your personalised audit.</p>
</div>`,
      });
      emailSent = true;
    } catch (e) {}
  }

  await p.query(
    `INSERT INTO insta_report_sends(report_id,tenant_id,recipient_email,subject,status)
     VALUES($1,$2,$3,$4,$5)`,
    [row.id, tid, recipient, subject, emailSent ? 'sent' : 'queued']
  );

  res.json({ ok: true, sent: emailSent, recipient, report_url: reportUrl });
});

// ── Public report view (no auth — accessed by prospect via email link) ────────

router.get('/public/:token', async (req, res) => {
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT ir.*, pr.business_name, pr.website_url, pr.contact_name, pr.industry, pr.location
     FROM insta_reports ir JOIN insta_report_prospects pr ON pr.id=ir.prospect_id
     WHERE ir.public_token=$1 AND ir.status='ready'`, [req.params.token]
  );
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  await p.query(`UPDATE insta_reports SET viewed_at=NOW() WHERE id=$1 AND viewed_at IS NULL`, [r.rows[0].id]);
  res.json({ ok: true, report: r.rows[0] });
});

module.exports = router;
