const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

function _oa() { return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY }); }

/* ── list goals ── */
router.get('/', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent:list' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { rows: goals } = await _db.getPool().query(
      `SELECT * FROM agent_goals WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
    for (const g of goals) {
      const { rows: tasks } = await _db.getPool().query(
        `SELECT * FROM agent_tasks WHERE goal_id=$1 ORDER BY priority ASC, created_at ASC`, [g.id]);
      g.tasks = tasks;
    }
    res.json({ goals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── create goal + AI plan ── */
router.post('/', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent:create' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { title, description, success_criteria, deadline } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });

    const completion = await _oa().chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `You are an autonomous AI marketing agent. A user has set this marketing goal:
Title: ${title}
Description: ${description || 'Not specified'}
Success criteria: ${success_criteria || 'Not specified'}
Deadline: ${deadline || 'No deadline'}

Break this into a prioritised execution plan. Generate 5-8 concrete marketing tasks to achieve it.
Return JSON: {"plan_summary":"...","tasks":[{"title":"...","description":"...","action_type":"...","priority":1,"due_offset_days":7},...],"success_metrics":"..."}
action_type must be one of: content_creation, campaign_launch, audience_build, seo, outreach, analysis, competitor_research, other
priority is 1 (high), 2 (medium), 3 (low).`
      }],
      response_format: { type: 'json_object' }, max_tokens: 1200
    });

    let plan = {};
    try { plan = JSON.parse(completion.choices[0].message.content); } catch (_) {}
    if (plan._DUMMY || !plan.tasks) {
      plan = {
        plan_summary: 'AI-generated marketing execution plan',
        tasks: [
          { title: 'Audit current performance baseline', description: 'Review current metrics vs target', action_type: 'analysis', priority: 1, due_offset_days: 3 },
          { title: 'Define target audience segments', description: 'Build 3 audience profiles for targeting', action_type: 'audience_build', priority: 1, due_offset_days: 5 },
          { title: 'Create 5 pieces of core content', description: 'Produce hero content aligned to goal', action_type: 'content_creation', priority: 2, due_offset_days: 10 },
          { title: 'Launch paid campaign', description: 'Set up and launch targeted ad campaign', action_type: 'campaign_launch', priority: 2, due_offset_days: 14 },
          { title: 'Review and optimise week 2', description: 'Analyse initial results and adjust', action_type: 'analysis', priority: 2, due_offset_days: 18 }
        ],
        success_metrics: success_criteria || 'Track weekly progress against goal',
        source: 'template'
      };
    }

    const { rows: goalRows } = await _db.getPool().query(
      `INSERT INTO agent_goals (tenant_id,title,description,success_criteria,deadline,ai_plan)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, title, description||'', success_criteria||'', deadline||null, JSON.stringify(plan)]
    );
    const goal = goalRows[0];

    const taskInserts = (plan.tasks || []).map((t, i) => {
      const dueDate = deadline || null;
      return _db.getPool().query(
        `INSERT INTO agent_tasks (tenant_id,goal_id,title,description,action_type,priority,due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, goal.id, t.title, t.description||'', t.action_type||'other', t.priority||2, dueDate]
      );
    });
    await Promise.all(taskInserts);

    const { rows: tasks } = await _db.getPool().query(
      `SELECT * FROM agent_tasks WHERE goal_id=$1 ORDER BY priority ASC`, [goal.id]);
    res.json({ goal: { ...goal, tasks }, plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── get goal ── */
router.get('/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent:get' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { rows } = await _db.getPool().query(
      `SELECT * FROM agent_goals WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const { rows: tasks } = await _db.getPool().query(
      `SELECT * FROM agent_tasks WHERE goal_id=$1 ORDER BY priority ASC`, [req.params.id]);
    res.json({ goal: { ...rows[0], tasks } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── update task status ── */
router.put('/tasks/:taskId', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent:task-update' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { status, notes } = req.body;
    const completedAt = status === 'done' ? 'now()' : 'NULL';
    const { rows } = await _db.getPool().query(
      `UPDATE agent_tasks SET status=COALESCE($3,status), notes=COALESCE($4,notes),
       completed_at = CASE WHEN $3='done' THEN now() ELSE completed_at END
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.taskId, tid, status, notes]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    // recalc goal progress
    const task = rows[0];
    const { rows: allTasks } = await _db.getPool().query(`SELECT status FROM agent_tasks WHERE goal_id=$1`, [task.goal_id]);
    const done = allTasks.filter(t => t.status === 'done').length;
    const pct = allTasks.length ? Math.round((done / allTasks.length) * 100) : 0;
    await _db.getPool().query(`UPDATE agent_goals SET progress_pct=$1, updated_at=now() WHERE id=$2`, [pct, task.goal_id]);
    res.json({ task, progress_pct: pct });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── AI evaluate goal progress ── */
router.post('/:id/evaluate', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent:evaluate' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { rows } = await _db.getPool().query(
      `SELECT * FROM agent_goals WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const { rows: tasks } = await _db.getPool().query(`SELECT * FROM agent_tasks WHERE goal_id=$1`, [req.params.id]);
    const g = rows[0];

    const doneTasks = tasks.filter(t => t.status === 'done');
    const pendingTasks = tasks.filter(t => t.status !== 'done');

    const completion = await _oa().chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `You are an AI marketing agent judge. Evaluate progress toward this goal:
Goal: ${g.title}
Success criteria: ${g.success_criteria || 'Not specified'}
Deadline: ${g.deadline || 'None'}
Progress: ${g.progress_pct}% (${doneTasks.length}/${tasks.length} tasks done)
Completed tasks: ${doneTasks.map(t => t.title).join(', ') || 'none'}
Remaining tasks: ${pendingTasks.map(t => t.title).join(', ') || 'all done'}

Evaluate honestly: is this on track? What's the most important next action?
Return JSON: {"on_track":true,"grade":"A|B|C|D|F","assessment":"...","priority_next_action":"...","suggested_adjustments":["..."]}`
      }],
      response_format: { type: 'json_object' }, max_tokens: 600
    });

    let evaluation = {};
    try { evaluation = JSON.parse(completion.choices[0].message.content); } catch (_) {}
    if (evaluation._DUMMY || !evaluation.grade) {
      evaluation = { on_track: g.progress_pct >= 50, grade: g.progress_pct >= 75 ? 'B' : g.progress_pct >= 40 ? 'C' : 'D', assessment: 'Review task completion rate and focus on high-priority items.', priority_next_action: pendingTasks[0]?.title || 'All tasks complete', suggested_adjustments: ['Keep momentum on remaining tasks'] };
    }

    await _db.getPool().query(
      `UPDATE agent_goals SET last_evaluation=$1, updated_at=now() WHERE id=$2`,
      [JSON.stringify({ ...evaluation, evaluated_at: new Date().toISOString() }), g.id]
    );
    res.json({ evaluation, goal_id: g.id, source: 'gpt-4o' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── add manual task ── */
router.post('/:id/tasks', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent:add-task' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { title, description, action_type, priority, due_date } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const { rows } = await _db.getPool().query(
      `INSERT INTO agent_tasks (tenant_id,goal_id,title,description,action_type,priority,due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, req.params.id, title, description||'', action_type||'other', priority||2, due_date||null]
    );
    res.json({ task: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── mark goal complete / archive ── */
router.put('/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent:update-goal' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { status, title, description, success_criteria, deadline } = req.body;
    const { rows } = await _db.getPool().query(
      `UPDATE agent_goals SET status=COALESCE($3,status), title=COALESCE($4,title), description=COALESCE($5,description),
       success_criteria=COALESCE($6,success_criteria), deadline=COALESCE($7,deadline), updated_at=now()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, tid, status, title, description, success_criteria, deadline]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json({ goal: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── delete goal ── */
router.delete('/:id', async (req, res) => {
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'agent:delete' });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    await _db.getPool().query(`DELETE FROM agent_goals WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
