const express = require('express');
const router = express.Router();
const _https = require('https');
const _crypto = require('node:crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const _vault = require('../credentials/vault');
const _runtimeFlags = require('../runtime_flags');

const CONTACT_KEYS = ['name', 'company', 'role'];
const CONTACT_MAX = 200;
const EXCERPT_MAX = 500;
const SWEEP_MS = 6 * 3600 * 1000;

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(() => { console.warn('[meeting-notes] query failed'); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _generatedBy(req) {
  if (!req.session || req.session.userId == null || req.session.userId === '') return null;
  return String(req.session.userId);
}

function _whitelistedContact(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of CONTACT_KEYS) {
    if (typeof raw[key] !== 'string') continue;
    const s = raw[key].slice(0, CONTACT_MAX);
    if (s) out[key] = s;
  }
  return out;
}

function _aad(tid) {
  return `meeting_notes_runs:tenant:${tid}`;
}

function _presentNote(row, tid) {
  let summary = row.summary;
  if (row.summary_ciphertext) {
    try {
      const txt = _vault.decryptString(row.summary_ciphertext, row.summary_iv, row.summary_tag, _aad(tid));
      summary = JSON.parse(txt);
    } catch {
      console.warn('[meeting-notes] decrypt failed');
      summary = {};
    }
  }
  return {
    id: row.id,
    // Whitelisted again on read: rows written before the write-side whitelist
    // can hold email/phone/free-text keys straight from the request body.
    contact: _whitelistedContact(row.contact),
    summary,
    source: row.source,
    created_at: row.created_at,
  };
}

async function _summarize(transcript, contactInfo) {
  if (!_hasOpenAI()) return null;
  const sys = 'You are a senior B2B sales analyst. Summarize sales-call transcripts and score BANT (Budget, Authority, Need, Timeline). Strict JSON only.';
  const user = `Transcript:
"""
${String(transcript).slice(0, 12000)}
"""
${contactInfo ? `\nContact context: ${JSON.stringify(contactInfo)}` : ''}

Reply strict JSON only:
{
  "summary": "3-5 sentence executive summary",
  "key_points": ["bullet 1", "bullet 2", ...],
  "action_items": [{"owner":"Sales|Prospect","task":"...","due":"YYYY-MM-DD or ASAP"}],
  "bant": {
    "budget": {"score":0-10,"evidence":"..."},
    "authority": {"score":0-10,"evidence":"..."},
    "need": {"score":0-10,"evidence":"..."},
    "timeline": {"score":0-10,"evidence":"..."}
  },
  "overall_score": 0-100,
  "deal_stage": "discovery|qualification|proposal|negotiation|closed_won|closed_lost",
  "sentiment": "positive|neutral|negative",
  "risks": ["risk 1", "risk 2"],
  "next_step": "concrete next action with date if possible",
  "objections_raised": ["objection 1", ...]
}`;
  return await new Promise(resolve => {
    const body = JSON.stringify({
      model:'gpt-5-mini', temperature:0.2, max_tokens:2000,
      response_format:{ type:'json_object' },
      messages:[{ role:'system', content: sys }, { role:'user', content: user }]
    });
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content;
          if (!txt) return resolve(null);
          resolve(JSON.parse(txt));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(45000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

async function sweepExpiredExcerpts() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  const tenants = await p.query(
    `SELECT DISTINCT tenant_id FROM meeting_notes_runs ORDER BY tenant_id`
  );
  let total = 0;
  for (const t of tenants.rows) {
    const r = await p.query(
      `UPDATE meeting_notes_runs SET transcript_excerpt=NULL, excerpt_ciphertext=NULL, excerpt_iv=NULL, excerpt_tag=NULL, transcript_purged_at=COALESCE(transcript_purged_at, now()) WHERE tenant_id=$1 AND excerpt_expires_at IS NOT NULL AND excerpt_expires_at < now() AND (transcript_excerpt IS NOT NULL OR excerpt_ciphertext IS NOT NULL)`,
      [t.tenant_id]
    );
    total += r.rowCount || 0;
  }
  console.log(`[meeting-notes] swept ${total} expired excerpts`);
}

if (_runtimeFlags.backgroundEnabled()) {
  setInterval(() => { sweepExpiredExcerpts().catch(() => {}); }, SWEEP_MS);
}

router.get('/test', (req, res) => res.json({ ok:true, openai: _hasOpenAI() }));

router.post('/summarize', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'meeting-notes:summarize' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const transcript = String(req.body?.transcript || '').trim();
  const contact = req.body?.contact || null;
  if (!transcript) return _err(res, 400, 'transcript required');
  if (transcript.length < 50) return _err(res, 400, 'transcript too short — minimum 50 chars');
  if (!_hasOpenAI()) return _err(res, 400, 'OPENAI_API_KEY required');
  // Only the whitelisted contact keys leave this process — to OpenAI as well as
  // to the row. The request body may carry email/phone/free-text notes, and the
  // prompt is the wider exposure of the two. The transcript body itself is still
  // sent unredacted; see docs/security-guardrails.md.
  const contactObj = _whitelistedContact(contact);
  const result = await _summarize(transcript, Object.keys(contactObj).length ? contactObj : null);
  if (!result) return _err(res, 502, 'AI summarization failed — try again');

  let noteId = null;
  if (_db.hasDb()) {
    try {
      const excerpt = transcript.slice(0, EXCERPT_MAX);
      const sha = _crypto.createHash('sha256').update(transcript).digest('hex');
      const generatedBy = _generatedBy(req);
      if (_vault.hasKey()) {
        const aad = _aad(tid);
        const ex = _vault.encryptString(excerpt, aad);
        const sum = _vault.encryptString(JSON.stringify(result), aad);
        const r = await _db.getPool().query(
          `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, transcript_sha256, source, generated_by, excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at, summary_ciphertext, summary_iv, summary_tag)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + interval '30 days',$11,$12,$13) RETURNING id`,
          [
            tid, JSON.stringify(contactObj), JSON.stringify({}), null, sha, 'ai', generatedBy,
            ex.ciphertext, ex.iv, ex.tag,
            sum.ciphertext, sum.iv, sum.tag,
          ]
        );
        noteId = r.rows[0].id;
      } else {
        const r = await _db.getPool().query(
          `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, transcript_sha256, source, generated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [tid, JSON.stringify(contactObj), JSON.stringify(result), null, sha, 'ai', generatedBy]
        );
        noteId = r.rows[0].id;
      }
    } catch { console.warn('[meeting-notes] persist failed'); }
  }

  res.json({ ok:true, summary: result, id: noteId });
}));

router.get('/history', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'meeting-notes:history' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok:true, notes: [] });
  const r = await _db.getPool().query(
    `SELECT id, contact, summary, source, created_at, summary_ciphertext, summary_iv, summary_tag FROM meeting_notes_runs
     WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [tid]
  );
  res.json({ ok:true, notes: r.rows.map(row => _presentNote(row, tid)) });
}));

router.get('/:id', _safeAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'meeting-notes:get' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb() || !Number.isInteger(id) || id <= 0) return _err(res, 404, 'not found');
  // Cipher columns are selected only so decrypt-on-read can rebuild the summary.
  // They are stripped before res.json. Excerpt ciphertext is never decrypted.
  const r = await _db.getPool().query(
    `SELECT id, contact, summary, source, created_at, summary_ciphertext, summary_iv, summary_tag FROM meeting_notes_runs
     WHERE id=$1 AND tenant_id=$2`,
    [id, tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'not found');
  res.json({ ok:true, note: _presentNote(r.rows[0], tid) });
}));

module.exports = router;
module.exports.sweepExpiredExcerpts = sweepExpiredExcerpts;
