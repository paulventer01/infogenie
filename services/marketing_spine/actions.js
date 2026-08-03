/**
 * Close-loop action engine: suggest from Brief/Optimizer/Decision → apply
 * into calendar, content drafts, SEO tasks, or CRM sync.
 */
const crypto = require('crypto');
const _db = require('../../db');

function _id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

async function _persistRun(tid, kind, input, result) {
  if (!_db.hasDb() || tid == null) return null;
  const id = _id('spr');
  try {
    await _db.getPool().query(
      `INSERT INTO marketing_spine_runs (id, tenant_id, kind, input, result) VALUES ($1,$2,$3,$4,$5)`,
      [id, tid, kind, JSON.stringify(input || {}), JSON.stringify(result || {})],
    );
  } catch (e) {
    console.warn('[marketing-spine] persist run failed:', e.message);
  }
  return id;
}

async function insertAction(tid, action) {
  if (!_db.hasDb() || tid == null) return null;
  const id = action.id || _id('mact');
  await _db.getPool().query(
    `INSERT INTO marketing_actions
       (id, tenant_id, source, action_type, title, rationale, priority, status, target_system, target_payload, source_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'suggested',$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      tid,
      action.source,
      action.action_type,
      action.title,
      action.rationale || null,
      action.priority || 'medium',
      action.target_system || null,
      JSON.stringify(action.target_payload || {}),
      JSON.stringify(action.source_ref || {}),
    ],
  );
  return id;
}

async function listActions(tid, { status, limit = 50 } = {}) {
  if (!_db.hasDb() || tid == null) return [];
  const params = [tid];
  let sql = `SELECT * FROM marketing_actions WHERE tenant_id=$1`;
  if (status) {
    params.push(status);
    sql += ` AND status=$${params.length}`;
  }
  params.push(Math.min(200, Math.max(1, limit)));
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const r = await _db.getPool().query(sql, params);
  return r.rows;
}

/**
 * Suggest close-loop actions from Brief, Decision Engine, and Optimizer.
 */
async function suggestFromSources(tid, { sources } = {}) {
  const wanted = new Set(
    (sources && sources.length)
      ? sources
      : ['brief', 'decision_engine', 'optimizer', 'spine_gap'],
  );
  const proposed = [];
  if (!_db.hasDb() || tid == null) {
    return { proposed, inserted: [] };
  }
  const p = _db.getPool();

  if (wanted.has('brief')) {
    const brief = await p.query(
      `SELECT id, actions, created_at FROM marketing_briefs
       WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [tid],
    ).catch(() => ({ rows: [] }));
    let actions = brief.rows[0]?.actions || [];
    if (typeof actions === 'string') {
      try { actions = JSON.parse(actions); } catch { actions = []; }
    }
    if (Array.isArray(actions)) {
      for (const a of actions.slice(0, 6)) {
        const rationale = String(a.rationale || a.why_best || a.expected_impact || '').trim();
        const label = String(a.label || a.title || 'Brief action').trim();
        // Prefer the recommendation text as the title when the label is generic.
        const title = (/^see full analysis$/i.test(label) && rationale)
          ? rationale.replace(/^AI recommends:\s*/i, '').slice(0, 160)
          : label;
        const view = String(a.view || '').trim();
        const priRaw = a.priority;
        const priority = (priRaw === 1 || priRaw === '1' || priRaw === 'high')
          ? 'high'
          : (priRaw === 2 || priRaw === '2' || priRaw === 'medium')
            ? 'medium'
            : (typeof priRaw === 'string' ? priRaw : 'high');
        const isCalendar = /calendar/i.test(view);
        proposed.push({
          source: 'brief',
          action_type: isCalendar ? 'create_calendar_item' : 'create_calendar_item',
          title,
          rationale: rationale || label,
          priority,
          target_system: 'brand_calendar',
          target_payload: {
            view: view || 'marketing-brief',
            title,
            category: 'ads',
            notes: rationale || label,
            scheduled_offset_hours: 24,
          },
          source_ref: { brief_id: brief.rows[0]?.id, view },
        });
      }
    }
  }

  if (wanted.has('decision_engine')) {
    const decs = await p.query(
      `SELECT id, title, recommendation, why_best, expected_impact, priority_score, category
       FROM decision_recommendations
       WHERE tenant_id=$1 AND acted_at IS NULL AND dismissed_at IS NULL
       ORDER BY priority_score DESC NULLS LAST, created_at DESC LIMIT 8`,
      [tid],
    ).catch(() => ({ rows: [] }));
    for (const d of decs.rows) {
      const title = String(d.title || d.recommendation || 'Decision action').trim();
      const priority = Number(d.priority_score) >= 70 ? 'high' : (Number(d.priority_score) >= 40 ? 'medium' : 'low');
      proposed.push({
        source: 'decision_engine',
        action_type: 'create_calendar_item',
        title: `Execute: ${title}`.slice(0, 180),
        rationale: d.why_best || d.recommendation || d.expected_impact || '',
        priority,
        target_system: 'brand_calendar',
        target_payload: {
          title: title.slice(0, 120),
          category: 'mine',
          notes: d.recommendation || d.why_best || '',
          view: 'action-queue',
          scheduled_offset_hours: 4,
        },
        source_ref: { decision_id: d.id, category: d.category },
      });
    }
  }

  if (wanted.has('optimizer')) {
    const opts = await p.query(
      `SELECT id, campaign_id, action_type, reason, created_at
       FROM optimizer_actions
       WHERE tenant_id=$1 AND created_at > now() - interval '7 days'
       ORDER BY created_at DESC LIMIT 6`,
      [tid],
    ).catch(() => ({ rows: [] }));
    for (const o of opts.rows) {
      proposed.push({
        source: 'optimizer',
        action_type: 'review_optimizer',
        title: `Review optimizer: ${o.action_type || 'change'}`,
        rationale: o.reason || 'Recent optimizer recommendation',
        priority: o.action_type === 'pause' ? 'high' : 'medium',
        target_system: 'optimizer',
        target_payload: { view: 'optimizer', campaign_id: o.campaign_id, action: o.action_type },
        source_ref: { optimizer_action_id: o.id },
      });
    }
  }

  if (wanted.has('spine_gap')) {
    const { buildSpineContext } = require('./context');
    const ctx = await buildSpineContext(tid);
    for (const gap of (ctx.gaps || []).slice(0, 4)) {
      let view = 'ecosystem-spine';
      let action_type = 'open_view_and_draft';
      if (/audience/i.test(gap)) view = 'audiences-dynamic';
      else if (/pixel/i.test(gap)) view = 'pixel-manager';
      else if (/attribution/i.test(gap)) view = 'attribution-dashboard';
      else if (/Brief/i.test(gap)) view = 'marketing-brief';
      else if (/Decision/i.test(gap)) view = 'action-queue';
      proposed.push({
        source: 'spine_gap',
        action_type,
        title: gap,
        rationale: 'Ecosystem health gap detected by Marketing Spine',
        priority: 'medium',
        target_system: 'nav',
        target_payload: { view },
        source_ref: { gap },
      });
    }
  }

  // Deduplicate against existing suggested actions by title+source
  const existing = await listActions(tid, { status: 'suggested', limit: 100 });
  const existingKeys = new Set(existing.map((e) => `${e.source}::${e.title}`));
  const inserted = [];
  for (const prop of proposed) {
    const key = `${prop.source}::${prop.title}`;
    if (existingKeys.has(key)) continue;
    const id = await insertAction(tid, prop);
    if (id) {
      inserted.push({ id, ...prop });
      existingKeys.add(key);
    }
  }

  await _persistRun(tid, 'suggest', { sources: [...wanted] }, { proposed: proposed.length, inserted: inserted.length });
  return { proposed, inserted };
}

