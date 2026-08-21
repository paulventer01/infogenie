const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { DEFAULT_ITEMS } = require('./schema');

const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

// GET /api/launch-compliance/checklists
router.get('/checklists', async (req, res) => {
  const tid = await _tid(req, 'compliance:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `SELECT c.*,
         COUNT(i.id) FILTER (WHERE i.status='pass') AS pass_count,
         COUNT(i.id) FILTER (WHERE i.status='fail') AS fail_count,
         COUNT(i.id) FILTER (WHERE i.status='pending') AS pending_count,
         COUNT(i.id) AS total_count
       FROM campaign_compliance_checklists c
       LEFT JOIN compliance_checklist_items i ON i.checklist_id = c.id AND i.tenant_id=$1
       WHERE c.tenant_id=$1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`,
      [tid]
    );
    res.json({ ok: true, checklists: rows });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/launch-compliance/checklists
router.post('/checklists', async (req, res) => {
  const tid = await _tid(req, 'compliance:create');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { campaign_name, platform, landing_page_url, ad_copy } = req.body || {};
  if (!campaign_name) return _err(res, 400, 'campaign_name required');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      `INSERT INTO campaign_compliance_checklists (tenant_id,campaign_name,platform,landing_page_url,ad_copy)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tid, campaign_name, platform||'general', landing_page_url||null, ad_copy||null]
    );
    const checklist = rows[0];
    // Seed default checklist items — stamp the resolved tenant, never body.tenant_id.
    for (const item of DEFAULT_ITEMS) {
      await p.query(
        'INSERT INTO compliance_checklist_items (tenant_id,checklist_id,category,item,order_idx) VALUES ($1,$2,$3,$4,$5)',
        [tid, checklist.id, item.category, item.item, item.order_idx]
      );
    }
    const { rows: items } = await p.query(
      'SELECT * FROM compliance_checklist_items WHERE checklist_id=$1 AND tenant_id=$2 ORDER BY order_idx',
      [checklist.id, tid]
    );
    res.json({ ok: true, checklist: { ...checklist, items } });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /api/launch-compliance/checklists/:id
router.get('/checklists/:id', async (req, res) => {
  const tid = await _tid(req, 'compliance:get');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      'SELECT * FROM campaign_compliance_checklists WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tid]
    );
    if (!rows.length) return _err(res, 404, 'not_found');
    const { rows: items } = await p.query(
      'SELECT * FROM compliance_checklist_items WHERE checklist_id=$1 AND tenant_id=$2 ORDER BY order_idx',
      [rows[0].id, tid]
    );
    res.json({ ok: true, checklist: { ...rows[0], items } });
  } catch (e) { _err(res, 500, e.message); }
});

