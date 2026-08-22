const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

async function _tid(req, label) { return await _tenantCtx.resolveTenantId(req, { label }); }

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[voiceover]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

const _eleven = require('./elevenlabs');
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const MODELS = ['tts-1', 'tts-1-hd'];
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'voiceovers');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function _hasOpenAI() {
  const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  return k && !/^_DUMMY/i.test(k);
}

router.get('/test', (req, res) => res.json({
  ok: true,
  openai: _hasOpenAI(),
  elevenlabs: _eleven.hasElevenLabs(),
  db: _db.hasDb && _db.hasDb(),
  voices: VOICES,
  models: MODELS,
  providers: ['openai', 'elevenlabs'],
}));

router.get('/elevenlabs/voices', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'voiceover:eleven-voices').catch(() => null);
  const key = await _eleven.resolveElevenKey(tid);
  if (!key) {
    return res.json({
      ok: true,
      configured: false,
      voices: [
        { id: _eleven.DEFAULT_VOICE_ID, name: 'Rachel (default)', category: 'premade' },
        { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', category: 'premade' },
        { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', category: 'premade' },
      ],
      note: 'Add ELEVENLABS_API_KEY in Platform APIs / Settings to load your library.',
    });
  }
  const voices = await _eleven.listVoices(key);
  res.json({ ok: true, configured: true, voices });
}));

// POST /api/voiceover/generate { text, voice='alloy', model='tts-1', label?, provider? }
router.post('/generate', _safeAsync(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const provider = String(req.body?.provider || 'openai').toLowerCase() === 'elevenlabs' ? 'elevenlabs' : 'openai';
  const voice = VOICES.includes(req.body?.voice) ? req.body.voice : 'alloy';
  const model = MODELS.includes(req.body?.model) ? req.body.model : 'tts-1';
  const elevenVoice = String(req.body?.eleven_voice_id || req.body?.voiceId || _eleven.DEFAULT_VOICE_ID).slice(0, 80);
  const label = String(req.body?.label || '').trim().slice(0, 200);

  if (!text) return _err(res, 400, 'text required');
  if (text.length > 4000 && provider === 'openai') return _err(res, 400, 'Text too long — TTS limit is 4000 characters per request.');
  if (text.length > 5000) return _err(res, 400, 'Text too long — ElevenLabs limit is 5000 characters per request.');

  let mp3Buffer;
  let usedVoice = voice;
  let usedModel = model;

  if (provider === 'elevenlabs') {
    const tidForKey = await _tid(req, 'voiceover:eleven-key').catch(() => null);
    const elevenKey = await _eleven.resolveElevenKey(tidForKey);
    if (!elevenKey) {
      return _err(res, 400, 'ElevenLabs API key required — add it in Settings → ElevenLabs.');
    }
    try {
      mp3Buffer = await _eleven.synthesize(text, elevenVoice, elevenKey);
      usedVoice = elevenVoice;
      usedModel = 'eleven_multilingual_v2';
    } catch (e) {
      const msg = e?.message || String(e);
      if (/401|unauthorized|invalid/i.test(msg)) return _err(res, 401, 'ElevenLabs API key invalid.');
      if (/quota|limit|402/i.test(msg)) return _err(res, 402, 'ElevenLabs quota exhausted.');
      return _err(res, 502, 'ElevenLabs TTS failed: ' + msg);
    }
  } else {
    if (!_hasOpenAI()) return _err(res, 400, 'OpenAI API key required for voiceover generation.');
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY });
    try {
      const resp = await client.audio.speech.create({ model, voice, input: text, response_format: 'mp3' });
      mp3Buffer = Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      const msg = e?.error?.message || e?.message || String(e);
      if (/quota|insufficient|billing/i.test(msg)) return _err(res, 402, 'OpenAI quota exhausted — check billing.');
      if (/invalid.*api.*key|unauthorized/i.test(msg)) return _err(res, 401, 'OpenAI API key invalid.');
      return _err(res, 502, 'OpenAI TTS failed: ' + msg);
    }
  }

  const id = crypto.randomBytes(12).toString('hex');
  const filename = `${Date.now()}_${id}.mp3`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(fullPath, mp3Buffer);
  const mp3Url = `/uploads/voiceovers/${filename}`;

  if (_db.hasDb && _db.hasDb()) {
    try {
      const tid = await _tid(req, 'voiceover:generate');
      await _db.getPool().query(
        `INSERT INTO voiceover_runs (tenant_id, label, voice, model, char_count, mp3_url) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, label || null, usedVoice, usedModel, text.length, mp3Url]
      );
    } catch (_) {}
  }

  res.json({
    ok: true,
    mp3Url,
    provider,
    voice: usedVoice,
    model: usedModel,
    charCount: text.length,
    sizeBytes: mp3Buffer.length,
  });
}));

// GET /api/voiceover/list — last 50
router.get('/list', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, items: [] });
  const tid = await _tid(req, 'voiceover:list');
  const r = await _db.getPool().query(
    `SELECT id, label, voice, model, char_count, mp3_url, created_at
       FROM voiceover_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [tid]
  );
  res.json({ ok: true, items: r.rows });
}));

module.exports = router;
