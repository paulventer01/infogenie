// Creator Studio — single module housing 5 user-facing tiers:
//   • Brand Identity Suite  (logo brief / palette / business name / slogan)
//   • Image Toolkit         (background remove / upscale / sketch→image / product photo)
//   • AI Video Generator    (15-sec ad storyboard spec for video-js)
//   • AI Presentation       (outline + slides spec)
//   • Email Signature       (HTML signature with optional click tracking)
//
// All tiers persist to kv_store (no extra schema needed). Heavy media work is
// delegated to the existing Cloudflare Workers AI account; OpenAI handles
// strict-JSON brief generation. Unconfigured providers degrade gracefully.

const express = require('express');
const OpenAI  = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const router  = express.Router();
const _db     = require('../../db');

const _openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
const _anthropicKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
const HAS_OPENAI    = !!_openaiKey    && !/^_?DUMMY/i.test(_openaiKey);
const HAS_ANTHROPIC = !!_anthropicKey && !/^_?DUMMY/i.test(_anthropicKey);
const HAS_GEMINI    = !!process.env.GEMINI_API_KEY     && !/^_?DUMMY/i.test(process.env.GEMINI_API_KEY);
const HAS_PERPLEX   = !!process.env.PERPLEXITY_API_KEY && !/^_?DUMMY/i.test(process.env.PERPLEXITY_API_KEY);
const CF_ID    = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_AI_TOKEN;
const HAS_CF   = !!(CF_ID && CF_TOKEN) && !/^_?DUMMY/i.test(CF_TOKEN);

const openai    = new OpenAI({ apiKey: _openaiKey || 'dummy' });
const anthropic = HAS_ANTHROPIC ? new (Anthropic.default || Anthropic)({ apiKey: _anthropicKey }) : null;

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

// Strip code fences / prose around a JSON payload and parse.
function _extractJSON(text){
  if (!text) throw new Error('empty AI response');
  let s = String(text).trim();
  // Strip ```json fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/,'').trim();
  // Find outermost {...}
  const first = s.indexOf('{'); const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last+1);
  return JSON.parse(s);
}

