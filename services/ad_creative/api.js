const express = require('express');
const _https  = require('https');
const _http   = require('http');
const _fs     = require('fs');
const _path   = require('path');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const PLATFORMS = ['facebook_ad','instagram_post','instagram_story','google_display','twitter_x','linkedin','tiktok','pinterest','email_banner','youtube_thumbnail'];
const FORMATS   = { square:'1024x1024', landscape:'1792x1024', portrait:'1024x1792' };
const STYLES    = ['photorealistic','illustration','minimalist','bold_graphic','corporate','playful','editorial','flat_design'];

function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({
    model: opts.model || 'gpt-4o-mini',
    messages,
    response_format: opts.json ? { type:'json_object' } : undefined,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens || 1200,
  });
  return new Promise(resolve => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
      try { if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d); resolve(j.choices[0].message.content);
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── OpenAI Images (DALL-E 3) ──────────────────────────────────────────────
async function _dalleGenerate(prompt, size) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const body = JSON.stringify({ model:'dall-e-3', prompt, size, quality:'standard', n:1, response_format:'url' });
  return new Promise(resolve => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/images/generations', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, r => {
      let d=''; r.on('data', c => d+=c); r.on('end', () => {
        try {
          if (r.statusCode !== 200) { console.warn('[ad-creative] DALL-E error', r.statusCode, d.slice(0,200)); return resolve(null); }
          const j = JSON.parse(d);
          resolve(j.data?.[0]?.url || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(120000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── Download image from URL to disk ──────────────────────────────────────
async function _downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = _fs.createWriteStream(dest);
    const proto = url.startsWith('https') ? _https : _http;
    proto.get(url, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        file.close();
        _fs.unlink(dest, () => {});
        return _downloadImage(r.headers.location, dest).then(resolve).catch(reject);
      }
      r.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', e => { _fs.unlink(dest, () => {}); reject(e); });
  });
}

// ── Prompt builder ────────────────────────────────────────────────────────
function _buildPrompt(params) {
  const { platform, style, headline, body_copy, brand_name, brand_colors, cta_text, extra_context } = params;
  const platformDescriptions = {
    facebook_ad: 'Facebook News Feed advertisement',
    instagram_post: 'Instagram square post',
    instagram_story: 'Instagram Story (vertical)',
    google_display: 'Google Display Network banner ad',
    twitter_x: 'Twitter/X timeline post visual',
    linkedin: 'LinkedIn sponsored content visual',
    tiktok: 'TikTok video thumbnail',
    pinterest: 'Pinterest pin visual',
    email_banner: 'email newsletter header banner',
    youtube_thumbnail: 'YouTube video thumbnail',
  };
  const styleDescriptions = {
    photorealistic: 'photorealistic, professional photography style',
    illustration: 'digital illustration, vector art style',
    minimalist: 'clean minimalist design, lots of white space, simple shapes',
    bold_graphic: 'bold graphic design, strong typography, high contrast colors',
    corporate: 'professional corporate design, clean and trustworthy',
    playful: 'playful, fun, colorful design with friendly elements',
    editorial: 'editorial magazine-style design, sophisticated layout',
    flat_design: 'modern flat design, geometric shapes, clean icons',
  };
  let parts = [];
  parts.push(`Create a ${platformDescriptions[platform] || 'marketing visual'} in ${styleDescriptions[style] || style} style.`);
  if (brand_name) parts.push(`Brand: "${brand_name}".`);
  if (brand_colors) parts.push(`Use these brand colors: ${brand_colors}.`);
  if (headline) parts.push(`Primary headline text to prominently display: "${headline}".`);
  if (body_copy) parts.push(`Supporting message: "${body_copy}".`);
  if (cta_text) parts.push(`Call-to-action button text: "${cta_text}".`);
  if (extra_context) parts.push(extra_context);
  parts.push('High quality, professional marketing creative. No watermarks. Clean, polished design suitable for digital advertising.');
  return parts.join(' ');
}

// ── Placeholder generator ─────────────────────────────────────────────────
function _placeholder(platform, style, headline) {
  return {
    image_url: `https://placehold.co/${platform === 'instagram_story' ? '400x711' : platform === 'landscape' ? '800x450' : '400x400'}/1a1a2e/6366f1?text=${encodeURIComponent(headline ? headline.slice(0,30) : 'Ad Creative')}`,
    source: 'placeholder',
    prompt: _buildPrompt({ platform, style, headline }),
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

// T68 — Pre-launch Creative Scoring
router.post('/score', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_creative:score' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const headline   = String(req.body?.headline   || '').slice(0, 200);
  const body_copy  = String(req.body?.body_copy  || '').slice(0, 500);
  const cta_text   = String(req.body?.cta_text   || '').slice(0, 80);
  const platform   = String(req.body?.platform   || 'facebook_ad').slice(0, 50);
  const visual_desc= String(req.body?.visual_desc|| '').slice(0, 300);
  if (!headline) return _err(res, 400, 'headline required');
  const sys = `You are a conversion rate optimisation expert who scores ad creatives before launch. Return JSON ONLY:
{"scores":{"hook_strength":<1-10>,"cta_clarity":<1-10>,"urgency":<1-10>,"emotional_resonance":<1-10>,"relevance":<1-10>},"overall":<0-100>,"ctr_range":{"low":"<e.g. 0.8%>","high":"<e.g. 1.4%>"},"grade":"<A/B/C/D/F>","verdict":"<1-2 sentence plain-English verdict>","tips":[{"dimension":"<score name>","tip":"<specific, actionable improvement — not generic advice>"}]}
Rules: tips must be specific to the actual creative text. 3-5 tips. Score based on real ad performance benchmarks.`;
  const user = `Platform: ${platform}\nHeadline: ${headline}\nBody copy: ${body_copy||'(none)'}\nCTA: ${cta_text||'(none)'}\nVisual description: ${visual_desc||'(none)'}`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:user}], { json:true, max_tokens:900 });
  if (!raw) {
    return res.json({ ok:true, source:'template', scores:{ hook_strength:6, cta_clarity:6, urgency:5, emotional_resonance:6, relevance:7 },
      overall:60, ctr_range:{ low:'0.6%', high:'1.0%' }, grade:'C',
      verdict:'Solid foundation, but needs stronger emotional hooks and clearer urgency to stand out.',
      tips:[{dimension:'hook_strength',tip:'Open with a specific number or surprising stat to stop the scroll.'},{dimension:'urgency',tip:'Add a time-limited offer or quantity limit to motivate immediate action.'},{dimension:'cta_clarity',tip:'Make the CTA more specific: "Start Free Trial" beats "Get Started".'}]
    });
  }
  try { res.json({ ok:true, source:'openai', ...JSON.parse(raw) }); }
  catch { _err(res, 500, 'parse error'); }
});

// T69 — UGC Video Ad Script
router.post('/ugc-script', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_creative:ugc_script' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const product  = String(req.body?.product   || '').slice(0, 300);
  const audience = String(req.body?.audience  || '').slice(0, 200);
  const hook_type= String(req.body?.hook_type || 'problem-solution').slice(0, 50);
  const platform = String(req.body?.platform  || 'instagram_reels').slice(0, 50);
  const duration = String(req.body?.duration  || '30').slice(0, 5);
  const benefit  = String(req.body?.benefit   || '').slice(0, 200);
  if (!product) return _err(res, 400, 'product required');
  const HOOK_TYPES = {
    'problem-solution':'Open with the relatable problem, then reveal the solution dramatically',
    'asmr':'Open with satisfying product sounds/visuals, build sensory appeal, then CTA',
    'testimonial':'Open as if mid-conversation sharing an honest review, authentic and unscripted',
    'trending-sound':'Open synced to a trending audio format, use meme/pop-culture reference, pivot to product',
    'before-after':'Open on the "before" pain state, dramatic transformation reveal, then CTA',
  };
  const hookNote = HOOK_TYPES[hook_type] || hook_type;
  const sys = `You are a UGC (user-generated content) video ad script writer for social media. Return JSON ONLY:
{"scenes":[{"timestamp":"<e.g. 0-3s>","type":"<hook|problem|solution|proof|cta>","script":"<exact spoken words>","direction":"<camera/action note for the creator>","text_overlay":"<on-screen text or null>"}],"caption":"<full post caption with emojis>","hashtags":["<tag>"],"creator_tips":["<practical filming tip>"]}
Rules: ${Math.min(8,Math.max(3,Math.round(Number(duration)/4)))} scenes for a ${duration}s video. Opening hook MUST be delivered in first 2-3 seconds. Script feels authentic, not salesy. Creator tips are actionable.
Hook style: ${hookNote}`;
  const user = `Product: ${product}\nAudience: ${audience||'general'}\nPlatform: ${platform}\nDuration: ${duration} seconds\nKey benefit: ${benefit||'(use product description)'}`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:user}], { json:true, max_tokens:1400 });
  if (!raw) {
    return res.json({ ok:true, source:'template', scenes:[
      {timestamp:'0-3s',type:'hook',script:`Wait — you're still doing this the hard way?`,direction:'Surprised face to camera, hold phone close',text_overlay:'POV: still wasting hours on this'},
      {timestamp:'3-8s',type:'problem',script:`I used to spend hours every week on this. It was exhausting.`,direction:'Show "before" frustration, messy desk or tired look',text_overlay:null},
      {timestamp:'8-18s',type:'solution',script:`Then I found ${product} and honestly? Game changer. Look how easy this is.`,direction:'Screen recording or product demo, enthusiastic',text_overlay:`✅ ${product}`},
      {timestamp:'18-25s',type:'proof',script:`In the first week I saved 5 hours and actually saw results. No joke.`,direction:'Show results screenshot or satisfied expression',text_overlay:'5 hours saved in week 1'},
      {timestamp:'25-30s',type:'cta',script:`Link in bio — try it free. You'll thank yourself later.`,direction:'Point at camera, smile, end card',text_overlay:'Try free 👆 Link in bio'},
    ], caption:`okay I NEED to tell you about this 😭 ${product} has completely changed how I work. full review in bio 🔗 #ugc #productreview #lifehack`,
    hashtags:['ugc','productreview','tiktokfinds','musthave','lifehack'],
    creator_tips:['Film in natural window light for a genuine "at home" feel','Use your real voice — slight imperfection is more trustworthy than perfection','Film 3 takes and use the most natural one']});
  }
  try { res.json({ ok:true, source:'openai', ...JSON.parse(raw) }); }
  catch { _err(res, 500, 'parse error'); }
});

