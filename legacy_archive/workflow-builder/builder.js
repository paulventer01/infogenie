  // ═══════════════════════════════════════════════════════════════════════════
  // T111 — VISUAL NO-CODE WORKFLOW BUILDER
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildWorkflowBuilder = async function () {
    const el = document.getElementById('view-workflow-builder');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>🔧 Workflow Automation Builder</h1><p>Visual no-code automation — connect any InfoGenie event to any action (email, Slack, HTTP, AI generate, CRM update) with branching logic and delays. Like Make.com, but inside InfoGenie.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="wf-list">My Workflows</button><button class="ig-tab" data-tab="wf-create">Create</button><button class="ig-tab" data-tab="wf-ai">AI Builder</button><button class="ig-tab" data-tab="wf-runs">Run History</button></div>
<div id="wf-list" class="ig-tab-panel"><div id="wf-workflows"><div class="ig-spinner">Loading…</div></div></div>
<div id="wf-create" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:660px">
    <h3>New Workflow</h3>
    <label>Workflow Name<input type="text" id="wf-name" class="ig-input" placeholder="e.g. ROAS Drop → Alert + Rebalance Budget"></label>
    <label>Description<textarea id="wf-desc" class="ig-textarea" rows="2" placeholder="What this workflow does…"></textarea></label>
    <label>Trigger<select id="wf-trigger" class="ig-select">
      <option value="manual">Manual trigger</option>
      <option value="schedule">Schedule (cron)</option>
      <option value="webhook">Inbound webhook</option>
      <option value="event_lead_created">Event: Lead created</option>
      <option value="event_ad_rejected">Event: Ad rejected</option>
      <option value="event_roas_drop">Event: ROAS drop</option>
      <option value="event_competitor_change">Event: Competitor change</option>
    </select></label>
    <div id="wf-nodes-editor" style="margin:16px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h4 style="margin:0">Workflow Steps</h4><button class="btn btn-sm btn-secondary" id="wf-add-node">+ Add Step</button></div>
      <div id="wf-node-list" style="min-height:40px;border:1px dashed #d1d5db;border-radius:8px;padding:12px"></div>
    </div>
    <button class="btn btn-primary" id="wf-save-btn">💾 Save Workflow</button>
    <div id="wf-save-result" style="margin-top:10px"></div>
  </div>
</div>
<div id="wf-ai" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:560px">
    <h3>🤖 AI Workflow Builder</h3>
    <p style="font-size:.87rem;color:#666">Describe what you want to automate in plain English. AI will build the workflow for you.</p>
    <textarea id="wf-ai-desc" class="ig-textarea" rows="4" placeholder="When a new lead is created, wait 5 minutes, then send them a welcome email, post to Slack, and if their score is > 80, also create a HubSpot deal…"></textarea>
    <button class="btn btn-primary" id="wf-ai-btn">✨ Build Workflow with AI</button>
    <div id="wf-ai-result" style="margin-top:12px"></div>
  </div>
</div>
<div id="wf-runs" class="ig-tab-panel hidden">
  <div id="wf-run-list"><div class="ig-spinner">Loading…</div></div>
</div>`;

    const wfNodes = [];

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'wf-list') loadWorkflows();
      if (t.dataset.tab === 'wf-runs') loadRuns();
    }));

    function renderNodes() {
      const c = el.querySelector('#wf-node-list');
      if (!wfNodes.length) { c.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:.87rem;padding:8px">No steps yet — add a step above</div>'; return; }
      c.innerHTML = wfNodes.map((n, i) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding:10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
        <span style="font-weight:700;color:#6366f1;min-width:24px">${i+1}</span>
        <span style="flex:1"><strong>${_esc(n.label || n.type)}</strong> <span style="font-size:.8rem;color:#6b7280">(${_esc(n.type)})</span></span>
        <button class="btn btn-sm btn-danger" data-rm="${i}">✕</button>
      </div>`).join('');
      c.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { wfNodes.splice(+b.dataset.rm, 1); renderNodes(); }));
    }

    el.querySelector('#wf-add-node').addEventListener('click', () => {
      const types = ['action_send_email', 'action_post_slack', 'action_http_webhook', 'action_ai_generate', 'action_tag_contact', 'action_create_campaign', 'condition_if', 'delay_wait', 'split_ab'];
      const type = prompt(`Step type:\n${types.join('\n')}`); if (!type || !types.includes(type)) return;
      const label = prompt('Step label (short description):') || type;
      const node = { type, label, config: {} };
      if (type === 'action_send_email') { node.config.to = prompt('To email:') || ''; node.config.subject = prompt('Subject:') || ''; }
      if (type === 'action_post_slack') { node.config.message = prompt('Slack message:') || ''; }
      if (type === 'action_http_webhook') { node.config.url = prompt('Webhook URL:') || ''; node.config.method = 'POST'; }
      if (type === 'action_ai_generate') { node.config.prompt = prompt('AI prompt:') || ''; }
      if (type === 'delay_wait') { node.config.duration = prompt('Duration (e.g. 5m, 1h, 1d):') || '5m'; }
      if (type === 'condition_if') { node.config.condition = prompt('Condition (e.g. lead.score > 80):') || ''; }
      wfNodes.push(node);
      renderNodes();
    });

    el.querySelector('#wf-save-btn').addEventListener('click', async () => {
      const name = el.querySelector('#wf-name').value;
      if (!name) { el.querySelector('#wf-save-result').innerHTML = `<div class="ig-alert ig-alert-danger">Workflow name is required</div>`; return; }
      const d = await _api('/api/workflow-builder/create', { method: 'POST', body: JSON.stringify({ name, description: el.querySelector('#wf-desc').value, trigger_type: el.querySelector('#wf-trigger').value, nodes: wfNodes }) });
      const res = el.querySelector('#wf-save-result');
      if (d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-success">✅ Workflow saved!</div>`; wfNodes.length = 0; renderNodes(); loadWorkflows(); }
      else { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; }
    });

    el.querySelector('#wf-ai-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#wf-ai-btn');
      btn.disabled = true; btn.textContent = '⏳ Building…';
      const d = await _api('/api/workflow-builder/ai-build', { method: 'POST', body: JSON.stringify({ description: el.querySelector('#wf-ai-desc').value }) });
      btn.disabled = false; btn.textContent = '✨ Build Workflow with AI';
      const res = el.querySelector('#wf-ai-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }
      const w = d.workflow;
      res.innerHTML = `<div class="ig-form-card">
        <h4>${_esc(w.name)}</h4>
        <div class="ig-card-meta">Trigger: <code>${_esc(w.trigger_type)}</code> · Est. time: ${_esc(w.estimated_time_to_complete)}</div>
        <div style="margin:10px 0">${(w.nodes || []).map((n, i) => `<div class="ig-step-row"><span class="ig-step-num">${i+1}</span><strong>${_esc(n.label)}</strong> <span style="font-size:.8rem;color:#6b7280">(${_esc(n.type)})</span></div>`).join('')}</div>
        <button class="btn btn-success" id="wf-ai-save">Save This Workflow</button>
      </div>`;
      res.querySelector('#wf-ai-save').addEventListener('click', async () => {
        const d2 = await _api('/api/workflow-builder/create', { method: 'POST', body: JSON.stringify(w) });
        if (d2.ok) { alert('Workflow saved!'); loadWorkflows(); }
      });
    });

    async function loadWorkflows() {
      const d = await _api('/api/workflow-builder/list');
      const c = el.querySelector('#wf-workflows');
      if (!d.ok || !d.workflows.length) { c.innerHTML = '<div class="ig-empty">No workflows yet. Create one above or use the AI builder.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Name</th><th>Trigger</th><th>Active</th><th>Runs</th><th>Success</th><th>Last Run</th><th>Actions</th></tr></thead><tbody>` +
        d.workflows.map(w => `<tr>
          <td><strong>${_esc(w.name)}</strong>${w.description ? `<div style="font-size:.8rem;color:#666">${_esc(w.description)}</div>` : ''}</td>
          <td><code style="font-size:.8rem">${_esc(w.trigger_type)}</code></td>
          <td>${w.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Off</span>'}</td>
          <td>${w.run_count}</td>
          <td>${w.success_count}</td>
          <td>${_ts(w.last_run_at)}</td>
          <td>
            <button class="btn btn-sm btn-primary" data-run="${w.id}">▶ Run</button>
            <button class="btn btn-sm btn-secondary" data-toggle="${w.id}">${w.is_active ? 'Pause' : 'Activate'}</button>
            <button class="btn btn-sm btn-danger" data-del="${w.id}">Del</button>
          </td>
        </tr>`).join('') + '</tbody></table>';
      c.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = '⏳';
        const d2 = await _api('/api/workflow-builder/' + b.dataset.run + '/run', { method: 'POST' });
        b.disabled = false; b.textContent = '▶ Run';
        alert(`Workflow run: ${d2.status} · ${d2.steps ? d2.steps.length : 0} steps executed`);
        loadWorkflows();
      }));
      c.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => { await _api('/api/workflow-builder/' + b.dataset.toggle + '/toggle', { method: 'POST' }); loadWorkflows(); }));
      c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete workflow?')) return; await _api('/api/workflow-builder/' + b.dataset.del, { method: 'DELETE' }); loadWorkflows(); }));
    }

    async function loadRuns() {
      const d = await _api('/api/workflow-builder/runs/all');
      const c = el.querySelector('#wf-run-list');
      if (!d.ok || !d.runs.length) { c.innerHTML = '<div class="ig-empty">No workflow runs yet.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Workflow</th><th>Status</th><th>Started</th><th>Completed</th></tr></thead><tbody>` +
        d.runs.map(r => `<tr><td>${_esc(r.workflow_name)}</td><td>${_badge(r.status, STATUS_MAP)}</td><td>${_ts(r.started_at)}</td><td>${_ts(r.completed_at)}</td></tr>`).join('') +
        '</tbody></table>';
    }

    renderNodes();
    loadWorkflows();
  };

