/**
 * End-to-end daily SEO autopilot: pick calendar item → generate → publish → memory/brief.
 */
const store = require('./store');
const { generateArticle } = require('./generate');
const { publishAll } = require('./destinations');

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
      },
      source_ref: `seo_autopilot:${run.id || 'run'}`,
      importance: 0.7,
    });
  } catch (_) {}
}

function _pickNextItem(plan) {
  const cal = plan.calendar || [];
  const queued = cal.find((c) => c.status === 'queued' || c.status === 'planned' || !c.status);
  return queued || null;
}

async function runPlanOnce(plan, { forceKeyword } = {}) {
  const tid = plan.tenant_id;
  const item = forceKeyword
    ? { title: forceKeyword, keyword: forceKeyword, day: 0, date: new Date().toISOString().slice(0, 10) }
    : _pickNextItem(plan);

  if (!item) {
    return { ok: false, error: 'no_calendar_items', plan_id: plan.id };
  }

  const title = item.title || `${item.keyword}: Complete Guide`;
  const keyword = item.keyword || title;

  let article;
  try {
    article = await generateArticle({
      tenantId: tid,
      title,
      keyword,
      domain: plan.domain,
      brand: plan.brand || plan.domain,
      industry: plan.industry || plan.niche,
      tone: plan.tone || 'professional',
      wordCount: 1800,
    });
  } catch (e) {
    const failed = await store.recordRun({
      tenant_id: tid,
      plan_id: plan.id,
      status: 'error',
      keyword,
      title,
      error: e.message,
    });
    return { ok: false, error: e.message, run: failed };
  }

  const publish_results = await publishAll(
    plan.destinations,
    { title: article.title, content: article.content, keyword, excerpt: String(keyword) },
    { tenantId: tid, publishStatus: plan.publish_status || 'draft' },
  );

  const anyOk = publish_results.some((r) => r.ok);
  const run = await store.recordRun({
    tenant_id: tid,
    plan_id: plan.id,
    status: anyOk ? 'ok' : 'publish_failed',
    keyword,
    title: article.title,
    word_count: article.wordCount,
    destinations: plan.destinations,
    publish_results,
    article_html: article.content,
    meta: { article_source: article.source, call_trace_id: article.call_trace_id || null },
  });

  // Advance calendar item
  if (item.day != null || item.date) {
    await store.updateCalendarItem(tid, item.day != null ? item.day : item.date, {
      status: anyOk ? 'published' : 'failed',
      published_at: new Date().toISOString(),
      run_id: run.id,
    });
    // Queue next planned item
    const refreshed = await store.getPlan(tid);
    const next = (refreshed?.calendar || []).find((c) => c.status === 'planned');
    if (next) {
      await store.updateCalendarItem(tid, next.day != null ? next.day : next.date, { status: 'queued' });
    }
  }

  await store.markPlanRan(tid, plan.id, { nextFrequency: plan.frequency || 'daily' });
  await _ingestMemory(tid, { ...run, title: article.title, keyword, word_count: article.wordCount, publish_results, plan_id: plan.id });

  return { ok: anyOk, run, article: { title: article.title, keyword, wordCount: article.wordCount }, publish_results };
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
  setInterval(tick, 60 * 60 * 1000); // hourly check; plans schedule daily via next_run_at
  console.log('[seo-autopilot] cron started');
}

module.exports = { runPlanOnce, runDuePlans, startCron, _pickNextItem };
