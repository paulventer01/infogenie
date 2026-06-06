// ============================================================================
// InfoGenie — extracted feature module: Drip actions · SERP · Brand Assets
// ----------------------------------------------------------------------------
// PART OF THE app.js SPLIT (see public/js/README.md). This file was carved out
// of the monolithic app.js with NO behavior change. It holds: the Re-engagement
// Drip action helpers (window.dripAction, window.generateSequenceContent,
// window.generateCounterOffer), the Google SERP Intelligence view
// (initSerpView + quick-search chips, runSerpSearch, renderSerpResults), and
// the Brand Assets Library helpers (initBrandAssets + ba* upload/preview/delete/
// remove-bg helpers).
// Conventions:
//   • Classic <script> (NOT an ES module). Loaded from index.html AFTER app.js
//     via a plain <script src> — the server auto-appends a content-hash ?v= at
//     serve time, so editing this feature only forces a re-download of THIS
//     file, not the whole 50k-line app.js.
//   • Public entry points stay attached to window. Bare top-level function
//     declarations that the SPA dispatch / inline onclick= handlers resolve
//     against (initSerpView, runSerpSearch, initBrandAssets, baFilterTag,
//     baPreview, baDelete, baRemoveBg, …) are explicitly re-exported on window
//     at the bottom of this file so navigateTo() and onclick= keep working.
//   • Shared globals (showToast, navigateTo, analysisData, refreshDripStatus,
//     buildReEngagement, compROASIssues, _igLaunch …) are defined in app.js and
//     are available here at call time.
// ============================================================================
(function () {

window.dripAction = async function(id, action) {
  try {
    const r = await fetch(`/api/drips/${id}/${action}`, { method: 'POST' });
    if (r.ok) { showToast(`✓ ${action}d`); refreshDripStatus(); }
    else showToast('Failed');
  } catch(e) { showToast('Error: ' + e.message); }
};

// ── Generate sequence content ─────────────────────────────────────────────────
window.generateSequenceContent = async function() {
  const btn = document.getElementById('genSeqBtn');
  if (btn) { btn.disabled=true; btn.textContent='⏳ Generating…'; }
  let resolvedUrl = analysisData?.url;
  if (!resolvedUrl) { try { resolvedUrl = localStorage.getItem('ig-last-analysed-url') || ''; } catch(e){ resolvedUrl = ''; } }
  const domain    = (resolvedUrl || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0] || 'yourdomain.com';
  const brandSlug = domain.split('.')[0] || 'our';
  const brandName = brandSlug.charAt(0).toUpperCase() + brandSlug.slice(1);
  const industry  = analysisData?.industry?.name || 'your industry';
  const seq      = window._reEngageSeq || [];
  try {
    for (let i = 0; i < seq.length; i++) {
      const s = seq[i];
      const res = await fetch('/api/reengage-copy', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name:'[First Name]', company:'[Company]', channel:s.channel, reason:'inactivity', value:1200, domain, brandName, industry, step:s.label, tone:s.tone, sequenceStep:true })
      });
      const d = await res.json();
      if (s.channel === 'Email' && d.email) {
        seq[i].msg = `Subject: ${d.email.subject||''}\n\n${d.email.body||''}`;
      } else if (d.social) {
        seq[i].msg = d.social;
      } else if (d.ad) {
        seq[i].msg = `${d.ad.headline||''}\n\n${d.ad.body||''}\n\n${d.ad.cta||''}`;
      }
    }
    showToast('✅ All sequence steps generated!');
  } catch(e) {
    showToast('⚠️ Generation failed — please retry');
  }
  if (btn) { btn.disabled=false; btn.textContent='✨ Generate All Content'; }
  buildReEngagement();
};

