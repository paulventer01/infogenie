// ElevenLabs TTS provider helpers used by voiceover.
const https = require('https');

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel (public)

function _elevenKey() {
  return process.env.ELEVENLABS_API_KEY
    || process.env.ELEVEN_LABS_API_KEY
    || process.env.AI_INTEGRATIONS_ELEVENLABS_API_KEY
    || process.env.elevenlabs // hydrated from tenant vault aliases if present
    || '';
}

/** Prefer env, else tenant vault key from Settings → ElevenLabs. */
async function resolveElevenKey(tid) {
  const env = _elevenKey();
  if (env) return env;
  if (!tid) return '';
  try {
    const vault = require('../credentials/vault');
    const k = await vault.getApiKey(tid, 'elevenlabs');
    return k || '';
  } catch { return ''; }
}

function hasElevenLabs() {
  const k = _elevenKey();
  return !!(k && !/^_DUMMY/i.test(k));
}

function _req(method, path, body, headers = {}, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = body ? (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))) : null;
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path,
      method,
      headers: {
        'xi-api-key': apiKey || _elevenKey(),
        ...(payload && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          return reject(new Error(`ElevenLabs ${res.statusCode}: ${buf.toString('utf8').slice(0, 240)}`));
        }
        resolve({ status: res.statusCode, buf, contentType: res.headers['content-type'] || '' });
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('ElevenLabs timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function listVoices(apiKey) {
  const r = await _req('GET', '/v1/voices', null, {}, apiKey);
  const json = JSON.parse(r.buf.toString('utf8'));
  return (json.voices || []).slice(0, 40).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category || 'premade',
    preview_url: v.preview_url || null,
  }));
}

async function synthesize(text, voiceId, apiKey) {
  const vid = voiceId || DEFAULT_VOICE_ID;
  const r = await _req(
    'POST',
    `/v1/text-to-speech/${encodeURIComponent(vid)}`,
    {
      text: String(text).slice(0, 5000),
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.75 },
    },
    { Accept: 'audio/mpeg' },
    apiKey
  );
  return r.buf;
}

module.exports = { hasElevenLabs, listVoices, synthesize, DEFAULT_VOICE_ID, resolveElevenKey, _elevenKey };
