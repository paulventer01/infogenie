const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI  = require('openai');

const TONES = [
  { id: 'professional', label: 'Professional' },
  { id: 'conversational', label: 'Conversational' },
  { id: 'authoritative', label: 'Authoritative' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'persuasive', label: 'Persuasive' },
];
const INTENSITIES = [
  { id: 'light',    label: 'Light — fix grammar + flow only' },
  { id: 'moderate', label: 'Moderate — restructure + improve' },
  { id: 'heavy',    label: 'Heavy — full rewrite keeping meaning' },
];

router.get('/config', (req, res) => res.json({ ok: true, tones: TONES, intensities: INTENSITIES }));

// ── Jobs ──────────────────────────────────────────────────────────────────────

router.get('/jobs', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk-rewriter:jobs' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT * FROM bulk_rewrite_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]
  );
  res.json({ ok: true, jobs: r.rows });
});

router.post('/jobs', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk-rewriter:create' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { name = 'Untitled Job', tone = 'professional', intensity = 'moderate', target_keywords = '', seo_focus = true, items = [] } = req.body;
  if (!items.length) return res.status(400).json({ ok: false, error: 'items array required' });
  const limited = items.slice(0, 20);
  const p = await _db.getPool();
  const jRow = await p.query(
    `INSERT INTO bulk_rewrite_jobs(tenant_id,name,tone,intensity,target_keywords,seo_focus,total_items,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
    [tid, name, tone, intensity, target_keywords, seo_focus, limited.length]
  );
  const job = jRow.rows[0];
  for (const item of limited) {
    await p.query(
      `INSERT INTO bulk_rewrite_items(job_id,tenant_id,title,original_text,word_count_orig)
       VALUES($1,$2,$3,$4,$5)`,
      [job.id, tid, item.title || null, item.text || '', (item.text || '').split(/\s+/).filter(Boolean).length]
    );
  }
  res.json({ ok: true, job });
});

router.get('/jobs/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk-rewriter:get' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const jRow = await p.query(`SELECT * FROM bulk_rewrite_jobs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!jRow.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const items = await p.query(`SELECT * FROM bulk_rewrite_items WHERE job_id=$1 ORDER BY id`, [req.params.id]);
  res.json({ ok: true, job: jRow.rows[0], items: items.rows });
});

// ── Process job (AI rewrites) ─────────────────────────────────────────────────

router.post('/jobs/:id/process', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk-rewriter:process' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const jRow = await p.query(`SELECT * FROM bulk_rewrite_jobs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!jRow.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const job = jRow.rows[0];

  await p.query(`UPDATE bulk_rewrite_jobs SET status='processing', updated_at=NOW() WHERE id=$1`, [job.id]);

  const items = await p.query(`SELECT * FROM bulk_rewrite_items WHERE job_id=$1 AND status='pending' ORDER BY id`, [job.id]);

  // Respond immediately — processing happens async
  res.json({ ok: true, processing: items.rows.length });

  // Background processing
  (async () => {
    let openai;
    try { openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY }); } catch (e) {}

    const intensityGuide = {
      light:    'Fix grammar, spelling, and sentence flow only. Keep the original structure and wording as close as possible.',
      moderate: 'Restructure paragraphs, improve clarity, strengthen headings, and enhance overall readability while preserving the core message.',
      heavy:    'Completely rewrite the content keeping only the core meaning and key facts. Use fresh phrasing, better structure, and a more compelling voice.',
    };

    let processed = 0;
    let failed    = 0;

    for (const item of items.rows) {
      try {
        let rewritten = null;
        let changes   = null;
        let seoNew    = null;

        if (openai) {
          const kwLine = job.target_keywords ? `\nTarget keywords to naturally include: ${job.target_keywords}` : '';
          const seoLine = job.seo_focus ? '\n- Add or improve H2/H3 subheadings where appropriate\n- Include the target keywords naturally (not stuffed)\n- Add a clear meta-description-ready opening paragraph' : '';
          const prompt = `You are an expert SEO content editor. Rewrite the following article.

Tone: ${job.tone}
Intensity: ${intensityGuide[job.intensity] || intensityGuide.moderate}${kwLine}

SEO requirements:${seoLine}
- Preserve all factual information
- Do not add fabricated statistics or claims

Return strict JSON:
{
  "rewritten_text": "...",
  "changes_summary": "...",
  "seo_score_estimate": 0
}

ARTICLE TO REWRITE:
${item.original_text.slice(0, 6000)}`;

          const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: prompt }],
          });
          const parsed = JSON.parse(resp.choices[0].message.content);
          if (!parsed._DUMMY && parsed.rewritten_text) {
            rewritten = parsed.rewritten_text;
            changes   = parsed.changes_summary || null;
            seoNew    = +parsed.seo_score_estimate || null;
          }
        }

        if (!rewritten) throw new Error('openai_key_required');

        const wc = rewritten.split(/\s+/).filter(Boolean).length;
        await p.query(
          `UPDATE bulk_rewrite_items SET status='done', rewritten_text=$1, word_count_new=$2, seo_score_new=$3, changes_summary=$4 WHERE id=$5`,
          [rewritten, wc, seoNew, changes, item.id]
        );
        processed++;
      } catch (e) {
        await p.query(
          `UPDATE bulk_rewrite_items SET status='failed', error_message=$1 WHERE id=$2`,
          [e.message?.slice(0, 200), item.id]
        );
        failed++;
      }

      await p.query(
        `UPDATE bulk_rewrite_jobs SET processed_items=$1, failed_items=$2, updated_at=NOW() WHERE id=$3`,
        [processed, failed, job.id]
      );
    }

    const finalStatus = failed === items.rows.length ? 'failed' : 'done';
    await p.query(
      `UPDATE bulk_rewrite_jobs SET status=$1, updated_at=NOW() WHERE id=$2`,
      [finalStatus, job.id]
    );
  })().catch(() => {});
});

// ── Delete job ────────────────────────────────────────────────────────────────

router.delete('/jobs/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bulk-rewriter:delete' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  await p.query(`DELETE FROM bulk_rewrite_jobs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

module.exports = router;
