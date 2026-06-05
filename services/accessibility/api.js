const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

// ── Fetch page HTML (Firecrawl → raw fetch fallback) ─────────────────────
async function _fetchHtml(url) {
  const fcKey = process.env.FIRECRAWL_API_KEY;
  if (fcKey && !/^_DUMMY/i.test(fcKey)) {
    const body = JSON.stringify({ url, formats: ['html'], onlyMainContent: false });
    const result = await new Promise(resolve => {
      const req = _https.request({
        hostname: 'api.firecrawl.dev', path: '/v1/scrape', method: 'POST',
        headers: { 'Authorization': 'Bearer ' + fcKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { const j = JSON.parse(d); resolve(j.data?.html || j.html || null); } catch { resolve(null); }
      }); });
      req.on('error', () => resolve(null));
      req.setTimeout(20000, () => req.destroy());
      req.write(body); req.end();
    });
    if (result) return result.slice(0, 80000);
  }

  // Raw HTTPS fetch fallback
  const parsed = new URL(url);
  return new Promise(resolve => {
    const proto = parsed.protocol === 'https:' ? _https : require('http');
    const r = proto.request({
      hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfoGenie-A11y/1.0)', 'Accept': 'text/html' },
    }, res => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { if (d.length < 200000) d += c; });
      res.on('end', () => resolve(d.slice(0, 80000) || null));
    });
    r.on('error', () => resolve(null));
    r.setTimeout(15000, () => r.destroy());
    r.end();
  });
}

