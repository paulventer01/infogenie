/**
 * End-to-end daily SEO autopilot:
 * feedback → replan → pick → generate → Evaluator–Optimizer → publish → memory/brief.
 */
const store = require('./store');
const { generateArticle } = require('./generate');
const { publishAll } = require('./destinations');
const { optimizeSeoArticle } = require('./eval_optimize');
const { gatherEnvironmentFeedback } = require('./feedback');
const { replanFromFeedback } = require('./replan');

async function _ingestMemory(tenantId, run) {
  try {
    const { ingestMemoryNode } = require('../knowledge_graph/api');
    const destOk = (run.publish_results || []).filter((d) => d.ok).map((d) => d.destination).join(', ');
    await ingestMemoryNode({
      tenant_id: tenantId,
      node_type: 'content_performance',
      summary: `SEO autopilot published “${run.title}” for keyword “${run.keyword}” → ${destOk || 'no destinations'}`,
      detail: {
        kind: 'seo_autopilot_run',
        keyword: run.keyword,
        title: run.title,
        word_count: run.word_count,
        destinations: run.publish_results,
        plan_id: run.plan_id,
        eval: run.eval || null,
        replan: run.replan_summary || null,
      },
      source_ref: `seo_autopilot:${run.id || 'run'}`,
      importance: 0.7,
    });
  } catch (_) {}
}

function _pickNextItem(plan) {
  const cal = plan.calendar || [];
  const queued = cal.find((c) => c.status === 'queued');
  if (queued) return queued;
  return cal.find((c) => c.status === 'planned' || !c.status) || null;
}

function _shouldReplan(plan) {
  const at = plan?.meta?.replan?.at;
  if (!at) return true;
  const age = Date.now() - new Date(at).getTime();
  return age > 12 * 60 * 60 * 1000; // replan at most every 12h unless forced
}

async function runPlanOnce(plan, { forceKeyword, skipReplan = false } = {}) {
  const tid = plan.tenant_id;
  let working = plan;
  let feedback = null;
  let replan = null;

  // Close the loop: environment feedback → outcome-driven replan before picking work
  if (!forceKeyword && !skipReplan && _shouldReplan(plan)) {
    try {
      feedback = await gatherEnvironmentFeedback(tid, plan);
      replan = await replanFromFeedback(tid, { plan, feedback, apply: true });
      if (replan?.plan) working = replan.plan;
    } catch (e) {
      console.warn('[seo-autopilot] replan:', e.message);
    }
  }

  const item = forceKeyword
    ? { title: forceKeyword, keyword: forceKeyword, day: 0, date: new Date().toISOString().slice(0, 10) }
    : _pickNextItem(working);

  if (!item) {
    return { ok: false, error: 'no_calendar_items', plan_id: working.id, feedback, replan };
  }

  const title = item.title || `${item.keyword}: Complete Guide`;
  const keyword = item.keyword || title;

  let article;
  try {
    article = await generateArticle({
      tenantId: tid,
      title,
      keyword,
      domain: working.domain,
      brand: working.brand || working.domain,
      industry: working.industry || working.niche,
      tone: working.tone || 'professional',
      wordCount: 1800,
    });
  } catch (e) {
    const failed = await store.recordRun({
      tenant_id: tid,
      plan_id: working.id,
      status: 'error',
      keyword,
      title,
      error: e.message,
    });
    return { ok: false, error: e.message, run: failed, feedback, replan };
  }

  // Evaluator–Optimizer reuse on article HTML
  let evalResult = null;
  try {
    evalResult = await optimizeSeoArticle(tid, article.content, {
      keyword,
      title: article.title,
      maxAttempts: 3,
    });
    if (evalResult?.content) {
      article = {
        ...article,
        content: evalResult.content,
        wordCount: evalResult.wordCount || article.wordCount,
        source: article.source,
        eval_optimized: true,
      };
    }
  } catch (e) {
    evalResult = { ok: false, error: e.message, passed: false };
  }

  const publish_results = await publishAll(
    working.destinations,
    { title: article.title, content: article.content, keyword, excerpt: String(keyword) },
    { tenantId: tid, publishStatus: working.publish_status || 'draft' },
  );

  const anyOk = publish_results.some((r) => r.ok);
  const run = await store.recordRun({
    tenant_id: tid,
    plan_id: working.id,
    status: anyOk ? 'ok' : 'publish_failed',
    keyword,
    title: article.title,
    word_count: article.wordCount,
    destinations: working.destinations,
    publish_results,
    article_html: article.content,
    meta: {
      article_source: article.source,
      call_trace_id: article.call_trace_id || null,
      eval: evalResult
        ? {
            passed: !!evalResult.passed,
            final_verdict: evalResult.final_verdict,
            attempts: evalResult.attempts?.length || 0,
            cascade: evalResult.cascade || null,
          }
        : null,
      replan: replan?.feedback?.summary || working.meta?.replan || null,
    },
  });

  if (item.day != null || item.date) {
    await store.updateCalendarItem(tid, item.day != null ? item.day : item.date, {
      status: anyOk ? 'published' : 'failed',
      published_at: new Date().toISOString(),
      run_id: run.id,
      eval_passed: !!evalResult?.passed,
    });
    const refreshed = await store.getPlan(tid);
    const next = (refreshed?.calendar || []).find((c) => c.status === 'planned');
    if (next) {
      await store.updateCalendarItem(tid, next.day != null ? next.day : next.date, { status: 'queued' });
    }
  }

  await store.markPlanRan(tid, working.id, { nextFrequency: working.frequency || 'daily' });

  // Post-run feedback pass (learn from this publish for next cycle)
  let postFeedback = null;
  try {
    postFeedback = await gatherEnvironmentFeedback(tid, await store.getPlan(tid));
    if (anyOk) {
      await replanFromFeedback(tid, { feedback: postFeedback, apply: true });
    }
  } catch (_) {}

  await _ingestMemory(tid, {
    ...run,
    title: article.title,
    keyword,
    word_count: article.wordCount,
    publish_results,
    plan_id: working.id,
    eval: evalResult
      ? { passed: evalResult.passed, verdict: evalResult.final_verdict }
      : null,
    replan_summary: postFeedback?.summary || replan?.feedback?.summary || null,
  });

  return {
    ok: anyOk,
    run,
    article: { title: article.title, keyword, wordCount: article.wordCount },
    publish_results,
    eval: evalResult
      ? {
          passed: evalResult.passed,
          final_verdict: evalResult.final_verdict,
          attempts: evalResult.attempts?.length || 0,
          needs_human: !!evalResult.needs_human,
        }
      : null,
    feedback: postFeedback || feedback,
    replan: replan
      ? { changes: replan.changes?.length || 0, summary: replan.feedback?.summary }
      : null,
  };
}

async function runDuePlans() {
  const due = await store.listDuePlans(10);
  const results = [];
  for (const plan of due) {
    try {
      results.push(await runPlanOnce(plan));
    } catch (e) {
      results.push({ ok: false, plan_id: plan.id, error: e.message });
    }
  }
  return { processed: results.length, results };
}

let _cronStarted = false;
function startCron() {
  if (_cronStarted) return;
  _cronStarted = true;
  const tick = () => {
    runDuePlans().catch((e) => console.warn('[seo-autopilot] cron:', e.message));
  };
  setTimeout(tick, 45000);
  setInterval(tick, 60 * 60 * 1000);
  console.log('[seo-autopilot] cron started');
}

module.exports = { runPlanOnce, runDuePlans, startCron, _pickNextItem, _shouldReplan };
