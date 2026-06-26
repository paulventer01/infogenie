/* ── Customer Engagement Suite ──────────────────────────────────────────── */
/* Surveys · Email Designer · MCP Server · Smart Send Time · Ad Sync         */
/* F05, F06, F11 — UI builders + wiring                                      */

(function () {
'use strict';

function _e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function _q(s) { return document.querySelector(s); }
function _api(method, path, body) {
  return fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(r => r.json());
}
function _toast(msg, type) {
  if (typeof window.showToast === 'function') { window.showToast(msg); return; }
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;bottom:24px;right:24px;background:${type==='error'?'#ef4444':'#10b981'};color:#fff;padding:10px 18px;border-radius:8px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2)`;
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3500);
}
function _badge(txt, color) {
  return `<span style="background:${color||'#6366f1'};color:#fff;border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:700">${_e(txt)}</span>`;
}
function _spinner() { return `<div style="text-align:center;padding:32px;color:#6b7280;font-size:0.9rem">⏳ Loading…</div>`; }
function _empty(msg) { return `<div style="text-align:center;padding:40px;color:#94a3b8;font-size:0.9rem">${_e(msg)}</div>`; }

/* ═══════════════════════════════════════════════════════════════════════════
   F06 — In-App Survey Builder + AI Analysis
   ════════════════════════════════════════════════════════════════════════ */
window.buildSurveys = function () {
  const el = document.getElementById('view-surveys');
  if (!el) return;

  el.innerHTML = `
<div class="view-header">
  <h2>📋 In-App Survey Builder</h2>
  <p class="view-sub">Create NPS, CSAT, and multi-question surveys — embed anywhere or trigger from journeys. Responses analysed with AI.</p>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1100px">
  <!-- Left: Create / Edit -->
  <div>
    <div class="ig-card">
      <h3 style="margin:0 0 16px;font-size:1rem">Create Survey</h3>
      <div class="form-group"><label>Survey Name</label><input id="sv-name" class="form-control" placeholder="e.g. Post-signup NPS"></div>
      <div class="form-group"><label>Survey Type</label>
        <select id="sv-type" class="form-control">
          <option value="nps">NPS (Net Promoter Score)</option>
          <option value="csat">CSAT (Customer Satisfaction)</option>
          <option value="custom">Custom Questions</option>
          <option value="ces">CES (Customer Effort Score)</option>
        </select>
      </div>
      <div class="form-group"><label>Trigger</label>
        <select id="sv-trigger" class="form-control">
          <option value="manual">Manual / Embedded</option>
          <option value="page_exit">On page exit</option>
          <option value="scroll_50">50% scroll depth</option>
          <option value="time_30s">After 30 seconds</option>
          <option value="journey">Journey node</option>
        </select>
      </div>
      <div id="sv-questions-wrap">
        <label style="font-size:0.85rem;font-weight:700;color:#374151;display:block;margin-bottom:8px">Questions</label>
        <div id="sv-questions"></div>
        <button id="sv-add-q" style="padding:6px 14px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;font-size:0.85rem;margin-top:6px">+ Add Question</button>
      </div>
      <div class="form-group" style="margin-top:14px"><label>Thank-you message</label><input id="sv-thanks" class="form-control" placeholder="Thanks for your feedback!" value="Thanks for your feedback!"></div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button id="sv-save" class="btn btn-primary" style="flex:1">💾 Save Survey</button>
        <button id="sv-preview" style="flex:1;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-weight:600">👁️ Preview</button>
      </div>
    </div>
    <!-- Embed snippet -->
    <div class="ig-card" style="margin-top:16px">
      <h3 style="margin:0 0 12px;font-size:0.95rem">📎 Embed Code</h3>
      <p style="font-size:0.82rem;color:#6b7280;margin:0 0 10px">Copy this snippet into any page to render the survey inline.</p>
      <pre id="sv-snippet" style="background:#0f172a;color:#e2e8f0;border-radius:8px;padding:14px;font-size:0.78rem;overflow-x:auto;white-space:pre-wrap">Select a saved survey to see its embed code.</pre>
      <button id="sv-copy-snippet" style="margin-top:8px;padding:6px 14px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;font-size:0.82rem">📋 Copy</button>
    </div>
  </div>
  <!-- Right: Responses + AI Analysis -->
  <div>
    <div class="ig-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3 style="margin:0;font-size:1rem">Saved Surveys</h3>
        <button id="sv-refresh" style="padding:5px 12px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:0.82rem">🔄 Refresh</button>
      </div>
      <div id="sv-list">${_spinner()}</div>
    </div>
    <div class="ig-card" style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3 style="margin:0;font-size:1rem">Responses &amp; AI Analysis</h3>
        <button id="sv-ai-analyse" class="btn btn-primary" style="padding:7px 14px;font-size:0.85rem">🤖 AI Analyse</button>
      </div>
      <div id="sv-responses">${_empty('Select a survey to view responses.')}</div>
      <div id="sv-ai-result" style="margin-top:14px"></div>
    </div>
  </div>
</div>
<!-- Preview Modal -->
<div id="sv-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;align-items:center;justify-content:center">
  <div style="background:#fff;border-radius:16px;padding:32px;max-width:480px;width:90%;position:relative">
    <button onclick="document.getElementById('sv-modal').style.display='none'" style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6b7280">✕</button>
    <div id="sv-modal-body"></div>
  </div>
</div>`;

  const questions = [];
  let activeSurveyId = null;

  function _qHtml(q, i) {
    return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;display:grid;gap:6px">
      <div style="display:flex;gap:8px;align-items:center">
        <select data-qi="${i}" data-qk="type" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:0.82rem">
          ${['text','nps_scale','rating_5','rating_10','yes_no','multiple_choice'].map(t=>`<option value="${t}"${q.type===t?' selected':''}>${{text:'Free text',nps_scale:'NPS scale (0-10)',rating_5:'Rating 1-5',rating_10:'Rating 1-10',yes_no:'Yes / No',multiple_choice:'Multiple choice'}[t]}</option>`).join('')}
        </select>
        <input data-qi="${i}" data-qk="required" type="checkbox" title="Required" ${q.required?'checked':''} style="width:14px;height:14px">
        <label style="font-size:0.78rem;color:#6b7280">Req</label>
        <button data-del-q="${i}" style="margin-left:auto;padding:2px 8px;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:0.78rem">✕</button>
      </div>
      <input data-qi="${i}" data-qk="label" value="${_e(q.label||'')}" placeholder="Question text…" style="padding:5px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:0.85rem">
      ${q.type==='multiple_choice'?`<input data-qi="${i}" data-qk="options_raw" value="${_e(q.options?.join(',')||'')}" placeholder="Option A,Option B,Option C" style="padding:5px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:0.8rem">`:''}</div>`;
  }

  function _renderQuestions() {
    const wrap = document.getElementById('sv-questions');
    if (!wrap) return;
    wrap.innerHTML = questions.map((q, i) => _qHtml(q, i)).join('');
    wrap.querySelectorAll('[data-qi]').forEach(el => {
      const i = +el.dataset.qi;
      const k = el.dataset.qk;
      el.addEventListener('change', () => { questions[i][k] = el.type === 'checkbox' ? el.checked : el.value; _renderQuestions(); });
    });
    wrap.querySelectorAll('[data-del-q]').forEach(btn => {
      btn.onclick = () => { questions.splice(+btn.dataset.delQ, 1); _renderQuestions(); };
    });
  }

  document.getElementById('sv-add-q').onclick = () => {
    questions.push({ type: 'text', label: '', required: false });
    _renderQuestions();
  };

  // Default question for NPS
  document.getElementById('sv-type').onchange = function () {
    if (this.value === 'nps' && questions.length === 0) {
      questions.push({ type: 'nps_scale', label: 'How likely are you to recommend us to a friend or colleague?', required: true });
      _renderQuestions();
    } else if (this.value === 'csat' && questions.length === 0) {
      questions.push({ type: 'rating_5', label: 'How satisfied are you with your experience today?', required: true });
      _renderQuestions();
    }
  };

  async function _loadSurveys() {
    document.getElementById('sv-list').innerHTML = _spinner();
    const d = await _api('GET', '/api/surveys');
    if (!d.ok || !d.surveys?.length) {
      document.getElementById('sv-list').innerHTML = _empty('No surveys yet. Create one on the left.');
      return;
    }
    document.getElementById('sv-list').innerHTML = d.surveys.map(s => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;cursor:pointer" data-sv-id="${s.id}">
        <div>
          <div style="font-weight:700;font-size:0.9rem">${_e(s.name)}</div>
          <div style="font-size:0.78rem;color:#6b7280">${_badge(s.type,'#6366f1')} &nbsp;${s.response_count||0} responses &nbsp;· trigger: ${_e(s.trigger)}</div>
        </div>
        <button data-sv-del="${s.id}" style="padding:4px 10px;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;font-size:0.78rem">Delete</button>
      </div>`).join('');
    d.surveys.forEach(s => {
      const row = document.querySelector(`[data-sv-id="${s.id}"]`);
      if (row) row.onclick = ev => { if (ev.target.dataset.svDel) return; _selectSurvey(s); };
    });
    document.querySelectorAll('[data-sv-del]').forEach(btn => {
      btn.onclick = async ev => {
        ev.stopPropagation();
        if (!confirm('Delete this survey?')) return;
        const r = await _api('DELETE', `/api/surveys/${btn.dataset.svDel}`);
        if (r.ok) { _toast('Survey deleted'); _loadSurveys(); }
        else _toast(r.error || 'Error', 'error');
      };
    });
    // Snippet for first survey
    if (d.surveys[0]) _showSnippet(d.surveys[0].id);
  }

  function _showSnippet(id) {
    const code = `<script src="${location.origin}/public/js/ig_survey_widget.js?v=1"><\/script>\n<div data-ig-survey="${id}"></div>`;
    document.getElementById('sv-snippet').textContent = code;
  }

  async function _selectSurvey(s) {
    activeSurveyId = s.id;
    _showSnippet(s.id);
    document.getElementById('sv-responses').innerHTML = _spinner();
    const d = await _api('GET', `/api/surveys/${s.id}/responses`);
    if (!d.ok) { document.getElementById('sv-responses').innerHTML = _empty('Could not load responses.'); return; }
    const resp = d.responses || [];
    if (!resp.length) { document.getElementById('sv-responses').innerHTML = _empty('No responses yet.'); return; }
    document.getElementById('sv-responses').innerHTML = `
      <div style="font-size:0.82rem;color:#6b7280;margin-bottom:8px">${resp.length} response(s) — most recent first</div>
      ${resp.slice(0, 10).map(r => `
        <div style="border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:0.82rem">
          <div style="font-weight:600;color:#374151">${_e(r.respondent_email || 'Anonymous')}</div>
          <div style="color:#6b7280;font-size:0.75rem;margin-bottom:4px">${new Date(r.created_at).toLocaleString()}</div>
          <div style="color:#374151">${Object.entries(r.answers || {}).map(([k, v]) => `<span style="color:#6b7280">${_e(k)}:</span> <strong>${_e(String(v))}</strong>`).join(' &nbsp;·&nbsp; ')}</div>
        </div>`).join('')}`;
  }

  document.getElementById('sv-ai-analyse').onclick = async () => {
    if (!activeSurveyId) { _toast('Select a survey first.', 'error'); return; }
    const btn = document.getElementById('sv-ai-analyse');
    btn.disabled = true; btn.textContent = '⏳ Analysing…';
    const d = await _api('POST', `/api/surveys/${activeSurveyId}/analyse`);
    btn.disabled = false; btn.textContent = '🤖 AI Analyse';
    if (!d.ok) { _toast(d.error || 'Analysis failed', 'error'); return; }
    const a = d.analysis || {};
    document.getElementById('sv-ai-result').innerHTML = `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px">
        <div style="font-weight:700;color:#15803d;margin-bottom:10px">🤖 AI Analysis</div>
        ${a.nps_score != null ? `<div style="font-size:0.85rem;margin-bottom:6px"><strong>NPS Score:</strong> ${a.nps_score} — ${a.nps_bucket||''}</div>`:''}
        ${a.summary ? `<div style="font-size:0.85rem;margin-bottom:10px;color:#374151">${_e(a.summary)}</div>`:''}
        ${a.themes?.length ? `<div style="font-size:0.82rem;margin-bottom:8px"><strong>Key Themes:</strong><ul style="margin:4px 0 0 18px;padding:0">${a.themes.map(t=>`<li>${_e(t)}</li>`).join('')}</ul></div>`:''}
        ${a.action_items?.length ? `<div style="font-size:0.82rem"><strong>Recommended Actions:</strong><ul style="margin:4px 0 0 18px;padding:0">${a.action_items.map(t=>`<li>${_e(t)}</li>`).join('')}</ul></div>`:''}
      </div>`;
  };

  document.getElementById('sv-save').onclick = async () => {
    const name = document.getElementById('sv-name').value.trim();
    if (!name) { _toast('Enter a survey name.', 'error'); return; }
    const type = document.getElementById('sv-type').value;
    const trigger = document.getElementById('sv-trigger').value;
    const thanks_message = document.getElementById('sv-thanks').value;
    const qs = questions.map(q => ({
      ...q,
      options: q.options_raw ? q.options_raw.split(',').map(s => s.trim()).filter(Boolean) : q.options
    }));
    const btn = document.getElementById('sv-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    const d = await _api('POST', '/api/surveys', { name, type, trigger, thanks_message, questions: qs });
    btn.disabled = false; btn.textContent = '💾 Save Survey';
    if (d.ok) { _toast('Survey saved!'); _loadSurveys(); questions.length = 0; _renderQuestions(); document.getElementById('sv-name').value = ''; }
    else _toast(d.error || 'Save failed', 'error');
  };

  document.getElementById('sv-preview').onclick = () => {
    const name = document.getElementById('sv-name').value || 'Survey Preview';
    const qs = questions.filter(q => q.label);
    document.getElementById('sv-modal-body').innerHTML = `
      <h3 style="margin:0 0 20px;font-size:1.1rem">${_e(name)}</h3>
      ${qs.map((q, i) => `
        <div style="margin-bottom:16px">
          <label style="font-weight:600;display:block;margin-bottom:6px;font-size:0.9rem">${_e(q.label)}${q.required?'<span style="color:#ef4444"> *</span>':''}</label>
          ${q.type==='nps_scale'?`<div style="display:flex;gap:4px">${Array.from({length:11},(_,n)=>`<button style="width:36px;height:36px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-weight:700;font-size:0.85rem">${n}</button>`).join('')}</div>`:''}
          ${q.type==='rating_5'?`<div style="display:flex;gap:4px">${[1,2,3,4,5].map(n=>`<button style="width:36px;height:36px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">★</button>`).join('')}</div>`:''}
          ${q.type==='yes_no'?`<div style="display:flex;gap:10px"><button style="padding:8px 20px;border:1px solid #86efac;background:#f0fdf4;border-radius:7px;cursor:pointer;font-weight:600">👍 Yes</button><button style="padding:8px 20px;border:1px solid #fca5a5;background:#fef2f2;border-radius:7px;cursor:pointer;font-weight:600">👎 No</button></div>`:''}
          ${q.type==='text'?`<textarea style="width:100%;border:1px solid #e2e8f0;border-radius:7px;padding:8px;font-size:0.85rem;box-sizing:border-box" rows="3" placeholder="Your answer…"></textarea>`:''}
          ${q.type==='multiple_choice'?`<div style="display:flex;flex-direction:column;gap:6px">${(q.options||['Option A','Option B','Option C']).map(o=>`<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem"><input type="radio" name="q${i}"> ${_e(o)}</label>`).join('')}</div>`:''}
        </div>`).join('')}
      <button style="width:100%;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95rem;margin-top:8px">Submit</button>`;
    document.getElementById('sv-modal').style.display = 'flex';
  };

  document.getElementById('sv-copy-snippet').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('sv-snippet').textContent).then(() => _toast('Copied!'));
  };

  document.getElementById('sv-refresh').onclick = _loadSurveys;

  // Default NPS question
  questions.push({ type: 'nps_scale', label: 'How likely are you to recommend us to a friend or colleague?', required: true });
  _renderQuestions();
  _loadSurveys();
};

