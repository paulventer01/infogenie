const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { MAX_OUTPUT_SCAN_CHARS } = require('../ai_governance/output_gate');
const { createRateLimiter } = require('../security/rate_limit');
const { normalizeChatParams } = require('../ai_compat');
const {
  gateRouteText,
  contentSafetyHttpBody,
  attachContentSafetyWarnings,
} = require('../ai_governance/route_gate');
const {
  normalizeReviewReply,
  reviewReplyGateText,
} = require('../ai_governance/content_schemas');

const router = express.Router();
const replyApproveLimiter = createRateLimiter({
  name: 'review-reply-approve', windowMs: 60_000, max: 20, failClosed: true,
  keyFn: req => req.tenant?.id != null && req.user?.id != null
    ? `review-reply-approve|${req.tenant.id}|${req.user.id}` : null,
});

const ruleSaveLimiter = createRateLimiter({
  name: 'review-rule-save', windowMs: 60_000, max: 20, failClosed: true,
  keyFn: req => req.tenant?.id != null && req.user?.id != null
    ? `review-rule-save|${req.tenant.id}|${req.user.id}` : null,
});

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

function _parseWarnings(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

async function _gateReply(req, tid, replyText, label) {
  try {
    return await gateRouteText({
      tenantId: tid,
      userId: req.user?.id || null,
      surface: 'review_monitor',
      action: 'generate_content',
      text: replyText,
      label,
    });
  } catch (_) {
    return {
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable. Generation was stopped to protect your brand.',
      warnings: [],
    };
  }
}

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

  let source = 'template';
  let _estimated = true;
  let parsed = _templateReply(rating);
  if (raw) {
    try {
      parsed = JSON.parse(raw);
      source = 'openai';
      _estimated = false;
    } catch (e) { /* keep template */ }
  }

  const result = normalizeReviewReply(parsed, source);
  const gated = await _gateReply(req, tid, reviewReplyGateText(result), 'reviews:generate-reply');
  if (!gated.ok) {
    const status = gated.error === 'content_safety_unavailable' ? 503 : 403;
    return res.status(status).json(contentSafetyHttpBody(gated));
  }

  const warnings = gated.warnings || gated.content_safety_warnings || [];

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO review_reply_drafts (tenant_id, platform, reviewer_name, rating, review_text, ai_draft_reply, source_review_id, content_safety_warnings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [tid, platform, reviewer_name, rating, review_text, result.reply, source_review_id, JSON.stringify(warnings)]
  );

  const draft = ins.rows[0];
  draft.content_safety_warnings = _parseWarnings(draft.content_safety_warnings);
  res.json(attachContentSafetyWarnings({ ok: true, draft, _estimated }, warnings));
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
  const drafts = rows.rows.map((row) => ({
    ...row,
    content_safety_warnings: _parseWarnings(row.content_safety_warnings),
  }));
  res.json({ ok: true, drafts });
});

