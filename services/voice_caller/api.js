// AI Voice Caller — Vapi.ai outbound voice agent integration.
// Pattern: POST /create-call uses an inline assistant config + a phone number
// owned by your Vapi account. POST /webhook receives end-of-call reports with
// transcript + structured data + outcome. All calls are persisted so the user
// can review the script, listen to the recording (Vapi-hosted URL) and see
// outcomes (booked|qualified|not-interested|callback|no-answer).
//
// Required Replit secrets:
//   VAPI_API_KEY            — from app.vapi.ai → API Keys
//   VAPI_PHONE_NUMBER_ID    — Vapi phone number UUID (caller ID)

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

async function _tid(req, label) { return await _tenantCtx.resolveTenantId(req, { label }); }

const VAPI = 'https://api.vapi.ai';
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

async function ensureVoiceSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS voice_calls (
      id              SERIAL PRIMARY KEY,
      vapi_call_id    TEXT UNIQUE,
      to_number       TEXT NOT NULL,
      lead_name       TEXT,
      goal            TEXT,                        -- e.g. 'qualify' | 'book-meeting' | 'win-back'
      script          TEXT,
      status          TEXT DEFAULT 'queued',       -- queued | ringing | in-progress | ended | failed
      outcome         TEXT,                        -- booked | qualified | not-interested | callback | no-answer
      duration_sec    INT,
      transcript      TEXT,
      summary         TEXT,
      structured_data JSONB,
      recording_url   TEXT,
      created_at      TIMESTAMPTZ DEFAULT now(),
      ended_at        TIMESTAMPTZ,
      direction       TEXT DEFAULT 'out'           -- 'out' (we called them) | 'in' (they called us)
    );
    -- Add column for existing installs that were created before direction was introduced
    DO $$ BEGIN
      ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'out';
    EXCEPTION WHEN others THEN NULL; END $$;
  `);
}
ensureVoiceSchema().catch(e => console.error('[voice-caller] schema:', e.message));

function _hasCreds() {
  return !!(process.env.VAPI_API_KEY && process.env.VAPI_PHONE_NUMBER_ID
            && !/^_DUMMY/i.test(process.env.VAPI_API_KEY));
}

router.get('/status', (_req, res) => {
  res.json({
    ok:true, configured: _hasCreds(),
    phoneNumberConfigured: !!process.env.VAPI_PHONE_NUMBER_ID,
  });
});

// ── Create outbound call ─────────────────────────────────────────────────────
router.post('/call', async (req, res) => {
  if (!_hasCreds()) return _err(res, 400, 'Vapi credentials missing — set VAPI_API_KEY and VAPI_PHONE_NUMBER_ID.');
  const { to, leadName = '', goal = 'qualify', script, voice = 'jennifer' } = req.body || {};
  if (!to) return _err(res, 400, 'to (E.164 phone, e.g. +27821234567) required');
  if (!script) return _err(res, 400, 'script required (the agent\'s opening + objectives)');

  const baseUrl = process.env.PUBLIC_URL || `https://${process.env.REPL_SLUG || 'app'}.replit.app`;
  const assistant = {
    name: `IG ${goal} agent`,
    firstMessage: `Hi${leadName ? ' ' + leadName : ''}, this is an automated call from InfoGenie. Do you have a quick minute?`,
    model: { provider:'openai', model:'gpt-4o-mini', messages: [
      { role:'system', content: `You are a friendly, concise voice agent calling on behalf of the user's business.
Goal of this call: ${goal}.
Script & objectives:
${script}

Rules:
• Keep responses under 2 sentences.
• If the prospect asks "is this a robot?" be honest: "I'm an AI assistant calling on behalf of [company]."
• If they're not interested, thank them and end the call gracefully.
• If they're interested, capture: best email, best callback time, and any specific need.
• End the call when the goal is met or after a clear no.` }
    ] },
    voice: { provider:'11labs', voiceId: voice },
    transcriber: { provider:'deepgram', model:'nova-2', language:'en' },
    serverUrl: `${baseUrl}/api/voice-caller/webhook`,
    endCallFunctionEnabled: true,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
  };

  try {
    const r = await fetch(`${VAPI}/call`, {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        assistant,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: { number: to, name: leadName || undefined },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || j.error || `Vapi ${r.status}`);
    if (_db.hasDb()) {
      await _db.getPool().query(
        `INSERT INTO voice_calls (vapi_call_id, to_number, lead_name, goal, script, status) VALUES ($1, $2, $3, $4, $5, 'queued')
         ON CONFLICT (vapi_call_id) DO NOTHING`,
        [j.id, to, leadName, goal, script]
      );
    }
    res.json({ ok:true, callId: j.id, status: j.status });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Webhook: end-of-call report ──────────────────────────────────────────────
// Vapi sends a shared secret in `x-vapi-secret` header (configurable in dashboard).
// We verify it matches VAPI_WEBHOOK_SECRET when set; otherwise allow (dev mode).
// ── Inbound assistant config — served to Vapi on incoming-call assistant-request
// Vapi posts {type:'assistant-request', call:{...}} when an inbound call rings
// the configured phone number. We respond with a JSON `{assistant: {...}}` body
// and Vapi loads that assistant for the call. Persist with kvSet so non-tech
// users can edit greeting/system-prompt/voice from the UI.
async function _getInboundConfig() {
  const cfg = await _db.kvGet('voice_inbound_config:default', null);
  return cfg || {
    enabled: false,
    greeting: 'Hi, thanks for calling. How can I help you today?',
    systemPrompt: 'You are a friendly receptionist. Answer questions about the business, take messages, and try to book a callback if the caller has a sales enquiry. Keep responses to one or two sentences.',
    voice: 'jennifer',
    knowledge: '',     // free-text FAQ / about page paste — included in system prompt
    forwardTo: '',     // optional E.164 number to bridge to a human
    notifyEmail: '',   // who gets the inbound-call summary email
  };
}

function _buildInboundAssistant(cfg) {
  const sys = `${cfg.systemPrompt}\n\nKnown information about the business (use this to answer factual questions):\n${cfg.knowledge || '(none provided)'}\n\nRules:\n• Keep responses under 2 sentences.\n• If the caller asks "is this a robot?" be honest: "I'm an AI assistant."\n• If you cannot help, take the caller's name + phone + reason for calling and tell them a human will follow up.\n• End the call when the request is resolved.`;
  return {
    name: 'IG inbound receptionist',
    firstMessage: cfg.greeting,
    model: { provider: 'openai', model: 'gpt-4o-mini', messages: [{ role: 'system', content: sys }] },
    voice: { provider: '11labs', voiceId: cfg.voice || 'jennifer' },
    transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en' },
    serverUrl: `${process.env.PUBLIC_URL || `https://${process.env.REPL_SLUG || 'app'}.replit.app`}/api/voice-caller/webhook`,
    endCallFunctionEnabled: true,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
  };
}

router.get('/inbound-config', async (_req, res) => {
  try { res.json({ ok: true, config: await _getInboundConfig() }); }
  catch (e) { _err(res, 500, e.message); }
});

router.post('/inbound-config', async (req, res) => {
  const cur = await _getInboundConfig();
  const next = { ...cur, ...(req.body || {}), updatedAt: new Date().toISOString() };
  await _db.kvSet('voice_inbound_config:default', next);
  res.json({ ok: true, config: next });
});

router.post('/webhook', express.json({ limit:'2mb' }), async (req, res) => {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (expected) {
    const supplied = String(req.headers['x-vapi-secret'] || req.headers['x-vapi-signature'] || '');
    if (supplied !== expected) { console.warn('[voice webhook] secret mismatch'); return res.status(401).end(); }
  }
  try {
    const msg = req.body?.message || req.body || {};
    const call = msg.call || {};
    const id = call.id;

    // ── INBOUND: Vapi asks us which assistant to use for an incoming call ───
    if (msg.type === 'assistant-request') {
      const cfg = await _getInboundConfig();
      if (!cfg.enabled) {
        // Politely refuse the call so Vapi can play a fallback / hang up
        return res.status(200).json({ error: 'Inbound calling is not enabled for this number.' });
      }
      // Pre-create a call record so the inbound shows up immediately in /calls
      if (id && _db.hasDb()) {
        const fromNumber = call.customer?.number || msg.phoneNumber?.number || 'unknown';
        await _db.getPool().query(
          `INSERT INTO voice_calls (vapi_call_id, to_number, lead_name, goal, status, direction)
           VALUES ($1, $2, $3, 'inbound-receptionist', 'in-progress', 'in')
           ON CONFLICT (vapi_call_id) DO NOTHING`,
          [id, fromNumber, '']
        );
      }
      return res.status(200).json({ assistant: _buildInboundAssistant(cfg) });
    }

    // All other event types: 200 ack and process async
    res.status(200).end();
    if (msg.type !== 'end-of-call-report' && msg.type !== 'status-update') return;
    if (!id) return;
    if (msg.type === 'status-update') {
      if (_db.hasDb()) await _db.getPool().query(`UPDATE voice_calls SET status=$1 WHERE vapi_call_id=$2`, [msg.status || 'in-progress', id]);
      return;
    }
    // end-of-call-report
    const dur     = call.endedAt && call.startedAt ? Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000) : null;
    const outcome = (msg.analysis?.successEvaluation || '').toLowerCase().includes('success') ? 'qualified'
                  : (call.endedReason === 'customer-did-not-give-microphone-permission' ? 'no-answer'
                  : (call.endedReason || 'ended'));
    if (_db.hasDb()) {
      // For inbound calls the row may already exist from assistant-request; if
      // not (older webhook only) UPSERT so nothing is dropped.
      await _db.getPool().query(
        `INSERT INTO voice_calls (vapi_call_id, to_number, status, direction)
         VALUES ($1, $2, 'ended', $3)
         ON CONFLICT (vapi_call_id) DO NOTHING`,
        [id, call.customer?.number || 'unknown', call.type === 'inboundPhoneCall' ? 'in' : 'out']
      );
      await _db.getPool().query(
        `UPDATE voice_calls SET status='ended', outcome=$1, duration_sec=$2, transcript=$3, summary=$4, structured_data=$5::jsonb, recording_url=$6, ended_at=now() WHERE vapi_call_id=$7`,
        [outcome, dur, msg.transcript || call.transcript || null, msg.summary || msg.analysis?.summary || null,
         JSON.stringify(msg.analysis?.structuredData || {}), msg.recordingUrl || call.recordingUrl || null, id]
      );
    }
  } catch (e) {
    console.error('[voice webhook]', e.message);
    if (!res.headersSent) res.status(200).end();
  }
});

router.get('/calls', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, calls: [] });
  try {
    const tid = await _tid(req, 'voice-caller:calls');
    const r = await _db.getPool().query(`SELECT id, vapi_call_id, to_number, lead_name, goal, status, outcome, duration_sec, summary, recording_url, created_at, ended_at, direction FROM voice_calls WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [tid]);
    res.json({ ok:true, calls: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/call/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 404, 'No DB');
  const tid = await _tid(req, 'voice-caller:call-get');
  const r = await _db.getPool().query(`SELECT * FROM voice_calls WHERE (id=$1 OR vapi_call_id=$1) AND tenant_id=$2 LIMIT 1`, [req.params.id, tid]);
  if (!r.rows[0]) return _err(res, 404, 'Not found');
  res.json({ ok:true, call: r.rows[0] });
});

module.exports = router;