/* ═══════════════════════════════════════════════════════════════════════════
   F05 — Visual Email Designer
   ════════════════════════════════════════════════════════════════════════ */
window.buildEmailDesigner = function () {
  const el = document.getElementById('view-email-designer');
  if (!el) return;

  const BLOCK_TYPES = [
    { type: 'header',  icon: '🔷', label: 'Header' },
    { type: 'text',    icon: '📝', label: 'Text Block' },
    { type: 'image',   icon: '🖼️',  label: 'Image' },
    { type: 'button',  icon: '🔘', label: 'Button' },
    { type: 'divider', icon: '➖', label: 'Divider' },
    { type: 'spacer',  icon: '⬜', label: 'Spacer' },
    { type: 'footer',  icon: '📄', label: 'Footer' },
  ];

  el.innerHTML = `
<div class="view-header">
  <h2>🎨 Visual Email Designer</h2>
  <p class="view-sub">Drag-and-drop block editor — build beautiful emails, preview HTML, export to drip campaigns.</p>
</div>
<div style="display:grid;grid-template-columns:220px 1fr 320px;gap:16px;max-width:1200px;height:calc(100vh - 200px)">
  <!-- Block palette -->
  <div class="ig-card" style="overflow-y:auto">
    <h4 style="margin:0 0 12px;font-size:0.85rem;font-weight:700;color:#374151">BLOCKS</h4>
    <div style="display:grid;gap:8px">
      ${BLOCK_TYPES.map(b => `
        <button class="ed-add-block" data-btype="${b.type}" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;text-align:left;font-size:0.85rem;font-weight:600;width:100%">
          <span>${b.icon}</span><span>${b.label}</span>
        </button>`).join('')}
    </div>
    <hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0">
    <h4 style="margin:0 0 12px;font-size:0.85rem;font-weight:700;color:#374151">SAVED TEMPLATES</h4>
    <div id="ed-template-list" style="font-size:0.8rem;color:#6b7280">${_spinner()}</div>
  </div>
  <!-- Canvas -->
  <div style="display:flex;flex-direction:column;gap:0">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px 10px 0 0;padding:10px 14px;display:flex;gap:10px;align-items:center">
      <input id="ed-template-name" class="form-control" placeholder="Template name…" style="max-width:240px;padding:6px 10px">
      <button id="ed-save" class="btn btn-primary" style="padding:7px 16px;font-size:0.85rem">💾 Save</button>
      <button id="ed-preview-html" style="padding:7px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;cursor:pointer;font-weight:600;font-size:0.85rem">👁 Preview</button>
      <button id="ed-clear" style="padding:7px 14px;background:#fef2f2;border:1px solid #fca5a5;border-radius:7px;cursor:pointer;font-weight:600;font-size:0.85rem;color:#b91c1c;margin-left:auto">🗑 Clear</button>
    </div>
    <div id="ed-canvas" style="flex:1;background:#f1f5f9;border:1px solid #e2e8f0;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;overflow-y:auto;padding:24px;display:flex;flex-direction:column;align-items:center;gap:0">
      <div id="ed-canvas-inner" style="width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <div id="ed-drop-hint" style="padding:60px 24px;text-align:center;color:#94a3b8;font-size:0.9rem;border:2px dashed #cbd5e1;border-radius:8px;margin:12px">
          ← Click a block to add it to your email
        </div>
      </div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:0 0 10px 10px;padding:8px 14px;font-size:0.78rem;color:#94a3b8">
      <span id="ed-block-count">0 blocks</span> · 600px width · Email-safe HTML
    </div>
  </div>
  <!-- Properties panel -->
  <div class="ig-card" style="overflow-y:auto">
    <h4 style="margin:0 0 12px;font-size:0.85rem;font-weight:700;color:#374151">PROPERTIES</h4>
    <div id="ed-props">
      <div style="color:#94a3b8;font-size:0.85rem">Click a block to edit its properties.</div>
    </div>
  </div>
</div>
<!-- HTML Preview Modal -->
<div id="ed-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;align-items:center;justify-content:center">
  <div style="background:#fff;border-radius:16px;width:700px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e2e8f0">
      <span style="font-weight:700">HTML Preview</span>
      <div style="display:flex;gap:8px">
        <button id="ed-copy-html" style="padding:6px 14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:0.82rem">📋 Copy HTML</button>
        <button onclick="document.getElementById('ed-modal').style.display='none'" style="padding:6px 14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:0.82rem">✕ Close</button>
      </div>
    </div>
    <iframe id="ed-iframe" style="flex:1;border:none;min-height:500px"></iframe>
  </div>
</div>`;

  let blocks = [];
  let activeIdx = null;

  const DEFAULTS = {
    header: { text: 'Your Brand Name', bg_color: '#1e293b', text_color: '#ffffff', font_size: 24, align: 'center' },
    text:   { content: 'Write your email content here. Keep it clear and concise.', font_size: 14, text_color: '#374151', align: 'left', padding: 16 },
    image:  { src: 'https://via.placeholder.com/600x200?text=Your+Image', alt: 'Image', width: '100%', link: '' },
    button: { label: 'Click Here', url: '#', bg_color: '#6366f1', text_color: '#ffffff', align: 'center', border_radius: 8 },
    divider:{ color: '#e2e8f0', thickness: 1, margin: 16 },
    spacer: { height: 24 },
    footer: { text: 'You received this email because you signed up for updates.\n© 2026 Your Company · Unsubscribe', font_size: 11, text_color: '#9ca3af', align: 'center' },
  };

  function _blockPreview(b) {
    const d = b.data;
    switch (b.type) {
      case 'header':  return `<div style="background:${_e(d.bg_color)};color:${_e(d.text_color)};text-align:${_e(d.align)};padding:24px;font-size:${d.font_size}px;font-weight:700">${_e(d.text)}</div>`;
      case 'text':    return `<div style="padding:${d.padding}px;font-size:${d.font_size}px;color:${_e(d.text_color)};text-align:${_e(d.align)};line-height:1.6">${_e(d.content).replace(/\n/g,'<br>')}</div>`;
      case 'image':   return `<div style="text-align:${_e(d.align||'center')}"><img src="${_e(d.src)}" alt="${_e(d.alt)}" style="width:${_e(d.width)};max-width:100%;height:auto"></div>`;
      case 'button':  return `<div style="text-align:${_e(d.align)};padding:16px"><a href="${_e(d.url)}" style="display:inline-block;background:${_e(d.bg_color)};color:${_e(d.text_color)};padding:12px 28px;border-radius:${d.border_radius}px;text-decoration:none;font-weight:700;font-size:14px">${_e(d.label)}</a></div>`;
      case 'divider': return `<div style="margin:${d.margin}px 0"><hr style="border:none;border-top:${d.thickness}px solid ${_e(d.color)};margin:0"></div>`;
      case 'spacer':  return `<div style="height:${d.height}px"></div>`;
      case 'footer':  return `<div style="padding:16px;text-align:${_e(d.align)};font-size:${d.font_size}px;color:${_e(d.text_color)}">${_e(d.text).replace(/\n/g,'<br>')}</div>`;
      default:        return '';
    }
  }

  function _renderCanvas() {
    const canvas = document.getElementById('ed-canvas-inner');
    const hint = document.getElementById('ed-drop-hint');
    if (!canvas) return;
    if (!blocks.length) {
      canvas.innerHTML = `<div id="ed-drop-hint" style="padding:60px 24px;text-align:center;color:#94a3b8;font-size:0.9rem;border:2px dashed #cbd5e1;border-radius:8px;margin:12px">← Click a block to add it to your email</div>`;
      document.getElementById('ed-block-count').textContent = '0 blocks';
      return;
    }
    canvas.innerHTML = blocks.map((b, i) => `
      <div data-bidx="${i}" style="position:relative;border:2px solid ${i===activeIdx?'#6366f1':'transparent'};border-radius:4px;cursor:pointer;transition:border .15s">
        ${_blockPreview(b)}
        <div style="position:absolute;top:4px;right:4px;display:flex;gap:4px;opacity:0;transition:opacity .15s" class="ed-blk-ctrls">
          ${i>0?`<button data-mv-up="${i}" style="padding:2px 7px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font-size:.75rem">↑</button>`:''}
          ${i<blocks.length-1?`<button data-mv-dn="${i}" style="padding:2px 7px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font-size:.75rem">↓</button>`:''}
          <button data-del-b="${i}" style="padding:2px 7px;background:#fee2e2;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:.75rem;color:#b91c1c">✕</button>
        </div>
      </div>`).join('');
    document.getElementById('ed-block-count').textContent = `${blocks.length} block${blocks.length!==1?'s':''}`;
    canvas.querySelectorAll('[data-bidx]').forEach(row => {
      row.onmouseenter = () => row.querySelector('.ed-blk-ctrls').style.opacity = '1';
      row.onmouseleave = () => row.querySelector('.ed-blk-ctrls').style.opacity = '0';
      row.onclick = ev => {
        if (ev.target.closest('button')) return;
        activeIdx = +row.dataset.bidx;
        _renderCanvas();
        _renderProps();
      };
    });
    canvas.querySelectorAll('[data-mv-up]').forEach(btn => {
      btn.onclick = ev => { ev.stopPropagation(); const i = +btn.dataset.mvUp; [blocks[i-1],blocks[i]]=[blocks[i],blocks[i-1]]; if(activeIdx===i) activeIdx=i-1; _renderCanvas(); _renderProps(); };
    });
    canvas.querySelectorAll('[data-mv-dn]').forEach(btn => {
      btn.onclick = ev => { ev.stopPropagation(); const i = +btn.dataset.mvDn; [blocks[i],blocks[i+1]]=[blocks[i+1],blocks[i]]; if(activeIdx===i) activeIdx=i+1; _renderCanvas(); _renderProps(); };
    });
    canvas.querySelectorAll('[data-del-b]').forEach(btn => {
      btn.onclick = ev => { ev.stopPropagation(); const i = +btn.dataset.delB; blocks.splice(i,1); if(activeIdx>=blocks.length) activeIdx=blocks.length-1; _renderCanvas(); _renderProps(); };
    });
  }

  function _field(label, key, val, type='text', extraAttrs='') {
    const id = `edp_${key}`;
    return `<div class="form-group" style="margin-bottom:10px">
      <label style="font-size:0.78rem;font-weight:700;color:#374151;display:block;margin-bottom:4px">${_e(label)}</label>
      ${type==='textarea'
        ? `<textarea id="${id}" data-pk="${key}" rows="4" style="width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;font-family:inherit;font-size:0.82rem;box-sizing:border-box" ${extraAttrs}>${_e(val)}</textarea>`
        : `<input type="${type}" id="${id}" data-pk="${key}" value="${_e(val)}" style="width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:0.82rem;box-sizing:border-box" ${extraAttrs}>`}
    </div>`;
  }

  function _renderProps() {
    const panel = document.getElementById('ed-props');
    if (!panel) return;
    if (activeIdx == null || !blocks[activeIdx]) {
      panel.innerHTML = `<div style="color:#94a3b8;font-size:0.85rem">Click a block to edit its properties.</div>`;
      return;
    }
    const b = blocks[activeIdx];
    const d = b.data;
    let html = `<div style="font-size:0.82rem;font-weight:700;color:#6366f1;margin-bottom:14px;text-transform:uppercase">${b.type} block</div>`;
    switch (b.type) {
      case 'header':
        html += _field('Heading Text','text',d.text,'text') + _field('Background','bg_color',d.bg_color,'color') + _field('Text Color','text_color',d.text_color,'color') + _field('Font Size (px)','font_size',d.font_size,'number','min=10 max=72');
        break;
      case 'text':
        html += _field('Content','content',d.content,'textarea') + _field('Font Size (px)','font_size',d.font_size,'number','min=10 max=36') + _field('Text Color','text_color',d.text_color,'color') + _field('Padding (px)','padding',d.padding,'number');
        break;
      case 'image':
        html += _field('Image URL','src',d.src,'url') + _field('Alt Text','alt',d.alt,'text') + _field('Link URL (optional)','link',d.link,'url');
        break;
      case 'button':
        html += _field('Button Label','label',d.label,'text') + _field('Link URL','url',d.url,'url') + _field('Background','bg_color',d.bg_color,'color') + _field('Text Color','text_color',d.text_color,'color') + _field('Border Radius (px)','border_radius',d.border_radius,'number');
        break;
      case 'divider':
        html += _field('Color','color',d.color,'color') + _field('Thickness (px)','thickness',d.thickness,'number') + _field('Margin (px)','margin',d.margin,'number');
        break;
      case 'spacer':
        html += _field('Height (px)','height',d.height,'number');
        break;
      case 'footer':
        html += _field('Footer Text','text',d.text,'textarea') + _field('Font Size (px)','font_size',d.font_size,'number') + _field('Text Color','text_color',d.text_color,'color');
        break;
    }
    panel.innerHTML = html;
    panel.querySelectorAll('[data-pk]').forEach(inp => {
      const update = () => {
        const k = inp.dataset.pk;
        const v = inp.type === 'number' ? +inp.value : inp.value;
        blocks[activeIdx].data[k] = v;
        _renderCanvas();
      };
      inp.addEventListener('input', update);
      inp.addEventListener('change', update);
    });
  }

  document.querySelectorAll('.ed-add-block').forEach(btn => {
    btn.onclick = () => {
      const type = btn.dataset.btype;
      blocks.push({ type, data: { ...DEFAULTS[type] } });
      activeIdx = blocks.length - 1;
      _renderCanvas();
      _renderProps();
    };
  });

  document.getElementById('ed-clear').onclick = () => {
    if (!confirm('Clear all blocks?')) return;
    blocks = []; activeIdx = null;
    _renderCanvas(); _renderProps();
  };

  function _buildHtml() {
    const inner = blocks.map(b => _blockPreview(b)).join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email</title></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><table width="100%" style="background:#f1f5f9;padding:32px 0"><tr><td align="center"><table width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)"><tr><td>${inner}</td></tr></table></td></tr></table></body></html>`;
  }

  document.getElementById('ed-preview-html').onclick = () => {
    const iframe = document.getElementById('ed-iframe');
    iframe.srcdoc = _buildHtml();
    document.getElementById('ed-modal').style.display = 'flex';
  };

  document.getElementById('ed-copy-html').onclick = () => {
    navigator.clipboard.writeText(_buildHtml()).then(() => _toast('HTML copied!'));
  };

  document.getElementById('ed-save').onclick = async () => {
    const name = document.getElementById('ed-template-name').value.trim();
    if (!name) { _toast('Enter a template name.', 'error'); return; }
    if (!blocks.length) { _toast('Add at least one block.', 'error'); return; }
    const btn = document.getElementById('ed-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    const d = await _api('POST', '/api/email-designer/templates', { name, blocks, preview_html: _buildHtml() });
    btn.disabled = false; btn.textContent = '💾 Save';
    if (d.ok) { _toast('Template saved!'); _loadTemplates(); }
    else _toast(d.error || 'Save failed', 'error');
  };

  async function _loadTemplates() {
    const list = document.getElementById('ed-template-list');
    if (!list) return;
    const d = await _api('GET', '/api/email-designer/templates');
    if (!d.ok || !d.templates?.length) {
      list.innerHTML = '<span style="color:#94a3b8;font-size:0.8rem">No saved templates yet.</span>';
      return;
    }
    list.innerHTML = d.templates.map(t => `
      <div style="margin-bottom:8px;border:1px solid #e2e8f0;border-radius:7px;padding:7px 10px">
        <div style="font-weight:700;font-size:0.82rem">${_e(t.name)}</div>
        <div style="display:flex;gap:6px;margin-top:5px">
          <button data-load-t="${t.id}" style="padding:3px 8px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;cursor:pointer;font-size:0.75rem;color:#15803d">Load</button>
          <button data-del-t="${t.id}" style="padding:3px 8px;background:#fef2f2;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:0.75rem;color:#b91c1c">Delete</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-load-t]').forEach(btn => {
      btn.onclick = async () => {
        const r = await _api('GET', `/api/email-designer/templates/${btn.dataset.loadT}`);
        if (r.ok && r.template) {
          blocks = r.template.blocks || [];
          activeIdx = null;
          document.getElementById('ed-template-name').value = r.template.name;
          _renderCanvas(); _renderProps();
          _toast('Template loaded.');
        }
      };
    });
    list.querySelectorAll('[data-del-t]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete template?')) return;
        const r = await _api('DELETE', `/api/email-designer/templates/${btn.dataset.delT}`);
        if (r.ok) { _toast('Deleted.'); _loadTemplates(); }
      };
    });
  }

  _renderCanvas();
  _loadTemplates();
};

/* ═══════════════════════════════════════════════════════════════════════════
   F11 — MCP Server (Model Context Protocol)
   ════════════════════════════════════════════════════════════════════════ */
window.buildMcpServer = function () {
  const el = document.getElementById('view-mcp-server');
  if (!el) return;

  el.innerHTML = `
<div class="view-header">
  <h2>🔌 MCP Server</h2>
  <p class="view-sub">InfoGenie as an MCP (Model Context Protocol) tool server — connect any AI agent to your marketing data and actions.</p>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1000px">
  <div>
    <div class="ig-card">
      <h3 style="margin:0 0 16px;font-size:1rem">🔌 Connection Details</h3>
      <div id="mcp-info">${_spinner()}</div>
    </div>
    <div class="ig-card" style="margin-top:16px">
      <h3 style="margin:0 0 14px;font-size:1rem">Available Tools</h3>
      <div id="mcp-tools">${_spinner()}</div>
    </div>
  </div>
  <div>
    <div class="ig-card">
      <h3 style="margin:0 0 14px;font-size:1rem">🧪 Test a Tool</h3>
      <div class="form-group"><label>Tool Name</label>
        <select id="mcp-tool-sel" class="form-control">
          <option value="">Loading…</option>
        </select>
      </div>
      <div class="form-group"><label>Arguments (JSON)</label>
        <textarea id="mcp-args" class="form-control" rows="5" placeholder='{"query": "competitors"}'>{}</textarea>
      </div>
      <button id="mcp-call" class="btn btn-primary" style="width:100%">🚀 Call Tool</button>
      <div id="mcp-result" style="margin-top:14px;font-size:0.82rem"></div>
    </div>
    <div class="ig-card" style="margin-top:16px">
      <h3 style="margin:0 0 12px;font-size:1rem">📚 Integration Guides</h3>
      <div style="display:grid;gap:10px">
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px">
          <div style="font-weight:700;font-size:0.85rem;margin-bottom:4px">Claude (Anthropic)</div>
          <code style="font-size:0.75rem;background:#f8fafc;padding:6px 10px;border-radius:5px;display:block;color:#374151">mcp install --url ${location.origin}/api/mcp</code>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px">
          <div style="font-weight:700;font-size:0.85rem;margin-bottom:4px">OpenAI Agents SDK</div>
          <code style="font-size:0.75rem;background:#f8fafc;padding:6px 10px;border-radius:5px;display:block;color:#374151">MCPServerSse(url="${location.origin}/api/mcp")</code>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px">
          <div style="font-weight:700;font-size:0.85rem;margin-bottom:4px">Direct HTTP</div>
          <code style="font-size:0.75rem;background:#f8fafc;padding:6px 10px;border-radius:5px;display:block;color:#374151">POST ${location.origin}/api/mcp/call</code>
        </div>
      </div>
    </div>
  </div>
</div>`;

  async function _loadMcp() {
    const [manifest, tools] = await Promise.all([
      _api('GET', '/api/mcp'),
      _api('GET', '/api/mcp/tools'),
    ]);
    if (manifest.ok !== false) {
      document.getElementById('mcp-info').innerHTML = `
        <div style="display:grid;gap:8px">
          <div><span style="font-size:0.78rem;color:#6b7280;font-weight:700">SERVER NAME</span><div style="font-weight:600">${_e(manifest.name||'InfoGenie MCP')}</div></div>
          <div><span style="font-size:0.78rem;color:#6b7280;font-weight:700">VERSION</span><div style="font-weight:600">${_e(manifest.version||'1.0')}</div></div>
          <div><span style="font-size:0.78rem;color:#6b7280;font-weight:700">ENDPOINT</span><code style="font-size:0.78rem;background:#f8fafc;padding:4px 8px;border-radius:4px">${location.origin}/api/mcp</code></div>
          <div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block"></span><span style="font-size:0.85rem;color:#15803d;font-weight:600">Server Online</span></div>
        </div>`;
    }
    if (tools.ok !== false && Array.isArray(tools.tools)) {
      const toolList = tools.tools;
      document.getElementById('mcp-tools').innerHTML = toolList.map(t => `
        <div style="border:1px solid #e2e8f0;border-radius:7px;padding:9px 12px;margin-bottom:8px">
          <div style="font-weight:700;font-size:0.85rem;color:#4f46e5">${_e(t.name)}</div>
          <div style="font-size:0.78rem;color:#6b7280;margin-top:2px">${_e(t.description)}</div>
          ${t.inputSchema?.properties ? `<div style="font-size:0.72rem;color:#9ca3af;margin-top:4px">Params: ${Object.keys(t.inputSchema.properties).join(', ')}</div>` : ''}
        </div>`).join('');
      const sel = document.getElementById('mcp-tool-sel');
      sel.innerHTML = toolList.map(t => `<option value="${_e(t.name)}">${_e(t.name)}</option>`).join('');
      sel.onchange = () => {
        const tool = toolList.find(t => t.name === sel.value);
        if (!tool?.inputSchema?.properties) { document.getElementById('mcp-args').value = '{}'; return; }
        const sample = {};
        Object.entries(tool.inputSchema.properties).forEach(([k, v]) => {
          sample[k] = v.example ?? (v.type === 'number' ? 0 : v.type === 'boolean' ? false : '');
        });
        document.getElementById('mcp-args').value = JSON.stringify(sample, null, 2);
      };
    }
  }

  document.getElementById('mcp-call').onclick = async () => {
    const name = document.getElementById('mcp-tool-sel').value;
    let args;
    try { args = JSON.parse(document.getElementById('mcp-args').value || '{}'); }
    catch { _toast('Invalid JSON in arguments', 'error'); return; }
    const btn = document.getElementById('mcp-call');
    btn.disabled = true; btn.textContent = '⏳ Calling…';
    const d = await _api('POST', '/api/mcp/call', { name, arguments: args });
    btn.disabled = false; btn.textContent = '🚀 Call Tool';
    const result = document.getElementById('mcp-result');
    if (d.ok) {
      result.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px">
        <div style="font-weight:700;color:#15803d;margin-bottom:8px">✅ Result</div>
        <pre style="margin:0;font-size:0.78rem;overflow-x:auto;white-space:pre-wrap;color:#374151">${_e(JSON.stringify(d.result, null, 2))}</pre>
      </div>`;
    } else {
      result.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;color:#b91c1c;font-size:0.82rem">⚠️ ${_e(d.error || 'Tool call failed')}</div>`;
    }
  };

  _loadMcp();
};

