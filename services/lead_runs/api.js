// services/lead_runs/api.js — server-side recent lead-gen runs.
//
// The unified Lead Generation hub (components/features/reach/LeadGenHub.tsx)
// records every successful run so users can jump back to — and re-run — a past
// search. Previously this lived only in browser localStorage (key
// `ig_leadgen_recent_v1`), so it vanished when a user switched devices or
// cleared their browser. This router persists the same list server-side,
// scoped per (tenant, user), so the recent-runs panel follows the user across
// sessions and devices. localStorage stays as an offline fallback in the UI.
//
// Storage: a single kv_store blob per (tenant, user):
//   leadgen_recent:t<tid>:u<userId>      (authenticated session callers)
//   leadgen_recent:t<tid>:shared         (api-key callers with no user)
// holding the newest-first array of runs (capped at RECENT_MAX).
//
// Multitenant enforcement is ON: every handler resolves the tenant via
// resolveTenantId(req, {label}) with no allowFallback. Routes are gated in
// services/tenants/permission_matrix.js under reach.leads.

const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

const RECENT_MAX = 12;
const BASE = 'leadgen_recent';

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

// Per-(tenant, user) kv key. api-key callers (no session user) share one
// tenant-level bucket so the feature still degrades gracefully.
function _key(tid, req) {
  const uid = req.user && req.user.id ? `u${req.user.id}` : 'shared';
  return `${BASE}:t${tid}:${uid}`;
}

// ── Sanitisers — recent runs are user-authored blobs; keep them small and
// well-shaped so a malformed client can never bloat or corrupt the store.
function _str(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, max);
}
function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Params are an opaque (mode-tagged) replay payload. We keep only primitive
// values and cap each string so a single run can't grow unbounded.
function _sanitizeParams(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (Object.keys(out).length >= 24) break;
    const key = _str(k, 40);
    if (typeof v === 'number') out[key] = Number.isFinite(v) ? v : 0;
    else if (typeof v === 'boolean') out[key] = v;
    else out[key] = _str(v, 200);
  }
  if (!out.mode) return null;
  return out;
}

function _sanitizeRun(r) {
  if (!r || typeof r !== 'object') return null;
  const params = _sanitizeParams(r.params);
  if (!params) return null;
  const ts = _num(r.ts) || Date.now();
  return {
    id: _str(r.id, 80) || `${params.mode}-${ts}`,
    label: _str(r.label, 120),
    sublabel: _str(r.sublabel, 200),
    ts,
    count: Math.max(0, Math.round(_num(r.count))),
    params,
  };
}

async function _load(tid, req) {
  const raw = await _db.kvGet(_key(tid, req), null);
  return Array.isArray(raw) ? raw : [];
}

async function _save(tid, req, list) {
  await _db.kvSet(_key(tid, req), list.slice(0, RECENT_MAX));
}

// GET /api/lead-runs — list this user's recent runs (newest first).
router.get('/', async (req, res) => {
  try {
    const tid = await _tid(req, 'lead_runs:list');
    if (!tid) return _err(res, 400, 'no_tenant');
    const runs = await _load(tid, req);
    res.json({ ok: true, runs });
  } catch (e) {
    console.error('[lead_runs] list:', e.message);
    _err(res, 500, 'Failed to load recent runs');
  }
});

// POST /api/lead-runs — append a run. Dedupes by (mode, sublabel), newest wins,
// capped at RECENT_MAX. Returns the updated list.
router.post('/', async (req, res) => {
  try {
    const tid = await _tid(req, 'lead_runs:append');
    if (!tid) return _err(res, 400, 'no_tenant');
    const entry = _sanitizeRun((req.body || {}).run || req.body);
    if (!entry) return _err(res, 400, 'Invalid run payload');
    const prev = await _load(tid, req);
    const deduped = prev.filter(
      (r) => !(r && r.params && r.params.mode === entry.params.mode && r.sublabel === entry.sublabel),
    );
    const next = [entry, ...deduped].slice(0, RECENT_MAX);
    await _save(tid, req, next);
    res.json({ ok: true, runs: next });
  } catch (e) {
    console.error('[lead_runs] append:', e.message);
    _err(res, 500, 'Failed to save run');
  }
});

// DELETE /api/lead-runs — clear this user's recent runs.
router.delete('/', async (req, res) => {
  try {
    const tid = await _tid(req, 'lead_runs:clear');
    if (!tid) return _err(res, 400, 'no_tenant');
    await _save(tid, req, []);
    res.json({ ok: true, runs: [] });
  } catch (e) {
    console.error('[lead_runs] clear:', e.message);
    _err(res, 500, 'Failed to clear recent runs');
  }
});

module.exports = router;
