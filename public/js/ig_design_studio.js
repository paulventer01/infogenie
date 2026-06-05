/* ============================================================
   InfoGenie — Design Studio (T56-T59)
   Pitch Deck Builder · WCAG Accessibility Audit · Wireframe Generator
   ============================================================ */

(function () {
  'use strict';

  // ── Shared helpers ──────────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _apiFetch(path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  }
  function _loading(el, msg) {
    el.innerHTML = `<div style="text-align:center;padding:64px 24px">
      <div class="ig-spinner" style="width:40px;height:40px;border:4px solid #E5E7EB;border-top-color:#6366F1;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px"></div>
      <p style="color:#64748B;font-size:14px">${_esc(msg || 'Working…')}</p>
    </div>`;
  }
  function _toast(msg, ok) {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${ok===false?'#EF4444':'#22C55E'};color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18)`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }
  function _severityColor(s) {
    return { critical:'#EF4444', serious:'#F97316', moderate:'#F59E0B', minor:'#6366F1' }[s] || '#94A3B8';
  }
  function _severityBg(s) {
    return { critical:'#FEF2F2', serious:'#FFF7ED', moderate:'#FFFBEB', minor:'#EEF2FF' }[s] || '#F8FAFC';
  }
  function _scoreColor(n) {
    if (n >= 85) return '#22C55E';
    if (n >= 60) return '#F59E0B';
    return '#EF4444';
  }
  function _scoreLabel(n) {
    if (n >= 85) return 'Good';
    if (n >= 60) return 'Needs Work';
    return 'Poor';
  }
  function _cardStyle(extra) {
    return `background:#fff;border-radius:16px;border:1.5px solid #E2E8F0;padding:28px 32px;margin-bottom:24px;${extra||''}`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  T56 — PITCH DECK BUILDER
  // ══════════════════════════════════════════════════════════════════════════
  window.buildPitchDeck = function () {
    const wrap = document.getElementById('pitchDeckWrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <div style="${_cardStyle()}">
        <h3 style="font-size:18px;font-weight:700;color:#1E293B;margin:0 0 6px">Generate Your Pitch Deck</h3>
        <p style="color:#64748B;font-size:14px;margin:0 0 24px">Fill in the details below and get a fully-structured deck with speaker notes — exported as a polished PPTX.</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Brand / Company Name *</label>
            <input id="pd-brand" type="text" placeholder="e.g. InfoGenie" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none">
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Deck Goal</label>
            <select id="pd-goal" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none;background:#fff">
              <option value="investor">🏦 Investor Pitch</option>
              <option value="sales">🤝 Sales Deck</option>
              <option value="marketing">📣 Marketing / Brand Story</option>
              <option value="product">🚀 Product Demo / Launch</option>
              <option value="internal">🏢 Internal Strategy / OKRs</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom:16px">
          <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Product / Service Description *</label>
          <textarea id="pd-product" rows="3" placeholder="What does your company do? Who is it for? What's the core value proposition?" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none;resize:vertical"></textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Target Audience</label>
            <input id="pd-audience" type="text" placeholder="e.g. Marketing teams at Series B SaaS" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none">
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Number of Slides</label>
            <select id="pd-slides" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none;background:#fff">
              <option value="8">8 slides (concise)</option>
              <option value="10">10 slides</option>
              <option value="12" selected>12 slides (recommended)</option>
              <option value="15">15 slides (detailed)</option>
              <option value="18">18 slides (comprehensive)</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom:24px">
          <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Additional context <span style="font-weight:400;color:#94A3B8">(optional)</span></label>
          <input id="pd-extra" type="text" placeholder="e.g. raising $2M, 32 customers, NPS 72, closing June 30" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none">
        </div>

        <button id="pd-generate-btn" style="background:#6366F1;color:#fff;border:none;border-radius:10px;padding:13px 28px;font-size:15px;font-weight:700;cursor:pointer">
          📊 Generate Pitch Deck
        </button>
      </div>

      <div id="pd-result" style="margin-top:8px"></div>
      <div id="pd-history-wrap" style="margin-top:24px"></div>
    `;

    document.getElementById('pd-generate-btn').addEventListener('click', _generateDeck);
    _loadDeckHistory();
  };

  async function _generateDeck() {
    const wrap  = document.getElementById('pd-result');
    const brand    = document.getElementById('pd-brand').value.trim();
    const product  = document.getElementById('pd-product').value.trim();
    const goal     = document.getElementById('pd-goal').value;
    const audience = document.getElementById('pd-audience').value.trim();
    const extra    = document.getElementById('pd-extra').value.trim();
    const num_slides = parseInt(document.getElementById('pd-slides').value, 10);

    if (!brand && !product) { _toast('Enter a brand name or product description first.', false); return; }

    _loading(wrap, 'Building your pitch deck… this takes 20-30 seconds');
    document.getElementById('pd-generate-btn').disabled = true;

    try {
      const r = await _apiFetch('/api/pitch-deck/generate', {
        method: 'POST',
        body: JSON.stringify({ brand, product, goal, audience, extra, num_slides }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Generation failed');
      _renderDeckResult(wrap, data);
      _loadDeckHistory();
    } catch (e) {
      wrap.innerHTML = `<div style="background:#FEF2F2;border:1.5px solid #FECACA;border-radius:12px;padding:20px;color:#DC2626">${_esc(e.message)}</div>`;
    } finally {
      document.getElementById('pd-generate-btn').disabled = false;
    }
  }

  function _renderDeckResult(wrap, data) {
    const slides = data.slides || [];
    const typeEmoji = { title:'🎯', problem:'💔', solution:'✅', market:'📈', product:'🚀', how_it_works:'⚙️', traction:'📊', business_model:'💰', team:'👥', roadmap:'🗺️', cta:'🎯', custom:'📌' };

    wrap.innerHTML = `
      <div style="${_cardStyle()}">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
          <div>
            <h3 style="font-size:20px;font-weight:800;color:#1E293B;margin:0 0 4px">${_esc(data.deck_title)}</h3>
            ${data.tagline ? `<p style="color:#6366F1;font-size:14px;font-weight:600;margin:0">"${_esc(data.tagline)}"</p>` : ''}
          </div>
          <button id="pd-export-btn" data-id="${data.id||''}" style="background:#22C55E;color:#fff;border:none;border-radius:10px;padding:11px 22px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px">
            ⬇️ Download PPTX
          </button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">
          ${slides.map((s, i) => `
            <div style="background:#F8FAFC;border-radius:12px;border:1.5px solid #E2E8F0;padding:16px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="background:#EEF2FF;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;color:#6366F1">${i+1}</span>
                <span style="font-size:14px">${typeEmoji[s.type]||'📌'}</span>
                <span style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase">${_esc(s.type||'slide')}</span>
              </div>
              <p style="font-size:15px;font-weight:700;color:#1E293B;margin:0 0 6px">${_esc(s.headline)}</p>
              ${s.subheadline ? `<p style="font-size:12px;color:#64748B;margin:0 0 8px;font-style:italic">${_esc(s.subheadline)}</p>` : ''}
              ${s.stat ? `<div style="font-size:22px;font-weight:800;color:#6366F1;margin:4px 0 2px">${_esc(s.stat)}</div>${s.stat_label?`<div style="font-size:11px;color:#94A3B8">${_esc(s.stat_label)}</div>`:''}` : ''}
              ${(s.bullets||[]).slice(0,3).map(b=>`<div style="font-size:12px;color:#475569;margin-top:4px;padding-left:10px;border-left:2px solid #6366F1">${_esc(b)}</div>`).join('')}
              ${s.speaker_notes ? `<details style="margin-top:8px"><summary style="font-size:11px;color:#94A3B8;cursor:pointer">📝 Speaker notes</summary><p style="font-size:11px;color:#64748B;margin:4px 0 0;line-height:1.5">${_esc(s.speaker_notes)}</p></details>` : ''}
            </div>
          `).join('')}
        </div>

        ${data.source === 'template' ? `<p style="margin-top:16px;font-size:12px;color:#94A3B8;text-align:right">⚠️ Template used (AI unavailable) — add an OpenAI key for AI-generated decks</p>` : ''}
      </div>
    `;

    document.getElementById('pd-export-btn').addEventListener('click', async () => {
      const btn = document.getElementById('pd-export-btn');
      btn.textContent = '⏳ Preparing…'; btn.disabled = true;
      try {
        const r = await _apiFetch('/api/pitch-deck/export-pptx', {
          method: 'POST',
          body: JSON.stringify({ id: data.id, slides: data.slides, deck_title: data.deck_title, tagline: data.tagline }),
        });
        if (!r.ok) throw new Error('Export failed');
        const blob = await r.blob();
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `pitch-deck-${(data.deck_title||'deck').replace(/\s+/g,'_').toLowerCase()}.pptx`;
        a.click(); URL.revokeObjectURL(url);
        _toast('PPTX downloaded!', true);
      } catch (e) { _toast('Export failed — try again', false); }
      finally { btn.textContent = '⬇️ Download PPTX'; btn.disabled = false; }
    });
  }

  async function _loadDeckHistory() {
    const hw = document.getElementById('pd-history-wrap');
    if (!hw) return;
    try {
      const r = await _apiFetch('/api/pitch-deck/history');
      const data = await r.json();
      if (!data.ok || !data.decks?.length) { hw.innerHTML = ''; return; }
      const goalLabel = { investor:'🏦 Investor', sales:'🤝 Sales', marketing:'📣 Marketing', product:'🚀 Product', internal:'🏢 Internal' };
      hw.innerHTML = `
        <div style="${_cardStyle('margin-top:0')}">
          <h4 style="font-size:15px;font-weight:700;color:#1E293B;margin:0 0 16px">Recent Decks</h4>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${data.decks.map(d => `
              <div style="display:flex;align-items:center;justify-content:space-between;background:#F8FAFC;border-radius:10px;padding:12px 16px;border:1.5px solid #E2E8F0">
                <div>
                  <span style="font-size:14px;font-weight:700;color:#1E293B">${_esc(d.deck_title)}</span>
                  <span style="margin-left:8px;font-size:11px;background:#EEF2FF;color:#6366F1;padding:2px 8px;border-radius:6px;font-weight:600">${goalLabel[d.goal]||d.goal}</span>
                  <span style="margin-left:6px;font-size:11px;color:#94A3B8">${d.slide_count} slides · ${new Date(d.created_at).toLocaleDateString()}</span>
                </div>
                <button onclick="_pdReExport(${d.id})" style="background:#F1F5F9;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;color:#374151">⬇️ PPTX</button>
              </div>
            `).join('')}
          </div>
        </div>`;
    } catch {}
  }

  window._pdReExport = async function(id) {
    try {
      const r = await _apiFetch('/api/pitch-deck/export-pptx', { method:'POST', body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error('failed');
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `pitch-deck-${id}.pptx`; a.click();
      URL.revokeObjectURL(url); _toast('PPTX downloaded!', true);
    } catch { _toast('Export failed', false); }
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  T57 — WCAG ACCESSIBILITY AUDIT
  // ══════════════════════════════════════════════════════════════════════════
  window.buildAccessibility = function () {
    const wrap = document.getElementById('accessibilityWrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <div style="${_cardStyle()}">
        <h3 style="font-size:18px;font-weight:700;color:#1E293B;margin:0 0 6px">WCAG 2.1 AA Accessibility Audit</h3>
        <p style="color:#64748B;font-size:14px;margin:0 0 20px">Enter any public URL to scan for accessibility violations — missing alt text, contrast issues, unlabelled forms, keyboard traps and more.</p>

        <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:8px">
          <div style="flex:1">
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Page URL to audit</label>
            <input id="a11y-url" type="url" placeholder="https://example.com" style="width:100%;padding:11px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none">
          </div>
          <button id="a11y-audit-btn" style="background:#6366F1;color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap">
            ♿ Run Audit
          </button>
        </div>
        <p style="font-size:12px;color:#94A3B8;margin:0">Audits use Firecrawl + AI analysis. Only public URLs are accepted.</p>
      </div>

      <div id="a11y-result" style="margin-top:8px"></div>
      <div id="a11y-history-wrap" style="margin-top:24px"></div>
    `;

    document.getElementById('a11y-audit-btn').addEventListener('click', _runAudit);
    document.getElementById('a11y-url').addEventListener('keydown', e => { if (e.key === 'Enter') _runAudit(); });
    _loadAuditHistory();
  };

  async function _runAudit() {
    const wrap = document.getElementById('a11y-result');
    const url  = document.getElementById('a11y-url').value.trim();
    if (!url) { _toast('Enter a URL first', false); return; }

    _loading(wrap, 'Fetching page and running WCAG 2.1 AA analysis… (30-60 seconds)');
    document.getElementById('a11y-audit-btn').disabled = true;

    try {
      const r = await _apiFetch('/api/accessibility/audit', { method:'POST', body: JSON.stringify({ url }) });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Audit failed');
      _renderAuditResult(wrap, data);
      _loadAuditHistory();
    } catch (e) {
      wrap.innerHTML = `<div style="background:#FEF2F2;border:1.5px solid #FECACA;border-radius:12px;padding:20px;color:#DC2626">${_esc(e.message)}</div>`;
    } finally {
      document.getElementById('a11y-audit-btn').disabled = false;
    }
  }

  function _renderAuditResult(wrap, data) {
    const issues  = data.issues || [];
    const passes  = data.passes || [];
    const wins    = data.quick_wins || [];
    const counts  = { critical:0, serious:0, moderate:0, minor:0 };
    issues.forEach(i => { if (counts[i.severity] !== undefined) counts[i.severity]++; });

    const byCategory = {};
    issues.forEach(i => {
      const k = i.category || 'other';
      if (!byCategory[k]) byCategory[k] = [];
      byCategory[k].push(i);
    });

    const catLabel = { images:'🖼️ Images', color_contrast:'🎨 Color Contrast', keyboard:'⌨️ Keyboard', forms:'📝 Forms', structure:'🏗️ Structure', links:'🔗 Links', aria:'🔊 ARIA', media:'🎬 Media', language:'🌐 Language', other:'📌 Other' };

    wrap.innerHTML = `
      <!-- Score card -->
      <div style="${_cardStyle()}">
        <div style="display:flex;align-items:center;gap:32px;flex-wrap:wrap">
          <div style="text-align:center">
            <div style="font-size:56px;font-weight:900;color:${_scoreColor(data.score)};line-height:1">${data.score}</div>
            <div style="font-size:13px;font-weight:700;color:${_scoreColor(data.score)}">${_scoreLabel(data.score)}</div>
            <div style="font-size:11px;color:#94A3B8;margin-top:2px">out of 100</div>
          </div>
          <div style="flex:1;min-width:220px">
            <div style="font-size:15px;font-weight:700;color:#1E293B;margin-bottom:8px">${_esc(data.url)}</div>
            <p style="font-size:14px;color:#475569;line-height:1.5;margin:0 0 12px">${_esc(data.summary)}</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              ${Object.entries(counts).map(([s,n])=>n?`<span style="background:${_severityBg(s)};color:${_severityColor(s)};padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700">${s}: ${n}</span>`:''
              ).join('')}
              ${issues.length === 0 ? '<span style="background:#DCFCE7;color:#16A34A;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700">✅ No issues found</span>' : ''}
            </div>
          </div>
        </div>

        ${wins.length ? `
          <div style="margin-top:20px;background:#EEF2FF;border-radius:10px;padding:14px 16px">
            <div style="font-size:12px;font-weight:700;color:#6366F1;margin-bottom:8px">⚡ QUICK WINS</div>
            ${wins.map(w=>`<div style="font-size:13px;color:#1E293B;margin-bottom:4px">• ${_esc(w)}</div>`).join('')}
          </div>` : ''}
      </div>

      <!-- Issues by category -->
      ${Object.keys(byCategory).map(cat => `
        <div style="${_cardStyle('margin-top:0')}">
          <h4 style="font-size:15px;font-weight:700;color:#1E293B;margin:0 0 16px">${catLabel[cat]||cat}</h4>
          <div style="display:flex;flex-direction:column;gap:12px">
            ${byCategory[cat].map(issue => `
              <div style="border-left:4px solid ${_severityColor(issue.severity)};padding:12px 16px;background:${_severityBg(issue.severity)};border-radius:0 10px 10px 0">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
                  <span style="background:${_severityColor(issue.severity)};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase">${_esc(issue.severity)}</span>
                  <span style="font-size:12px;font-weight:700;color:#6366F1">WCAG ${_esc(issue.id)}</span>
                  <span style="font-size:12px;color:#94A3B8">${_esc(issue.criterion)}</span>
                  <span style="font-size:11px;background:#E2E8F0;color:#475569;padding:1px 6px;border-radius:4px">Level ${_esc(issue.wcag_level)}</span>
                </div>
                <p style="font-size:14px;color:#1E293B;margin:0 0 8px;font-weight:600">${_esc(issue.description)}</p>
                ${issue.element_hint ? `<code style="font-size:12px;background:rgba(0,0,0,.06);padding:2px 6px;border-radius:4px;color:#374151">${_esc(issue.element_hint)}</code>` : ''}
                ${issue.fix ? `<div style="margin-top:8px;font-size:13px;color:#374151"><strong>Fix:</strong> ${_esc(issue.fix)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}

      <!-- What's working -->
      ${passes.length ? `
        <div style="${_cardStyle('margin-top:0')}">
          <h4 style="font-size:15px;font-weight:700;color:#16A34A;margin:0 0 12px">✅ What's Working</h4>
          ${passes.map(p=>`<div style="font-size:13px;color:#374151;padding:6px 0;border-bottom:1px solid #F1F5F9">✓ ${_esc(p)}</div>`).join('')}
        </div>` : ''}

      ${data.source === 'template' ? `<p style="font-size:12px;color:#94A3B8;text-align:right;margin-top:8px">⚠️ Structural scan only — add an OpenAI key for full AI analysis</p>` : ''}
    `;
  }

  async function _loadAuditHistory() {
    const hw = document.getElementById('a11y-history-wrap');
    if (!hw) return;
    try {
      const r = await _apiFetch('/api/accessibility/history');
      const data = await r.json();
      if (!data.ok || !data.runs?.length) { hw.innerHTML = ''; return; }
      hw.innerHTML = `
        <div style="${_cardStyle('margin-top:0')}">
          <h4 style="font-size:15px;font-weight:700;color:#1E293B;margin:0 0 16px">Recent Audits</h4>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${data.runs.map(run => `
              <div style="display:flex;align-items:center;justify-content:space-between;background:#F8FAFC;border-radius:10px;padding:10px 14px;border:1.5px solid #E2E8F0;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:180px">
                  <span style="font-size:13px;font-weight:600;color:#1E293B">${_esc(run.url)}</span>
                  <span style="margin-left:8px;font-size:11px;color:#94A3B8">${new Date(run.created_at).toLocaleDateString()}</span>
                </div>
                <div style="font-size:20px;font-weight:800;color:${_scoreColor(run.score)}">${run.score}/100</div>
              </div>`).join('')}
          </div>
        </div>`;
    } catch {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  T58 — WIREFRAME GENERATOR
  // ══════════════════════════════════════════════════════════════════════════
  window.buildWireframe = function () {
    const wrap = document.getElementById('wireframeWrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <div style="${_cardStyle()}">
        <h3 style="font-size:18px;font-weight:700;color:#1E293B;margin:0 0 6px">Generate a Wireframe</h3>
        <p style="color:#64748B;font-size:14px;margin:0 0 24px">Describe your page and get a full HTML wireframe — preview it in the browser, download as HTML, or hand it to a developer.</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Page Type</label>
            <select id="wf-type" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none;background:#fff">
              <option value="landing">🚀 Landing Page</option>
              <option value="pricing">💰 Pricing Page</option>
              <option value="about">👥 About Page</option>
              <option value="product">📦 Product Page</option>
              <option value="checkout">🛒 Checkout Page</option>
              <option value="dashboard">📊 Dashboard</option>
              <option value="blog">📝 Blog / Article</option>
              <option value="contact">✉️ Contact Page</option>
              <option value="login">🔐 Login / Sign Up</option>
              <option value="portfolio">🎨 Portfolio</option>
            </select>
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Brand / Product Name</label>
            <input id="wf-brand" type="text" placeholder="e.g. InfoGenie" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none">
          </div>
        </div>

        <div style="margin-bottom:16px">
          <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Page Description</label>
          <textarea id="wf-desc" rows="3" placeholder="e.g. SaaS pricing page with 3 tiers (Starter $29, Pro $79, Enterprise custom), monthly/annual toggle, most popular badge on Pro, feature comparison table below, FAQ section" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none;resize:vertical"></textarea>
        </div>

        <div style="display:flex;gap:16px;align-items:center;margin-bottom:24px">
          <div style="flex:1">
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Specific sections to include <span style="font-weight:400;color:#94A3B8">(optional)</span></label>
            <input id="wf-sections" type="text" placeholder="e.g. hero, features grid, testimonials, FAQ, CTA" style="width:100%;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#1E293B;outline:none">
          </div>
          <div style="padding-top:24px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;color:#374151">
              <input id="wf-mobile" type="checkbox" style="width:16px;height:16px;accent-color:#6366F1">
              📱 Mobile layout
            </label>
          </div>
        </div>

        <button id="wf-generate-btn" style="background:#6366F1;color:#fff;border:none;border-radius:10px;padding:13px 28px;font-size:15px;font-weight:700;cursor:pointer">
          📐 Generate Wireframe
        </button>
      </div>

      <div id="wf-result" style="margin-top:8px"></div>
      <div id="wf-history-wrap" style="margin-top:24px"></div>
    `;

    document.getElementById('wf-generate-btn').addEventListener('click', _generateWireframe);
    _loadWireframeHistory();
  };

  async function _generateWireframe() {
    const wrap        = document.getElementById('wf-result');
    const page_type   = document.getElementById('wf-type').value;
    const description = document.getElementById('wf-desc').value.trim();
    const brand       = document.getElementById('wf-brand').value.trim();
    const sections    = document.getElementById('wf-sections').value.trim();
    const mobile      = document.getElementById('wf-mobile').checked;

    _loading(wrap, 'Generating wireframe… this takes 20-40 seconds');
    document.getElementById('wf-generate-btn').disabled = true;

    try {
      const r = await _apiFetch('/api/wireframe/generate', {
        method:'POST',
        body: JSON.stringify({ page_type, description, brand, sections, mobile }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Generation failed');
      _renderWireframe(wrap, data);
      _loadWireframeHistory();
    } catch (e) {
      wrap.innerHTML = `<div style="background:#FEF2F2;border:1.5px solid #FECACA;border-radius:12px;padding:20px;color:#DC2626">${_esc(e.message)}</div>`;
    } finally {
      document.getElementById('wf-generate-btn').disabled = false;
    }
  }

  function _renderWireframe(wrap, data) {
    const pageLabels = { landing:'Landing Page', pricing:'Pricing Page', about:'About Page', product:'Product Page', checkout:'Checkout', dashboard:'Dashboard', blog:'Blog', contact:'Contact Page', login:'Login / Sign Up', portfolio:'Portfolio' };

    wrap.innerHTML = `
      <div style="${_cardStyle()}">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <div>
            <h3 style="font-size:18px;font-weight:700;color:#1E293B;margin:0 0 2px">${_esc(data.brand||'')} ${pageLabels[data.page_type]||data.page_type} Wireframe</h3>
            <p style="font-size:12px;color:#94A3B8;margin:0">📐 ${data.source === 'ai' ? 'AI-generated' : 'Template'} · Click Download to save as HTML</p>
          </div>
          <div style="display:flex;gap:10px">
            <button id="wf-fullscreen-btn" style="background:#F1F5F9;color:#374151;border:1.5px solid #E2E8F0;border-radius:10px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer">🖥️ Full Preview</button>
            <button id="wf-download-btn" style="background:#22C55E;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer">⬇️ Download HTML</button>
          </div>
        </div>

        <!-- Iframe preview -->
        <div style="border:2px solid #E2E8F0;border-radius:12px;overflow:hidden;background:#F8FAFC">
          <div style="background:#E2E8F0;padding:8px 12px;display:flex;align-items:center;gap:6px">
            <div style="width:10px;height:10px;border-radius:50%;background:#EF4444"></div>
            <div style="width:10px;height:10px;border-radius:50%;background:#F59E0B"></div>
            <div style="width:10px;height:10px;border-radius:50%;background:#22C55E"></div>
            <span style="font-size:11px;color:#64748B;margin-left:8px">Wireframe Preview</span>
          </div>
          <iframe id="wf-iframe" srcdoc="" style="width:100%;height:600px;border:none;background:#fff" sandbox="allow-same-origin"></iframe>
        </div>
      </div>
    `;

    // Inject into iframe safely
    const iframe = document.getElementById('wf-iframe');
    iframe.srcdoc = data.html;

    // Download
    document.getElementById('wf-download-btn').addEventListener('click', () => {
      const blob = new Blob([data.html], { type:'text/html' });
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `wireframe-${data.page_type}-${Date.now()}.html`;
      a.click(); URL.revokeObjectURL(url);
      _toast('HTML downloaded!', true);
    });

    // Full preview
    document.getElementById('wf-fullscreen-btn').addEventListener('click', () => {
      const w = window.open('', '_blank');
      w.document.write(data.html);
      w.document.close();
    });
  }

  async function _loadWireframeHistory() {
    const hw = document.getElementById('wf-history-wrap');
    if (!hw) return;
    try {
      const r = await _apiFetch('/api/wireframe/history');
      const data = await r.json();
      if (!data.ok || !data.runs?.length) { hw.innerHTML = ''; return; }
      hw.innerHTML = `
        <div style="${_cardStyle('margin-top:0')}">
          <h4 style="font-size:15px;font-weight:700;color:#1E293B;margin:0 0 16px">Recent Wireframes</h4>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${data.runs.map(run => `
              <div style="display:flex;align-items:center;justify-content:space-between;background:#F8FAFC;border-radius:10px;padding:10px 14px;border:1.5px solid #E2E8F0;gap:10px;flex-wrap:wrap">
                <div>
                  <span style="font-size:13px;font-weight:700;color:#1E293B;text-transform:capitalize">${_esc(run.page_type)}</span>
                  ${run.description ? `<span style="font-size:12px;color:#64748B;margin-left:8px">${_esc(run.description.slice(0,60))}…</span>` : ''}
                  <span style="font-size:11px;color:#94A3B8;margin-left:6px">${new Date(run.created_at).toLocaleDateString()}</span>
                </div>
                <span style="font-size:11px;background:${run.source==='ai'?'#EEF2FF':'#F1F5F9'};color:${run.source==='ai'?'#6366F1':'#94A3B8'};padding:2px 8px;border-radius:6px;font-weight:600">${run.source==='ai'?'AI':'Template'}</span>
              </div>`).join('')}
          </div>
        </div>`;
    } catch {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  T59 — VIDEO → SLIDES (Storyboard converter)
  //  Accessible from Creator Studio — button injected into storyboard result
  // ══════════════════════════════════════════════════════════════════════════
  window._exportStoryboardAsPptx = async function (frames, brand, brandColor) {
    if (!frames || !frames.length) { _toast('No storyboard frames to export', false); return; }
    try {
      const r = await _apiFetch('/api/pitch-deck/from-storyboard', {
        method:'POST',
        body: JSON.stringify({ frames, brand: brand||'', brand_color: brandColor||'#1E1B4B' }),
      });
      if (!r.ok) throw new Error('Export failed');
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `storyboard-deck-${Date.now()}.pptx`;
      a.click(); URL.revokeObjectURL(url);
      _toast('Storyboard exported as PPTX!', true);
    } catch { _toast('Export failed — try again', false); }
  };

})();