/* ═══════════════════════════════════════════════════════════════════════════
   F03 — Smart Send Time Optimizer
   ════════════════════════════════════════════════════════════════════════ */
window.buildSmartSend = function () {
  const el = document.getElementById('view-smart-send');
  if (!el) return;
  el.innerHTML = `
<div class="view-header">
  <h2>⏰ Smart Send Time Optimizer</h2>
  <p class="view-sub">Analyse your contacts' engagement history and recommend the optimal UTC send hour per contact — powered by real open/click data.</p>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1100px">
  <div class="ig-card">
    <h3 style="margin:0 0 14px;font-size:1rem">Contact Emails</h3>
    <p style="font-size:0.82rem;color:#6b7280;margin:0 0 10px">One email per line.</p>
    <textarea id="ss-contacts" class="form-control" rows="6" placeholder="alice@example.com&#10;bob@example.com&#10;carol@example.com"></textarea>
    <h3 style="margin:18px 0 10px;font-size:1rem">Engagement History (JSON)</h3>
    <p style="font-size:0.82rem;color:#6b7280;margin:0 0 10px">Array of <code>{"email","opened_at","clicked_at"}</code> records. Leave blank to use population-level defaults.</p>
    <textarea id="ss-history" class="form-control" rows="5" placeholder='[{"email":"alice@example.com","opened_at":"2026-06-01T09:15:00Z"},{"email":"alice@example.com","clicked_at":"2026-06-03T08:45:00Z"}]'></textarea>
    <button id="ss-run" class="btn btn-primary" style="margin-top:14px;width:100%">⚡ Calculate Best Send Times</button>
  </div>
  <div class="ig-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h3 style="margin:0;font-size:1rem">Recommendations</h3>
      <span id="ss-pop-best" style="font-size:0.82rem;color:#6b7280"></span>
    </div>
    <div id="ss-results">${_empty('Enter contacts and click Calculate.')}</div>
  </div>
</div>`;

  document.getElementById('ss-run').onclick = async () => {
    const raw = document.getElementById('ss-contacts').value.trim();
    const contacts = raw.split('\n').map(e => e.trim()).filter(Boolean).map(e => ({ email: e }));
    if (!contacts.length) { _toast('Enter at least one email.', 'error'); return; }
    let history = [];
    const hRaw = document.getElementById('ss-history').value.trim();
    if (hRaw) { try { history = JSON.parse(hRaw); } catch (_) { _toast('History JSON is invalid.', 'error'); return; } }
    const btn = document.getElementById('ss-run');
    btn.disabled = true; btn.textContent = '⏳ Calculating…';
    const d = await _api('POST', '/api/drips/smart-send-time', { contacts, history });
    btn.disabled = false; btn.textContent = '⚡ Calculate Best Send Times';
    if (!d.ok) { _toast(d.error || 'Error', 'error'); return; }
    document.getElementById('ss-pop-best').textContent = `Population best: ${d.population_best_time}`;
    const rows = d.recommendations || [];
    document.getElementById('ss-results').innerHTML = rows.length ? `
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        <thead><tr style="border-bottom:2px solid #e2e8f0">
          <th style="text-align:left;padding:6px 8px">Email</th>
          <th style="text-align:center;padding:6px 8px">Best Hour (UTC)</th>
          <th style="text-align:center;padding:6px 8px">Confidence</th>
          <th style="text-align:center;padding:6px 8px">Signals</th>
        </tr></thead>
        <tbody>${rows.map(r => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:6px 8px">${_e(r.email)}</td>
          <td style="text-align:center;font-weight:700;color:#6366f1">${_e(r.preferred_send_time)}</td>
          <td style="text-align:center">${_badge(r.confidence, r.confidence === 'personalized' ? '#10b981' : '#94a3b8')}</td>
          <td style="text-align:center;color:#6b7280">${r.signals_used}</td>
        </tr>`).join('')}</tbody>
      </table>` : _empty('No results.');
  };
};

/* ═══════════════════════════════════════════════════════════════════════════
   F08 — AI Segment Suggestions
   ════════════════════════════════════════════════════════════════════════ */
window.buildAiSegments = function () {
  const el = document.getElementById('view-ai-segments');
  if (!el) return;
  el.innerHTML = `
