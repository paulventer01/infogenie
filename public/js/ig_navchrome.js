// ════════════════════════════════════════════════════════════════════════════
// ig_navchrome.js — Navigation chrome (extracted from app.js)
//   • Slim Sidebar       — collapsible nav sub-sections + per-dropdown filter
//   • View Header        — auto-injected uniform header + breadcrumbs
//   • Related Views      — sibling-view pill bar
// Plain <script> attaching only to window globals (no behavior change).
// Loaded after app.js in index.html (server auto-appends content-hash ?v=).
// ════════════════════════════════════════════════════════════════════════════

/* ─── Slim Sidebar — collapsible sub-sections + per-dropdown search filter ───
 * Transforms each .nav-dropdown so that:
 *  - sub-section headers are click-to-collapse (chevron + count badge)
 *  - top of dropdown gets a "Filter…" input that hides non-matching items live
 *  - default state: first 2 sections open, rest collapsed (per-group, persisted)
 *  - the cross-group "Next →" footer link stays OUTSIDE collapsible sections
 * Pure client-side enhancement — index.html nav structure is untouched.
 */
(function(){
  const KEY = 'ig_navmenu_collapsed_v1';
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(_){ state = {}; }
  function persist(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(_){} }

  function slimOne(wrap){
    const group = wrap.getAttribute('data-group');
    if (!group) return;
    const dropdown = wrap.querySelector('.nav-dropdown');
    if (!dropdown || dropdown.dataset.slimmed === '1') return;
    dropdown.dataset.slimmed = '1';

    // 1) Search input (sticky at top)
    const search = document.createElement('div');
    search.className = 'nav-drop-search';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'nav-drop-search-input';
    input.placeholder = 'Filter ' + group + '…';
    input.setAttribute('aria-label', 'Filter ' + group + ' menu');
    search.appendChild(input);
    dropdown.insertBefore(search, dropdown.firstChild);

    // 2) Group children into sections by .nav-drop-header
    //    .nav-drop-next is the cross-group footer — leave it OUTSIDE all sections
    const children = Array.from(dropdown.children).filter(c => c !== search);
    const sections = [];
    let cur = null;
    children.forEach(c => {
      if (c.classList.contains('nav-drop-header')) {
        cur = { header: c, items: [] };
        sections.push(cur);
      } else if (c.classList.contains('nav-link') && cur) {
        cur.items.push(c);
      }
      // .nav-drop-next & anything else: leave in place
    });

    if (!state[group]) state[group] = {};

    sections.forEach((s, i) => {
      // default: first 2 open, rest collapsed
      if (state[group][i] === undefined) state[group][i] = (i >= 2);

      const sec = document.createElement('div');
      sec.className = 'nav-drop-section';
      sec.dataset.idx = String(i);

      const hdr = s.header;
      const labelText = hdr.textContent.trim();
      hdr.classList.add('nav-drop-header-toggle');
      hdr.innerHTML = '';
      const chev = document.createElement('span'); chev.className = 'ndh-chev'; chev.textContent = '▸';
      const txt = document.createElement('span'); txt.className = 'ndh-text'; txt.textContent = labelText;
      const cnt = document.createElement('span'); cnt.className = 'ndh-count'; cnt.textContent = String(s.items.length);
      hdr.appendChild(chev); hdr.appendChild(txt); hdr.appendChild(cnt);

      // Insert section wrapper in place of the original header
      hdr.parentNode.insertBefore(sec, hdr);
      sec.appendChild(hdr);
      const body = document.createElement('div');
      body.className = 'nav-drop-section-body';
      s.items.forEach(it => body.appendChild(it));
      sec.appendChild(body);

      if (state[group][i]) sec.classList.add('collapsed');

      hdr.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        sec.classList.toggle('collapsed');
        state[group][i] = sec.classList.contains('collapsed');
        persist();
      });
    });

    // 3) Live filter
    let filterTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        const q = input.value.trim().toLowerCase();
        dropdown.querySelectorAll('.nav-drop-section').forEach(sec => {
          let any = false;
          sec.querySelectorAll('.nav-link').forEach(link => {
            const text = (link.querySelector('.ndl-text')?.textContent || link.textContent || '').toLowerCase();
            const match = !q || text.includes(q);
            link.style.display = match ? '' : 'none';
            if (match) any = true;
          });
          if (q) {
            sec.classList.toggle('search-hidden', !any);
            sec.classList.remove('collapsed'); // expand all matches while searching
          } else {
            sec.classList.remove('search-hidden');
            const idx = parseInt(sec.dataset.idx, 10);
            if (state[group] && state[group][idx]) sec.classList.add('collapsed');
            else sec.classList.remove('collapsed');
          }
        });
      }, 80);
    });
    // Don't let keystrokes/clicks in the search bubble up to nav handlers
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { input.value = ''; input.dispatchEvent(new Event('input')); input.blur(); }
    });
  }

  function slimAll(){
    document.querySelectorAll('.nav-group-wrap[data-group]').forEach(slimOne);
  }

  function init(){
    slimAll();
    // Watch for late-rendered nav (SPAs may rebuild it after login)
    const mo = new MutationObserver(() => slimAll());
    try { mo.observe(document.body, { childList:true, subtree:true }); } catch(_){}
    setTimeout(() => { try { mo.disconnect(); } catch(_){} }, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── Standardized View Header — auto-injects a uniform header into any
 *     .view.active container that doesn't already have one (._shell uses
 *     .view-header; the new injector uses .ig-view-hdr). Pulls title from the
 *     matching nav-link's .ndl-text and group name from the parent nav-group.
 *     Adds a "?" help button that opens the existing tour modal.
 */
(function(){
  function _e(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // Group-name overrides for nicer breadcrumbs (data-group → label)
  const GROUP_LABEL = { analyse:'Analyse', create:'Create', reach:'Reach', grow:'Grow', manage:'Manage', 'ai-team':'AI Team' };

  function getMeta(viewId){
    const link = document.querySelector('.nav-link[data-view="' + (viewId||'').replace(/"/g,'') + '"]');
    if (!link) return null;
    const titleEl = link.querySelector('.ndl-text');
    const title = (titleEl ? titleEl.textContent : link.textContent || viewId).trim();
    const groupWrap = link.closest('.nav-group-wrap[data-group]');
    const groupKey = groupWrap ? groupWrap.getAttribute('data-group') : '';
    const group = GROUP_LABEL[groupKey] || groupKey || '';
    return { title, group };
  }

  function viewIdFromEl(el){
    const id = el.id || '';
    return id.startsWith('view-') ? id.slice(5) : '';
  }

  function alreadyHasHeader(view){
    // Skip if _shell-style header is present anywhere in the first ~200 nodes,
    // OR if our injected header is already there.
    if (view.querySelector(':scope > .ig-view-hdr')) return true;
    if (view.querySelector(':scope > .view-header, :scope > div > .view-header')) return true;
    return false;
  }

  function inject(view){
    if (!view || alreadyHasHeader(view)) return;
    const viewId = viewIdFromEl(view);
    if (!viewId) return;
    const meta = getMeta(viewId);
    if (!meta) return; // only inject for views that have a real nav entry

    const hdr = document.createElement('div');
    hdr.className = 'ig-view-hdr';
    hdr.innerHTML =
      '<div class="ig-view-hdr-crumb">' +
        (meta.group ? _e(meta.group) + '<span class="crumb-sep">›</span>' : '') +
        _e(meta.title) +
      '</div>' +
      '<div class="ig-view-hdr-row">' +
        '<h1 class="ig-view-hdr-title">' + _e(meta.title) + '</h1>' +
        '<button class="ig-view-hdr-help" title="Show help (Shift+?)" aria-label="Show help for this view">?</button>' +
      '</div>';
    hdr.querySelector('.ig-view-hdr-help').addEventListener('click', e => {
      e.preventDefault();
      const tourBtn = document.getElementById('ig-tour-btn');
      if (tourBtn) tourBtn.click();
    });
    view.insertBefore(hdr, view.firstChild);
  }

  function scan(){
    document.querySelectorAll('.view.active').forEach(inject);
  }

  function init(){
    scan();
    // Re-scan whenever any .view's class attribute changes (covers navigateTo)
    const mo = new MutationObserver(muts => {
      let needsScan = false;
      for (const m of muts) {
        if (m.type === 'attributes' && m.attributeName === 'class' && m.target.classList && m.target.classList.contains('view')) {
          needsScan = true; break;
        }
      }
      if (needsScan) setTimeout(scan, 30); // let the view-builder finish injecting content first
    });
    document.querySelectorAll('.view').forEach(v => {
      try { mo.observe(v, { attributes:true, attributeFilter:['class'] }); } catch(_){}
    });
    // Also re-scan on any childList change inside body (catches late-rendered views)
    let scanTimer = null;
    const bodyMo = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 60); });
    try { bodyMo.observe(document.body, { childList:true, subtree:false }); } catch(_){}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── Related Views pill bar — surfaces sibling views for the 6 duplicate-looking
 *     pairs flagged in the audit, so users see the relationship without us
 *     removing any functionality. Injected just below the header (works for
 *     both _shell .view-header and the auto-injected .ig-view-hdr).
 */
(function(){
  function _e(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  const RELATED = {
    'competitors':        [['intelligence','Intelligence Hub']],
    'intelligence':       [['competitors','Competitor Profiles']],
    'campaigns':          [['launches','Product Launch Calendar'],['advertise','Advertise Hub']],
    'launches':           [['campaigns','Campaign Strategy']],
    'dashboard':          [['results','Results Snapshot'],['kpi-tracker','KPI Tracker']],
    'results':            [['dashboard','Dashboard'],['kpi-tracker','KPI Tracker']],
    'kpi-tracker':        [['dashboard','Dashboard'],['results','Results Snapshot']],
    'seo-auditor':        [['seo-crawler','Full-Site Crawler'],['ai-audit-suite','AI Audit Suite']],
    'seo-crawler':        [['seo-auditor','On-Page Audit'],['ai-audit-suite','AI Audit Suite']],
    'cold-email':         [['email-personalizer','1-to-1 Personalizer'],['reply-assistant','Reply Assistant']],
    'email-personalizer': [['cold-email','Cold Email Writer'],['reply-assistant','Reply Assistant']],
    'reply-assistant':    [['cold-email','Cold Email Writer'],['email-personalizer','1-to-1 Personalizer']],
    'journey-builder':    [['automations','Automations'],['signal-triggers','Signal Triggers']],
    'automations':        [['journey-builder','Journey Builder'],['signal-triggers','Signal Triggers']],
    'signal-triggers':    [['journey-builder','Journey Builder'],['automations','Automations']]
  };

  function viewIdFromEl(el){
    const id = el.id || '';
    return id.startsWith('view-') ? id.slice(5) : '';
  }

  function findHeader(view){
    return view.querySelector(':scope > .ig-view-hdr')
        || view.querySelector(':scope > .view-header')
        || view.querySelector(':scope > div > .view-header');
  }

  function buildPill(viewId, label){
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'ig-related-pill';
    a.dataset.targetView = viewId;
    a.innerHTML = '↔ ' + _e(label);
    a.addEventListener('click', e => {
      e.preventDefault();
      const link = document.querySelector('.nav-link[data-view="' + viewId.replace(/"/g,'') + '"]');
      if (link) link.click();
      else if (typeof window.navigateTo === 'function') { try { window.navigateTo(viewId); } catch(_){} }
    });
    return a;
  }

  function inject(view){
    const viewId = viewIdFromEl(view);
    if (!viewId || !RELATED[viewId]) return;
    if (view.querySelector(':scope > .ig-related-bar, :scope .ig-related-bar')) return;

    const bar = document.createElement('div');
    bar.className = 'ig-related-bar';
    const label = document.createElement('span');
    label.className = 'ig-related-label';
    label.textContent = 'Related:';
    bar.appendChild(label);
    RELATED[viewId].forEach(([id,name]) => bar.appendChild(buildPill(id, name)));

    // Place the bar right after the header if there is one, else at the top
    const hdr = findHeader(view);
    if (hdr && hdr.parentNode === view) {
      view.insertBefore(bar, hdr.nextSibling);
    } else if (hdr) {
      // header is nested (e.g. inside _shell's wrapper) — insert at view top
      view.insertBefore(bar, view.firstChild);
    } else {
      view.insertBefore(bar, view.firstChild);
    }
  }

  function scan(){
    document.querySelectorAll('.view.active').forEach(inject);
  }

  function init(){
    scan();
    const mo = new MutationObserver(muts => {
      let need = false;
      for (const m of muts) {
        if (m.type === 'attributes' && m.attributeName === 'class' && m.target.classList && m.target.classList.contains('view')) { need = true; break; }
      }
      if (need) setTimeout(scan, 80); // wait for the standard header to inject first
    });
    document.querySelectorAll('.view').forEach(v => { try { mo.observe(v, { attributes:true, attributeFilter:['class'] }); } catch(_){} });
    let t = null;
    const bm = new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 100); });
    try { bm.observe(document.body, { childList:true, subtree:false }); } catch(_){}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
