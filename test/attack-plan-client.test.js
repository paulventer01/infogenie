'use strict';
// Client-side attack-plan envelope unwrap + honesty + restore fallback.
// Extracts the live helpers from app.js (no copy/paste drift) and drives them
// in jsdom. Does not hit /api/ai-attack-plan or any vendor network (rule 07).

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const SHELL_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'layout', 'AppShell.tsx'),
  'utf8',
);

function sliceBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `anchor not found in app.js: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `end anchor not found in app.js: ${endMarker}`);
  return src.slice(start, end);
}

const helpersBlock = sliceBetween(
  SRC,
  '// ── Attack-plan response helpers (envelope unwrap + honesty) ──',
  '// ── End attack-plan response helpers ──',
);

const dataBadgeBlock = sliceBetween(
  SRC,
  'window._dataBadge = function(level, source) {',
  '// ===== COMPETITOR PLAN VIEW =====',
);

const livePlan = {
  executiveSummary: 'Steal share from Rival with comparison landing pages.',
  opportunityScore: 78,
  estimatedROILift: '+18%',
  timeToResults: '6-8 weeks',
  weeklyPlan: [{ week: 'Week 1–2', focus: 'Setup', actions: ['brief'], kpi: 'pages' }],
  keywordTargets: [{ keyword: 'rival alternative', volume: '1k', cpc: '$4', priority: 'Critical' }],
  criticalWins: [{ win: 'Launch comparison page', impact: 'High', timeframe: 'This week' }],
};

let dom;
let win;
let toasts;
let rendered;
let closed;
let errors;

before(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
  win = dom.window;
  win.eval(
    helpersBlock
    + '\nwindow._unwrapAttackPlanPayload = _unwrapAttackPlanPayload;'
    + '\nwindow._applyAttackPlanResponse = _applyAttackPlanResponse;'
    + '\nwindow._apHonestyBadgeHtml = _apHonestyBadgeHtml;\n'
    + dataBadgeBlock,
  );
  assert.equal(typeof win._unwrapAttackPlanPayload, 'function');
  assert.equal(typeof win._applyAttackPlanResponse, 'function');
  assert.equal(typeof win._apHonestyBadgeHtml, 'function');
  assert.equal(typeof win._dataBadge, 'function');
});

beforeEach(() => {
  toasts = [];
  rendered = [];
  closed = 0;
  errors = [];
  win._apPlanMeta = undefined;
  win._apPlanData = undefined;
  win.showToast = (msg) => { toasts.push(String(msg)); };
  win._apCloseModal = () => { closed += 1; };
  win.renderAttackPlan = (plan, competitor) => { rendered.push({ plan, competitor }); };
  win.console = {
    error: (...args) => { errors.push(args.map(String).join(' ')); },
  };
});

test('live envelope unwraps payload.plan and reports success (not the envelope)', () => {
  const payload = { ok: true, plan: livePlan, sources: ['GPT-4o'] };
  const unwrapped = win._unwrapAttackPlanPayload(payload);
  assert.strictEqual(unwrapped.ok, true);
  assert.strictEqual(unwrapped.plan, livePlan);
  assert.strictEqual(unwrapped.plan.executiveSummary, livePlan.executiveSummary);
  assert.strictEqual(unwrapped.fabricated, false);
  assert.notStrictEqual(unwrapped.source, 'template');
  assert.deepStrictEqual(unwrapped.sources, ['GPT-4o']);

  const applied = win._applyAttackPlanResponse(payload, 'Rival');
  assert.strictEqual(applied, true);
  assert.strictEqual(closed, 0);
  assert.strictEqual(rendered.length, 1);
  assert.strictEqual(rendered[0].plan, livePlan);
  assert.strictEqual(rendered[0].competitor, 'Rival');
  assert.ok(toasts.some((t) => t.includes('Attack plan ready')));
  assert.ok(!toasts.some((t) => t.includes('Could not generate')));
});

test('template envelope unwraps the nested plan and flags fabricated', () => {
  const templatePlan = { ...livePlan, executiveSummary: 'Template strategy vs Rival.' };
  const payload = {
    ok: true,
    plan: templatePlan,
    sources: ['template'],
    source: 'template',
    _fabricated: true,
  };
  const unwrapped = win._unwrapAttackPlanPayload(payload);
  assert.strictEqual(unwrapped.ok, true);
  assert.strictEqual(unwrapped.plan, templatePlan);
  assert.strictEqual(unwrapped.fabricated, true);
  assert.strictEqual(unwrapped.source, 'template');

  const applied = win._applyAttackPlanResponse(payload, 'Rival');
  assert.strictEqual(applied, true);
  assert.strictEqual(win._apPlanMeta.fabricated, true);
  assert.strictEqual(win._apPlanMeta.source, 'template');
  const badge = win._apHonestyBadgeHtml(win._apPlanMeta);
  assert.match(badge, /ESTIMATE/i);
  assert.match(badge, /template/i);
  assert.doesNotMatch(badge, /AI ANALYSIS/i);
});

test('bare plan (no envelope) still renders instead of blanking', () => {
  const unwrapped = win._unwrapAttackPlanPayload(livePlan);
  assert.strictEqual(unwrapped.ok, true);
  assert.strictEqual(unwrapped.plan, livePlan);
  assert.strictEqual(unwrapped.plan.executiveSummary, livePlan.executiveSummary);
  assert.strictEqual(win._applyAttackPlanResponse(livePlan, 'Rival'), true);
  assert.strictEqual(rendered[0].plan, livePlan);
});

test('ok:false / plan:null is a failure — close modal, failure toast, no success toast', () => {
  const payload = { ok: false, plan: null, error: 'Both AI models failed to generate a plan' };
  const unwrapped = win._unwrapAttackPlanPayload(payload);
  assert.strictEqual(unwrapped.ok, false);
  assert.strictEqual(unwrapped.plan, null);
  assert.match(unwrapped.error, /Both AI models failed/);

  const applied = win._applyAttackPlanResponse(payload, 'Rival');
  assert.strictEqual(applied, false);
  assert.strictEqual(rendered.length, 0);
  assert.strictEqual(closed, 1);
  assert.ok(toasts.some((t) => t.includes('Could not generate attack plan')));
  assert.ok(!toasts.some((t) => t.includes('Attack plan ready')));
  assert.ok(errors.some((e) => e.includes('Both AI models failed')));
});

test('ok:true with a missing/null plan is a failure, not a blank success', () => {
  const payload = { ok: true, plan: null, error: 'plan missing' };
  assert.strictEqual(win._unwrapAttackPlanPayload(payload).ok, false);
  assert.strictEqual(win._applyAttackPlanResponse(payload, 'Rival'), false);
  assert.strictEqual(rendered.length, 0);
  assert.strictEqual(closed, 1);
  assert.ok(toasts.some((t) => t.includes('Could not generate')));
  assert.ok(!toasts.some((t) => t.includes('Attack plan ready')));
});

test('live sources badge is AI ANALYSIS, never ESTIMATE/template', () => {
  const badge = win._apHonestyBadgeHtml({
    source: '',
    fabricated: false,
    sources: ['GPT-4o', 'Claude'],
  });
  assert.match(badge, /AI ANALYSIS/i);
  assert.match(badge, /GPT-4o/);
  assert.match(badge, /Claude/);
  assert.doesNotMatch(badge, /ESTIMATE/i);
  assert.doesNotMatch(badge, /template/i);
});

test('openFullAttackPlanModal falls back to window.analysisData via _resolveAnalysisData', () => {
  const start = SRC.indexOf('function _resolveAnalysisData()');
  const end = SRC.indexOf('window._syncBareAnalysisData', start);
  assert.ok(start !== -1 && end !== -1, 'expected _resolveAnalysisData in app.js');
  const resolveSrc = SRC.slice(start, end);
  assert.match(resolveSrc, /if \(analysisData\) return analysisData/);
  assert.match(resolveSrc, /window\.analysisData/);
  assert.match(resolveSrc, /analysisData = window\.analysisData/);

  const modalStart = SRC.indexOf('window.openFullAttackPlanModal = function');
  const modalEnd = SRC.indexOf('function closePlanModal()', modalStart);
  const modalSrc = SRC.slice(modalStart, modalEnd);
  assert.match(modalSrc, /_resolveAnalysisData\(\)/);
  assert.match(modalSrc, /_applyAttackPlanResponse\(payload/);
  assert.doesNotMatch(modalSrc, /renderAttackPlan\(plan,/);

  assert.match(SHELL_SRC, /_syncBareAnalysisData\?\.\(\)/);
});