// PUT /api/launch-compliance/items/:itemId — update single item status
router.put('/items/:itemId', async (req, res) => {
  const tid = await _tid(req, 'compliance:item-update');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { status, notes } = req.body || {};
  if (!['pending','pass','fail','na'].includes(status)) return _err(res, 400, 'invalid status');
  try {
    const p = _db.getPool();
    // Verify ownership via checklist + item tenant_id (never body.tenant_id).
    const { rows } = await p.query(
      `UPDATE compliance_checklist_items ci SET status=$1, notes=$2
       FROM campaign_compliance_checklists c
       WHERE ci.id=$3 AND ci.checklist_id=c.id AND c.tenant_id=$4 AND ci.tenant_id=$4
       RETURNING ci.*`,
      [status, notes||null, req.params.itemId, tid]
    );
    if (!rows.length) return _err(res, 404, 'not_found');
    // Recalculate overall status of checklist
    const checklistId = rows[0].checklist_id;
    const { rows: summary } = await p.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='fail') AS fails,
         COUNT(*) FILTER (WHERE status='pending') AS pending,
         COUNT(*) AS total
       FROM compliance_checklist_items WHERE checklist_id=$1 AND tenant_id=$2`,
      [checklistId, tid]
    );
    const { fails, pending, total } = summary[0];
    let overall_result = 'passed';
    if (Number(fails) > 0) overall_result = 'failed';
    else if (Number(pending) > 0) overall_result = 'in_progress';
    await p.query(
      'UPDATE campaign_compliance_checklists SET overall_result=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [overall_result, checklistId, tid]
    );
    res.json({ ok: true, item: rows[0], overall_result });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/launch-compliance/checklists/:id/proofread — AI grammar + clarity review
router.post('/checklists/:id/proofread', async (req, res) => {
  const tid = await _tid(req, 'compliance:proofread');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const { rows } = await p.query(
      'SELECT * FROM campaign_compliance_checklists WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tid]
    );
    if (!rows.length) return _err(res, 404, 'not_found');
    const copy = rows[0].ad_copy || req.body?.ad_copy || '';
    if (!copy.trim()) return _err(res, 400, 'no_copy_to_proofread');

    let feedback = null;

    try {
      const openai = global._openaiClient || null;
      if (openai) {
        const result = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [{
            role: 'system',
            content: 'You are a senior marketing copy editor. Review the ad copy provided and return a strict JSON with keys: "overall_score" (1-10), "issues" (array of {severity:"error"|"warning"|"suggestion", text:string}), "improved_copy" (string), "summary" (string). Be concise and actionable.',
          }, {
            role: 'user',
            content: `Review this ad copy:\n\n${copy}`,
          }],
        });
        feedback = JSON.parse(result.choices[0].message.content);
      }
    } catch (e) {
      console.warn('[launch-compliance] AI proofread failed:', e.message);
    }

    if (!feedback || feedback._DUMMY) {
      feedback = {
        overall_score: null,
        issues: [{ severity: 'suggestion', text: 'Configure an AI provider (OpenAI/Anthropic) for automated proofreading.' }],
        improved_copy: copy,
        summary: 'AI provider not configured. Manual peer-review is recommended.',
        _estimated: true,
      };
    }

    await p.query(
      'UPDATE campaign_compliance_checklists SET ai_feedback=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [JSON.stringify(feedback), rows[0].id, tid]
    );
    res.json({ ok: true, feedback });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/launch-compliance/checklists/:id/brand-check — brand alignment
router.post('/checklists/:id/brand-check', async (req, res) => {
  const tid = await _tid(req, 'compliance:brand-check');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    const [cl, bf] = await Promise.all([
      p.query('SELECT * FROM campaign_compliance_checklists WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]),
      p.query('SELECT * FROM brand_foundation WHERE tenant_id=$1 LIMIT 1', [tid]).catch(() => ({ rows: [] })),
    ]);
    if (!cl.rows.length) return _err(res, 404, 'not_found');
    const checklist = cl.rows[0];
    const brand = bf.rows[0] || null;

    let score = null;
    let issues = [];

    if (brand) {
      const copy = checklist.ad_copy || '';
      const brandName = brand.brand_name || brand.company_name || '';
      const voiceDesc = brand.brand_voice || brand.tone || '';

      // Basic heuristic checks
      if (brandName && !copy.toLowerCase().includes(brandName.toLowerCase())) {
        issues.push({ type: 'warning', text: `Brand name "${brandName}" not mentioned in ad copy` });
      }
      if (voiceDesc && copy.length > 0) {
        // AI alignment check
        try {
          const openai = global._openaiClient || null;
          if (openai) {
            const r = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              response_format: { type: 'json_object' },
              messages: [{
                role: 'system',
                content: 'You are a brand compliance reviewer. Check if the ad copy aligns with the brand voice. Return JSON: {"score":1-10,"issues":["..."],"aligned":true|false,"summary":"..."}',
              }, {
                role: 'user',
                content: `Brand voice: ${voiceDesc}\n\nAd copy: ${copy}`,
              }],
            });
            const result = JSON.parse(r.choices[0].message.content);
            score = result.score;
            if (result.issues) issues = [...issues, ...result.issues.map(t => ({ type: 'warning', text: t }))];
          }
        } catch (e) {
          console.warn('[launch-compliance] brand-check AI error:', e.message);
        }
      }
      if (score === null) score = issues.length === 0 ? 9 : Math.max(4, 9 - issues.length * 2);
    } else {
      score = null;
      issues = [{ type: 'info', text: 'No Brand Foundation configured yet. Set up Brand Foundation to enable automated brand alignment.' }];
    }

    await p.query(
      'UPDATE campaign_compliance_checklists SET brand_score=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [score, checklist.id, tid]
    );
    res.json({ ok: true, brand_score: score, issues, brand_found: !!brand });
  } catch (e) { _err(res, 500, e.message); }
});

// DELETE /api/launch-compliance/checklists/:id
router.delete('/checklists/:id', async (req, res) => {
  const tid = await _tid(req, 'compliance:delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = _db.getPool();
    await p.query('DELETE FROM campaign_compliance_checklists WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
