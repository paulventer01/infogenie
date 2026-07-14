/* ══════════════════════════════════════════════════════════════
   T100 · REVENUE INTELLIGENCE
══════════════════════════════════════════════════════════════ */
window.buildRevenueIntel = async function() {
  const el = document.getElementById('view-revenue-intel');
  if (!el) return;
  const STAGE_COLS={awareness:'#8b5cf6',interest:'#3b82f6',intent:'#f59e0b',consideration:'#f97316',decision:'#22c55e',customer:'#10b981',churned:'#ef4444'};

  el.innerHTML = `<div class="ig-panel">
    <div class="ig-panel-header"><h2>💼 Revenue Intelligence</h2>
      <p class="ig-panel-sub">Account intent scoring, pipeline influence, and real-time sales play triggers — marketing tied to pipeline.</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
      <button id="ri-add-account-btn" class="ig-btn ig-btn-primary">+ Add Account</button>
      <button id="ri-triggers-btn" class="ig-btn" style="color:#f59e0b;">🔥 Hot Triggers</button>
      <button id="ri-pipeline-btn" class="ig-btn">📊 Pipeline View</button>
      <button id="ri-refresh-btn" class="ig-btn">Refresh</button>
    </div>
    <div id="ri-add-form" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px;">
      <h4 style="margin:0 0 12px;">Add Account</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div><label class="ig-label">Company Name *</label><input id="ri-company" class="ig-input" placeholder="Acme Corp"/></div>
        <div><label class="ig-label">Domain</label><input id="ri-domain" class="ig-input" placeholder="acme.com"/></div>
        <div><label class="ig-label">Industry</label><input id="ri-industry" class="ig-input" placeholder="SaaS"/></div>
        <div><label class="ig-label">Pipeline Stage</label><select id="ri-stage" class="ig-input">
          ${['awareness','interest','intent','consideration','decision','customer'].map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select></div>
        <div><label class="ig-label">Pipeline Value ($)</label><input id="ri-value" class="ig-input" type="number" placeholder="25000"/></div>
        <div><label class="ig-label">Account Owner</label><input id="ri-owner" class="ig-input" placeholder="Jane Sales"/></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;">
        <button id="ri-save-account-btn" class="ig-btn ig-btn-primary">Add Account</button>
        <button id="ri-cancel-add-btn" class="ig-btn">Cancel</button>
      </div>
    </div>
    <div id="ri-main-view"></div>
  </div>`;

  let _view = 'accounts';

  async function loadAccounts(){
    _view='accounts';
    const data = await _api('/revenue-intel/accounts');
    const el2 = document.getElementById('ri-main-view');
    if(!el2) return;
    if(!data.ok||!data.accounts.length){ el2.innerHTML='<div class="ig-empty" style="text-align:center;padding:40px;color:var(--text-muted);">No accounts yet. Add your first account above.</div>'; return; }
    el2.innerHTML = `<table class="ig-table" style="width:100%;border-collapse:collapse;">
      <thead><tr><th>Account</th><th>Stage</th><th>Intent</th><th>Pipeline Value</th><th>Owner</th><th>Actions</th></tr></thead>
      <tbody>${data.accounts.map(a=>`<tr>
        <td><strong>${_esc(a.company_name)}</strong><br><small style="color:var(--text-muted);">${_esc(a.domain||'')}</small></td>
        <td><span class="ig-badge" style="background:${STAGE_COLS[a.pipeline_stage]||'#888'}20;color:${STAGE_COLS[a.pipeline_stage]||'#888'};">${a.pipeline_stage}</span></td>
        <td><div style="display:flex;align-items:center;gap:6px;">
          <div style="width:60px;height:6px;background:var(--bg-hover);border-radius:3px;overflow:hidden;"><div style="width:${a.intent_score||0}%;height:100%;background:${STAGE_COLS[a.pipeline_stage]||'#3b82f6'};border-radius:3px;"></div></div>
          <span>${a.intent_score||0}</span></div></td>
        <td>${_cur(a.pipeline_value||0)}</td>
        <td>${_esc(a.owner_name||'—')}</td>
        <td style="display:flex;gap:4px;">
          <button class="ig-btn ig-btn-sm" onclick="window._riScore(${a.id})">AI Score</button>
          <button class="ig-btn ig-btn-sm" onclick="window._riLogSignal(${a.id})">+ Signal</button>
        </td>
      </tr>`).join('')}</tbody></table>`;
  }

  async function loadTriggers(){
    _view='triggers';
    const data = await _api('/revenue-intel/triggers');
    const el2 = document.getElementById('ri-main-view');
    if(!el2) return;
    if(!data.ok||!data.triggers.length){ el2.innerHTML='<div class="ig-empty" style="text-align:center;padding:40px;color:var(--text-muted);">No hot accounts in the past 7 days. Log intent signals to trigger alerts.</div>'; return; }
    el2.innerHTML = '<h4 style="margin:0 0 12px;">🔥 Sales Play Triggers — Act Now</h4>'+data.triggers.map(t=>`
      <div class="ig-card" style="margin-bottom:8px;border-left:4px solid ${STAGE_COLS[t.pipeline_stage]||'#f59e0b'};">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;">
            <strong>${_esc(t.company_name)}</strong>
            <span class="ig-badge" style="background:${STAGE_COLS[t.pipeline_stage]||'#888'}20;color:${STAGE_COLS[t.pipeline_stage]||'#888'};margin-left:6px;">${t.pipeline_stage}</span>
            <br><small style="color:var(--text-muted);">Signal: ${_esc(t.signal_type||'')} — ${_esc(t.signal_desc||'')} &nbsp;·&nbsp; Intent: ${t.intent_score}</small>
          </div>
          <button class="ig-btn ig-btn-sm ig-btn-primary" onclick="window._riScore(${t.id})">Get Recommended Play</button>
        </div>
      </div>`).join('');
  }

  async function loadPipeline(){
    _view='pipeline';
    const data = await _api('/revenue-intel/pipeline');
    const el2 = document.getElementById('ri-main-view');
    if(!el2||!data.ok) return;
    const totalVal = +(data.total?.total||0);
    el2.innerHTML = `<div style="margin-bottom:18px;">
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div class="ig-stat-card"><div class="ig-stat-num">${_cur(totalVal)}</div><div class="ig-stat-label">Total Pipeline</div></div>
        <div class="ig-stat-card"><div class="ig-stat-num">${data.total?.total_accounts||0}</div><div class="ig-stat-label">Accounts</div></div>
      </div>
      <h4 style="margin:0 0 10px;">Pipeline by Stage</h4>
      ${(data.by_stage||[]).map(s=>`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="min-width:110px;font-size:13px;color:${STAGE_COLS[s.pipeline_stage]||'#888'};">● ${s.pipeline_stage}</span>
        <div style="flex:1;height:18px;background:var(--bg-hover);border-radius:4px;overflow:hidden;">
          <div style="width:${totalVal?Math.min(100,((+s.value||0)/totalVal)*100):0}%;height:100%;background:${STAGE_COLS[s.pipeline_stage]||'#3b82f6'};border-radius:4px;"></div>
        </div>
        <span style="min-width:70px;text-align:right;">${_cur(s.value||0)}</span>
        <span style="min-width:30px;text-align:right;color:var(--text-muted);">${s.accounts}</span>
      </div>`).join('')}
    </div>
    <h4>Top Accounts by Intent</h4>
    ${(data.top_accounts||[]).map(a=>`<div style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--border);">
      <div style="flex:1;"><strong>${_esc(a.company_name)}</strong> <small style="color:var(--text-muted);">${_esc(a.industry||'')}</small></div>
      <span class="ig-badge" style="background:${STAGE_COLS[a.pipeline_stage]||'#888'}20;color:${STAGE_COLS[a.pipeline_stage]||'#888'};">${a.pipeline_stage}</span>
      <span>Intent: <strong>${a.intent_score}</strong></span>
      <span>${_cur(a.pipeline_value||0)}</span>
    </div>`).join('')}`;
  }

  window._riScore = async function(id){
    _toast('AI scoring account…','info');
    const data=await _post('/revenue-intel/score-account',{account_id:id});
    if(data.ok){
      const s=data.scoring;
      alert(`🎯 Recommended Play:\n\n${s.recommended_play}\n\nOutreach angle:\n${s.outreach_angle}\n\nUrgency: ${s.urgency} · Deal probability: ${s.deal_probability_pct}%\n\nActions:\n${(s.recommended_actions||[]).join('\n')}`);
      loadAccounts();
    } else _toast(data.error||'Scoring failed','error');
  };

  window._riLogSignal = async function(id){
    const signal_type=prompt('Signal type:\n'+['page_visit','pricing_page','demo_request','content_download','email_open','social_engage','offline_meeting'].join(', '));
    if(!signal_type) return;
    const desc=prompt('Description (optional):');
    const data=await _post('/revenue-intel/signal',{account_id:id,signal_type,description:desc});
    if(data.ok){ _toast(`Signal logged (+${data.score_delta} intent score)`,'success'); loadAccounts(); }
    else _toast(data.error||'Failed','error');
  };

  loadAccounts();
  document.getElementById('ri-refresh-btn').addEventListener('click',()=>{ _view==='triggers'?loadTriggers():_view==='pipeline'?loadPipeline():loadAccounts(); });
  document.getElementById('ri-triggers-btn').addEventListener('click',loadTriggers);
  document.getElementById('ri-pipeline-btn').addEventListener('click',loadPipeline);
  document.getElementById('ri-add-account-btn').addEventListener('click',()=>{ document.getElementById('ri-add-form').style.display='block'; });
  document.getElementById('ri-cancel-add-btn').addEventListener('click',()=>{ document.getElementById('ri-add-form').style.display='none'; });
  document.getElementById('ri-save-account-btn').addEventListener('click',async()=>{
    const company_name=document.getElementById('ri-company').value.trim();
    if(!company_name) return _toast('Company name required','error');
    const data=await _post('/revenue-intel/accounts/add',{
      company_name,domain:document.getElementById('ri-domain').value,
      industry:document.getElementById('ri-industry').value,
      pipeline_stage:document.getElementById('ri-stage').value,
      pipeline_value:+document.getElementById('ri-value').value||0,
      owner_name:document.getElementById('ri-owner').value,
    });
    if(data.ok){ document.getElementById('ri-add-form').style.display='none'; _toast('Account added','success'); loadAccounts(); }
    else _toast(data.error||'Failed','error');
  });
};

