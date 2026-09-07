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
   T97 · IDENTITY SPINE
══════════════════════════════════════════════════════════════ */
window.buildIdentitySpine = async function() {
  const el = document.getElementById('view-identity-spine');
  if (!el) return;
  const STAGE_COLORS={unknown:'#64748b',aware:'#0284c7',interested:'#3b82f6',considering:'#f59e0b',customer:'#22c55e',churned:'#ef4444'};

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



/* ─── navigation hook ───────────────────────────────────────── */
const _origNav = window.navigateTo;
window.navigateTo = function(view) {
  if (typeof _origNav === 'function') _origNav(view);
  if (view === 'decision-engine')    window.buildDecisionEngine && window.buildDecisionEngine();
  if (view === 'identity-spine')     window.buildIdentitySpine && window.buildIdentitySpine();
};

})();
