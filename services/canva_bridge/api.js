const express = require('express');
const router  = express.Router();

// Curated Canva template library — direct Canva template links by content category.
// These are public Canva template search URLs; users click through to Canva
// and can select a template to customise.
const TEMPLATE_LIBRARY = [
  {
    category: 'social-post',
    label: 'Social Media Post',
    icon: '📱',
    description: 'Square and portrait posts for Instagram, Facebook, LinkedIn',
    templates: [
      { name: 'Instagram Post', url: 'https://www.canva.com/templates/?query=instagram+post', platform: 'Instagram' },
      { name: 'Facebook Post', url: 'https://www.canva.com/templates/?query=facebook+post', platform: 'Facebook' },
      { name: 'LinkedIn Post', url: 'https://www.canva.com/templates/?query=linkedin+post', platform: 'LinkedIn' },
      { name: 'Twitter/X Post', url: 'https://www.canva.com/templates/?query=twitter+post', platform: 'Twitter' }
    ]
  },
  {
    category: 'carousel',
    label: 'Carousel / Slides',
    icon: '🎠',
    description: 'Multi-slide carousels for Instagram, LinkedIn and TikTok',
    templates: [
      { name: 'Instagram Carousel', url: 'https://www.canva.com/templates/?query=instagram+carousel', platform: 'Instagram' },
      { name: 'LinkedIn Carousel', url: 'https://www.canva.com/templates/?query=linkedin+carousel', platform: 'LinkedIn' },
      { name: 'TikTok Slides', url: 'https://www.canva.com/templates/?query=tiktok+slides', platform: 'TikTok' }
    ]
  },
  {
    category: 'story',
    label: 'Stories & Reels Cover',
    icon: '⚡',
    description: 'Vertical 9:16 format for Instagram Stories, TikTok, Reels',
    templates: [
      { name: 'Instagram Story', url: 'https://www.canva.com/templates/?query=instagram+story', platform: 'Instagram' },
      { name: 'TikTok Video Cover', url: 'https://www.canva.com/templates/?query=tiktok+video+cover', platform: 'TikTok' },
      { name: 'YouTube Shorts', url: 'https://www.canva.com/templates/?query=youtube+shorts', platform: 'YouTube' }
    ]
  },
  {
    category: 'ad-creative',
    label: 'Ad Creative',
    icon: '📢',
    description: 'Banner ads, display ads, and paid social creatives',
    templates: [
      { name: 'Facebook Ad', url: 'https://www.canva.com/templates/?query=facebook+ad', platform: 'Meta' },
      { name: 'Google Display Ad', url: 'https://www.canva.com/templates/?query=google+display+ad', platform: 'Google' },
      { name: 'LinkedIn Ad', url: 'https://www.canva.com/templates/?query=linkedin+ad', platform: 'LinkedIn' }
    ]
  },
  {
    category: 'email-header',
    label: 'Email Header / Banner',
    icon: '📧',
    description: 'Header banners for email campaigns and newsletters',
    templates: [
      { name: 'Email Header', url: 'https://www.canva.com/templates/?query=email+header', platform: 'Email' },
      { name: 'Newsletter Banner', url: 'https://www.canva.com/templates/?query=newsletter+banner', platform: 'Email' },
      { name: 'Email Signature', url: 'https://www.canva.com/templates/?query=email+signature', platform: 'Email' }
    ]
  },
  {
    category: 'blog-thumbnail',
    label: 'Blog & Article',
    icon: '✍️',
    description: 'Featured images, OG images, and blog thumbnails',
    templates: [
      { name: 'Blog Banner', url: 'https://www.canva.com/templates/?query=blog+banner', platform: 'Web' },
      { name: 'Article Feature Image', url: 'https://www.canva.com/templates/?query=article+feature+image', platform: 'Web' },
      { name: 'YouTube Thumbnail', url: 'https://www.canva.com/templates/?query=youtube+thumbnail', platform: 'YouTube' }
    ]
  },
  {
    category: 'infographic',
    label: 'Infographic',
    icon: '📊',
    description: 'Data visualisations, process diagrams, and stat graphics',
    templates: [
      { name: 'Marketing Infographic', url: 'https://www.canva.com/templates/?query=marketing+infographic', platform: 'Multi' },
      { name: 'Stats & Data Visual', url: 'https://www.canva.com/templates/?query=data+infographic', platform: 'Multi' },
      { name: 'Process Diagram', url: 'https://www.canva.com/templates/?query=process+infographic', platform: 'Multi' }
    ]
  },
  {
    category: 'presentation',
    label: 'Pitch & Presentation',
    icon: '🎯',
    description: 'Sales decks, pitch decks, and brand presentations',
    templates: [
      { name: 'Marketing Pitch Deck', url: 'https://www.canva.com/templates/?query=marketing+pitch+deck', platform: 'Slides' },
      { name: 'Sales Presentation', url: 'https://www.canva.com/templates/?query=sales+presentation', platform: 'Slides' },
      { name: 'Brand Guidelines', url: 'https://www.canva.com/templates/?query=brand+guidelines', platform: 'Slides' }
    ]
  }
];

// ── GET /templates ────────────────────────────────────────────────────────────
router.get('/templates', (req, res) => {
  const category = req.query.category;
  const templates = category
    ? TEMPLATE_LIBRARY.filter(t => t.category === category)
    : TEMPLATE_LIBRARY;
  res.json({ ok: true, templates });
});

