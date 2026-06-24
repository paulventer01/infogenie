/* ── T81-T88 Advanced Features ─────────────────────────────────────────── */
/* War Room · Revenue Forecast · Digital Twin · Acquisition Engine          */
/* Investor Mode · Biz Scanner · Marketplace · Auto Operator                */

(function(){
'use strict';

function _e(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _q(s){ return document.querySelector(s); }
function _qs(s,p){ return (p||document).querySelectorAll(s); }
function _ce(tag,cls,html){ const el=document.createElement(tag); if(cls) el.className=cls; if(html) el.innerHTML=html; return el; }

function _api(method, path, body){
  return fetch(path,{ method, headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined })
    .then(r=>r.json());
}

function _threatBadge(level){
  const map={low:'#10b981',medium:'#f59e0b',high:'#ef4444',critical:'#7f1d1d'};
  const bg=map[level]||'#6b7280';
  return `<span style="background:${bg};color:#fff;border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:700;text-transform:uppercase">${_e(level)}</span>`;
}
function _verdictBadge(v){
  const map={positive:'#10b981',negative:'#ef4444',neutral:'#6b7280',mixed:'#f59e0b'};
  const bg=map[v]||'#6b7280';
  return `<span style="background:${bg};color:#fff;border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:700;text-transform:uppercase">${_e(v)}</span>`;
}
function _scoreRing(val, max=100){
  const pct = Math.min(100, Math.max(0, Math.round(val/max*100)));
  const col = pct>=70?'#10b981':pct>=40?'#f59e0b':'#ef4444';
  return `<div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:conic-gradient(${col} ${pct}%,#e5e7eb 0);font-size:1rem;font-weight:700;color:${col}">${val}</div>`;
}

/* ─────────────────────────────────────────────────────────────────────────
   T81 — AI Competitor War Room
   ─────────────────────────────────────────────────────────────────────── */
window.buildWarRoom = function(){
  const el = document.getElementById('view-war-room');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>⚔️ AI Competitor War Room</h2><p class="view-sub">Cross-signal AI analysis that predicts your competitor's next strategic move — before they make it.</p></div>
<div class="ig-card" style="max-width:680px;margin-bottom:24px">
  <div class="form-grid" style="grid-template-columns:1fr 1fr">
    <div class="form-group"><label>Competitor Name</label><input id="wr-comp" class="form-control" placeholder="e.g. HubSpot" /></div>
    <div class="form-group"><label>Their Domain (optional)</label><input id="wr-domain" class="form-control" placeholder="e.g. hubspot.com" /></div>
  </div>
  <button id="wr-run" class="btn btn-primary" style="width:100%">🔍 Analyse & Predict Move</button>
</div>
<div id="wr-result"></div>
<div id="wr-history"></div>`;

  document.getElementById('wr-run').onclick = async function(){
    const comp = document.getElementById('wr-comp').value.trim();
    if(!comp) return alert('Enter a competitor name.');
    this.disabled=true; this.textContent='Analysing signals…';
    const d = await _api('POST','/api/war-room/analyse',{ competitor:comp, domain:document.getElementById('wr-domain').value.trim() });
    this.disabled=false; this.textContent='🔍 Analyse & Predict Move';
    if(!d.ok) return alert(d.error||'Error');
    _renderWarRoomResult(d);
    _loadWarRoomHistory();
  };
  _loadWarRoomHistory();
};

function _renderWarRoomResult(d){
  const p = d.prediction||{};
  const r = document.getElementById('wr-result');
  r.innerHTML = `
<div class="ig-card" style="border-left:4px solid #ef4444;margin-bottom:16px">
  <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    ${_scoreRing(p.confidence||0)}
    <div>
      <div style="font-size:.75rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Prediction · ${_e(p.timeframe||'')}</div>
      <div style="font-size:1.15rem;font-weight:700;margin:4px 0">${_e(p.prediction||'')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${_threatBadge(p.threat_level||'medium')}<span style="background:#f3f4f6;border-radius:4px;padding:2px 8px;font-size:.75rem;color:#374151">${_e(p.move_type||'')}</span></div>
    </div>
  </div>
  <p style="color:#374151;margin-bottom:12px">${_e(p.rationale||'')}</p>
  <div style="background:#fef2f2;border-radius:8px;padding:12px">
    <div style="font-size:.75rem;font-weight:600;color:#ef4444;margin-bottom:4px">⚡ RECOMMENDED COUNTER-MOVE</div>
    <div style="color:#374151">${_e(p.recommended_counter||'')}</div>
  </div>
  ${p.signals_summary?.length ? `<div style="margin-top:16px">
    <div style="font-size:.8rem;font-weight:600;color:#6b7280;margin-bottom:8px">SIGNALS DETECTED</div>
    <div style="display:flex;flex-direction:column;gap:6px">${p.signals_summary.map(s=>`
      <div style="display:flex;align-items:flex-start;gap:10px;padding:8px;background:#f9fafb;border-radius:6px">
        <span style="font-size:.7rem;font-weight:700;padding:2px 6px;border-radius:4px;background:${s.weight==='high'?'#fecaca':s.weight==='medium'?'#fde68a':'#d1fae5'};color:#374151">${_e(s.weight||'').toUpperCase()}</span>
        <div><div style="font-size:.85rem;font-weight:600">${_e(s.signal||'')}</div><div style="font-size:.8rem;color:#6b7280">${_e(s.implication||'')}</div></div>
      </div>`).join('')}</div>
  </div>` : ''}
</div>`;
}

async function _loadWarRoomHistory(){
  const d = await _api('GET','/api/war-room/history');
  if(!d.ok||!d.runs?.length) return;
  const el = document.getElementById('wr-history');
  if(!el) return;
  el.innerHTML = `<h3 style="font-size:.9rem;font-weight:600;color:#6b7280;margin:16px 0 8px">Recent Analyses</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.runs.map(r=>`
  <div class="ig-card" style="padding:12px;cursor:pointer" onclick='_renderWarRoomResult(${JSON.stringify({prediction:r.prediction})})'>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <span style="font-weight:600">${_e(r.competitor)}</span>
        <span style="color:#6b7280;font-size:.8rem;margin-left:8px">${new Date(r.created_at).toLocaleDateString()}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">${_threatBadge(r.prediction?.threat_level||'medium')}<span style="font-size:.85rem;font-weight:700">${r.confidence}% confidence</span></div>
    </div>
    <div style="font-size:.85rem;color:#374151;margin-top:4px">${_e(r.prediction?.prediction||'')}</div>
  </div>`).join('')}</div>`;
}
window._renderWarRoomResult = _renderWarRoomResult;

/* ─────────────────────────────────────────────────────────────────────────
   T82 — AI Revenue Forecast Engine
   ─────────────────────────────────────────────────────────────────────── */
window.buildRevenueforecast = function(){
  const el = document.getElementById('view-revenue-forecast');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>💹 AI Revenue Forecast Engine</h2><p class="view-sub">Model best / expected / worst case revenue outcomes for any budget or strategy change.</p></div>
<div class="ig-card" style="max-width:720px;margin-bottom:24px">
  <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
    <div class="form-group"><label>Scenario Name</label><input id="rf-name" class="form-control" value="Budget Increase Scenario" /></div>
    <div class="form-group"><label>Current Monthly Ad Spend</label><input id="rf-spend" class="form-control" type="number" value="10000" /></div>
    <div class="form-group"><label>Budget Change (+/-)</label><input id="rf-change" class="form-control" type="number" value="5000" placeholder="+5000 or -2000" /></div>
    <div class="form-group"><label>Current Monthly Leads</label><input id="rf-leads" class="form-control" type="number" value="200" /></div>
    <div class="form-group"><label>Conversion Rate (%)</label><input id="rf-cvr" class="form-control" type="number" value="3" step="0.1" /></div>
    <div class="form-group"><label>Average Order Value</label><input id="rf-aov" class="form-control" type="number" value="500" /></div>
    <div class="form-group"><label>Current CAC</label><input id="rf-cac" class="form-control" type="number" value="250" /></div>
    <div class="form-group"><label>Customer LTV</label><input id="rf-ltv" class="form-control" type="number" value="1500" /></div>
    <div class="form-group"><label>Currency</label><select id="rf-currency" class="form-control"><option>USD</option><option>EUR</option><option>GBP</option><option>ZAR</option><option>AUD</option></select></div>
  </div>
  <button id="rf-run" class="btn btn-primary" style="width:100%">📊 Run Forecast</button>
</div>
<div id="rf-result"></div>
<div id="rf-history"></div>`;

  document.getElementById('rf-run').onclick = async function(){
    this.disabled=true; this.textContent='Modelling scenarios…';
    const body = {
      scenario_name: document.getElementById('rf-name').value,
      current_monthly_spend: +document.getElementById('rf-spend').value||10000,
      budget_change: +document.getElementById('rf-change').value||5000,
      current_leads: +document.getElementById('rf-leads').value||200,
      conversion_rate: +document.getElementById('rf-cvr').value||3,
      aov: +document.getElementById('rf-aov').value||500,
      cac: +document.getElementById('rf-cac').value||250,
      ltv: +document.getElementById('rf-ltv').value||1500,
      currency: document.getElementById('rf-currency').value
    };
    const d = await _api('POST','/api/revenue-forecast/simulate', body);
    this.disabled=false; this.textContent='📊 Run Forecast';
    if(!d.ok) return alert(d.error||'Error');
    _renderRevenueForecast(d);
    _loadRevHistory();
  };
  _loadRevHistory();
};

function _renderRevenueForecast(d){
  const r = d.results||{};
  const cur = d.inputs?.currency||'';
  const el = document.getElementById('rf-result');
  const cases = [
    { key:'best_case', label:'Best Case 🚀', col:'#10b981' },
    { key:'expected_case', label:'Expected 📊', col:'#3b82f6' },
    { key:'worst_case', label:'Worst Case ⚠️', col:'#f59e0b' }
  ];
  el.innerHTML = `
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:24px">
  ${cases.map(c=>{
    const v = r[c.key]||{};
    return `<div class="ig-card" style="border-top:3px solid ${c.col}">
      <div style="font-weight:600;margin-bottom:12px">${c.label}</div>
      <div style="font-size:1.6rem;font-weight:800;color:${c.col}">${cur} ${(v.revenue||0).toLocaleString()}</div>
      <div style="font-size:.8rem;color:#6b7280;margin-top:4px">Revenue / 90 days</div>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:4px;font-size:.85rem">
        <span>👥 ${(v.leads||0).toLocaleString()} leads</span>
        <span>🤝 ${(v.customers||0).toLocaleString()} customers</span>
        <span>📉 CAC: ${cur} ${(v.cac||0).toLocaleString()}</span>
        <span>📈 ROAS: ${v.roas||0}x</span>
      </div>
      ${v.notes?`<div style="font-size:.75rem;color:#6b7280;margin-top:8px;border-top:1px solid #f3f4f6;padding-top:8px">${_e(v.notes)}</div>`:''}
    </div>`;
  }).join('')}
</div>
<div class="ig-card" style="margin-bottom:16px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div><div style="font-size:.75rem;color:#6b7280">PAYBACK PERIOD</div><div style="font-size:1.3rem;font-weight:700">${r.payback_months||'?'} months</div></div>
    <div><div style="font-size:.75rem;color:#6b7280">LTV/CAC RATIO</div><div style="font-size:1.3rem;font-weight:700">${r.ltv_cac_ratio||'?'}x</div></div>
  </div>
  <div style="background:#eff6ff;border-radius:8px;padding:12px;margin-bottom:12px">
    <div style="font-size:.75rem;font-weight:600;color:#3b82f6;margin-bottom:4px">📋 RECOMMENDATION</div>
    <div style="color:#374151">${_e(r.recommendation||'')}</div>
  </div>
  ${r.key_assumptions?.length?`<div><div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:6px">KEY ASSUMPTIONS</div><ul style="margin:0;padding-left:20px;font-size:.85rem;color:#374151">${r.key_assumptions.map(a=>`<li>${_e(a)}</li>`).join('')}</ul></div>`:''}
  ${r.risk_factors?.length?`<div style="margin-top:12px"><div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:6px">RISK FACTORS</div><ul style="margin:0;padding-left:20px;font-size:.85rem;color:#ef4444">${r.risk_factors.map(a=>`<li>${_e(a)}</li>`).join('')}</ul></div>`:''}
</div>
${r.monthly_breakdown?.length?`
<div class="ig-card">
  <div style="font-weight:600;margin-bottom:12px">Monthly Breakdown</div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.85rem">
    <thead><tr style="background:#f9fafb">${['Month','Leads','Best','Expected','Worst'].map(h=>`<th style="padding:8px 12px;text-align:left;font-weight:600;color:#6b7280">${h}</th>`).join('')}</tr></thead>
    <tbody>${r.monthly_breakdown.map(m=>`<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px 12px;font-weight:600">${_e(m.month)}</td>
      <td style="padding:8px 12px">${(m.leads||0).toLocaleString()}</td>
      <td style="padding:8px 12px;color:#10b981;font-weight:600">${cur} ${(m.revenue_best||0).toLocaleString()}</td>
      <td style="padding:8px 12px;color:#3b82f6;font-weight:600">${cur} ${(m.revenue_expected||0).toLocaleString()}</td>
      <td style="padding:8px 12px;color:#f59e0b;font-weight:600">${cur} ${(m.revenue_worst||0).toLocaleString()}</td>
    </tr>`).join('')}</tbody>
  </table></div>
</div>`:''}`;
}

async function _loadRevHistory(){
  const d = await _api('GET','/api/revenue-forecast/history');
  const el = document.getElementById('rf-history');
  if(!el||!d.ok||!d.forecasts?.length) return;
  el.innerHTML = `<h3 style="font-size:.9rem;font-weight:600;color:#6b7280;margin:16px 0 8px">Saved Scenarios</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.forecasts.map(f=>`
  <div class="ig-card" style="padding:12px;cursor:pointer" onclick='_renderRevenueForecast({results:${JSON.stringify(f.results)},inputs:${JSON.stringify(f.inputs)}})'>
    <div style="display:flex;justify-content:space-between">
      <span style="font-weight:600">${_e(f.scenario_name)}</span>
      <span style="color:#6b7280;font-size:.8rem">${new Date(f.created_at).toLocaleDateString()}</span>
    </div>
    <div style="font-size:.85rem;color:#10b981;margin-top:4px">Expected: ${f.inputs?.currency||''} ${(f.results?.expected_case?.revenue||0).toLocaleString()}</div>
  </div>`).join('')}</div>`;
}
window._renderRevenueForecast = _renderRevenueForecast;

/* ─────────────────────────────────────────────────────────────────────────
   T83 — Business Digital Twin
   ─────────────────────────────────────────────────────────────────────── */
window.buildDigitaltwin = function(){
  const el = document.getElementById('view-digital-twin');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>🪞 Business Digital Twin</h2><p class="view-sub">Ask "what if" questions and get AI-simulated business outcomes before committing real budget.</p></div>
<div class="ig-card" style="max-width:720px;margin-bottom:24px">
  <div class="form-group"><label>Pick a scenario</label>
    <div id="dt-scenarios" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px"></div>
  </div>
  <div class="form-group"><label>Or ask your own "what if" question</label>
    <input id="dt-question" class="form-control" placeholder="e.g. What if I launch in Australia and cut Meta spend by 50%?" />
  </div>
  <div class="form-group"><label>Business Context (optional — more context = better simulation)</label>
    <textarea id="dt-ctx" class="form-control" rows="3" placeholder="Monthly revenue: R50k\nChannels: Google + Meta\nProduct: SaaS subscription\nAOV: R1,200\nCAC: R400"></textarea>
  </div>
  <button id="dt-run" class="btn btn-primary" style="width:100%">🪞 Run Simulation</button>
</div>
<div id="dt-result"></div>
<div id="dt-history"></div>`;

  _api('GET','/api/digital-twin/scenarios').then(d=>{
    if(!d.ok) return;
    const wrap = document.getElementById('dt-scenarios');
    if(!wrap) return;
    wrap.innerHTML = d.scenarios.map(s=>`<button class="btn btn-sm btn-outline dt-sc-btn" data-id="${_e(s.id)}" data-label="${_e(s.label)}">${_e(s.icon)} ${_e(s.label)}</button>`).join('');
    wrap.querySelectorAll('.dt-sc-btn').forEach(b=>{
      b.onclick = ()=>{
        wrap.querySelectorAll('.dt-sc-btn').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        const q = document.getElementById('dt-question');
        if(q && b.dataset.id !== 'custom') q.value = b.dataset.label;
      };
    });
  });

  document.getElementById('dt-run').onclick = async function(){
    const q = document.getElementById('dt-question').value.trim();
    if(!q) return alert('Enter a scenario or question.');
    this.disabled=true; this.textContent='Simulating…';
    const ctx = {};
    (document.getElementById('dt-ctx').value||'').split('\n').forEach(line=>{
      const [k,...vs]=line.split(':'); if(k&&vs.length) ctx[k.trim()]=vs.join(':').trim();
    });
    const d = await _api('POST','/api/digital-twin/simulate',{ question:q, business_context:ctx });
    this.disabled=false; this.textContent='🪞 Run Simulation';
    if(!d.ok) return alert(d.error||'Error');
    _renderTwinResult(d);
    _loadTwinHistory();
  };
  _loadTwinHistory();
};

function _renderTwinResult(d){
  const r = d.results||{};
  const el = document.getElementById('dt-result');
  el.innerHTML = `
<div class="ig-card" style="border-left:4px solid #8b5cf6;margin-bottom:16px">
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap">
    ${_scoreRing(r.confidence||65)}
    <div>
      <div style="font-size:.75rem;color:#6b7280;text-transform:uppercase">Simulation Result</div>
      <div style="font-size:1.1rem;font-weight:700">${_e(r.scenario_title||d.question||'')}</div>
      <div style="margin-top:4px">${_verdictBadge(r.verdict||'mixed')}</div>
    </div>
  </div>
  <p style="color:#374151;margin-bottom:16px">${_e(r.executive_summary||'')}</p>

  ${r.timeline?.length?`<div style="margin-bottom:16px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:8px">WHAT HAPPENS OVER 90 DAYS</div>
    <div style="display:flex;flex-direction:column;gap:8px">${r.timeline.map((t,i)=>`
      <div style="display:flex;gap:12px;padding:10px;background:#faf5ff;border-radius:8px">
        <div style="width:80px;min-width:80px;font-size:.75rem;font-weight:700;color:#8b5cf6;padding-top:2px">${_e(t.period)}</div>
        <div><div style="font-size:.85rem;font-weight:600">${_e(t.what_happens)}</div><div style="font-size:.8rem;color:#6b7280">${_e(t.metric_impact)}</div></div>
      </div>`).join('')}</div>
  </div>`:''}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div><div style="font-size:.75rem;font-weight:600;color:#10b981;margin-bottom:6px">✅ UPSIDES</div><ul style="margin:0;padding-left:16px;font-size:.85rem;color:#374151">${(r.upsides||[]).map(u=>`<li>${_e(u)}</li>`).join('')}</ul></div>
    <div><div style="font-size:.75rem;font-weight:600;color:#ef4444;margin-bottom:6px">⚠️ RISKS</div><ul style="margin:0;padding-left:16px;font-size:.85rem;color:#374151">${(r.risks||[]).map(u=>`<li>${_e(u)}</li>`).join('')}</ul></div>
  </div>

  ${r.key_metrics_affected?.length?`<div style="margin-bottom:16px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:8px">METRICS AFFECTED</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${r.key_metrics_affected.map(m=>{
      const col=m.direction==='up'?'#10b981':m.direction==='down'?'#ef4444':'#6b7280';
      const arrow=m.direction==='up'?'↑':m.direction==='down'?'↓':'→';
      return `<div style="background:#f9fafb;border-radius:8px;padding:8px 14px;text-align:center"><div style="font-size:.75rem;color:#6b7280">${_e(m.metric)}</div><div style="font-size:1rem;font-weight:700;color:${col}">${arrow} ${_e(m.estimated_change)}</div></div>`;
    }).join('')}</div>
  </div>`:''}

  <div style="background:#eff6ff;border-radius:8px;padding:12px">
    <div style="font-size:.75rem;font-weight:600;color:#3b82f6;margin-bottom:4px">⚡ RECOMMENDED ACTION</div>
    <div>${_e(r.recommended_action||'')}</div>
  </div>

  ${r.alternative_scenarios?.length?`<div style="margin-top:12px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:6px">EXPLORE NEXT</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${r.alternative_scenarios.map(a=>`<button class="btn btn-sm btn-outline" onclick="document.getElementById('dt-question').value=${JSON.stringify(a)}">${_e(a)}</button>`).join('')}</div>
  </div>`:''}
</div>`;
}

async function _loadTwinHistory(){
  const d = await _api('GET','/api/digital-twin/history');
  const el = document.getElementById('dt-history');
  if(!el||!d.ok||!d.simulations?.length) return;
  el.innerHTML = `<h3 style="font-size:.9rem;font-weight:600;color:#6b7280;margin:16px 0 8px">Previous Simulations</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.simulations.map(s=>`
  <div class="ig-card" style="padding:12px;cursor:pointer" onclick='_renderTwinResult({results:${JSON.stringify(s.results)},question:${JSON.stringify(s.question)}})'>
    <div style="display:flex;justify-content:space-between">
      <span style="font-weight:600">${_e(s.question)}</span>
      <span style="color:#6b7280;font-size:.8rem">${new Date(s.created_at).toLocaleDateString()}</span>
    </div>
    <div style="margin-top:4px">${_verdictBadge(s.results?.verdict||'mixed')}</div>
  </div>`).join('')}</div>`;
}
window._renderTwinResult = _renderTwinResult;

/* ─────────────────────────────────────────────────────────────────────────
   T84 — AI Acquisition Engine
   ─────────────────────────────────────────────────────────────────────── */
window.buildAcquisitionengine = function(){
  const el = document.getElementById('view-acquisition-engine');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>🚀 AI Acquisition Engine</h2><p class="view-sub">Finds prospects, scores them, writes emails, and tracks meetings — fully autonomous.</p></div>
<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
  <div class="ig-card" style="flex:1;min-width:300px">
    <h3 style="font-weight:600;margin-bottom:16px">Launch New Campaign</h3>
    <div class="form-group"><label>Campaign Name</label><input id="ae-name" class="form-control" value="Q3 Outreach" /></div>
    <div class="form-group"><label>Target Industry</label><input id="ae-ind" class="form-control" placeholder="e.g. E-commerce, SaaS, Healthcare" /></div>
    <div class="form-group"><label>Target Role</label><input id="ae-role" class="form-control" placeholder="e.g. Marketing Director, CEO" /></div>
    <div class="form-group"><label>Company Size</label><select id="ae-size" class="form-control"><option value="">Any</option><option>1-10</option><option>11-50</option><option>51-200</option><option>201-500</option><option>500+</option></select></div>
    <div class="form-group"><label>Value Proposition</label><input id="ae-vp" class="form-control" placeholder="e.g. AI that doubles your ad ROAS" /></div>
    <div class="form-group"><label>Prospects to Find</label><input id="ae-count" class="form-control" type="number" value="10" min="5" max="20" /></div>
    <button id="ae-launch" class="btn btn-primary" style="width:100%">🚀 Launch Engine</button>
  </div>
  <div id="ae-campaigns" style="flex:2;min-width:300px"></div>
</div>
<div id="ae-result"></div>`;

  document.getElementById('ae-launch').onclick = async function(){
    const ind = document.getElementById('ae-ind').value.trim();
    if(!ind) return alert('Enter a target industry.');
    this.disabled=true; this.textContent='Finding & scoring prospects…';
    const d = await _api('POST','/api/acquisition-engine/launch',{
      name: document.getElementById('ae-name').value||'Campaign',
      target_industry: ind,
      target_role: document.getElementById('ae-role').value,
      target_size: document.getElementById('ae-size').value,
      value_prop: document.getElementById('ae-vp').value,
      count: +document.getElementById('ae-count').value||10
    });
    this.disabled=false; this.textContent='🚀 Launch Engine';
    if(!d.ok) return alert(d.error||'Error');
    _renderAEResult(d);
    _loadAECampaigns();
  };
  _loadAECampaigns();
};

function _renderAEResult(d){
  const el = document.getElementById('ae-result');
  const seq = d.email_sequence?.emails||[];
  el.innerHTML = `
<div class="ig-card" style="margin-bottom:16px">
  <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px">
    <div style="text-align:center"><div style="font-size:2rem;font-weight:800;color:#3b82f6">${d.stats?.total_found||0}</div><div style="font-size:.75rem;color:#6b7280">Prospects Found</div></div>
    <div style="text-align:center"><div style="font-size:2rem;font-weight:800;color:#10b981">${d.stats?.emails_sent||0}</div><div style="font-size:.75rem;color:#6b7280">Emails Sent</div></div>
    <div style="text-align:center"><div style="font-size:2rem;font-weight:800;color:#f59e0b">${d.stats?.replies||0}</div><div style="font-size:.75rem;color:#6b7280">Replies</div></div>
    <div style="text-align:center"><div style="font-size:2rem;font-weight:800;color:#8b5cf6">${d.stats?.meetings_booked||0}</div><div style="font-size:.75rem;color:#6b7280">Meetings Booked</div></div>
  </div>
  <h4 style="font-weight:600;margin-bottom:8px">Prospects</h4>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.85rem">
    <thead><tr style="background:#f9fafb">${['Name','Company','Role','Email','Score','Actions'].map(h=>`<th style="padding:8px;text-align:left;color:#6b7280;font-weight:600">${h}</th>`).join('')}</tr></thead>
    <tbody>${(d.prospects||[]).map(p=>`<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px">${_e(p.name||'—')}</td>
      <td style="padding:8px;font-weight:600">${_e(p.company||'—')}</td>
      <td style="padding:8px">${_e(p.role||'—')}</td>
      <td style="padding:8px;color:#6b7280">${p.email?_e(p.email):'<span style="color:#d1d5db">—</span>'}</td>
      <td style="padding:8px"><div style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:${p.score>=70?'#d1fae5':p.score>=40?'#fef3c7':'#fee2e2'};color:${p.score>=70?'#065f46':p.score>=40?'#92400e':'#991b1b'};font-weight:700;font-size:.8rem">${p.score}</div></td>
      <td style="padding:8px;display:flex;gap:6px">
        <button class="btn btn-xs" onclick="_aeMark(${p.id},'sent')" title="Mark emailed">📧</button>
        <button class="btn btn-xs" onclick="_aeMark(${p.id},'meeting')" title="Mark meeting booked">📅</button>
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
</div>
${seq.length?`<div class="ig-card">
  <h4 style="font-weight:600;margin-bottom:12px">📧 AI-Generated Email Sequence (${seq.length} steps)</h4>
  <div style="display:flex;flex-direction:column;gap:12px">${seq.map(e=>`
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px">
      <div style="font-size:.75rem;font-weight:700;color:#3b82f6;margin-bottom:4px">STEP ${e.step}</div>
      <div style="font-weight:600;margin-bottom:6px">Subject: ${_e(e.subject||'')}</div>
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:.85rem;color:#374151;margin:0;background:#f9fafb;padding:10px;border-radius:6px">${_e(e.body||'')}</pre>
    </div>`).join('')}
  </div>
</div>`:''}`;
}

window._aeMark = async function(id, type){
  const path = type==='meeting' ? `/api/acquisition-engine/prospects/${id}/mark-meeting` : `/api/acquisition-engine/prospects/${id}/mark-sent`;
  await _api('POST', path);
  _loadAECampaigns();
};

async function _loadAECampaigns(){
  const d = await _api('GET','/api/acquisition-engine/campaigns');
  const el = document.getElementById('ae-campaigns');
  if(!el) return;
  if(!d.ok||!d.campaigns?.length){ el.innerHTML='<div class="ig-card" style="padding:24px;text-align:center;color:#6b7280">No campaigns yet — launch your first above.</div>'; return; }
  el.innerHTML = `<h3 style="font-weight:600;margin-bottom:8px">Active Campaigns</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.campaigns.map(c=>{
    const s = c.stats||{};
    return `<div class="ig-card" style="padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600">${_e(c.name)}</span>
        <span style="background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:600">${_e(c.status)}</span>
      </div>
      <div style="display:flex;gap:16px;font-size:.8rem;color:#6b7280">
        <span>👥 ${s.total_found||0} found</span>
        <span>📧 ${s.emails_sent||0} emailed</span>
        <span>💬 ${s.replies||0} replies</span>
        <span>📅 ${s.meetings_booked||0} meetings</span>
      </div>
    </div>`;
  }).join('')}</div>`;
}

/* ─────────────────────────────────────────────────────────────────────────
   T85 — Investor Mode
   ─────────────────────────────────────────────────────────────────────── */
window.buildInvestormode = function(){
  const el = document.getElementById('view-investor-mode');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>📈 Investor Mode</h2><p class="view-sub">Auto-generate investor reports with revenue forecasts, CAC/LTV analysis, and a shareable read-only investor portal link.</p></div>
<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
  <div class="ig-card" style="flex:1;min-width:300px">
    <h3 style="font-weight:600;margin-bottom:16px">Generate Investor Report</h3>
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="form-group"><label>Company Name</label><input id="im-co" class="form-control" placeholder="Acme Inc" /></div>
      <div class="form-group"><label>Stage</label><select id="im-stage" class="form-control"><option>pre-seed</option><option>seed</option><option>series-a</option><option>series-b</option><option>growth</option></select></div>
      <div class="form-group"><label>MRR</label><input id="im-mrr" class="form-control" type="number" placeholder="50000" /></div>
      <div class="form-group"><label>ARR</label><input id="im-arr" class="form-control" type="number" placeholder="600000" /></div>
      <div class="form-group"><label>MoM Growth Rate (%)</label><input id="im-gr" class="form-control" type="number" placeholder="12" /></div>
      <div class="form-group"><label>CAC</label><input id="im-cac" class="form-control" type="number" placeholder="400" /></div>
      <div class="form-group"><label>LTV</label><input id="im-ltv" class="form-control" type="number" placeholder="2400" /></div>
      <div class="form-group"><label>Burn Rate / Month</label><input id="im-burn" class="form-control" type="number" placeholder="30000" /></div>
      <div class="form-group"><label>Runway (months)</label><input id="im-run" class="form-control" type="number" placeholder="18" /></div>
      <div class="form-group"><label>Paying Customers</label><input id="im-cust" class="form-control" type="number" placeholder="120" /></div>
      <div class="form-group"><label>Currency</label><select id="im-cur" class="form-control"><option>USD</option><option>EUR</option><option>GBP</option><option>ZAR</option></select></div>
    </div>
    <div class="form-group"><label>Key Highlights (one per line)</label><textarea id="im-hi" class="form-control" rows="3" placeholder="Signed 3 enterprise contracts&#10;Launched in Germany&#10;Raised seed round"></textarea></div>
    <div class="form-group"><label>Current Challenges (one per line)</label><textarea id="im-ch" class="form-control" rows="2" placeholder="Sales cycle too long&#10;Churn in SMB segment"></textarea></div>
    <button id="im-run" class="btn btn-primary" style="width:100%">📈 Generate Report + Portal Link</button>
  </div>
  <div id="im-history" style="flex:1;min-width:280px"></div>
</div>
<div id="im-result"></div>`;

  document.getElementById('im-run').onclick = async function(){
    const co = document.getElementById('im-co').value.trim();
    if(!co) return alert('Enter company name.');
    this.disabled=true; this.textContent='Generating investor report…';
    const d = await _api('POST','/api/investor-mode/generate',{
      company_name:co, stage:document.getElementById('im-stage').value,
      mrr:+document.getElementById('im-mrr').value||0, arr:+document.getElementById('im-arr').value||0,
      growth_rate:+document.getElementById('im-gr').value||0, cac:+document.getElementById('im-cac').value||0,
      ltv:+document.getElementById('im-ltv').value||0, burn_rate:+document.getElementById('im-burn').value||0,
      runway_months:+document.getElementById('im-run').value||12, paying_customers:+document.getElementById('im-cust').value||0,
      currency:document.getElementById('im-cur').value,
      highlights: document.getElementById('im-hi').value.split('\n').filter(Boolean),
      challenges: document.getElementById('im-ch').value.split('\n').filter(Boolean)
    });
    this.disabled=false; this.textContent='📈 Generate Report + Portal Link';
    if(!d.ok) return alert(d.error||'Error');
    _renderInvestorReport(d);
    _loadIMHistory();
  };
  _loadIMHistory();
};

function _renderInvestorReport(d){
  const r = d.report||{};
  const portalUrl = window.location.origin + '/investor/' + (d.portal_token||'');
  const el = document.getElementById('im-result');
  el.innerHTML = `
<div class="ig-card" style="border-top:3px solid #10b981;margin-bottom:16px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px">
    <div>
      <div style="font-size:1.3rem;font-weight:800">${_e(d.company_name||'')} — Investor Report</div>
      <div style="color:#6b7280;margin-top:2px">${r.executive_summary||''}</div>
    </div>
    <div>
      <div style="font-size:.75rem;color:#6b7280;margin-bottom:4px">🔗 INVESTOR PORTAL LINK (read-only)</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="im-portal-url" class="form-control" style="font-size:.8rem;width:320px" readonly value="${_e(portalUrl)}" />
        <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText(document.getElementById('im-portal-url').value)">Copy</button>
      </div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px">
    ${(r.headline_metrics||[]).map(m=>{
      const col=m.trend==='up'?'#10b981':m.trend==='down'?'#ef4444':'#6b7280';
      const arrow=m.trend==='up'?'↑':m.trend==='down'?'↓':'';
      return `<div style="background:#f9fafb;border-radius:8px;padding:12px">
        <div style="font-size:.7rem;color:#6b7280;text-transform:uppercase">${_e(m.label)}</div>
        <div style="font-size:1.2rem;font-weight:700;color:${col}">${arrow} ${_e(m.value)}</div>
        ${m.change?`<div style="font-size:.75rem;color:#6b7280">${_e(m.change)}</div>`:''}
      </div>`;
    }).join('')}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div><div style="font-size:.75rem;font-weight:600;color:#10b981;margin-bottom:6px">✅ HIGHLIGHTS</div><ul style="margin:0;padding-left:16px;font-size:.85rem">${(r.highlights||[]).map(h=>`<li>${_e(h)}</li>`).join('')}</ul></div>
    <div><div style="font-size:.75rem;font-weight:600;color:#f59e0b;margin-bottom:6px">⚠️ CHALLENGES</div><ul style="margin:0;padding-left:16px;font-size:.85rem">${(r.challenges||[]).map(h=>`<li>${_e(h)}</li>`).join('')}</ul></div>
  </div>
  ${r.ask?`<div style="background:#eff6ff;border-radius:8px;padding:12px;margin-top:16px"><div style="font-size:.75rem;font-weight:600;color:#3b82f6;margin-bottom:4px">THE ASK</div><div>${_e(r.ask)}</div></div>`:''}
</div>`;
}

async function _loadIMHistory(){
  const d = await _api('GET','/api/investor-mode/history');
  const el = document.getElementById('im-history');
  if(!el||!d.ok||!d.reports?.length) return;
  el.innerHTML = `<h3 style="font-weight:600;margin-bottom:8px">Recent Reports</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.reports.map(r=>{
    const c = r.content||{};
    const portalUrl = window.location.origin + '/investor/' + (r.portal_token||'');
    return `<div class="ig-card" style="padding:12px">
      <div style="font-weight:600">${_e(c.company_name||'Report')}</div>
      <div style="font-size:.8rem;color:#6b7280;margin:2px 0">${new Date(r.created_at).toLocaleDateString()}</div>
      <a href="${_e(portalUrl)}" target="_blank" style="font-size:.8rem;color:#3b82f6">Open investor portal ↗</a>
    </div>`;
  }).join('')}</div>`;
}
window._renderInvestorReport = _renderInvestorReport;

/* ─────────────────────────────────────────────────────────────────────────
   T86 — Business Acquisition Scanner
   ─────────────────────────────────────────────────────────────────────── */
window.buildBizscanner = function(){
  const el = document.getElementById('view-biz-scanner');
  if(!el) return;
  // Guard: skip rebuild if form is already mounted — this preserves any value
  // the user typed or AI Suggest filled in across navigations, instead of
  // resetting back to the hardcoded default on every view re-entry.
  if(document.getElementById('bs-run')){ _loadBSHistory(); return; }

  const defaultIndustry = (function(){
    const a = window.analysisData||{};
    return (a.industry && (a.industry.name||a.industry)) || '';
  })();

  const iS = 'width:100%;padding:11px 14px;background:#FFFFFF;border:1.5px solid #D1DCF5;border-radius:10px;font-size:0.875rem;font-weight:500;color:#0A1628;outline:none;box-sizing:border-box;font-family:inherit;transition:border-color .15s';
  const lS = 'display:block;font-size:0.72rem;font-weight:700;color:#374B6E;text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px';

  el.innerHTML = `
<div style="background:linear-gradient(110deg,#1E40AF 0%,#2563EB 55%,#3B82F6 100%);border-radius:18px;padding:26px 32px;margin-bottom:24px;position:relative;overflow:hidden;box-shadow:0 8px 32px rgba(37,99,235,.22)">
  <div style="position:absolute;top:-60px;right:-40px;width:240px;height:240px;background:radial-gradient(circle,rgba(255,255,255,.18),transparent 65%);pointer-events:none"></div>
  <div style="position:absolute;bottom:-30px;left:30%;width:160px;height:160px;background:radial-gradient(circle,rgba(0,201,200,.2),transparent 65%);pointer-events:none"></div>
  <div style="position:relative;z-index:1">
    <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:20px;padding:4px 14px;font-size:0.67rem;font-weight:700;color:#BFDBFE;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">AI-POWERED · M&amp;A INTELLIGENCE</div>
    <div style="font-family:Sora,sans-serif;font-size:1.6rem;font-weight:900;color:#FFFFFF;margin-bottom:8px;text-shadow:0 1px 3px rgba(10,20,60,.2)">🔭 Business Acquisition Scanner</div>
    <div style="color:#BFDBFE;font-size:0.9rem;max-width:580px;line-height:1.55">Scans for struggling competitors, businesses for sale, fast-growing sectors, and franchise opportunities — then scores and ranks each one for you.</div>
    <div style="display:flex;gap:20px;margin-top:16px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:6px;color:#E0EAFF;font-size:0.78rem;font-weight:600"><span style="width:20px;height:20px;background:rgba(255,255,255,.2);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:0.7rem">⚠️</span>Struggling Competitors</div>
      <div style="display:flex;align-items:center;gap:6px;color:#E0EAFF;font-size:0.78rem;font-weight:600"><span style="width:20px;height:20px;background:rgba(255,255,255,.2);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:0.7rem">🏷️</span>Businesses for Sale</div>
      <div style="display:flex;align-items:center;gap:6px;color:#E0EAFF;font-size:0.78rem;font-weight:600"><span style="width:20px;height:20px;background:rgba(255,255,255,.2);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:0.7rem">📈</span>Fast-Growing Sectors</div>
      <div style="display:flex;align-items:center;gap:6px;color:#E0EAFF;font-size:0.78rem;font-weight:600"><span style="width:20px;height:20px;background:rgba(255,255,255,.2);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:0.7rem">🏪</span>Franchise Opportunities</div>
    </div>
  </div>
</div>

<div style="background:#FFFFFF;border:1.5px solid #E0EAFF;border-radius:18px;padding:28px 32px;margin-bottom:24px;box-shadow:0 4px 20px rgba(10,20,60,.07)">
  <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628;margin-bottom:20px;display:flex;align-items:center;gap:8px"><span style="width:28px;height:28px;background:linear-gradient(135deg,#0066FF,#00C9C8);border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:0.8rem">🔍</span>Scan Parameters</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px 24px;margin-bottom:24px">
    <div>
      <label style="${lS}">Industry / Sector</label>
      <input id="bs-ind" style="${iS}" value="${_e(defaultIndustry)}" placeholder="e.g. SaaS, Forex, Healthcare" />
    </div>
    <div>
      <label style="${lS}">Region</label>
      <select id="bs-reg" style="${iS};cursor:pointer">
        <option value="Global">🌐 Global / All Countries</option>
        <option value="United States">🇺🇸 United States</option>
        <option value="United Kingdom">🇬🇧 United Kingdom</option>
        <option value="European Union">🇪🇺 European Union</option>
        <option value="Australia">🇦🇺 Australia</option>
        <option value="Canada">🇨🇦 Canada</option>
        <option value="Germany">🇩🇪 Germany</option>
        <option value="France">🇫🇷 France</option>
        <option value="Singapore">🇸🇬 Singapore</option>
        <option value="South Africa">🇿🇦 South Africa</option>
        <option value="India">🇮🇳 India</option>
        <option value="Brazil">🇧🇷 Brazil</option>
      </select>
    </div>
    <div>
      <label style="${lS}">Scan Type</label>
      <select id="bs-type" style="${iS};cursor:pointer">
        <option value="all">🔭 Full Scan (all types)</option>
        <option value="struggling">⚠️ Struggling Competitors</option>
        <option value="for_sale">🏷️ Businesses for Sale</option>
        <option value="growing">📈 Fast-Growing Sectors</option>
        <option value="franchise">🏪 Franchise Opportunities</option>
      </select>
    </div>
    <div>
      <label style="${lS}">Budget Range <span style="font-weight:500;text-transform:none;letter-spacing:0;color:#9BADC8">(optional)</span></label>
      <input id="bs-budget" style="${iS}" placeholder="e.g. $100K–$2M" />
    </div>
  </div>
  <button id="bs-run" style="width:100%;padding:15px 24px;background:linear-gradient(135deg,#0055DD,#0066FF,#00C9C8);border:none;border-radius:12px;font-size:1rem;font-weight:800;color:white;cursor:pointer;box-shadow:0 6px 24px rgba(0,102,255,.35);letter-spacing:.03em;font-family:Sora,inherit;transition:opacity .15s;position:relative;overflow:hidden">
    <span style="position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);transform:skewX(-20deg);animation:bs-shimmer 2.5s ease-in-out infinite"></span>
    🔭 Run Acquisition Scan
  </button>
  <style>@keyframes bs-shimmer{0%{left:-100%}60%,100%{left:150%}}</style>
</div>
<div id="bs-result"></div>
<div id="bs-history"></div>`;

  document.getElementById('bs-run').onclick = async function(){
    this.disabled=true; this.textContent='⏳ Scanning market…';
    const d = await _api('POST','/api/biz-scanner/scan',{
      industry: document.getElementById('bs-ind').value||'SaaS',
      region: document.getElementById('bs-reg').value||'Global',
      scan_type: document.getElementById('bs-type').value,
      budget_range: document.getElementById('bs-budget').value
    });
    this.disabled=false; this.textContent='🔭 Run Acquisition Scan';
    if(!d.ok) return alert(d.error||'Error');
    _renderBizScan(d);
    _loadBSHistory();
  };
  _loadBSHistory();
};

function _renderBizScan(d){
  const r = d.results||{};
  const catColour = { struggling:'#EF4444', for_sale:'#3B82F6', growing:'#10B981', franchise:'#F59E0B' };
  const catIcon   = { struggling:'⚠️', for_sale:'🏷️', growing:'📈', franchise:'🏪' };
  const el = document.getElementById('bs-result');
  el.innerHTML = `
<div style="background:linear-gradient(135deg,#F0FDF9,#F8FFFC);border:1.5px solid #A7F3D0;border-left:4px solid #10B981;border-radius:14px;padding:20px 24px;margin-bottom:20px">
  <div style="font-size:0.7rem;font-weight:800;color:#059669;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">📊 Market Summary</div>
  <p style="color:#1A3A2A;font-size:0.9rem;line-height:1.6;margin:0 0 ${r.top_pick?'14':'0'}px">${_e(r.market_summary||'')}</p>
  ${r.top_pick?`<div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px"><span style="font-size:1.2rem">🏆</span><div><div style="font-size:0.68rem;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.06em">Top Pick</div><div style="font-weight:700;color:#0A1628;margin-top:3px;font-size:0.9rem">${_e(r.top_pick)}</div></div></div>`:''}
</div>

<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;margin-bottom:20px">
  ${(r.opportunities||[]).map(o=>{
    const col = catColour[o.category]||'#6B7280';
    const ico = catIcon[o.category]||'💡';
    return `<div style="background:#FFFFFF;border:1.5px solid #E8EEF8;border-top:3px solid ${col};border-radius:14px;padding:18px 20px;box-shadow:0 4px 16px rgba(10,20,60,.07)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div style="flex:1;min-width:0;margin-right:10px">
          <div style="font-weight:800;color:#0A1628;font-size:0.92rem;margin-bottom:6px">${_e(o.name)}</div>
          <span style="font-size:0.63rem;background:${col}18;color:${col};border:1px solid ${col}44;border-radius:5px;padding:2px 8px;font-weight:700">${ico} ${_e(o.category||'').replace('_',' ').toUpperCase()}</span>
        </div>
        ${_scoreRing(o.opportunity_score||0)}
      </div>
      <div style="font-size:0.78rem;color:#0066FF;font-weight:700;margin-bottom:8px">${_e(o.estimated_value||'')}</div>
      <p style="font-size:0.83rem;color:#374B6E;line-height:1.55;margin:0 0 10px">${_e(o.why_interesting||'')}</p>
      ${o.signals?.length?`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">${o.signals.map(s=>`<span style="background:#F0F4FF;border:1px solid #D1DCF5;border-radius:5px;padding:2px 8px;font-size:0.7rem;color:#374B6E">${_e(s)}</span>`).join('')}</div>`:''}
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 12px;font-size:0.8rem">
        <span style="color:#1D4ED8;font-weight:700">Next step: </span><span style="color:#374B6E">${_e(o.action||'')}</span>
      </div>
    </div>`;
  }).join('')}
</div>

${r.sector_trends?.length?`<div style="background:#FFFFFF;border:1.5px solid #D1DCF5;border-radius:14px;padding:20px 24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(10,20,60,.06)">
  <div style="font-size:0.7rem;font-weight:800;color:#0066FF;text-transform:uppercase;letter-spacing:.07em;margin-bottom:14px">📈 Sector Trends</div>
  <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px">${r.sector_trends.map(t=>`<li style="display:flex;align-items:flex-start;gap:8px;color:#374B6E;font-size:0.875rem;line-height:1.5"><span style="color:#0066FF;font-weight:800;flex-shrink:0">→</span>${_e(t)}</li>`).join('')}</ul>
</div>`:''}`;
}

async function _loadBSHistory(){
  const d = await _api('GET','/api/biz-scanner/history');
  const el = document.getElementById('bs-history');
  if(!el||!d.ok||!d.runs?.length) return;
  el.innerHTML = `
<div style="font-size:0.7rem;font-weight:800;color:#7A92B4;text-transform:uppercase;letter-spacing:.07em;margin:8px 0 10px">Previous Scans</div>
<div style="display:flex;flex-direction:column;gap:8px">${d.runs.map(r=>`
  <div style="background:#FFFFFF;border:1.5px solid #E8EEF8;border-radius:12px;padding:14px 18px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;transition:border-color .15s;box-shadow:0 1px 4px rgba(10,20,60,.05)" onclick='_renderBizScan({results:${JSON.stringify(r.results)}})'>
    <div>
      <div style="font-weight:700;color:#0A1628;font-size:0.875rem;margin-bottom:3px">${_e(r.industry)} · ${_e(r.region)}</div>
      <div style="font-size:0.78rem;color:#0066FF">${r.results?.opportunities?.length||0} opportunities found</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:0.75rem;color:#7A92B4">${new Date(r.created_at).toLocaleDateString()}</div>
      <div style="font-size:0.7rem;color:#9BADC8;margin-top:2px">click to view →</div>
    </div>
  </div>`).join('')}</div>`;
}
window._renderBizScan = _renderBizScan;

/* ─────────────────────────────────────────────────────────────────────────
   T87 — AI Marketing Marketplace
   ─────────────────────────────────────────────────────────────────────── */
window.buildMarketplace = function(){
  const el = document.getElementById('view-marketplace');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>🛍️ AI Marketing Marketplace</h2><p class="view-sub">Browse, download, and publish marketing templates, campaigns, audiences, prompt packs, and AI agents.</p></div>
<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
  <input id="mp-search" class="form-control" style="max-width:260px" placeholder="Search listings…" />
  <select id="mp-cat" class="form-control" style="max-width:180px"><option value="">All Categories</option><option>template</option><option>campaign</option><option>audience</option><option>prompt_pack</option><option>landing_page</option><option>email_sequence</option><option>ai_agent</option><option>creative</option></select>
  <button class="btn btn-outline" onclick="window._mpLoadListings()">🔍 Search</button>
  <button class="btn btn-primary" onclick="window._mpShowPublish()">+ Publish Listing</button>
  <div id="mp-stats" style="margin-left:auto;font-size:.85rem;color:#6b7280"></div>
</div>
<div id="mp-publish-form" style="display:none;margin-bottom:16px"></div>
<div id="mp-listings"></div>`;

  window._mpLoadListings = async function(){
    const search = document.getElementById('mp-search')?.value||'';
    const cat = document.getElementById('mp-cat')?.value||'';
    const d = await _api('GET',`/api/marketplace/listings?category=${encodeURIComponent(cat)}&search=${encodeURIComponent(search)}`);
    const stats = await _api('GET','/api/marketplace/stats');
    const sel = document.getElementById('mp-stats');
    if(sel&&stats.ok) sel.innerHTML = `${stats.total_listings} listings · ${stats.my_listings} mine · ${stats.my_total_downloads} downloads`;
    const el2 = document.getElementById('mp-listings');
    if(!el2||!d.ok) return;
    if(!d.listings?.length){ el2.innerHTML='<div class="ig-card" style="padding:32px;text-align:center;color:#6b7280">No listings yet — be the first to publish something!</div>'; return; }
    const cats = { template:'📄', campaign:'📣', audience:'🎯', prompt_pack:'💬', landing_page:'🚀', email_sequence:'📧', ai_agent:'🤖', creative:'🎨' };
    el2.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">
      ${d.listings.map(l=>`<div class="ig-card" style="display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div style="font-size:1.4rem">${cats[l.category]||'📦'}</div>
          <span style="background:#f3f4f6;border-radius:4px;padding:2px 8px;font-size:.75rem;color:#374151">${_e(l.category||'').replace('_',' ')}</span>
        </div>
        <div style="font-weight:700;margin-bottom:4px">${_e(l.title)}</div>
        <div style="font-size:.85rem;color:#6b7280;flex:1;margin-bottom:10px">${_e(l.description||'')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${(l.tags||[]).map(t=>`<span style="background:#eff6ff;color:#3b82f6;border-radius:4px;padding:2px 6px;font-size:.7rem">${_e(t)}</span>`).join('')}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:.8rem;color:#6b7280">⬇️ ${l.downloads||0} downloads</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-primary" onclick="window._mpDownload(${l.id},'${_e(l.title)}')">Get</button>
            ${l.is_mine?`<button class="btn btn-sm btn-outline" onclick="window._mpDelete(${l.id})">🗑</button>`:''}
          </div>
        </div>
      </div>`).join('')}
    </div>`;
  };

  window._mpShowPublish = function(){
    const f = document.getElementById('mp-publish-form');
    if(!f) return;
    f.style.display = f.style.display==='none'?'block':'none';
    if(f.style.display==='block' && !f.innerHTML) f.innerHTML = `
<div class="ig-card">
  <h4 style="font-weight:600;margin-bottom:12px">Publish a New Listing</h4>
  <div class="form-grid" style="grid-template-columns:1fr 1fr">
    <div class="form-group"><label>Title</label><input id="mp-pub-title" class="form-control" placeholder="My Email Sequence Template" /></div>
    <div class="form-group"><label>Category</label><select id="mp-pub-cat" class="form-control"><option>template</option><option>campaign</option><option>audience</option><option>prompt_pack</option><option>landing_page</option><option>email_sequence</option><option>ai_agent</option><option>creative</option></select></div>
    <div class="form-group" style="grid-column:1/-1"><label>Description</label><textarea id="mp-pub-desc" class="form-control" rows="2" placeholder="What this is and how to use it"></textarea></div>
    <div class="form-group" style="grid-column:1/-1"><label>Tags (comma-separated)</label><input id="mp-pub-tags" class="form-control" placeholder="email, cold outreach, B2B" /></div>
    <div class="form-group" style="grid-column:1/-1"><label>Content (JSON or plain text)</label><textarea id="mp-pub-content" class="form-control" rows="4" placeholder='{"subject":"...","body":"..."}'></textarea></div>
  </div>
  <button class="btn btn-primary" onclick="window._mpPublish()">Publish to Marketplace</button>
</div>`;
  };

  window._mpPublish = async function(){
    const title = document.getElementById('mp-pub-title')?.value.trim();
    if(!title) return alert('Title required.');
    let content = {};
    try { content = JSON.parse(document.getElementById('mp-pub-content')?.value||'{}'); } catch { content = { text: document.getElementById('mp-pub-content')?.value||'' }; }
    const tags = (document.getElementById('mp-pub-tags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean);
    const d = await _api('POST','/api/marketplace/listings',{ title, description: document.getElementById('mp-pub-desc')?.value||'', category: document.getElementById('mp-pub-cat')?.value||'template', tags, content });
    if(!d.ok) return alert(d.error||'Error');
    document.getElementById('mp-publish-form').style.display='none';
    window._mpLoadListings();
  };

  window._mpDownload = async function(id, title){
    const d = await _api('POST',`/api/marketplace/listings/${id}/download`);
    if(!d.ok) return alert('Could not get listing.');
    const content = d.listing?.content||{};
    const text = typeof content==='string' ? content : JSON.stringify(content, null, 2);
    const blob = new Blob([text], {type:'text/plain'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(title||'listing').replace(/[^a-z0-9]/gi,'_')+'.txt'; a.click();
    window._mpLoadListings();
  };

  window._mpDelete = async function(id){
    if(!confirm('Delete this listing?')) return;
    await _api('DELETE',`/api/marketplace/listings/${id}`);
    window._mpLoadListings();
  };

  window._mpLoadListings();
};

/* ─────────────────────────────────────────────────────────────────────────
   T88 — Autonomous Marketing Operator
   ─────────────────────────────────────────────────────────────────────── */
window.buildAutooperator = function(){
  const el = document.getElementById('view-auto-operator');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>🦾 Autonomous Marketing Operator</h2><p class="view-sub">The AI that doesn't say "here's the data" — it says "I already fixed it." Detects problems and acts without waiting for you.</p></div>
<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
  <div class="ig-card" style="flex:1;min-width:300px">
    <h3 style="font-weight:600;margin-bottom:16px">Run Operator</h3>
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="form-group"><label>Current ROAS</label><input id="ao-roas" class="form-control" type="number" step="0.1" placeholder="1.8" /></div>
      <div class="form-group"><label>Target ROAS</label><input id="ao-troas" class="form-control" type="number" step="0.1" value="2.5" /></div>
      <div class="form-group"><label>Current CAC</label><input id="ao-cac" class="form-control" type="number" placeholder="320" /></div>
      <div class="form-group"><label>Target CAC</label><input id="ao-tcac" class="form-control" type="number" placeholder="250" /></div>
      <div class="form-group"><label>Daily Spend</label><input id="ao-spend" class="form-control" type="number" placeholder="1200" /></div>
      <div class="form-group"><label>Budget Remaining</label><input id="ao-budget" class="form-control" type="number" placeholder="18000" /></div>
    </div>
    <div class="form-group"><label>Known Issues (one per line)</label><textarea id="ao-issues" class="form-control" rows="3" placeholder="ROAS dropping on Meta&#10;TikTok CPM spiked 40%&#10;Landing page CVR below 2%"></textarea></div>
    <button id="ao-run" class="btn btn-primary" style="width:100%;background:linear-gradient(135deg,#7c3aed,#3b82f6)">🦾 Deploy Operator Now</button>
  </div>
  <div id="ao-history-panel" style="flex:1;min-width:280px"></div>
</div>
<div id="ao-result"></div>`;

  document.getElementById('ao-run').onclick = async function(){
    this.disabled=true; this.textContent='Operator analysing & acting…';
    const d = await _api('POST','/api/auto-operator/run',{
      trigger:'manual',
      current_roas: +document.getElementById('ao-roas').value||null,
      target_roas: +document.getElementById('ao-troas').value||2.5,
      current_cac: +document.getElementById('ao-cac').value||null,
      target_cac: +document.getElementById('ao-tcac').value||null,
      daily_spend: +document.getElementById('ao-spend').value||null,
      budget_remaining: +document.getElementById('ao-budget').value||null,
      issues: (document.getElementById('ao-issues').value||'').split('\n').filter(Boolean)
    });
    this.disabled=false; this.textContent='🦾 Deploy Operator Now';
    if(!d.ok) return alert(d.error||'Error');
    _renderAOResult(d);
    _loadAOHistory();
  };
  _loadAOHistory();
};

function _renderAOResult(d){
  const r = d.result||{};
  const sevCol = {low:'#10b981',medium:'#f59e0b',high:'#ef4444',critical:'#7f1d1d'};
  const actionIcon = {rewrite_ad:'✏️',pause_campaign:'⏸️',scale_campaign:'📈',reallocate_budget:'💸',launch_ab_test:'🧪',update_landing_page:'🔧',send_alert:'🔔',adjust_bid:'⚙️'};
  const el = document.getElementById('ao-result');
  el.innerHTML = `
<div class="ig-card" style="border-left:4px solid ${sevCol[r.severity||'medium']};margin-bottom:16px">
  <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
    <div>
      <div style="font-size:1rem;font-weight:700">${_e(r.summary||'Operator completed')}</div>
      <div style="color:#6b7280;font-size:.85rem;margin-top:2px">${_e(r.diagnosis||'')}</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      ${_threatBadge(r.severity||'medium')}
      <span style="font-size:.8rem;color:#6b7280">Review in ${_e(r.next_review||'24 hours')}</span>
    </div>
  </div>

  <h4 style="font-weight:600;font-size:.9rem;margin-bottom:10px">Actions Taken</h4>
  <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
    ${(r.actions_taken||[]).map(a=>`<div style="display:flex;gap:12px;padding:10px;background:#f9fafb;border-radius:8px;align-items:flex-start">
      <div style="font-size:1.3rem">${actionIcon[a.action]||'⚙️'}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:.85rem">${_e(a.action||'').replace(/_/g,' ').toUpperCase()}</div>
        <div style="font-size:.85rem;color:#374151">${_e(a.detail||'')}</div>
        <div style="font-size:.8rem;color:#6b7280">${_e(a.target||'')} — ${_e(a.expected_impact||'')}</div>
      </div>
      <span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:4px;background:${a.status==='completed'?'#d1fae5':'#fef3c7'};color:${a.status==='completed'?'#065f46':'#92400e'}">${_e(a.status||'')}</span>
    </div>`).join('')}
  </div>

  ${r.new_ad_copy?.headline?`<div style="background:#faf5ff;border-radius:8px;padding:12px;margin-bottom:12px">
    <div style="font-size:.75rem;font-weight:600;color:#8b5cf6;margin-bottom:8px">✏️ REWRITTEN AD COPY</div>
    <div><span style="font-size:.75rem;color:#6b7280">Headline: </span><strong>${_e(r.new_ad_copy.headline)}</strong></div>
    <div style="font-size:.85rem;color:#374151;margin:4px 0">${_e(r.new_ad_copy.body||'')}</div>
    <div><span style="font-size:.75rem;color:#6b7280">CTA: </span><strong>${_e(r.new_ad_copy.cta||'')}</strong></div>
  </div>`:''}

  ${r.budget_reallocation?.from?`<div style="background:#eff6ff;border-radius:8px;padding:12px;margin-bottom:12px">
    <div style="font-size:.75rem;font-weight:600;color:#3b82f6;margin-bottom:8px">💸 BUDGET REALLOCATION</div>
    <div style="font-size:.85rem">From <strong>${_e(r.budget_reallocation.from)}</strong> → <strong>${_e(r.budget_reallocation.to)}</strong> · ${_e(r.budget_reallocation.amount)}</div>
    <div style="font-size:.8rem;color:#6b7280;margin-top:4px">${_e(r.budget_reallocation.reason||'')}</div>
  </div>`:''}

  ${r.ab_test_proposed?.hypothesis?`<div style="background:#f0fdf4;border-radius:8px;padding:12px">
    <div style="font-size:.75rem;font-weight:600;color:#10b981;margin-bottom:8px">🧪 A/B TEST LAUNCHED</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:.85rem">
      <div><div style="font-size:.7rem;color:#6b7280;margin-bottom:3px">VARIANT A (control)</div>${_e(r.ab_test_proposed.variant_a||'')}</div>
      <div><div style="font-size:.7rem;color:#6b7280;margin-bottom:3px">VARIANT B (challenger)</div>${_e(r.ab_test_proposed.variant_b||'')}</div>
    </div>
    <div style="font-size:.8rem;color:#6b7280;margin-top:8px">Hypothesis: ${_e(r.ab_test_proposed.hypothesis)}</div>
  </div>`:''}
</div>`;
}

async function _loadAOHistory(){
  const d = await _api('GET','/api/auto-operator/runs');
  const el = document.getElementById('ao-history-panel');
  if(!el||!d.ok||!d.runs?.length) return;
  const sevCol = {low:'#10b981',medium:'#f59e0b',high:'#ef4444',critical:'#7f1d1d'};
  el.innerHTML = `<h3 style="font-weight:600;margin-bottom:8px">Operator Log</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.runs.slice(0,10).map(r=>`
  <div class="ig-card" style="padding:10px;border-left:3px solid ${sevCol[r.actions_taken?.[0]?.status||'medium']||'#6b7280'};cursor:pointer" onclick='_renderAOResult({result:${JSON.stringify({...r,actions_taken:r.actions_taken,summary:r.summary})}})'>
    <div style="font-size:.85rem;font-weight:600">${_e(r.trigger)} run</div>
    <div style="font-size:.8rem;color:#374151;margin:2px 0">${_e(r.summary||'')}</div>
    <div style="font-size:.75rem;color:#6b7280">${new Date(r.created_at).toLocaleDateString()} · ${(r.actions_taken||[]).length} actions</div>
  </div>`).join('')}</div>`;
}
window._renderAOResult = _renderAOResult;

/* ─────────────────────────────────────────────────────────────────────────
   Register view builders with navigateTo
   ─────────────────────────────────────────────────────────────────────── */
(function _registerViews(){
  const MAP = {
    'war-room':           window.buildWarRoom,
    'revenue-forecast':   window.buildRevenueforecast,
    'digital-twin':       window.buildDigitaltwin,
    'acquisition-engine': window.buildAcquisitionengine,
    'investor-mode':      window.buildInvestormode,
    'biz-scanner':        window.buildBizscanner,
    'marketplace':        window.buildMarketplace,
    'auto-operator':      window.buildAutooperator,
  };
  const _origNav = window.navigateTo;
  if (typeof _origNav === 'function') {
    window.navigateTo = function(view) {
      _origNav(view);
      if (MAP[view]) {
        try { MAP[view](); } catch(e) { console.warn('[ig_advanced_features] build error:', view, e); }
      }
    };
  }
  // Also handle direct hash/load on page
  document.addEventListener('DOMContentLoaded', function(){
    const hash = (location.hash||'').replace('#','');
    if (MAP[hash]) { try { MAP[hash](); } catch(e){} }
  });
})();

})();
