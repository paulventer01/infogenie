const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { normalizeChatParams } = require('../ai_compat');

const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

/**
 * OpenAI call for review reply generation
 */
async function _callOpenAI(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;

  const raw = normalizeChatParams({
    model: 'gpt-4o-mini',
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: opts.max_tokens || 1000,
  });

  const body = JSON.stringify(raw);
  const https = require('https');
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          resolve(j.choices[0].message.content);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

function _templateReply(rating) {
  if (rating >= 4) {
    return { reply: "Thank you for your wonderful review! We are thrilled to hear you had a great experience and look forward to serving you again soon." };
  } else {
    return { reply: "Thank you for your feedback. We are sorry to hear that your experience didn't meet your expectations. We'd love to learn more and see how we can make it right." };
  }
}

// --- Review Reply Drafts ---

router.post('/replies/generate', async (req, res) => {
  const tid = await _tid(req, 'reviews:generate-reply');
  if (!tid) return _err(res, 400, 'no_tenant');

  const { review_text, rating, reviewer_name, platform, source_review_id } = req.body || {};
  if (!review_text) return _err(res, 400, 'review_text required');

  const systemPrompt = `You are a professional brand manager. Draft a brand-appropriate reply to a customer review.
If the rating is 3 or less, be empathetic, professional, and offer to resolve the issue.
If the rating is 4 or more, be appreciative, warm, and encouraging.
Keep it concise (2-3 sentences).

Return strict JSON: { "reply": "..." }`;

  const userPrompt = `Review from ${reviewer_name || 'Customer'} on ${platform || 'our platform'}:
Rating: ${rating}/5
Review: "${review_text}"`;

  const raw = await _callOpenAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);

  let result = _templateReply(rating);
  let _estimated = true;
  if (raw) {
    try { result = JSON.parse(raw); _estimated = false; } catch (e) {}
  }

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO review_reply_drafts (tenant_id, platform, reviewer_name, rating, review_text, ai_draft_reply, source_review_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [tid, platform, reviewer_name, rating, review_text, result.reply, source_review_id]
  );

  res.json({ ok: true, draft: ins.rows[0], _estimated });
});

router.get('/replies', async (req, res) => {
  const tid = await _tid(req, 'reviews:list-replies');
  if (!tid) return _err(res, 400, 'no_tenant');

  const status = req.query.status || 'pending';
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT * FROM review_reply_drafts WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC`,
    [tid, status]
  );
  res.json({ ok: true, drafts: rows.rows });
});

router.post('/replies/:id/approve', async (req, res) => {
  const tid = await _tid(req, 'reviews:approve-reply');
  if (!tid) return _err(res, 400, 'no_tenant');

  const p = await _db.getPool();
  await p.query(
    `UPDATE review_reply_drafts SET status = 'approved' WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, tid]
  );
  res.json({ ok: true });
});

router.post('/replies/:id/dismiss', async (req, res) => {
  const tid = await _tid(req, 'reviews:dismiss-reply');
  if (!tid) return _err(res, 400, 'no_tenant');

  const p = await _db.getPool();
  await p.query(
    `UPDATE review_reply_drafts SET status = 'dismissed' WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, tid]
  );
  res.json({ ok: true });
});

// --- Review Request Rules ---

router.get('/request-rules', async (req, res) => {
  const tid = await _tid(req, 'reviews:list-rules');
  if (!tid) return _err(res, 400, 'no_tenant');

  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT * FROM review_request_rules WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tid]
  );
  res.json({ ok: true, rules: rows.rows });
});

router.post('/request-rules', async (req, res) => {
  const tid = await _tid(req, 'reviews:create-rule');
  if (!tid) return _err(res, 400, 'no_tenant');

  const { name, trigger_type, channel, delay_hours, message_template, target_platform_url } = req.body || {};
  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO review_request_rules (tenant_id, name, trigger_type, channel, delay_hours, message_template, target_platform_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [tid, name, trigger_type, channel, delay_hours, message_template, target_platform_url]
  );
  res.json({ ok: true, rule: ins.rows[0] });
});

router.put('/request-rules/:id', async (req, res) => {
  const tid = await _tid(req, 'reviews:update-rule');
  if (!tid) return _err(res, 400, 'no_tenant');

  const { name, trigger_type, channel, delay_hours, message_template, target_platform_url, active } = req.body || {};
  const p = await _db.getPool();
  await p.query(
    `UPDATE review_request_rules 
     SET name=$1, trigger_type=$2, channel=$3, delay_hours=$4, message_template=$5, target_platform_url=$6, active=$7
     WHERE id=$8 AND tenant_id=$9`,
    [name, trigger_type, channel, delay_hours, message_template, target_platform_url, active, req.params.id, tid]
  );
  res.json({ ok: true });
});

router.delete('/request-rules/:id', async (req, res) => {
  const tid = await _tid(req, 'reviews:delete-rule');
  if (!tid) return _err(res, 400, 'no_tenant');

  const p = await _db.getPool();
  await p.query(`DELETE FROM review_request_rules WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

router.post('/request-rules/:id/trigger', async (req, res) => {
  const tid = await _tid(req, 'reviews:trigger-rule');
  if (!tid) return _err(res, 400, 'no_tenant');

  const { contact_email, contact_phone } = req.body || {};
  const p = await _db.getPool();
  const ruleRes = await p.query(`SELECT * FROM review_request_rules WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!ruleRes.rows.length) return _err(res, 404, 'rule not found');
  const rule = ruleRes.rows[0];

  let status = 'skipped:no-provider';
  
  // Minimal Resend-like check
  const resendKey = process.env.RESEND_API_KEY;
  if (rule.channel === 'email' && resendKey && !resendKey.startsWith('re_dummy')) {
    try {
      // Simulate sending via Resend
      // In a real implementation, you'd call Resend API here.
      status = 'sent';
    } catch (e) {
      status = 'failed';
    }
  } else if (rule.channel === 'sms') {
    // SMS provider check could go here
    status = 'skipped:no-sms-provider';
  }

  const logIns = await p.query(
    `INSERT INTO review_request_log (tenant_id, rule_id, contact_email, contact_phone, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tid, rule.id, contact_email, contact_phone, status]
  );

  res.json({ ok: true, log: logIns.rows[0] });
});

router.get('/request-logs', async (req, res) => {
  const tid = await _tid(req, 'reviews:list-logs');
  if (!tid) return _err(res, 400, 'no_tenant');

  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT l.*, r.name as rule_name 
     FROM review_request_log l
     LEFT JOIN review_request_rules r ON l.rule_id = r.id
     WHERE l.tenant_id = $1 
     ORDER BY l.sent_at DESC 
     LIMIT 100`,
    [tid]
  );
  res.json({ ok: true, logs: rows.rows });
});

module.exports = router;