// ── Generate counter-offer ────────────────────────────────────────────────────
window.generateCounterOffer = async function(idx, compName, offer, angle) {
  const btn = document.getElementById('counterBtn'+idx);
  if (btn) { btn.disabled=true; btn.textContent='⏳ Generating…'; }
  const domain   = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'your industry';
  try {
    const res  = await fetch('/api/reengage-copy', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ counterOffer:true, compName, offer, angle, domain, industry })
    });
    const data = await res.json();
    const el   = document.getElementById('counterResult'+idx);
    if (el && data.counter) {
      el.style.display = 'block';
      el.innerHTML = `<div style="background:linear-gradient(135deg,#FFFBEB,#FEF3C7);border:1.5px solid #FDE68A;border-radius:12px;padding:16px">
        <div style="font-size:0.65rem;font-weight:700;color:#D97706;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">🎯 Your Counter-Offer Strategy</div>
        <div style="font-size:0.82rem;color:#374151;line-height:1.7;white-space:pre-wrap">${data.counter}</div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #FDE68A;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="font-size:0.75rem;color:#92400E;font-weight:600">Ready to put this messaging live?</div>
          <button onclick="window._igLaunch(0)" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#D97706,#B45309);border:none;border-radius:9px;padding:9px 20px;font-size:0.78rem;font-weight:800;color:white;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;box-shadow:0 3px 12px rgba(180,83,9,.35);transition:all .2s" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 5px 18px rgba(180,83,9,.45)'" onmouseout="this.style.transform='';this.style.boxShadow='0 3px 12px rgba(180,83,9,.35)'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            🚀 Launch Now
          </button>
        </div>
      </div>`;
    }
  } catch(e) {}
  if (btn) { btn.disabled=false; btn.textContent='🎯 Generate Counter-Offer'; }
};

/* ══════════════════════════════════════════════
   GOOGLE SERP INTELLIGENCE
   ══════════════════════════════════════════════ */

// Populate quick-search chips when the SERP view opens
function initSerpView() {
  const chips = document.getElementById('serpQuickChips');
  if (!chips || chips.dataset.built) return;
  chips.dataset.built = '1';

  const defaults = analysisData && analysisData.competitors && analysisData.competitors.length
    ? analysisData.competitors.slice(0, 4).map(c => c.name)
    : ['best fintech app', 'online banking UK', 'crypto exchange', 'investment app'];

  defaults.forEach(q => {
    const c = document.createElement('button');
    c.className = 'serp-chip';
    c.textContent = q;
    c.onclick = () => {
      document.getElementById('serpQueryInput').value = q;
      runSerpSearch();
    };
    chips.appendChild(c);
  });

  // Enter key triggers search
  document.getElementById('serpQueryInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') runSerpSearch();
  });
}

async function runSerpSearch() {
  const q        = (document.getElementById('serpQueryInput').value || '').trim();
  const location = document.getElementById('serpLocationSelect').value;
  const type     = document.getElementById('serpTypeSelect').value;
  const wrap     = document.getElementById('serpResultsWrap');
  if (!q || !wrap) return;

  wrap.innerHTML = `<div class="serp-loading"><div class="serp-spinner"></div>Searching Google…</div>`;

  try {
    const glMap = {
      'Global': '', 'United States': 'us', 'United Kingdom': 'uk',
      'Australia': 'au', 'Canada': 'ca', 'Germany': 'de', 'France': 'fr',
      'India': 'in', 'Singapore': 'sg'
    };
    const gl = glMap[location] !== undefined ? glMap[location] : 'us';
    const params = new URLSearchParams({ q, type, num: 10 });
    if (gl) params.set('gl', gl);
    if (location) params.set('location', location);
    const res    = await fetch('/api/serp?' + params.toString());
    const data   = await res.json();

    if (!res.ok) {
      wrap.innerHTML = `<div class="serp-empty-state"><p style="color:rgba(255,100,100,.7)">⚠ ${data.error || 'Search failed'}</p></div>`;
      return;
    }

    renderSerpResults(data);
  } catch (err) {
    wrap.innerHTML = `<div class="serp-empty-state"><p style="color:rgba(255,100,100,.7)">⚠ ${err.message}</p></div>`;
  }
}

