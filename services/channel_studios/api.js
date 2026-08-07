/**
 * P1 channel depth status APIs — Newsletter, Podcast, Push, Social Commerce, Interactive Leads.
 * Aggregates existing services into productized studio hubs.
 */
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[channel-studios]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'channel_studios_error' });
    }
  };
}

async function _count(p, sql, params) {
  try {
    const r = await p.query(sql, params);
    return Number(r.rows[0]?.n || 0);
  } catch { return 0; }
}

router.get('/newsletter/status', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'channels:newsletter' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = _db.hasDb() ? _db.getPool() : null;
  const broadcasts = p ? await _count(p, `SELECT COUNT(*)::int n FROM email_broadcasts WHERE tenant_id=$1`, [tid]) : 0;
  const drips = p ? await _count(p, `SELECT COUNT(*)::int n FROM drip_sequences WHERE tenant_id=$1`, [tid]).catch(() => 0) : 0;
  const tracked = p ? await _count(p, `SELECT COUNT(*)::int n FROM newsletter_targets WHERE tenant_id=$1`, [tid]) : 0;
  const score = Math.min(100, (broadcasts > 0 ? 40 : 0) + (drips > 0 ? 30 : 0) + (tracked > 0 ? 30 : 0));
  res.json({
    ok: true,
    channel: 'newsletter',
    score,
    stats: { broadcasts, dripSequences: drips, competitorTargets: tracked },
    tools: [
      { view: 'email-broadcast', label: 'Email Broadcast', role: 'Send issues' },
      { view: 'email-designer', label: 'Email Designer', role: 'Design' },
      { view: 'automations', label: 'Automations', role: 'Lifecycle' },
      { view: 'newsletter-tracker', label: 'Competitor Newsletter Tracker', role: 'Intel' },
      { view: 'reengage', label: 'Re-Engage', role: 'Win-back' },
    ],
    checklist: [
      { id: 'list', done: broadcasts > 0 || drips > 0, label: 'Send or schedule at least one newsletter/broadcast' },
      { id: 'track', done: tracked > 0, label: 'Track 1+ competitor newsletters' },
      { id: 'automate', done: drips > 0, label: 'Attach a drip/automation sequence' },
    ],
  });
}));

router.get('/podcast/status', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'channels:podcast' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = _db.hasDb() ? _db.getPool() : null;
  const scans = p ? await _count(p, `SELECT COUNT(*)::int n FROM podcast_monitor_runs WHERE tenant_id=$1`, [tid]) : 0;
  const content = p ? await _count(p, `SELECT COUNT(*)::int n FROM content_calendar_runs WHERE tenant_id=$1`, [tid]) : 0;
  const score = Math.min(100, (scans > 0 ? 50 : 10) + (content > 0 ? 30 : 0) + 20);
  res.json({
    ok: true,
    channel: 'podcast',
    score,
    stats: { monitorRuns: scans, contentRuns: content },
    tools: [
      { view: 'podcast-monitor', label: 'Podcast Monitor', role: 'Competitive intel' },
      { view: 'content', label: 'Content AI', role: 'Show notes / episode briefs' },
      { view: 'content-calendar', label: 'Content Calendar', role: 'Distribution plan' },
      { view: 'press-release', label: 'Press Release', role: 'Guest / PR angles' },
      { view: 'short-form-video', label: 'Short-Form Video', role: 'Audiogram-style clips' },
    ],
    checklist: [
      { id: 'scan', done: scans > 0, label: 'Run a podcast mention scan' },
      { id: 'brief', done: content > 0, label: 'Generate episode brief / show notes in Content AI' },
      { id: 'clips', done: false, label: 'Cut audiogram clips via Short-Form Video workflow' },
    ],
    workflow: [
      'Scan competitor / brand podcast mentions',
      'Draft episode brief + show notes',
      'Schedule distribution on Content Calendar',
      'Clip highlights for Shorts/Reels/TikTok',
    ],
  });
}));