<div class="view-header">
  <h2>🧠 AI Segment Suggestions</h2>
  <p class="view-sub">Let AI analyse your existing audiences and propose new high-value segments you haven't thought of yet.</p>
</div>
<div style="max-width:900px">
  <div class="ig-card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <p style="margin:0;font-size:0.88rem;color:#374151">AI reviews your existing segments and suggests 5 complementary audiences with rationale and rule templates.</p>
      <button id="ais-run" class="btn btn-primary" style="padding:10px 22px;white-space:nowrap">🤖 Suggest Segments</button>
    </div>
    <div id="ais-loading" style="display:none">${_spinner()}</div>
  </div>
  <div id="ais-results"></div>
</div>`;

  document.getElementById('ais-run').onclick = async () => {
    const btn = document.getElementById('ais-run');
    btn.disabled = true; btn.textContent = '⏳ Analysing…';
    document.getElementById('ais-loading').style.display = 'block';
    document.getElementById('ais-results').innerHTML = '';
    const d = await _api('POST', '/api/audiences/ai-suggest', {});
    btn.disabled = false; btn.textContent = '🤖 Suggest Segments';
    document.getElementById('ais-loading').style.display = 'none';
    if (!d.ok) { _toast(d.error || 'Error', 'error'); return; }
    const suggs = d.suggestions || [];
    if (!suggs.length) { document.getElementById('ais-results').innerHTML = _empty('No suggestions returned.'); return; }
    document.getElementById('ais-results').innerHTML = suggs.map((s, i) => `
      <div class="ig-card" style="margin-bottom:12px;border-left:4px solid #6366f1">
        <div style="display:flex;align-items:start;gap:12px">
          <div style="font-size:1.5rem">${['🎯','👥','💡','🔥','⭐'][i] || '📌'}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px">${_e(s.name)}</div>
            <div style="font-size:0.85rem;color:#374151;margin-bottom:6px">${_e(s.description)}</div>
            <div style="font-size:0.8rem;color:#6b7280;font-style:italic;margin-bottom:8px">💡 ${_e(s.rationale)}</div>
            ${s.rules?.conditions?.length ? `<div style="font-size:0.78rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px;font-family:monospace">${JSON.stringify(s.rules, null, 2).slice(0,200)}</div>` : ''}
          </div>
        </div>
      </div>`).join('');
  };
};

/* ═══════════════════════════════════════════════════════════════════════════
   F02 — Audience → Ad Platform Sync
   ════════════════════════════════════════════════════════════════════════ */
window.buildAudienceAdSync = function () {
  const el = document.getElementById('view-audience-ad-sync');
  if (!el) return;
  el.innerHTML = `