/**
 * Resolve: turn suggested actions into an ordered apply plan.
 */
async function resolvePlan(tid) {
  const actions = await listActions(tid, { status: 'suggested', limit: 40 });
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const ordered = [...actions].sort(
    (a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9),
  );

  const plan = ordered.map((a, i) => ({
    actionId: a.id,
    order: i + 1,
    title: a.title,
    action_type: a.action_type,
    target_system: a.target_system,
    canApply: ['create_calendar_item', 'create_seo_task', 'create_content_draft', 'open_view_and_draft', 'review_optimizer'].includes(a.action_type),
    reason: a.rationale || '',
  }));

  await _persistRun(tid, 'resolve', {}, { count: plan.length });
  return { plan, summary: `Ready to apply ${plan.filter((p) => p.canApply).length} of ${plan.length} suggested actions.` };
}

async function _applyCalendar(tid, action) {
  const payload = typeof action.target_payload === 'string'
    ? JSON.parse(action.target_payload)
    : (action.target_payload || {});
  const hours = Number(payload.scheduled_offset_hours || 24);
  const when = new Date(Date.now() + hours * 3600e3).toISOString();
  const id = _id('bcal');
  await _db.getPool().query(
    `INSERT INTO brand_calendar_items (id,tenant_id,category,title,scheduled_at,notes,status)
     VALUES ($1,$2,$3,$4,$5,$6,'planned')`,
    [
      id,
      tid,
      payload.category || 'mine',
      String(payload.title || action.title).slice(0, 200),
      when,
      String(payload.notes || action.rationale || 'Created via Marketing Spine').slice(0, 2000),
    ],
  );
  return { kind: 'calendar', id, scheduled_at: when };
}