// Real multi-provider JSON LLM. Tries OpenAI → Anthropic → Gemini → Perplexity →
// Cloudflare Llama in order. Throws ONLY when every configured provider fails or
// when no provider key is configured. No dummy/placeholder fallback ever.
async function _ai(prompt, opts = {}) {
  let brandCtx = '';
  try { const bf = require('../brand_foundation/api'); if (bf.getBrandContextBlock) brandCtx = await bf.getBrandContextBlock(); } catch {}
  const sys = (brandCtx ? brandCtx + '\n\n' : '') + (opts.system || 'You are a senior brand strategist. Respond with strict JSON only — no prose, no markdown, no code fences.');
  const temperature = opts.temperature ?? 0.8;
  const max_tokens = opts.max_tokens || 900;
  const errors = [];

  if (HAS_OPENAI) {
    try {
      const r = await openai.chat.completions.create({
        model: opts.model || 'gpt-4o-mini',
        messages: [{ role:'system', content: sys }, { role:'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature, max_tokens,
      });
      return _extractJSON(r.choices[0].message.content);
    } catch (e) { errors.push('openai: ' + (e.message||e).toString().slice(0,140)); }
  }
  if (HAS_ANTHROPIC) {
    try {
      const r = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens, temperature,
        system: sys,
        messages: [{ role:'user', content: prompt + '\n\nRespond with strict JSON only — no prose, no fences.' }]
      });
      const txt = (r.content || []).map(c => c.text || '').join('');
      return _extractJSON(txt);
    } catch (e) { errors.push('anthropic: ' + (e.message||e).toString().slice(0,140)); }
  }
  if (HAS_GEMINI) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          systemInstruction:{ parts:[{ text: sys }] },
          contents:[{ parts:[{ text: prompt + '\n\nRespond with strict JSON only.' }] }],
          generationConfig:{ temperature, maxOutputTokens: max_tokens, responseMimeType: 'application/json' }
        })
      });
      if (!r.ok) throw new Error('gemini ' + r.status);
      const d = await r.json();
      const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return _extractJSON(txt);
    } catch (e) { errors.push('gemini: ' + (e.message||e).toString().slice(0,140)); }
  }
  if (HAS_PERPLEX) {
    try {
      const r = await fetch('https://api.perplexity.ai/chat/completions', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`},
        body: JSON.stringify({ model:'sonar', temperature, max_tokens, messages:[{role:'system',content:sys},{role:'user',content: prompt + '\n\nRespond with strict JSON only.'}] })
      });
      if (!r.ok) throw new Error('perplexity ' + r.status);
      const d = await r.json();
      const txt = d?.choices?.[0]?.message?.content || '';
      return _extractJSON(txt);
    } catch (e) { errors.push('perplexity: ' + (e.message||e).toString().slice(0,140)); }
  }
  if (HAS_CF) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
        method:'POST', headers:{'Authorization':`Bearer ${CF_TOKEN}`,'Content-Type':'application/json'},
        body: JSON.stringify({ messages:[{role:'system',content:sys},{role:'user',content:prompt + '\n\nRespond with strict JSON only — no prose, no fences.'}], temperature, max_tokens })
      });
      if (!r.ok) throw new Error('cloudflare ' + r.status);
      const d = await r.json();
      const txt = d?.result?.response || '';
      return _extractJSON(txt);
    } catch (e) { errors.push('cloudflare: ' + (e.message||e).toString().slice(0,140)); }
  }
  if (!errors.length) throw new Error('No AI provider configured — add at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, PERPLEXITY_API_KEY or CLOUDFLARE_ACCOUNT_ID+CLOUDFLARE_AI_TOKEN in Secrets.');
  throw new Error('All AI providers failed — ' + errors.join(' · '));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) BRAND IDENTITY SUITE
// ─────────────────────────────────────────────────────────────────────────────

router.post('/brand/logo-brief', async (req, res) => {
  const { brandName, industry, vibe = 'modern minimalist', audience = '' } = req.body || {};
  if (!brandName) return _err(res, 400, 'brandName required');
  try {
    const data = await _ai(`Design a complete logo brief for "${brandName}" — a ${industry || 'business'} brand targeting ${audience || 'their core audience'} with a "${vibe}" vibe.

Return JSON:
{
  "concept": "1-sentence visual concept",
  "symbol": "what the mark depicts (2-3 sentences)",
  "wordmarkStyle": "typography direction (e.g. 'Geometric sans-serif, slight roundness')",
  "primaryColor": "#hexcolor",
  "secondaryColor": "#hexcolor",
  "doNotDo": ["thing 1", "thing 2", "thing 3"],
  "midjourneyPrompt": "ready-to-paste prompt for Midjourney/DALL-E to generate the logo"
}`);
    res.json({ ok:true, brief: data });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/brand/palette', async (req, res) => {
  const { brandName, mood = 'energetic professional' } = req.body || {};
  try {
    const data = await _ai(`Generate a 6-color brand palette for "${brandName || 'a brand'}" with mood "${mood}".

Return JSON:
{
  "palette": [
    { "name": "Primary",   "hex": "#hex", "usage": "main CTAs, logo" },
    { "name": "Secondary", "hex": "#hex", "usage": "links, accents" },
    { "name": "Accent",    "hex": "#hex", "usage": "highlights, badges" },
    { "name": "Neutral Dark",  "hex": "#hex", "usage": "body text" },
    { "name": "Neutral Light", "hex": "#hex", "usage": "backgrounds" },
    { "name": "Success",   "hex": "#hex", "usage": "success states" }
  ],
  "rationale": "1-paragraph explanation"
}`);
    res.json({ ok:true, ...data });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/brand/names', async (req, res) => {
  const { description, count = 12, style = 'modern', industry = '', competitors = [] } = req.body || {};
  if (!description) return _err(res, 400, 'description required');
  const compLine = (Array.isArray(competitors) && competitors.length) ? `\nActive competitors in this space (avoid copying their names): ${competitors.slice(0,8).map(c=>typeof c==='string'?c:(c.name||c.domain||'')).filter(Boolean).join(', ')}.` : '';
  const indLine = industry ? `\nIndustry: ${industry}. The names must feel native to this industry.` : '';
  try {
    const data = await _ai(`Generate ${count} business name candidates for: "${description}". Style: ${style}.${indLine}${compLine}

Return JSON:
{
  "names": [
    { "name": "Brandname", "rationale": "1 sentence why it fits the industry + audience", "domain": "brandname.com", "score": 8 }
  ]
}
Mix invented words, real-word combos, and modified words. Prefer .com-available, 2-3 syllables, easy to spell. Score 1-10 on memorability+uniqueness. NEVER use generic filler like "Apex", "Nexus", "Vega" — every name must clearly reference the industry context.`);
    res.json({ ok:true, ...data });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/brand/slogans', async (req, res) => {
  const { brandName, valueProp, count = 10, industry = '', competitors = [] } = req.body || {};
  if (!brandName) return _err(res, 400, 'brandName required');
  const compLine = (Array.isArray(competitors) && competitors.length) ? `\nCompetitors in the same space (do NOT echo their generic positioning): ${competitors.slice(0,8).map(c=>typeof c==='string'?c:(c.name||c.domain||'')).filter(Boolean).join(', ')}.` : '';
  const indLine = industry ? `\nIndustry: ${industry}. Every slogan must reference the real value a ${industry} customer actually cares about (speed, spreads, leverage, regulation, support, education, platform reliability — whichever applies).` : '';
  const vpLine = valueProp ? `Their stated value prop is: "${valueProp}".` : '';
  try {
    const data = await _ai(`Generate ${count} taglines/slogans for "${brandName}". ${vpLine}${indLine}${compLine}

Return JSON:
{
  "slogans": [
    { "text": "The slogan", "style": "punchy|emotional|descriptive|witty", "wordCount": 5 }
  ]
}
Mix styles. Keep most under 8 words. NEVER use clichés like "your trusted partner", "built for people who actually use it", "the future of X", or "X — reimagined". Every slogan must be specific enough that a competitor couldn't drop it on their own homepage.`);
    res.json({ ok:true, ...data });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Generic field-level AI suggester for any Create-section input ─────────
// Body: { field, brand, industry, competitors[], currentValue, context }
// Returns: { ok:true, value: "<concise suggestion>" } or 5xx with explicit error.
// NEVER returns a hardcoded/placeholder string — every value comes from a real
// LLM grounded in the analysed industry + competitor list.
router.post('/ai-suggest', async (req, res) => {
  const { field = '', brand = '', industry = '', competitors = [], currentValue = '', context = '' } = req.body || {};
  if (!field) return _err(res, 400, 'field required');
  const compList = (Array.isArray(competitors)?competitors:[]).slice(0,8).map(c=>typeof c==='string'?c:(c.name||c.domain||'')).filter(Boolean).join(', ');
  const ctxBlock = [
    brand     ? `Brand: ${brand}`            : '',
    industry  ? `Industry: ${industry}`      : '',
    compList  ? `Active competitors: ${compList}` : '',
    currentValue ? `Current draft value (improve, don't echo): "${currentValue}"` : '',
    context   ? `Extra context: ${context}`  : '',
  ].filter(Boolean).join('\n');
  const prompt = `You are filling out the "${field}" field for a marketing tool. Use the brand + industry + competitor context below to write ONE concise, real, industry-specific answer. Do NOT use placeholders, generic clichés, lorem ipsum, or names like "Acme", "Apex", "Nexus", "Vega". The value must be something a real ${industry||'brand'} practitioner would actually write.

${ctxBlock}

Return strict JSON: { "value": "<the suggestion as plain text — no quotes, no markdown>" }`;
  try {
    const data = await _ai(prompt, { temperature: 0.85, max_tokens: 400 });
    let value = String(data?.value || '').trim();
    if (!value) throw new Error('AI returned empty value');
    // Defensive: strip wrapping quotes some models add.
    value = value.replace(/^["'""'']+|["'""'']+$/g, '').trim();
    res.json({ ok:true, value });
  } catch (e) { _err(res, 502, e.message); }
});

router.get('/brand/kit', async (req, res) => {
  const kit = await _db.kvGet('brand_kit:default', null);
  res.json({ ok:true, kit });
});
router.post('/brand/kit', async (req, res) => {
  await _db.kvSet('brand_kit:default', { ...(req.body || {}), updatedAt: new Date().toISOString() });
  res.json({ ok:true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) IMAGE TOOLKIT — Cloudflare Workers AI
// ─────────────────────────────────────────────────────────────────────────────

async function _cfImage(model, body) {
  if (!HAS_CF) throw new Error('Cloudflare AI not configured (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN)');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ID}/ai/run/${model}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Cloudflare AI ${r.status}: ${(await r.text()).slice(0,200)}`);
  // CF image endpoints return raw image bytes
  const buf = Buffer.from(await r.arrayBuffer());
  return 'data:image/png;base64,' + buf.toString('base64');
}

router.post('/image/sketch-to-image', async (req, res) => {
  const { prompt = 'a clean modern product photo on white background', negative = 'blurry, low quality, text, watermark' } = req.body || {};
  try {
    const dataUrl = await _cfImage('@cf/stabilityai/stable-diffusion-xl-base-1.0', {
      prompt, negative_prompt: negative, num_steps: 20, guidance: 7.5,
    });
    res.json({ ok:true, image: dataUrl });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/image/product-shot', async (req, res) => {
  const { product = 'product', scene = 'minimalist studio with soft shadows on a white seamless background', style = 'photorealistic' } = req.body || {};
  const prompt = `${style} product photograph of ${product}, ${scene}, professional commercial photography, 4k, sharp focus, soft natural lighting`;
  try {
    const dataUrl = await _cfImage('@cf/stabilityai/stable-diffusion-xl-base-1.0', { prompt, num_steps: 24, guidance: 8 });
    res.json({ ok:true, image: dataUrl, promptUsed: prompt });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/image/upscale-prompt', async (req, res) => {
  // Cloudflare doesn't have a true 2x upscaler; we use Real-ESRGAN-style
  // re-generation by re-running SDXL at higher steps with the original prompt.
  const { prompt = 'high resolution detailed image' } = req.body || {};
  try {
    const dataUrl = await _cfImage('@cf/stabilityai/stable-diffusion-xl-base-1.0', { prompt: prompt + ', ultra-detailed, 8k, sharp focus', num_steps: 30, guidance: 8 });
    res.json({ ok:true, image: dataUrl, note:'Re-rendered at higher fidelity. For true pixel upscaling, use a dedicated upscaler API.' });
  } catch (e) { _err(res, 500, e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) AI VIDEO GENERATOR — produces a storyboard spec for a 15-30s ad video
// ─────────────────────────────────────────────────────────────────────────────

router.post('/video/storyboard', async (req, res) => {
  const { brandName, valueProp, duration = 15, style = 'energetic motion graphics' } = req.body || {};
  if (!brandName || !valueProp) return _err(res, 400, 'brandName and valueProp required');
  try {
    const data = await _ai(`Storyboard a ${duration}-second ad video for "${brandName}". Value prop: "${valueProp}". Visual style: ${style}.

Return JSON:
{
  "title": "Campaign title",
  "voiceoverScript": "Full VO copy (read in ${duration}s = ~${Math.round(duration*2.5)} words)",
  "scenes": [
    { "tStart": 0, "tEnd": 3, "visual": "what's on screen", "textOverlay": "on-screen copy", "transition": "cut|fade|swipe" }
  ],
  "music": "mood description (e.g. 'upbeat electronic, building tension')",
  "endFrame": "final logo lockup description",
  "platformVariants": {
    "tiktok": "what to change for 9:16 vertical TikTok",
    "youtube": "what to change for YouTube pre-roll"
  }
}`, { system: 'You are an award-winning ad creative director. Return strict JSON only.', max_tokens: 1500 });
    const id = 'video_' + Date.now();
    await _db.kvSet(`studio_video:${id}`, { ...data, brandName, createdAt: new Date().toISOString() });
    res.json({ ok:true, id, storyboard: data });
  } catch (e) { _err(res, 500, e.message); }
});

// Render one image-frame per scene of a saved storyboard, using Cloudflare
// SDXL. Closes the AI-Video gap for users without Runway/Veo/Kling — they get
// scene-by-scene key frames they can stitch in CapCut/Premiere or feed to an
// external img-to-video tool.
router.post('/video/render-frames', async (req, res) => {
  const { id, style = 'cinematic, high contrast, 8k commercial photography' } = req.body || {};
  if (!id) return _err(res, 400, 'id required');
  if (!HAS_CF) return _err(res, 400, 'CLOUDFLARE_AI_TOKEN + CLOUDFLARE_ACCOUNT_ID required for frame rendering');
  try {
    const sb = await _db.kvGet(`studio_video:${id}`, null);
    if (!sb || !Array.isArray(sb.scenes)) return _err(res, 404, 'storyboard not found');
    const scenes = sb.scenes.slice(0, 8);
    const frames = [];
    for (const sc of scenes) {
      const prompt = `${style}. Scene: ${sc.visual}. ${sc.textOverlay ? 'On-screen text: "'+sc.textOverlay+'".' : ''} No watermark, no logos.`;
      try {
        const dataUrl = await _cfImage('@cf/stabilityai/stable-diffusion-xl-base-1.0', { prompt: prompt.slice(0, 500), num_steps: 20, guidance: 7.5 });
        frames.push({ tStart: sc.tStart, tEnd: sc.tEnd, prompt, image: dataUrl });
      } catch (e) {
        frames.push({ tStart: sc.tStart, tEnd: sc.tEnd, prompt, error: e.message });
      }
    }
    await _db.kvSet(`studio_video:${id}`, { ...sb, frames, framesRenderedAt: new Date().toISOString() });
    res.json({ ok:true, id, frames, note:'Frames generated as scene key-images. Stitch them externally (CapCut, Premiere, Runway img2vid) for full motion video.' });
  } catch (e) { _err(res, 500, e.message); }
});

// Generate an MP3 voice-over track for the storyboard's voiceoverScript using
// OpenAI TTS, persist it onto the storyboard kv row, and return the URL.
router.post('/video/voiceover', async (req, res) => {
  const { id, voice = 'alloy' } = req.body || {};
  if (!id) return _err(res, 400, 'id required');
  if (!HAS_OPENAI) return _err(res, 400, 'OpenAI key required for voice-over');
  try {
    const sb = await _db.kvGet(`studio_video:${id}`, null);
    if (!sb) return _err(res, 404, 'storyboard not found');
    const text = String(sb.voiceoverScript || '').trim().slice(0, 4000);
    if (!text) return _err(res, 400, 'storyboard has no voiceoverScript');
    const allowedVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
    const v = allowedVoices.includes(voice) ? voice : 'alloy';
    const resp = await openai.audio.speech.create({ model: 'tts-1', voice: v, input: text, response_format: 'mp3' });
    const buf = Buffer.from(await resp.arrayBuffer());
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'uploads', 'video_audio');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${id}_${Date.now()}.mp3`;
    fs.writeFileSync(path.join(dir, filename), buf);
    const mp3Url = `/uploads/video_audio/${filename}`;
    await _db.kvSet(`studio_video:${id}`, { ...sb, voiceoverMp3Url: mp3Url, voiceoverVoice: v, voiceoverRenderedAt: new Date().toISOString() });
    res.json({ ok: true, id, mp3Url, voice: v, chars: text.length });
  } catch (e) { _err(res, 500, e.message); }
});

// Stitch the storyboard's rendered key frames + (optional) voice-over MP3 into
// a single MP4 using ffmpeg. Each scene gets shown for tEnd-tStart seconds.
router.post('/video/render-mp4', async (req, res) => {
  const { id } = req.body || {};
  if (!id) return _err(res, 400, 'id required');
  try {
    const sb = await _db.kvGet(`studio_video:${id}`, null);
    if (!sb) return _err(res, 404, 'storyboard not found');
    const frames = (sb.frames || []).filter(f => f.image && f.image.startsWith('data:image'));
    if (!frames.length) return _err(res, 400, 'no frames found — run Render Key Frames first');

    const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process'); const crypto = require('crypto');
    const tmpDir = path.join(__dirname, '..', '..', 'uploads', 'video_tmp', id + '_' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const outDir = path.join(__dirname, '..', '..', 'uploads', 'video_mp4');
    fs.mkdirSync(outDir, { recursive: true });

    // Write frames to disk and build ffconcat list with per-frame durations.
    const listLines = ['ffconcat version 1.0'];
    frames.forEach((f, i) => {
      const m = f.image.match(/^data:image\/(\w+);base64,(.+)$/);
      const ext = (m && m[1]) || 'png';
      const data = Buffer.from((m && m[2]) || '', 'base64');
      const fp = path.join(tmpDir, `f${String(i).padStart(3, '0')}.${ext}`);
      fs.writeFileSync(fp, data);
      const dur = Math.max(0.5, Math.min(15, (parseFloat(f.tEnd) || (i + 1) * 3) - (parseFloat(f.tStart) || i * 3)));
      listLines.push(`file '${fp.replace(/'/g, "'\\''")}'`);
      listLines.push(`duration ${dur.toFixed(2)}`);
    });
    // ffconcat requires the last file repeated without duration for closing
    listLines.push(`file '${listLines[listLines.length - 2].slice(6, -1)}'`);
    const listPath = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(listPath, listLines.join('\n'));

    const outFile = path.join(outDir, `${id}_${crypto.randomBytes(4).toString('hex')}.mp4`);
    // Path-safety: only accept voice-over files that live under uploads/video_audio
    // and reject any traversal / absolute paths poisoned into the stored kv row.
    let audioPath = null;
    if (sb.voiceoverMp3Url && typeof sb.voiceoverMp3Url === 'string') {
      const audioDir = path.resolve(__dirname, '..', '..', 'uploads', 'video_audio');
      const rel = sb.voiceoverMp3Url.replace(/^\/+/, '');
      if (rel.startsWith('uploads/video_audio/')) {
        const candidate = path.resolve(__dirname, '..', '..', rel);
        if (candidate.startsWith(audioDir + path.sep) && fs.existsSync(candidate)) audioPath = candidate;
      }
    }

    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath];
    if (audioPath) args.push('-i', audioPath);
    args.push('-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p');
    if (audioPath) args.push('-c:a', 'aac', '-shortest');
    args.push(outFile);

    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', args);
      let err = '';
      ff.stderr.on('data', d => err += d.toString());
      ff.on('error', reject);
      ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code + ': ' + err.slice(-400))));
    });

    // Cleanup temp frames
    try { fs.readdirSync(tmpDir).forEach(f => fs.unlinkSync(path.join(tmpDir, f))); fs.rmdirSync(tmpDir); } catch {}

    const mp4Url = '/uploads/video_mp4/' + path.basename(outFile);
    await _db.kvSet(`studio_video:${id}`, { ...sb, mp4Url, mp4RenderedAt: new Date().toISOString() });
    res.json({ ok: true, id, mp4Url, hasAudio: !!audioPath, scenes: frames.length });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/video/list', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, items: [] });
  try {
    const r = await _db.getPool().query(`SELECT key, value FROM kv_store WHERE key LIKE 'studio_video:%' ORDER BY key DESC LIMIT 30`);
    res.json({ ok:true, items: r.rows.map(row => ({ id: row.key.replace('studio_video:',''), ...row.value })) });
  } catch (e) { _err(res, 500, e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) AI PRESENTATION GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

router.post('/presentation/generate', async (req, res) => {
  const { topic, audience = 'investors', slideCount = 10, tone = 'confident, data-driven' } = req.body || {};
  if (!topic) return _err(res, 400, 'topic required');
  try {
    const data = await _ai(`Build a ${slideCount}-slide presentation on "${topic}" for ${audience}. Tone: ${tone}.

Return JSON:
{
  "title": "Deck title",
  "subtitle": "1-line hook",
  "slides": [
    { "n": 1, "type": "cover|content|stat|quote|cta",
      "heading": "...", "subheading": "...",
      "bullets": ["...", "..."],
      "speakerNotes": "what to say (2-3 sentences)",
      "visualSuggestion": "describe the chart/photo/diagram for this slide"
    }
  ]
}
First slide is cover, last is CTA. Include 1 stat slide and 1 quote slide.`, { max_tokens: 2500 });
    const id = 'pres_' + Date.now();
    await _db.kvSet(`studio_pres:${id}`, { ...data, createdAt: new Date().toISOString() });
    res.json({ ok:true, id, deck: data });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/presentation/list', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, items: [] });
  try {
    const r = await _db.getPool().query(`SELECT key, value FROM kv_store WHERE key LIKE 'studio_pres:%' ORDER BY key DESC LIMIT 30`);
    res.json({ ok:true, items: r.rows.map(row => ({ id: row.key.replace('studio_pres:',''), title: row.value?.title, slideCount: row.value?.slides?.length || 0, createdAt: row.value?.createdAt })) });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/presentation/:id', async (req, res) => {
  const data = await _db.kvGet(`studio_pres:${req.params.id}`, null);
  if (!data) return _err(res, 404, 'Not found');
  res.json({ ok:true, deck: data });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) EMAIL SIGNATURE DESIGNER (with optional tracking pixel + click tracking)
// ─────────────────────────────────────────────────────────────────────────────

function _esc(s) { return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

router.post('/signature/generate', async (req, res) => {
  const { name = '', title = '', company = '', email = '', phone = '', website = '',
          linkedin = '', primaryColor = '#0066FF', logoUrl = '', tagline = '',
          enableTracking = true, sigId } = req.body || {};
  if (!name || !email) return _err(res, 400, 'name and email required');

  const id = sigId || ('sig_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7));
  const baseUrl = process.env.PUBLIC_URL || `https://${process.env.REPL_SLUG || 'app'}.replit.app`;
  const trackPixel = enableTracking ? `<img src="${baseUrl}/api/studio/signature/${id}/pixel.png" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : '';
  const wrapLink = (url, label) => enableTracking ? `<a href="${baseUrl}/api/studio/signature/${id}/click?u=${encodeURIComponent(url)}" style="color:${_esc(primaryColor)};text-decoration:none">${_esc(label)}</a>` : `<a href="${_esc(url)}" style="color:${_esc(primaryColor)};text-decoration:none">${_esc(label)}</a>`;

  const html = `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#0F172A;line-height:1.5">
  <tr>
    ${logoUrl ? `<td style="padding-right:14px;border-right:2px solid ${_esc(primaryColor)};vertical-align:top"><img src="${_esc(logoUrl)}" width="60" alt="${_esc(company)}" style="display:block"></td>` : ''}
    <td style="padding-left:${logoUrl?'14':'0'}px;vertical-align:top">
      <div style="font-weight:700;font-size:15px;color:#0F172A">${_esc(name)}</div>
      <div style="color:#64748B;font-size:12px;margin-bottom:6px">${_esc(title)}${title&&company?' · ':''}${_esc(company)}</div>
      ${tagline ? `<div style="color:${_esc(primaryColor)};font-style:italic;font-size:12px;margin-bottom:6px">${_esc(tagline)}</div>` : ''}
      <div style="font-size:12px;color:#475569">
        ${email   ? `📧 ${wrapLink('mailto:'+email, email)}<br>` : ''}
        ${phone   ? `📱 ${_esc(phone)}<br>` : ''}
        ${website ? `🌐 ${wrapLink(website, website.replace(/^https?:\/\//,''))}<br>` : ''}
        ${linkedin? `💼 ${wrapLink(linkedin, 'LinkedIn')}` : ''}
      </div>
    </td>
  </tr>
</table>${trackPixel}`;

  await _db.kvSet(`studio_sig:${id}`, { name, title, company, email, phone, website, linkedin, primaryColor, logoUrl, tagline, enableTracking, html, opens: 0, clicks: 0, createdAt: new Date().toISOString() });
  res.json({ ok:true, id, html });
});

router.get('/signature/:id/pixel.png', async (req, res) => {
  const sig = await _db.kvGet(`studio_sig:${req.params.id}`, null);
  if (sig) { sig.opens = (sig.opens || 0) + 1; sig.lastOpenAt = new Date().toISOString(); await _db.kvSet(`studio_sig:${req.params.id}`, sig); }
  // 1×1 transparent PNG
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=', 'base64');
  res.set({ 'Content-Type':'image/png', 'Cache-Control':'no-store, no-cache, must-revalidate', 'Pragma':'no-cache' });
  res.send(PIXEL);
});

router.get('/signature/:id/click', async (req, res) => {
  const sig = await _db.kvGet(`studio_sig:${req.params.id}`, null);
  const u = String(req.query.u || '');
  if (sig) { sig.clicks = (sig.clicks || 0) + 1; sig.lastClickAt = new Date().toISOString(); await _db.kvSet(`studio_sig:${req.params.id}`, sig); }
  // Whitelist scheme to avoid open-redirect abuse
  if (!/^(https?:|mailto:)/i.test(u)) return res.status(400).send('Invalid URL');
  res.redirect(302, u);
});

router.get('/signature/list', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, items: [] });
  try {
    const r = await _db.getPool().query(`SELECT key, value FROM kv_store WHERE key LIKE 'studio_sig:%' ORDER BY key DESC LIMIT 30`);
    res.json({ ok:true, items: r.rows.map(row => ({ id: row.key.replace('studio_sig:',''), name: row.value?.name, opens: row.value?.opens || 0, clicks: row.value?.clicks || 0, createdAt: row.value?.createdAt })) });
  } catch (e) { _err(res, 500, e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6) AI CASE STUDY BUILDER — turn a customer story into a polished case study
// Outputs the standard Challenge → Solution → Result structure plus a hero
// headline, pull quote, metrics table and CTA. Persisted so the user can drop
// it straight into a landing page (Site Builder) or sales deck (Presentation).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/case-study/generate', async (req, res) => {
  const { customerName, industry = '', challenge, solution, result, brandName = '', tone = 'confident, plain-spoken' } = req.body || {};
  if (!customerName || !challenge || !solution) return _err(res, 400, 'customerName, challenge and solution required');
  try {
    const data = await _ai(`Write a polished customer case study for ${brandName ? `"${brandName}"` : 'our brand'} about how we helped "${customerName}"${industry ? ` (${industry})` : ''}. Tone: ${tone}.

Inputs:
- Challenge they faced: ${challenge}
- Solution we delivered: ${solution}
- Result/outcome: ${result || '(not provided — infer a plausible specific outcome)'}

Return JSON:
{
  "headline": "Hero headline, max 12 words, leads with the result",
  "subheadline": "1-sentence supporting line",
  "pullQuote": { "text": "A believable 1-2 sentence quote in the customer's voice", "attribution": "Name, Title at ${customerName}" },
  "challenge": { "title": "The Challenge", "body": "2-3 paragraphs in plain language" },
  "solution":  { "title": "The Solution",  "body": "2-3 paragraphs explaining what we did, step by step" },
  "result":    { "title": "The Result",    "body": "1-2 paragraphs summarising the outcome" },
  "metrics": [ { "label": "Conversion lift", "value": "+42%", "context": "vs. previous quarter" } ],
  "cta": { "headline": "Ready for results like these?", "buttonText": "Talk to us", "buttonUrl": "#contact" },
  "tags": ["industry tag", "use-case tag", "result tag"],
  "estimatedReadMin": 3
}
Generate at least 3 metrics with concrete numbers (use the inputs to ground them; invent specific but realistic numbers when not provided). Keep all body copy benefit-led, free of jargon and corporate-speak.`, { system: 'You are a senior B2B content strategist who writes case studies that sales teams love. Return strict JSON only.', max_tokens: 2200 });
    const id = 'case_' + Date.now().toString(36);
    await _db.kvSet(`studio_case:${id}`, { ...data, customerName, industry, brandName, createdAt: new Date().toISOString() });
    res.json({ ok: true, id, study: data });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/case-study/list', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, items: [] });
  try {
    const r = await _db.getPool().query(`SELECT key, value FROM kv_store WHERE key LIKE 'studio_case:%' ORDER BY key DESC LIMIT 50`);
    res.json({ ok:true, items: r.rows.map(row => ({
      id: row.key.replace('studio_case:',''),
      headline: row.value?.headline,
      customerName: row.value?.customerName,
      createdAt: row.value?.createdAt,
    })) });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/case-study/:id', async (req, res) => {
  const data = await _db.kvGet(`studio_case:${req.params.id}`, null);
  if (!data) return _err(res, 404, 'Not found');
  res.json({ ok:true, study: data });
});

// Render a standalone, share-ready HTML page from a stored case study so the
// user can grab a public URL or copy/paste it into their site.
router.get('/case-study/:id/page', async (req, res) => {
  const s = await _db.kvGet(`studio_case:${req.params.id}`, null);
  if (!s) return res.status(404).send('Not found');
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const metrics = (s.metrics || []).map(m => `<div style="background:#F8FAFC;padding:20px;border-radius:12px;text-align:center"><div style="font-size:32px;font-weight:800;color:#0066FF">${esc(m.value)}</div><div style="font-weight:600;margin-top:4px">${esc(m.label)}</div><div style="color:#64748B;font-size:13px">${esc(m.context)}</div></div>`).join('');
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.headline)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0F172A;max-width:780px;margin:0 auto;padding:48px 20px;line-height:1.65}h1{font-size:42px;line-height:1.15;margin:0 0 12px}h2{font-size:24px;margin-top:36px}.sub{color:#64748B;font-size:18px;margin-bottom:32px}.quote{background:linear-gradient(135deg,#0066FF,#7C3AED);color:white;padding:28px;border-radius:16px;font-size:18px;margin:28px 0}.attr{margin-top:12px;font-size:14px;opacity:.9}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin:24px 0}.cta{background:#0F172A;color:white;padding:32px;border-radius:16px;text-align:center;margin-top:40px}.cta a{display:inline-block;background:#0066FF;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:12px}.tags{margin-top:24px}.tag{display:inline-block;background:#EEF2FF;color:#4338CA;padding:4px 12px;border-radius:99px;font-size:12px;margin-right:6px}</style></head><body><div style="color:#64748B;font-size:13px;font-weight:600;letter-spacing:.5px;text-transform:uppercase">Case Study · ${esc(s.customerName)}</div><h1>${esc(s.headline)}</h1><p class="sub">${esc(s.subheadline)}</p>${metrics?`<div class="metrics">${metrics}</div>`:''}${s.pullQuote?.text?`<div class="quote">"${esc(s.pullQuote.text)}"<div class="attr">— ${esc(s.pullQuote.attribution)}</div></div>`:''}<h2>${esc(s.challenge?.title || 'The Challenge')}</h2><p>${esc(s.challenge?.body || '').replace(/\n+/g,'</p><p>')}</p><h2>${esc(s.solution?.title || 'The Solution')}</h2><p>${esc(s.solution?.body || '').replace(/\n+/g,'</p><p>')}</p><h2>${esc(s.result?.title || 'The Result')}</h2><p>${esc(s.result?.body || '').replace(/\n+/g,'</p><p>')}</p>${s.tags?.length?`<div class="tags">${s.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}${s.cta?`<div class="cta"><h2 style="color:white;margin:0">${esc(s.cta.headline)}</h2><a href="${esc(s.cta.buttonUrl)}">${esc(s.cta.buttonText)}</a></div>`:''}</body></html>`);
});

module.exports = router;
