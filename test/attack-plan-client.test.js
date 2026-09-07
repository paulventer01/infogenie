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
    + '\nwindow._unwrapAttackPlanListPayload = _unwrapAttackPlanListPayload;'
    + '\nwindow._applyAttackPlanResponse = _applyAttackPlanResponse;'
    + '\nwindow._apHonestyBadgeHtml = _apHonestyBadgeHtml;\n'
    + dataBadgeBlock,
  );
  assert.equal(typeof win._unwrapAttackPlanPayload, 'function');
  assert.equal(typeof win._unwrapAttackPlanListPayload, 'function');
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
  const leftover = win.document.getElementById('attackPlanModal');
  if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
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

test('withheld POST path still dispatches ig:attack-plan-saved so the list refreshes', () => {
  const fired = [];
  const onSaved = () => { fired.push('ig:attack-plan-saved'); };
  win.addEventListener('ig:attack-plan-saved', onSaved);
  const payload = {
    ok: true,
    data_unavailable: true,
    _dataMode: 'strict',
    source: 'data_unavailable',
    message: 'This data is currently unavailable. The issue has been reported to your administrator.',
  };
  const applied = win._applyAttackPlanResponse(payload, 'Rival');
  win.removeEventListener('ig:attack-plan-saved', onSaved);
  assert.strictEqual(applied, false);
  assert.deepStrictEqual(fired, ['ig:attack-plan-saved']);
  assert.ok(!toasts.some((t) => t.includes('Attack plan ready')));
  assert.ok(!toasts.some((t) => /saved/i.test(t) && !/withheld/i.test(t)));
  assert.ok(toasts.some((t) => /withheld/i.test(t) && /strict/i.test(t)));
  const modal = win.document.getElementById('attackPlanModal');
  assert.ok(modal);
  assert.match(modal.innerHTML, /Attack plan withheld/);
  assert.doesNotMatch(modal.innerHTML, /Attack plan ready/);
});

test('strict data_unavailable envelope is withheld — honest message, no plan, no success toast', () => {
  const payload = {
    ok: true,
    data_unavailable: true,
    _dataMode: 'strict',
    source: 'data_unavailable',
    message: 'This data is currently unavailable. The issue has been reported to your administrator.',
  };
  const unwrapped = win._unwrapAttackPlanPayload(payload);
  assert.strictEqual(unwrapped.ok, false);
  assert.strictEqual(unwrapped.withheld, true);
  assert.strictEqual(unwrapped.plan, null);
  assert.strictEqual(unwrapped.source, 'data_unavailable');
  assert.match(unwrapped.message, /currently unavailable/);
  assert.match(unwrapped.error, /currently unavailable/);

  const applied = win._applyAttackPlanResponse(payload, 'Rival');
  assert.strictEqual(applied, false);
  assert.strictEqual(rendered.length, 0);
  assert.strictEqual(closed, 0, 'modal stays open so the user can read the withheld message');
  assert.ok(!toasts.some((t) => t.includes('Attack plan ready')));
  assert.ok(!toasts.some((t) => t.includes('Could not generate')));
  assert.ok(toasts.some((t) => /withheld/i.test(t) && /strict/i.test(t)));

  const modal = win.document.getElementById('attackPlanModal');
  assert.ok(modal, 'withheld state is shown inside the already-open modal');
  assert.match(modal.innerHTML, /Attack plan withheld/);
  assert.match(modal.innerHTML, /currently unavailable/);
  assert.match(modal.innerHTML, /administrator/);
  assert.match(modal.innerHTML, /Strict data mode/);
  assert.match(modal.innerHTML, /retrying will not generate a plan/i);
  assert.doesNotMatch(modal.innerHTML, /Attack plan ready/);
});

test('source:data_unavailable without the boolean flag is still withheld', () => {
  const payload = { ok: true, source: 'data_unavailable' };
  const unwrapped = win._unwrapAttackPlanPayload(payload);
  assert.strictEqual(unwrapped.withheld, true);
  assert.strictEqual(unwrapped.ok, false);
  assert.strictEqual(unwrapped.plan, null);
  assert.match(unwrapped.message, /strict data mode/i);

  assert.strictEqual(win._applyAttackPlanResponse(payload, 'Rival'), false);
  assert.strictEqual(rendered.length, 0);
  assert.strictEqual(closed, 0);
  const modal = win.document.getElementById('attackPlanModal');
  assert.match(modal.innerHTML, /strict data mode/i);
});

test('withheld server message is escaped, never interpolated raw into innerHTML', () => {
  const payload = {
    ok: true,
    data_unavailable: true,
    source: 'data_unavailable',
    message: '<img src=x onerror=alert(1)>injected-unavailable',
  };
  assert.strictEqual(win._applyAttackPlanResponse(payload, 'Rival'), false);
  const html = win.document.getElementById('attackPlanModal').innerHTML;
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /injected-unavailable/);
});

