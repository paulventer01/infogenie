const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { normalizeChatParams } = require('../ai_compat');
const {
  gateRouteText,
  contentSafetyHttpBody,
  attachContentSafetyWarnings,
} = require('../ai_governance/route_gate');
const {
  normalizeComposerDraft,
  composerDraftGateText,
} = require('../ai_governance/content_schemas');
const { createRateLimiter } = require('../security/rate_limit');

const router = express.Router();

function _testOnlyMax(envName, fallback) {
  if (process.env.NODE_ENV !== 'test') return fallback;
  const n = Number.parseInt(String(process.env[envName] || ''), 10);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

const COMPOSER_DRAFT_UPDATE_MAX = _testOnlyMax('CAMPAIGN_COMPOSER_DRAFT_UPDATE_RATE_LIMIT_MAX', 30);
const COMPOSER_DRAFT_APPROVE_MAX = _testOnlyMax('CAMPAIGN_COMPOSER_DRAFT_APPROVE_RATE_LIMIT_MAX', 10);

const composerDraftUpdateLimiter = createRateLimiter({
  name: 'campaign-composer-draft-update',
  windowMs: 60_000,
  max: COMPOSER_DRAFT_UPDATE_MAX,
  failClosed: true,
  keyFn: (req) => {
    const tid = req.tenant?.id;
    const uid = req.user?.id;
    if (tid != null && uid != null) return `campaign-composer|${tid}|${uid}`;
    return null;
  },
});

const composerDraftApproveLimiter = createRateLimiter({
  name: 'campaign-composer-draft-approve',
  windowMs: 60_000,
  max: COMPOSER_DRAFT_APPROVE_MAX,
  failClosed: true,
  keyFn: (req) => {
    const tid = req.tenant?.id;
    const uid = req.user?.id;
    if (tid != null && uid != null) return `campaign-composer-approve|${tid}|${uid}`;
    return null;
  },
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

async function _gateDraft(req, tid, draft, label) {
  try {
    return await gateRouteText({
      tenantId: tid,
      userId: req.user?.id || null,
      surface: 'campaign_composer',
      action: 'generate_content',
      text: composerDraftGateText(draft),
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

function _callOpenAI(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const raw = normalizeChatParams({
    model: 'gpt-4o',
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: opts.max_tokens || 2000,
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
    req.setTimeout(60000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

const COMPOSER_SYSTEM = `You are a marketing campaign strategist. Turn a brief prompt into a structured campaign draft.
Return strict JSON:
{
  "campaign_name": "...",
  "audience_description": "...",
  "audience_rules": {
    "match": "all",
    "conditions": [
      { "type": "trait", "field": "status", "op": "equals", "value": "..." }
    ]
  },
  "channel": "email|sms|whatsapp",
  "subject": "...",
  "body": "...",
  "recommended_send_time": "...",
  "rationale": "..."
}
The audience_rules MUST follow the services/audiences schema:
- match: "all" | "any" | "none"
- conditions: array of { type, field, op, value, days? }
Common types: trait, event, metric. Common ops: equals, not_equals, greater_than, less_than, contains, starts_with, ends_with, exists, not_exists.`;

function _templateDraft(prompt) {
  return normalizeComposerDraft({
    campaign_name: "New Campaign from Prompt",
    audience_description: "Target audience based on your prompt",
    audience_rules: { match: "all", conditions: [] },
    channel: "email",
    subject: "Special offer for you",
    body: "Hi there, we have something special for you based on your recent interest.",
    recommended_send_time: "Tuesday at 10:00 AM",
    rationale: "This is a generic template because AI integration is not configured.",
    _estimated: true,
  }, 'template');
}

router.post('/generate', async (req, res) => {
  try {
    const tid = await _tid(req, 'campaign-composer:generate');
    const { prompt } = req.body || {};
    if (!prompt) return _err(res, 400, 'prompt required');

    const raw = await _callOpenAI([
      { role: 'system', content: COMPOSER_SYSTEM },
      { role: 'user', content: `Brief: ${prompt}` }
    ]);

    let draft = _templateDraft(prompt);
    let source = 'template';
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.campaign_name) {
          draft = normalizeComposerDraft(parsed, 'openai');
          source = 'openai';
        }
      } catch (e) {}
    }
    draft.source = source;

    const gated = await _gateDraft(req, tid, draft, 'campaign-composer:generate');
    if (!gated.ok) {
      const status = gated.error === 'content_safety_unavailable' ? 503 : 403;
      return res.status(status).json(contentSafetyHttpBody(gated));
    }

    const warnings = gated.warnings || gated.content_safety_warnings || [];
    const p = _db.getPool();
    const result = await p.query(
      `INSERT INTO campaign_composer_drafts (tenant_id, prompt, draft, content_safety_warnings)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tid, prompt, JSON.stringify(draft), JSON.stringify(warnings)]
    );

    const row = result.rows[0];
    row.content_safety_warnings = _parseWarnings(row.content_safety_warnings);
    res.json(attachContentSafetyWarnings({ ok: true, draft: row }, warnings));
  } catch (err) { _err(res, 500, err.message); }
});

router.get('/drafts', async (req, res) => {
  try {
    const tid = await _tid(req, 'campaign-composer:list');
    const p = _db.getPool();
    const result = await p.query(
      `SELECT * FROM campaign_composer_drafts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [tid]
    );
    const drafts = result.rows.map((row) => ({
      ...row,
      content_safety_warnings: _parseWarnings(row.content_safety_warnings),
    }));
    res.json({ ok: true, drafts });
  } catch (err) { _err(res, 500, err.message); }
});

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.put('/drafts/:id', composerDraftUpdateLimiter, async (req, res) => {
  try {
    const tid = await _tid(req, 'campaign-composer:update');
    const id = parseInt(req.params.id, 10);
    const { draft } = req.body || {};
    if (!draft) return _err(res, 400, 'draft data required');

    const p = _db.getPool();
    const existing = await p.query(
      `SELECT * FROM campaign_composer_drafts WHERE id = $1 AND tenant_id = $2 AND status = 'draft'`,
      [id, tid]
    );
    if (!existing.rows.length) return _err(res, 404, 'draft not found or not editable');

    const normalized = normalizeComposerDraft(draft, draft.source || 'template');
    const gated = await _gateDraft(req, tid, normalized, 'campaign-composer:update');
    if (!gated.ok) {
      const status = gated.error === 'content_safety_unavailable' ? 503 : 403;
      return res.status(status).json(contentSafetyHttpBody(gated));
    }

    const warnings = gated.warnings || gated.content_safety_warnings || [];
    const result = await p.query(
      `UPDATE campaign_composer_drafts SET draft = $1, content_safety_warnings = $2, updated_at = now()
       WHERE id = $3 AND tenant_id = $4 AND status = 'draft' RETURNING *`,
      [JSON.stringify(normalized), JSON.stringify(warnings), id, tid]
    );

    if (!result.rows.length) return _err(res, 404, 'draft not found or not editable');
    const row = result.rows[0];
    row.content_safety_warnings = _parseWarnings(row.content_safety_warnings);
    res.json(attachContentSafetyWarnings({ ok: true, draft: row }, warnings));
  } catch (err) { _err(res, 500, err.message); }
});

// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id
router.post('/drafts/:id/approve', composerDraftApproveLimiter, async (req, res) => {
  const p = _db.getPool();
  const client = await p.connect();
  try {
    const tid = await _tid(req, 'campaign-composer:approve');
    const id = parseInt(req.params.id, 10);

    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT * FROM campaign_composer_drafts WHERE id = $1 AND tenant_id = $2 AND status = 'draft' FOR UPDATE`,
      [id, tid]
    );
    if (!locked.rows.length) {
      await client.query('ROLLBACK');
      const existing = await p.query(
        `SELECT * FROM campaign_composer_drafts WHERE id = $1 AND tenant_id = $2`,
        [id, tid]
      );
      if (existing.rows.length && existing.rows[0].status !== 'draft') {
        const row = existing.rows[0];
        row.content_safety_warnings = _parseWarnings(row.content_safety_warnings);
        return res.status(409).json({ ok: false, error: 'already_approved', draft: row, segment_id: row.segment_id });
      }
      return _err(res, 404, 'draft not found or not approvable');
    }

    const row = locked.rows[0];
    const draft = normalizeComposerDraft(row.draft, row.draft?.source || 'template');
    const gated = await _gateDraft(req, tid, draft, 'campaign-composer:approve');
    if (!gated.ok) {
      await client.query('ROLLBACK');
      const status = gated.error === 'content_safety_unavailable' ? 503 : 403;
      return res.status(status).json(contentSafetyHttpBody(gated));
    }

    const warnings = gated.warnings || gated.content_safety_warnings || [];
    const segResult = await client.query(
      `INSERT INTO audience_segments (tenant_id, name, description, rules) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tid, draft.campaign_name || 'Composer Segment', draft.audience_description || '', JSON.stringify(draft.audience_rules || { match: 'all', conditions: [] })]
    );
    const segmentId = segResult.rows[0].id;

    const updateResult = await client.query(
      `UPDATE campaign_composer_drafts SET status = 'approved', segment_id = $1, content_safety_warnings = $2, updated_at = now()
       WHERE id = $3 AND tenant_id = $4 AND status = 'draft' RETURNING *`,
      [segmentId, JSON.stringify(warnings), id, tid]
    );
    if (!updateResult.rows.length) {
      await client.query('ROLLBACK');
      return _err(res, 409, 'already approved or launched');
    }

    await client.query('COMMIT');

    try {
      const { governSafe } = require('../ai_governance/hooks');
      await governSafe({
        tenantId: tid,
        userId: req.user?.id || null,
        surface: 'campaign_composer',
        action: 'launch_campaign',
        payload: {
          title: draft.campaign_name || 'Campaign composer draft',
          preview: composerDraftGateText(draft).slice(0, 500),
          draftId: id,
          hasContext: true,
        },
      });
    } catch (e) {
      console.warn('[campaign-composer] governance audit failed open:', e.message);
    }

    const out = updateResult.rows[0];
    out.content_safety_warnings = _parseWarnings(out.content_safety_warnings);
    res.json(attachContentSafetyWarnings({ ok: true, draft: out, segment_id: segmentId }, warnings));
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    _err(res, 500, err.message);
  } finally {
    client.release();
  }
});

module.exports = router;