<div class="view-header">
  <h2>📡 Audience → Ad Platform Sync</h2>
  <p class="view-sub">Push your InfoGenie segments directly to Meta Custom Audiences or Google Customer Match for paid retargeting.</p>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1100px">
  <div class="ig-card">
    <h3 style="margin:0 0 14px;font-size:1rem">Sync a Segment</h3>
    <div class="form-group">
      <label>Segment ID</label>
      <input id="ads-seg-id" class="form-control" placeholder="e.g. 42 — get IDs from Dynamic Audiences">
    </div>
    <div class="form-group">
      <label>Platform</label>
      <select id="ads-platform" class="form-control">
        <option value="meta">Meta (Facebook / Instagram)</option>
        <option value="google">Google Customer Match</option>
      </select>
    </div>
    <button id="ads-sync" class="btn btn-primary" style="width:100%;margin-top:8px">🚀 Sync to Ad Platform</button>
    <div id="ads-result" style="margin-top:14px"></div>
  </div>
  <div class="ig-card">
    <h3 style="margin:0 0 14px;font-size:1rem">Sync Status</h3>
    <div class="form-group">
      <label>Check Segment ID</label>
      <input id="ads-status-id" class="form-control" placeholder="Segment ID">
    </div>
    <button id="ads-status-btn" style="padding:8px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85rem">🔍 Check Status</button>
    <div id="ads-status-result" style="margin-top:14px">${_empty('Enter a segment ID to check sync status.')}</div>
  </div>