// T72 — Generate Ad Package from Landing Page
router.post('/from-landing-page', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_creative:from_lp' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const pageId = Number(req.body?.page_id);
  if (!Number.isFinite(pageId) || !_db.hasDb()) return _err(res, 400, 'page_id required and DB must be available');
  const pr = await _db.getPool().query(`SELECT * FROM landing_pages WHERE id=$1 AND tenant_id=$2`, [pageId, tid]);
  const page = pr.rows[0];
  if (!page) return _err(res, 404, 'page not found');
  const content = page.content || {};
  const headline = content.headline || page.title || '';
  const subhead  = content.subhead  || '';
  const cta      = content.hero_cta || 'Get Started';
  const proof    = content.social_proof || '';
  const feats    = (content.features || []).slice(0,3).map(f => f.title).join(', ');
  const sys = `You are a multi-platform ad copywriter. Given landing page content, generate an ad package for 3 platforms. Return JSON ONLY:
{"packages":[
  {"platform":"Meta (Facebook + Instagram)","formats":["1:1 feed","9:16 story/reel"],"headline":"<30 chars max — punchy, curiosity or benefit>","primary_text":"<125 chars — conversational, addresses pain point>","cta_button":"<Learn More|Shop Now|Sign Up|Get Quote>","notes":"<1-line creative direction>"},
  {"platform":"Google Display","formats":["300x250","728x90","160x600"],"headline":"<30 chars — clear benefit or solution>","description":"<90 chars — feature or proof point>","cta_button":"<Learn more|Sign up|Get started>","notes":"<1-line visual direction>"},
  {"platform":"TikTok","formats":["9:16 vertical video"],"hook":"<first 3 seconds spoken — must stop the scroll>","script_summary":"<2-3 sentence video concept>","hashtags":["<tag>"],"notes":"<1-line creator direction>"}
]}`;
  const user = `Landing page headline: ${headline}\nSubhead: ${subhead}\nHero CTA: ${cta}\nSocial proof: ${proof}\nKey features: ${feats}\nBrand: ${page.brand||'(not set)'}\nGoal: ${page.goal||'conversions'}`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:user}], { json:true, max_tokens:1200 });
  if (!raw) {
    return res.json({ ok:true, source:'template', packages:[
      { platform:'Meta (Facebook + Instagram)', formats:['1:1 feed','9:16 story/reel'], headline:headline.slice(0,30), primary_text:`${subhead.slice(0,80)} ${proof ? '— '+proof.slice(0,40) : ''}`.trim(), cta_button:'Learn More', notes:'Use a bright lifestyle image with headline overlaid' },
      { platform:'Google Display', formats:['300x250','728x90'], headline:headline.slice(0,30), description:feats.slice(0,90)||subhead.slice(0,90), cta_button:'Get Started', notes:'Clean white background, brand colour CTA button' },
      { platform:'TikTok', formats:['9:16 vertical video'], hook:`Did you know ${headline.slice(0,40).toLowerCase()}?`, script_summary:`Hook with a relatable problem, reveal the solution (${page.brand||'this product'}), show the results, CTA to link in bio.`, hashtags:['tiktokfinds','musthave','viral'], notes:'Film in portrait, use trending sound, show real results' },
    ]});
  }
  try { res.json({ ok:true, source:'openai', ...JSON.parse(raw) }); }
  catch { _err(res, 500, 'parse error'); }
});