router.post('/replies/:id/approve', replyApproveLimiter, async (req, res) => {
  const tid = await _tid(req, 'reviews:approve-reply');
  if (!tid) return _err(res, 400, 'no_tenant');

  try {
    const p = await _db.getPool();
    const found = await p.query(
      `SELECT ai_draft_reply, status FROM review_reply_drafts WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid]);
    const draft = found.rows[0];
    if (!draft) return _err(res, 404, 'draft not found');
    if (draft.status !== 'pending') return _err(res, 409, 'Reply is no longer pending. Refresh the list.');
    // Older clients approve the stored copy; the editor submits its exact text.
    const reply = req.body?.ai_draft_reply === undefined ? draft.ai_draft_reply : req.body.ai_draft_reply;
    if (typeof reply !== 'string' || !reply.trim()) return _err(res, 400, 'Reply text is required.');
    if (reply.length > MAX_OUTPUT_SCAN_CHARS) {
      return res.status(403).json(contentSafetyHttpBody({error:'content_safety_blocked',
        userMessage:'This reply exceeds the safety scan limit. Shorten it before approval.'}));
    }
    const gated = await _gateReply(req, tid, reply, 'reviews:approve-reply');
    if (!gated.ok) {
      const unavailable = gated.error === 'content_safety_unavailable';
      return res.status(unavailable ? 503 : 403).json(contentSafetyHttpBody({...gated,
        userMessage: unavailable ? 'Content safety checks are temporarily unavailable. The reply was not approved. Try again.'
          : 'This reply did not pass content safety checks. Revise the reply before approval.'}));
    }
    const warnings = gated.warnings || gated.content_safety_warnings || [];
    // Compare-and-set prevents a concurrent dismissal/edit/approval from being
    // overwritten while the safety policy and scanner are running.
    const updated = await p.query(
      `UPDATE review_reply_drafts SET status='approved', ai_draft_reply=$3, content_safety_warnings=$4
       WHERE id=$1 AND tenant_id=$2 AND status='pending' AND ai_draft_reply IS NOT DISTINCT FROM $5
       RETURNING id`, [req.params.id, tid, reply, JSON.stringify(warnings), draft.ai_draft_reply]);
    if (!updated.rows.length) return _err(res, 409, 'Reply changed during approval. Refresh and review it again.');
    return res.json(attachContentSafetyWarnings({ok:true}, warnings));
  } catch (_) {
    return res.status(503).json({ok:false,error:'approval_unavailable',
      userMessage:'Reply approval is temporarily unavailable. Refresh the list before trying again.'});
  }
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

// Gate the entire retained save snapshot, including partial updates to older rules.
async function saveRequestRule(req, res) {
  const tid = await _tid(req, 'reviews:save-rule');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const p = await _db.getPool();
    let current = null;
    if (req.params.id) {
      const selected = await p.query('SELECT *, xmin::text AS save_version FROM review_request_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
      if (!selected.rows.length) return _err(res, 404, 'rule_not_found');
      current = selected.rows[0];
      // Disabling alone must remain available during safety outages. It cannot
      // change copy, enable delivery, or erase the stored safety warnings.
      if (req.body?.active === false && Object.keys(req.body).length === 1) {
        const disabled = await p.query('UPDATE review_request_rules SET active=false WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, tid]);
        if (!disabled.rows.length) return _err(res, 404, 'rule_not_found');
        return res.json({ ok: true, rule: disabled.rows[0] });
      }
    }
    const fields = ['name', 'trigger_type', 'channel', 'delay_hours', 'message_template', 'target_platform_url', 'active'];
    const defaults = { delay_hours: 24, message_template: '', target_platform_url: '', active: true };
    const snapshot = Object.fromEntries(fields.map(k => [k, Object.hasOwn(req.body || {}, k) ? req.body[k] : (current ? current[k] : defaults[k])]));
    if (['name', 'trigger_type', 'channel'].some(k => typeof snapshot[k] !== 'string' || !snapshot[k].trim()) ||
        ['message_template', 'target_platform_url'].some(k => snapshot[k] != null && typeof snapshot[k] !== 'string') ||
        !Number.isInteger(snapshot.delay_hours) || snapshot.delay_hours < 0 || snapshot.delay_hours > 2147483647 ||
        typeof snapshot.active !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'invalid_rule', userMessage: 'Enter a rule name, trigger, channel, text template and a valid non-negative delay.' });
    }
    const text = ['name', 'trigger_type', 'channel', 'message_template', 'target_platform_url'].map(k => snapshot[k] || '').join('\n');
    if (text.length > MAX_OUTPUT_SCAN_CHARS) {
      return res.status(403).json({ ok: false, error: 'content_safety_blocked', userMessage: 'Shorten the rule text to 100,000 characters or fewer before saving.' });
    }
    const gated = await gateRouteText({ tenantId: tid, userId: req.user?.id || null,
      surface: 'review_monitor', action: 'generate_content', text, label: 'reviews:save-rule' });
    if (!gated.ok) return res.status(gated.error === 'content_safety_unavailable' ? 503 : 403).json(contentSafetyHttpBody(gated));
    const values = fields.map(k => snapshot[k]);
    const warnings = JSON.stringify(gated.warnings || []);
    let saved;
    if (current) {
      // PostgreSQL row version prevents a concurrent edit/delete from being
      // overwritten while the selected snapshot is being checked.
      saved = await p.query(`UPDATE review_request_rules
        SET name=$1,trigger_type=$2,channel=$3,delay_hours=$4,message_template=$5,target_platform_url=$6,active=$7,content_safety_warnings=$8::jsonb
        WHERE id=$9 AND tenant_id=$10 AND xmin::text=$11 RETURNING *`,
      [...values, warnings, req.params.id, tid, current.save_version]);
      if (!saved.rows.length) return res.status(409).json({ ok: false, error: 'rule_changed', userMessage: 'This rule changed while saving. Refresh the rules and review it before retrying.' });
    } else {
      saved = await p.query(`INSERT INTO review_request_rules
        (name,trigger_type,channel,delay_hours,message_template,target_platform_url,active,content_safety_warnings,tenant_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`, [...values, warnings, tid]);
    }
    res.json({ ok: true, rule: saved.rows[0] });
  } catch (_) {
    res.status(503).json({ ok: false, error: 'rule_save_unavailable', userMessage: 'Could not confirm the save. Your text has been kept; refresh the rules before retrying.' });
  }
}
router.post('/request-rules', ruleSaveLimiter, saveRequestRule);
router.put('/request-rules/:id', ruleSaveLimiter, saveRequestRule);

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
