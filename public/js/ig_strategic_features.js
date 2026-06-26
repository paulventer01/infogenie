(function(){
'use strict';

/* ─── shared helpers ─────────────────────────────────────────── */
function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _pct(n){ return (+(n||0)).toFixed(1)+'%'; }
function _cur(n){ return '$'+(+(n||0)).toLocaleString(); }
function _toast(m,t){ if(window.showToast)window.showToast(m,t); else alert(m); }
function _api(path,opts){ return fetch('/api'+path,Object.assign({headers:{'Content-Type':'application/json'}},opts)).then(r=>r.json()); }
function _post(path,body){ return _api(path,{method:'POST',body:JSON.stringify(body)}); }
function _del(path){ return _api(path,{method:'DELETE'}); }

/* ══════════════════════════════════════════════════════════════
   T95 · UNIFIED DECISION ENGINE
══════════════════════════════════════════════════════════════ */
window.buildDecisionEngine = async function() {
  const el = document.getElementById('view-decision-engine');
  if (!el) return;
  el.innerHTML = `<div class="ig-panel">
    <div class="ig-panel-header"><h2>🧭 Unified Decision Engine</h2>
      <p class="ig-panel-sub">Ranked recommendations across every marketing channel — what to do next, why, and what to expect.</p></div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;">
      <textarea id="de-context" placeholder="Optional: add context (e.g. Q3 focus areas, budget constraints, competitor launches…)" style="flex:1;min-width:220px;min-height:60px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:var(--text);resize:vertical;"></textarea>
      <button id="de-analyse-btn" class="ig-btn ig-btn-primary" style="align-self:flex-end;padding:12px 28px;">⚡ Analyse &amp; Rank</button>
    </div>
    <div id="de-rec-list"><div class="ig-empty" style="text-align:center;padding:60px 20px;color:var(--text-muted);">Click <strong>Analyse &amp; Rank</strong> to generate your personalised decision queue.</div></div>
  </div>`;

  async function loadExisting(){
    const data = await _api('/decision-engine/recommendations');
    if(data.ok && data.recommendations.length) renderRecs(data.recommendations);
  }
  loadExisting();

  const CATS = {budget:'💰',channel:'📡',creative:'🎨',audience:'👥',seo:'🔍',lifecycle:'🔄',competitive:'⚔️'};
  const CONF_COLOR = n => n>=80?'#22c55e':n>=60?'#f59e0b':'#ef4444';

  function renderRecs(recs){
    const el2 = document.getElementById('de-rec-list');
    if(!el2) return;
    el2.innerHTML = recs.map(r=>`
      <div class="ig-card" style="margin-bottom:12px;border-left:4px solid ${CONF_COLOR(r.confidence_pct)};" data-id="${r.id}">
        <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
              <span style="font-size:18px;">${CATS[r.category]||'📌'}</span>
              <strong style="font-size:15px;">${_esc(r.title)}</strong>
              <span class="ig-badge" style="background:${CONF_COLOR(r.confidence_pct)}20;color:${CONF_COLOR(r.confidence_pct)};border:1px solid ${CONF_COLOR(r.confidence_pct)}40;">${r.confidence_pct}% confidence</span>
              <span class="ig-badge" style="background:var(--bg-hover);">#${r.priority_score} priority</span>
              ${r.acted_at?'<span class="ig-badge" style="background:#22c55e20;color:#22c55e;border:1px solid #22c55e40;">✓ Acted</span>':''}
            </div>
            <p style="margin:0 0 8px;color:var(--text-muted);">${_esc(r.recommendation)}</p>
            <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);">
              <span>📈 ${_esc(r.expected_impact||'—')}</span>
              <span>💸 ${_esc(r.cost_estimate||'—')}</span>
              <span>⏱ ${_esc(r.time_to_result||'—')}</span>
              <span>📊 ${_esc(r.data_sources||'—')}</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${!r.acted_at?`<button class="ig-btn ig-btn-sm ig-btn-primary de-act-btn" data-id="${r.id}">Mark Done</button>`:''}
            <button class="ig-btn ig-btn-sm de-dismiss-btn" data-id="${r.id}">Dismiss</button>
          </div>
        </div>
      </div>`).join('');

    el2.querySelectorAll('.de-act-btn').forEach(b=>b.addEventListener('click',async()=>{
      await _post('/decision-engine/act/'+b.dataset.id,{});
      _toast('Marked as acted','success');
      b.closest('[data-id]').style.opacity='0.5';
    }));
    el2.querySelectorAll('.de-dismiss-btn').forEach(b=>b.addEventListener('click',async()=>{
      await _post('/decision-engine/dismiss/'+b.dataset.id,{});
      b.closest('[data-id]').remove();
    }));
  }

  document.getElementById('de-analyse-btn').addEventListener('click',async()=>{
    const btn=document.getElementById('de-analyse-btn');
    btn.disabled=true; btn.textContent='Analysing…';
    const context_notes = document.getElementById('de-context').value;
    const data = await _post('/decision-engine/analyse',{context_notes});
    btn.disabled=false; btn.textContent='⚡ Analyse & Rank';
    if(data.ok){
      renderRecs(data.recommendations);
      if(data.summary) _toast(data.summary,'info');
    } else _toast(data.error||'Analysis failed','error');
  });
};

/* ══════════════════════════════════════════════════════════════
   T96 · EXPERIMENT SUITE
══════════════════════════════════════════════════════════════ */
window.buildExperimentSuite = async function() {
  const el = document.getElementById('view-experiment-suite');
  if (!el) return;
  const TYPE_LABELS = {a_b:'A/B Test',geo_lift:'Geo-Lift Test',holdout:'Holdout Group',creative_incrementality:'Creative Incrementality',audience_saturation:'Audience Saturation'};
  const STATUS_COLORS = {draft:'#64748b',running:'#3b82f6',paused:'#f59e0b',complete:'#22c55e',cancelled:'#ef4444'};

  el.innerHTML = `<div class="ig-panel">
    <div class="ig-panel-header"><h2>🧬 Experiment Suite</h2>
      <p class="ig-panel-sub">Design, track and analyse incrementality experiments — geo-lift, holdout groups, creative tests and audience saturation detection.</p></div>
    <div style="display:flex;gap:10px;margin-bottom:18px;">
      <button id="es-new-btn" class="ig-btn ig-btn-primary">+ New Experiment</button>
      <button id="es-refresh-btn" class="ig-btn">Refresh</button>
    </div>
    <div id="es-form" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px;">
      <h4 style="margin:0 0 14px;">New Experiment</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;flex-wrap:wrap;">
        <div><label class="ig-label">Name *</label><input id="es-name" class="ig-input" placeholder="Q3 Channel Holdout Test"/></div>
        <div><label class="ig-label">Type *</label><select id="es-type" class="ig-input">
          ${Object.entries(TYPE_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
        </select></div>
        <div><label class="ig-label">Hypothesis</label><input id="es-hyp" class="ig-input" placeholder="Pausing Meta spend will reduce conversions by &lt;10%"/></div>
        <div><label class="ig-label">Channels</label><input id="es-channels" class="ig-input" placeholder="Meta, Google, Email"/></div>
        <div><label class="ig-label">Control Group</label><input id="es-control" class="ig-input" placeholder="Geo A — normal spend"/></div>
        <div><label class="ig-label">Variant Group</label><input id="es-variant" class="ig-input" placeholder="Geo B — Meta paused"/></div>
        <div><label class="ig-label">Budget Split</label><input id="es-budget" class="ig-input" placeholder="50/50"/></div>
        <div><label class="ig-label">Start Date</label><input id="es-start" class="ig-input" type="date"/></div>
      </div>
      <div style="margin-top:14px;display:flex;gap:10px;">
        <button id="es-create-btn" class="ig-btn ig-btn-primary">Create Experiment</button>
        <button id="es-cancel-btn" class="ig-btn">Cancel</button>
      </div>
    </div>
    <div id="es-list"></div>
  </div>`;

  async function loadExps(){
    const data = await _api('/experiments/list');
    const el2 = document.getElementById('es-list');
    if(!el2) return;
    if(!data.ok||!data.experiments.length){ el2.innerHTML='<div class="ig-empty" style="text-align:center;padding:40px;color:var(--text-muted);">No experiments yet. Create your first experiment above.</div>'; return; }
    el2.innerHTML = data.experiments.map(e=>`
      <div class="ig-card" style="margin-bottom:10px;" data-id="${e.id}">
        <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
              <strong>${_esc(e.name)}</strong>
              <span class="ig-badge" style="background:${STATUS_COLORS[e.status]||'#64748b'}20;color:${STATUS_COLORS[e.status]};border:1px solid ${STATUS_COLORS[e.status]}40;">${e.status}</span>
              <span class="ig-badge">${TYPE_LABELS[e.type]||e.type}</span>
            </div>
            ${e.hypothesis?`<p style="margin:0 0 6px;color:var(--text-muted);font-size:13px;"><em>${_esc(e.hypothesis)}</em></p>`:''}
            <div style="display:flex;gap:14px;font-size:12px;color:var(--text-muted);flex-wrap:wrap;">
              ${e.lift_pct!=null?`<span>📈 Lift: ${e.lift_pct}%</span>`:''}
              ${e.confidence_pct!=null?`<span>🎯 Confidence: ${e.confidence_pct}%</span>`:''}
              ${e.channels?`<span>📡 ${_esc(e.channels)}</span>`:''}
            </div>
            ${e.ai_analysis?`<div style="margin-top:8px;font-size:12px;padding:8px;background:var(--bg-hover);border-radius:6px;">🤖 ${_esc(JSON.parse(e.ai_analysis||'{}').interpretation||'')}</div>`:''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${e.status!=='complete'?`<select class="ig-input" style="font-size:12px;padding:4px 8px;" onchange="window._esUpdateStatus(${e.id},this.value)">
              ${['draft','running','paused','complete','cancelled'].map(s=>`<option value="${s}" ${e.status===s?'selected':''}>${s}</option>`).join('')}
            </select>`:''}
            <button class="ig-btn ig-btn-sm" onclick="window._esAnalyse(${e.id})">AI Analysis</button>
          </div>
        </div>
      </div>`).join('');
  }

  window._esUpdateStatus = async function(id, status){
    await _post('/experiments/'+id+'/update',{status});
    _toast('Status updated','success');
    loadExps();
  };
  window._esAnalyse = async function(id){
    _toast('Running AI analysis…','info');
    const data = await _post('/experiments/'+id+'/analyse',{});
    if(data.ok){ _toast(data.analysis.verdict+': '+data.analysis.next_action,'success'); loadExps(); }
    else _toast(data.error||'Analysis failed','error');
  };

  loadExps();

  // ── F07: Statistical A/B Confidence Calculator ───────────────────────────
  const confCard = document.createElement('div');
  confCard.className = 'ig-card';
  confCard.style.cssText = 'margin-top:24px;';
  confCard.innerHTML = `
    <h3 style="margin:0 0 14px;font-size:1rem">📊 A/B Statistical Confidence Calculator</h3>
    <p style="margin:0 0 14px;font-size:0.83rem;color:var(--text-muted)">Enter raw counts for control and variant to get a two-proportion z-test with significance verdict, lift %, and recommended sample size.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <div style="font-weight:700;font-size:0.82rem;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">Control</div>
        <label class="ig-label">Visitors (N)</label><input id="ab-ctrl-n" class="ig-input" type="number" min="1" placeholder="e.g. 5000" style="margin-bottom:6px">
        <label class="ig-label">Conversions</label><input id="ab-ctrl-conv" class="ig-input" type="number" min="0" placeholder="e.g. 210">
      </div>
      <div>
        <div style="font-weight:700;font-size:0.82rem;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">Variant</div>
        <label class="ig-label">Visitors (N)</label><input id="ab-var-n" class="ig-input" type="number" min="1" placeholder="e.g. 5000" style="margin-bottom:6px">
        <label class="ig-label">Conversions</label><input id="ab-var-conv" class="ig-input" type="number" min="0" placeholder="e.g. 258">
      </div>
    </div>
    <button id="ab-calc-btn" class="ig-btn ig-btn-primary" style="margin-bottom:16px">⚡ Calculate Significance</button>
    <div id="ab-result"></div>`;
  el.querySelector('.ig-panel').appendChild(confCard);

  confCard.querySelector('#ab-calc-btn').addEventListener('click', async () => {
    const ctrl_n = +confCard.querySelector('#ab-ctrl-n').value;
    const ctrl_conv = +confCard.querySelector('#ab-ctrl-conv').value;
    const var_n = +confCard.querySelector('#ab-var-n').value;
    const var_conv = +confCard.querySelector('#ab-var-conv').value;
    if (!ctrl_n || !var_n) { _toast('Enter visitor counts for both groups','error'); return; }
    const data = await _post('/experiments/confidence', {
      control_n: ctrl_n, control_conversions: ctrl_conv,
      variant_n: var_n, variant_conversions: var_conv
    });
    const res = confCard.querySelector('#ab-result');
    if (!data.ok) { res.innerHTML = `<div style="color:#ef4444;font-size:0.85rem">${_esc(data.error||'Error')}</div>`; return; }
    const r = data;
    const verdictColor = r.verdict === 'significant' ? '#22c55e' : r.verdict === 'trending' ? '#f59e0b' : '#ef4444';
    res.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="margin-bottom:10px;font-size:0.95rem;color:${verdictColor};font-weight:700">${_esc(r.interpretation||'')}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;font-size:0.82rem">
          <div class="ig-stat-card"><div class="ig-stat-num" style="color:${verdictColor}">${r.confidence_pct}%</div><div class="ig-stat-label">Confidence</div></div>
          <div class="ig-stat-card"><div class="ig-stat-num">${r.p_value}</div><div class="ig-stat-label">p-value</div></div>
          ${r.lift_pct!=null?`<div class="ig-stat-card"><div class="ig-stat-num" style="color:${r.lift_pct>=0?'#22c55e':'#ef4444'}">${r.lift_pct>=0?'+':''}${r.lift_pct}%</div><div class="ig-stat-label">Lift</div></div>`:''}
          <div class="ig-stat-card"><div class="ig-stat-num">${(r.control_rate_pct??0).toFixed(2)}%</div><div class="ig-stat-label">Control CVR</div></div>
          <div class="ig-stat-card"><div class="ig-stat-num">${(r.variant_rate_pct??0).toFixed(2)}%</div><div class="ig-stat-label">Variant CVR</div></div>
          ${r.recommended_n?`<div class="ig-stat-card"><div class="ig-stat-num">${r.recommended_n.toLocaleString()}</div><div class="ig-stat-label">Rec. Sample / arm</div></div>`:''}
        </div>
      </div>`;
  });

  document.getElementById('es-new-btn').addEventListener('click',()=>{ document.getElementById('es-form').style.display='block'; });
  document.getElementById('es-cancel-btn').addEventListener('click',()=>{ document.getElementById('es-form').style.display='none'; });
  document.getElementById('es-refresh-btn').addEventListener('click',loadExps);
  document.getElementById('es-create-btn').addEventListener('click',async()=>{
    const name=document.getElementById('es-name').value.trim();
    const type=document.getElementById('es-type').value;
    if(!name) return _toast('Name required','error');
    const data = await _post('/experiments/create',{
      name,type,
      hypothesis:document.getElementById('es-hyp').value,
      channels:document.getElementById('es-channels').value,
      control_group:document.getElementById('es-control').value,
      variant_group:document.getElementById('es-variant').value,
      budget_split:document.getElementById('es-budget').value,
      start_date:document.getElementById('es-start').value||null,
    });
    if(data.ok){ document.getElementById('es-form').style.display='none'; _toast('Experiment created','success'); loadExps(); }
    else _toast(data.error||'Failed','error');
  });
};

/* ══════════════════════════════════════════════════════════════
   T97 · IDENTITY SPINE
══════════════════════════════════════════════════════════════ */
window.buildIdentitySpine = async function() {
  const el = document.getElementById('view-identity-spine');
  if (!el) return;
  const STAGE_COLORS={unknown:'#64748b',aware:'#8b5cf6',interested:'#3b82f6',considering:'#f59e0b',customer:'#22c55e',churned:'#ef4444'};

  el.innerHTML = `<div class="ig-panel">
    <div class="ig-panel-header"><h2>🪪 Identity Spine</h2>
      <p class="ig-panel-sub">Unified first-party customer profiles — consent-aware, LTV-scored, and enriched with next-best-action recommendations.</p></div>
    <div id="is-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px;"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
      <button id="is-import-btn" class="ig-btn ig-btn-primary">+ Import Contacts</button>
      <button id="is-score-btn" class="ig-btn">🧠 AI Score All</button>
      <select id="is-stage-filter" class="ig-input" style="max-width:180px;">
        <option value="">All stages</option>
        ${['unknown','aware','interested','considering','customer','churned'].map(s=>`<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>
    <div id="is-import-form" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px;">
      <h4 style="margin:0 0 12px;">Import Contacts (paste CSV: email,name,company,source_channels)</h4>
      <textarea id="is-csv" class="ig-input" style="width:100%;min-height:100px;font-family:monospace;" placeholder="email,name,company,source_channels&#10;alice@example.com,Alice Smith,Acme,email&#10;bob@acme.io,Bob Jones,Globex,ads"></textarea>
      <div style="margin-top:10px;display:flex;gap:10px;">
        <button id="is-do-import-btn" class="ig-btn ig-btn-primary">Import</button>
        <button id="is-cancel-import-btn" class="ig-btn">Cancel</button>
      </div>
    </div>
    <div id="is-profile-list"></div>
  </div>`;

  async function loadStats(){
    const data = await _api('/identity/stats');
    const el2 = document.getElementById('is-stats');
    if(!el2||!data.ok) return;
    el2.innerHTML = `
      <div class="ig-stat-card"><div class="ig-stat-num">${data.total}</div><div class="ig-stat-label">Total Profiles</div></div>
      <div class="ig-stat-card"><div class="ig-stat-num">${_cur(data.ltv?.avg_ltv||0)}</div><div class="ig-stat-label">Avg LTV</div></div>
      <div class="ig-stat-card"><div class="ig-stat-num">${_cur(data.ltv?.max_ltv||0)}</div><div class="ig-stat-label">Top LTV</div></div>
      ${(data.stages||[]).map(s=>`<div class="ig-stat-card" style="border-left:3px solid ${STAGE_COLORS[s.lifecycle_stage]||'#888'};"><div class="ig-stat-num">${s.n}</div><div class="ig-stat-label">${s.lifecycle_stage}</div></div>`).join('')}`;
  }

  async function loadProfiles(){
    const stage = document.getElementById('is-stage-filter')?.value||'';
    const data = await _api('/identity/profiles'+(stage?'?stage='+stage:''));
    const el2 = document.getElementById('is-profile-list');
    if(!el2) return;
    if(!data.ok||!data.profiles.length){ el2.innerHTML='<div class="ig-empty" style="text-align:center;padding:40px;color:var(--text-muted);">No profiles. Import contacts to build your identity spine.</div>'; return; }
    el2.innerHTML = `<table class="ig-table" style="width:100%;border-collapse:collapse;">
      <thead><tr><th>Contact</th><th>Stage</th><th>LTV</th><th>Propensity</th><th>Next Action</th><th>Channels</th></tr></thead>
      <tbody>${data.profiles.map(p=>`<tr>
        <td><strong>${_esc(p.name||p.email||'—')}</strong><br><small style="color:var(--text-muted);">${_esc(p.company||'')}</small></td>
        <td><span class="ig-badge" style="background:${STAGE_COLORS[p.lifecycle_stage]||'#888'}20;color:${STAGE_COLORS[p.lifecycle_stage]||'#888'};">${p.lifecycle_stage}</span></td>
        <td>${_cur(p.ltv_score||0)}</td>
        <td><div style="display:flex;align-items:center;gap:6px;"><div style="width:60px;height:6px;background:var(--bg-hover);border-radius:3px;overflow:hidden;"><div style="width:${p.propensity_score||0}%;height:100%;background:#3b82f6;border-radius:3px;"></div></div>${p.propensity_score||0}%</div></td>
        <td style="font-size:12px;">${_esc(p.next_best_action||'—')}</td>
        <td><small>${_esc(p.source_channels||'—')}</small></td>
      </tr>`).join('')}</tbody></table>`;
  }

  loadStats(); loadProfiles();

  document.getElementById('is-import-btn').addEventListener('click',()=>{ document.getElementById('is-import-form').style.display='block'; });
  document.getElementById('is-cancel-import-btn').addEventListener('click',()=>{ document.getElementById('is-import-form').style.display='none'; });
  document.getElementById('is-stage-filter').addEventListener('change',loadProfiles);
  document.getElementById('is-do-import-btn').addEventListener('click',async()=>{
    const csv = document.getElementById('is-csv').value.trim();
    const lines = csv.split('\n').slice(1);
    const contacts = lines.map(l=>{ const p=l.split(','); return {email:p[0]?.trim(),name:p[1]?.trim(),company:p[2]?.trim(),source_channels:p[3]?.trim()||'manual'}; }).filter(c=>c.email);
    if(!contacts.length) return _toast('No valid rows found','error');
    const data = await _post('/identity/import',{contacts});
    if(data.ok){ _toast(`Imported ${data.imported} contacts`,'success'); document.getElementById('is-import-form').style.display='none'; loadStats(); loadProfiles(); }
    else _toast(data.error||'Import failed','error');
  });
  document.getElementById('is-score-btn').addEventListener('click',async()=>{
    _toast('Scoring profiles with AI…','info');
    const data = await _post('/identity/score',{});
    if(data.ok){ _toast(`Scored ${data.scored} profiles`,'success'); loadStats(); loadProfiles(); }
    else _toast(data.error||'Scoring failed','error');
  });
};

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

/* ══════════════════════════════════════════════════════════════
   T99 · AI ANSWER SOV
══════════════════════════════════════════════════════════════ */
window.buildAiAnswerSov = async function() {
  const el = document.getElementById('view-ai-answer-sov');
  if (!el) return;

  el.innerHTML = `<div class="ig-panel">
    <div class="ig-panel-header"><h2>🧠 AI Answer Share-of-Voice</h2>
      <p class="ig-panel-sub">Track how ChatGPT, Claude and other AI engines answer your buyers' questions — and who gets cited.</p></div>
    <div id="sov-dashboard" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px;"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
      <button id="sov-add-btn" class="ig-btn ig-btn-primary">+ Add Questions</button>
      <button id="sov-sweep-btn" class="ig-btn">🔍 Run AI Sweep</button>
      <button id="sov-dash-btn" class="ig-btn">📊 Refresh Dashboard</button>
    </div>
    <div id="sov-add-form" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px;">
      <h4 style="margin:0 0 12px;">Add Buyer Questions to Track</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div><label class="ig-label">Topic Cluster</label><input id="sov-cluster" class="ig-input" placeholder="e.g. Marketing Software"/></div>
        <div><label class="ig-label">Your Brand Domain</label><input id="sov-brand" class="ig-input" placeholder="infogenie.io"/></div>
        <div style="grid-column:1/-1"><label class="ig-label">Questions (one per line) *</label>
          <textarea id="sov-questions-text" class="ig-input" style="min-height:100px;" placeholder="What is the best marketing intelligence software?&#10;How do I track competitor ads?&#10;What tools do CMOs use for competitive analysis?"></textarea>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:10px;">
        <button id="sov-save-qs-btn" class="ig-btn ig-btn-primary">Add Questions</button>
        <button id="sov-cancel-add-btn" class="ig-btn">Cancel</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;flex-wrap:wrap;">
      <div><h4 style="margin:0 0 10px;">Questions Being Tracked</h4><div id="sov-q-list"></div></div>
      <div><h4 style="margin:0 0 10px;">Top Competing Domains Cited</h4><div id="sov-comp-list"></div>
           <h4 style="margin:16px 0 10px;">Recent Sweep Results</h4><div id="sov-recent"></div></div>
    </div>
  </div>`;

  async function loadDashboard(){
    const data = await _api('/ai-answer-sov/dashboard');
    const el2 = document.getElementById('sov-dashboard');
    if(!el2||!data.ok) return;
    el2.innerHTML = `
      <div class="ig-stat-card"><div class="ig-stat-num">${data.brand_sov_pct}%</div><div class="ig-stat-label">Brand SOV</div></div>
      <div class="ig-stat-card"><div class="ig-stat-num">${data.brand_hits}</div><div class="ig-stat-label">Brand Mentions</div></div>
      <div class="ig-stat-card"><div class="ig-stat-num">${data.responses}</div><div class="ig-stat-label">LLM Responses</div></div>
      <div class="ig-stat-card"><div class="ig-stat-num">${data.questions}</div><div class="ig-stat-label">Questions Tracked</div></div>
      ${(data.by_provider||[]).map(p=>`<div class="ig-stat-card"><div class="ig-stat-num">${p.brand_hits||0}/${p.responses}</div><div class="ig-stat-label">${_esc(p.llm_provider)} mentions</div></div>`).join('')}`;
    const compEl=document.getElementById('sov-comp-list');
    if(compEl) compEl.innerHTML = data.top_competitors?.length
      ? data.top_competitors.map((c,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
          <span style="font-weight:700;color:var(--text-muted);min-width:20px;">#${i+1}</span>
          <span style="flex:1;">${_esc(c.domain)}</span>
          <span class="ig-badge">${c.count} citations</span>
        </div>`).join('')
      : '<p style="color:var(--text-muted);font-size:13px;">Run a sweep to populate competitor citations.</p>';
    const recentEl=document.getElementById('sov-recent');
    if(recentEl) recentEl.innerHTML = data.recent?.length
      ? data.recent.map(r=>`<div style="padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;font-size:12px;">
          <div style="display:flex;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <span class="ig-badge">${_esc(r.llm_provider)}</span>
            <span class="ig-badge" style="background:${r.brand_mentioned?'#22c55e20':'#ef444420'};color:${r.brand_mentioned?'#22c55e':'#ef4444'};">${r.brand_mentioned?'✓ Brand mentioned':'✗ Not mentioned'}</span>
          </div>
          <div style="color:var(--text-muted);">Q: ${_esc(r.question||'')}</div>
        </div>`).join('')
      : '<p style="color:var(--text-muted);font-size:13px;">No sweep results yet.</p>';
  }

  async function loadQuestions(){
    const data = await _api('/ai-answer-sov/questions');
    const el2 = document.getElementById('sov-q-list');
    if(!el2) return;
    if(!data.ok||!data.questions.length){ el2.innerHTML='<p style="color:var(--text-muted);font-size:13px;">No questions tracked yet. Add some above.</p>'; return; }
    el2.innerHTML = data.questions.map(q=>`<div style="display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;">
      <div style="flex:1;font-size:13px;">${_esc(q.question)}<br><small style="color:var(--text-muted);">${_esc(q.topic_cluster||'')}</small></div>
      <button class="ig-btn ig-btn-sm" style="color:#ef4444;" onclick="window._sovDeleteQ(${q.id})">✕</button>
    </div>`).join('');
  }

  window._sovDeleteQ = async function(id){ await _del('/ai-answer-sov/questions/'+id); loadQuestions(); };

  loadDashboard(); loadQuestions();
  document.getElementById('sov-dash-btn').addEventListener('click',loadDashboard);
  document.getElementById('sov-add-btn').addEventListener('click',()=>{ document.getElementById('sov-add-form').style.display='block'; });
  document.getElementById('sov-cancel-add-btn').addEventListener('click',()=>{ document.getElementById('sov-add-form').style.display='none'; });
  document.getElementById('sov-save-qs-btn').addEventListener('click',async()=>{
    const text=document.getElementById('sov-questions-text').value.trim();
    const questions=text.split('\n').map(q=>q.trim()).filter(Boolean);
    if(!questions.length) return _toast('Enter at least one question','error');
    const data=await _post('/ai-answer-sov/questions/add',{questions,topic_cluster:document.getElementById('sov-cluster').value,brand_domain:document.getElementById('sov-brand').value});
    if(data.ok){ _toast(`Added ${data.added} questions`,'success'); document.getElementById('sov-add-form').style.display='none'; loadQuestions(); }
    else _toast(data.error||'Failed','error');
  });
  document.getElementById('sov-sweep-btn').addEventListener('click',async()=>{
    if(!confirm('Run AI sweep now? This will call OpenAI and Anthropic with your tracked questions.')) return;
    _toast('Running sweep across AI engines…','info');
    const data=await _post('/ai-answer-sov/sweep',{providers:['openai','anthropic']});
    if(data.ok){ _toast(`Swept ${data.swept} questions`,'success'); loadDashboard(); }
    else _toast(data.error||'Sweep failed','error');
  });
};

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

/* ══════════════════════════════════════════════════════════════
   T101 · PROPRIETARY DATA PRODUCTS
══════════════════════════════════════════════════════════════ */
window.buildDataProducts = async function() {
  const el = document.getElementById('view-data-products');
  if (!el) return;

  el.innerHTML = `<div class="ig-panel">
    <div class="ig-panel-header"><h2>📦 Proprietary Data Products</h2>
      <p class="ig-panel-sub">Industry-owned intelligence — creative performance index, offer benchmarks, and emerging market signals you can't find anywhere else.</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;">
      <button class="ig-btn ig-btn-primary dp-tab-btn" data-tab="creative">🎨 Creative Index</button>
      <button class="ig-btn dp-tab-btn" data-tab="offer">💡 Offer Benchmarks</button>
      <button class="ig-btn dp-tab-btn" data-tab="signals">📡 Emerging Signals</button>
    </div>
    <div id="dp-creative" class="dp-tab">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <button id="dp-submit-creative-btn" class="ig-btn ig-btn-primary">+ Submit Creative Data</button>
        <select id="dp-channel-filter" class="ig-input" style="max-width:160px;"><option value="">All Channels</option>${['meta','google','tiktok','email','linkedin','youtube'].map(c=>`<option>${c}</option>`).join('')}</select>
        <button id="dp-refresh-creative-btn" class="ig-btn">Refresh</button>
      </div>
      <div id="dp-creative-form" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><label class="ig-label">Format *</label><select id="dc-format" class="ig-input"><option value="">Select…</option>${['static-image','video-short','video-long','carousel','ugc-style','text-ad','display','native'].map(f=>`<option>${f}</option>`).join('')}</select></div>
          <div><label class="ig-label">Channel *</label><select id="dc-channel" class="ig-input"><option value="">Select…</option>${['meta','google','tiktok','email','linkedin','youtube','display'].map(c=>`<option>${c}</option>`).join('')}</select></div>
          <div><label class="ig-label">Hook Type</label><select id="dc-hook" class="ig-input"><option value="">Select…</option>${['question','shock-stat','social-proof','pain-point','before-after','bold-claim','storytelling','curiosity-gap'].map(h=>`<option>${h}</option>`).join('')}</select></div>
          <div><label class="ig-label">CTA Type</label><select id="dc-cta" class="ig-input"><option value="">Select…</option>${['shop-now','learn-more','get-started','book-demo','try-free','see-pricing','download','watch-now'].map(c=>`<option>${c}</option>`).join('')}</select></div>
          <div><label class="ig-label">CTR (%)</label><input id="dc-ctr" class="ig-input" type="number" step="0.01" placeholder="2.4"/></div>
          <div><label class="ig-label">CVR (%)</label><input id="dc-cvr" class="ig-input" type="number" step="0.01" placeholder="3.1"/></div>
          <div><label class="ig-label">ROAS</label><input id="dc-roas" class="ig-input" type="number" step="0.1" placeholder="3.8"/></div>
          <div><label class="ig-label">Industry</label><input id="dc-industry" class="ig-input" placeholder="SaaS"/></div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;">
          <button id="dc-save-btn" class="ig-btn ig-btn-primary">Submit</button>
          <button id="dc-cancel-btn" class="ig-btn">Cancel</button>
        </div>
      </div>
      <div id="dp-creative-data"></div>
    </div>
    <div id="dp-offer" class="dp-tab" style="display:none;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <button id="dp-submit-offer-btn" class="ig-btn ig-btn-primary">+ Submit Offer Data</button>
        <button id="dp-refresh-offer-btn" class="ig-btn">Refresh</button>
      </div>
      <div id="dp-offer-form" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><label class="ig-label">Offer Type *</label><select id="do-type" class="ig-input"><option value="">Select…</option>${['saas','ecommerce-product','service','digital-product','course','agency-retainer'].map(o=>`<option>${o}</option>`).join('')}</select></div>
          <div><label class="ig-label">Pricing Model *</label><select id="do-pricing" class="ig-input"><option value="">Select…</option>${['one-time','monthly-sub','annual-sub','usage-based','freemium','pay-as-you-go','tiered'].map(p=>`<option>${p}</option>`).join('')}</select></div>
          <div><label class="ig-label">Free Trial?</label><select id="do-trial" class="ig-input"><option value="">No</option><option value="true">Yes</option></select></div>
          <div><label class="ig-label">Trial Days</label><input id="do-trial-days" class="ig-input" type="number" placeholder="14"/></div>
          <div><label class="ig-label">Guarantee Type</label><select id="do-guarantee" class="ig-input"><option value="">None</option>${['30-day-money-back','results-guarantee','satisfaction-guarantee','no-contract'].map(g=>`<option>${g}</option>`).join('')}</select></div>
          <div><label class="ig-label">Conversion Rate (%)</label><input id="do-cvr" class="ig-input" type="number" step="0.1" placeholder="4.2"/></div>
          <div><label class="ig-label">Industry</label><input id="do-industry" class="ig-input" placeholder="SaaS"/></div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;">
          <button id="do-save-btn" class="ig-btn ig-btn-primary">Submit</button>
          <button id="do-cancel-btn" class="ig-btn">Cancel</button>
        </div>
      </div>
      <div id="dp-offer-data"></div>
    </div>
    <div id="dp-signals" class="dp-tab" style="display:none;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <button id="dp-refresh-signals-btn" class="ig-btn">🔄 Refresh</button>
        <button id="dp-gen-signals-btn" class="ig-btn ig-btn-primary">⚡ Generate New Signals</button>
        <input id="dp-industry-input" class="ig-input" placeholder="Industry focus (optional)" style="max-width:200px;"/>
      </div>
      <div id="dp-signals-data"></div>
    </div>
  </div>`;

  document.querySelectorAll('.dp-tab-btn').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.dp-tab-btn').forEach(x=>x.classList.remove('ig-btn-primary'));
    b.classList.add('ig-btn-primary');
    document.querySelectorAll('.dp-tab').forEach(t=>t.style.display='none');
    const target=document.getElementById('dp-'+b.dataset.tab);
    if(target) target.style.display='block';
  }));

  async function loadCreative(){
    const channel=document.getElementById('dp-channel-filter')?.value||'';
    const data=await _api('/data-products/creative/index'+(channel?'?channel='+channel:''));
    const el2=document.getElementById('dp-creative-data');
    if(!el2||!data.ok) return;
    const renderTable=(rows,cols)=>`<table class="ig-table" style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead><tr>${cols.map(c=>`<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${c.fmt?c.fmt(r[c.key]):_esc(r[c.key]||'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    el2.innerHTML = `<div style="display:flex;gap:6px;align-items:center;color:var(--text-muted);font-size:13px;margin-bottom:12px;">📊 ${data.total_submissions} submissions in the index</div>`
      +(data.by_format?.length?`<h4 style="margin:0 0 8px;">By Format</h4>`+renderTable(data.by_format,[{key:'format',label:'Format'},{key:'n',label:'Submissions'},{key:'avg_ctr',label:'Avg CTR',fmt:n=>(+(n||0)).toFixed(2)+'%'},{key:'avg_cvr',label:'Avg CVR',fmt:n=>(+(n||0)).toFixed(2)+'%'},{key:'avg_roas',label:'Avg ROAS',fmt:n=>(+(n||0)).toFixed(2)+'x'}]):'')
      +(data.by_hook?.length?`<h4 style="margin:0 0 8px;">By Hook Type</h4>`+renderTable(data.by_hook,[{key:'hook_type',label:'Hook'},{key:'n',label:'Submissions'},{key:'avg_ctr',label:'Avg CTR',fmt:n=>(+(n||0)).toFixed(2)+'%'},{key:'avg_cvr',label:'Avg CVR',fmt:n=>(+(n||0)).toFixed(2)+'%'}]):'')
      +(data.by_cta?.length?`<h4 style="margin:0 0 8px;">By CTA Type</h4>`+renderTable(data.by_cta,[{key:'cta_type',label:'CTA'},{key:'n',label:'Submissions'},{key:'avg_cvr',label:'Avg CVR',fmt:n=>(+(n||0)).toFixed(2)+'%'}]):'')
      +((!data.by_format?.length)?'<div class="ig-empty" style="text-align:center;padding:40px;color:var(--text-muted);">No creative data yet. Submit your first creative performance data above.</div>':'');
  }

  async function loadOfferBenchmarks(){
    const data=await _api('/data-products/offer/benchmarks');
    const el2=document.getElementById('dp-offer-data');
    if(!el2||!data.ok) return;
    el2.innerHTML = `<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">📊 ${data.total_submissions} submissions</div>`
      +(data.by_model?.length?`<h4 style="margin:0 0 8px;">Pricing Model vs Conversion Rate</h4>
        ${data.by_model.map(m=>`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="min-width:130px;font-size:13px;">${_esc(m.pricing_model)}</span>
          <div style="flex:1;height:16px;background:var(--bg-hover);border-radius:4px;overflow:hidden;"><div style="width:${Math.min(100,(+(m.avg_cvr||0))*20)}%;height:100%;background:#3b82f6;border-radius:4px;"></div></div>
          <span>${(+(m.avg_cvr||0)).toFixed(2)}% CVR</span><span style="color:var(--text-muted);font-size:12px;">(${m.n})</span>
        </div>`).join('')}`:'')
      +(data.trial_effect?.length?`<h4 style="margin:12px 0 8px;">Free Trial Effect</h4>
        ${data.trial_effect.map(t=>`<div style="display:flex;gap:10px;padding:8px;background:var(--bg-card);border-radius:6px;margin-bottom:6px;">
          <span>${t.free_trial?'✅ With Free Trial':'❌ No Free Trial'}</span>
          <span>${(+(t.avg_cvr||0)).toFixed(2)}% avg CVR</span>
          <span style="color:var(--text-muted);">(${t.n} submissions)</span>
        </div>`).join('')}`:'')
      +((!data.by_model?.length)?'<div class="ig-empty" style="text-align:center;padding:40px;color:var(--text-muted);">No offer data yet. Submit your first offer benchmark above.</div>':'');
  }

  async function loadSignals(){
    const data=await _api('/data-products/emerging-signals');
    const el2=document.getElementById('dp-signals-data');
    if(!el2||!data.ok) return;
    if(!data.signals.length){ el2.innerHTML='<div class="ig-empty" style="text-align:center;padding:40px;color:var(--text-muted);">No signals yet. Click Generate to detect emerging market signals.</div>'; return; }
    const CONF_COLOR=n=>n>=80?'#22c55e':n>=60?'#f59e0b':'#ef4444';
    el2.innerHTML = data.signals.map(s=>`<div class="ig-card" style="margin-bottom:8px;border-left:3px solid ${CONF_COLOR(s.confidence_score)};">
      <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <strong>${_esc(s.title)}</strong>
            <span class="ig-badge">${_esc(s.signal_type)}</span>
            <span class="ig-badge" style="background:${CONF_COLOR(s.confidence_score)}20;color:${CONF_COLOR(s.confidence_score)};">${s.confidence_score}% confidence</span>
          </div>
          <p style="margin:0;color:var(--text-muted);font-size:13px;">${_esc(s.description)}</p>
          <small style="color:var(--text-muted);">📡 ${_esc(s.source)} · ${new Date(s.detected_at).toLocaleDateString()}</small>
        </div>
      </div>
    </div>`).join('');
  }

  loadCreative();
  document.getElementById('dp-refresh-creative-btn').addEventListener('click',loadCreative);
  document.getElementById('dp-channel-filter').addEventListener('change',loadCreative);
  document.getElementById('dp-submit-creative-btn').addEventListener('click',()=>{ document.getElementById('dp-creative-form').style.display='block'; });
  document.getElementById('dc-cancel-btn').addEventListener('click',()=>{ document.getElementById('dp-creative-form').style.display='none'; });
  document.getElementById('dc-save-btn').addEventListener('click',async()=>{
    const format=document.getElementById('dc-format').value, channel=document.getElementById('dc-channel').value;
    if(!format||!channel) return _toast('Format and channel required','error');
    const data=await _post('/data-products/creative/submit',{format,channel,hook_type:document.getElementById('dc-hook').value||null,cta_type:document.getElementById('dc-cta').value||null,ctr:+document.getElementById('dc-ctr').value||null,cvr:+document.getElementById('dc-cvr').value||null,roas:+document.getElementById('dc-roas').value||null,industry:document.getElementById('dc-industry').value||null});
    if(data.ok){ _toast('Submitted','success'); document.getElementById('dp-creative-form').style.display='none'; loadCreative(); }
    else _toast(data.error||'Failed','error');
  });
  document.getElementById('dp-refresh-offer-btn').addEventListener('click',loadOfferBenchmarks);
  document.getElementById('dp-submit-offer-btn').addEventListener('click',()=>{ document.getElementById('dp-offer-form').style.display='block'; loadOfferBenchmarks(); });
  document.getElementById('do-cancel-btn').addEventListener('click',()=>{ document.getElementById('dp-offer-form').style.display='none'; });
  document.getElementById('do-save-btn').addEventListener('click',async()=>{
    const offer_type=document.getElementById('do-type').value, pricing_model=document.getElementById('do-pricing').value;
    if(!offer_type||!pricing_model) return _toast('Offer type and pricing model required','error');
    const data=await _post('/data-products/offer/submit',{offer_type,pricing_model,free_trial:document.getElementById('do-trial').value==='true',trial_days:+document.getElementById('do-trial-days').value||null,guarantee:document.getElementById('do-guarantee').value||null,cvr:+document.getElementById('do-cvr').value||null,industry:document.getElementById('do-industry').value||null});
    if(data.ok){ _toast('Submitted','success'); document.getElementById('dp-offer-form').style.display='none'; loadOfferBenchmarks(); }
    else _toast(data.error||'Failed','error');
  });
  document.getElementById('dp-refresh-signals-btn').addEventListener('click',loadSignals);
  document.getElementById('dp-gen-signals-btn').addEventListener('click',async()=>{
    _toast('Generating emerging signals…','info');
    const industry=document.getElementById('dp-industry-input').value;
    const data=await _post('/data-products/emerging-signals/refresh',{industry});
    if(data.ok){ _toast(`${data.generated} signals generated`,'success'); loadSignals(); }
    else _toast(data.error||'Failed','error');
  });
  document.getElementById('dp-submit-offer-btn').addEventListener('click',()=>{ loadOfferBenchmarks(); });
};

/* ─── navigation hook ───────────────────────────────────────── */
const _origNav = window.navigateTo;
window.navigateTo = function(view) {
  if (typeof _origNav === 'function') _origNav(view);
  if (view === 'decision-engine')    window.buildDecisionEngine && window.buildDecisionEngine();
  if (view === 'experiment-suite')   window.buildExperimentSuite && window.buildExperimentSuite();
  if (view === 'identity-spine')     window.buildIdentitySpine && window.buildIdentitySpine();
  if (view === 'approval-workflows') window.buildApprovalWorkflows && window.buildApprovalWorkflows();
  if (view === 'ai-answer-sov')      window.buildAiAnswerSov && window.buildAiAnswerSov();
  if (view === 'revenue-intel')      window.buildRevenueIntel && window.buildRevenueIntel();
  if (view === 'data-products')      window.buildDataProducts && window.buildDataProducts();
};

})();
