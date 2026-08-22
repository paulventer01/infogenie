// ig_search_assist.js — Algolia-inspired search assistance for InfoGenie
// v1: Autocomplete typeahead + AI competitor recommendations + usage tracking
// Globals: igAttachAutocomplete, igBuildRecommendations

(function() {
  'use strict';

  const _hdrs = () => window.apiHeaders ? window.apiHeaders() : { 'Content-Type': 'application/json' };
  const _esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Autocomplete typeahead ─────────────────────────────────────────────────
  // Usage: igAttachAutocomplete(inputEl, { type:'competitor', onSelect })
  window.igAttachAutocomplete = function(inputEl, opts = {}) {
    if (!inputEl || inputEl._igAcAttached) return;
    inputEl._igAcAttached = true;

    const type = opts.type || 'competitor';
    const onSelect = opts.onSelect || null;
    let debounceTimer = null;
    let dropdownEl = null;
    let activeIdx = -1;

    function _createDropdown() {
      if (dropdownEl) return dropdownEl;
      const d = document.createElement('div');
      d.className = 'ig-ac-dropdown';
      d.style.cssText = `
        position:absolute;background:#fff;border:1.5px solid #E5E7EB;border-radius:10px;
        box-shadow:0 8px 24px rgba(0,0,0,.1);z-index:9999;min-width:240px;max-height:280px;
        overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        font-size:0.82rem;
      `;
      document.body.appendChild(d);
      dropdownEl = d;
      return d;
    }

    function _positionDropdown() {
      if (!dropdownEl) return;
      const rect = inputEl.getBoundingClientRect();
      dropdownEl.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
      dropdownEl.style.left = (rect.left  + window.scrollX) + 'px';
      dropdownEl.style.width = rect.width + 'px';
    }

    function _closeDropdown() {
      if (dropdownEl) { dropdownEl.remove(); dropdownEl = null; }
      activeIdx = -1;
    }

    function _renderResults(items) {
      if (!items.length) { _closeDropdown(); return; }
      const d = _createDropdown();
      _positionDropdown();
      activeIdx = -1;
      d.innerHTML = items.map((item, i) => `
        <div class="ig-ac-item" data-idx="${i}" style="
          padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;
          border-bottom:1px solid #F3F4F6;transition:background .1s;color:#0A1628;
        " onmouseenter="this.style.background='#F0F9FF'" onmouseleave="this.style.background=''">
          <span style="font-size:1rem;min-width:20px">${_esc(item.icon || '🔍')}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(item.name)}</div>
            ${item.url ? `<div style="font-size:0.72rem;color:#6B7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(item.url)}</div>` : ''}
          </div>
          ${item.count > 1 ? `<span style="font-size:0.65rem;background:#EFF6FF;color:#1D4ED8;border-radius:8px;padding:2px 6px;font-weight:700">${item.count}×</span>` : ''}
        </div>
      `).join('') + `
        <div style="padding:6px 14px;font-size:0.68rem;color:#9CA3AF;border-top:1px solid #F3F4F6;text-align:right">
          ⚡ Smart Suggestions · <a href="#" onclick="navigateTo&&navigateTo('ask-infogenie');return false" style="color:#0066FF">Re-index data</a>
        </div>
      `;

      d.querySelectorAll('.ig-ac-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const idx = parseInt(el.dataset.idx);
          const item = items[idx];
          inputEl.value = item.url || item.name;
          _closeDropdown();
          if (onSelect) onSelect(item);
          // Track usage
          _trackUsage(type, item.url || item.name);
        });
      });
    }

    function _highlight(delta) {
      if (!dropdownEl) return;
      const items = dropdownEl.querySelectorAll('.ig-ac-item');
      if (!items.length) return;
      activeIdx = (activeIdx + delta + items.length) % items.length;
      items.forEach((el, i) => { el.style.background = i === activeIdx ? '#F0F9FF' : ''; });
    }

    async function _fetchSuggestions(q) {
      try {
        const r = await fetch(`/api/platform-search/suggest?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`, { headers: _hdrs() });
        const j = await r.json();
        return j.ok ? (j.suggestions || []) : [];
      } catch { return []; }
    }

    inputEl.addEventListener('input', () => {
      const q = inputEl.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < 2) { _closeDropdown(); return; }
      debounceTimer = setTimeout(async () => {
        const results = await _fetchSuggestions(q);
        _renderResults(results);
      }, 220);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (!dropdownEl) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); _highlight(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _highlight(-1); }
      else if (e.key === 'Enter' && activeIdx >= 0) {
        const el = dropdownEl.querySelectorAll('.ig-ac-item')[activeIdx];
        if (el) el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
      else if (e.key === 'Escape') _closeDropdown();
    });

    inputEl.addEventListener('blur', () => setTimeout(_closeDropdown, 150));
    window.addEventListener('scroll', _positionDropdown, { passive: true });
    window.addEventListener('resize', _positionDropdown, { passive: true });
  };

  // ── Usage tracking ─────────────────────────────────────────────────────────
  function _trackUsage(itemType, itemKey) {
    if (!itemKey) return;
    fetch('/api/platform-search/track-usage', {
      method: 'POST',
      headers: { ..._hdrs(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_type: itemType, item_key: itemKey }),
    }).catch(() => {});
  }
  window.igTrackUsage = _trackUsage;

  // ── AI competitor recommendations panel ────────────────────────────────────
  // Renders a "Suggested Competitors" card into container, then auto-dismisses.
  window.igBuildRecommendations = async function(containerId, industry, currentComps) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Don't re-render if user has already dismissed or if already loading
    if (container._igRecsLoaded) return;
    container._igRecsLoaded = true;

    if (!industry) return;

    // Loading skeleton
    container.innerHTML = `
      <div style="background:linear-gradient(135deg,#EFF6FF,#F5F3FF);border:1.5px solid #BFDBFE;border-radius:14px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;gap:10px">
        <span style="animation:spin 1s linear infinite;display:inline-block;font-size:1.2rem">⚙️</span>
        <span style="font-size:0.82rem;color:#1D4ED8;font-weight:600">Finding competitors you might be missing…</span>
      </div>`;

    try {
      const compsParam = (currentComps || []).slice(0, 6).join(',');
      const r = await fetch(
        `/api/platform-search/recommend-competitors?industry=${encodeURIComponent(industry)}&current=${encodeURIComponent(compsParam)}`,
        { headers: _hdrs() }
      );
      const j = await r.json();
      const recs = j.recommendations || [];

      if (!recs.length) { container.innerHTML = ''; return; }

      const hdrs = _hdrs();
      container.innerHTML = `
        <div style="background:linear-gradient(135deg,#EFF6FF,#F5F3FF);border:1.5px solid #BFDBFE;border-radius:14px;padding:18px 20px;margin-bottom:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="background:linear-gradient(135deg,#0066FF,#0f766e);border-radius:8px;padding:4px 10px;font-size:0.68rem;font-weight:800;color:#fff;letter-spacing:.04em">🎯 AI SUGGESTS</div>
              <div style="font-size:0.8rem;font-weight:700;color:#1E1B4B">Competitors you may be missing</div>
            </div>
            <button onclick="this.closest('[style]').remove()" style="background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:1rem;padding:2px 6px">✕</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
            ${recs.map(rec => `
              <div style="background:#fff;border:1px solid #DBEAFE;border-radius:10px;padding:12px 14px">
                <div style="font-weight:800;color:#0A1628;font-size:0.85rem;margin-bottom:2px">${_esc(rec.name)}</div>
                <div style="font-size:0.72rem;color:#6B7280;margin-bottom:6px">${_esc(rec.url || '')}</div>
                <div style="font-size:0.72rem;color:#4B5563;line-height:1.4;margin-bottom:10px">${_esc(rec.reason || '')}</div>
                <div style="display:flex;gap:6px">
                  <button onclick="window.igAddRecommendedCompetitor(${JSON.stringify(JSON.stringify(rec))})" style="flex:1;background:linear-gradient(135deg,#0066FF,#0f766e);border:none;border-radius:6px;color:#fff;font-size:0.7rem;font-weight:700;padding:5px 8px;cursor:pointer">⊕ Track</button>
                  <button onclick="if(window.analysisData){window.analysisData._recs=window.analysisData._recs||[];window.analysisData._recs.push('${_esc(rec.name)}');this.textContent='✓';this.disabled=true;}" style="background:#F3F4F6;border:1px solid #E5E7EB;border-radius:6px;color:#6B7280;font-size:0.7rem;padding:5px 8px;cursor:pointer">Skip</button>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="font-size:0.68rem;color:#6B7280;margin-top:10px">Powered by AI · Based on your industry and current competitors</div>
        </div>`;
    } catch (e) {
      container.innerHTML = '';
      console.warn('[ig-recs]', e.message);
    }
  };

  // Wire "Track" button to add competitor to crisis radar watchlist
  window.igAddRecommendedCompetitor = async function(recJson) {
    try {
      const rec = JSON.parse(recJson);
      const currentComps = (window.analysisData?.competitors || []).map(c => c.name).slice(0, 4);
      const r = await fetch('/api/crisis-radar/watchlist', {
        method: 'POST',
        headers: { ..._hdrs(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: rec.url || rec.name, competitors: currentComps, country: 'US' }),
      });
      const j = await r.json();
      if (j.ok) {
        showToast && showToast(`✅ Now tracking ${rec.name} in Crisis Radar`);
        igTrackUsage('competitor', rec.url || rec.name);
      } else {
        showToast && showToast('⚠️ ' + (j.error || 'Could not add'));
      }
    } catch (e) { showToast && showToast('⚠️ ' + e.message); }
  };

})();
