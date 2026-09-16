'use strict';

const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { ensureMarketingPlanSchema } = require('./schema');
const { STEPS, emptyPlan, emptySteps, stepComplete, summarize } = require('./steps');

const _mem = new Map();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    console.warn('[marketing-plan]', e.message);
    if (!res.headersSent) _err(res, 500, e.message || 'Internal server error');
  });
}

function _normalizeSteps(raw) {
  const base = emptySteps();
  const incoming = raw && typeof raw === 'object' ? raw : {};
  for (const s of STEPS) {
    const id = String(s.id);
    const row = incoming[id] || incoming[s.id] || {};
    const fields = row.fields && typeof row.fields === 'object' ? row.fields : {};
    const clean = {};
    for (const f of s.fields) {
      if (fields[f.key] === undefined) continue;
      if (f.type === 'chips') {
        clean[f.key] = Array.isArray(fields[f.key])
          ? fields[f.key].map((x) => String(x).slice(0, 40)).slice(0, 8)
          : String(fields[f.key] || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);
      } else {
        clean[f.key] = String(fields[f.key] || '').slice(0, 4000);
      }
    }
    const completed = row.completed === true || stepComplete(s, clean);
    base[id] = { completed, fields: clean };
  }
  return base;
}

function _shape(row) {
  const plan = {
    title: row.title || 'Revenue Marketing Plan',
    current_step: Math.max(1, Math.min(10, parseInt(row.current_step, 10) || 1)),
    steps: _normalizeSteps(row.steps_json || row.steps),
    updated_at: row.updated_at || null,
  };
  return { ...plan, progress: summarize(plan), catalog: STEPS };
}

async function _load(tid) {
  if (!_db.hasDb()) return _shape(_mem.get(tid) || emptyPlan());
  await ensureMarketingPlanSchema();
  const r = await _db.getPool().query(
    `SELECT title, current_step, steps_json, updated_at FROM marketing_plans WHERE tenant_id=$1`,
    [tid],
  );
  if (!r.rows[0]) return _shape(emptyPlan());
  return _shape(r.rows[0]);
}

async function _save(tid, plan) {
  const title = String(plan.title || 'Revenue Marketing Plan').slice(0, 160);
  const current = Math.max(1, Math.min(10, parseInt(plan.current_step, 10) || 1));
  const steps = _normalizeSteps(plan.steps);
  if (!_db.hasDb()) {
    const stored = { title, current_step: current, steps_json: steps, updated_at: new Date().toISOString() };
    _mem.set(tid, stored);
    return _shape(stored);
  }
  await ensureMarketingPlanSchema();
  const r = await _db.getPool().query(
    `INSERT INTO marketing_plans (tenant_id, title, current_step, steps_json, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       title = EXCLUDED.title,
       current_step = EXCLUDED.current_step,
       steps_json = EXCLUDED.steps_json,
       updated_at = NOW()
     RETURNING title, current_step, steps_json, updated_at`,
    [tid, title, current, JSON.stringify(steps)],
  );
  return _shape(r.rows[0]);
}

ensureMarketingPlanSchema().catch((e) => console.warn('[marketing-plan] schema:', e.message));

router.get('/', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'marketing_plan:get' });
  if (!tid) return _err(res, 400, 'no_tenant');
  res.json({ ok: true, plan: await _load(tid) });
}));

router.put('/', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'marketing_plan:put' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const cur = await _load(tid);
  const next = {
    title: req.body?.title != null ? req.body.title : cur.title,
    current_step: req.body?.current_step != null ? req.body.current_step : cur.current_step,
    steps: req.body?.steps != null ? req.body.steps : cur.steps,
  };
  res.json({ ok: true, plan: await _save(tid, next) });
}));

router.patch('/steps/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'marketing_plan:patch' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const id = parseInt(req.params.id, 10);
  if (!STEPS.find((s) => s.id === id)) return _err(res, 400, 'invalid_step');
  const cur = await _load(tid);
  const prev = cur.steps[String(id)] || { completed: false, fields: {} };
  cur.steps[String(id)] = {
    fields: { ...prev.fields, ...(req.body?.fields || {}) },
    completed: req.body?.completed === true || prev.completed,
  };
  if (req.body?.advance) cur.current_step = Math.min(10, id + 1);
  else cur.current_step = id;
  res.json({ ok: true, plan: await _save(tid, cur) });
}));

router.post('/reset', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'marketing_plan:reset' });
  if (!tid) return _err(res, 400, 'no_tenant');
  res.json({ ok: true, plan: await _save(tid, emptyPlan()) });
}));

module.exports = { router, _normalizeSteps, _shape };
