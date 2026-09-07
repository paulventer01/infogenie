// AI Video — Runway + HeyGen generation hub (API-key driven with offline storyboard fallback).
const express = require('express');
const https = require('https');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

function _key(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && !/^_DUMMY/i.test(v)) return v;
  }
  return '';
}

async function _vaultKey(tid, platform) {
  if (!tid) return '';
  try {
    const vault = require('../credentials/vault');
    return (await vault.getApiKey(tid, platform)) || '';
  } catch {
    return '';
  }
}

function _httpsJson(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname, path, method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        try {
          const json = d ? JSON.parse(d) : {};
          if (r.statusCode >= 400) return reject(new Error(`${hostname} ${r.statusCode}: ${d.slice(0, 220)}`));
          resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function _storyboard(prompt, brand, duration = 20) {
  const scenes = Math.max(3, Math.min(6, Math.round(duration / 5)));
  const out = [];
  for (let i = 0; i < scenes; i++) {
    out.push({
      scene: i + 1,
      duration_s: Math.round(duration / scenes),
      shot: ['Hook close-up', 'Product in context', 'Social proof', 'Feature detail', 'Lifestyle', 'CTA card'][i] || 'B-roll',
      action: `Scene ${i + 1} for ${brand || 'brand'}: ${prompt.slice(0, 80)}`,
      voiceover: i === 0 ? `Meet ${brand || 'us'}` : i === scenes - 1 ? 'Get started today' : prompt.slice(0, 60),
      text_overlay: i === scenes - 1 ? 'Shop now' : `Beat ${i + 1}`,
    });
  }
  return out;
}

router.get('/status', async (req, res) => {
  const tid = await _tid(req, 'ai-video:status').catch(() => null);
  const [runwayV, heygenV] = await Promise.all([
    _vaultKey(tid, 'runway'),
    _vaultKey(tid, 'heygen'),
  ]);
  res.json({
    ok: true,
    runway: !!( _key('RUNWAY_API_KEY', 'RUNWAYML_API_SECRET') || runwayV ),
    heygen: !!( _key('HEYGEN_API_KEY') || heygenV ),
    note: 'Without keys, InfoGenie returns an executable storyboard you can send to creators or Canva.',
  });
});

router.post('/generate', async (req, res) => {
  try {
    const tid = await _tid(req, 'ai-video:generate');
    const provider = String(req.body?.provider || 'auto').toLowerCase();
    const prompt = String(req.body?.prompt || req.body?.script || '').trim();
    const brand = String(req.body?.brand || '').trim().slice(0, 80);
    const duration = Math.min(Math.max(Number(req.body?.duration_seconds) || 20, 8), 60);
    const avatarId = String(req.body?.avatar_id || '').trim();
    if (!prompt) return _err(res, 400, 'prompt required');

    const runwayKey = _key('RUNWAY_API_KEY', 'RUNWAYML_API_SECRET') || await _vaultKey(tid, 'runway');
    const heygenKey = _key('HEYGEN_API_KEY') || await _vaultKey(tid, 'heygen');
    const prefer = provider === 'runway' ? 'runway' : provider === 'heygen' ? 'heygen'
      : heygenKey ? 'heygen' : runwayKey ? 'runway' : 'storyboard';

    if (prefer === 'heygen' && heygenKey) {
      try {
        // HeyGen v2 video generate (best-effort; schema varies by plan).
        const payload = {
          video_inputs: [{
            character: avatarId ? { type: 'avatar', avatar_id: avatarId } : { type: 'avatar', avatar_id: 'default' },
            voice: { type: 'text', input_text: prompt.slice(0, 1000) },
          }],
          dimension: { width: 1080, height: 1920 },
          test: true,
        };
        const json = await _httpsJson('api.heygen.com', '/v2/video/generate', 'POST', {
          'X-Api-Key': heygenKey,
        }, payload);
        return res.json({
          ok: true,
          provider: 'heygen',
          status: 'submitted',
          job: json,
          storyboard: _storyboard(prompt, brand, duration),
        });
      } catch (e) {
        // Fall through to storyboard with warning
        return res.json({
          ok: true,
          provider: 'heygen',
          status: 'fallback_storyboard',
          warning: e.message,
          storyboard: _storyboard(prompt, brand, duration),
        });
      }
    }

    if (prefer === 'runway' && runwayKey) {
      try {
        const json = await _httpsJson('api.dev.runwayml.com', '/v1/image_to_video', 'POST', {
          Authorization: `Bearer ${runwayKey}`,
          'X-Runway-Version': '2024-11-06',
        }, {
          promptText: prompt.slice(0, 500),
          model: 'gen3a_turbo',
          duration: Math.min(duration, 10),
          ratio: '768:1280',
        });
        return res.json({
          ok: true,
          provider: 'runway',
          status: 'submitted',
          job: json,
          storyboard: _storyboard(prompt, brand, duration),
        });
      } catch (e) {
        return res.json({
          ok: true,
          provider: 'runway',
          status: 'fallback_storyboard',
          warning: e.message,
          storyboard: _storyboard(prompt, brand, duration),
        });
      }
    }

    res.json({
      ok: true,
      provider: 'storyboard',
      status: 'ready',
      storyboard: _storyboard(prompt, brand, duration),
      next_steps: [
        'Add RUNWAY_API_KEY or HEYGEN_API_KEY in Settings to render video automatically.',
        'Or paste this storyboard into Canva / Creator Studio.',
        'Generate voiceover in AI Voiceovers (ElevenLabs or OpenAI).',
      ],
    });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
