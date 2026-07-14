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