</div>`;

  document.getElementById('ads-sync').onclick = async () => {
    const segId = document.getElementById('ads-seg-id').value.trim();
    const platform = document.getElementById('ads-platform').value;
    if (!segId) { _toast('Enter a segment ID.', 'error'); return; }
    const btn = document.getElementById('ads-sync');
    btn.disabled = true; btn.textContent = '⏳ Syncing…';
    const d = await _api('POST', `/api/audiences/${segId}/sync-ads`, { platform });
    btn.disabled = false; btn.textContent = '🚀 Sync to Ad Platform';
    const out = document.getElementById('ads-result');
    if (d.ok) {
      out.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px">
        <div style="font-weight:700;color:#15803d;margin-bottom:8px">✅ Sync Complete</div>
        <div style="font-size:0.85rem;color:#374151">${_e(d.note || `${d.synced} contacts pushed to ${platform}`)}</div>
        ${d.audience_name ? `<div style="font-size:0.82rem;color:#6b7280;margin-top:4px">Audience: <strong>${_e(d.audience_name)}</strong></div>` : ''}
        ${d.instructions ? `<div style="font-size:0.8rem;color:#6b7280;margin-top:8px;font-style:italic">${_e(d.instructions)}</div>` : ''}
      </div>`;
      _toast('Sync complete!');
    } else {
      out.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;color:#b91c1c;font-size:0.85rem">⚠️ ${_e(d.error || 'Sync failed')}</div>`;
    }
  };

  document.getElementById('ads-status-btn').onclick = async () => {
    const segId = document.getElementById('ads-status-id').value.trim();
    if (!segId) { _toast('Enter a segment ID.', 'error'); return; }
    const d = await _api('GET', `/api/audiences/${segId}/sync-ads`);
    const out = document.getElementById('ads-status-result');
    if (!d.ok) { out.innerHTML = `<div style="color:#b91c1c;font-size:0.85rem">⚠️ ${_e(d.error || 'Error')}</div>`; return; }
    out.innerHTML = `<div style="font-size:0.85rem">
      <div style="margin-bottom:6px"><strong>${d.member_count || 0}</strong> members eligible for sync</div>
      <div style="color:#6b7280">Meta creds: ${d.meta_configured ? '✅ Configured' : '❌ Not configured'}</div>
      <div style="color:#6b7280">Google creds: ${d.google_configured ? '✅ Configured' : '❌ Not configured'}</div>
    </div>`;
  };
};

