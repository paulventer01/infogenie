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

