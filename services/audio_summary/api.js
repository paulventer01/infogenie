const express = require('express');
const _https  = require('https');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router  = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'voiceovers');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

function _hasOpenAI() {
  const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  return k && !/^_DUMMY/i.test(k);
}

// ── Summarise to ~250 words for ~2 min audio ─────────────────────────────
async function _summariseForAudio(title, text) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const body = JSON.stringify({
    model: 'gpt-5-mini',
    messages: [{
      role: 'system',
      content: `You are a podcast script writer. Convert the provided article into a natural spoken-word audio summary of approximately 250-300 words. 
Write in first-person conversational style, as if a host is introducing the article.
Structure: (1) Hook sentence, (2) main 2-3 key points from the article, (3) brief takeaway.
No markdown, no headings, no bullet points — just flowing spoken prose.
Keep it warm, engaging, and useful to someone who has 90 seconds to listen.`,
    }, {
      role: 'user',
      content: `Article title: "${title || 'Article Summary'}"\n\nArticle content:\n${text.slice(0, 4000)}\n\nWrite the audio summary now.`,
    }],
    temperature: 0.7, max_tokens: 500,
  });
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { if (r.statusCode !== 200) return resolve(null); resolve(JSON.parse(d).choices[0].message.content.trim()); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── Generate TTS via OpenAI ───────────────────────────────────────────────
async function _tts(scriptText, voice) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API key required');
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: key });
  const resp = await client.audio.speech.create({ model: 'tts-1', voice, input: scriptText, response_format: 'mp3' });
  return Buffer.from(await resp.arrayBuffer());
}

const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

// POST /generate { title, text, voice? }
router.post('/generate', async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 300);
  const text  = String(req.body?.text  || '').trim();
  const voice = VALID_VOICES.includes(req.body?.voice) ? req.body.voice : 'nova';

  if (!text || text.length < 50) return _err(res, 400, 'text required (min 50 characters)');
  if (!_hasOpenAI()) return _err(res, 400, 'OpenAI API key required for audio summaries');

  // Step 1 — summarise to spoken prose
  let script = await _summariseForAudio(title, text);
  if (!script) {
    // Fallback: use first 600 chars of article as script
    script = (title ? `${title}. ` : '') + text.replace(/[#*_[\]]/g, '').slice(0, 600);
  }

  // Step 2 — TTS
  let mp3Buffer;
  try {
    mp3Buffer = await _tts(script, voice);
  } catch (e) {
    const msg = e?.error?.message || e?.message || String(e);
    if (/quota|insufficient|billing/i.test(msg)) return _err(res, 402, 'OpenAI quota exhausted');
    return _err(res, 502, 'TTS failed: ' + msg);
  }

  const id       = crypto.randomBytes(12).toString('hex');
  const filename = `${Date.now()}_${id}.mp3`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(fullPath, mp3Buffer);
  const mp3Url = `/uploads/voiceovers/${filename}`;

  // Persist in voiceover_runs so it appears in voiceover history
  if (_db.hasDb && _db.hasDb()) {
    try {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'audio_summary:generate' });
      await _db.getPool().query(
        `INSERT INTO voiceover_runs (tenant_id, label, voice, model, char_count, mp3_url)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, (title ? '🎧 ' + title.slice(0, 180) : '🎧 Audio Summary'), voice, 'tts-1', script.length, mp3Url]
      );
    } catch (_) {}
  }

  res.json({ ok: true, mp3Url, voice, script, charCount: script.length, sizeBytes: mp3Buffer.length });
});

module.exports = router;