/* ═══════════════════════════════════════════════════════════════════════════
   F12 — AI Campaign Translator
   ════════════════════════════════════════════════════════════════════════ */
window.buildTranslation = function () {
  const el = document.getElementById('view-translate');
  if (!el) return;
  el.innerHTML = `
<div class="view-header">
  <h2>🌍 AI Campaign Translator</h2>
  <p class="view-sub">Translate an entire drip sequence to any language while preserving your brand voice, placeholders, and formatting.</p>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1200px">
  <div>
    <div class="ig-card" style="margin-bottom:16px">
      <h3 style="margin:0 0 14px;font-size:1rem">Source Sequence</h3>
      <div style="display:flex;gap:10px;margin-bottom:12px">
        <div class="form-group" style="flex:1;margin:0"><label>Target Language</label><input id="tr-lang" class="form-control" placeholder="e.g. Spanish, French, German, Japanese"></div>
        <div class="form-group" style="flex:1;margin:0"><label>Brand Name</label><input id="tr-brand" class="form-control" placeholder="Your brand name"></div>
      </div>
      <div id="tr-steps"></div>
      <button id="tr-add-step" style="margin-top:8px;padding:7px 16px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;cursor:pointer;font-weight:600;font-size:0.85rem">+ Add Email Step</button>
      <button id="tr-translate" class="btn btn-primary" style="margin-top:12px;width:100%">🌍 Translate All Steps</button>
    </div>
  </div>
  <div>
    <div class="ig-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3 style="margin:0;font-size:1rem">Translated Sequence</h3>
        <button id="tr-copy" style="padding:5px 12px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:0.82rem" disabled>📋 Copy JSON</button>
      </div>
      <div id="tr-results">${_empty('Paste your drip steps on the left and click Translate.')}</div>
    </div>
  </div>
</div>`;

  const steps = [{ subject: '', body: '' }];
  let lastTranslated = null;

  function _renderSteps() {
    document.getElementById('tr-steps').innerHTML = steps.map((s, i) => `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-weight:700;font-size:0.82rem;color:#374151">Step ${i + 1}</span>
          ${i > 0 ? `<button data-del-step="${i}" style="padding:2px 8px;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:0.78rem">✕</button>` : ''}
        </div>
        <input data-si="${i}" data-sk="subject" value="${_e(s.subject)}" placeholder="Subject line…" class="form-control" style="margin-bottom:6px;font-size:0.85rem">
        <textarea data-si="${i}" data-sk="body" rows="3" placeholder="Email body…" class="form-control" style="font-size:0.85rem">${_e(s.body)}</textarea>
      </div>`).join('');
    document.querySelectorAll('[data-si]').forEach(el => {
      el.oninput = () => { steps[+el.dataset.si][el.dataset.sk] = el.value; };
    });
    document.querySelectorAll('[data-del-step]').forEach(b => {
      b.onclick = () => { steps.splice(+b.dataset.delStep, 1); _renderSteps(); };
    });
  }
  _renderSteps();

  document.getElementById('tr-add-step').onclick = () => { steps.push({ subject: '', body: '' }); _renderSteps(); };

  document.getElementById('tr-translate').onclick = async () => {
    const lang = document.getElementById('tr-lang').value.trim();
    if (!lang) { _toast('Enter a target language.', 'error'); return; }
    const seq = steps.filter(s => s.subject || s.body);
    if (!seq.length) { _toast('Add at least one step with content.', 'error'); return; }
    const btn = document.getElementById('tr-translate');
    btn.disabled = true; btn.textContent = '⏳ Translating…';
    const d = await _api('POST', '/api/drips/translate', { sequence: seq, target_language: lang, brand_name: document.getElementById('tr-brand').value.trim() });
    btn.disabled = false; btn.textContent = '🌍 Translate All Steps';
    if (!d.ok) { _toast(d.error || 'Translation failed', 'error'); return; }
    lastTranslated = d.translated_sequence;
    document.getElementById('tr-copy').disabled = false;
    document.getElementById('tr-results').innerHTML = (d.translated_sequence || []).map((s, i) => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:10px">
        <div style="font-weight:700;font-size:0.82rem;color:#374151;margin-bottom:6px">Step ${i + 1} → ${_e(d.target_language)}</div>
        <div style="font-size:0.85rem;font-weight:600;color:#6366f1;margin-bottom:4px">${_e(s.subject)}</div>
        <div style="font-size:0.83rem;color:#374151;white-space:pre-wrap">${_e(s.body)}</div>
      </div>`).join('');
    _toast(`${d.step_count} steps translated to ${d.target_language}!`);
  };

  document.getElementById('tr-copy').onclick = () => {
    if (!lastTranslated) return;
    navigator.clipboard.writeText(JSON.stringify(lastTranslated, null, 2)).then(() => _toast('Copied!'));
  };
};

/* ═══════════════════════════════════════════════════════════════════════════
   F09 — Inbox Placement Monitor
   ════════════════════════════════════════════════════════════════════════ */
window.buildInboxMonitor = function () {
  const el = document.getElementById('view-inbox-monitor');
  if (!el) return;
  el.innerHTML = `
<div class="view-header">
  <h2>📬 Inbox Placement Monitor</h2>
  <p class="view-sub">Analyse a campaign's inbox placement across major providers (Gmail, Outlook, Yahoo) and get AI-powered deliverability recommendations.</p>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1100px">
  <div class="ig-card">
    <h3 style="margin:0 0 14px;font-size:1rem">Analyse Campaign</h3>
    <div class="form-group"><label>Campaign ID</label><input id="im-camp-id" class="form-control" placeholder="e.g. 42"></div>
    <div class="form-group"><label>From Address</label><input id="im-from" class="form-control" placeholder="hello@yourdomain.com" type="email"></div>
    <div class="form-group"><label>Subject Line</label><input id="im-subject" class="form-control" placeholder="Your email subject…"></div>
    <div class="form-group"><label>Sample Send Volume</label><input id="im-volume" class="form-control" placeholder="e.g. 5000" type="number"></div>
    <button id="im-run" class="btn btn-primary" style="width:100%">🔍 Analyse Placement</button>
  </div>
  <div class="ig-card">
    <h3 style="margin:0 0 14px;font-size:1rem">Results</h3>
    <div id="im-results">${_empty('Fill in campaign details and click Analyse.')}</div>
  </div>
</div>`;

  document.getElementById('im-run').onclick = async () => {
    const campaign_id = document.getElementById('im-camp-id').value.trim();
    const from_address = document.getElementById('im-from').value.trim();
    const subject = document.getElementById('im-subject').value.trim();
    const volume = parseInt(document.getElementById('im-volume').value) || 0;
    if (!from_address) { _toast('Enter a from address.', 'error'); return; }
    const btn = document.getElementById('im-run');
    btn.disabled = true; btn.textContent = '⏳ Analysing…';
    const d = await _api('POST', '/api/deliverability/campaign-monitor', { campaign_id, from_address, subject, volume });
    btn.disabled = false; btn.textContent = '🔍 Analyse Placement';
    const out = document.getElementById('im-results');
    if (!d.ok) { out.innerHTML = `<div style="color:#b91c1c;font-size:0.85rem">⚠️ ${_e(d.error || 'Error')}</div>`; return; }
    const placement = d.placement || {};
    const score = d.score ?? d.deliverability_score ?? '—';
    const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
    out.innerHTML = `
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:2.5rem;font-weight:900;color:${scoreColor}">${score}</div>
        <div style="font-size:0.82rem;color:#6b7280">Deliverability Score</div>
      </div>
      ${Object.entries(placement).length ? `
        <div style="margin-bottom:14px">
          <div style="font-weight:700;font-size:0.85rem;margin-bottom:8px">Placement by Provider</div>
          ${Object.entries(placement).map(([prov, pct]) => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.82rem">
              <span style="width:80px">${_e(prov)}</span>
              <div style="flex:1;background:#f1f5f9;border-radius:4px;height:8px">
                <div style="width:${Math.min(100, Math.round(pct))}%;height:100%;background:${pct > 70 ? '#10b981' : pct > 40 ? '#f59e0b' : '#ef4444'};border-radius:4px"></div>
              </div>
              <span style="font-weight:600">${Math.round(pct)}%</span>
            </div>`).join('')}
        </div>` : ''}
      ${d.issues?.length ? `<div style="margin-bottom:12px"><div style="font-weight:700;font-size:0.85rem;margin-bottom:6px">⚠️ Issues Detected</div>${d.issues.map(i => `<div style="font-size:0.82rem;color:#dc2626;margin-bottom:3px">• ${_e(i)}</div>`).join('')}</div>` : ''}
      ${d.recommendations?.length ? `<div><div style="font-weight:700;font-size:0.85rem;margin-bottom:6px">✅ Recommendations</div>${d.recommendations.map(r => `<div style="font-size:0.82rem;color:#15803d;margin-bottom:3px">• ${_e(r)}</div>`).join('')}</div>` : ''}`;
  };
};

