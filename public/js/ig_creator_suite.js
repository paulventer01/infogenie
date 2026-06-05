/* =====================================================================
   InfoGenie — Creator Suite  (T60-T64)
   T60: AI Persona Studio
   T61: iROAS Incrementality Module
   T62: AI Marketing Agent (Goal Loops)
   T63: E-commerce Product Video
   T64: Brand Deal Pipeline
   ===================================================================== */

/* ── shared utils ── */
function _csEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _csPost(url, body) { return fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(r=>r.json()); }
function _csPut(url, body)  { return fetch(url, { method:'PUT',  headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(r=>r.json()); }
function _csDelete(url)     { return fetch(url, { method:'DELETE' }).then(r=>r.json()); }
function _csGet(url)        { return fetch(url).then(r=>r.json()); }
function _csStatus(el, msg, type='info') {
  if (!el) return;
  el.innerHTML = `<div class="ig-alert ig-alert-${type}" style="margin:8px 0;">${_csEsc(msg)}</div>`;
}
function _csSpinner() { return `<div style="text-align:center;padding:32px"><span class="ig-spinner"></span></div>`; }
function _csFormatDate(s) { if (!s) return '—'; try { return new Date(s).toLocaleDateString(); } catch(_) { return s; } }
function _csFormatMoney(v, cur='USD') { if (!v && v!==0) return '—'; return new Intl.NumberFormat('en-US',{style:'currency',currency:cur,maximumFractionDigits:0}).format(v); }

/* ─────────────────────────────────────────────────────────────────────
   T60 · AI PERSONA STUDIO
   ───────────────────────────────────────────────────────────────────── */
window.buildPersonaStudio = function() {
  const wrap = document.getElementById('personaStudioWrap');
  if (!wrap) return;
  wrap.innerHTML = _csSpinner();
  _csGet('/api/personas').then(data => {
    const personas = data.personas || [];
    wrap.innerHTML = `
<div class="ig-toolbar" style="margin-bottom:16px;">
  <button class="btn btn-primary" onclick="window._personaCreate()">✨ New Persona</button>
</div>
${personas.length === 0 ? `<div class="ig-empty-state"><div class="ies-icon">🎭</div><h3>No AI Personas yet</h3><p>Create your first virtual influencer persona — define their niche, personality, appearance, and content voice.</p></div>` : `
<div class="ig-card-grid">
  ${personas.map(p => _csPersonaCard(p)).join('')}
</div>`}
<div id="personaModalWrap"></div>`;
  }).catch(() => { wrap.innerHTML = `<div class="ig-alert ig-alert-error">Failed to load personas.</div>`; });
};

function _csPersonaCard(p) {
  return `<div class="ig-card" style="position:relative;">
  <div style="display:flex;align-items:flex-start;gap:16px;">
    ${p.avatar_url ? `<img src="${_csEsc(p.avatar_url)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;flex-shrink:0;" alt="${_csEsc(p.name)}">` : `<div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;">🎭</div>`}
    <div style="flex:1;min-width:0;">
      <h3 style="margin:0 0 4px;font-size:1.1rem;">${_csEsc(p.name)}</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <span class="ig-badge">${_csEsc(p.niche)}</span>
        <span class="ig-badge ig-badge-outline">${_csEsc(p.age_range)} · ${_csEsc(p.gender)}</span>
        ${p.is_active ? `<span class="ig-badge ig-badge-green">Active</span>` : `<span class="ig-badge ig-badge-muted">Inactive</span>`}
      </div>
      ${p.personality ? `<p style="margin:0 0 4px;font-size:0.85rem;color:var(--text-muted);">🧠 ${_csEsc(p.personality)}</p>` : ''}
      ${p.content_voice ? `<p style="margin:0;font-size:0.85rem;color:var(--text-muted);">🎙️ ${_csEsc(p.content_voice)}</p>` : ''}
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
    <button class="btn btn-sm btn-outline" onclick="window._personaGenAvatar(${p.id})">📸 Generate Avatar</button>
    <button class="btn btn-sm btn-outline" onclick="window._personaGenContent(${p.id})">✍️ Generate Content</button>
    <button class="btn btn-sm btn-outline" onclick="window._personaEdit(${p.id})">✏️ Edit</button>
    <button class="btn btn-sm btn-danger-outline" onclick="window._personaDelete(${p.id},'${_csEsc(p.name)}')">🗑️</button>
  </div>
  ${(p.sample_content||[]).length > 0 ? `
  <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
    <div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;">LATEST CONTENT</div>
    <div style="font-size:0.85rem;background:var(--bg-subtle,#f8f9fa);padding:10px;border-radius:8px;">
      ${_csEsc((p.sample_content[p.sample_content.length-1]||{}).caption||'')}
    </div>
  </div>` : ''}
</div>`;
}

window._personaCreate = function() {
  const mw = document.getElementById('personaModalWrap');
  if (!mw) return;
  mw.innerHTML = `
<div class="ig-modal-overlay" onclick="if(event.target===this)this.remove()">
<div class="ig-modal" style="max-width:680px;">
  <div class="ig-modal-header"><h3>✨ Create AI Persona</h3><button class="ig-modal-close" onclick="this.closest('.ig-modal-overlay').remove()">×</button></div>
  <div class="ig-modal-body">
    <div style="margin-bottom:16px;">
      <label style="font-weight:600;display:block;margin-bottom:6px;">Let AI build it for you</label>
      <div style="display:flex;gap:8px;">
        <input id="pAiNiche" class="ig-input" placeholder="Niche (e.g. fitness, beauty, travel)" style="flex:1;">
        <input id="pAiAudience" class="ig-input" placeholder="Target audience" style="flex:1;">
        <button class="btn btn-secondary" onclick="window._personaAiBuild()">🤖 AI Build</button>
      </div>
      <div id="pAiBuildStatus"></div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:16px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div><label class="ig-label">Persona Name *</label><input id="pName" class="ig-input" placeholder="e.g. Aria Chen"></div>
        <div><label class="ig-label">Niche *</label><input id="pNiche" class="ig-input" placeholder="e.g. sustainable fashion"></div>
        <div><label class="ig-label">Age Range</label><input id="pAge" class="ig-input" placeholder="e.g. 24-28" value="24-28"></div>
        <div><label class="ig-label">Gender</label>
          <select id="pGender" class="ig-select"><option value="female">Female</option><option value="male">Male</option><option value="non-binary">Non-binary</option></select>
        </div>
      </div>
      <div style="margin-bottom:12px;"><label class="ig-label">Appearance Prompt (for image generation)</label>
        <textarea id="pAppearance" class="ig-textarea" rows="2" placeholder="e.g. Petite East Asian woman, long dark hair, minimalist aesthetic, warm smile..."></textarea></div>
      <div style="margin-bottom:12px;"><label class="ig-label">Personality</label>
        <input id="pPersonality" class="ig-input" placeholder="e.g. confident, witty, relatable, eco-conscious"></div>
      <div style="margin-bottom:12px;"><label class="ig-label">Content Voice</label>
        <input id="pVoice" class="ig-input" placeholder="e.g. casual but inspiring, never preachy, uses humour"></div>
      <div><label class="ig-label">Posting Style</label>
        <input id="pStyle" class="ig-input" placeholder="e.g. daily outfit + weekly brand deals + monthly deep dive"></div>
    </div>
  </div>
  <div class="ig-modal-footer">
    <div id="pCreateStatus"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
      <button class="btn btn-outline" onclick="this.closest('.ig-modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="window._personaSave()">Create Persona</button>
    </div>
  </div>
</div></div>`;
};

window._personaAiBuild = function() {
  const niche = (document.getElementById('pAiNiche')||{}).value;
  const audience = (document.getElementById('pAiAudience')||{}).value;
  const statusEl = document.getElementById('pAiBuildStatus');
  _csStatus(statusEl, 'Building persona with AI…', 'info');
  _csPost('/api/personas/ai-build', { niche, target_audience: audience }).then(data => {
    const s = data.suggestion || {};
    if (s.name) { document.getElementById('pName').value = s.name || ''; document.getElementById('pNiche').value = s.niche || niche || ''; document.getElementById('pAge').value = s.age_range || ''; if(s.gender){document.getElementById('pGender').value=s.gender;} document.getElementById('pAppearance').value = s.appearance_prompt || ''; document.getElementById('pPersonality').value = s.personality || ''; document.getElementById('pVoice').value = s.content_voice || ''; document.getElementById('pStyle').value = s.posting_style || ''; _csStatus(statusEl, '✓ Persona built — review and save below.', 'success'); } else { _csStatus(statusEl, 'AI build failed — fill in manually.', 'warning'); }
  }).catch(() => _csStatus(statusEl, 'Error building persona.', 'error'));
};

window._personaSave = function(editId) {
  const body = { name: (document.getElementById('pName')||{}).value, niche: (document.getElementById('pNiche')||{}).value, age_range: (document.getElementById('pAge')||{}).value, gender: (document.getElementById('pGender')||{}).value, appearance_prompt: (document.getElementById('pAppearance')||{}).value, personality: (document.getElementById('pPersonality')||{}).value, content_voice: (document.getElementById('pVoice')||{}).value, posting_style: (document.getElementById('pStyle')||{}).value };
  const statusEl = document.getElementById('pCreateStatus');
  _csStatus(statusEl, 'Saving…', 'info');
  const p = editId ? _csPut(`/api/personas/${editId}`, body) : _csPost('/api/personas', body);
  p.then(data => { if (data.error) { _csStatus(statusEl, data.error, 'error'); return; } document.querySelector('.ig-modal-overlay')?.remove(); window.buildPersonaStudio(); }).catch(() => _csStatus(statusEl, 'Save failed.', 'error'));
};

window._personaEdit = function(id) {
  _csGet(`/api/personas/${id}`).then(data => {
    const p = data.persona || {};
    window._personaCreate();
    setTimeout(() => {
      ['pName','pNiche','pAge','pGender','pAppearance','pPersonality','pVoice','pStyle'].forEach((elId,i) => {
        const el = document.getElementById(elId);
        if (el) el.value = [p.name,p.niche,p.age_range,p.gender,p.appearance_prompt,p.personality,p.content_voice,p.posting_style][i] || '';
      });
      const saveBtn = document.querySelector('.ig-modal-footer .btn-primary');
      if (saveBtn) { saveBtn.textContent = 'Save Changes'; saveBtn.onclick = () => window._personaSave(id); }
    }, 50);
  });
};

window._personaDelete = function(id, name) {
  if (!confirm(`Delete persona "${name}"?`)) return;
  _csDelete(`/api/personas/${id}`).then(() => window.buildPersonaStudio());
};

window._personaGenAvatar = function(id) {
  const btn = event.target;
  btn.disabled = true; btn.textContent = '⏳ Generating…';
  _csPost(`/api/personas/${id}/generate-avatar`, {}).then(data => {
    btn.disabled = false; btn.textContent = '📸 Generate Avatar';
    if (data.error) { alert('Avatar error: ' + data.error); return; }
    window.buildPersonaStudio();
  }).catch(() => { btn.disabled = false; btn.textContent = '📸 Generate Avatar'; alert('Avatar generation failed.'); });
};

window._personaGenContent = function(id) {
  const mw = document.getElementById('personaModalWrap');
  if (!mw) return;
  mw.innerHTML = `
<div class="ig-modal-overlay" onclick="if(event.target===this)this.remove()">
<div class="ig-modal" style="max-width:580px;">
  <div class="ig-modal-header"><h3>✍️ Generate Content</h3><button class="ig-modal-close" onclick="this.closest('.ig-modal-overlay').remove()">×</button></div>
  <div class="ig-modal-body">
    <div style="margin-bottom:12px;"><label class="ig-label">Content Type</label>
      <select id="cgType" class="ig-select">
        <option value="instagram_caption">Instagram Caption</option>
        <option value="tiktok_caption">TikTok Caption</option>
        <option value="twitter_thread">Twitter/X Thread</option>
        <option value="youtube_description">YouTube Description</option>
        <option value="linkedin_post">LinkedIn Post</option>
      </select></div>
    <div><label class="ig-label">Product to feature (optional)</label><input id="cgProduct" class="ig-input" placeholder="e.g. LUMI Vitamin C Serum"></div>
    <div id="cgResult" style="margin-top:16px;"></div>
  </div>
  <div class="ig-modal-footer">
    <button class="btn btn-primary" onclick="window._personaDoGenContent(${id})">✨ Generate</button>
  </div>
</div></div>`;
};

window._personaDoGenContent = function(id) {
  const type = (document.getElementById('cgType')||{}).value;
  const product = (document.getElementById('cgProduct')||{}).value;
  const resultEl = document.getElementById('cgResult');
  resultEl.innerHTML = _csSpinner();
  // AI-generated content — gate the section
  const cgHeader = document.querySelector('.ig-modal-header h3');
  if (window._applySectionDataMode && cgHeader && resultEl) window._applySectionDataMode(cgHeader, resultEl, true, 'AI estimate');
  _csPost(`/api/personas/${id}/generate-content`, { content_type: type, product }).then(data => {
    const c = data.content || {};
    resultEl.innerHTML = `
<div style="background:var(--bg-subtle,#f8f9fa);border-radius:10px;padding:16px;">
  <div style="font-size:0.9rem;line-height:1.7;white-space:pre-wrap;">${_csEsc(c.caption||'')}</div>
  ${(c.hashtags||[]).length ? `<div style="margin-top:10px;color:var(--ig-primary,#667eea);font-size:0.85rem;">${c.hashtags.map(h=>_csEsc(h)).join(' ')}</div>` : ''}
  ${c.cta ? `<div style="margin-top:8px;font-weight:600;font-size:0.85rem;">CTA: ${_csEsc(c.cta)}</div>` : ''}
  <button class="btn btn-sm btn-outline" style="margin-top:10px;" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent||'');this.textContent='✓ Copied!'">📋 Copy</button>
</div>`;
  }).catch(() => { resultEl.innerHTML = `<div class="ig-alert ig-alert-error">Generation failed.</div>`; });
};

/* ─────────────────────────────────────────────────────────────────────
   T61 · iROAS INCREMENTALITY MODULE
   ───────────────────────────────────────────────────────────────────── */
window.buildIroas = function() {
  const wrap = document.getElementById('iroasWrap');
  if (!wrap) return;
  wrap.innerHTML = _csSpinner();
  _csGet('/api/iroas/tests').then(data => {
    const tests = data.tests || [];
    const active = tests.filter(t => t.status === 'active');
    const completed = tests.filter(t => t.status !== 'active');
    wrap.innerHTML = `
<div class="ig-two-col" style="gap:24px;">
  <div style="flex:1;min-width:0;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h3 style="margin:0;">Holdout Tests</h3>
      <button class="btn btn-primary btn-sm" onclick="window._iroasNewTest()">+ New Test</button>
    </div>
    ${tests.length === 0 ? `<div class="ig-empty-state"><div class="ies-icon">🧪</div><h3>No holdout tests yet</h3><p>Create your first incrementality test to measure true ad lift — not just reported ROAS.</p></div>` : tests.map(_iroasTestCard).join('')}
  </div>
  <div style="width:320px;flex-shrink:0;">
    <div class="ig-card" style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px;">📊 Budget Saturation</h4>
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px;">See where each channel hits diminishing returns and where extra spend stops paying off.</p>
      <div style="margin-bottom:8px;"><label class="ig-label">Monthly Budget ($)</label><input id="satBudget" class="ig-input" type="number" placeholder="10000"></div>
      <div style="margin-bottom:8px;"><label class="ig-label">Industry</label><input id="satIndustry" class="ig-input" placeholder="e.g. e-commerce"></div>
      <button class="btn btn-secondary btn-sm" onclick="window._iroasSaturation()" style="width:100%;">📈 Analyse Saturation</button>
    </div>
    <div id="satResult"></div>
  </div>
</div>
<div id="iroasModalWrap"></div>`;
  }).catch(() => { wrap.innerHTML = `<div class="ig-alert ig-alert-error">Failed to load tests.</div>`; });
};

function _iroasTestCard(t) {
  const c = t.computed || {};
  const hasData = c.iroas !== null && c.iroas !== undefined;
  const verdict = hasData ? (c.iroas >= 2 ? 'positive' : c.iroas >= 1 ? 'neutral' : 'negative') : 'pending';
  const verdictColor = { positive: '#22c55e', neutral: '#f59e0b', negative: '#ef4444', pending: '#94a3b8' }[verdict];
  return `<div class="ig-card" style="margin-bottom:12px;border-left:3px solid ${verdictColor};">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
    <div><div style="font-weight:600;">${_csEsc(t.name)}</div>
    <div style="font-size:0.8rem;color:var(--text-muted);">${_csEsc(t.channel)} · ${t.holdout_pct}% holdout · ${_csEsc(t.campaign_name||'No campaign')}</div></div>
    <span class="ig-badge" style="background:${verdictColor}20;color:${verdictColor};">${verdict}</span>
  </div>
  ${hasData ? `
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
    <div style="text-align:center;padding:8px;background:var(--bg-subtle,#f8f9fa);border-radius:8px;"><div style="font-size:1.1rem;font-weight:700;">${c.iroas}x</div><div style="font-size:0.7rem;color:var(--text-muted);">iROAS</div></div>
    <div style="text-align:center;padding:8px;background:var(--bg-subtle,#f8f9fa);border-radius:8px;"><div style="font-size:1.1rem;font-weight:700;">${c.reported_roas||'—'}x</div><div style="font-size:0.7rem;color:var(--text-muted);">Reported ROAS</div></div>
    <div style="text-align:center;padding:8px;background:var(--bg-subtle,#f8f9fa);border-radius:8px;"><div style="font-size:1.1rem;font-weight:700;">${c.lift_pct !== null ? c.lift_pct+'%' : '—'}</div><div style="font-size:0.7rem;color:var(--text-muted);">Lift</div></div>
  </div>
  <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;">
    Incremental revenue: <strong>${_csFormatMoney(c.incremental_revenue)}</strong> from <strong>${c.incremental_conversions||0}</strong> incremental conversions
    ${c.iroas_vs_reported !== null ? ` · <span style="color:${c.iroas_vs_reported < 0 ? '#ef4444' : '#22c55e'}">${c.iroas_vs_reported > 0 ? '+' : ''}${c.iroas_vs_reported}% vs reported</span>` : ''}
  </div>` : `<div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px;">Enter test results to calculate iROAS.</div>`}
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-sm btn-outline" onclick="window._iroasEdit(${t.id})">✏️ Update Results</button>
    ${hasData ? `<button class="btn btn-sm btn-outline" onclick="window._iroasInterpret(${t.id})">🤖 AI Interpret</button>` : ''}
    <button class="btn btn-sm btn-danger-outline" onclick="window._iroasDelete(${t.id})">🗑️</button>
  </div>
</div>`;
}

window._iroasNewTest = function() {
  const mw = document.getElementById('iroasModalWrap');
  if (!mw) return;
  mw.innerHTML = `
<div class="ig-modal-overlay" onclick="if(event.target===this)this.remove()">
<div class="ig-modal" style="max-width:620px;">
  <div class="ig-modal-header"><h3>🧪 New Holdout Test</h3><button class="ig-modal-close" onclick="this.closest('.ig-modal-overlay').remove()">×</button></div>
  <div class="ig-modal-body">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="ig-label">Test Name *</label><input id="itName" class="ig-input" placeholder="Q3 Meta Holdout"></div>
      <div><label class="ig-label">Campaign Name</label><input id="itCampaign" class="ig-input" placeholder="Summer Sale Campaign"></div>
      <div><label class="ig-label">Channel</label>
        <select id="itChannel" class="ig-select"><option value="meta">Meta (FB/IG)</option><option value="google">Google Ads</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="email">Email</option><option value="other">Other</option></select></div>
      <div><label class="ig-label">Holdout % (control group)</label><input id="itHoldout" class="ig-input" type="number" value="10" min="1" max="50"></div>
      <div><label class="ig-label">Start Date</label><input id="itStart" class="ig-input" type="date"></div>
      <div><label class="ig-label">End Date</label><input id="itEnd" class="ig-input" type="date"></div>
    </div>
    <div style="margin-top:12px;"><label class="ig-label">Notes</label><textarea id="itNotes" class="ig-textarea" rows="2" placeholder="e.g. Running alongside Black Friday campaign"></textarea></div>
  </div>
  <div class="ig-modal-footer">
    <div id="itStatus"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
      <button class="btn btn-outline" onclick="this.closest('.ig-modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="window._iroasSaveTest()">Create Test</button>
    </div>
  </div>
</div></div>`;
};

window._iroasSaveTest = function(editId) {
  const body = { name: (document.getElementById('itName')||{}).value, campaign_name: (document.getElementById('itCampaign')||{}).value, channel: (document.getElementById('itChannel')||{}).value, holdout_pct: parseInt((document.getElementById('itHoldout')||{}).value)||10, start_date: (document.getElementById('itStart')||{}).value||null, end_date: (document.getElementById('itEnd')||{}).value||null, notes: (document.getElementById('itNotes')||{}).value };
  const statusEl = document.getElementById('itStatus');
  _csStatus(statusEl, 'Saving…', 'info');
  const p = editId ? _csPut(`/api/iroas/tests/${editId}`, body) : _csPost('/api/iroas/tests', body);
  p.then(data => { if (data.error) { _csStatus(statusEl, data.error, 'error'); return; } document.querySelector('.ig-modal-overlay')?.remove(); window.buildIroas(); }).catch(() => _csStatus(statusEl, 'Save failed.', 'error'));
};

window._iroasEdit = function(id) {
  _csGet('/api/iroas/tests').then(data => {
    const t = (data.tests||[]).find(x=>x.id===id)||{};
    const mw = document.getElementById('iroasModalWrap');
    if (!mw) return;
    mw.innerHTML = `
<div class="ig-modal-overlay" onclick="if(event.target===this)this.remove()">
<div class="ig-modal" style="max-width:680px;">
  <div class="ig-modal-header"><h3>✏️ Update Test Results — ${_csEsc(t.name||'')}</h3><button class="ig-modal-close" onclick="this.closest('.ig-modal-overlay').remove()">×</button></div>
  <div class="ig-modal-body">
    <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:16px;">Enter the raw numbers from your test. iROAS will be calculated automatically.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="ig-label">Test Group Reach</label><input id="itTestReach" class="ig-input" type="number" value="${t.test_reach||0}" placeholder="People shown ads"></div>
      <div><label class="ig-label">Control Group Reach</label><input id="itCtrlReach" class="ig-input" type="number" value="${t.control_reach||0}" placeholder="Holdout group size"></div>
      <div><label class="ig-label">Test Conversions</label><input id="itTestConv" class="ig-input" type="number" value="${t.test_conversions||0}"></div>
      <div><label class="ig-label">Control Conversions</label><input id="itCtrlConv" class="ig-input" type="number" value="${t.control_conversions||0}"></div>
      <div><label class="ig-label">Ad Spend ($)</label><input id="itSpend" class="ig-input" type="number" value="${t.test_spend||0}"></div>
      <div><label class="ig-label">Reported Revenue ($)</label><input id="itRevenue" class="ig-input" type="number" value="${t.reported_revenue||0}"></div>
      <div><label class="ig-label">Avg Order Value ($)</label><input id="itAov" class="ig-input" type="number" value="${t.avg_order_value||0}" placeholder="0 = auto-calculate"></div>
      <div><label class="ig-label">Status</label>
        <select id="itEditStatus" class="ig-select"><option value="active" ${t.status==='active'?'selected':''}>Active</option><option value="completed" ${t.status==='completed'?'selected':''}>Completed</option><option value="paused" ${t.status==='paused'?'selected':''}>Paused</option></select></div>
    </div>
  </div>
  <div class="ig-modal-footer">
    <div id="itStatus"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
      <button class="btn btn-outline" onclick="this.closest('.ig-modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="window._iroasSaveResults(${id})">Save Results</button>
    </div>
  </div>
</div></div>`;
  });
};

window._iroasSaveResults = function(id) {
  const body = { test_reach: parseInt((document.getElementById('itTestReach')||{}).value)||0, control_reach: parseInt((document.getElementById('itCtrlReach')||{}).value)||0, test_conversions: parseInt((document.getElementById('itTestConv')||{}).value)||0, control_conversions: parseInt((document.getElementById('itCtrlConv')||{}).value)||0, test_spend: parseFloat((document.getElementById('itSpend')||{}).value)||0, reported_revenue: parseFloat((document.getElementById('itRevenue')||{}).value)||0, avg_order_value: parseFloat((document.getElementById('itAov')||{}).value)||0, status: (document.getElementById('itEditStatus')||{}).value };
  _csPut(`/api/iroas/tests/${id}`, body).then(data => { if (data.error) { alert(data.error); return; } document.querySelector('.ig-modal-overlay')?.remove(); window.buildIroas(); });
};

window._iroasInterpret = function(id) {
  const resultDiv = document.getElementById('satResult');
  if (resultDiv) resultDiv.innerHTML = _csSpinner();
  _csPost(`/api/iroas/tests/${id}/interpret`, {}).then(data => {
    const interp = data.interpretation || {};
    const verdictColor = { positive: '#22c55e', neutral: '#f59e0b', negative: '#ef4444' }[interp.verdict] || '#94a3b8';
    const mw = document.getElementById('iroasModalWrap');
    if (!mw) return;
    mw.innerHTML = `
<div class="ig-modal-overlay" onclick="if(event.target===this)this.remove()">
<div class="ig-modal" style="max-width:600px;">
  <div class="ig-modal-header"><h3>🤖 AI Interpretation</h3><button class="ig-modal-close" onclick="this.closest('.ig-modal-overlay').remove()">×</button></div>
  <div class="ig-modal-body">
    <div style="background:${verdictColor}15;border:1px solid ${verdictColor}40;border-radius:10px;padding:16px;margin-bottom:16px;">
      <div style="font-size:1.05rem;font-weight:700;color:${verdictColor};margin-bottom:8px;">${_csEsc(interp.headline||'')}</div>
      <div style="font-size:0.9rem;line-height:1.6;">${_csEsc(interp.analysis||'')}</div>
    </div>
    ${(interp.actions||[]).length ? `<div><div style="font-weight:600;margin-bottom:10px;">Recommended Actions</div>${interp.actions.map(a=>`<div style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;"><span style="color:var(--ig-primary,#667eea);">→</span><div style="font-size:0.88rem;">${_csEsc(a)}</div></div>`).join('')}</div>` : ''}
  </div>
</div></div>`;
  }).catch(() => { if (resultDiv) resultDiv.innerHTML = ''; alert('Interpretation failed.'); });
};

window._iroasDelete = function(id) {
  if (!confirm('Delete this test?')) return;
  _csDelete(`/api/iroas/tests/${id}`).then(() => window.buildIroas());
};

window._iroasSaturation = function() {
  const budget = (document.getElementById('satBudget')||{}).value;
  const industry = (document.getElementById('satIndustry')||{}).value;
  const resultEl = document.getElementById('satResult');
  if (!resultEl) return;
  resultEl.innerHTML = _csSpinner();
  _csPost('/api/iroas/saturation', { channels: ['meta','google','tiktok'], monthly_budget: parseFloat(budget)||10000, industry: industry||'e-commerce' }).then(data => {
    const curves = data.curves || [];
    // Saturation curves are AI-estimated — gate the section
    const satHeader = document.querySelector('#iroasWrap h3');
    if (window._applySectionDataMode && satHeader && resultEl) window._applySectionDataMode(satHeader, resultEl, true, 'AI estimate');
    resultEl.innerHTML = `
<div class="ig-card">
  <h4 style="margin:0 0 12px;">📉 Saturation Curves</h4>
  ${curves.map(c => `
  <div style="margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <span style="font-weight:600;text-transform:capitalize;">${_csEsc(c.channel)}</span>
      <span class="ig-badge">Saturation: ${_csFormatMoney(c.saturation_point)}</span>
    </div>
    <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:6px;">
      <div style="height:100%;background:var(--ig-primary,#667eea);width:${Math.min(100,(parseFloat(budget)||10000)/c.saturation_point*100)}%;border-radius:2px;"></div>
    </div>
    <div style="font-size:0.78rem;color:var(--text-muted);">${_csEsc(c.insight||'')}</div>
  </div>`).join('')}
  ${data.recommendation ? `<div style="padding-top:12px;border-top:1px solid var(--border);font-size:0.85rem;"><strong>Recommendation:</strong> ${_csEsc(data.recommendation)}</div>` : ''}
</div>`;
  }).catch(() => { resultEl.innerHTML = `<div class="ig-alert ig-alert-error">Analysis failed.</div>`; });
};

/* ─────────────────────────────────────────────────────────────────────
   T62 · AI MARKETING AGENT (GOAL LOOPS)
   ───────────────────────────────────────────────────────────────────── */
window.buildAgentGoals = function() {
  const wrap = document.getElementById('agentGoalsWrap');
  if (!wrap) return;
  wrap.innerHTML = _csSpinner();
  _csGet('/api/agent-goals').then(data => {
    const goals = data.goals || [];
    const active = goals.filter(g => g.status === 'active');
    const archived = goals.filter(g => g.status !== 'active');
    wrap.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
  <div><h3 style="margin:0;">Active Goals <span style="font-size:0.85rem;color:var(--text-muted);font-weight:400;">(${active.length})</span></h3></div>
  <button class="btn btn-primary" onclick="window._agentNewGoal()">🎯 Set New Goal</button>
</div>
${active.length === 0 ? `<div class="ig-empty-state"><div class="ies-icon">🤖</div><h3>No active goals</h3><p>Set a marketing goal and the AI agent will build an execution plan, break it into tasks, and evaluate your progress.</p></div>` : active.map(_agentGoalCard).join('')}
${archived.length > 0 ? `<div style="margin-top:24px;"><h4 style="color:var(--text-muted);">Archived</h4>${archived.map(_agentGoalCard).join('')}</div>` : ''}
<div id="agentModalWrap"></div>`;
  }).catch(() => { wrap.innerHTML = `<div class="ig-alert ig-alert-error">Failed to load goals.</div>`; });
};

function _agentGoalCard(g) {
  const tasks = g.tasks || [];
  const done = tasks.filter(t => t.status === 'done').length;
  const evaluation = g.last_evaluation || {};
  const gradeColor = { A:'#22c55e', B:'#84cc16', C:'#f59e0b', D:'#f97316', F:'#ef4444' }[evaluation.grade] || '#94a3b8';
  return `<div class="ig-card" style="margin-bottom:16px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
    <div style="flex:1;min-width:0;">
      <h3 style="margin:0 0 4px;font-size:1.05rem;">${_csEsc(g.title)}</h3>
      ${g.description ? `<p style="margin:0;font-size:0.85rem;color:var(--text-muted);">${_csEsc(g.description)}</p>` : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-left:16px;">
      ${evaluation.grade ? `<div style="width:36px;height:36px;border-radius:50%;background:${gradeColor};color:#fff;font-weight:700;font-size:1rem;display:flex;align-items:center;justify-content:center;">${evaluation.grade}</div>` : ''}
      <span class="ig-badge ${g.status==='active'?'ig-badge-green':'ig-badge-muted'}">${g.status}</span>
    </div>
  </div>
  <div style="margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;"><span>Progress</span><span>${g.progress_pct}% (${done}/${tasks.length} tasks)</span></div>
    <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;"><div style="height:100%;background:var(--ig-primary,#667eea);width:${g.progress_pct}%;border-radius:3px;transition:width 0.5s;"></div></div>
  </div>
  ${tasks.length > 0 ? `
  <div style="margin-bottom:12px;">
    ${tasks.slice(0,5).map(t => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
      <input type="checkbox" ${t.status==='done'?'checked':''} onchange="window._agentToggleTask(${t.id},this.checked?'done':'pending')" style="cursor:pointer;">
      <span style="flex:1;font-size:0.85rem;${t.status==='done'?'text-decoration:line-through;color:var(--text-muted);':''}"><span class="ig-badge ig-badge-xs" style="margin-right:4px;">${_csEsc(t.action_type||'')}</span>${_csEsc(t.title)}</span>
      ${t.due_date?`<span style="font-size:0.75rem;color:var(--text-muted);">${_csFormatDate(t.due_date)}</span>`:''}
    </div>`).join('')}
    ${tasks.length > 5 ? `<div style="font-size:0.8rem;color:var(--text-muted);padding-top:6px;">+${tasks.length-5} more tasks</div>` : ''}
  </div>` : ''}
  ${evaluation.assessment ? `<div style="background:var(--bg-subtle,#f8f9fa);border-radius:8px;padding:10px;font-size:0.83rem;margin-bottom:12px;"><strong>Last evaluation:</strong> ${_csEsc(evaluation.assessment)}</div>` : ''}
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-sm btn-primary" onclick="window._agentEvaluate(${g.id})">🤖 Evaluate Progress</button>
    <button class="btn btn-sm btn-outline" onclick="window._agentAddTask(${g.id})">+ Add Task</button>
    ${g.status==='active'?`<button class="btn btn-sm btn-outline" onclick="window._agentArchive(${g.id})">Archive</button>`:''}
    <button class="btn btn-sm btn-danger-outline" onclick="window._agentDelete(${g.id})">🗑️</button>
  </div>
</div>`;
}

window._agentNewGoal = function() {
  const mw = document.getElementById('agentModalWrap');
  if (!mw) return;
  mw.innerHTML = `
<div class="ig-modal-overlay" onclick="if(event.target===this)this.remove()">
<div class="ig-modal" style="max-width:620px;">
  <div class="ig-modal-header"><h3>🎯 Set Marketing Goal</h3><button class="ig-modal-close" onclick="this.closest('.ig-modal-overlay').remove()">×</button></div>
  <div class="ig-modal-body">
    <div style="margin-bottom:12px;"><label class="ig-label">Goal Title *</label><input id="agTitle" class="ig-input" placeholder="e.g. Grow Instagram following by 20% in 90 days"></div>
    <div style="margin-bottom:12px;"><label class="ig-label">Description</label><textarea id="agDesc" class="ig-textarea" rows="2" placeholder="What does success look like? More context = better AI plan."></textarea></div>
    <div style="margin-bottom:12px;"><label class="ig-label">Success Criteria (how you'll measure it)</label><textarea id="agCriteria" class="ig-textarea" rows="2" placeholder="e.g. Instagram followers > 12,000, engagement rate > 4%, 3 brand deals closed"></textarea></div>
    <div><label class="ig-label">Deadline</label><input id="agDeadline" class="ig-input" type="date"></div>
  </div>
  <div class="ig-modal-footer">
    <div id="agStatus"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
      <button class="btn btn-outline" onclick="this.closest('.ig-modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="window._agentSaveGoal()">🤖 Set Goal + Generate Plan</button>
    </div>
  </div>
</div></div>`;
};

window._agentSaveGoal = function() {
  const body = { title: (document.getElementById('agTitle')||{}).value, description: (document.getElementById('agDesc')||{}).value, success_criteria: (document.getElementById('agCriteria')||{}).value, deadline: (document.getElementById('agDeadline')||{}).value||null };
  const statusEl = document.getElementById('agStatus');
  _csStatus(statusEl, '🤖 AI is building your execution plan…', 'info');
  _csPost('/api/agent-goals', body).then(data => {
    if (data.error) { _csStatus(statusEl, data.error, 'error'); return; }
    document.querySelector('.ig-modal-overlay')?.remove();
    window.buildAgentGoals();
  }).catch(() => _csStatus(statusEl, 'Failed to create goal.', 'error'));
};

window._agentToggleTask = function(taskId, status) {
  _csPut(`/api/agent-goals/tasks/${taskId}`, { status }).then(() => window.buildAgentGoals());
};

window._agentEvaluate = function(goalId) {
  const btn = event.target;
  btn.disabled = true; btn.textContent = '⏳ Evaluating…';
  _csPost(`/api/agent-goals/${goalId}/evaluate`, {}).then(data => {
    btn.disabled = false; btn.textContent = '🤖 Evaluate Progress';
    if (data.error) { alert(data.error); return; }
    window.buildAgentGoals();
  }).catch(() => { btn.disabled = false; btn.textContent = '🤖 Evaluate Progress'; });
};

window._agentAddTask = function(goalId) {
  const title = prompt('Task title:');
  if (!title) return;
  _csPost(`/api/agent-goals/${goalId}/tasks`, { title }).then(() => window.buildAgentGoals());
};

window._agentArchive = function(goalId) {
  _csPut(`/api/agent-goals/${goalId}`, { status: 'archived' }).then(() => window.buildAgentGoals());
};

window._agentDelete = function(goalId) {
  if (!confirm('Delete this goal and all its tasks?')) return;
  _csDelete(`/api/agent-goals/${goalId}`).then(() => window.buildAgentGoals());
};

/* ─────────────────────────────────────────────────────────────────────
   T63 · E-COMMERCE PRODUCT VIDEO
   ───────────────────────────────────────────────────────────────────── */
window.buildEcomVideo = function() {
  const wrap = document.getElementById('ecomVideoWrap');
  if (!wrap) return;
  _csGet('/api/personas').then(data => {
    const personas = (data.personas || []).filter(p => p.is_active);
    wrap.innerHTML = `
<div class="ig-two-col" style="gap:24px;">
  <div style="flex:1;min-width:0;">
    <div class="ig-card">
      <h3 style="margin:0 0 16px;">🛒 Product Video Brief</h3>
      <div style="margin-bottom:12px;"><label class="ig-label">Product Name *</label><input id="evProduct" class="ig-input" placeholder="e.g. LUMI Vitamin C Serum"></div>
      <div style="margin-bottom:12px;"><label class="ig-label">Product Description</label><textarea id="evDesc" class="ig-textarea" rows="2" placeholder="What it does, key ingredients/features, why it's special"></textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div><label class="ig-label">Target Audience</label><input id="evAudience" class="ig-input" placeholder="e.g. women 25-40, skincare enthusiasts"></div>
        <div><label class="ig-label">Platform</label>
          <select id="evPlatform" class="ig-select"><option value="Instagram Reels / TikTok">Instagram Reels / TikTok</option><option value="YouTube Shorts">YouTube Shorts</option><option value="Facebook Video Ad">Facebook Video Ad</option><option value="Pinterest Video">Pinterest Video</option></select></div>
        <div><label class="ig-label">Video Style</label>
          <select id="evStyle" class="ig-select"><option value="lifestyle + demo hybrid">Lifestyle + Demo</option><option value="ugc-style authentic review">UGC Authentic Review</option><option value="before and after transformation">Before & After</option><option value="unboxing and reveal">Unboxing & Reveal</option><option value="product close-up showcase">Product Showcase</option></select></div>
        ${personas.length > 0 ? `<div><label class="ig-label">AI Persona Presenter</label>
          <select id="evPersona" class="ig-select"><option value="">No persona</option>${personas.map(p=>`<option value="${_csEsc(p.name)}">${_csEsc(p.name)} — ${_csEsc(p.niche)}</option>`).join('')}</select></div>` : ''}
      </div>
      <button class="btn btn-primary" onclick="window._evGenerate()" style="width:100%;">🎬 Generate Video Storyboard</button>
      <div id="evStatus" style="margin-top:8px;"></div>
    </div>
  </div>
  <div style="flex:1;min-width:0;" id="evResult">
    <div class="ig-card" style="background:linear-gradient(135deg,#667eea10,#764ba210);border:2px dashed var(--border);">
      <div style="text-align:center;padding:32px;">
        <div style="font-size:48px;margin-bottom:12px;">🎬</div>
        <h4>Your storyboard will appear here</h4>
        <p style="font-size:0.85rem;color:var(--text-muted);">Fill in the brief and click Generate. You'll get a 6-scene storyboard optimised for conversion — with shot types, voiceovers, text overlays, and a ready-to-use caption.</p>
      </div>
    </div>
  </div>
</div>`;
  }).catch(() => {
    wrap.innerHTML = `<div class="ig-alert ig-alert-error">Failed to load.</div>`;
  });
};

window._evGenerate = function() {
  const statusEl = document.getElementById('evStatus');
  const resultEl = document.getElementById('evResult');
  _csStatus(statusEl, '🎬 Generating storyboard…', 'info');
  if (resultEl) resultEl.innerHTML = _csSpinner();
  const body = {
    product_name: (document.getElementById('evProduct')||{}).value,
    product_description: (document.getElementById('evDesc')||{}).value,
    target_audience: (document.getElementById('evAudience')||{}).value,
    platform: (document.getElementById('evPlatform')||{}).value,
    video_style: (document.getElementById('evStyle')||{}).value,
    persona_name: (document.getElementById('evPersona')||{}).value
  };
  if (!body.product_name) { _csStatus(statusEl, 'Product name is required.', 'error'); if(resultEl) resultEl.innerHTML=''; return; }
  _csPost('/api/ecom-video/generate', body).then(data => {
    if (data.error) { _csStatus(statusEl, data.error, 'error'); if(resultEl) resultEl.innerHTML=''; return; }
    _csStatus(statusEl, '', 'info');
    const s = data.storyboard || {};
    if (!resultEl) return;
    resultEl.innerHTML = `
<div class="ig-card">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
    <div><h3 style="margin:0 0 4px;">${_csEsc(s.title||'Video Storyboard')}</h3>
    <div style="font-size:0.85rem;color:var(--text-muted);">~${s.duration_seconds||30}s · Hook: "${_csEsc(s.hook||'')}"</div></div>
    <span class="ig-badge">${(data.source||'ai').toUpperCase()}</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
    ${(s.scenes||[]).map(sc=>`
    <div style="display:grid;grid-template-columns:28px 80px 1fr 1fr;gap:12px;align-items:start;padding:12px;background:var(--bg-subtle,#f8f9fa);border-radius:8px;">
      <div style="width:28px;height:28px;background:var(--ig-primary,#667eea);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;flex-shrink:0;">${sc.scene}</div>
      <div><div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);">SHOT</div><div style="font-size:0.82rem;">${_csEsc(sc.shot_type||'')}</div><div style="font-size:0.75rem;color:var(--text-muted);">${sc.duration_s||5}s</div></div>
      <div><div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);">ACTION</div><div style="font-size:0.82rem;">${_csEsc(sc.action||'')}</div>${sc.text_overlay?`<div style="margin-top:4px;padding:2px 6px;background:rgba(0,0,0,0.7);color:#fff;border-radius:4px;font-size:0.72rem;display:inline-block;">${_csEsc(sc.text_overlay)}</div>`:''}</div>
      <div><div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);">VOICEOVER</div><div style="font-size:0.82rem;font-style:italic;">"${_csEsc(sc.voiceover||'')}"</div></div>
    </div>`).join('')}
  </div>
  <div style="padding:14px;background:var(--ig-primary,#667eea)10;border-radius:8px;border:1px solid var(--ig-primary,#667eea)30;margin-bottom:16px;">
    <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:4px;">CTA</div>
    <div style="font-weight:600;">${_csEsc(s.cta||'')}</div>
  </div>
  ${s.caption ? `
  <div style="background:var(--bg-subtle,#f8f9fa);border-radius:8px;padding:14px;">
    <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:6px;">CAPTION + HASHTAGS</div>
    <div style="font-size:0.88rem;line-height:1.6;">${_csEsc(s.caption)}</div>
    <div style="color:var(--ig-primary,#667eea);font-size:0.85rem;margin-top:6px;">${(s.hashtags||[]).map(h=>_csEsc(h)).join(' ')}</div>
  </div>` : ''}
</div>`;
  }).catch(() => { _csStatus(statusEl, 'Generation failed.', 'error'); if(resultEl) resultEl.innerHTML=''; });
};

/* ─────────────────────────────────────────────────────────────────────
   T64 · BRAND DEAL PIPELINE
   ───────────────────────────────────────────────────────────────────── */
const DEAL_STATUS_COLORS = { inquiry:'#94a3b8', negotiating:'#f59e0b', accepted:'#667eea', active:'#22c55e', completed:'#16a34a', rejected:'#ef4444', paused:'#6b7280' };

window.buildBrandDeals = function() {
  const wrap = document.getElementById('brandDealsWrap');
  if (!wrap) return;
  wrap.innerHTML = _csSpinner();
  Promise.all([_csGet('/api/brand-deals'), _csGet('/api/brand-deals/stats/summary'), _csGet('/api/personas')]).then(([dealsData, statsData, personasData]) => {
    const deals = dealsData.deals || [];
    const stats = statsData.stats || {};
    const personas = (personasData.personas || []).filter(p => p.is_active);
    const kanbanGroups = ['inquiry','negotiating','accepted','active','completed','rejected'];
    wrap.innerHTML = `
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">
  ${[['💬 Inquiries', stats.inquiries||0, '#94a3b8'],['🤝 Active Deals', stats.active||0, '#22c55e'],['✅ Completed', stats.completed||0, '#16a34a'],['💰 Total Earned', _csFormatMoney(stats.total_earned||0), '#667eea']].map(([l,v,c])=>`
  <div class="ig-card" style="text-align:center;padding:16px;"><div style="font-size:1.4rem;font-weight:700;color:${c};">${v}</div><div style="font-size:0.8rem;color:var(--text-muted);">${l}</div></div>`).join('')}
</div>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
  <h3 style="margin:0;">Deal Pipeline</h3>
  <button class="btn btn-primary" onclick="window._dealNew(${JSON.stringify(personas).split('"').join('&quot;')})">+ New Deal</button>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;align-items:start;">
  ${kanbanGroups.map(status => {
    const groupDeals = deals.filter(d => d.status === status);
    const col = DEAL_STATUS_COLORS[status] || '#94a3b8';
    return `<div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${col};"></div>
        <span style="font-weight:600;text-transform:capitalize;font-size:0.85rem;">${status}</span>
        <span style="font-size:0.78rem;color:var(--text-muted);">(${groupDeals.length})</span>
      </div>
      ${groupDeals.map(d => _dealCard(d, personas)).join('')}
    </div>`;
  }).join('')}
</div>
<div id="dealModalWrap"></div>`;
  }).catch(() => { wrap.innerHTML = `<div class="ig-alert ig-alert-error">Failed to load deals.</div>`; });
};

function _dealCard(d, personas) {
  const col = DEAL_STATUS_COLORS[d.status] || '#94a3b8';
  return `<div class="ig-card" style="margin-bottom:8px;padding:12px;border-left:3px solid ${col};">
  <div style="font-weight:600;font-size:0.9rem;margin-bottom:2px;">${_csEsc(d.brand_name)}</div>
  ${d.product ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;">${_csEsc(d.product)}</div>` : ''}
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span class="ig-badge ig-badge-xs" style="text-transform:capitalize;">${_csEsc(d.deal_type||'').replace(/_/g,' ')}</span>
    ${d.negotiated_rate||d.offered_rate ? `<span style="font-size:0.85rem;font-weight:600;color:${col};">${_csFormatMoney(d.negotiated_rate||d.offered_rate,d.currency||'USD')}</span>` : ''}
  </div>
  ${d.persona_name ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;">👤 ${_csEsc(d.persona_name)}</div>` : ''}
  ${d.follow_up_date ? `<div style="font-size:0.75rem;color:#f59e0b;margin-bottom:6px;">📅 Follow up: ${_csFormatDate(d.follow_up_date)}</div>` : ''}
  <div style="display:flex;gap:6px;flex-wrap:wrap;">
    <button class="btn btn-xs btn-outline" onclick="window._dealEdit(${d.id})">✏️</button>
    <button class="btn btn-xs btn-outline" onclick="window._dealPitch(${d.id})">📧 Pitch</button>
    <select class="ig-select" style="font-size:0.75rem;padding:2px 6px;height:auto;" onchange="window._dealStatus(${d.id},this.value)">
      ${['inquiry','negotiating','accepted','active','completed','rejected','paused'].map(s=>`<option value="${s}" ${d.status===s?'selected':''}>${s}</option>`).join('')}
    </select>
  </div>
</div>`;
}

window._dealNew = function(personasArg) {
  let personas = [];
  try { personas = typeof personasArg === 'string' ? [] : (personasArg||[]); } catch(_) {}
  _showDealModal(null, personas);
};

window._dealEdit = function(id) {
  Promise.all([_csGet(`/api/brand-deals?status=`), _csGet('/api/personas')]).then(([dealsData, personasData]) => {
    const deal = (dealsData.deals||[]).find(d => d.id === id);
    const personas = (personasData.personas||[]).filter(p=>p.is_active);
    if (deal) _showDealModal(deal, personas);
  });
};

function _showDealModal(deal, personas) {
  const mw = document.getElementById('dealModalWrap');
  if (!mw) return;
  const isEdit = !!deal;
  mw.innerHTML = `
<div class="ig-modal-overlay" onclick="if(event.target===this)this.remove()">
<div class="ig-modal" style="max-width:640px;">
  <div class="ig-modal-header"><h3>${isEdit?'✏️ Edit Deal':'+ New Brand Deal'}</h3><button class="ig-modal-close" onclick="this.closest('.ig-modal-overlay').remove()">×</button></div>
  <div class="ig-modal-body">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="ig-label">Brand Name *</label><input id="ddBrand" class="ig-input" value="${_csEsc(deal?.brand_name||'')}" placeholder="e.g. LUMI Skincare"></div>
      <div><label class="ig-label">Contact Name</label><input id="ddContact" class="ig-input" value="${_csEsc(deal?.contact_name||'')}" placeholder="Sarah Lee"></div>
      <div><label class="ig-label">Contact Email</label><input id="ddEmail" class="ig-input" type="email" value="${_csEsc(deal?.contact_email||'')}" placeholder="sarah@brand.com"></div>
      <div><label class="ig-label">Product</label><input id="ddProduct" class="ig-input" value="${_csEsc(deal?.product||'')}" placeholder="Vitamin C Serum"></div>
      <div><label class="ig-label">Deal Type</label>
        <select id="ddType" class="ig-select">${['sponsored_post','affiliate','gifted','ambassador','product_review','ugc','other'].map(t=>`<option value="${t}" ${deal?.deal_type===t?'selected':''}>${t.replace(/_/g,' ')}</option>`).join('')}</select></div>
      <div><label class="ig-label">Offered Rate ($)</label><input id="ddOffered" class="ig-input" type="number" value="${deal?.offered_rate||''}" placeholder="500"></div>
      <div><label class="ig-label">Negotiated Rate ($)</label><input id="ddNegotiated" class="ig-input" type="number" value="${deal?.negotiated_rate||''}" placeholder="650"></div>
      <div><label class="ig-label">Status</label>
        <select id="ddStatus" class="ig-select">${['inquiry','negotiating','accepted','active','completed','rejected','paused'].map(s=>`<option value="${s}" ${deal?.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
      ${personas.length>0?`<div><label class="ig-label">Persona</label><select id="ddPersona" class="ig-select"><option value="">None</option>${personas.map(p=>`<option value="${p.id}" ${deal?.persona_id===p.id?'selected':''}>${_csEsc(p.name)}</option>`).join('')}</select></div>`:''}
      <div><label class="ig-label">Follow-up Date</label><input id="ddFollowup" class="ig-input" type="date" value="${deal?.follow_up_date?.split('T')[0]||''}"></div>
      <div><label class="ig-label">Deadline</label><input id="ddDeadline" class="ig-input" type="date" value="${deal?.deadline?.split('T')[0]||''}"></div>
    </div>
    <div style="margin-top:12px;"><label class="ig-label">Deliverables</label><input id="ddDeliverables" class="ig-input" value="${_csEsc(deal?.deliverables||'')}" placeholder="e.g. 2x Instagram posts, 1x Reel, 3 stories"></div>
    <div style="margin-top:12px;"><label class="ig-label">Notes</label><textarea id="ddNotes" class="ig-textarea" rows="2">${_csEsc(deal?.notes||'')}</textarea></div>
  </div>
  <div class="ig-modal-footer">
    <div id="ddStatus"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
      <button class="btn btn-outline" onclick="this.closest('.ig-modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="window._dealSave(${isEdit?deal.id:'null'})">${isEdit?'Save Changes':'Create Deal'}</button>
    </div>
  </div>
</div></div>`;
}

window._dealSave = function(editId) {
  const body = { brand_name: (document.getElementById('ddBrand')||{}).value, contact_name: (document.getElementById('ddContact')||{}).value, contact_email: (document.getElementById('ddEmail')||{}).value, product: (document.getElementById('ddProduct')||{}).value, deal_type: (document.getElementById('ddType')||{}).value, offered_rate: parseFloat((document.getElementById('ddOffered')||{}).value)||null, negotiated_rate: parseFloat((document.getElementById('ddNegotiated')||{}).value)||null, status: (document.getElementById('ddStatus')||{}).value, deliverables: (document.getElementById('ddDeliverables')||{}).value, notes: (document.getElementById('ddNotes')||{}).value, follow_up_date: (document.getElementById('ddFollowup')||{}).value||null, deadline: (document.getElementById('ddDeadline')||{}).value||null, persona_id: parseInt((document.getElementById('ddPersona')||{}).value)||null };
  const statusEl = document.getElementById('ddStatus');
  _csStatus(statusEl, 'Saving…', 'info');
  const p = editId ? _csPut(`/api/brand-deals/${editId}`, body) : _csPost('/api/brand-deals', body);
  p.then(data => { if (data.error) { _csStatus(statusEl, data.error, 'error'); return; } document.querySelector('.ig-modal-overlay')?.remove(); window.buildBrandDeals(); }).catch(() => _csStatus(statusEl, 'Save failed.', 'error'));
};

window._dealStatus = function(id, status) {
  _csPut(`/api/brand-deals/${id}`, { status }).then(() => window.buildBrandDeals());
};

window._dealPitch = function(id) {
  const mw = document.getElementById('dealModalWrap');
  if (!mw) return;
  mw.innerHTML = `
<div class="ig-modal-overlay" onclick="if(event.target===this)this.remove()">
<div class="ig-modal" style="max-width:600px;">
  <div class="ig-modal-header"><h3>📧 AI Pitch Generator</h3><button class="ig-modal-close" onclick="this.closest('.ig-modal-overlay').remove()">×</button></div>
  <div class="ig-modal-body">
    <div style="margin-bottom:12px;"><label class="ig-label">Pitch Type</label>
      <select id="ptType" class="ig-select"><option value="initial">Initial Pitch</option><option value="follow_up">Follow-up</option><option value="counter">Counter Offer</option></select></div>
    <div id="ptResult"></div>
  </div>
  <div class="ig-modal-footer"><button class="btn btn-primary" onclick="window._dealDoPitch(${id})">✨ Generate Pitch</button></div>
</div></div>`;
};

window._dealDoPitch = function(id) {
  const type = (document.getElementById('ptType')||{}).value;
  const resultEl = document.getElementById('ptResult');
  resultEl.innerHTML = _csSpinner();
  _csPost(`/api/brand-deals/${id}/generate-pitch`, { pitch_type: type }).then(data => {
    const p = data.pitch || {};
    resultEl.innerHTML = `
<div style="background:var(--bg-subtle,#f8f9fa);border-radius:10px;padding:16px;">
  <div style="font-weight:600;margin-bottom:10px;">Subject: ${_csEsc(p.subject||'')}</div>
  <div style="font-size:0.88rem;line-height:1.7;white-space:pre-wrap;">${_csEsc(p.body||'')}</div>
  ${(p.key_points||[]).length?`<div style="margin-top:12px;"><div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:4px;">KEY POINTS</div>${p.key_points.map(kp=>`<div style="font-size:0.82rem;color:var(--text-muted);">• ${_csEsc(kp)}</div>`).join('')}</div>`:''}
  <button class="btn btn-sm btn-outline" style="margin-top:12px;" onclick="navigator.clipboard.writeText(document.querySelector('.ig-modal .ig-modal-body pre, .ig-modal .ig-modal-body div[style*=pre-wrap]')?.textContent||'');this.textContent='✓ Copied!'">📋 Copy Email</button>
</div>`;
  }).catch(() => { resultEl.innerHTML = `<div class="ig-alert ig-alert-error">Generation failed.</div>`; });
};
