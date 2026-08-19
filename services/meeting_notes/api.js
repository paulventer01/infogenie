const express = require('express');
const router = express.Router();
const _https = require('https');
const _crypto = require('node:crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[meeting-notes]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _generatedBy(req) {
  if (!req.session) return null;
  if (req.session.userId) return String(req.session.userId);
  if (req.session.email) return String(req.session.email);
  return null;
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

router.get('/test', (req, res) => res.json({ ok:true, openai: _hasOpenAI() }));

router.post('/summarize', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'meeting-notes:summarize' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const transcript = String(req.body?.transcript || '').trim();
  const contact = req.body?.contact || null;
  if (!transcript) return _err(res, 400, 'transcript required');
  if (transcript.length < 50) return _err(res, 400, 'transcript too short — minimum 50 chars');
  if (!_hasOpenAI()) return _err(res, 400, 'OPENAI_API_KEY required');
  const result = await _summarize(transcript, contact);
  if (!result) return _err(res, 502, 'AI summarization failed — try again');

  let noteId = null;
  if (_db.hasDb()) {
    try {
      const contactObj = contact && typeof contact === 'object' ? contact : {};
      const excerpt = transcript.slice(0, 500);
      const sha = _crypto.createHash('sha256').update(transcript).digest('hex');
      const r = await _db.getPool().query(
        `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, transcript_sha256, source, generated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tid, JSON.stringify(contactObj), JSON.stringify(result), excerpt, sha, 'ai', _generatedBy(req)]
      );
      noteId = r.rows[0].id;
    } catch (e) { console.warn('[meeting-notes] persist failed:', e.message); }
  }

  res.json({ ok:true, summary: result, id: noteId });
}));

router.get('/history', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'meeting-notes:history' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok:true, notes: [] });
  const r = await _db.getPool().query(
    `SELECT id, contact, summary, source, created_at FROM meeting_notes_runs
     WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [tid]
  );
  res.json({ ok:true, notes: r.rows });
}));

router.get('/:id', _safeAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'meeting-notes:get' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb() || !Number.isInteger(id) || id <= 0) return _err(res, 404, 'not found');
  // Same column list as /history: transcript_excerpt, transcript_sha256,
  // generated_by and tenant_id stay server-side — the panel never needs them and
  // the excerpt holds raw call content.
  const r = await _db.getPool().query(
    `SELECT id, contact, summary, source, created_at FROM meeting_notes_runs
     WHERE id=$1 AND tenant_id=$2`,
    [id, tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'not found');
  res.json({ ok:true, note: r.rows[0] });
}));

module.exports = router;