async function _applySeoTask(tid, action) {
  const payload = typeof action.target_payload === 'string'
    ? JSON.parse(action.target_payload)
    : (action.target_payload || {});
  const id = _id('task');
  try {
    await _db.getPool().query(
      `INSERT INTO seo_tasks (id, tenant_id, label, message, status, priority, notes, source, check_id)
       VALUES ($1,$2,$3,$4,'open',$5,$6,'marketing_spine',$7)`,
      [
        id,
        tid,
        String(payload.title || action.title).slice(0, 200),
        String(payload.notes || action.rationale || action.title).slice(0, 2000),
        action.priority || 'medium',
        String(payload.notes || action.rationale || '').slice(0, 2000),
        'spine_' + id,
      ],
    );
    return { kind: 'seo_task', id };
  } catch (e) {
    return _applyCalendar(tid, {
      ...action,
      title: `[Task] ${action.title}`,
      target_payload: { ...payload, category: 'seo', notes: `SEO task (fallback): ${e.message}` },
    });
  }
}

async function _applyContentDraft(tid, action) {
  const payload = typeof action.target_payload === 'string'
    ? JSON.parse(action.target_payload)
    : (action.target_payload || {});
  // Store as a planned content calendar brand item — content_calendar_runs are AI-generated batches
  return _applyCalendar(tid, {
    ...action,
    title: `[Content] ${payload.title || action.title}`,
    target_payload: {
      ...payload,
      category: 'content',
      notes: payload.notes || action.rationale || 'Content draft slot from Marketing Spine',
      scheduled_offset_hours: payload.scheduled_offset_hours || 48,
    },
  });
}

/**
 * Apply one marketing action to its target system.
 */
async function applyAction(tid, actionId) {
  if (!_db.hasDb() || tid == null) throw new Error('database not configured');
  const r = await _db.getPool().query(
    `SELECT * FROM marketing_actions WHERE id=$1 AND tenant_id=$2`,
    [actionId, tid],
  );
  if (!r.rows.length) throw new Error('action_not_found');
  const action = r.rows[0];
  if (action.status === 'applied') return { ok: true, already: true, result: action.result };
  if (action.status === 'dismissed') throw new Error('action_dismissed');

  let result;
  try {
    switch (action.action_type) {
      case 'create_calendar_item':
        result = await _applyCalendar(tid, action);
        break;
      case 'create_seo_task':
        result = await _applySeoTask(tid, action);
        break;
      case 'create_content_draft':
        result = await _applyContentDraft(tid, action);
        break;
      case 'open_view_and_draft':
      case 'review_optimizer':
        // Navigational actions: mark applied and return deep-link target
        result = {
          kind: 'navigate',
          view: (typeof action.target_payload === 'object' && action.target_payload?.view)
            || action.target_system
            || 'ecosystem-spine',
        };
        break;
      default:
        throw new Error(`unsupported_action_type:${action.action_type}`);
    }

    await _db.getPool().query(
      `UPDATE marketing_actions
       SET status='applied', applied_at=now(), result=$1, error=NULL
       WHERE id=$2 AND tenant_id=$3`,
      [JSON.stringify(result), actionId, tid],
    );

    // Soft-mark linked decision as acted
    const src = typeof action.source_ref === 'string' ? JSON.parse(action.source_ref) : (action.source_ref || {});
    if (src.decision_id) {
      await _db.getPool().query(
        `UPDATE decision_recommendations SET acted_at=now() WHERE id=$1 AND tenant_id=$2`,
        [src.decision_id, tid],
      ).catch(() => {});
    }

    await _persistRun(tid, 'apply', { actionId }, result);
    return { ok: true, result };
  } catch (e) {
    await _db.getPool().query(
      `UPDATE marketing_actions SET status='failed', error=$1 WHERE id=$2 AND tenant_id=$3`,
      [e.message, actionId, tid],
    ).catch(() => {});
    throw e;
  }
}

async function dismissAction(tid, actionId) {
  if (!_db.hasDb() || tid == null) throw new Error('database not configured');
  const r = await _db.getPool().query(
    `UPDATE marketing_actions SET status='dismissed', dismissed_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='suggested' RETURNING id`,
    [actionId, tid],
  );
  if (!r.rows.length) throw new Error('action_not_found_or_not_suggested');
  return { ok: true, id: actionId };
}

module.exports = {
  insertAction,
  listActions,
  suggestFromSources,
  resolvePlan,
  applyAction,
  dismissAction,
  _persistRun,
};
