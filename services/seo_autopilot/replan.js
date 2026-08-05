'use strict';

/**
 * Outcome-driven calendar replan — skip losers, advance winners, insert follow-ups.
 */
const store = require('./store');
const { gatherEnvironmentFeedback } = require('./feedback');

function _followUpTitle(keyword) {
  const k = String(keyword || 'topic');
  const variants = [
    `${k}: what changed this month`,
    `Case study: applying ${k}`,
    `${k} checklist for busy teams`,
  ];
  return variants[Math.floor(Math.abs(_hash(k)) % variants.length)];
}

function _hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Reorder / annotate calendar from environment feedback.
 * @returns {{ ok, plan, changes, feedback }}
 */
async function replanFromFeedback(tenantId, { plan: existing = null, feedback: existingFb = null, apply = true } = {}) {
  const plan = existing || (await store.getPlan(tenantId));
  if (!plan) return { ok: false, error: 'no_plan' };

  const feedback = existingFb || (await gatherEnvironmentFeedback(tenantId, plan));
  const scores = feedback.keyword_scores || {};
  const loserSet = new Set((feedback.losers || []).map((l) => l.keyword));
  const winnerSet = new Set((feedback.winners || []).map((w) => w.keyword));

  const changes = [];
  let calendar = (plan.calendar || []).map((c) => ({ ...c }));

  // 1) Defer planned/queued loser keywords (keep published history)
  for (const item of calendar) {
    if (!item.keyword || !loserSet.has(item.keyword)) continue;
    if (item.status === 'published' || item.status === 'deferred') continue;
    if (item.status === 'queued' || item.status === 'planned' || !item.status) {
      const prev = item.status || 'planned';
      item.status = 'deferred';
      item.replan_reason = (scores[item.keyword]?.reasons || ['low environment score']).slice(0, 2).join('; ');
      item.score = scores[item.keyword]?.score;
      changes.push({ action: 'defer', keyword: item.keyword, day: item.day, from: prev });
    }
  }

  // 2) Score remaining planned items; sort planned block by score desc (winners first)
  const terminal = new Set(['published', 'failed', 'deferred']);
  const fixed = [];
  const movable = [];
  for (const item of calendar) {
    if (terminal.has(item.status) || item.status === 'queued') {
      // queued stays but we may replace which one is queued later
      if (item.status === 'queued' && loserSet.has(item.keyword)) {
        // already deferred above
        fixed.push(item);
      } else if (item.status === 'queued') {
        movable.push(item);
      } else {
        fixed.push(item);
      }
    } else {
      item.score = scores[item.keyword]?.score ?? 50;
      movable.push(item);
    }
  }

  movable.sort((a, b) => {
    const aw = winnerSet.has(a.keyword) ? 1 : 0;
    const bw = winnerSet.has(b.keyword) ? 1 : 0;
    if (bw !== aw) return bw - aw;
    return (b.score || 50) - (a.score || 50);
  });

  // Rebuild: keep published/failed/deferred in day order, then movable by score
  const publishedLike = calendar
    .filter((c) => ['published', 'failed', 'deferred'].includes(c.status))
    .sort((a, b) => (a.day || 0) - (b.day || 0));

  const rest = movable
    .filter((c) => !['published', 'failed', 'deferred'].includes(c.status))
    .map((c, i) => {
      const nextStatus = i === 0 ? 'queued' : 'planned';
      if (c.status !== nextStatus) {
        changes.push({ action: 'reorder', keyword: c.keyword, day: c.day, status: nextStatus });
      }
      return { ...c, status: nextStatus, score: scores[c.keyword]?.score ?? c.score ?? 50 };
    });

  calendar = [...publishedLike, ...rest];

  // Re-number days for clarity while preserving dates when present
  calendar = calendar.map((c, i) => ({ ...c, day: i + 1 }));

  // 3) Insert follow-ups for winners into near-term planned slots (max 3)
  const existingKeys = new Set(calendar.map((c) => `${c.keyword}::${c.title}`));
  let inserted = 0;
  for (const w of feedback.winners || []) {
    if (inserted >= 3) break;
    const title = _followUpTitle(w.keyword);
    const key = `${w.keyword}::${title}`;
    if (existingKeys.has(key)) continue;
    // Find first planned index after current queued
    const queuedIdx = calendar.findIndex((c) => c.status === 'queued');
    const insertAt = queuedIdx >= 0 ? queuedIdx + 1 + inserted : publishedLike.length + inserted;
    const date = new Date();
    date.setDate(date.getDate() + insertAt);
    const item = {
      day: insertAt + 1,
      date: date.toISOString().slice(0, 10),
      title,
      keyword: w.keyword,
      intent: 'Informational',
      status: 'planned',
      score: w.score,
      replan_reason: 'follow-up from winner signal',
      follow_up: true,
    };
    calendar.splice(insertAt, 0, item);
    existingKeys.add(key);
    changes.push({ action: 'insert_followup', keyword: w.keyword, title });
    inserted++;
  }

  // Final day renumber + ensure exactly one queued among active
  calendar = calendar.map((c, i) => ({ ...c, day: i + 1 }));
  let sawQueued = false;
  calendar = calendar.map((c) => {
    if (['published', 'failed', 'deferred'].includes(c.status)) return c;
    if (!sawQueued) {
      sawQueued = true;
      return { ...c, status: 'queued' };
    }
    return { ...c, status: c.status === 'queued' ? 'planned' : (c.status || 'planned') };
  });

  const meta = {
    ...(plan.meta || {}),
    replan: {
      at: new Date().toISOString(),
      summary: feedback.summary,
      changes_count: changes.length,
      winners: (feedback.winners || []).map((w) => w.keyword).slice(0, 5),
      losers: (feedback.losers || []).map((l) => l.keyword).slice(0, 5),
      sources: feedback.sources,
    },
  };

  if (!apply) {
    return { ok: true, plan: { ...plan, calendar, meta }, changes, feedback, applied: false };
  }

  const saved = await store.upsertPlan(tenantId, {
    ...plan,
    calendar,
    meta,
  });

  return { ok: true, plan: saved, changes, feedback, applied: true };
}

module.exports = {
  replanFromFeedback,
  _followUpTitle,
};