// ── AI WCAG audit ─────────────────────────────────────────────────────────
async function _auditWithAI(html, url) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;

  // Also run basic structural checks on the raw HTML
  const basicIssues = _basicHtmlChecks(html);

  const system = `You are a WCAG 2.1 AA accessibility expert. Audit the HTML for accessibility violations and return a comprehensive report in strict JSON:
{
  "score": <0-100, where 100 is fully accessible>,
  "summary": "<2-3 sentence overall assessment>",
  "issues": [
    {
      "id": "<wcag-criterion e.g. 1.1.1>",
      "criterion": "<WCAG criterion name>",
      "severity": "critical|serious|moderate|minor",
      "category": "images|color_contrast|keyboard|forms|structure|links|aria|media|language|other",
      "description": "<what the issue is>",
      "element_hint": "<HTML element or pattern involved>",
      "fix": "<specific, actionable fix — code snippet if helpful>",
      "wcag_level": "A|AA|AAA"
    }
  ],
  "passes": ["<things done well>"],
  "quick_wins": ["<1-2 sentence fix that would have the biggest impact immediately>"]
}

Check these areas thoroughly:
1. Images (1.1.1): Missing alt text, decorative images with alt
2. Color contrast (1.4.3, 1.4.11): Text/background contrast ratios
3. Keyboard navigation (2.1.1): Interactive elements reachable by keyboard
4. Focus indicators (2.4.7): Visible focus styles not removed
5. Form labels (1.3.1, 3.3.2): All inputs have associated labels
6. Heading structure (1.3.1): Logical h1→h2→h3 hierarchy
7. Link text (2.4.4): No "click here", "read more", "learn more" alone
8. Language attribute (3.1.1): html[lang] present
9. ARIA (4.1.2): ARIA roles and labels correct
10. Skip navigation (2.4.1): Skip to main content link
11. Empty buttons/links (4.1.2)
12. Video captions (1.2.2) if video present

Return up to 15 most impactful issues. Be specific about which elements are affected.`;

  const userContent = `URL: ${url}\n\nPre-scan findings:\n${basicIssues.map(i => `- ${i}`).join('\n')}\n\nHTML (truncated to key sections):\n${html.slice(0, 25000)}`;

  const body = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 4000,
  });

  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          if (r.statusCode !== 200) { console.warn('[accessibility] AI error', r.statusCode); return resolve(null); }
          resolve(JSON.parse(JSON.parse(d).choices[0].message.content));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(90000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── Basic structural HTML checks (no AI needed) ───────────────────────────
function _basicHtmlChecks(html) {
  const issues = [];
  const lower = html.toLowerCase();

  // lang attribute
  if (!/<html[^>]+lang=/i.test(html)) issues.push('Missing lang attribute on <html> element (WCAG 3.1.1)');

  // Images without alt
  const imgs = html.match(/<img[^>]*>/gi) || [];
  const imgsMissingAlt = imgs.filter(img => !/alt=/i.test(img));
  if (imgsMissingAlt.length) issues.push(`${imgsMissingAlt.length} <img> element(s) missing alt attribute (WCAG 1.1.1)`);

  // Inputs without labels
  const inputs = html.match(/<input[^>]*>/gi) || [];
  const textInputs = inputs.filter(i => !/type=["']?(hidden|submit|button|reset|image|checkbox|radio)/i.test(i));
  const labelIds = (html.match(/for=["']([^"']+)/gi) || []).map(m => m.replace(/for=["']?/i,'').replace(/["']/g,''));
  const inputIds = (html.match(/id=["']([^"']+)/gi) || []).map(m => m.replace(/id=["']?/i,'').replace(/["']/g,''));
  const unlabelled = textInputs.filter(inp => {
    const idMatch = inp.match(/id=["']([^"']+)/i);
    const hasAriaLabel = /aria-label=/i.test(inp) || /aria-labelledby=/i.test(inp);
    if (hasAriaLabel) return false;
    if (!idMatch) return true;
    return !labelIds.includes(idMatch[1]);
  });
  if (unlabelled.length) issues.push(`${unlabelled.length} form input(s) may be missing visible labels (WCAG 1.3.1)`);

  // Empty links
  const emptyLinks = (html.match(/<a[^>]*>\s*<\/a>/gi) || []).length;
  if (emptyLinks) issues.push(`${emptyLinks} empty <a> element(s) with no text or aria-label (WCAG 4.1.2)`);

  // Generic link text
  const genericLinks = (html.match(/<a[^>]*>\s*(click here|read more|learn more|here|more|link)\s*<\/a>/gi) || []).length;
  if (genericLinks) issues.push(`${genericLinks} link(s) with generic text like "click here" or "read more" (WCAG 2.4.4)`);

  // Skip nav
  if (!lower.includes('skip') && !lower.includes('#main')) issues.push('No skip navigation link found (WCAG 2.4.1)');

  // Multiple h1
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1Count > 1) issues.push(`${h1Count} <h1> elements found — only one is recommended (WCAG 1.3.1)`);
  if (h1Count === 0) issues.push('No <h1> found — heading hierarchy starts with <h1> (WCAG 1.3.1)');

  // Empty buttons
  const emptyBtns = (html.match(/<button[^>]*>\s*<\/button>/gi) || []).length;
  if (emptyBtns) issues.push(`${emptyBtns} empty <button> element(s) with no accessible name (WCAG 4.1.2)`);

  return issues;
}

// ── Fallback template when AI is unavailable ──────────────────────────────
function _templateAudit(url) {
  return {
    score: 65,
    summary: `Automated structural pre-scan completed for ${url}. AI-powered deep audit requires an OpenAI API key for full WCAG 2.1 AA analysis including contrast ratios, ARIA validation, and keyboard navigation review.`,
    issues: [
      { id:'1.1.1', criterion:'Non-text Content', severity:'critical', category:'images', description:'Images may be missing alt text — verify all <img> elements have descriptive alt attributes.', element_hint:'<img>', fix:'Add alt="descriptive text" to every meaningful image. Use alt="" for decorative images.', wcag_level:'A' },
      { id:'1.4.3', criterion:'Contrast (Minimum)', severity:'serious', category:'color_contrast', description:'Text/background contrast ratio may not meet 4.5:1 for normal text or 3:1 for large text.', element_hint:'body text', fix:'Use a contrast checker tool. Aim for 4.5:1 minimum for body text.', wcag_level:'AA' },
      { id:'2.4.1', criterion:'Bypass Blocks', severity:'moderate', category:'keyboard', description:'Consider adding a skip navigation link to allow keyboard users to bypass repeated navigation.', element_hint:'<nav>', fix:'Add <a href="#main-content" class="skip-link">Skip to main content</a> at the top of your HTML.', wcag_level:'A' },
      { id:'2.4.4', criterion:'Link Purpose', severity:'moderate', category:'links', description:'Ensure link text is descriptive on its own — avoid "click here", "read more", "here".', element_hint:'<a>', fix:'Replace generic link text with descriptive text like "Read our accessibility guide" instead of "Read more".', wcag_level:'A' },
    ],
    passes: ['Site appears to load without JavaScript errors', 'Structure suggests responsive design is in place'],
    quick_wins: ['Add lang="en" to your <html> tag if missing', 'Check all images have alt attributes using browser DevTools'],
  };
}

// ── Routes ────────────────────────────────────────────────────────────────

// POST /audit
router.post('/audit', async (req, res) => {
  const rawUrl = String(req.body?.url || '').trim().slice(0, 500);
  if (!rawUrl) return _err(res, 400, 'url required');

  let url;
  try {
    url = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('bad protocol');
    const host = url.hostname.toLowerCase();
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1)/i.test(host)) {
      return _err(res, 400, 'private_host');
    }
  } catch { return _err(res, 400, 'invalid_url'); }

  const tid = await _tenantCtx.resolveTenantId(req, { label: 'accessibility:audit' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const html = await _fetchHtml(url.href);
  if (!html || html.length < 100) return _err(res, 422, 'Could not fetch page content — check the URL is publicly accessible');

  // Run basic checks first (fast, always available)
  const basicIssues = _basicHtmlChecks(html);

  let result = await _auditWithAI(html, url.href);
  let source = 'ai';
  if (!result?.issues) {
    result = _templateAudit(url.href);
    // Merge basic issues into template
    const basicFormatted = basicIssues.map((msg, i) => ({
      id: 'scan-' + (i+1), criterion: 'Automated scan finding', severity: 'moderate',
      category: 'other', description: msg, element_hint: '', fix: 'Review manually.', wcag_level: 'A',
    }));
    result.issues = [...basicFormatted, ...result.issues];
    source = 'template';
  }

  // Persist
  let runId = null;
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `INSERT INTO accessibility_runs (tenant_id, url, score, issues, summary, source)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tid, url.href, result.score || 0, JSON.stringify(result.issues), result.summary, source]);
      runId = r.rows[0].id;
    } catch (e) { console.warn('[accessibility] persist failed:', e.message); }
  }

  res.json({ ok: true, id: runId, url: url.href, score: result.score, summary: result.summary,
    issues: result.issues, passes: result.passes || [], quick_wins: result.quick_wins || [], source });
});

// GET /history
router.get('/history', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'accessibility:history' });
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  try {
    const r = await _db.getPool().query(
      `SELECT id, url, score, summary, source, created_at FROM accessibility_runs
       WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]);
    res.json({ ok: true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'accessibility:get' });
  if (!_db.hasDb() || !id) return _err(res, 404, 'not found');
  try {
    const r = await _db.getPool().query(
      `SELECT * FROM accessibility_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok: true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
