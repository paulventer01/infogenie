// Phase 7 — Multi-Armed Bandit (Thompson sampling) at the ad-set level.
//
// For every Meta campaign with optimizer_enabled AND bandit_enabled, every
// 12 hours we:
//   1. Pull the campaign's ad sets + their 7-day performance from Meta
//   2. Treat each ad set as one "arm" of a bandit
//   3. For each arm, draw a sample from Beta(conv+1, clicks-conv+1) — the
//      posterior over conversion rate. Multiply by avg revenue/conversion
//      (the AOV) to get a Thompson-sampled expected revenue per click.
//   4. Allocate the campaign's TOTAL daily budget proportional to the
//      sampled scores, with hard floors (don't fully starve any arm — keep
//      exploration alive) and ceilings (don't put 100% on one arm).
//   5. Push new daily_budget to each ad set on Meta (LIVE) or just log
//      (dry-run). Every decision written to bandit_allocations.
//
// Meta only this phase. Budget changes go to the AD SET (Meta ABO mode).
// Campaigns running CBO will get a clear error logged per ad set.

const https = require('https');
const _db = require('../../db');
const { getSetting } = require('./schema');

const MIN_EXPLORE_SHARE = 0.10;   // each arm gets at least 10% of budget
const MAX_ARM_SHARE     = 0.60;   // no single arm gets more than 60%
const MIN_DAILY_BUDGET  = 1.00;   // Meta's hard floor per ad set
const MAX_PER_RUN       = 50;     // hard cap on ad sets reallocated per run

