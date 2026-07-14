/* ══════════════════════════════════════════════════════════════
   T98 · APPROVAL WORKFLOWS
══════════════════════════════════════════════════════════════ */
window.buildApprovalWorkflows = async function() {
  const el = document.getElementById('view-approval-workflows');
  if (!el) return;
  const STATUS_COLORS={pending:'#f59e0b',approved:'#22c55e',rejected:'#ef4444',executed:'#3b82f6',rolled_back:'#64748b'};

  el.innerHTML = `<div class="ig-panel">
    <div class="ig-panel-header"><h2>✅ Approval Workflows</h2>
      <p class="ig-panel-sub">Human-in-the-loop governance for every AI-proposed action — with simulation, approval policies, audit trail, and one-click rollback.</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
      <button id="aw-new-request-btn" class="ig-btn ig-btn-primary">+ Submit Action for Approval</button>
      <button id="aw-new-policy-btn" class="ig-btn">⚙️ Manage Policies</button>
      <button id="aw-refresh-btn" class="ig-btn">Refresh</button>
    </div>
    <div id="aw-request-form" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px;">
      <h4 style="margin:0 0 12px;">Submit Action for Approval</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><label class="ig-label">Action Type *</label><select id="aw-type" class="ig-input">
          <option value="pause_campaign">Pause Campaign</option><option value="scale_budget">Scale Budget</option>
          <option value="launch_campaign">Launch Campaign</option><option value="send_email">Send Email</option>
          <option value="publish_content">Publish Content</option><option value="audience_change">Audience Change</option>
          <option value="price_change">Price Change</option><option value="other">Other</option>
        </select></div>
        <div><label class="ig-label">Channel</label><input id="aw-channel" class="ig-input" placeholder="Meta Ads, Email, etc."/></div>
        <div style="grid-column:1/-1"><label class="ig-label">Title *</label><input id="aw-title" class="ig-input" placeholder="Pause Campaign X — low ROAS"/></div>
        <div style="grid-column:1/-1"><label class="ig-label">Description</label><textarea id="aw-desc" class="ig-input" style="min-height:60px;" placeholder="Describe what will happen and why…"></textarea></div>
        <div><label class="ig-label">Budget Impact ($)</label><input id="aw-budget" class="ig-input" type="number" placeholder="5000"/></div>
        <div><label class="ig-label">Proposed By</label><input id="aw-by" class="ig-input" placeholder="AI Optimizer / Your Name"/></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;">
        <button id="aw-submit-btn" class="ig-btn ig-btn-primary">Submit &amp; Simulate</button>
        <button id="aw-cancel-request-btn" class="ig-btn">Cancel</button>
      </div>
    </div>
    <div id="aw-policy-panel" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px;">
      <h4 style="margin:0 0 12px;">Approval Policies</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div><label class="ig-label">Policy Name *</label><input id="ap-name" class="ig-input" placeholder="Budget changes > $5k"/></div>
        <div><label class="ig-label">Budget Threshold ($)</label><input id="ap-threshold" class="ig-input" type="number" placeholder="5000"/></div>
        <div><label class="ig-label">Action Types (comma-separated)</label><input id="ap-types" class="ig-input" placeholder="pause_campaign,scale_budget"/></div>
        <div><label class="ig-label">Notify Email</label><input id="ap-email" class="ig-input" type="email" placeholder="cmo@company.com"/></div>
      </div>
      <button id="ap-save-btn" class="ig-btn ig-btn-primary" style="margin-bottom:12px;">Save Policy</button>
      <div id="ap-list"></div>
    </div>
    <div id="aw-queue"></div>
  </div>`;

  async function loadQueue(){
    const data = await _api('/approvals/queue');
    const el2 = document.getElementById('aw-queue');
    if(!el2) return;
    if(!data.ok||!data.requests.length){ el2.innerHTML='<div class="ig-empty" style="text-align:center;padding:40px;color:var(--text-muted);">No approval requests yet.</div>'; return; }
    el2.innerHTML = data.requests.map(r=>{
      let sim={};
      try{sim=JSON.parse(r.simulation_result||'{}')}catch(e){}
      return `<div class="ig-card" style="margin-bottom:10px;" data-id="${r.id}">
        <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
              <strong>${_esc(r.title)}</strong>
              <span class="ig-badge" style="background:${STATUS_COLORS[r.status]||'#888'}20;color:${STATUS_COLORS[r.status]||'#888'};border:1px solid ${STATUS_COLORS[r.status]||'#888'}40;">${r.status}</span>
              <span class="ig-badge">${r.action_type}</span>
              ${r.channel?`<span class="ig-badge">${_esc(r.channel)}</span>`:''}
            </div>
            ${r.description?`<p style="margin:0 0 6px;color:var(--text-muted);font-size:13px;">${_esc(r.description)}</p>`:''}
            ${sim.expected_outcome?`<div style="background:var(--bg-hover);border-radius:6px;padding:8px;font-size:12px;margin-bottom:6px;">
              🤖 <strong>Simulation:</strong> ${_esc(sim.expected_outcome)}
              <span style="margin-left:8px;color:${sim.simulation_verdict==='safe'?'#22c55e':sim.simulation_verdict==='high_risk'?'#ef4444':'#f59e0b'};">● ${sim.simulation_verdict||''}</span>
              <br>✅ Best: ${_esc(sim.best_case||'')} &nbsp;|&nbsp; ⚠️ Worst: ${_esc(sim.worst_case||'')}
            </div>`:''}
            <div style="font-size:12px;color:var(--text-muted);">
              ${r.budget_impact?`💸 $${(+r.budget_impact).toLocaleString()} impact &nbsp;·&nbsp;`:''}
              Proposed by: ${_esc(r.proposed_by||'—')} &nbsp;·&nbsp;
              ${new Date(r.created_at).toLocaleDateString()}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${r.status==='pending'?`
              <button class="ig-btn ig-btn-sm ig-btn-primary aw-approve-btn" data-id="${r.id}">✓ Approve</button>
              <button class="ig-btn ig-btn-sm aw-reject-btn" data-id="${r.id}" style="color:#ef4444;">✗ Reject</button>`:''}
            ${r.status==='approved'?`<button class="ig-btn ig-btn-sm ig-btn-primary aw-execute-btn" data-id="${r.id}">▶ Execute</button>`:''}
            ${r.status==='executed'?`<button class="ig-btn ig-btn-sm aw-rollback-btn" data-id="${r.id}" style="color:#f59e0b;">↩ Rollback</button>`:''}
          </div>
        </div>
      </div>`;
    }).join('');

    el2.querySelectorAll('.aw-approve-btn').forEach(b=>b.addEventListener('click',async()=>{
      await _post('/approvals/approve/'+b.dataset.id,{}); _toast('Approved','success'); loadQueue();
    }));
    el2.querySelectorAll('.aw-reject-btn').forEach(b=>b.addEventListener('click',async()=>{
      const notes=prompt('Rejection reason (optional):');
      await _post('/approvals/reject/'+b.dataset.id,{notes}); _toast('Rejected','info'); loadQueue();
    }));
    el2.querySelectorAll('.aw-execute-btn').forEach(b=>b.addEventListener('click',async()=>{
      if(!confirm('Execute this action now?')) return;
      await _post('/approvals/execute/'+b.dataset.id,{}); _toast('Executed','success'); loadQueue();
    }));
    el2.querySelectorAll('.aw-rollback-btn').forEach(b=>b.addEventListener('click',async()=>{
      const reason=prompt('Rollback reason:');
      if(!reason) return;
      await _post('/approvals/rollback/'+b.dataset.id,{reason}); _toast('Rolled back','info'); loadQueue();
    }));
  }

  async function loadPolicies(){
    const data = await _api('/approvals/policies');
    const el2 = document.getElementById('ap-list');
    if(!el2) return;
    if(!data.ok||!data.policies.length){ el2.innerHTML='<p style="color:var(--text-muted);font-size:13px;">No policies yet.</p>'; return; }
    el2.innerHTML = data.policies.map(p=>`<div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-hover);border-radius:6px;margin-bottom:6px;">
      <div style="flex:1;"><strong>${_esc(p.name)}</strong> <small style="color:var(--text-muted);">${_esc(p.action_types)} ${p.budget_threshold?'· $'+_esc(p.budget_threshold)+' threshold':''}</small></div>
      <button class="ig-btn ig-btn-sm" style="color:#ef4444;" onclick="window._awDeletePolicy(${p.id})">Delete</button>
    </div>`).join('');
  }

  window._awDeletePolicy = async function(id){ await _del('/approvals/policies/'+id); loadPolicies(); };

  loadQueue();
  document.getElementById('aw-refresh-btn').addEventListener('click',loadQueue);
  document.getElementById('aw-new-request-btn').addEventListener('click',()=>{ document.getElementById('aw-request-form').style.display='block'; });
  document.getElementById('aw-cancel-request-btn').addEventListener('click',()=>{ document.getElementById('aw-request-form').style.display='none'; });
  document.getElementById('aw-new-policy-btn').addEventListener('click',()=>{
    const panel=document.getElementById('aw-policy-panel');
    panel.style.display = panel.style.display==='none'?'block':'none';
    if(panel.style.display==='block') loadPolicies();
  });
  document.getElementById('ap-save-btn').addEventListener('click',async()=>{
    const name=document.getElementById('ap-name').value.trim();
    const action_types=document.getElementById('ap-types').value.trim();
    if(!name||!action_types) return _toast('Name and action types required','error');
    const data=await _post('/approvals/policies',{name,action_types,budget_threshold:+document.getElementById('ap-threshold').value||null,notify_email:document.getElementById('ap-email').value||null});
    if(data.ok){ _toast('Policy saved','success'); document.getElementById('ap-name').value=''; loadPolicies(); }
    else _toast(data.error||'Failed','error');
  });
  document.getElementById('aw-submit-btn').addEventListener('click',async()=>{
    const title=document.getElementById('aw-title').value.trim();
    const action_type=document.getElementById('aw-type').value;
    if(!title) return _toast('Title required','error');
    _toast('Simulating action…','info');
    const data=await _post('/approvals/request',{
      action_type,title,
      description:document.getElementById('aw-desc').value,
      channel:document.getElementById('aw-channel').value,
      budget_impact:+document.getElementById('aw-budget').value||null,
      proposed_by:document.getElementById('aw-by').value,
    });
    if(data.ok){ document.getElementById('aw-request-form').style.display='none'; _toast('Submitted for approval','success'); loadQueue(); }
    else _toast(data.error||'Failed','error');
  });
};