// ── POST /format ──────────────────────────────────────────────────────────────
// Formats InfoGenie content (social post copy, carousel slides, etc.) into
// a structured text block that can be copied and pasted into Canva text fields.
router.post('/format', (req, res) => {
  const { type, title, body, slides, hashtags, cta } = req.body || {};
  const allowed = ['social-post','carousel','email','ad-creative','blog'];
  if (!allowed.includes(type)) return res.status(400).json({ ok:false, error:`type must be one of: ${allowed.join(', ')}` });

  let formatted = '';
  if (type === 'carousel' && Array.isArray(slides)) {
    formatted = slides.map((s, i) => `── Slide ${i+1} ──\n${s.title ? `HEADLINE: ${s.title}\n` : ''}${s.body || s.text || ''}`).join('\n\n');
  } else {
    formatted = [
      title ? `HEADLINE:\n${title}` : null,
      body  ? `BODY:\n${body}` : null,
      cta   ? `CTA: ${cta}` : null,
      hashtags && hashtags.length ? `HASHTAGS:\n${hashtags.join(' ')}` : null
    ].filter(Boolean).join('\n\n');
  }

  res.json({ ok:true, type, formatted, charCount: formatted.length });
});

function _canvaConfigured() {
  const id = process.env.CANVA_CLIENT_ID || process.env.CANVA_API_KEY || '';
  const secret = process.env.CANVA_CLIENT_SECRET || '';
  return {
    clientId: !!(id && !/^_DUMMY/i.test(id)),
    clientSecret: !!(secret && !/^_DUMMY/i.test(secret)),
    oauthReady: !!(id && secret && !/^_DUMMY/i.test(id) && !/^_DUMMY/i.test(secret)),
  };
}

// ── GET /status ───────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const cfg = _canvaConfigured();
  res.json({
    ok: true,
    apiKey: cfg.clientId,
    oauthReady: cfg.oauthReady,
    templateLibrary: TEMPLATE_LIBRARY.length,
    note: cfg.oauthReady
      ? 'Canva Connect credentials detected — use Design Kit to push briefs into Canva.'
      : 'Template library works without OAuth. Add CANVA_CLIENT_ID + CANVA_CLIENT_SECRET for Connect.',
  });
});

// ── GET /oauth/start ──────────────────────────────────────────────────────────
// Starts Canva Connect Authorization Code flow when credentials are present.
router.get('/oauth/start', (req, res) => {
  const cfg = _canvaConfigured();
  const clientId = process.env.CANVA_CLIENT_ID || '';
  if (!cfg.oauthReady) {
    return res.status(400).json({
      ok: false,
      error: 'Canva Connect not configured — set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET.',
      connect_url: 'https://www.canva.com/developers/',
    });
  }
  const redirect = encodeURIComponent(
    String(req.query.redirect_uri || `${req.protocol}://${req.get('host')}/api/canva/oauth/callback`)
  );
  const url = `https://www.canva.com/api/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${redirect}&scope=design:content:read%20design:content:write%20design:meta:read`;
  res.json({ ok: true, authorize_url: url });
});

router.get('/oauth/callback', (req, res) => {
  // Scaffold: exchange code for tokens once Connect app is approved.
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Missing authorization code. Return to InfoGenie → Canva and try Connect again.');
  }
  res.send(`<!doctype html><html><body style="font-family:system-ui;padding:40px">
    <h2>Canva Connect</h2>
    <p>Authorization code received. Token exchange will complete once your Canva app is approved for production.</p>
    <p><a href="/create/canva">← Back to Canva in InfoGenie</a></p>
    <script>setTimeout(()=>location.href='/create/canva',2500)</script>
  </body></html>`);
});

// ── POST /design-kit ──────────────────────────────────────────────────────────
// Builds a ready-to-paste creative brief + deep-links into matching Canva templates.
router.post('/design-kit', (req, res) => {
  const {
    type = 'ad-creative',
    title = '',
    body = '',
    cta = 'Learn more',
    brand = '',
    platform = 'Multi',
    colors = [],
  } = req.body || {};
  const cat = TEMPLATE_LIBRARY.find((t) => t.category === type) || TEMPLATE_LIBRARY[3];
  const templates = (cat.templates || []).slice(0, 4).map((t) => ({
    ...t,
    open_url: t.url,
  }));
  const brief = [
    `CANVA DESIGN BRIEF`,
    `Brand: ${brand || 'Your brand'}`,
    `Format: ${cat.label}`,
    `Platform: ${platform}`,
    title ? `Headline: ${title}` : null,
    body ? `Body: ${body}` : null,
    `CTA: ${cta}`,
    colors?.length ? `Brand colors: ${colors.join(', ')}` : null,
    '',
    'Instructions: Open a template below, replace placeholder text with this brief, export PNG/MP4, then upload back into InfoGenie Creatives.',
  ].filter((x) => x != null).join('\n');

  res.json({
    ok: true,
    type: cat.category,
    category_label: cat.label,
    brief,
    templates,
    next: [
      'Open a Canva template',
      'Paste the brief into text layers',
      'Export and upload to InfoGenie Creatives',
    ],
    oauth: _canvaConfigured(),
  });
});

module.exports = router;