function renderSerpResults(data) {
  const wrap = document.getElementById('serpResultsWrap');

  // AI-generated notice banner
  const aiBanner = data.aiGenerated ? `
    <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1rem">🤖</span>
      <div>
        <div style="font-size:0.78rem;font-weight:700;color:#92400E">AI-Generated Search Intelligence</div>
        <div style="font-size:0.72rem;color:#78350F;margin-top:2px">Live Google Search API not available for your RapidAPI key — results generated by InfoGenie AI. Subscribe to a <a href="https://rapidapi.com/search/google%20search" target="_blank" style="color:#D97706">Google Search API on RapidAPI</a> for live results.</div>
      </div>
    </div>` : '';

  // Related searches as clickable chips
  const relatedHtml = (data.relatedSearches || []).length
    ? `<div class="serp-sidebar-panel">
        <div class="serp-sidebar-title">Related Searches</div>
        <div>${data.relatedSearches.map(r =>
          `<button class="serp-related-chip" onclick="document.getElementById('serpQueryInput').value='${r.replace(/'/g,"\\'")}';runSerpSearch()">${r}</button>`
        ).join('')}</div>
      </div>`
    : '';

  // Knowledge graph panel
  const kgHtml = data.knowledgeGraph
    ? `<div class="serp-sidebar-panel">
        <div class="serp-sidebar-title">Knowledge Panel</div>
        ${data.knowledgeGraph.title ? `<div class="serp-kg-name">${data.knowledgeGraph.title}</div>` : ''}
        ${data.knowledgeGraph.type  ? `<div class="serp-kg-type">${data.knowledgeGraph.type}</div>` : ''}
        ${data.knowledgeGraph.description ? `<div class="serp-kg-desc">${data.knowledgeGraph.description}</div>` : ''}
      </div>`
    : '';

  // Ads in sidebar
  const adsHtml = data.ads && data.ads.length
    ? `<div class="serp-sidebar-panel">
        <div class="serp-sidebar-title">Paid Ads (${data.ads.length})</div>
        <div class="serp-ads-list">${data.ads.map(ad => `
          <div>
            <div class="serp-ads-item-domain">${ad.domain || ''}</div>
            <a href="${ad.url}" target="_blank" rel="noopener" class="serp-ads-item-title">${ad.title}</a>
            <div class="serp-ads-item-snippet">${ad.snippet}</div>
          </div>`).join('<hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:8px 0">')}</div>
      </div>`
    : '';

  // Organic results
  const resultsKey = data.news && data.news.length ? 'news' : 'organic';
  const results    = data[resultsKey] || [];
  const resultCardsHtml = results.length
    ? results.map(r => `
        <div class="serp-result-card">
          <div class="serp-result-top">
            <img class="serp-favicon" src="${r.favicon}" alt="" onerror="this.style.display='none'">
            <span class="serp-position">#${r.position}</span>
            <span class="serp-domain">${r.domain || ''}</span>
            ${r.date ? `<span class="serp-date">${r.date}</span>` : ''}
          </div>
          <a href="${r.url}" target="_blank" rel="noopener" class="serp-result-title">${r.title}</a>
          <div class="serp-result-snippet">${r.snippet || ''}</div>
        </div>`).join('')
    : `<div class="serp-empty-state"><p>No results found</p></div>`;

  const metaHtml = `<div class="serp-meta-bar">
    <div class="serp-meta-query">Results for <strong>"${data.query}"</strong> — ${data.location}</div>
    ${data.total ? `<div class="serp-meta-total">~${Number(data.total).toLocaleString()} results</div>` : ''}
  </div>`;

  const sidebar = [kgHtml, adsHtml, relatedHtml].filter(Boolean).join('');

  if (sidebar) {
    wrap.innerHTML = `${aiBanner}${metaHtml}<div class="serp-results-grid">
      <div>${resultCardsHtml}</div>
      <div class="serp-sidebar">${sidebar}</div>
    </div>`;
  } else {
    wrap.innerHTML = `${aiBanner}${metaHtml}${resultCardsHtml}`;
  }
}

/* ══════════════════════════════════════════════
   BRAND ASSETS LIBRARY
   ══════════════════════════════════════════════ */

window._brandAssets   = [];
window._baActiveTag   = 'all';

// Called when view becomes active
function initBrandAssets() {
  baLoadAssets();
  baSetupDragDrop();
}

// Drag & drop wiring
function baSetupDragDrop() {
  const dz = document.getElementById('baDropzone');
  if (!dz || dz.dataset.wired) return;
  dz.dataset.wired = '1';
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    baHandleFiles(e.dataTransfer.files);
  });
}

// Load assets from server
async function baLoadAssets() {
  try {
    const res  = await fetch('/api/creatives/list');
    const data = await res.json();
    window._brandAssets = data.assets || [];
  } catch { window._brandAssets = []; }
  baRender();
}

// Filter by tag
function baFilterTag(btn, tag) {
  document.querySelectorAll('.ba-tag').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window._baActiveTag = tag;
  baRender();
}

// Render the grid
function baRender() {
  const grid   = document.getElementById('baGrid');
  const stats  = document.getElementById('baStats');
  if (!grid) return;

  const q      = (document.getElementById('baSearchInput')?.value || '').toLowerCase();
  const tag    = window._baActiveTag || 'all';
  const assets = window._brandAssets.filter(a => {
    const matchTag  = tag === 'all' || (a.tag || 'General') === tag;
    const matchQ    = !q || a.name.toLowerCase().includes(q) || (a.tag||'').toLowerCase().includes(q);
    return matchTag && matchQ;
  });

  if (stats) {
    stats.innerHTML = `<span><strong>${window._brandAssets.length}</strong> total assets</span>
      <span><strong>${assets.length}</strong> shown</span>
      <span><strong>${window._brandAssets.filter(a=>a.type==='image').length}</strong> images</span>
      <span><strong>${window._brandAssets.filter(a=>a.type==='video').length}</strong> videos</span>`;
  }

  if (!assets.length) {
    grid.innerHTML = `<div class="ba-empty">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="6" y="10" width="36" height="28" rx="4" stroke="rgba(0,201,200,.3)" stroke-width="2.5"/><path d="M6 32l12-10 8 6 6-5 10 7" stroke="rgba(0,201,200,.25)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p>${window._brandAssets.length ? 'No assets match your filter' : 'No brand assets yet — upload your first creative above'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = assets.map(a => {
    const sizeStr = a.size > 1048576 ? (a.size/1048576).toFixed(1)+' MB' : Math.round(a.size/1024)+' KB';
    const thumb   = a.type === 'image'    ? `<img class="ba-card-thumb" src="${a.url}" alt="${a.name}" loading="lazy">`
                  : a.type === 'video'    ? `<div class="ba-card-thumb-icon">🎬</div>`
                  : a.type === 'document' ? `<div class="ba-card-thumb-icon">📄</div>`
                  :                         `<div class="ba-card-thumb-icon">🖼️</div>`;
    return `<div class="ba-card" id="ba-card-${a.id}">
      ${thumb}
      <div class="ba-card-body">
        <div class="ba-card-name" title="${a.name}">${a.name}</div>
        <div class="ba-card-meta">
          <span>${sizeStr}</span>
          <span class="ba-card-tag">${a.tag||'General'}</span>
        </div>
      </div>
      <div class="ba-card-actions">
        <button class="ba-card-btn ba-card-btn-view" onclick="baPreview('${a.id}')">Preview</button>
        ${a.type === 'image' ? `<button class="ba-card-btn" style="background:#F5F3FF;color:#7B68EE;border-color:#DDD6FE" onclick="baRemoveBg('${a.id}','${a.url}')">🪄 Remove BG</button>` : ''}
        <button class="ba-card-btn ba-card-btn-del" onclick="baDelete('${a.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

// Upload files
async function baHandleFiles(files) {
  if (!files || !files.length) return;
  const tag   = document.getElementById('ba-upload-tag')?.value || 'General';
  const form  = new FormData();
  Array.from(files).forEach(f => form.append('files', f));
  form.append('tag', tag);

  const progWrap = document.getElementById('baUploadProgress');
  const progBar  = document.getElementById('baProgressBar');
  const progLbl  = document.getElementById('baProgressLabel');
  if (progWrap) { progWrap.style.display = 'block'; progBar.style.width = '10%'; progLbl.textContent = `Uploading ${files.length} file(s)…`; }

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/creatives/upload');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && progBar) progBar.style.width = Math.round(e.loaded/e.total*90) + '%';
    };
    const result = await new Promise((resolve, reject) => {
      xhr.onload = () => resolve(JSON.parse(xhr.responseText));
      xhr.onerror = reject;
      xhr.send(form);
    });
    if (progBar) progBar.style.width = '100%';
    if (progLbl) progLbl.textContent = `✅ ${result.files?.length || 0} file(s) uploaded`;
    setTimeout(() => { if (progWrap) progWrap.style.display = 'none'; }, 1800);
    await baLoadAssets();
    showToast(`✅ ${result.files?.length || 0} brand asset(s) uploaded`);
  } catch (err) {
    if (progLbl) progLbl.textContent = `⚠ Upload failed: ${err.message}`;
    setTimeout(() => { if (progWrap) progWrap.style.display = 'none'; }, 3000);
  }

  // Reset file input so same file can be re-uploaded
  const inp = document.getElementById('ba-file-input');
  if (inp) inp.value = '';
}

// Preview lightbox
function baPreview(id) {
  const asset = window._brandAssets.find(a => a.id === id);
  if (!asset) return;
  if (asset.type === 'video') { window.open(asset.url, '_blank'); return; }
  if (asset.type === 'document') { window.open(asset.url, '_blank'); return; }
  const lb = document.createElement('div');
  lb.className = 'ba-lightbox';
  lb.innerHTML = `<div class="ba-lightbox-inner">
    <img class="ba-lightbox-img" src="${asset.url}" alt="${asset.name}">
    <button class="ba-lightbox-close" onclick="this.closest('.ba-lightbox').remove()">✕</button>
  </div>`;
  lb.onclick = e => { if (e.target === lb) lb.remove(); };
  document.body.appendChild(lb);
}

// Delete
async function baDelete(id) {
  const asset = window._brandAssets.find(a => a.id === id);
  if (!asset) return;
  if (!confirm(`Delete "${asset.name}"? This cannot be undone.`)) return;
  try {
    await fetch('/api/creatives/' + encodeURIComponent(id), { method: 'DELETE' });
    window._brandAssets = window._brandAssets.filter(a => a.id !== id);
    const card = document.getElementById('ba-card-' + id);
    if (card) card.remove();
    baRender();
    showToast('Asset deleted');
  } catch { showToast('Delete failed'); }
}

// Remove background — calls remove.bg API, uploads result as new asset
async function baRemoveBg(id, imgUrl) {
  const card = document.getElementById('ba-card-' + id);
  const btn  = card ? card.querySelector('button[onclick*="baRemoveBg"]') : null;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Processing…'; }
  try {
    const r = await fetch('/api/tools/remove-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imgUrl })
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'remove.bg failed');

    // Convert base64 PNG to a File and upload to brand assets
    const byteArr = Uint8Array.from(atob(d.result_b64), c => c.charCodeAt(0));
    const blob    = new Blob([byteArr], { type: 'image/png' });
    const origAsset = window._brandAssets.find(a => a.id === id);
    const newName = (origAsset ? origAsset.name.replace(/\.[^.]+$/, '') : 'image') + '_no_bg.png';
    const file    = new File([blob], newName, { type: 'image/png' });

    const form = new FormData();
    form.append('files', file);
    form.append('tag', origAsset?.tag || 'No BG');
    const up = await fetch('/api/creatives/upload', { method: 'POST', body: form }).then(x => x.json());
    await baLoadAssets();
    showToast(`✅ Background removed — saved as "${newName}"`);
  } catch(err) {
    showToast('⚠ ' + (err.message || 'Remove BG failed'));
    if (btn) { btn.disabled = false; btn.textContent = '🪄 Remove BG'; }
  }
}

// ── Re-export bare top-level declarations on window ──────────────────────────
// These were global by virtue of being top-level declarations in app.js; the
// SPA dispatch (navigateTo) and inline onclick= handlers resolve them by name.
// Made explicit here so the move stays robust.
window.initSerpView    = initSerpView;
window.runSerpSearch   = runSerpSearch;
window.renderSerpResults = renderSerpResults;
window.initBrandAssets = initBrandAssets;
window.baSetupDragDrop = baSetupDragDrop;
window.baLoadAssets    = baLoadAssets;
window.baFilterTag     = baFilterTag;
window.baRender        = baRender;
window.baHandleFiles   = baHandleFiles;
window.baPreview       = baPreview;
window.baDelete        = baDelete;
window.baRemoveBg      = baRemoveBg;

})();