router.get('/push/status', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'channels:push' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const hasVapid = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const hasOneSignal = !!process.env.ONESIGNAL_APP_ID;
  const hasFirebase = !!process.env.FIREBASE_SERVER_KEY;
  const p = _db.hasDb() ? _db.getPool() : null;
  const subs = p ? await _count(p, `SELECT COUNT(*)::int n FROM webpush_subscriptions WHERE tenant_id=$1`, [tid]).catch(() => 0) : 0;
  const connected = hasVapid || hasOneSignal || hasFirebase;
  const score = (connected ? 50 : 0) + (subs > 0 ? 40 : 0) + 10;
  res.json({
    ok: true,
    channel: 'push',
    score,
    providers: {
      webPushVapid: hasVapid,
      oneSignal: hasOneSignal,
      firebase: hasFirebase,
    },
    stats: { subscribers: subs },
    tools: [
      { view: 'omnichannel', label: 'Omnichannel Composer', role: 'Compose & send' },
      { view: 'journey-builder', label: 'Journey Builder', role: 'Triggers' },
      { view: 'smart-send', label: 'Smart Send Time', role: 'Timing' },
      { view: 'pixel-manager', label: 'Pixel Manager', role: 'Event triggers' },
      { view: 'execution-hub', label: 'Execution Hub', role: 'Provider keys' },
    ],
    checklist: [
      { id: 'provider', done: connected, label: 'Connect VAPID, OneSignal, or Firebase' },
      { id: 'subs', done: subs > 0, label: 'Collect at least one web-push subscriber' },
      { id: 'journey', done: false, label: 'Wire a journey trigger for abandoned cart / win-back' },
    ],
  });
}));

router.get('/social-commerce/status', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'channels:social-commerce' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = _db.hasDb() ? _db.getPool() : null;
  const products = p ? await _count(p, `SELECT COUNT(*)::int n FROM product_library_items WHERE tenant_id=$1`, [tid]).catch(() => 0) : 0;
  const links = p ? await _count(p, `SELECT COUNT(*)::int n FROM linksell_links WHERE tenant_id=$1`, [tid]).catch(() => 0) : 0;
  const stripe = !!(process.env.STRIPE_SECRET_KEY);
  const score = Math.min(100, (products > 0 ? 35 : 0) + (links > 0 ? 35 : 0) + (stripe ? 30 : 0));
  res.json({
    ok: true,
    channel: 'social-commerce',
    score,
    stats: { products, shoppableLinks: links, stripeConfigured: stripe },
    tools: [
      { view: 'product-library', label: 'Product Library', role: 'Catalog' },
      { view: 'linksell', label: 'Link-in-Bio + Stripe', role: 'Sell' },
      { view: 'social-publisher', label: 'Social Publisher', role: 'Shoppable posts' },
      { view: 'utm-builder', label: 'UTM Builder', role: 'Attribution' },
      { view: 'funnel-analytics', label: 'Funnel Analytics', role: 'SKU / EPC' },
    ],
    checklist: [
      { id: 'catalog', done: products > 0, label: 'Add products to Product Library' },
      { id: 'links', done: links > 0, label: 'Create Link-in-Bio / shoppable links' },
      { id: 'stripe', done: stripe, label: 'Connect Stripe for checkout' },
    ],
  });
}));

router.get('/interactive/status', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'channels:interactive' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = _db.hasDb() ? _db.getPool() : null;
  const surveys = p ? await _count(p, `SELECT COUNT(*)::int n FROM surveys WHERE tenant_id=$1`, [tid]) : 0;
  const responses = p ? await _count(p, `SELECT COUNT(*)::int n FROM survey_responses WHERE tenant_id=$1`, [tid]).catch(() => 0) : 0;
  const leads = p ? await _count(p, `SELECT COUNT(*)::int n FROM lead_intel_leads WHERE tenant_id=$1`, [tid]) : 0;
  const boosters = p ? await _count(p, `SELECT COUNT(*)::int n FROM conversion_boosters WHERE tenant_id=$1`, [tid]).catch(() => 0) : 0;
  const score = Math.min(100, (surveys > 0 ? 30 : 0) + (responses > 0 ? 25 : 0) + (leads > 0 ? 25 : 0) + (boosters > 0 ? 20 : 0));
  res.json({
    ok: true,
    channel: 'interactive',
    score,
    stats: { surveys, responses, leads, conversionBoosters: boosters },
    tools: [
      { view: 'surveys', label: 'Survey Builder', role: 'Quizzes & assessments' },
      { view: 'conversion-boosters', label: 'Conversion Boosters', role: 'Popups / exit intent' },
      { view: 'lead-intelligence', label: 'Lead Intelligence', role: 'Score captured leads' },
      { view: 'audiences-dynamic', label: 'Dynamic Audiences', role: 'Segment responders' },
      { view: 'crm-sync', label: 'CRM Sync', role: 'Push to HubSpot/Mailchimp' },
    ],
    checklist: [
      { id: 'survey', done: surveys > 0, label: 'Publish a survey / quiz with lead capture' },
      { id: 'responses', done: responses > 0, label: 'Collect responses' },
      { id: 'score', done: leads > 0, label: 'Score leads in Lead Intelligence' },
    ],
    workflow: [
      'Build quiz / assessment in Surveys',
      'Capture email + score answers',
      'Ingest into Lead Intelligence',
      'Sync to CRM + Dynamic Audiences',
    ],
  });
}));

module.exports = router;
