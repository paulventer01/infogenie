const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const _key = () => process.env.HUNTER_API_KEY || '';
const _hasCreds = () => !!_key();
const BASE = 'https://api.hunter.io/v2';

async function _hunter(path) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${_key()}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'InfoGenie/1.0' },
    signal: AbortSignal.timeout(12000)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.errors?.[0]?.details || data?.message || `Hunter error ${resp.status}`);
  return data;
}

// ── GET /test ─────────────────────────────────────────────────────────────────
router.get('/test', async (req, res) => {
  if (!_hasCreds()) return res.json({ ok: false, configured: false, note: 'Add HUNTER_API_KEY to environment secrets.' });
  try {
    const d = await _hunter('/account');
    res.json({ ok: true, configured: true, plan: d?.data?.plan_name || 'unknown', requests: d?.data?.requests });
  } catch(e) { res.json({ ok: false, configured: true, error: e.message }); }
});

// ── POST /domain-search ───────────────────────────────────────────────────────
// { domain, limit?, type? }
router.post('/domain-search', async (req, res) => {
  if (!_hasCreds()) return _err(res, 503, 'HUNTER_API_KEY not configured. Add it in environment secrets.');
  const domain = String(req.body?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) return _err(res, 400, 'domain required');
  const limit  = Math.min(parseInt(req.body?.limit, 10) || 10, 100);
  const type   = ['personal','generic'].includes(req.body?.type) ? `&type=${req.body.type}` : '';
  try {
    const d = await _hunter(`/domain-search?domain=${encodeURIComponent(domain)}&limit=${limit}${type}`);
    const emails = (d?.data?.emails || []).map(e => ({
      value: e.value,
      type: e.type,
      confidence: e.confidence,
      first_name: e.first_name || '',
      last_name: e.last_name || '',
      position: e.position || '',
      linkedin: e.linkedin || null,
      twitter: e.twitter || null,
      phone_number: e.phone_number || null,
      sources: (e.sources || []).length
    }));
    const result = {
      domain,
      organization: d?.data?.organization || '',
      description: d?.data?.description || '',
      country: d?.data?.country || '',
      emails,
      pattern: d?.data?.pattern || null,
      total: d?.meta?.results || emails.length
    };
    if (_db.hasDb()) {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'hunter:domain' });
      await _db.getPool().query(
        `INSERT INTO hunter_searches (tenant_id, type, query, result) VALUES ($1,'domain',$2,$3)`,
        [tid, domain, JSON.stringify(result)]
      );
    }
    res.json({ ok: true, result });
  } catch(e) { _err(res, 400, e.message); }
});

// ── POST /email-finder ────────────────────────────────────────────────────────
// { domain, first_name, last_name }
router.post('/email-finder', async (req, res) => {
  if (!_hasCreds()) return _err(res, 503, 'HUNTER_API_KEY not configured.');
  const domain     = String(req.body?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  const first_name = String(req.body?.first_name || '').trim();
  const last_name  = String(req.body?.last_name || '').trim();
  if (!domain || !first_name || !last_name) return _err(res, 400, 'domain, first_name and last_name required');
  try {
    const d = await _hunter(`/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(first_name)}&last_name=${encodeURIComponent(last_name)}`);
    const result = {
      email: d?.data?.email || null,
      score: d?.data?.score || 0,
      first_name: d?.data?.first_name || first_name,
      last_name: d?.data?.last_name || last_name,
      position: d?.data?.position || '',
      company: d?.data?.company || '',
      domain,
      sources: (d?.data?.sources || []).length
    };
    if (_db.hasDb()) {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'hunter:finder' });
      await _db.getPool().query(
        `INSERT INTO hunter_searches (tenant_id, type, query, result) VALUES ($1,'finder',$2,$3)`,
        [tid, `${first_name} ${last_name} @ ${domain}`, JSON.stringify(result)]
      );
    }
    res.json({ ok: true, result });
  } catch(e) { _err(res, 400, e.message); }
});

// ── POST /email-verifier ──────────────────────────────────────────────────────
// { email }
router.post('/email-verifier', async (req, res) => {
  if (!_hasCreds()) return _err(res, 503, 'HUNTER_API_KEY not configured.');
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return _err(res, 400, 'valid email required');
  try {
    const d = await _hunter(`/email-verifier?email=${encodeURIComponent(email)}`);
    const result = {
      email,
      status: d?.data?.status || 'unknown',
      score: d?.data?.score || 0,
      regexp: d?.data?.regexp,
      gibberish: d?.data?.gibberish,
      disposable: d?.data?.disposable,
      webmail: d?.data?.webmail,
      mx_records: d?.data?.mx_records,
      smtp_server: d?.data?.smtp_server,
      smtp_check: d?.data?.smtp_check,
      accept_all: d?.data?.accept_all,
      block: d?.data?.block
    };
    if (_db.hasDb()) {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'hunter:verifier' });
      await _db.getPool().query(
        `INSERT INTO hunter_searches (tenant_id, type, query, result) VALUES ($1,'verifier',$2,$3)`,
        [tid, email, JSON.stringify(result)]
      );
    }
    res.json({ ok: true, result });
  } catch(e) { _err(res, 400, e.message); }
});

// ── GET /history ──────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, history: [] });
  const type = ['domain','finder','verifier'].includes(req.query.type) ? req.query.type : null;
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'hunter:history' });
    const params = [tid];
    let typeClause = '';
    if (type) { params.push(type); typeClause = ` AND type=$${params.length}`; }
    const { rows } = await _db.getPool().query(
      `SELECT id,type,query,created_at,
              result->>'total' AS total_emails,
              result->>'email' AS found_email,
              result->>'status' AS verify_status
       FROM hunter_searches WHERE tenant_id=$1${typeClause} ORDER BY created_at DESC LIMIT 50`,
      params
    );
    res.json({ ok: true, history: rows });
  } catch(e) { _err(res, 500, e.message); }
});

module.exports = router;