/* ═══════════════════════════════════════════════════════════════════════════
   F13 — Asset Comments Widget
   ════════════════════════════════════════════════════════════════════════ */
window.initAssetComments = function (assetType, assetId, mountEl) {
  if (!mountEl) return;
  const REACTIONS = ['👍', '❤️', '🎉', '🚀', '✅'];
  mountEl.innerHTML = `
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;background:#fff">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h4 style="margin:0;font-size:0.92rem">💬 Comments</h4>
        <button id="ac-refresh" style="padding:4px 10px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:5px;cursor:pointer;font-size:0.78rem">🔄</button>
      </div>
      <div id="ac-list" style="max-height:320px;overflow-y:auto;margin-bottom:12px">${_spinner()}</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <textarea id="ac-body" class="form-control" rows="2" placeholder="Add a comment…" style="font-size:0.83rem"></textarea>
        <button id="ac-post" class="btn btn-primary" style="padding:7px 16px;font-size:0.85rem;align-self:flex-end">Post</button>
      </div>
    </div>`;

  async function _load() {
    const d = await _api('GET', `/api/comments?asset_type=${encodeURIComponent(assetType)}&asset_id=${encodeURIComponent(assetId)}`);
    const list = mountEl.querySelector('#ac-list');
    if (!d.ok || !d.comments?.length) { list.innerHTML = _empty('No comments yet. Be the first!'); return; }
    list.innerHTML = d.comments.map(c => `
      <div data-cid="${c.id}" style="border-bottom:1px solid #f1f5f9;padding:8px 0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span style="font-weight:700;font-size:0.82rem">${_e(c.author_name || c.author_email || 'Team member')}</span>
          <span style="font-size:0.74rem;color:#94a3b8">${new Date(c.created_at).toLocaleString()}</span>
          ${c.edited_at ? '<span style="font-size:0.72rem;color:#94a3b8">(edited)</span>' : ''}
        </div>
        <div style="font-size:0.85rem;color:#374151;margin-bottom:5px">${_e(c.body)}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${REACTIONS.map(emoji => {
            const cnt = c.reactions?.[emoji] || 0;
            return `<button data-react="${emoji}" data-rcid="${c.id}" style="padding:2px 6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font-size:0.78rem">${emoji}${cnt > 0 ? ` ${cnt}` : ''}</button>`;
          }).join('')}
          <button data-del-c="${c.id}" style="margin-left:auto;padding:2px 6px;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:0.75rem">Delete</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-react]').forEach(btn => {
      btn.onclick = async () => {
        await _api('POST', `/api/comments/${btn.dataset.rcid}/react`, { emoji: btn.dataset.react });
        _load();
      };
    });
    list.querySelectorAll('[data-del-c]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this comment?')) return;
        const r = await _api('DELETE', `/api/comments/${btn.dataset.delC}`);
        if (r.ok) _load(); else _toast(r.error || 'Error', 'error');
      };
    });
  }

  mountEl.querySelector('#ac-post').onclick = async () => {
    const body = mountEl.querySelector('#ac-body').value.trim();
    if (!body) return;
    const r = await _api('POST', '/api/comments', { asset_type: assetType, asset_id: String(assetId), body });
    if (r.ok) { mountEl.querySelector('#ac-body').value = ''; _load(); }
    else _toast(r.error || 'Error', 'error');
  };
  mountEl.querySelector('#ac-refresh').onclick = _load;
  _load();
};

/* ═══════════════════════════════════════════════════════════════════════════
   Register view builders with the SPA router
   ════════════════════════════════════════════════════════════════════════ */
(function _registerViews() {
  const MAP = {
    'surveys':           window.buildSurveys,
    'email-designer':    window.buildEmailDesigner,
    'mcp-server':        window.buildMcpServer,
    'smart-send':        window.buildSmartSend,
    'ai-segments':       window.buildAiSegments,
    'audience-ad-sync':  window.buildAudienceAdSync,
    'translate':         window.buildTranslation,
    'inbox-monitor':     window.buildInboxMonitor,
  };

  // Hook into the SPA navigation event emitted by ig_journey_omnichannel and
  // other modules. The main app dispatches 'ig:navigate' or sets data-view.
  function _tryNav(view) {
    if (MAP[view]) { MAP[view](); return true; }
    return false;
  }

  // Listen for the custom navigation event used by the nav bridge
  window.addEventListener('ig:spa-navigate', ev => {
    if (ev.detail?.view) _tryNav(ev.detail.view);
  });

  // Intercept nav-link clicks on our views
  document.addEventListener('click', ev => {
    const link = ev.target.closest('[data-view]');
    if (!link) return;
    const view = link.dataset.view;
    if (!MAP[view]) return;
    // Show the target panel and hide others
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById('view-' + view);
    if (target) {
      target.classList.remove('hidden');
      MAP[view]();
    }
    // Update active nav state
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    ev.preventDefault();
  }, true);

  // Patch navigateTo: call _origNav first so app.js handles view show/hide
  // (it uses style.display, not just CSS classes), then run the CE builder
  // on top to populate the panel — same pattern as ig_strategic_features.js.
  const _origNav = window.navigateTo;
  window.navigateTo = function(view, ...rest) {
    if (typeof _origNav === 'function') _origNav.call(this, view, ...rest);
    _tryNav(view);
  };
})();

})(); // end IIFE
