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

// ── Placeholder generator (when no API key) ───────────────────────────────
function _placeholder(platform, style, headline) {
  return {
    image_url: `https://placehold.co/${platform === 'instagram_story' ? '400x711' : platform === 'landscape' ? '800x450' : '400x400'}/1a1a2e/6366f1?text=${encodeURIComponent(headline ? headline.slice(0,30) : 'Ad Creative')}`,
    source: 'placeholder',
    prompt: _buildPrompt({ platform, style, headline }),
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

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
