/* ── T89-T94 Moat Features ──────────────────────────────────────────────── */
/* Benchmarks · MMM · Brand Safety · Safe Agent · Data Provenance · Playbooks */

(function(){
'use strict';

function _e(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _api(method, path, body){
  return fetch(path,{ method, headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined }).then(r=>r.json());
}
function _pct(val, max){ return Math.min(100,Math.max(0,Math.round((val/max)*100))); }
function _riskCol(score){ return score>=70?'#ef4444':score>=40?'#f59e0b':'#10b981'; }
function _verdictBadge(v){
  const map={pass:'#10b981',caution:'#f59e0b',fail:'#ef4444',approved:'#10b981',pending_approval:'#3b82f6',executing:'#8b5cf6',executed:'#10b981',rejected:'#6b7280',rolled_back:'#ef4444'};
  return `<span style="background:${map[v]||'#6b7280'};color:#fff;border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:700;text-transform:uppercase">${_e(v?.replace(/_/g,' '))}</span>`;
}

/* ─────────────────────────────────────────────────────────────────────────
   T89 — Benchmark Intelligence
   ─────────────────────────────────────────────────────────────────────── */
window.buildBenchmarks = function(){
  const el = document.getElementById('view-benchmarks');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>📊 Benchmark Intelligence</h2><p class="view-sub">See how your metrics compare to anonymised InfoGenie network medians for your industry, region, and company size.</p></div>
<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
  <div class="ig-card" style="flex:1;min-width:300px">
    <h3 style="font-weight:600;margin-bottom:16px">Compare Your Metrics</h3>
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="form-group"><label>Vertical</label><select id="bm-vert" class="form-control"></select></div>
      <div class="form-group"><label>Region</label><select id="bm-reg" class="form-control"><option value="">Any region</option></select></div>
      <div class="form-group"><label>Company Size</label><select id="bm-size" class="form-control"><option value="">Any size</option></select></div>
    </div>
    <div id="bm-metric-inputs" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px"></div>
    <div style="display:flex;gap:8px">
      <button id="bm-compare" class="btn btn-primary" style="flex:1">📊 Compare vs Network</button>
      <button id="bm-submit" class="btn btn-outline" style="flex:1" title="Contribute your metrics anonymously">📤 Submit Metrics</button>
    </div>
  </div>
  <div id="bm-leaderboard" style="flex:1;min-width:260px"></div>
</div>
<div id="bm-result"></div>`;

  _api('GET','/api/benchmarks/config').then(d=>{
    if(!d.ok) return;
    const vs = document.getElementById('bm-vert');
    if(vs) vs.innerHTML = d.verticals.map(v=>`<option value="${_e(v)}">${_e(v)}</option>`).join('');
    const rs = document.getElementById('bm-reg');
    if(rs) rs.innerHTML = `<option value="">Any region</option>`+d.regions.map(r=>`<option value="${_e(r)}">${_e(r)}</option>`).join('');
    const ss = document.getElementById('bm-size');
    if(ss) ss.innerHTML = `<option value="">Any size</option>`+d.sizes.map(s=>`<option value="${_e(s)}">${_e(s)}</option>`).join('');
    const inp = document.getElementById('bm-metric-inputs');
    if(inp) inp.innerHTML = d.metrics.map(m=>`
      <div style="display:flex;align-items:center;gap:8px">
        <label style="width:200px;font-size:.82rem;color:#374151;flex-shrink:0">${_e(m.label)}</label>
        <input class="form-control bm-metric" style="max-width:140px" data-key="${_e(m.key)}" data-unit="${_e(m.unit)}" placeholder="${m.unit==='percent'?'%':m.unit==='multiplier'?'x':'$'}0" type="number" step="any" />
      </div>`).join('');
  });

  document.getElementById('bm-compare').onclick = async function(){
    const vert = document.getElementById('bm-vert')?.value; if(!vert) return alert('Select a vertical.');
    const your_metrics = {};
    document.querySelectorAll('.bm-metric').forEach(i=>{ if(i.value) your_metrics[i.dataset.key]=+i.value; });
    this.disabled=true; this.textContent='Comparing…';
    const d = await _api('POST','/api/benchmarks/compare',{ vertical:vert, region:document.getElementById('bm-reg')?.value||null, company_size:document.getElementById('bm-size')?.value||null, your_metrics });
    this.disabled=false; this.textContent='📊 Compare vs Network';
    if(!d.ok) return alert(d.error||'Error');
    _renderBenchmarkResult(d);
  };

  document.getElementById('bm-submit').onclick = async function(){
    const vert = document.getElementById('bm-vert')?.value; if(!vert) return alert('Select a vertical.');
    const metrics = {};
    document.querySelectorAll('.bm-metric').forEach(i=>{ if(i.value) metrics[i.dataset.key]=+i.value; });
    if(!Object.keys(metrics).length) return alert('Enter at least one metric to contribute.');
    const d = await _api('POST','/api/benchmarks/submit',{ vertical:vert, region:document.getElementById('bm-reg')?.value||null, company_size:document.getElementById('bm-size')?.value||null, metrics });
    if(d.ok) alert(`✅ Contributed ${d.submitted} metric(s) anonymously. Thank you!`);
  };

  _loadBenchmarkLeaderboard();
};

function _renderBenchmarkResult(d){
  const el = document.getElementById('bm-result'); if(!el) return;
  const ai = d.ai_insights||{};
  const bm = d.benchmarks||{};
  const ym = d.your_metrics||{};
  const insights = ai.insights||[];
  el.innerHTML = `
<div class="ig-card" style="margin-bottom:16px">
  <div style="font-size:1rem;font-weight:600;margin-bottom:8px">Network Summary — ${_e(d.vertical)}</div>
  <p style="color:#374151;margin-bottom:16px">${_e(ai.summary||'')}</p>
  ${ai.biggest_opportunity?`<div style="background:#eff6ff;border-radius:8px;padding:10px;margin-bottom:16px"><span style="font-weight:600;color:#3b82f6">🏆 Biggest opportunity: </span>${_e(ai.biggest_opportunity)}</div>`:''}
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.85rem">
    <thead><tr style="background:#f9fafb">
      ${['Metric','Your Value','Network P25','Median','P75','Status','Action'].map(h=>`<th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;white-space:nowrap">${h}</th>`).join('')}
    </tr></thead>
    <tbody>${Object.keys({...ym,...bm}).filter((k,i,a)=>a.indexOf(k)===i).map(k=>{
      const b = bm[k]||{};
      const yv = ym[k];
      const ins = insights.find(i=>i.metric===k);
      const col = ins?.status==='above'?'#10b981':ins?.status==='below'?'#ef4444':'#6b7280';
      const arrow = ins?.status==='above'?'↑':ins?.status==='below'?'↓':'→';
      return `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:8px 12px;font-weight:600">${_e(k.replace(/_/g,' '))}</td>
        <td style="padding:8px 12px;font-weight:700;color:${col}">${yv!=null?yv:'—'}</td>
        <td style="padding:8px 12px;color:#6b7280">${b.p25!=null?+b.p25.toFixed(2):'—'}</td>
        <td style="padding:8px 12px;font-weight:600">${b.median!=null?+b.median.toFixed(2):'—'}</td>
        <td style="padding:8px 12px;color:#6b7280">${b.p75!=null?+b.p75.toFixed(2):'—'}</td>
        <td style="padding:8px 12px"><span style="color:${col};font-weight:700">${arrow} ${ins?.status||'—'}</span>${ins?.gap_pct?` <span style="font-size:.75rem;color:#6b7280">(${ins.gap_pct>0?'+':''}${ins.gap_pct}%)</span>`:''}</td>
        <td style="padding:8px 12px;font-size:.8rem;color:#374151;max-width:200px">${_e(ins?.action||ins?.takeaway||'')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${b=>b.sample_count?`<div style="font-size:.75rem;color:#9ca3af;margin-top:8px">Based on ${Object.values(bm)[0]?.sample_count||0} network submissions for this vertical.</div>`:''}
</div>`;
}

async function _loadBenchmarkLeaderboard(){
  const d = await _api('GET','/api/benchmarks/leaderboard');
  const el = document.getElementById('bm-leaderboard'); if(!el) return;
  if(!d.ok||!d.leaderboard?.length){
    el.innerHTML = `<div class="ig-card" style="padding:20px;text-align:center;color:#6b7280">
      <div style="font-size:2rem;margin-bottom:8px">📊</div>
      <div style="font-weight:600;margin-bottom:4px">Building the benchmark pool</div>
      <div style="font-size:.85rem">Be among the first to submit your metrics and gain access to anonymised network benchmarks.</div>
    </div>`; return;
  }
  const grouped = {};
  for(const r of d.leaderboard){ if(!grouped[r.vertical]) grouped[r.vertical]={}; grouped[r.vertical][r.metric_key]=r; }
  el.innerHTML = `<h3 style="font-weight:600;margin-bottom:8px">Network Medians</h3>
<div style="display:flex;flex-direction:column;gap:8px">
  ${Object.entries(grouped).slice(0,5).map(([v,ms])=>`<div class="ig-card" style="padding:12px">
    <div style="font-weight:600;text-transform:capitalize;margin-bottom:8px">${_e(v)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:.8rem">
      ${Object.entries(ms).slice(0,4).map(([k,m])=>`<div><span style="color:#6b7280">${_e(k.replace(/_/g,' '))}: </span><span style="font-weight:600">${+m.median.toFixed(2)}</span> <span style="color:#9ca3af">(n=${m.sample_count})</span></div>`).join('')}
    </div>
  </div>`).join('')}
</div>`;
}

/* ─────────────────────────────────────────────────────────────────────────
   T90 — Media Mix Modeler
   ─────────────────────────────────────────────────────────────────────── */
window.buildMmm = function(){
  const el = document.getElementById('view-mmm');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>🎛️ Media Mix Modeler</h2><p class="view-sub">Model the optimal budget split across channels before spending a dollar — simulates diminishing returns, saturation curves, and cross-channel lift.</p></div>
<div class="ig-card" style="max-width:800px;margin-bottom:24px">
  <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
    <div class="form-group"><label>Scenario Name</label><input id="mmm-name" class="form-control" value="Q3 Media Mix" /></div>
    <div class="form-group"><label>Total Budget</label><input id="mmm-budget" class="form-control" type="number" value="50000" /></div>
    <div class="form-group"><label>Timeframe (weeks)</label><input id="mmm-weeks" class="form-control" type="number" value="12" /></div>
    <div class="form-group"><label>Industry</label><input id="mmm-ind" class="form-control" value="e-commerce" /></div>
    <div class="form-group" style="grid-column:1/-1"><label>Target Audience</label><input id="mmm-audience" class="form-control" placeholder="e.g. 25-45 year olds, UK, interested in fitness" /></div>
  </div>
  <div style="margin-bottom:16px">
    <div style="font-weight:600;font-size:.85rem;margin-bottom:8px">Current Channel Allocations (optional — leave blank for AI to recommend from scratch)</div>
    <div id="mmm-channels" style="display:flex;flex-direction:column;gap:6px"></div>
    <button class="btn btn-sm btn-outline" style="margin-top:8px" onclick="window._mmmAddChannel()">+ Add Channel</button>
  </div>
  <button id="mmm-run" class="btn btn-primary" style="width:100%">🎛️ Model Optimal Mix</button>
</div>
<div id="mmm-result"></div>
<div id="mmm-history"></div>`;

  const CHANNELS = ['Google Search','Meta Ads','TikTok','LinkedIn','Email','SEO/Content','YouTube','Pinterest','Programmatic Display','Radio/Podcast','Other'];
  window._mmmAddChannel = function(){
    const wrap = document.getElementById('mmm-channels'); if(!wrap) return;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:8px;align-items:center';
    div.innerHTML = `<select class="form-control mmm-ch-name" style="flex:2">${CHANNELS.map(c=>`<option>${_e(c)}</option>`).join('')}</select><input class="form-control mmm-ch-budget" type="number" style="flex:1" placeholder="$0" /><button class="btn btn-xs btn-outline" onclick="this.parentElement.remove()">✕</button>`;
    wrap.appendChild(div);
  };
  window._mmmAddChannel();
  window._mmmAddChannel();

  document.getElementById('mmm-run').onclick = async function(){
    const current_channels = [];
    document.querySelectorAll('#mmm-channels > div').forEach(row=>{
      const name = row.querySelector('.mmm-ch-name')?.value;
      const budget = +row.querySelector('.mmm-ch-budget')?.value||0;
      if(name) current_channels.push({ channel:name, budget });
    });
    this.disabled=true; this.textContent='Modelling mix…';
    const d = await _api('POST','/api/mmm/model',{
      scenario_name: document.getElementById('mmm-name')?.value||'Scenario',
      total_budget: +document.getElementById('mmm-budget')?.value||50000,
      timeframe_weeks: +document.getElementById('mmm-weeks')?.value||12,
      industry: document.getElementById('mmm-ind')?.value||'general',
      target_audience: document.getElementById('mmm-audience')?.value||'',
      current_channels: current_channels.filter(c=>c.budget>0)
    });
    this.disabled=false; this.textContent='🎛️ Model Optimal Mix';
    if(!d.ok) return alert(d.error||'Error');
    _renderMMMResult(d);
    _loadMMMHistory();
  };
  _loadMMMHistory();
};

function _renderMMMResult(d){
  const el = document.getElementById('mmm-result'); if(!el) return;
  const r = d.results||{};
  const alloc = r.recommended_allocation||[];
  const total = alloc.reduce((s,c)=>s+c.budget,0)||1;
  const roas_cols = {linear:'#3b82f6','log':'#10b981','s-curve':'#8b5cf6'};
  el.innerHTML = `
<div class="ig-card" style="margin-bottom:16px">
  <div style="font-size:1rem;font-weight:600;margin-bottom:8px">Recommended Media Mix</div>
  <p style="color:#374151;margin-bottom:16px">${_e(r.summary||'')}</p>
  <div style="background:#f0fdf4;border-radius:8px;padding:12px;margin-bottom:16px">
    <span style="font-weight:600;color:#10b981">⚡ Top recommendation: </span>${_e(r.top_recommendation||'')}
  </div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.85rem">
    <thead><tr style="background:#f9fafb">${['Channel','Budget','%','Response Curve','Exp. Revenue','Exp. Conv.','Rationale'].map(h=>`<th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;white-space:nowrap">${h}</th>`).join('')}</tr></thead>
    <tbody>${alloc.map(c=>{
      const pct = Math.round(c.budget/total*100);
      return `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:8px 12px;font-weight:600">${_e(c.channel)}</td>
        <td style="padding:8px 12px">$${(c.budget||0).toLocaleString()}</td>
        <td style="padding:8px 12px">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:60px;height:6px;background:#f3f4f6;border-radius:3px"><div style="width:${pct}%;height:100%;background:#3b82f6;border-radius:3px"></div></div>
            ${pct}%
          </div>
        </td>
        <td style="padding:8px 12px"><span style="background:${roas_cols[c.roas_curve]||'#6b7280'}20;color:${roas_cols[c.roas_curve]||'#6b7280'};border-radius:4px;padding:2px 6px;font-size:.75rem;font-weight:600">${_e(c.roas_curve||'')}</span></td>
        <td style="padding:8px 12px;color:#10b981;font-weight:600">$${(c.expected_revenue||0).toLocaleString()}</td>
        <td style="padding:8px 12px">${(c.expected_conversions||0).toLocaleString()}</td>
        <td style="padding:8px 12px;font-size:.8rem;color:#374151;max-width:200px">${_e(c.rationale||'')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:16px">
  ${[['conservative','Conservative 🛡️','#6b7280'],['base','Base Case 📊','#3b82f6'],['aggressive','Aggressive 🚀','#10b981']].map(([k,label,col])=>{
    const s=r.scenarios?.[k]||{};
    return `<div class="ig-card" style="border-top:3px solid ${col}">
      <div style="font-weight:600;margin-bottom:8px">${label}</div>
      <div style="font-size:1.4rem;font-weight:800;color:${col}">$${(s.total_revenue||0).toLocaleString()}</div>
      <div style="font-size:.8rem;color:#6b7280">ROAS: ${s.roas||0}x</div>
      <div style="font-size:.8rem;color:#374151;margin-top:6px">${_e(s.allocation_note||'')}</div>
    </div>`;
  }).join('')}
  <div class="ig-card" style="border-top:3px solid #f59e0b">
    <div style="font-weight:600;margin-bottom:8px">vs Current 📈</div>
    <div style="font-size:1.1rem;font-weight:700;color:#f59e0b">+${r.current_vs_recommended?.uplift_pct||0}%</div>
    <div style="font-size:.8rem;color:#6b7280">ROAS uplift</div>
    <div style="font-size:.8rem;color:#374151;margin-top:6px">+$${(r.current_vs_recommended?.incremental_revenue||0).toLocaleString()} incremental</div>
  </div>
</div>
${r.budget_to_shift?.length?`<div class="ig-card">
  <div style="font-weight:600;margin-bottom:12px">💸 Budget Shifts to Make</div>
  <div style="display:flex;flex-direction:column;gap:8px">${r.budget_to_shift.map(s=>`
    <div style="display:flex;align-items:center;gap:12px;padding:10px;background:#fef3c7;border-radius:8px">
      <div style="flex:1"><span style="font-weight:600">${_e(s.from)}</span> → <span style="font-weight:600">${_e(s.to)}</span></div>
      <div style="font-weight:700;color:#f59e0b">$${(s.amount||0).toLocaleString()}</div>
      <div style="font-size:.8rem;color:#374151;flex:2">${_e(s.why||'')}</div>
    </div>`).join('')}
  </div>
</div>`:''}
${r.channel_insights?.length?`<div class="ig-card" style="margin-top:16px">
  <div style="font-weight:600;margin-bottom:12px">Channel Health</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
    ${r.channel_insights.map(c=>{
      const col=c.saturation_level==='over'?'#ef4444':c.saturation_level==='under'?'#3b82f6':'#10b981';
      return `<div style="background:#f9fafb;border-radius:8px;padding:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;font-size:.85rem">${_e(c.channel)}</span>
          <span style="font-size:.7rem;font-weight:700;padding:2px 6px;border-radius:4px;background:${col}20;color:${col}">${_e(c.saturation_level)}</span>
        </div>
        <div style="font-size:.8rem;color:#374151">${_e(c.key_insight)}</div>
      </div>`;
    }).join('')}
  </div>
</div>`:''}`;
}

async function _loadMMMHistory(){
  const d = await _api('GET','/api/mmm/history');
  const el = document.getElementById('mmm-history'); if(!el||!d.ok||!d.models?.length) return;
  el.innerHTML = `<h3 style="font-size:.9rem;font-weight:600;color:#6b7280;margin:16px 0 8px">Saved Models</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.models.map(m=>`
  <div class="ig-card" style="padding:12px;cursor:pointer" onclick='_renderMMMResult({results:${JSON.stringify(m.results)}})'>
    <div style="display:flex;justify-content:space-between">
      <span style="font-weight:600">${_e(m.scenario_name)}</span>
      <span style="color:#6b7280;font-size:.8rem">${new Date(m.created_at).toLocaleDateString()}</span>
    </div>
    <div style="font-size:.85rem;color:#10b981;margin-top:2px">ROAS uplift: +${m.results?.current_vs_recommended?.uplift_pct||0}%</div>
  </div>`).join('')}</div>`;
}
window._renderMMMResult = _renderMMMResult;

/* ─────────────────────────────────────────────────────────────────────────
   T91 — Brand Safety & Compliance Engine
   ─────────────────────────────────────────────────────────────────────── */
window.buildBrandSafety = function(){
  const el = document.getElementById('view-brand-safety');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>🔒 Brand Safety &amp; Compliance</h2><p class="view-sub">Audit ad copy and landing pages against FTC, GDPR, FCA, ESMA, HIPAA, and ASA rules before you publish.</p></div>
<div class="ig-card" style="max-width:760px;margin-bottom:24px">
  <div class="form-grid" style="grid-template-columns:1fr 1fr">
    <div class="form-group"><label>Check Type</label><select id="bs-type" class="form-control">
      <option value="ad_copy">Ad Copy</option>
      <option value="landing_page">Landing Page Copy</option>
      <option value="email">Email Body</option>
      <option value="social_post">Social Post</option>
      <option value="disclaimer">Disclaimer Text</option>
    </select></div>
    <div class="form-group"><label>Vertical / Industry</label><select id="bs-vert" class="form-control">
      <option value="general">General</option><option value="finance">Finance / FinTech</option>
      <option value="health">Health &amp; Wellness</option><option value="crypto">Crypto / Web3</option>
      <option value="forex">Forex / CFDs</option><option value="e-commerce">E-Commerce</option>
      <option value="saas">SaaS</option><option value="education">Education</option>
    </select></div>
  </div>
  <div class="form-group"><label>Jurisdictions to check (select multiple)</label>
    <div id="bs-jurisdictions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
      ${[['ftc','FTC (US)'],['gdpr','GDPR (EU)'],['fca','FCA (UK Finance)'],['esma','ESMA (EU Finance)'],['hipaa','HIPAA (US Health)'],['asa','ASA (UK General)']].map(([k,l])=>`
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:.85rem">
          <input type="checkbox" class="bs-jur" value="${k}" ${k==='ftc'?'checked':''} />${l}
        </label>`).join('')}
    </div>
  </div>
  <div class="form-group"><label>Content to Audit</label>
    <textarea id="bs-content" class="form-control" rows="6" placeholder="Paste your ad copy, landing page text, email body, or social post here…"></textarea>
  </div>
  <button id="bs-check" class="btn btn-primary" style="width:100%">🔒 Run Compliance Audit</button>
</div>
<div id="bs-result"></div>
<div id="bs-history"></div>`;

  document.getElementById('bs-check').onclick = async function(){
    const content = document.getElementById('bs-content')?.value.trim();
    if(!content) return alert('Paste some content to audit.');
    const jurs = [...document.querySelectorAll('.bs-jur:checked')].map(c=>c.value);
    if(!jurs.length) return alert('Select at least one jurisdiction.');
    this.disabled=true; this.textContent='Auditing…';
    const d = await _api('POST','/api/brand-safety/check',{
      check_type: document.getElementById('bs-type')?.value||'ad_copy',
      content, vertical: document.getElementById('bs-vert')?.value||'general', jurisdictions: jurs
    });
    this.disabled=false; this.textContent='🔒 Run Compliance Audit';
    if(!d.ok) return alert(d.error||'Error');
    _renderBSResult(d);
    _loadBSHistory();
  };
  _loadBSHistory();
};

function _renderBSResult(d){
  const el = document.getElementById('bs-result'); if(!el) return;
  const r = d.results||{};
  const score = r.risk_score||0;
  const verdictCol = {pass:'#10b981',caution:'#f59e0b',fail:'#ef4444'}[r.overall_verdict]||'#6b7280';
  const sevCol = {info:'#3b82f6',warning:'#f59e0b',critical:'#ef4444'};
  el.innerHTML = `
<div class="ig-card" style="border-left:4px solid ${verdictCol};margin-bottom:16px">
  <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:conic-gradient(${_riskCol(score)} ${_pct(score,100)}%,#e5e7eb 0);font-size:1rem;font-weight:800;color:${_riskCol(score)}">${score}</div>
    <div>
      <div style="font-size:.75rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Risk Score · ${_e(r.overall_verdict||'')}</div>
      <div style="font-size:1.1rem;font-weight:700">Compliance Audit Result</div>
      <div style="margin-top:4px">${_verdictBadge(r.overall_verdict)}</div>
    </div>
  </div>
  <p style="color:#374151;margin-bottom:16px">${_e(r.summary||'')}</p>

  ${r.flags?.length?`<div style="margin-bottom:16px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:8px">FLAGS (${r.flags.length})</div>
    <div style="display:flex;flex-direction:column;gap:8px">${r.flags.map(f=>`
      <div style="padding:10px;border-radius:8px;border-left:3px solid ${sevCol[f.severity]||'#6b7280'};background:#f9fafb">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:4px">
          <span style="font-weight:600;font-size:.85rem">${_e(f.rule||'')}</span>
          <span style="background:${sevCol[f.severity]||'#6b7280'};color:#fff;border-radius:4px;padding:1px 6px;font-size:.7rem;font-weight:700">${_e(f.severity||'').toUpperCase()}</span>
        </div>
        ${f.quote?`<div style="font-size:.8rem;background:#fee2e2;border-radius:4px;padding:4px 8px;color:#991b1b;margin-bottom:4px">"${_e(f.quote)}"</div>`:''}
        <div style="font-size:.85rem;color:#374151;margin-bottom:4px">${_e(f.issue||'')}</div>
        <div style="font-size:.85rem;color:#10b981"><strong>Fix:</strong> ${_e(f.fix||'')}</div>
      </div>`).join('')}
    </div>
  </div>`:''}

  ${r.compliant_points?.length?`<div style="margin-bottom:16px">
    <div style="font-size:.75rem;font-weight:600;color:#10b981;margin-bottom:6px">✅ COMPLIANT POINTS</div>
    <ul style="margin:0;padding-left:20px;font-size:.85rem;color:#374151">${r.compliant_points.map(p=>`<li>${_e(p)}</li>`).join('')}</ul>
  </div>`:''}

  ${r.required_disclaimers?.length?`<div style="background:#eff6ff;border-radius:8px;padding:12px;margin-bottom:12px">
    <div style="font-size:.75rem;font-weight:600;color:#3b82f6;margin-bottom:6px">📋 REQUIRED DISCLAIMERS</div>
    <ul style="margin:0;padding-left:16px;font-size:.85rem;color:#374151">${r.required_disclaimers.map(d2=>`<li>${_e(d2)}</li>`).join('')}</ul>
  </div>`:''}

  ${r.rewritten_version&&r.rewritten_version!==d.results?.content_snippet?`<div style="margin-top:12px">
    <div style="font-size:.75rem;font-weight:600;color:#8b5cf6;margin-bottom:6px">✏️ COMPLIANT REWRITE</div>
    <div style="background:#faf5ff;border-radius:8px;padding:12px;font-size:.85rem;color:#374151;white-space:pre-wrap">${_e(r.rewritten_version)}</div>
    <button class="btn btn-sm btn-outline" style="margin-top:6px" onclick="navigator.clipboard.writeText(${JSON.stringify(r.rewritten_version||'')})">Copy rewrite</button>
  </div>`:''}
</div>`;
}

async function _loadBSHistory(){
  const d = await _api('GET','/api/brand-safety/history');
  const el = document.getElementById('bs-history'); if(!el||!d.ok||!d.checks?.length) return;
  el.innerHTML = `<h3 style="font-size:.9rem;font-weight:600;color:#6b7280;margin:16px 0 8px">Recent Audits</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.checks.map(c=>{
  const col={pass:'#10b981',caution:'#f59e0b',fail:'#ef4444'}[c.overall_verdict]||'#6b7280';
  return `<div class="ig-card" style="padding:12px;border-left:3px solid ${col}">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:600">${_e(c.check_type?.replace(/_/g,' '))} · ${_e(c.vertical)}</span>
      <span style="color:#6b7280;font-size:.8rem">${new Date(c.created_at).toLocaleDateString()}</span>
    </div>
    <div style="font-size:.8rem;color:#6b7280;margin-top:2px">${(c.jurisdictions||[]).join(', ')}</div>
    <div style="margin-top:4px;display:flex;gap:8px;align-items:center">${_verdictBadge(c.overall_verdict)}<span style="font-size:.8rem">Risk: ${c.risk_score}</span></div>
    <div style="font-size:.8rem;color:#374151;margin-top:4px">${_e((c.content_snippet||'').slice(0,80))}…</div>
  </div>`;
}).join('')}</div>`;
}

/* ─────────────────────────────────────────────────────────────────────────
   T92 — Safe Autonomous Agent
   ─────────────────────────────────────────────────────────────────────── */
window.buildSafeAgent = function(){
  const el = document.getElementById('view-safe-agent');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>🛡️ Safe Agent</h2><p class="view-sub">AI proposes an action plan, simulates outcomes, then waits for your approval before executing — with a full audit log and one-click rollback.</p></div>
<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
  <div class="ig-card" style="flex:1;min-width:300px">
    <h3 style="font-weight:600;margin-bottom:16px">New Proposal</h3>
    <div class="form-group"><label>Objective</label><textarea id="sa-obj" class="form-control" rows="3" placeholder="e.g. Improve ROAS from 1.8x to 2.5x across all paid channels while keeping CAC below $300"></textarea></div>
    <div class="form-group"><label>Business Context (optional)</label><textarea id="sa-ctx" class="form-control" rows="2" placeholder="Monthly budget: $40k&#10;Main channels: Google, Meta&#10;Current ROAS: 1.8x"></textarea></div>
    <div class="form-group"><label>Budget Guardrail (max spend this agent may propose, $)</label><input id="sa-guardrail" class="form-control" type="number" placeholder="e.g. 5000" /></div>
    <button id="sa-propose" class="btn btn-primary" style="width:100%">🛡️ Propose Action Plan</button>
  </div>
  <div id="sa-proposals-list" style="flex:2;min-width:300px"></div>
</div>
<div id="sa-proposal-detail"></div>`;

  document.getElementById('sa-propose').onclick = async function(){
    const obj = document.getElementById('sa-obj')?.value.trim();
    if(!obj) return alert('Enter an objective.');
    const ctx = {};
    (document.getElementById('sa-ctx')?.value||'').split('\n').forEach(line=>{ const [k,...vs]=line.split(':'); if(k&&vs.length) ctx[k.trim()]=vs.join(':').trim(); });
    this.disabled=true; this.textContent='AI is proposing & simulating…';
    const d = await _api('POST','/api/safe-agent/propose',{ objective:obj, context:ctx, budget_guardrail: +document.getElementById('sa-guardrail')?.value||null });
    this.disabled=false; this.textContent='🛡️ Propose Action Plan';
    if(!d.ok) return alert(d.error||'Error');
    _renderSAProposal(d);
    _loadSAProposals();
  };
  _loadSAProposals();
};

function _renderSAProposal(d){
  const el = document.getElementById('sa-proposal-detail'); if(!el) return;
  const p = d.proposal||{};
  const sim = d.simulation||{};
  const id = d.id;
  const statusBadge = _verdictBadge(d.status||'pending_approval');
  const recCol={approve:'#10b981',review:'#f59e0b',reject:'#ef4444'}[p._recommendation]||'#6b7280';
  el.innerHTML = `
<div class="ig-card" style="border-top:3px solid ${recCol};margin-bottom:16px">
  <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
    <div>
      <div style="font-size:1rem;font-weight:700">${_e(p._title||d.title||'Proposal')}</div>
      <div style="margin-top:4px;display:flex;gap:8px">${statusBadge}<span style="background:${recCol}20;color:${recCol};border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:700">AI: ${_e(p._recommendation||'')}</span></div>
    </div>
    ${id?`<div style="display:flex;gap:8px">
      <button class="btn btn-primary" onclick="window._saApprove(${id})">✅ Approve & Execute</button>
      <button class="btn btn-outline" style="color:#ef4444" onclick="window._saReject(${id})">✕ Reject</button>
    </div>`:''}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div>
      <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:8px">ACTION PLAN</div>
      <div style="display:flex;flex-direction:column;gap:6px">${(p.actions||[]).map(a=>`
        <div style="padding:8px;background:#f9fafb;border-radius:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-weight:600;font-size:.82rem">Step ${a.step}: ${_e(a.action||'')}</span>
            <span style="font-size:.75rem;color:#6b7280">${a.reversible?'↩ reversible':'⚠ irreversible'}</span>
          </div>
          <div style="font-size:.8rem;color:#374151">${_e(a.detail||'')}</div>
          ${a.channel?`<div style="font-size:.75rem;color:#6b7280;margin-top:2px">Channel: ${_e(a.channel)} ${a.estimated_cost?'· Cost: $'+a.estimated_cost:''}</div>`:''}
        </div>`).join('')}
      </div>
      <div style="margin-top:8px;font-size:.8rem"><span style="color:#6b7280">Total est. cost: </span><strong>$${(p.total_estimated_cost||0).toLocaleString()}</strong> · Timeline: ${_e(p.timeline||'')}</div>
    </div>
    <div>
      <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:8px">SIMULATION</div>
      <div style="background:#f9fafb;border-radius:8px;padding:12px">
        <div style="font-weight:600;margin-bottom:6px">${_e(sim.expected_outcome||'')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.8rem;margin-bottom:8px">
          <div><span style="color:#6b7280">Confidence: </span><strong>${sim.confidence||0}%</strong></div>
          <div><span style="color:#6b7280">Rev. impact: </span><strong style="color:#10b981">+$${(sim.estimated_revenue_impact||0).toLocaleString()}</strong></div>
          <div><span style="color:#6b7280">Best: </span><span style="color:#10b981">${_e(sim.best_case||'')}</span></div>
          <div><span style="color:#6b7280">Worst: </span><span style="color:#ef4444">${_e(sim.worst_case||'')}</span></div>
        </div>
        ${sim.risk_factors?.length?`<div style="font-size:.75rem;color:#f59e0b;margin-top:4px">⚠ ${sim.risk_factors.join(' · ')}</div>`:''}
      </div>
    </div>
  </div>

  ${p._safety_checks?.length?`<div style="margin-bottom:12px">
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:6px">SAFETY CHECKS</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${p._safety_checks.map(s=>{
      const col=s.status==='pass'?'#10b981':s.status==='warn'?'#f59e0b':'#ef4444';
      return `<div style="background:${col}15;border:1px solid ${col}40;border-radius:6px;padding:4px 10px;font-size:.8rem;display:flex;align-items:center;gap:6px">
        <span style="color:${col};font-weight:700">${s.status==='pass'?'✓':s.status==='warn'?'⚠':'✗'}</span>
        <span>${_e(s.check)}</span>
        ${s.note?`<span style="color:#6b7280">${_e(s.note)}</span>`:''}
      </div>`;
    }).join('')}</div>
  </div>`:''}

  ${p.rollback_plan?`<div style="background:#faf5ff;border-radius:8px;padding:10px"><span style="font-weight:600;color:#8b5cf6">↩ Rollback plan: </span>${_e(p.rollback_plan)}</div>`:''}
  ${p._recommendation_reason?`<div style="margin-top:8px;font-size:.85rem;color:#374151"><strong>AI says:</strong> ${_e(p._recommendation_reason)}</div>`:''}
</div>`;
}

window._saApprove = async function(id){
  if(!confirm('Approve this proposal for execution?')) return;
  const d = await _api('POST',`/api/safe-agent/approve/${id}`);
  if(!d.ok) return alert(d.error||'Error');
  alert('✅ Approved and executed. Check the audit log for details.');
  _loadSAProposals();
};
window._saReject = async function(id){
  const reason = prompt('Reason for rejection (optional):');
  const d = await _api('POST',`/api/safe-agent/reject/${id}`,{ reason });
  if(!d.ok) return alert(d.error||'Error');
  _loadSAProposals();
};
window._saRollback = async function(id){
  const reason = prompt('Why are you rolling back? (optional):');
  const d = await _api('POST',`/api/safe-agent/rollback/${id}`,{ reason });
  if(!d.ok) return alert(d.error||'Error');
  alert('↩ Rolled back successfully.');
  _loadSAProposals();
};
window._renderSAProposal = _renderSAProposal;

async function _loadSAProposals(){
  const d = await _api('GET','/api/safe-agent/proposals');
  const el = document.getElementById('sa-proposals-list'); if(!el) return;
  if(!d.ok||!d.proposals?.length){ el.innerHTML='<div class="ig-card" style="padding:24px;text-align:center;color:#6b7280">No proposals yet — create one to get started.</div>'; return; }
  const statusIcon={pending_approval:'⏳',executing:'⚙️',executed:'✅',rejected:'✕',rolled_back:'↩'};
  el.innerHTML = `<h3 style="font-weight:600;margin-bottom:8px">Proposal Log</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.proposals.map(p=>`
  <div class="ig-card" style="padding:12px;cursor:pointer" onclick='_renderSAProposal({id:${p.id},title:${JSON.stringify(p.title)},status:${JSON.stringify(p.status)},proposal:${JSON.stringify(p.proposal)},simulation:${JSON.stringify(p.simulation)}})'>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:600">${statusIcon[p.status]||'•'} ${_e(p.title)}</span>
      <span style="color:#6b7280;font-size:.8rem">${new Date(p.created_at).toLocaleDateString()}</span>
    </div>
    <div style="margin-top:4px;display:flex;gap:8px;align-items:center">
      ${_verdictBadge(p.status)}
      ${p.budget_guardrail?`<span style="font-size:.75rem;color:#6b7280">Guardrail: $${(+p.budget_guardrail).toLocaleString()}</span>`:''}
    </div>
    ${p.status==='executed'?`<button class="btn btn-xs btn-outline" style="margin-top:6px;color:#ef4444" onclick="event.stopPropagation();window._saRollback(${p.id})">↩ Rollback</button>`:''}
  </div>`).join('')}</div>`;
}

/* ─────────────────────────────────────────────────────────────────────────
   T93 — Data Provenance Layer
   ─────────────────────────────────────────────────────────────────────── */
window.buildDataProvenance = function(){
  const el = document.getElementById('view-data-provenance');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>🔍 Data Provenance</h2><p class="view-sub">Every insight carries a source, freshness timestamp, and a real-vs-AI indicator. The marketing platform you can audit.</p></div>
<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
  <input id="dp-search" class="form-control" style="max-width:220px" placeholder="Search insights…" />
  <select id="dp-source" class="form-control" style="max-width:160px">
    <option value="">All sources</option>
    <option value="api">Live API</option>
    <option value="scrape">Web scrape</option>
    <option value="ai_generated">AI generated</option>
    <option value="user_input">User input</option>
    <option value="database">Database</option>
    <option value="third_party">Third party</option>
  </select>
  <select id="dp-ai" class="form-control" style="max-width:160px">
    <option value="">All types</option>
    <option value="false">Real data only</option>
    <option value="true">AI estimated only</option>
  </select>
  <button class="btn btn-outline" onclick="window._dpLoad()">🔍 Filter</button>
  <button class="btn btn-sm btn-outline" onclick="window._dpLogDemo()">+ Log demo insight</button>
</div>
<div id="dp-summary" style="margin-bottom:16px"></div>
<div id="dp-table"></div>`;

  window._dpLoad = async function(){
    const search = document.getElementById('dp-search')?.value||'';
    const source = document.getElementById('dp-source')?.value||'';
    const is_ai = document.getElementById('dp-ai')?.value||'';
    const d = await _api('GET',`/api/data-provenance/insights?search=${encodeURIComponent(search)}&source_type=${encodeURIComponent(source)}&is_ai=${encodeURIComponent(is_ai)}`);
    if(!d.ok) return;
    _renderDPSummary(d.summary||{});
    _renderDPTable(d.insights||[]);
  };

  window._dpLogDemo = async function(){
    await _api('POST','/api/data-provenance/bulk-log',{ records:[
      { insight_key:'competitor_cpa', insight_label:'Competitor CPA Estimate', source_type:'ai_generated', source_name:'GPT-4o', is_ai_estimated:true, ai_model:'gpt-4o', freshness_hours:24 },
      { insight_key:'organic_traffic', insight_label:'Monthly Organic Traffic', source_type:'api', source_name:'DataForSEO', source_url:'https://dataforseo.com', is_ai_estimated:false, freshness_hours:72 },
      { insight_key:'ad_ctr', insight_label:'Ad Click-Through Rate', source_type:'third_party', source_name:'Meta Ads API', is_ai_estimated:false, freshness_hours:1 },
      { insight_key:'revenue_forecast', insight_label:'90-Day Revenue Forecast', source_type:'ai_generated', source_name:'InfoGenie MMM', is_ai_estimated:true, ai_model:'gpt-4o', freshness_hours:168 },
    ]});
    window._dpLoad();
  };

  window._dpLoad();
};

function _renderDPSummary(s){
  const el = document.getElementById('dp-summary'); if(!el) return;
  const total = s.total||0;
  const ai = s.ai_estimated||0;
  const real = s.real_data||0;
  const aiPct = total ? Math.round(ai/total*100) : 0;
  el.innerHTML = `
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:8px">
  <div class="ig-card" style="padding:12px;text-align:center">
    <div style="font-size:1.5rem;font-weight:800">${total}</div>
    <div style="font-size:.75rem;color:#6b7280">Total insights tracked</div>
  </div>
  <div class="ig-card" style="padding:12px;text-align:center;border-top:3px solid #10b981">
    <div style="font-size:1.5rem;font-weight:800;color:#10b981">${real}</div>
    <div style="font-size:.75rem;color:#6b7280">Real data points</div>
  </div>
  <div class="ig-card" style="padding:12px;text-align:center;border-top:3px solid #f59e0b">
    <div style="font-size:1.5rem;font-weight:800;color:#f59e0b">${ai}</div>
    <div style="font-size:.75rem;color:#6b7280">AI-estimated points</div>
  </div>
  <div class="ig-card" style="padding:12px;text-align:center">
    <div style="width:48px;height:48px;border-radius:50%;background:conic-gradient(#f59e0b ${aiPct}%,#10b981 0);margin:0 auto 4px;display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700">${aiPct}%</div>
    <div style="font-size:.75rem;color:#6b7280">AI-estimated ratio</div>
  </div>
  ${Object.keys(s.sources||{}).length?`<div class="ig-card" style="padding:12px">
    <div style="font-size:.7rem;font-weight:600;color:#6b7280;margin-bottom:6px">BY SOURCE TYPE</div>
    ${Object.entries(s.sources).map(([k,v])=>`<div style="display:flex;justify-content:space-between;font-size:.8rem;margin:2px 0"><span>${_e(k)}</span><span style="font-weight:600">${v}</span></div>`).join('')}
  </div>`:''
  }
</div>`;
}

function _renderDPTable(insights){
  const el = document.getElementById('dp-table'); if(!el) return;
  if(!insights.length){ el.innerHTML='<div class="ig-card" style="padding:32px;text-align:center;color:#6b7280">No provenance records yet — insights tracked by InfoGenie will appear here automatically.</div>'; return; }
  el.innerHTML = `<div class="ig-card"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.83rem">
    <thead><tr style="background:#f9fafb">${['Insight','Source','Type','Freshness','AI?','Model','Fetched'].map(h=>`<th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;white-space:nowrap">${h}</th>`).join('')}</tr></thead>
    <tbody>${insights.map(r=>{
      const fresh = r.freshness_hours;
      const freshLabel = fresh==null?'—':fresh<2?'< 2h':fresh<24?`${fresh}h`:`${Math.round(fresh/24)}d`;
      const freshCol = fresh==null?'#9ca3af':fresh<=24?'#10b981':fresh<=168?'#f59e0b':'#ef4444';
      return `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:8px 12px"><div style="font-weight:600">${_e(r.insight_label||r.insight_key)}</div><div style="font-size:.75rem;color:#9ca3af">${_e(r.insight_key)}</div></td>
        <td style="padding:8px 12px">${r.source_url?`<a href="${_e(r.source_url)}" target="_blank" style="color:#3b82f6">${_e(r.source_name||r.source_type)}</a>`:`<span>${_e(r.source_name||r.source_type)}</span>`}</td>
        <td style="padding:8px 12px"><span style="background:#f3f4f6;border-radius:4px;padding:2px 8px;font-size:.75rem">${_e(r.source_type||'')}</span></td>
        <td style="padding:8px 12px;color:${freshCol};font-weight:600">${freshLabel}</td>
        <td style="padding:8px 12px;text-align:center">${r.is_ai_estimated?'<span title="AI estimated" style="color:#f59e0b;font-size:1rem">🤖</span>':'<span title="Real data" style="color:#10b981;font-size:1rem">✓</span>'}</td>
        <td style="padding:8px 12px;font-size:.75rem;color:#6b7280">${_e(r.ai_model||'—')}</td>
        <td style="padding:8px 12px;color:#6b7280;font-size:.75rem;white-space:nowrap">${new Date(r.fetched_at||r.created_at).toLocaleDateString()}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div></div>`;
}

/* ─────────────────────────────────────────────────────────────────────────
   T94 — Vertical Playbooks
   ─────────────────────────────────────────────────────────────────────── */
window.buildVerticalPlaybooks = function(){
  const el = document.getElementById('view-vertical-playbooks');
  if(!el) return;
  el.innerHTML = `
<div class="view-header"><h2>📋 Vertical Playbooks</h2><p class="view-sub">Pre-built, benchmarked 90-day growth playbooks for your industry — channels, templates, and compliance baked in. Activate one and follow the phases.</p></div>
<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
  <div id="vp-list" style="flex:2;min-width:300px"></div>
  <div style="flex:1;min-width:260px">
    <div class="ig-card">
      <h3 style="font-weight:600;margin-bottom:12px">🤖 Generate Custom Playbook</h3>
      <div class="form-group"><label>Industry</label><input id="vp-ind" class="form-control" placeholder="e.g. EdTech, Fintech, Pets" /></div>
      <div class="form-group"><label>Describe your business</label><textarea id="vp-desc" class="form-control" rows="2" placeholder="B2B SaaS for HR teams, 30 paying customers…"></textarea></div>
      <div class="form-group"><label>Monthly Budget</label><input id="vp-budget" class="form-control" type="number" placeholder="5000" /></div>
      <button id="vp-gen" class="btn btn-outline" style="width:100%">⚡ AI Generate Playbook</button>
    </div>
    <div id="vp-active" style="margin-top:16px"></div>
  </div>
</div>
<div id="vp-detail"></div>`;

  document.getElementById('vp-gen').onclick = async function(){
    const ind = document.getElementById('vp-ind')?.value.trim();
    if(!ind) return alert('Enter your industry.');
    this.disabled=true; this.textContent='Generating…';
    const d = await _api('POST','/api/playbooks/generate-custom',{
      industry:ind, business_description:document.getElementById('vp-desc')?.value||'', budget:+document.getElementById('vp-budget')?.value||0
    });
    this.disabled=false; this.textContent='⚡ AI Generate Playbook';
    if(!d.ok) return alert(d.error||'Error');
    _renderVPDetail(d.playbook);
    _loadVPActive();
  };

  _loadVPList();
  _loadVPActive();
};

async function _loadVPList(){
  const d = await _api('GET','/api/playbooks/list');
  const el = document.getElementById('vp-list'); if(!el||!d.ok) return;
  const pbs = d.playbooks||[];
  if(!pbs.length){ el.innerHTML='<div class="ig-card" style="padding:20px;text-align:center;color:#6b7280">Loading playbooks…</div>'; return; }
  el.innerHTML = `<h3 style="font-weight:600;margin-bottom:12px">Industry Playbooks</h3>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">
  ${pbs.map(pb=>{
    const c = pb.content||{};
    return `<div class="ig-card" style="cursor:pointer;transition:box-shadow .15s" onclick="window._loadVPDetail(${pb.id})" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,.1)'" onmouseout="this.style.boxShadow=''">
      <div style="font-size:2rem;margin-bottom:6px">${_e(c.icon||'📋')}</div>
      <div style="font-weight:700;margin-bottom:4px">${_e(pb.title)}</div>
      <div style="font-size:.82rem;color:#6b7280;margin-bottom:10px">${_e(pb.description||'')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${(c.tags||[]).map(t=>`<span style="background:#eff6ff;color:#3b82f6;border-radius:4px;padding:2px 6px;font-size:.7rem">${_e(t)}</span>`).join('')}</div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:.75rem;color:#6b7280">${(c.phases||[]).length} phases · ${(c.channels||[]).length} channels</span>
        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();window._activateVP(${pb.id})">Activate</button>
      </div>
    </div>`;
  }).join('')}
</div>`;
}

window._loadVPDetail = async function(id){
  const d = await _api('GET',`/api/playbooks/${id}`);
  if(!d.ok) return;
  _renderVPDetail(d.playbook?.content||{}, d.playbook?.id);
};

function _renderVPDetail(c, id){
  const el = document.getElementById('vp-detail'); if(!el) return;
  el.scrollIntoView({ behavior:'smooth', block:'start' });
  el.innerHTML = `
<div class="ig-card" style="margin-bottom:16px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px">
    <div>
      <div style="font-size:1.4rem;font-weight:800">${_e(c.icon||'📋')} ${_e(c.title||'')}</div>
      <p style="color:#374151;margin:4px 0">${_e(c.description||'')}</p>
    </div>
    ${id?`<button class="btn btn-primary" onclick="window._activateVP(${id})">▶ Activate Playbook</button>`:''}
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:20px">
    ${Object.entries(c.benchmarks||{}).slice(0,6).map(([k,v])=>`<div style="background:#f9fafb;border-radius:8px;padding:10px;text-align:center">
      <div style="font-size:.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">${_e(k.replace(/_/g,' '))}</div>
      <div style="font-size:1.1rem;font-weight:700;color:#3b82f6">${v}</div>
      <div style="font-size:.7rem;color:#9ca3af">benchmark target</div>
    </div>`).join('')}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
    <div><div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:6px">CHANNELS</div><div style="display:flex;flex-wrap:wrap;gap:6px">${(c.channels||[]).map(ch=>`<span style="background:#f0fdf4;color:#065f46;border-radius:4px;padding:3px 10px;font-size:.82rem;font-weight:600">${_e(ch)}</span>`).join('')}</div></div>
    <div><div style="font-size:.75rem;font-weight:600;color:#ef4444;margin-bottom:6px">COMPLIANCE</div><ul style="margin:0;padding-left:16px;font-size:.82rem;color:#374151">${(c.compliance||[]).map(cc=>`<li>${_e(cc)}</li>`).join('')}</ul></div>
  </div>

  <div>
    <div style="font-size:.75rem;font-weight:600;color:#6b7280;margin-bottom:12px">90-DAY ROADMAP</div>
    <div style="display:flex;flex-direction:column;gap:12px">${(c.phases||[]).map((ph,i)=>{
      const cols=['#3b82f6','#8b5cf6','#10b981'];
      const col=cols[i%cols.length];
      return `<div style="display:flex;gap:12px;align-items:flex-start">
        <div style="min-width:72px;background:${col};color:#fff;border-radius:6px;padding:4px 8px;text-align:center;font-size:.75rem;font-weight:700;line-height:1.3">${_e(ph.week||`Phase ${i+1}`)}</div>
        <div style="flex:1;background:#f9fafb;border-radius:8px;padding:12px">
          <div style="font-weight:600;margin-bottom:6px;color:${col}">${_e(ph.title||'')}</div>
          <ul style="margin:0;padding-left:16px;font-size:.85rem;color:#374151">${(ph.tasks||[]).map(t=>`<li>${_e(t)}</li>`).join('')}</ul>
        </div>
      </div>`;
    }).join('')}</div>
  </div>
</div>`;
}

window._activateVP = async function(id){
  const d = await _api('POST',`/api/playbooks/activate/${id}`);
  if(!d.ok) return alert(d.error||'Error');
  alert('✅ Playbook activated! Track your progress below.');
  _loadVPActive();
};

async function _loadVPActive(){
  const d = await _api('GET','/api/playbooks/active/list');
  const el = document.getElementById('vp-active'); if(!el||!d.ok||!d.active?.length) return;
  el.innerHTML = `<h3 style="font-weight:600;margin-bottom:8px">Active Playbooks</h3>
<div style="display:flex;flex-direction:column;gap:8px">${d.active.map(a=>`
  <div class="ig-card" style="padding:12px;cursor:pointer" onclick="window._renderVPDetail(${JSON.stringify(a.content||{})},${a.playbook_id})">
    <div style="font-weight:600">${_e(a.content?.icon||'📋')} ${_e(a.title||'')}</div>
    <div style="font-size:.75rem;color:#6b7280;margin-top:2px">Activated: ${new Date(a.activated_at).toLocaleDateString()}</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${(a.content?.tags||[]).map(t=>`<span style="background:#eff6ff;color:#3b82f6;border-radius:4px;padding:1px 6px;font-size:.7rem">${_e(t)}</span>`).join('')}</div>
  </div>`).join('')}</div>`;
}
window._renderVPDetail = _renderVPDetail;

/* ─────────────────────────────────────────────────────────────────────────
   Register view builders
   ─────────────────────────────────────────────────────────────────────── */
(function _registerMoatViews(){
  const MAP = {
    'benchmarks':          window.buildBenchmarks,
    'mmm':                 window.buildMmm,
    'brand-safety':        window.buildBrandSafety,
    'safe-agent':          window.buildSafeAgent,
    'data-provenance':     window.buildDataProvenance,
    'vertical-playbooks':  window.buildVerticalPlaybooks,
  };
  const _origNav = window.navigateTo;
  if (typeof _origNav === 'function') {
    window.navigateTo = function(view) {
      _origNav(view);
      if (MAP[view]) { try { MAP[view](); } catch(e) { console.warn('[ig_moat_features] build error:', view, e); } }
    };
  }
  document.addEventListener('DOMContentLoaded', function(){
    const hash = (location.hash||'').replace('#','');
    if (MAP[hash]) { try { MAP[hash](); } catch(e){} }
  });
})();

})();