// ── HTTPS helper (mirrors platforms.js) ─────────────────────────────────────
function _httpsJson(host, path, method, body, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: host, path, method, headers: { 'User-Agent': 'InfoGenie-Optimizer/1.0', ...headers } };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch { resolve({ status: res.statusCode, body: { _raw: data } }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── Statistical sampling primitives ─────────────────────────────────────────
// Box-Muller standard normal.
function _randNormal() {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
// Marsaglia-Tsang sampler for Gamma(shape, 1). O(1), works for shape > 0.
function _gammaSample(shape) {
  if (!Number.isFinite(shape) || shape <= 0) return 0;
  if (shape < 1) {
    // Boost trick: Gamma(α) = Gamma(α+1) * U^(1/α)
    return _gammaSample(shape + 1) * Math.pow(Math.random() || 1e-12, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Bounded loop for safety — Marsaglia-Tsang typically converges in 1-2 tries.
  for (let i = 0; i < 100; i++) {
    let x = 0, v = 0;
    // Inner loop also bounded (defensive — only relevant if Math.random produces
    // a degenerate stream that pushes 1+c*x non-positive every time).
    for (let inner = 0; inner < 50; inner++) {
      x = _randNormal();
      v = 1 + c * x;
      if (v > 0) break;
    }
    if (v <= 0) continue;
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d;  // fallback to mean
}
// Beta(α, β) via the standard Gamma trick: X / (X + Y).
function _betaSample(alpha, beta) {
  const x = _gammaSample(alpha);
  const y = _gammaSample(beta);
  const tot = x + y;
  if (!Number.isFinite(tot) || tot <= 0) return 0.5;
  return x / tot;
}

// ── Fetch ad sets + 7-day performance from Meta ─────────────────────────────
async function fetchAdSetsMeta(metaCampId, days = 7) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'META_ACCESS_TOKEN not set' };
  const params = new URLSearchParams({
    fields: 'id,name,status,daily_budget,lifetime_budget',
    limit: '50',
    access_token: token,
  });
  const adsR = await _httpsJson('graph.facebook.com', `/v19.0/${encodeURIComponent(metaCampId)}/adsets?${params}`, 'GET');
  if (adsR.body.error) return { ok: false, error: adsR.body.error.message };
  const adsets = (adsR.body.data || []).filter(a => a.status === 'ACTIVE');
  if (adsets.length === 0) return { ok: true, adsets: [] };
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0,10);
  const until = new Date().toISOString().slice(0,10);
  const enriched = await Promise.all(adsets.map(async (a) => {
    const ip = new URLSearchParams({
      fields: 'spend,impressions,clicks,actions,action_values',
      time_range: JSON.stringify({ since, until }),
      access_token: token,
    });
    const ir = await _httpsJson('graph.facebook.com', `/v19.0/${a.id}/insights?${ip}`, 'GET').catch(() => ({ body: {} }));
    const row = (ir.body && ir.body.data && ir.body.data[0]) || {};
    const spend = parseFloat(row.spend || 0);
    const imp   = parseInt(row.impressions || 0, 10);
    const clk   = parseInt(row.clicks || 0, 10);
    const conv  = (row.actions || []).filter(x => /purchase|lead|complete_registration/.test(x.action_type)).reduce((s,x) => s + parseFloat(x.value || 0), 0);
    const rev   = (row.action_values || []).filter(x => /purchase|revenue/.test(x.action_type)).reduce((s,x) => s + parseFloat(x.value || 0), 0);
    return {
      platform_adset_id: a.id, name: a.name,
      daily_budget: parseFloat(a.daily_budget || 0) / 100,  // Meta returns cents
      perf: { spend, impressions: imp, clicks: clk, conversions: conv, revenue: rev },
    };
  }));
  return { ok: true, adsets: enriched };
}

// ── Apply daily-budget change to a single Meta ad set ───────────────────────
async function _applyAdSetBudget(adsetId, newBudgetUsd) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'META_ACCESS_TOKEN not set' };
  const cents = Math.max(Math.round(newBudgetUsd * 100), 100);  // floor $1
  const params = new URLSearchParams({ access_token: token, daily_budget: String(cents) });
  // Tighter timeout than reads (8s) — a slow budget POST should fail fast so
  // the per-run mutex doesn't block the next cron tick for 20s × N arms.
  const r = await _httpsJson('graph.facebook.com', `/v19.0/${adsetId}`, 'POST',
    params.toString(), { 'Content-Type':'application/x-www-form-urlencoded' }, 8000);
  if (r.body.error) return { ok: false, error: r.body.error.message };
  return { ok: true };
}

// ── Upsert ad-set rows in our DB so allocations FK to a real id ─────────────
async function _upsertAdSet(campaignId, a) {
  const r = await _db.getPool().query(`
    INSERT INTO ad_sets (campaign_id, platform_adset_id, name, daily_budget)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (campaign_id, platform_adset_id)
    DO UPDATE SET name=EXCLUDED.name,
                  daily_budget=COALESCE(EXCLUDED.daily_budget, ad_sets.daily_budget),
                  updated_at=now()
    RETURNING id
  `, [campaignId, a.platform_adset_id, a.name || null, a.daily_budget || null]);
  return r.rows[0].id;
}

// ── Compute Thompson-sampled allocation for a single campaign ───────────────
// IMPORTANT: shares returned here sum to ~1.0 exactly. The caller multiplies
// by totalBudget to get per-arm dollars — there is NO additional per-arm
// floor at the dollar stage, which would otherwise create money out of thin
// air and break the budget-conservation invariant. The dollar floor
// (MIN_DAILY_BUDGET) is folded into minShare here so it's enforced via the
// share renormalization, preserving Σ newBudget = totalBudget.
function _computeAllocation(adsets, totalBudget) {
  const scored = adsets.map(a => {
    const conv  = Math.max(a.perf.conversions || 0, 0);
    const clk   = Math.max(a.perf.clicks || 0, 0);
    const alpha = conv + 1;
    const beta  = Math.max(clk - conv, 0) + 1;
    const sample= _betaSample(alpha, beta);                  // posterior CVR sample
    const aov   = conv > 0 ? (a.perf.revenue || 0) / conv : 1;
    const score = Math.max(sample * Math.max(aov, 0.01), 1e-6);
    return { ...a, prior: { alpha, beta }, sample, aov, score };
  });
  const totalScore = scored.reduce((s, x) => s + x.score, 0) || 1;
  const N = scored.length;
  const dollarFloorShare = totalBudget > 0 ? (MIN_DAILY_BUDGET / totalBudget) : 0;
  const minShareTarget = Math.max(MIN_EXPLORE_SHARE, dollarFloorShare);
  const maxShareTarget = MAX_ARM_SHARE;
  // Feasibility: if one arm locks at max, the remaining (N-1) arms must
  // fit (1-max) of the budget. So min cannot exceed (1-max)/(N-1) without
  // creating an infeasible LP. Take the strictest of:
  //   - desired floor (explore + dollar)
  //   - 1/N (can't demand more than equal split)
  //   - (1-max)/(N-1) (feasibility under one max-locked arm)
  const feasibleMin = N > 1 ? Math.max(0, (1 - maxShareTarget) / (N - 1)) : 1;
  const minShare = Math.min(minShareTarget, 1 / Math.max(N, 1), feasibleMin);
  const maxShare = Math.max(maxShareTarget, minShare);
  scored.forEach(x => { x.share = x.score / totalScore; });
  // Water-filling: lock ONE worst boundary-violating arm per iteration at the
  // boundary, then redistribute the remaining budget across the still-unlocked
  // arms in proportion to their scores. Locking multiple arms in a single pass
  // can strand budget (the locked sum no longer matches actual demand), so we
  // strictly lock one at a time. Converges in ≤ N iterations and guarantees
  //   minShare ≤ share ≤ maxShare  AND  Σ share = 1
  // — so Σ (share × totalBudget) = totalBudget (modulo cents rounding).
  const locked = new Array(N).fill(false);
  for (let iter = 0; iter < N + 1; iter++) {
    const lockedSum = scored.reduce((s, x, i) => s + (locked[i] ? x.share : 0), 0);
    const freeBudget = Math.max(1 - lockedSum, 0);
    const freeScoreSum = scored.reduce((s, x, i) => s + (locked[i] ? 0 : x.score), 0) || 1;
    scored.forEach((x, i) => { if (!locked[i]) x.share = freeBudget * x.score / freeScoreSum; });
    // Find the SINGLE worst violator (largest distance outside [min,max]).
    let worstIdx = -1, worstViol = 0, worstAtMax = false;
    scored.forEach((x, i) => {
      if (locked[i]) return;
      if (x.share > maxShare) {
        const v = x.share - maxShare;
        if (v > worstViol) { worstViol = v; worstIdx = i; worstAtMax = true; }
      } else if (x.share < minShare) {
        const v = minShare - x.share;
        if (v > worstViol) { worstViol = v; worstIdx = i; worstAtMax = false; }
      }
    });
    if (worstIdx < 0) break;  // no violations — done
    scored[worstIdx].share = worstAtMax ? maxShare : minShare;
    locked[worstIdx] = true;
  }
  return scored;
}

// ── Log one bandit decision to DB ──────────────────────────────────────────
async function _logAlloc({ campaignId, adSetId, runId, arm, oldBudget, newBudget, applied, error, reason }) {
  try {
    await _db.getPool().query(`
      INSERT INTO bandit_allocations
        (campaign_id, ad_set_id, run_id, prior_alpha, prior_beta,
         sampled_score, avg_value, old_budget, new_budget, share,
         applied, apply_error, reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      campaignId, adSetId, runId,
      arm.prior.alpha, arm.prior.beta,
      arm.sample, arm.aov,
      oldBudget, newBudget, arm.share,
      !!applied, error || null, reason || null,
    ]);
  } catch (e) { console.error('[bandit] log err:', e.message); }
}

// ── Run bandit on a single campaign ────────────────────────────────────────
async function _runOneCampaign({ camp, dryRun, runId, perRunLeft }) {
  const adsR = await fetchAdSetsMeta(camp.platform_camp_id);
  if (!adsR.ok) return { ok: false, error: adsR.error, applied: 0, scanned: 0 };
  if (adsR.adsets.length < 2) {
    return { ok: true, error: 'fewer than 2 ad sets — bandit needs at least 2 arms', applied: 0, scanned: adsR.adsets.length };
  }
  // Total budget = sum of current ad-set budgets (preserve campaign spend)
  const totalBudget = adsR.adsets.reduce((s, a) => s + (a.daily_budget || 0), 0);
  if (totalBudget <= 0) {
    return { ok: true, error: 'sum of ad-set daily budgets is 0 — likely a CBO campaign (skipping)', applied: 0, scanned: adsR.adsets.length };
  }
  const allocation = _computeAllocation(adsR.adsets, totalBudget);
  let applied = 0, errors = 0;
  for (const arm of allocation) {
    if (perRunLeft.n <= 0) break;
    perRunLeft.n--;
    const adSetId   = await _upsertAdSet(camp.id, arm);
    // No per-arm floor here — minShare in _computeAllocation already
    // guarantees share*totalBudget ≥ MIN_DAILY_BUDGET, which preserves
    // Σ newBudget = totalBudget (the budget-conservation invariant).
    const newBudget = Math.round(arm.share * totalBudget * 100) / 100;
    const oldBudget = arm.daily_budget;
    const reason    = `Thompson sample ${arm.sample.toFixed(4)} × AOV $${arm.aov.toFixed(2)} → ${(arm.share*100).toFixed(1)}% share`;
    if (dryRun) {
      await _logAlloc({ campaignId: camp.id, adSetId, runId, arm, oldBudget, newBudget, applied: false, error: null, reason: reason + ' [DRY-RUN]' });
      continue;
    }
    // Skip the API call entirely if the change is < $1 or < 10% — saves
    // both API quota and avoids triggering Meta's budget-change rate limits.
    const diff = Math.abs(newBudget - oldBudget);
    if (diff < 1 || (oldBudget > 0 && diff / oldBudget < 0.10)) {
      await _logAlloc({ campaignId: camp.id, adSetId, runId, arm, oldBudget, newBudget: oldBudget, applied: false, error: null, reason: reason + ' (no change — within ±$1 / 10%)' });
      continue;
    }
    const r = await _applyAdSetBudget(arm.platform_adset_id, newBudget);
    if (r.ok) {
      applied++;
      await _logAlloc({ campaignId: camp.id, adSetId, runId, arm, oldBudget, newBudget, applied: true, error: null, reason });
    } else {
      errors++;
      await _logAlloc({ campaignId: camp.id, adSetId, runId, arm, oldBudget, newBudget, applied: false, error: r.error, reason });
    }
  }
  return { ok: true, applied, errors, scanned: allocation.length, totalBudget };
}

// ── Public entry: mutex-guarded run ────────────────────────────────────────
let _timer = null, _running = false;

async function _runUnsafe(opts = {}) {
  if (!_db.hasDb()) return { ok: false, error: 'no DB' };
  const enabled = await getSetting('bandit_enabled', { v: false });
  if (!enabled.v && !opts.force) return { ok: true, skipped: 'bandit disabled' };
  const dryRun = opts.dryRun !== undefined ? !!opts.dryRun : !!(await getSetting('bandit_dry_run', { v: true })).v;
  const runId  = 'bd-' + Date.now();
  const camps  = await _db.getPool().query(
    `SELECT * FROM ad_campaigns WHERE optimizer_enabled = true AND platform IN ('meta','facebook')`
  );
  const perRunLeft = { n: MAX_PER_RUN };
  let totalApplied = 0, totalErrors = 0, totalScanned = 0;
  const perCampaign = [];
  for (const camp of camps.rows) {
    if (perRunLeft.n <= 0) break;
    const r = await _runOneCampaign({ camp, dryRun, runId, perRunLeft });
    totalApplied += (r.applied || 0);
    totalErrors  += (r.errors  || 0);
    totalScanned += (r.scanned || 0);
    perCampaign.push({ campaign: camp.name, scanned: r.scanned, applied: r.applied, errors: r.errors, error: r.error || null });
  }
  return {
    ok: true, runId, dryRun,
    campaigns: camps.rows.length, scanned: totalScanned,
    applied: totalApplied, errors: totalErrors,
    cap: MAX_PER_RUN, capped: perRunLeft.n <= 0,
    perCampaign, ranAt: new Date().toISOString(),
  };
}

async function runBanditOnce(opts = {}) {
  if (_running) return { ok: false, error: 'a bandit run is already in flight — try again shortly' };
  _running = true;
  try { return await _runUnsafe(opts); }
  finally { _running = false; }
}

async function _safeRun() {
  try {
    const s = await runBanditOnce();
    console.log('[bandit] run:', JSON.stringify({ ok:s.ok, scanned:s.scanned, applied:s.applied, errors:s.errors, dryRun:s.dryRun, skipped:s.skipped }));
  } catch (e) { console.error('[bandit] err:', e.message); }
}

function startBanditCron(intervalHours = 12) {
  if (_timer) return false;
  setTimeout(_safeRun, 7 * 60 * 1000);   // first run 7 min after boot
  _timer = setInterval(_safeRun, intervalHours * 3600 * 1000);
  return true;
}

module.exports = { runBanditOnce, startBanditCron, fetchAdSetsMeta, _betaSample, _computeAllocation };
