/* ig_content_pro.js — T47-T50: WordPress Publishing · Content Modes · Autopilot · Audio Summaries
   Plain <script> globals. No bundler. Cache-busted as ?v=20260604PRO1 */
(function () {
  'use strict';

  const _esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // ── Shared: load WordPress sites for dropdowns ──────────────────────────
  let _wpSitesCache = null;
  async function _getWpSites() {
    if (_wpSitesCache) return _wpSitesCache;
    try {
      const r = await fetch('/api/wordpress/sites', { credentials: 'same-origin' }).then(x => x.json());
      _wpSitesCache = r.ok ? r.sites : [];
    } catch { _wpSitesCache = []; }
    return _wpSitesCache;
  }
  function _clearWpCache() { _wpSitesCache = null; }

  // ── Toast helper (falls back to alert if showToast not available) ────────
  function _toast(msg, type) {
    if (window.showToast) return window.showToast(msg);
    if (type === 'err') console.error(msg); else console.log(msg);
  }

  /* =========================================================================
     FEATURE 1 — WordPress Sites (rendered in Settings integrations panel)
     ========================================================================= */
  window._wpRenderSitesPanel = async function (containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '<div style="color:#6B7280;font-size:0.82rem">⏳ Loading sites…</div>';
    _clearWpCache();
    const sites = await _getWpSites();
    el.innerHTML = `
      <div style="margin-bottom:14px">
        ${sites.length === 0
          ? '<p style="color:#6B7280;font-size:0.82rem;margin:0 0 10px">No WordPress sites connected yet.</p>'
          : sites.map(s => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:8px;background:#F9FAFB">
              <div>
                <div style="font-weight:700;font-size:0.85rem;color:#0A1628">${_esc(s.name)}</div>
                <div style="font-size:0.74rem;color:#6B7280"><a href="${_esc(s.site_url)}" target="_blank" rel="noopener noreferrer" style="color:#0891B2">${_esc(s.site_url)}</a> · @${_esc(s.username)}</div>
                ${s.last_tested_at ? `<div style="font-size:0.7rem;color:#10B981">✓ Last tested ${new Date(s.last_tested_at).toLocaleDateString()}</div>` : ''}
              </div>
              <div style="display:flex;gap:6px">
                <button onclick="_wpTestSite(${s.id},'${containerId}')" style="padding:5px 10px;background:#fff;border:1px solid #D1D5DB;border-radius:6px;font-size:0.72rem;font-weight:700;color:#374151;cursor:pointer">🔍 Test</button>
                <button onclick="_wpDeleteSite(${s.id},'${containerId}')" style="padding:5px 10px;background:#FEE2E2;border:1px solid #FECACA;border-radius:6px;font-size:0.72rem;font-weight:700;color:#991B1B;cursor:pointer">Remove</button>
              </div>
            </div>`).join('')}
      </div>
      <details style="border:1px solid #E5E7EB;border-radius:8px;padding:12px 14px">
        <summary style="cursor:pointer;font-weight:700;font-size:0.82rem;color:#374151">➕ Add WordPress Site</summary>
        <div style="margin-top:12px;display:grid;gap:8px">
          <input id="wpAddName" placeholder="Friendly name (e.g. My Blog)" style="padding:8px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem;width:100%;box-sizing:border-box">
          <input id="wpAddUrl"  placeholder="Site URL (e.g. https://myblog.com)" style="padding:8px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem;width:100%;box-sizing:border-box">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input id="wpAddUser" placeholder="WordPress username" style="padding:8px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem">
            <input id="wpAddPw"   placeholder="Application Password" type="password" style="padding:8px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem">
          </div>
          <div style="font-size:0.72rem;color:#6B7280">
            💡 Generate an Application Password in WordPress → Users → Your Profile → Application Passwords.
            InfoGenie never sees your main WordPress login password.
          </div>
          <button id="wpAddBtn" onclick="_wpConnectSite('${containerId}')" style="padding:9px 18px;background:#1D4ED8;border:none;border-radius:7px;font-size:0.82rem;font-weight:800;color:#fff;cursor:pointer;align-self:start">🔗 Connect &amp; Test</button>
        </div>
      </details>`;
  };

  window._wpConnectSite = async function (containerId) {
    const name = (document.getElementById('wpAddName') || {}).value || '';
    const url  = (document.getElementById('wpAddUrl')  || {}).value || '';
    const user = (document.getElementById('wpAddUser') || {}).value || '';
    const pw   = (document.getElementById('wpAddPw')   || {}).value || '';
    if (!name || !url || !user || !pw) return _toast('⚠️ All fields required', 'err');
    const btn = document.getElementById('wpAddBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Testing…'; }
    try {
      const r = await fetch('/api/wordpress/connect', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, site_url: url, username: user, app_password: pw }),
      }).then(x => x.json());
      if (!r.ok) throw new Error(r.error || 'failed');
      _clearWpCache();
      _toast(`✅ Connected: ${r.wp_user?.name || name}`);
      window._wpRenderSitesPanel(containerId);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '🔗 Connect & Test'; }
      alert('Connection failed: ' + e.message);
    }
  };

  window._wpTestSite = async function (id, containerId) {
    try {
      const r = await fetch(`/api/wordpress/sites/${id}/test`, { method: 'POST', credentials: 'same-origin' }).then(x => x.json());
      if (r.ok) _toast(`✅ Connected — ${r.wp_user?.name || 'OK'}`);
      else       _toast('❌ Test failed: ' + r.error, 'err');
      if (containerId) window._wpRenderSitesPanel(containerId);
    } catch (e) { _toast('❌ ' + e.message, 'err'); }
  };

  window._wpDeleteSite = async function (id, containerId) {
    if (!confirm('Remove this WordPress site?')) return;
    await fetch(`/api/wordpress/sites/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    _clearWpCache();
    _toast('Site removed');
    if (containerId) window._wpRenderSitesPanel(containerId);
  };

  // ── Quick-publish modal ───────────────────────────────────────────────────
  window._wpPublishModal = async function ({ title, content, excerpt, source }) {
    const sites = await _getWpSites();
    if (!sites.length) {
      return alert('No WordPress sites connected.\n\nGo to Settings → WordPress to add a site first.');
    }
    const modalId = 'wpPubModal_' + Date.now();
    const overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:24px 28px;max-width:540px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
          <div style="font-weight:800;font-size:1.05rem;color:#0A1628">📤 Publish to WordPress</div>
          <button onclick="document.getElementById('${modalId}').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#9CA3AF">×</button>
        </div>
        <div style="display:grid;gap:10px">
          <div>
            <label style="font-size:0.72rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">POST TITLE</label>
            <input id="wpPubTitle" value="${_esc(title || '')}" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.88rem;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">SITE</label>
            <select id="wpPubSite" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.88rem">
              ${sites.map(s => `<option value="${s.id}">${_esc(s.name)} — ${_esc(s.site_url)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">STATUS</label>
            <select id="wpPubStatus" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.88rem">
              <option value="draft">Draft — save for review</option>
              <option value="publish">Publish immediately</option>
              <option value="pending">Pending review</option>
            </select>
          </div>
        </div>
        <div id="wpPubErr" style="display:none;margin-top:10px;background:#FEE2E2;color:#991B1B;padding:10px 12px;border-radius:7px;font-size:0.82rem"></div>
        <div style="margin-top:18px;display:flex;gap:8px;justify-content:flex-end">
          <button onclick="document.getElementById('${modalId}').remove()" style="padding:9px 18px;background:#fff;border:1px solid #D1D5DB;border-radius:7px;font-size:0.82rem;font-weight:700;color:#374151;cursor:pointer">Cancel</button>
          <button onclick="_wpDoPublish('${modalId}','${_esc(content || '')}','${_esc(excerpt || '')}','${_esc(source || 'content-pro')}')"
                  style="padding:9px 18px;background:#1D4ED8;border:none;border-radius:7px;font-size:0.82rem;font-weight:800;color:#fff;cursor:pointer">
            📤 Publish to WordPress
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  };

  window._wpDoPublish = async function (modalId, contentEncoded, excerptEncoded, source) {
    const title   = (document.getElementById('wpPubTitle')  || {}).value || '';
    const site_id = +(document.getElementById('wpPubSite')  || {}).value;
    const status  = (document.getElementById('wpPubStatus') || {}).value || 'draft';
    const errEl   = document.getElementById('wpPubErr');
    if (!title) { if (errEl) { errEl.style.display = ''; errEl.textContent = 'Title required'; } return; }
    const btn = document.querySelector(`#${modalId} button[onclick*="_wpDoPublish"]`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Publishing…'; }
    try {
      const r = await fetch('/api/wordpress/publish', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: contentEncoded, excerpt: excerptEncoded, site_id, status, source }),
      }).then(x => x.json());
      if (!r.ok) throw new Error(r.error || 'failed');
      document.getElementById(modalId)?.remove();
      const verb = status === 'publish' ? 'Published' : 'Saved as draft';
      if (r.post_url) {
        _toast(`✅ ${verb} → <a href="${r.post_url}" target="_blank">View post ↗</a>`);
        if (confirm(`${verb} on WordPress!\n\nOpen post?`)) window.open(r.post_url, '_blank');
      } else {
        _toast(`✅ ${verb} on WordPress (post #${r.wp_post_id})`);
      }
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '📤 Publish to WordPress'; }
      if (errEl) { errEl.style.display = ''; errEl.textContent = e.message; }
    }
  };

  /* =========================================================================
     FEATURE 2 — Content Modes Generator  (#content-modes view)
     ========================================================================= */
  const MODE_CONFIG = {
    article:     { label: '📝 Article',          color: '#0891B2', fields: [] },
    affiliation: { label: '💰 Affiliation',       color: '#D97706', fields: ['competitor_hint'] },
    ecommerce:   { label: '🛒 E-commerce',        color: '#7C3AED', fields: [] },
    local:       { label: '📍 Local SEO',         color: '#059669', fields: ['location'] },
    update:      { label: '🔄 Update Content',    color: '#6B7280', fields: ['existing_content'] },
    discovery:   { label: '🔥 Google Discovery',  color: '#DC2626', fields: [] },
  };

  window.buildContentModes = function () {
    const el = document.getElementById('cmWrap');
    if (!el) return;
    const modes = Object.entries(MODE_CONFIG);
    el.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:18px">
        <div style="margin-bottom:14px">
          <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:8px">CONTENT MODE</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px" id="cmModes">
            ${modes.map(([k, v]) => `
              <button data-mode="${k}" onclick="_cmSelectMode('${k}')"
                style="padding:7px 14px;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer;
                       border:2px solid ${k === 'article' ? v.color : '#E5E7EB'};
                       background:${k === 'article' ? v.color : '#fff'};
                       color:${k === 'article' ? '#fff' : '#374151'}">
                ${v.label}
              </button>`).join('')}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">KEYWORD / TOPIC <span style="color:#DC2626">*</span></label>
            <input id="cmKeyword" placeholder="e.g. best running shoes 2026" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">BRAND (optional)</label>
            <input id="cmBrand" placeholder="e.g. Nike" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">AUDIENCE (optional)</label>
            <input id="cmAudience" placeholder="e.g. fitness enthusiasts 25-45" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">TONE (optional)</label>
            <input id="cmTone" placeholder="e.g. expert + conversational" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem;box-sizing:border-box">
          </div>
        </div>
        <div id="cmExtraFields" style="margin-bottom:12px"></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button onclick="_cmGo()" style="padding:10px 22px;background:#0891B2;border:2px solid #0891B2;border-radius:8px;font-size:0.84rem;font-weight:800;color:#fff;cursor:pointer">✍️ Generate Article</button>
          <button onclick="_cmShowHistory()" style="padding:10px 16px;background:#fff;border:1px solid #D1D5DB;border-radius:8px;font-size:0.82rem;font-weight:700;color:#374151;cursor:pointer">📂 History</button>
        </div>
      </div>
      <div id="cmOut"></div>`;
    window._cmActiveMode = 'article';
  };

  window._cmSelectMode = function (mode) {
    window._cmActiveMode = mode;
    document.querySelectorAll('#cmModes [data-mode]').forEach(btn => {
      const cfg = MODE_CONFIG[btn.dataset.mode];
      const isActive = btn.dataset.mode === mode;
      btn.style.background = isActive ? cfg.color : '#fff';
      btn.style.color = isActive ? '#fff' : '#374151';
      btn.style.borderColor = isActive ? cfg.color : '#E5E7EB';
    });
    const extra = document.getElementById('cmExtraFields');
    if (!extra) return;
    const cfg = MODE_CONFIG[mode] || {};
    const fields = cfg.fields || [];
    let html = '';
    if (fields.includes('location')) html += `
      <div>
        <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">LOCATION <span style="color:#DC2626">*</span></label>
        <input id="cmLocation" placeholder="e.g. Austin, TX" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem;box-sizing:border-box">
      </div>`;
    if (fields.includes('existing_content')) html += `
      <div>
        <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">EXISTING CONTENT TO REFRESH <span style="color:#DC2626">*</span></label>
        <textarea id="cmExisting" rows="5" placeholder="Paste your existing article here…" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.84rem;resize:vertical;box-sizing:border-box"></textarea>
      </div>`;
    extra.innerHTML = html;
  };

  window._cmGo = async function () {
    const mode     = window._cmActiveMode || 'article';
    const keyword  = (document.getElementById('cmKeyword')  || {}).value || '';
    const brand    = (document.getElementById('cmBrand')    || {}).value || '';
    const audience = (document.getElementById('cmAudience') || {}).value || '';
    const tone     = (document.getElementById('cmTone')     || {}).value || '';
    const location = (document.getElementById('cmLocation') || {}).value || '';
    const existing = (document.getElementById('cmExisting') || {}).value || '';

    if (!keyword && mode !== 'update') return _toast('⚠️ Keyword required');
    if (mode === 'update' && !existing) return _toast('⚠️ Paste your existing content to refresh');
    if (mode === 'local' && !location) return _toast('⚠️ Location required for Local SEO mode');

    const out = document.getElementById('cmOut');
    const cfg = MODE_CONFIG[mode] || {};
    out.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;color:#6B7280">⏳ Writing ${cfg.label} article for "${keyword || 'your content'}"…<br><small style="font-size:0.74rem;margin-top:4px;display:block">This takes 15-30 seconds for full AI generation.</small></div>`;

    try {
      const r = await fetch('/api/content-modes/generate', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, keyword, brand, audience, tone, location, existing_content: existing }),
      }).then(x => x.json());
      if (!r.ok) throw new Error(r.error || 'failed');
      _cmRenderArticle(r, out);
    } catch (e) {
      out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_esc(e.message)}</div>`;
    }
  };

  function _cmRenderArticle(r, out) {
    const a = r.article || {};
    const cfg = MODE_CONFIG[r.mode] || { color: '#0891B2', label: r.mode };
    const sections = (a.sections || []).map(s => `<h2>${_esc(s.heading || '')}</h2>\n<p>${_esc(s.body || '')}</p>`).join('\n');
    const fullText = [a.intro, ...((a.sections || []).map(s => s.body)), a.conclusion].filter(Boolean).join('\n\n');

    out.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-top:4px solid ${cfg.color};border-radius:12px;padding:24px 28px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;flex-wrap:wrap;gap:10px">
          <div style="flex:1">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
              <span style="background:${cfg.color};color:#fff;padding:3px 10px;border-radius:5px;font-size:0.7rem;font-weight:800">${_esc(cfg.label)}</span>
              <span style="background:${r.source === 'openai' ? '#ECFDF5' : '#F3F4F6'};color:${r.source === 'openai' ? '#059669' : '#6B7280'};padding:3px 8px;border-radius:5px;font-size:0.68rem;font-weight:700">${r.source === 'openai' ? '🤖 AI' : '📋 Template'}</span>
              ${a.word_count ? `<span style="font-size:0.72rem;color:#9CA3AF">~${a.word_count} words</span>` : ''}
            </div>
            <h2 style="font-size:1.2rem;font-weight:800;color:#0A1628;margin:0">${_esc(a.title || r.keyword || '')}</h2>
            ${a.seo_title ? `<div style="font-size:0.78rem;color:#6B7280;margin-top:4px">SEO title: ${_esc(a.seo_title)}</div>` : ''}
            ${a.meta_description ? `<div style="font-size:0.78rem;color:#6B7280;margin-top:2px">Meta: ${_esc(a.meta_description)}</div>` : ''}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button onclick="_cmCopyArticle()" style="padding:7px 14px;background:#fff;border:1px solid #D1D5DB;border-radius:7px;font-size:0.75rem;font-weight:700;color:#374151;cursor:pointer">📋 Copy</button>
            <button onclick="_cmAudioSummary()" style="padding:7px 14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:7px;font-size:0.75rem;font-weight:700;color:#15803D;cursor:pointer">🎧 Audio Summary</button>
            <button onclick="_cmPublishWP()" style="padding:7px 14px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:7px;font-size:0.75rem;font-weight:700;color:#1D4ED8;cursor:pointer">📤 Publish to WP</button>
          </div>
        </div>

        <div id="cmAudioOut" style="margin-bottom:14px"></div>

        <div style="border-top:1px solid #F3F4F6;padding-top:18px;line-height:1.7;color:#374151">
          ${a.intro ? `<p style="font-size:0.92rem;color:#374151">${_esc(a.intro)}</p>` : ''}
          ${(a.sections || []).map(s => `
            <h3 style="font-size:1rem;font-weight:700;color:#0A1628;margin:18px 0 6px">${_esc(s.heading || '')}</h3>
            <p style="font-size:0.88rem">${_esc(s.body || '')}</p>`).join('')}
          ${a.conclusion ? `<p style="font-size:0.88rem;font-style:italic;color:#374151;margin-top:14px">${_esc(a.conclusion)}</p>` : ''}
          ${a.cta ? `<div style="background:#EFF6FF;border-left:3px solid #1D4ED8;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:14px;font-weight:700;color:#1D4ED8;font-size:0.88rem">→ ${_esc(a.cta)}</div>` : ''}
        </div>

        ${a.pros ? `
          <div style="margin-top:18px;border-top:1px solid #F3F4F6;padding-top:14px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div>
                <div style="font-weight:700;color:#059669;margin-bottom:8px;font-size:0.85rem">✅ Pros</div>
                ${(a.pros || []).map(p => `<div style="font-size:0.82rem;color:#374151;margin-bottom:4px">• ${_esc(p)}</div>`).join('')}
              </div>
              <div>
                <div style="font-weight:700;color:#DC2626;margin-bottom:8px;font-size:0.85rem">❌ Cons</div>
                ${(a.cons || []).map(c => `<div style="font-size:0.82rem;color:#374151;margin-bottom:4px">• ${_esc(c)}</div>`).join('')}
              </div>
            </div>
            ${a.verdict ? `<div style="margin-top:12px;background:#FFFBEB;border:1px solid #FDE68A;padding:10px 14px;border-radius:8px;font-size:0.85rem;color:#92400E"><strong>Verdict:</strong> ${_esc(a.verdict)}</div>` : ''}
            ${a.rating ? `<div style="margin-top:8px;font-size:0.88rem;font-weight:800;color:#D97706">Rating: ${'⭐'.repeat(Math.round(a.rating))} (${a.rating}/5)</div>` : ''}
          </div>` : ''}

        ${a.local_keywords ? `
          <div style="margin-top:14px;border-top:1px solid #F3F4F6;padding-top:12px">
            <div style="font-weight:700;font-size:0.82rem;color:#059669;margin-bottom:6px">📍 Local Keywords Used</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${(a.local_keywords || []).map(k => `<span style="background:#ECFDF5;color:#059669;padding:3px 9px;border-radius:5px;font-size:0.72rem">${_esc(k)}</span>`).join('')}</div>
          </div>` : ''}

        ${a.internal_link_suggestions?.length ? `
          <div style="margin-top:14px;border-top:1px solid #F3F4F6;padding-top:12px">
            <div style="font-weight:700;font-size:0.82rem;color:#6B7280;margin-bottom:6px">🔗 Internal Link Opportunities</div>
            ${(a.internal_link_suggestions || []).map(l => `<div style="font-size:0.78rem;color:#374151;margin-bottom:3px">• ${_esc(l)}</div>`).join('')}
          </div>` : ''}
      </div>`;

    window._cmLastArticle = { title: a.title, fullText, content: `<p>${a.intro || ''}</p>${sections}<p>${a.conclusion || ''}</p>`, excerpt: a.meta_description || '' };
  }

  window._cmCopyArticle = function () {
    const a = window._cmLastArticle;
    if (!a) return;
    const md = `# ${a.title || 'Article'}\n\n${a.fullText}`;
    navigator.clipboard.writeText(md).then(() => _toast('✅ Copied as Markdown')).catch(e => _toast('❌ ' + e.message));
  };

  window._cmPublishWP = function () {
    const a = window._cmLastArticle;
    if (!a) return _toast('⚠️ Generate an article first');
    window._wpPublishModal({ title: a.title, content: a.content, excerpt: a.excerpt, source: 'content-modes' });
  };

  window._cmAudioSummary = async function () {
    const a = window._cmLastArticle;
    if (!a) return _toast('⚠️ Generate an article first');
    const out = document.getElementById('cmAudioOut');
    if (out) out.innerHTML = '<div style="background:#F0FDF4;border:1px solid #BBF7D0;padding:10px 14px;border-radius:8px;color:#15803D;font-size:0.82rem">⏳ Generating audio summary…</div>';
    await window._audioSummary(a.fullText, a.title, null, out ? out.id : null);
  };

  window._cmShowHistory = async function () {
    const out = document.getElementById('cmOut');
    if (!out) return;
    out.innerHTML = '<div style="color:#6B7280;padding:16px">⏳ Loading history…</div>';
    try {
      const r = await fetch('/api/content-modes/history', { credentials: 'same-origin' }).then(x => x.json());
      if (!r.ok || !r.runs.length) { out.innerHTML = '<div style="color:#6B7280;padding:16px">No history yet. Generate your first article above.</div>'; return; }
      out.innerHTML = `
        <div style="font-weight:700;color:#0A1628;margin-bottom:10px">📂 Recent Articles</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${r.runs.map(run => {
            const cfg = MODE_CONFIG[run.mode] || { color: '#6B7280', label: run.mode };
            return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${cfg.color};border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px">
              <div>
                <span style="background:${cfg.color};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.66rem;font-weight:800">${_esc(cfg.label)}</span>
                <span style="font-weight:700;color:#0A1628;font-size:0.88rem;margin-left:8px">${_esc(run.keyword || '(no keyword)')}</span>
                ${run.brand ? `<span style="font-size:0.74rem;color:#6B7280"> · ${_esc(run.brand)}</span>` : ''}
                <div style="font-size:0.72rem;color:#9CA3AF;margin-top:3px">${new Date(run.created_at).toLocaleString()}</div>
              </div>
              <button onclick="_cmLoadRun(${run.id})" style="padding:5px 12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;font-size:0.74rem;font-weight:700;color:#1D4ED8;cursor:pointer">Load</button>
            </div>`;
          }).join('')}
        </div>`;
    } catch (e) { out.innerHTML = `<div style="color:#B91C1C">${_esc(e.message)}</div>`; }
  };

  window._cmLoadRun = async function (id) {
    const out = document.getElementById('cmOut');
    if (!out) return;
    const r = await fetch(`/api/content-modes/${id}`, { credentials: 'same-origin' }).then(x => x.json());
    if (!r.ok) return;
    _cmRenderArticle({ article: r.run.result, mode: r.run.mode, keyword: r.run.keyword, brand: r.run.brand, source: r.run.source }, out);
  };

  /* =========================================================================
     FEATURE 3 — Autopilot  (#content-autopilot view)
     ========================================================================= */
  window.buildAutopilot = function () {
    const el = document.getElementById('apWrap');
    if (!el) return;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 360px;gap:18px;align-items:start">

        <!-- Schedule list -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <div style="font-weight:800;font-size:1rem;color:#0A1628">🤖 Active Schedules</div>
            <button onclick="_apRefresh()" style="padding:6px 12px;background:#fff;border:1px solid #D1D5DB;border-radius:7px;font-size:0.76rem;font-weight:700;color:#374151;cursor:pointer">🔄 Refresh</button>
          </div>
          <div id="apList">⏳ Loading…</div>
          <div style="margin-top:24px">
            <div style="font-weight:800;font-size:0.88rem;color:#0A1628;margin-bottom:10px">📋 Recent Runs</div>
            <div id="apLogs">⏳ Loading logs…</div>
          </div>
        </div>

        <!-- Create new schedule -->
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;position:sticky;top:80px">
          <div style="font-weight:800;font-size:0.9rem;color:#0A1628;margin-bottom:14px">➕ New Schedule</div>
          <div style="display:grid;gap:10px">
            <div>
              <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">NAME</label>
              <input id="apName" placeholder="e.g. Weekly SEO blog" style="width:100%;padding:8px 11px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">KEYWORD / TOPIC <span style="color:#DC2626">*</span></label>
              <input id="apKeyword" placeholder="e.g. best running shoes" style="width:100%;padding:8px 11px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">CONTENT MODE</label>
              <select id="apMode" style="width:100%;padding:8px 11px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem">
                ${Object.entries(MODE_CONFIG).filter(([k]) => k !== 'update').map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">FREQUENCY</label>
              <select id="apFreq" style="width:100%;padding:8px 11px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem">
                <option value="daily">Daily</option>
                <option value="every3days">Every 3 days</option>
                <option value="weekly" selected>Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div id="apWpSection">
              <label style="font-size:0.7rem;font-weight:700;color:#6B7280;display:block;margin-bottom:4px">AUTO-PUBLISH TO WORDPRESS</label>
              <select id="apWpSite" style="width:100%;padding:8px 11px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem;margin-bottom:6px">
                <option value="">— Don't auto-publish —</option>
              </select>
              <select id="apWpStatus" style="width:100%;padding:8px 11px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.84rem;display:none">
                <option value="draft">Save as Draft</option>
                <option value="publish">Publish immediately</option>
                <option value="pending">Pending review</option>
              </select>
            </div>
            <button onclick="_apCreate()" style="padding:10px;background:linear-gradient(135deg,#0891B2,#0E7490);border:none;border-radius:8px;font-size:0.84rem;font-weight:800;color:#fff;cursor:pointer;margin-top:2px">🤖 Create Schedule</button>
          </div>
        </div>
      </div>`;

    // Populate WP sites dropdown
    _getWpSites().then(sites => {
      const sel = document.getElementById('apWpSite');
      if (!sel) return;
      sel.innerHTML = '<option value="">— Don\'t auto-publish —</option>' +
        sites.map(s => `<option value="${s.id}">${_esc(s.name)}</option>`).join('');
      sel.onchange = () => {
        const st = document.getElementById('apWpStatus');
        if (st) st.style.display = sel.value ? '' : 'none';
      };
    });

    _apRefresh();
  };

  window._apRefresh = async function () {
    const listEl = document.getElementById('apList');
    const logsEl = document.getElementById('apLogs');
    try {
      const [sr, lr] = await Promise.all([
        fetch('/api/autopilot/schedules', { credentials: 'same-origin' }).then(x => x.json()),
        fetch('/api/autopilot/logs?limit=20', { credentials: 'same-origin' }).then(x => x.json()),
      ]);
      if (listEl) listEl.innerHTML = _apRenderList(sr.schedules || []);
      if (logsEl) logsEl.innerHTML = _apRenderLogs(lr.logs || []);
    } catch (e) {
      if (listEl) listEl.innerHTML = `<div style="color:#B91C1C">${_esc(e.message)}</div>`;
    }
  };

  function _apRenderList(schedules) {
    if (!schedules.length) return `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280;font-size:0.85rem">No schedules yet. Create your first one →</div>`;
    return `<div style="display:flex;flex-direction:column;gap:10px">` +
      schedules.map(s => {
        const cfg = MODE_CONFIG[s.mode] || { color: '#6B7280', label: s.mode };
        const freqLabels = { daily: 'Daily', every3days: 'Every 3d', weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly' };
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${s.enabled ? cfg.color : '#D1D5DB'};border-radius:10px;padding:14px 16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="flex:1">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;flex-wrap:wrap">
                <span style="background:${s.enabled ? cfg.color : '#9CA3AF'};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.66rem;font-weight:800">${_esc(cfg.label)}</span>
                <span style="background:#F3F4F6;color:#374151;padding:2px 8px;border-radius:4px;font-size:0.66rem;font-weight:700">${_esc(freqLabels[s.frequency] || s.frequency)}</span>
                ${s.wp_site_name ? `<span style="background:#EFF6FF;color:#1D4ED8;padding:2px 8px;border-radius:4px;font-size:0.66rem;font-weight:700">📤 WP: ${_esc(s.wp_site_name)}</span>` : ''}
                ${!s.enabled ? '<span style="background:#F3F4F6;color:#9CA3AF;padding:2px 8px;border-radius:4px;font-size:0.66rem;font-weight:700">PAUSED</span>' : ''}
              </div>
              <div style="font-weight:700;color:#0A1628;font-size:0.9rem">${_esc(s.name)}</div>
              <div style="font-size:0.76rem;color:#6B7280">Keyword: ${_esc(s.keyword)} · Runs: ${s.run_count} · Next: ${s.next_run_at ? new Date(s.next_run_at).toLocaleDateString() : '—'}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button onclick="_apRunNow(${s.id})" title="Run now" style="padding:6px 10px;background:#ECFDF5;border:1px solid #BBF7D0;border-radius:6px;font-size:0.74rem;font-weight:700;color:#059669;cursor:pointer">▶ Now</button>
              <button onclick="_apToggle(${s.id},${!s.enabled})" style="padding:6px 10px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;font-size:0.74rem;font-weight:700;color:#92400E;cursor:pointer">${s.enabled ? '⏸ Pause' : '▶ Resume'}</button>
              <button onclick="_apDelete(${s.id})" style="padding:6px 10px;background:#FEE2E2;border:1px solid #FECACA;border-radius:6px;font-size:0.74rem;font-weight:700;color:#991B1B;cursor:pointer">🗑</button>
            </div>
          </div>
        </div>`;
      }).join('') + '</div>';
  }

  function _apRenderLogs(logs) {
    if (!logs.length) return '<div style="color:#9CA3AF;font-size:0.8rem">No runs yet.</div>';
    return `<div style="display:flex;flex-direction:column;gap:6px">` +
      logs.map(l => `<div style="background:#fff;border:1px solid #E5E7EB;border-left:3px solid ${l.status === 'ok' ? '#10B981' : '#EF4444'};border-radius:7px;padding:8px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-size:0.8rem;font-weight:700;color:${l.status === 'ok' ? '#059669' : '#B91C1C'}">${l.status === 'ok' ? '✅' : '❌'} ${_esc(l.schedule_name || 'Unknown')}</span>
          <span style="font-size:0.7rem;color:#9CA3AF">${new Date(l.created_at).toLocaleString()}</span>
        </div>
        <div style="font-size:0.76rem;color:#374151;margin-top:3px">${_esc(l.detail || '')}</div>
        ${l.wp_post_url ? `<a href="${_esc(l.wp_post_url)}" target="_blank" style="font-size:0.74rem;color:#1D4ED8">🔗 View WP post</a>` : ''}
      </div>`).join('') + '</div>';
  }

  window._apCreate = async function () {
    const name    = (document.getElementById('apName')     || {}).value || '';
    const keyword = (document.getElementById('apKeyword')  || {}).value || '';
    const mode    = (document.getElementById('apMode')     || {}).value || 'article';
    const freq    = (document.getElementById('apFreq')     || {}).value || 'weekly';
    const wpSite  = (document.getElementById('apWpSite')   || {}).value || '';
    const wpStat  = (document.getElementById('apWpStatus') || {}).value || 'draft';

    if (!name)    return _toast('⚠️ Name required');
    if (!keyword) return _toast('⚠️ Keyword required');

    try {
      const r = await fetch('/api/autopilot/schedules', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, keyword, mode, frequency: freq, auto_publish: !!wpSite, wp_site_id: wpSite || null, wp_status: wpStat }),
      }).then(x => x.json());
      if (!r.ok) throw new Error(r.error || 'failed');
      _toast('✅ Schedule created');
      ['apName', 'apKeyword'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      _apRefresh();
    } catch (e) { _toast('❌ ' + e.message, 'err'); }
  };

  window._apToggle = async function (id, enabled) {
    await fetch(`/api/autopilot/schedules/${id}`, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    _apRefresh();
  };

  window._apDelete = async function (id) {
    if (!confirm('Delete this schedule?')) return;
    await fetch(`/api/autopilot/schedules/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    _toast('Deleted');
    _apRefresh();
  };

  window._apRunNow = async function (id) {
    _toast('⏳ Running now — check logs in a few seconds');
    const r = await fetch(`/api/autopilot/run-now/${id}`, { method: 'POST', credentials: 'same-origin' }).then(x => x.json());
    if (r.ok) setTimeout(_apRefresh, 4000);
    else _toast('❌ ' + r.error, 'err');
  };

  /* =========================================================================
     FEATURE 4 — Audio Summaries  (shared helper, injected anywhere)
     ========================================================================= */
  const VOICE_OPTIONS = [
    { id: 'nova',    label: '👩 Nova (warm, friendly)' },
    { id: 'alloy',   label: '🎙 Alloy (balanced)' },
    { id: 'echo',    label: '📻 Echo (clear, professional)' },
    { id: 'fable',   label: '📖 Fable (storytelling)' },
    { id: 'onyx',    label: '🎤 Onyx (deep, authoritative)' },
    { id: 'shimmer', label: '✨ Shimmer (soft, expressive)' },
  ];

  // _audioSummary(text, title, btn?, outputContainerId?)
  window._audioSummary = async function (text, title, btn, outputContainerId) {
    if (!text || text.length < 50) return _toast('⚠️ Not enough text for an audio summary');

    // Voice picker modal
    const pickId = 'audioPick_' + Date.now();
    const overlay = document.createElement('div');
    overlay.id = pickId;
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:24px 28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-weight:800;font-size:1rem;color:#0A1628">🎧 Generate Audio Summary</div>
          <button onclick="document.getElementById('${pickId}').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#9CA3AF">×</button>
        </div>
        <div style="font-size:0.82rem;color:#6B7280;margin-bottom:14px">
          InfoGenie will summarise this article into ~90 seconds of spoken audio using AI.
        </div>
        <label style="font-size:0.72rem;font-weight:700;color:#6B7280;display:block;margin-bottom:6px">VOICE</label>
        <select id="${pickId}_voice" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.88rem;margin-bottom:16px">
          ${VOICE_OPTIONS.map(v => `<option value="${v.id}">${v.label}</option>`).join('')}
        </select>
        <button id="${pickId}_go" onclick="_audioDoGenerate('${pickId}','${pickId}_voice','${outputContainerId || ''}')"
          data-text="${_esc(text)}" data-title="${_esc(title || '')}"
          style="width:100%;padding:10px;background:linear-gradient(135deg,#10B981,#059669);border:none;border-radius:8px;font-size:0.84rem;font-weight:800;color:#fff;cursor:pointer">
          🎙 Generate Audio
        </button>
      </div>`;
    document.body.appendChild(overlay);
  };

  window._audioDoGenerate = async function (pickId, voiceSelId, outputContainerId) {
    const btn      = document.getElementById(pickId + '_go');
    const voiceSel = document.getElementById(voiceSelId);
    const text     = btn?.dataset?.text || '';
    const title    = btn?.dataset?.title || '';
    const voice    = voiceSel?.value || 'nova';

    document.getElementById(pickId)?.remove();

    let outEl = outputContainerId ? document.getElementById(outputContainerId) : null;
    if (outEl) outEl.innerHTML = '<div style="background:#F0FDF4;border:1px solid #BBF7D0;padding:10px 14px;border-radius:8px;color:#15803D;font-size:0.82rem">⏳ Generating audio summary (15-30s)…</div>';
    else _toast('⏳ Generating audio summary…');

    try {
      const r = await fetch('/api/audio-summary/generate', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title, voice }),
      }).then(x => x.json());

      if (!r.ok) throw new Error(r.error || 'failed');

      const player = `
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:14px 16px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-size:1.1rem">🎧</span>
            <div>
              <div style="font-weight:700;font-size:0.85rem;color:#0A1628">Audio Summary — ${_esc(title || 'Article')}</div>
              <div style="font-size:0.72rem;color:#6B7280">Voice: ${_esc(voice)} · ${Math.ceil(r.charCount / 15)}s estimated</div>
            </div>
          </div>
          <audio controls style="width:100%;border-radius:6px" src="${_esc(r.mp3Url)}"></audio>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            <a href="${_esc(r.mp3Url)}" download style="padding:5px 12px;background:#fff;border:1px solid #BBF7D0;border-radius:6px;font-size:0.74rem;font-weight:700;color:#059669;text-decoration:none">⬇ Download MP3</a>
          </div>
          ${r.script ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:0.74rem;color:#6B7280">View script</summary><p style="font-size:0.78rem;color:#374151;line-height:1.6;margin-top:6px">${_esc(r.script)}</p></details>` : ''}
        </div>`;

      if (outEl) outEl.innerHTML = player;
      else _toast('✅ Audio ready');
    } catch (e) {
      if (outEl) outEl.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:10px 14px;border-radius:8px;font-size:0.82rem">${_esc(e.message)}</div>`;
      else _toast('❌ ' + e.message, 'err');
    }
  };

  /* =========================================================================
     Content Calendar enhancements — inject WP + Audio buttons per post card
     ========================================================================= */
  // Called by _ccGo after rendering post cards — adds WP publish + Audio buttons
  window._ccEnhanceCards = async function (posts) {
    const sites = await _getWpSites();
    const wpEnabled = sites.length > 0;
    const cards = document.querySelectorAll('#ccGrid > div');
    cards.forEach((card, i) => {
      const p = posts[i];
      if (!p || card.dataset.enhanced) return;
      card.dataset.enhanced = '1';
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap';
      // Audio button (all channels)
      const audioBtn = document.createElement('button');
      audioBtn.style.cssText = 'padding:5px 10px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;font-size:0.72rem;font-weight:700;color:#15803D;cursor:pointer';
      audioBtn.textContent = '🎧 Audio';
      audioBtn.onclick = () => window._audioSummary(p.copy + (p.hook ? '\n\n' + p.hook : ''), p.hook || 'Post');
      btnRow.appendChild(audioBtn);
      // WP publish button (blog posts or any channel if WP connected)
      if (wpEnabled || p.channel === 'blog') {
        const wpBtn = document.createElement('button');
        wpBtn.style.cssText = 'padding:5px 10px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;font-size:0.72rem;font-weight:700;color:#1D4ED8;cursor:pointer';
        wpBtn.textContent = '📤 Publish WP';
        wpBtn.onclick = () => window._wpPublishModal({
          title: p.hook || p.copy.slice(0, 80),
          content: `<p>${p.copy}</p>`,
          excerpt: p.cta || '',
          source: 'content-calendar',
        });
        btnRow.appendChild(wpBtn);
      }
      card.appendChild(btnRow);
    });
  };

  /* =========================================================================
     WordPress Settings panel injection into the integrations page
     ========================================================================= */
  // Called by buildSettings when the integrations tab is active
  window._initWordpressSettingsCard = function () {
    const cardId = 'wpSettingsCard';
    if (document.getElementById(cardId)) {
      window._wpRenderSitesPanel(cardId + '_panel');
      return;
    }
    // Find the productivity integration section or create a WordPress card inline
    const intRoot = document.getElementById('integrationsSection') || document.getElementById('settingsIntegrations');
    if (!intRoot) return;
    const wrapper = document.createElement('div');
    wrapper.id = cardId;
    wrapper.style.cssText = 'background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px 24px;margin-bottom:16px';
    wrapper.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:40px;height:40px;background:#F0F9FF;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.4rem">🌐</div>
        <div>
          <div style="font-weight:800;font-size:0.95rem;color:#0A1628">WordPress</div>
          <div style="font-size:0.78rem;color:#6B7280">Auto-publish articles directly to your WordPress sites</div>
        </div>
      </div>
      <div id="${cardId}_panel"></div>`;
    intRoot.prepend(wrapper);
    window._wpRenderSitesPanel(cardId + '_panel');
  };

  // ── On navigation to settings (integrations tab), inject WP card ──────
  const _origBuildSettings = window.buildSettings;
  if (typeof _origBuildSettings === 'function') {
    window.buildSettings = function (...args) {
      const result = _origBuildSettings.apply(this, args);
      setTimeout(() => { try { window._initWordpressSettingsCard(); } catch (e) { console.warn('[ig_content_pro] WP settings card:', e.message); } }, 300);
      return result;
    };
  }

  // Also hook into navigateTo for settings
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-view="settings"]');
    if (link) setTimeout(() => { try { window._initWordpressSettingsCard(); } catch {} }, 400);
  });

})();
