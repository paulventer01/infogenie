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
