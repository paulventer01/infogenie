'use strict';

/**
 * SEO Growth Autopilot API — Growth Plan onboarding, multi-destination publish,
 * daily autopilot loop, Reddit → AEO assist.
 */
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const store = require('./store');
const { researchKeywords, buildCalendar } = require('./generate');
const { publishAll } = require('./destinations');
const { runPlanOnce, runDuePlans } = require('./runner');
const { discoverThreads, draftBrandReply } = require('./reddit_aeo');

const _safeAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function _tid(req, label) {
  const tid = await _tenantCtx.resolveTenantId(req, { label });
  if (tid) return tid;
  if (!_db.hasDb()) return 1;
  return null;
}

router.get('/status', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:status');
  const plan = tid ? await store.getPlan(tid) : null;
  res.json({
    ok: true,
    tenant_id: tid,
    has_plan: !!plan,
    autopilot: !!plan?.autopilot,
    destinations: ['wordpress', 'shopify', 'webhook', 'webflow'],
    next_run_at: plan?.next_run_at || null,
    last_run_at: plan?.last_run_at || null,
    note: 'Growth Plan: niche → keywords → 30-day calendar → autopilot. Publishes to WordPress, Shopify, Webflow, or webhook.',
  });
}));

router.get('/plan', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:plan');
  if (!tid) return _err(res, 400, 'no_tenant');
  const plan = await store.getPlan(tid);
  res.json({ ok: true, plan });
}));

router.put('/plan', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:plan-put');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const plan = await store.upsertPlan(tid, req.body || {});
    res.json({ ok: true, plan });
  } catch (e) {
    return _err(res, 400, e.message);
  }
}));

router.post('/research-keywords', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:keywords');
  if (!tid) return _err(res, 400, 'no_tenant');
  const niche = String(req.body?.niche || '').trim();
  if (!niche) return _err(res, 400, 'niche required');
  const result = await researchKeywords({
    tenantId: tid,
    niche,
    domain: req.body?.domain,
    industry: req.body?.industry || niche,
    competitors: req.body?.competitors || [],
  });
  res.json({ ok: true, ...result });
}));

router.post('/build-calendar', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:calendar');
  if (!tid) return _err(res, 400, 'no_tenant');
  const days = Math.min(60, Math.max(7, parseInt(req.body?.days || 30, 10) || 30));
  const result = await buildCalendar({ keywords: req.body?.keywords, days });
  res.json({ ok: true, ...result });
}));

/** One-shot Growth Plan: niche → keywords → calendar → save (+ optional autopilot). */
router.post('/onboard', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:onboard');
  if (!tid) return _err(res, 400, 'no_tenant');
  const body = req.body || {};
  const niche = String(body.niche || '').trim();
  if (!niche) return _err(res, 400, 'niche required');

  let keywords = Array.isArray(body.keywords) ? body.keywords : [];
  if (!keywords.length) {
    const kw = await researchKeywords({
      tenantId: tid,
      niche,
      domain: body.domain,
      industry: body.industry || niche,
      competitors: body.competitors || [],
    });
    keywords = kw.keywords;
  }

  let calendar = Array.isArray(body.calendar) ? body.calendar : [];
  if (!calendar.length) {
    const cal = await buildCalendar({ keywords, days: body.days || 30 });
    calendar = cal.calendar;
  }

  const destinations = Array.isArray(body.destinations) && body.destinations.length
    ? body.destinations
    : [{ type: 'wordpress', enabled: true }];

  const plan = await store.upsertPlan(tid, {
    niche,
    domain: body.domain,
    brand: body.brand || body.domain,
    industry: body.industry || niche,
    tone: body.tone || 'professional',
    competitors: body.competitors || [],
    keywords,
    calendar,
    destinations,
    autopilot: !!body.autopilot,
    publish_status: body.publish_status || 'draft',
    frequency: body.frequency || 'daily',
  });

  res.json({ ok: true, plan, keywords_count: keywords.length, calendar_days: calendar.length });
}));

router.post('/autopilot', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:toggle');
  if (!tid) return _err(res, 400, 'no_tenant');
  const existing = await store.getPlan(tid);
  if (!existing) return _err(res, 404, 'no_plan — run /onboard first');
  const enabled = req.body?.enabled != null ? !!req.body.enabled : !existing.autopilot;
  const plan = await store.upsertPlan(tid, {
    ...existing,
    autopilot: enabled,
    next_run_at: enabled ? new Date().toISOString() : existing.next_run_at,
  });
  res.json({ ok: true, autopilot: plan.autopilot, plan });
}));

router.post('/run-now', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:run');
  if (!tid) return _err(res, 400, 'no_tenant');
  const plan = await store.getPlan(tid);
  if (!plan) return _err(res, 404, 'no_plan');
  const result = await runPlanOnce(plan, { forceKeyword: req.body?.keyword });
  res.json({ ok: !!result.ok, ...result });
}));

router.post('/run-due', _safeAsync(async (req, res) => {
  const result = await runDuePlans();
  res.json({ ok: true, ...result });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:runs');
  if (!tid) return _err(res, 400, 'no_tenant');
  const limit = Math.min(50, parseInt(req.query.limit || 30, 10) || 30);
  const runs = await store.listRuns(tid, limit);
  res.json({ ok: true, runs });
}));

router.post('/destinations/test', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:dest-test');
  if (!tid) return _err(res, 400, 'no_tenant');
  const destinations = Array.isArray(req.body?.destinations) ? req.body.destinations : [];
  if (!destinations.length) return _err(res, 400, 'destinations array required');
  const results = await publishAll(
    destinations,
    {
      title: req.body?.title || 'InfoGenie SEO Autopilot test post',
      content: '<p>Test publish from SEO Growth Autopilot. Safe to delete.</p>',
      keyword: 'seo autopilot test',
      excerpt: 'Test',
    },
    { tenantId: tid, publishStatus: req.body?.publish_status || 'draft' },
  );
  res.json({ ok: results.some((r) => r.ok), results });
}));

router.post('/reddit-aeo/discover', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:reddit');
  if (!tid) return _err(res, 400, 'no_tenant');
  const plan = await store.getPlan(tid);
  const result = await discoverThreads({
    brand: req.body?.brand || plan?.brand,
    niche: req.body?.niche || plan?.niche,
    subreddits: req.body?.subreddits || [],
    limit: Math.min(15, parseInt(req.body?.limit || 8, 10) || 8),
  });
  res.json({ ok: true, tenant_id: tid, ...result });
}));

router.post('/reddit-aeo/draft-reply', _safeAsync(async (req, res) => {
  const tid = await _tid(req, 'seo-autopilot:reddit-reply');
  if (!tid) return _err(res, 400, 'no_tenant');
  const plan = await store.getPlan(tid);
  const result = await draftBrandReply({
    thread: req.body?.thread || {
      title: req.body?.title,
      subreddit: req.body?.subreddit,
      selftext: req.body?.selftext,
      url: req.body?.url,
    },
    brand: req.body?.brand || plan?.brand,
    niche: req.body?.niche || plan?.niche,
    product: req.body?.product,
    voice: req.body?.voice,
  });
  if (!result.ok) return _err(res, 400, result.error);
  res.json({ ok: true, tenant_id: tid, ...result });
}));

router._store = store;
router._runPlanOnce = runPlanOnce;

module.exports = router;