test('demo-mode template passthrough renders the plan WITH the honesty badge', () => {
  const templatePlan = { ...livePlan, executiveSummary: 'Template strategy vs Rival.' };
  const payload = {
    ok: true,
    plan: templatePlan,
    sources: ['template'],
    source: 'template',
    _fabricated: true,
    _dataMode: 'demo',
    _demo: true,
  };
  const unwrapped = win._unwrapAttackPlanPayload(payload);
  assert.strictEqual(unwrapped.ok, true);
  assert.strictEqual(unwrapped.withheld, false);
  assert.strictEqual(unwrapped.plan, templatePlan);
  assert.strictEqual(unwrapped.fabricated, true);
  assert.strictEqual(unwrapped.source, 'template');

  const applied = win._applyAttackPlanResponse(payload, 'Rival');
  assert.strictEqual(applied, true);
  assert.strictEqual(rendered.length, 1);
  assert.strictEqual(rendered[0].plan, templatePlan);
  assert.strictEqual(win._apPlanMeta.fabricated, true);
  assert.strictEqual(win._apPlanMeta.source, 'template');
  const badge = win._apHonestyBadgeHtml(win._apPlanMeta);
  assert.match(badge, /ESTIMATE/i);
  assert.match(badge, /template/i);
  assert.doesNotMatch(badge, /AI ANALYSIS/i);
  assert.ok(toasts.some((t) => t.includes('Attack plan ready')));
  assert.ok(!toasts.some((t) => t.includes('Could not generate')));
  assert.ok(!toasts.some((t) => /withheld/i.test(t)));
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

const graceBlock = sliceBetween(
  SRC,
  '// Brief grace after open so a second click',
  '// ── Attack-plan response helpers (envelope unwrap + honesty) ──',
);
const savedOpenBlock = sliceBetween(
  SRC,
  'window.openSavedAttackPlan = function',
  'window.openFullAttackPlanModal = function',
);

test('_apApplyOpenGrace suppresses pointer interaction briefly then restores', async () => {
  const gdom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
  const gwin = gdom.window;
  gwin.eval(graceBlock + '\nwindow._apApplyOpenGrace = _apApplyOpenGrace;\n');
  const modal = gwin.document.createElement('div');
  const inner = gwin.document.createElement('div');
  modal.appendChild(inner);
  gwin.document.body.appendChild(modal);
  gwin._apApplyOpenGrace(modal);
  assert.strictEqual(modal.dataset.apGrace, '1');
  assert.strictEqual(inner.style.pointerEvents, 'none');
  await new Promise((r) => setTimeout(r, 450));
  assert.strictEqual(modal.dataset.apGrace, undefined);
  assert.strictEqual(inner.style.pointerEvents, '');
});

test('openSavedAttackPlan sets honesty meta before renderAttackPlan', () => {
  const sdom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
  const swin = sdom.window;
  const order = [];
  swin.eval(
    helpersBlock
    + '\nwindow._unwrapAttackPlanPayload = _unwrapAttackPlanPayload;'
    + savedOpenBlock,
  );
  swin.showToast = () => {};
  swin.renderAttackPlan = (plan, competitor) => {
    order.push({
      meta: swin._apPlanMeta ? { ...swin._apPlanMeta } : null,
      plan,
      competitor,
    });
  };
  const templatePlan = { ...livePlan, executiveSummary: 'Saved template plan.' };
  const payload = {
    ok: true,
    plan: templatePlan,
    competitor: 'IG Markets',
    sources: ['template'],
    source: 'template',
    _fabricated: true,
  };
  assert.strictEqual(swin.openSavedAttackPlan(payload, 'IG Markets'), true);
  assert.strictEqual(order.length, 1);
  assert.strictEqual(order[0].meta.fabricated, true);
  assert.strictEqual(order[0].meta.source, 'template');
  assert.deepStrictEqual(order[0].meta.sources, ['template']);
  assert.strictEqual(order[0].plan, templatePlan);
  assert.strictEqual(order[0].competitor, 'IG Markets');
});

const BP_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'features', 'analyse', 'Battleplan.tsx'),
  'utf8',
);