// POST /generate
router.post('/generate', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_creative:generate' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const platform     = PLATFORMS.includes(req.body?.platform) ? req.body.platform : 'facebook_ad';
  const formatKey    = ['square','landscape','portrait'].includes(req.body?.format) ? req.body.format : 'square';
  const size         = FORMATS[formatKey];
  const style        = STYLES.includes(req.body?.style) ? req.body.style : 'photorealistic';
  const headline     = String(req.body?.headline     || '').slice(0, 150);
  const body_copy    = String(req.body?.body_copy    || '').slice(0, 300);
  const brand_name   = String(req.body?.brand_name   || '').slice(0, 80);
  const brand_colors = String(req.body?.brand_colors || '').slice(0, 100);
  const cta_text     = String(req.body?.cta_text     || '').slice(0, 50);
  const extra_context= String(req.body?.extra_context|| '').slice(0, 500);

  const prompt = _buildPrompt({ platform, style, headline, body_copy, brand_name, brand_colors, cta_text, extra_context });

  let imageUrl = null;
  let imagePath = null;
  let source = 'dalle3';

  const dalleUrl = await _dalleGenerate(prompt, size);
  if (dalleUrl) {
    try {
      const dir = _path.join(process.cwd(), 'uploads', 'ad_creatives');
      if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive:true });
      const fname = `ac_${Date.now()}_${Math.random().toString(36).slice(2,8)}.png`;
      const dest = _path.join(dir, fname);
      await _downloadImage(dalleUrl, dest);
      imagePath = `/uploads/ad_creatives/${fname}`;
      imageUrl = imagePath;
    } catch (e) {
      console.warn('[ad-creative] download failed, using direct URL:', e.message);
      imageUrl = dalleUrl;
    }
  } else {
    const ph = _placeholder(platform, style, headline);
    imageUrl = ph.image_url;
    source = 'placeholder';
  }

  let id = null;
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `INSERT INTO ad_creatives (tenant_id, platform, format, style, headline, body_copy, brand_name, brand_colors, cta_text, image_url, image_path, prompt, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [tid, platform, formatKey, style, headline, body_copy, brand_name, brand_colors, cta_text, imageUrl, imagePath, prompt.slice(0,2000), source]
      );
      id = r.rows[0].id;
    } catch (e) { console.warn('[ad-creative] persist failed:', e.message); }
  }

  res.json({ ok:true, id, platform, format:formatKey, style, headline, image_url:imageUrl, prompt, source });
});

// GET /history
router.get('/history', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_creative:history' });
  if (!_db.hasDb()) return res.json({ ok:true, items:[] });
  const limit = Math.min(50, parseInt(req.query?.limit, 10) || 20);
  try {
    const r = await _db.getPool().query(
      `SELECT id, platform, format, style, headline, brand_name, image_url, source, created_at
       FROM ad_creatives WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`, [tid, limit]);
    res.json({ ok:true, items: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_creative:get' });
  if (!_db.hasDb()) return _err(res, 404, 'not found');
  try {
    const r = await _db.getPool().query(
      `SELECT * FROM ad_creatives WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, item: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_creative:delete' });
  if (!_db.hasDb()) return res.json({ ok:true });
  try {
    const r = await _db.getPool().query(
      `DELETE FROM ad_creatives WHERE id=$1 AND tenant_id=$2 RETURNING image_path`, [id, tid]);
    if (r.rows[0]?.image_path) {
      try { _fs.unlinkSync(_path.join(process.cwd(), r.rows[0].image_path)); } catch {}
    }
    res.json({ ok:true });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
