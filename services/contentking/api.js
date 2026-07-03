// ContentKing integration — real-time SEO monitoring, change detection, page health.
// API v1: api.contentkingapp.com/v1/
// Requires CONTENTKING_API_KEY (set via Manage → Platform APIs).
// Docs: https://www.contentkingapp.com/support/api/
const express = require('express');
const router  = express.Router();
const _tenantCtx = require('../tenants/context');

const BASE    = 'https://api.contentkingapp.com/v1';
const TIMEOUT = 15000;

function _key()  { return process.env.CONTENTKING_API_KEY || ''; }
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[contentking]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

async function _ckGet(path, params = {}) {
  const key = _key();
  if (!key) throw new Error('CONTENTKING_API_KEY not configured');
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const r = await fetch(`${BASE}/${path}${qs}`, {
    headers: { Authorization: `token ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.detail || data?.message || data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

async function _ckPost(path, body = {}) {
  const key = _key();
  if (!key) throw new Error('CONTENTKING_API_KEY not configured');
  const r = await fetch(`${BASE}/${path}`, {
    method:  'POST',
    headers: { Authorization: `token ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.detail || data?.message || data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

// ── GET /api/contentking/status ───────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({ ok: true, configured: !!_key() });
});

// ── GET /api/contentking/websites ─────────────────────────────────────────
// List all monitored websites.
router.get('/websites', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'CONTENTKING_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'contentking:websites' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const data = await _ckGet('websites');
  const sites = data?.websites || data || [];
  res.json({
    ok: true,
    websites: sites.map(s => ({
      id:            s.id            || '',
      name:          s.name         || s.url || '',
      url:           s.url          || '',
      status:        s.status       || 'unknown',
      pageCount:     s.page_count   ?? s.pages_count ?? null,
      issueCount:    s.issue_count  ?? s.issues_count ?? null,
      lastCheckedAt: s.last_checked || null,
    })),
  });
}));

// ── GET /api/contentking/changes?website_id=&limit= ───────────────────────
// Recent SEO changes detected on a website.
router.get('/changes', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'CONTENTKING_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'contentking:changes' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { website_id, limit = 30 } = req.query;
  if (!website_id) return _err(res, 400, 'website_id required');
  const data = await _ckGet(`websites/${encodeURIComponent(website_id)}/changes`, {
    per_page: Math.min(parseInt(limit, 10) || 30, 100),
  });
  const changes = data?.changes || data?.data || [];
  res.json({
    ok: true,
    websiteId: website_id,
    changes: changes.map(c => ({
      id:           c.id            || '',
      url:          c.url          || c.page_url || '',
      type:         c.type         || c.change_type || '',
      severity:     c.severity     || c.importance  || 'info',
      field:        c.field        || c.element    || '',
      oldValue:     c.old_value    ?? c.from       ?? null,
      newValue:     c.new_value    ?? c.to         ?? null,
      detectedAt:   c.detected_at  || c.created_at || '',
    })),
    total: data?.total || changes.length,
  });
}));

// ── GET /api/contentking/issues?website_id=&limit= ────────────────────────
// Open SEO issues for a website.
router.get('/issues', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'CONTENTKING_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'contentking:issues' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { website_id, limit = 30 } = req.query;
  if (!website_id) return _err(res, 400, 'website_id required');
  const data = await _ckGet(`websites/${encodeURIComponent(website_id)}/issues`, {
    per_page: Math.min(parseInt(limit, 10) || 30, 100),
  });
  const issues = data?.issues || data?.data || [];
  res.json({
    ok: true,
    websiteId: website_id,
    issues: issues.map(i => ({
      id:          i.id           || '',
      url:         i.url         || i.page_url || '',
      type:        i.type        || '',
      severity:    i.severity    || i.priority || 'info',
      description: i.description || i.message  || '',
      pagesCount:  i.pages_count ?? i.affected_pages ?? null,
      detectedAt:  i.detected_at || i.created_at || '',
    })),
    total: data?.total || issues.length,
    summary: {
      critical: issues.filter(i => i.severity === 'critical').length,
      high:     issues.filter(i => ['high','error'].includes(i.severity)).length,
      medium:   issues.filter(i => ['medium','warning'].includes(i.severity)).length,
      low:      issues.filter(i => ['low','info'].includes(i.severity)).length,
    },
  });
}));

// ── GET /api/contentking/pages?website_id=&limit= ─────────────────────────
// Page inventory with health scores.
router.get('/pages', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'CONTENTKING_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'contentking:pages' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { website_id, limit = 20 } = req.query;
  if (!website_id) return _err(res, 400, 'website_id required');
  const data = await _ckGet(`websites/${encodeURIComponent(website_id)}/pages`, {
    per_page: Math.min(parseInt(limit, 10) || 20, 100),
    order_by: 'issues_count',
    order_direction: 'desc',
  });
  const pages = data?.pages || data?.data || [];
  res.json({
    ok: true,
    websiteId: website_id,
    pages: pages.map(p => ({
      url:         p.url          || '',
      title:       p.title        || '',
      statusCode:  p.status_code  ?? null,
      issueCount:  p.issue_count  ?? p.issues_count ?? null,
      isIndexable: p.is_indexable ?? true,
      canonicalUrl: p.canonical_url || null,
      lastChecked: p.last_checked || null,
    })),
    total: data?.total || pages.length,
  });
}));

module.exports = router;