test('saved-plan surface is reachable without analysisData and follows the shell restore events', () => {
  assert.doesNotMatch(
    BP_SRC,
    /useMemo\(\s*getAnalysisData\s*,\s*\[\s*\]\s*\)/,
    'must not one-shot snapshot analysisData',
  );
  assert.match(BP_SRC, /ig:analysis-updated/);
  assert.match(BP_SRC, /ig:analysis-ready/);
  assert.match(BP_SRC, /document\.addEventListener\(\s*["']ig:analysis-updated["']/);
  assert.match(BP_SRC, /document\.addEventListener\(\s*["']ig:analysis-ready["']/);

  const early = BP_SRC.indexOf('if (!hasData || !c)');
  assert.notEqual(early, -1, 'expected no-analysis early return');
  const afterEarly = BP_SRC.indexOf('const domain', early);
  assert.ok(afterEarly > early, 'expected analysis-present path after the empty return');
  const emptyReturn = BP_SRC.slice(early, afterEarly);
  assert.match(emptyReturn, /SavedPlansSection|bp-saved-plans|Saved Attack Plans/);
  assert.match(emptyReturn, /data-bp-no-analysis/);
  assert.match(emptyReturn, /No Analysis Yet/);
  assert.doesNotMatch(
    emptyReturn,
    /minHeight:\s*["']70vh["']/,
    'empty-analysis banner must not fill the viewport and hide saved plans',
  );
});

test('data_unavailable list payload is withheld — not the empty-state copy', () => {
  const payload = {
    ok: true,
    data_unavailable: true,
    _dataMode: 'strict',
    source: 'data_unavailable',
    message: 'This data is currently unavailable. The issue has been reported to your administrator.',
  };
  const unwrapped = win._unwrapAttackPlanListPayload(payload);
  assert.strictEqual(unwrapped.withheld, true);
  assert.strictEqual(Array.isArray(unwrapped.plans), true);
  assert.strictEqual(unwrapped.plans.length, 0);
  assert.match(unwrapped.message, /currently unavailable/);
  assert.match(unwrapped.message, /administrator/);

  const emptyCopy = 'No attack plans saved yet — generate one above';
  const showEmpty = !unwrapped.withheld && unwrapped.plans.length === 0;
  assert.strictEqual(showEmpty, false, 'withheld list must not use the genuinely-empty copy');
  assert.doesNotMatch(unwrapped.message, /No attack plans saved yet/);
  assert.doesNotMatch(unwrapped.message, /generate one above/);
});

test('openSavedAttackPlan routes withheld single-plan payload through _apShowUnavailable', () => {
  const sdom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
  const swin = sdom.window;
  const localToasts = [];
  swin.eval(
    helpersBlock
    + '\nwindow._unwrapAttackPlanPayload = _unwrapAttackPlanPayload;'
    + savedOpenBlock,
  );
  swin.showToast = (msg) => { localToasts.push(String(msg)); };
  swin.renderAttackPlan = () => { throw new Error('renderAttackPlan must not run for withheld payload'); };

  const payload = {
    ok: true,
    data_unavailable: true,
    source: 'data_unavailable',
    message: 'This data is currently unavailable. The issue has been reported to your administrator.',
  };
  assert.strictEqual(swin.openSavedAttackPlan(payload, 'Rival'), false);
  assert.strictEqual(localToasts.length, 1);
  assert.match(localToasts[0], /withheld/i);
  assert.match(localToasts[0], /strict data mode/i);
  assert.doesNotMatch(localToasts[0], /Could not load saved attack plan/);

  const modal = swin.document.getElementById('attackPlanModal');
  assert.ok(modal, 'withheld saved plan opens the honest unavailable dialog');
  assert.match(modal.innerHTML, /Attack plan withheld/);
  assert.match(modal.innerHTML, /currently unavailable/);
  assert.match(modal.innerHTML, /retrying will not generate a plan/i);
});

test('renderAttackPlan applies open grace on the dialog inner panel', async () => {
  const bpSafeStart = SRC.indexOf('function _bpSafe(s, max)');
  const bpSafeEnd = SRC.indexOf('\nfunction ', bpSafeStart + 1);
  assert.ok(bpSafeStart !== -1 && bpSafeEnd !== -1, 'expected _bpSafe in app.js');
  const bpSafeBlock = SRC.slice(bpSafeStart, bpSafeEnd);
  const renderStart = SRC.indexOf('function renderAttackPlan(plan, competitor)');
  const renderEnd = SRC.indexOf('window._apCloseModal = _apCloseModal', renderStart);
  assert.ok(renderStart !== -1 && renderEnd !== -1, 'expected renderAttackPlan in app.js');
  const renderBlock = SRC.slice(renderStart, renderEnd);

  const rdom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
  const rwin = rdom.window;
  rwin.eval(
    graceBlock
    + '\nwindow._apApplyOpenGrace = _apApplyOpenGrace;\n'
    + bpSafeBlock
    + '\nfunction _apSwitchTab() {}\n'
    + '\nfunction _apHonestyBadgeHtml() { return ""; }\n'
    + renderBlock
    + '\nwindow.renderAttackPlan = renderAttackPlan;\n',
  );
  rwin._apCloseModal = () => {};
  rwin.renderAttackPlan(livePlan, 'Rival');
  const modal = rwin.document.getElementById('attackPlanModal');
  assert.ok(modal, 'modal mounted');
  const inner = modal.firstElementChild;
  assert.ok(inner);
  assert.strictEqual(modal.dataset.apGrace, '1');
  assert.strictEqual(inner.style.pointerEvents, 'none');
  await new Promise((r) => setTimeout(r, 450));
  assert.strictEqual(modal.dataset.apGrace, undefined);
  assert.strictEqual(inner.style.pointerEvents, '');
});
