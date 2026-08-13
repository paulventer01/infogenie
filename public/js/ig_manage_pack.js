// ============================================================================
// InfoGenie — extracted feature module: Manage pack: New Project · Brand Calendar · Ask InfoGenie · Infographics · Heatmaps · Question Miner · AI Providers · Ad Swipe · Brand Foundation · Budget Board · Web Analytics
// ----------------------------------------------------------------------------
// PART OF THE app.js SPLIT (see public/js/README.md). This file was carved out
// of the monolithic app.js with NO behavior change. Conventions:
//   • Classic <script> (NOT an ES module). Loaded from index.html AFTER app.js
//     with its own ?v= cache-bust string, so editing this feature only forces a
//     re-download of THIS file, not the whole 50k-line app.js.
//   • Every public entry point stays attached to window (e.g. window.buildX),
//     exactly as before, so navigateTo()'s dispatch and inline onclick= handlers
//     keep resolving. Feature-private helpers stay inside the IIFE.
//   • Shared globals (showToast, navigateTo, _esc, _safeUrl, analysisData, …)
//     are defined in app.js and are available here at call time.
// ============================================================================

/* ──────────────────────────────────────────────────────────────────────────
   New Project · Brand Calendar · Budget Board · Web Analytics
   ────────────────────────────────────────────────────────────────────────── */
(function(){
  function _esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  async function _f(url, opts){
    const r = await fetch(url, Object.assign({headers:{'Content-Type':'application/json'}}, opts||{}, opts&&opts.body?{body:typeof opts.body==='string'?opts.body:JSON.stringify(opts.body)}:{}));
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(j.error||('HTTP '+r.status));
    return j;
  }
  function _toast(msg, kind){ if (typeof showToast==='function') return showToast((kind==='err'?'⚠️ ':'✓ ')+msg); alert(msg); }
  function _money(cents){ return '$'+((cents||0)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function _ymToday(){ return new Date().toISOString().slice(0,7); }

  /* ═══════════ NEW PROJECT ═══════════ */
  window.buildNewProject = async function(){
    const wrap = document.getElementById('newProjectWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="max-width:1100px;margin:0 auto">
        <div style="margin-bottom:24px">
          <h1 style="margin:0;font-size:1.6rem;color:#0F172A">✨ New Marketing Project</h1>
          <p style="margin:6px 0 0;color:#64748B;font-size:0.92rem">Set up a project once — then launch campaigns, schedule posts, track budget, and measure results all under one roof.</p>
        </div>
        <div style="background:#fff;border:1px solid #FED7AA;border-radius:14px;padding:24px;margin-bottom:24px">
          <h3 style="margin:0 0 16px;color:#9A3412;font-size:1.05rem">Project details</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div><label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Project name *</label>
              <input id="np_name" placeholder="e.g. Q1 2026 Product Launch" style="width:100%;padding:9px;border:1px solid #FED7AA;border-radius:8px"></div>
            <div><label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Owner email</label>
              <input id="np_owner" placeholder="you@company.com" style="width:100%;padding:9px;border:1px solid #FED7AA;border-radius:8px"></div>
          </div>
          <label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Primary goal *</label>
          <textarea id="np_goal" rows="2" placeholder="e.g. Drive 500 demo bookings in Q1 from US enterprise market" style="width:100%;padding:9px;border:1px solid #FED7AA;border-radius:8px;font-family:inherit;margin-bottom:14px"></textarea>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px">
            <div><label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Monthly budget (USD)</label>
              <input id="np_budget" type="number" placeholder="5000" style="width:100%;padding:9px;border:1px solid #FED7AA;border-radius:8px"></div>
            <div><label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Start date</label>
              <input id="np_start" type="date" style="width:100%;padding:9px;border:1px solid #FED7AA;border-radius:8px"></div>
            <div><label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">End date</label>
              <input id="np_end" type="date" style="width:100%;padding:9px;border:1px solid #FED7AA;border-radius:8px"></div>
          </div>
          <label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:6px">Channels</label>
          <div id="np_channels" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px">
            ${['Email','SMS','WhatsApp','Voice','Web Push','Meta Ads','Google Ads','TikTok Ads','Social Organic','SEO','Influencer','Events'].map(c=>`<label style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:99px;padding:6px 12px;cursor:pointer;font-size:0.82rem;display:inline-flex;align-items:center;gap:6px"><input type="checkbox" value="${c}" style="margin:0">${c}</label>`).join('')}
          </div>
          <button id="np_save" style="padding:11px 22px;background:linear-gradient(135deg,#0f766e,#0f766e);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer">Create Project</button>
        </div>
        <h3 style="margin:0 0 12px;color:#0F172A;font-size:1.05rem">Your projects</h3>
        <div id="np_list" style="display:grid;gap:10px"></div>
      </div>`;
    document.getElementById('np_save').onclick = async ()=>{
      const name = document.getElementById('np_name').value.trim();
      if (!name){ _toast('Project name required','err'); return; }
      const channels = Array.from(document.querySelectorAll('#np_channels input:checked')).map(i=>i.value);
      try{
        const r = await _f('/api/projects',{method:'POST',body:{
          name, goal: document.getElementById('np_goal').value,
          monthly_budget: +document.getElementById('np_budget').value||0,
          channels, owner_email: document.getElementById('np_owner').value.trim(),
          start_date: document.getElementById('np_start').value || null,
          end_date: document.getElementById('np_end').value || null
        }});
        try { localStorage.setItem('ig_active_project_id', r.id); localStorage.setItem('ig_active_project_name', name); } catch(_){}
        _toast('Project created — set as active');
        document.getElementById('np_name').value=''; document.getElementById('np_goal').value='';
        document.getElementById('np_budget').value=''; document.querySelectorAll('#np_channels input:checked').forEach(i=>i.checked=false);
        refresh();
      }catch(e){_toast(e.message,'err');}
    };
    async function refresh(){
      const list = document.getElementById('np_list');
      try{
        const {projects=[]} = await _f('/api/projects');
        if (!projects.length){ list.innerHTML='<div style="background:#fff;border:1px dashed #FED7AA;border-radius:10px;padding:24px;text-align:center;color:#64748B">No projects yet.</div>'; return; }
        const activeId = localStorage.getItem('ig_active_project_id') || '';
        list.innerHTML = projects.map(p=>`
          <div style="background:#fff;border:1px solid ${p.id===activeId?'#0f766e':'#E2E8F0'};border-radius:12px;padding:16px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center">
            <div>
              <div style="display:flex;align-items:center;gap:10px">
                <strong style="color:#0F172A;font-size:1rem">${_esc(p.name)}</strong>
                ${p.id===activeId?'<span style="background:#0f766e;color:#fff;padding:2px 8px;border-radius:99px;font-size:0.65rem;font-weight:700">ACTIVE</span>':''}
              </div>
              <div style="color:#64748B;font-size:0.84rem;margin-top:4px">${_esc(p.goal||'No goal set')} · $${(p.monthly_budget||0).toLocaleString()}/mo · ${(p.channels||[]).length} channels</div>
            </div>
            <div style="display:flex;gap:6px">
              <button data-act="${p.id}" data-name="${_esc(p.name)}" style="padding:6px 12px;background:#FED7AA;border:1px solid #0f766e;border-radius:7px;cursor:pointer;font-weight:600;font-size:0.82rem">Set Active</button>
              <button data-del="${p.id}" style="padding:6px 11px;background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;border-radius:7px;cursor:pointer;font-weight:600;font-size:0.82rem">✕</button>
            </div>
          </div>`).join('');
        list.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{ try{ localStorage.setItem('ig_active_project_id',b.dataset.act); localStorage.setItem('ig_active_project_name',b.dataset.name);}catch(_){ } _toast('Active: '+b.dataset.name); refresh(); });
        list.querySelectorAll('[data-del]').forEach(b=>b.onclick=async ()=>{ if (!confirm('Delete this project?')) return; try{ await _f('/api/projects/'+b.dataset.del,{method:'DELETE'}); refresh(); }catch(e){_toast(e.message,'err');} });
      }catch(e){ list.innerHTML='<div style="color:#B91C1C">'+_esc(e.message)+'</div>'; }
    }
    refresh();
  };

  /* ═══════════ BRAND CALENDAR ═══════════ */
  window.buildBrandCalendar = async function(){
    const wrap = document.getElementById('brandCalendarWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="max-width:1300px;margin:0 auto">
        <div style="margin-bottom:20px">
          <h1 style="margin:0;font-size:1.6rem;color:#0F172A">📅 Brand Calendar</h1>
          <p style="margin:6px 0 0;color:#64748B;font-size:0.92rem">Plan everything across 10 categories. Filter the sidebar, click a day to add an item.</p>
        </div>
        <div style="display:grid;grid-template-columns:240px 1fr;gap:20px">
          <div style="background:#fff;border:1px solid #BAE6FD;border-radius:12px;padding:14px;height:fit-content">
            <h3 style="margin:0 0 10px;color:#075985;font-size:0.95rem">Calendar</h3>
            <div id="bc_cats"></div>
          </div>
          <div style="background:#fff;border:1px solid #BAE6FD;border-radius:12px;padding:18px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
              <div style="display:flex;align-items:center;gap:8px">
                <button id="bc_prev" style="width:32px;height:32px;border:1px solid #BAE6FD;background:#F0F9FF;border-radius:8px;cursor:pointer;font-weight:700">‹</button>
                <strong id="bc_month_label" style="font-size:1.1rem;color:#0F172A;min-width:170px;text-align:center"></strong>
                <button id="bc_next" style="width:32px;height:32px;border:1px solid #BAE6FD;background:#F0F9FF;border-radius:8px;cursor:pointer;font-weight:700">›</button>
              </div>
              <div style="display:flex;gap:8px">
                <button id="bc_gcal" title="Sync this month's Brand Calendar items to Google Calendar as all-day events" style="padding:8px 14px;background:#fff;color:#0369a1;border:1px solid #BAE6FD;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.85rem">📅 Sync to Google Calendar</button>
                <button id="bc_add" style="padding:8px 16px;background:linear-gradient(135deg,#0EA5E9,#0284C7);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">+ Add item</button>
              </div>
            </div>
            <div id="bc_grid"></div>
          </div>
        </div>
      </div>`;
    const {categories=[]} = await _f('/api/brand-calendar/categories');
    let activeCat = '';
    const cats = document.getElementById('bc_cats');
    const renderCats = ()=>{
      cats.innerHTML = `<a href="#" data-cat="" style="display:block;padding:8px 10px;border-radius:7px;text-decoration:none;font-weight:600;font-size:0.86rem;background:${activeCat===''?'#0EA5E9':'transparent'};color:${activeCat===''?'#fff':'#075985'};margin-bottom:4px">All categories</a>`+
        categories.map(c=>`<a href="#" data-cat="${c.id}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;text-decoration:none;font-size:0.86rem;background:${activeCat===c.id?c.color:'transparent'};color:${activeCat===c.id?'#fff':'#0F172A'};font-weight:${activeCat===c.id?'700':'500'}"><span style="width:8px;height:8px;border-radius:99px;background:${c.color}"></span>${_esc(c.label)}</a>`).join('');
      cats.querySelectorAll('[data-cat]').forEach(a=>a.onclick=(e)=>{e.preventDefault();activeCat=a.dataset.cat;renderCats();renderGrid();});
    };
    renderCats();

    let viewYear = new Date().getFullYear(), viewMonth = new Date().getMonth();
    document.getElementById('bc_prev').onclick = ()=>{ if (viewMonth===0){viewMonth=11;viewYear--;}else viewMonth--; renderGrid(); };
    document.getElementById('bc_next').onclick = ()=>{ if (viewMonth===11){viewMonth=0;viewYear++;}else viewMonth++; renderGrid(); };
    document.getElementById('bc_add').onclick = ()=> openAdd(null);
    document.getElementById('bc_gcal').onclick = () => _bcSyncToGCal(viewYear, viewMonth);

    async function _bcSyncToGCal(year, month) {
      const btn = document.getElementById('bc_gcal');
      if (!btn) return;
      btn.disabled = true; btn.textContent = '⏳ Syncing…';
      try {
        const from = new Date(year, month, 1, -12, 0).toISOString();
        const to   = new Date(year, month + 1, 1, 12, 0).toISOString();
        const { items = [] } = await _f(`/api/brand-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        if (!items.length) {
          if (window._toast || window.showToast) (window.showToast || window._toast)('No items this month to sync.');
          btn.disabled = false; btn.textContent = '📅 Sync to Google Calendar'; return;
        }
        const r = await fetch('/api/integrations/workspace/calendar/sync', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) {
          if (j.error && j.error.includes('not connected')) {
            alert('Google Workspace is not connected yet.\n\nGo to Settings → Google Workspace → Connect via OAuth to link your account.');
          } else {
            alert('Sync failed: ' + (j.error || 'unknown'));
          }
        } else {
          const msg = `✅ ${j.synced} item${j.synced !== 1 ? 's' : ''} synced to Google Calendar${j.failed ? ` (${j.failed} failed)` : ''}.`;
          if (window.showToast) showToast(msg); else alert(msg);
        }
      } catch (e) {
        alert('Sync error: ' + e.message);
      }
      btn.disabled = false; btn.textContent = '📅 Sync to Google Calendar';
    }

    async function renderGrid(){
      const monthName = new Date(viewYear, viewMonth, 1).toLocaleString('default',{month:'long',year:'numeric'});
      document.getElementById('bc_month_label').textContent = monthName;
      // Widen by ±12h so timezone-shifted edges are included; client groups by local date below
      const from = new Date(viewYear, viewMonth, 1, -12, 0).toISOString();
      const to   = new Date(viewYear, viewMonth+1, 1, 12, 0).toISOString();
      const q = new URLSearchParams({from,to}); if (activeCat) q.set('category',activeCat);
      const {items=[]} = await _f('/api/brand-calendar?'+q.toString());
      const byDay = {};
      items.forEach(i=>{ const d=new Date(i.scheduled_at).getDate(); (byDay[d]=byDay[d]||[]).push(i); });
      const firstDow = new Date(viewYear,viewMonth,1).getDay();
      const daysIn = new Date(viewYear,viewMonth+1,0).getDate();
      const cells = [];
      for (let i=0;i<firstDow;i++) cells.push('<div></div>');
      for (let d=1; d<=daysIn; d++){
        const list = byDay[d]||[];
        cells.push(`<div data-day="${d}" style="border:1px solid #E0F2FE;border-radius:8px;min-height:90px;padding:6px;background:#fff;cursor:pointer">
          <div style="font-weight:700;color:#075985;font-size:0.78rem;margin-bottom:4px">${d}</div>
          ${list.slice(0,3).map(i=>{const c=categories.find(x=>x.id===i.category)||{color:'#64748B'};return `<div data-itm="${i.id}" style="background:${c.color};color:#fff;font-size:0.7rem;padding:2px 5px;border-radius:4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${_esc(i.title)}">${_esc(i.title)}</div>`;}).join('')}
          ${list.length>3?`<div style="font-size:0.65rem;color:#64748B">+${list.length-3} more</div>`:''}
        </div>`);
      }
      document.getElementById('bc_grid').innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div style="text-align:center;font-size:0.72rem;font-weight:700;color:#64748B;padding:4px">${d}</div>`).join('')}</div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">${cells.join('')}</div>`;
      document.getElementById('bc_grid').querySelectorAll('[data-day]').forEach(c=>c.onclick=(e)=>{ if (e.target.closest('[data-itm]')){ const id=e.target.closest('[data-itm]').dataset.itm; const it=items.find(x=>x.id===id); openAdd(it); return; } openAdd(null, +c.dataset.day); });
    }

    function openAdd(existing, day){
      const m = document.createElement('div');
      m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999';
      const d = existing? new Date(existing.scheduled_at) : new Date(viewYear, viewMonth, day||new Date().getDate(), 9, 0);
      const dtv = new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
      m.innerHTML = `<div style="background:#fff;border-radius:14px;padding:24px;width:480px;max-width:90vw">
        <h3 style="margin:0 0 14px;color:#0F172A">${existing?'Edit':'New'} calendar item</h3>
        <label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Category</label>
        <select id="bcm_cat" style="width:100%;padding:9px;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:10px">${categories.map(c=>`<option value="${c.id}" ${existing&&existing.category===c.id?'selected':''}>${_esc(c.label)}</option>`).join('')}</select>
        <label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Title</label>
        <input id="bcm_title" value="${_esc(existing?.title||'')}" placeholder="e.g. Send launch email" style="width:100%;padding:9px;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:10px">
        <label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">When</label>
        <input id="bcm_when" type="datetime-local" value="${dtv}" style="width:100%;padding:9px;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:10px">
        <label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Notes</label>
        <textarea id="bcm_notes" rows="2" style="width:100%;padding:9px;border:1px solid #E2E8F0;border-radius:8px;font-family:inherit;margin-bottom:14px">${_esc(existing?.notes||'')}</textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          ${existing?'<button id="bcm_del" style="margin-right:auto;padding:9px 16px;background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;border-radius:8px;cursor:pointer;font-weight:600">Delete</button>':''}
          <button id="bcm_cx" style="padding:9px 16px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;cursor:pointer">Cancel</button>
          <button id="bcm_sv" style="padding:9px 18px;background:#0EA5E9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700">Save</button>
        </div></div>`;
      document.body.appendChild(m);
      const close = ()=>m.remove();
      m.querySelector('#bcm_cx').onclick = close;
      m.querySelector('#bcm_sv').onclick = async ()=>{
        try{ await _f('/api/brand-calendar',{method:'POST',body:{
          id: existing?.id, category: m.querySelector('#bcm_cat').value, title: m.querySelector('#bcm_title').value.trim(),
          scheduled_at: new Date(m.querySelector('#bcm_when').value).toISOString(), notes: m.querySelector('#bcm_notes').value
        }}); close(); renderGrid(); }catch(e){_toast(e.message,'err');}
      };
      if (existing) m.querySelector('#bcm_del').onclick = async ()=>{ if (!confirm('Delete?')) return; try{ await _f('/api/brand-calendar/'+existing.id,{method:'DELETE'}); close(); renderGrid(); }catch(e){_toast(e.message,'err');} };
    }
    renderGrid();
  };

  /* ═══════════ ASK INFOGENIE (Onyx-style) ═══════════ */
  window.buildAskInfogenie = async function(){
    const wrap = document.getElementById('askInfogenieWrap'); if (!wrap) return;
    const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hdrs = (window.apiHeaders ? window.apiHeaders() : { 'Content-Type':'application/json' });

    const TYPE_LABELS = { campaign:'Campaigns', insight:'Ad Insights', lead:'Leads', mention:'Mentions', landing_page:'Landing Pages', content_calendar:'Content', brand_calendar:'Brand Calendar', budget:'Budget', booking:'Bookings', linksell:'Link-in-Bio', audience:'Audiences', task:'Tasks' };
    const TYPE_ICONS  = { campaign:'📣', insight:'📊', lead:'👤', mention:'💬', landing_page:'🔗', content_calendar:'📅', brand_calendar:'🗓', budget:'💰', booking:'📆', linksell:'🔗', audience:'👥', task:'✅' };

    // Load index status
    let indexStatus = { indexed: 0, lastUpdated: null };
    try { const s = await fetch('/api/platform-search/index-status', { headers: hdrs }).then(x=>x.json()); if (s.ok) indexStatus = s; } catch {}

    const lastUpdStr = indexStatus.lastUpdated
      ? new Date(indexStatus.lastUpdated).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
      : null;

    wrap.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="background:linear-gradient(135deg,#0066FF,#0f766e);border-radius:8px;padding:5px 10px;font-size:0.7rem;font-weight:800;color:#fff;letter-spacing:.04em">⚡ SMART SEARCH</div>
            <div style="font-size:0.75rem;color:#6B7280">${indexStatus.indexed > 0 ? `${indexStatus.indexed} indexed chunks${lastUpdStr ? ' · updated '+lastUpdStr : ''}` : 'Not yet indexed — will auto-index on first question'}</div>
          </div>
          <button id="aiReindex" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:5px 11px;border-radius:7px;font-size:0.72rem;font-weight:700;cursor:pointer">🔄 Re-index data</button>
        </div>
        <div style="display:flex;gap:8px">
          <input id="aiQ" placeholder="e.g. Which campaign has the worst CPC? · Which leads should I call first? · Any negative mentions?" style="flex:1;padding:11px 14px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.92rem">
          <button id="aiGo" style="background:linear-gradient(135deg,#0066FF,#0f766e);color:#fff;border:0;padding:11px 22px;border-radius:7px;font-weight:800;cursor:pointer">Ask →</button>
        </div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          ${['What changed in the last 7 days?','Which landing page is converting best?','Are any campaigns over budget?','Which leads should I call first?','What\'s scheduled this week?'].map(q => `<button class="aiSugg" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:5px 10px;border-radius:14px;font-size:0.74rem;cursor:pointer">${esc(q)}</button>`).join('')}
        </div>
      </div>
      <div id="aiOut"></div>`;

    document.querySelectorAll('.aiSugg').forEach(b => b.addEventListener('click', () => { document.getElementById('aiQ').value = b.textContent; document.getElementById('aiGo').click(); }));

    document.getElementById('aiReindex').addEventListener('click', async () => {
      const btn = document.getElementById('aiReindex');
      btn.textContent = '⏳ Indexing…'; btn.disabled = true;
      try {
        const r = await fetch('/api/platform-search/reindex', { method:'POST', headers: hdrs }).then(x=>x.json());
        if (r.ok) { showToast(`✅ Indexed ${r.chunks} chunks (${r.embedded} embedded)`); window.buildAskInfogenie(); }
        else { showToast('⚠️ ' + (r.error||'Reindex failed')); btn.textContent = '🔄 Re-index data'; btn.disabled = false; }
      } catch(e) { showToast('⚠️ ' + e.message); btn.textContent = '🔄 Re-index data'; btn.disabled = false; }
    });

    document.getElementById('aiGo').addEventListener('click', async () => {
      const q = document.getElementById('aiQ').value.trim();
      if (!q) return;
      const out = document.getElementById('aiOut');
      out.innerHTML = '<div style="color:#9CA3AF;display:flex;align-items:center;gap:8px"><span style="animation:spin 1s linear infinite;display:inline-block">⚙️</span> Searching your data semantically…</div>';
      try {
        const r = await fetch('/api/platform-search/ask', { method:'POST', headers: hdrs, body: JSON.stringify({ question: q }) });
        const j = await r.json();
        if (!j.ok) { out.innerHTML = '<div style="color:#DC2626">'+esc(j.error||'failed')+'</div>'; return; }
        const ansHtml = esc(j.answer).replace(/\n/g,'<br>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/^[-•]\s/gm,'• ');

        const isVector = j.source === 'vector-retrieval';
        const sourceBadge = isVector
          ? `<span style="background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;padding:3px 8px;border-radius:12px;font-size:0.68rem;font-weight:700">⚡ Vector Search</span>`
          : `<span style="background:#F3F4F6;color:#6B7280;border:1px solid #E5E7EB;padding:3px 8px;border-radius:12px;font-size:0.68rem;font-weight:700">💬 GPT snapshot</span>`;

        const dataChips = (j.dataTypes||[]).length
          ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">${(j.dataTypes||[]).map(t=>`<span style="background:#F0FDF4;color:#166534;border:1px solid #BBF7D0;padding:3px 8px;border-radius:10px;font-size:0.68rem;font-weight:600">${(TYPE_ICONS[t]||'')+(TYPE_LABELS[t]||t)}</span>`).join('')}</div>`
          : '';

        const autoIndexNote = j.autoIndexed
          ? `<div style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1D4ED8;padding:8px 12px;border-radius:7px;font-size:0.75rem;margin-bottom:10px">⚡ Your data was indexed automatically (${j.indexCount} chunks). Future questions will be faster.</div>`
          : '';

        const topScoreHtml = (j.topScores||[]).length && isVector
          ? `<div style="margin-top:8px;font-size:0.68rem;color:#9CA3AF">Top matches: ${j.topScores.map(s=>`${(TYPE_ICONS[s.type]||'')}${(TYPE_LABELS[s.type]||s.type)} (${s.score}%)`).join(' · ')}</div>`
          : '';

        let fallbackHtml = '';
        if (j.source === 'fallback' && j.context) {
          const t = j.context.totals || {};
          fallbackHtml = `
            <div style="background:#FEF3C7;border:1px solid #FBBF24;color:#92400E;padding:10px 14px;border-radius:8px;font-size:0.8rem;margin-bottom:14px">
              💡 Add a real OpenAI key in Manage → AI Providers to unlock semantic search.
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
              ${[['Campaigns',t.campaigns],['Leads',t.leads],['Mentions',t.mentions],['Landing Pages',t.landingPages],['Bookings',t.bookings]].map(([k,v])=>`<div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px"><div style="font-size:0.7rem;color:#6B7280;text-transform:uppercase;font-weight:700">${esc(k)}</div><div style="font-size:1.6rem;font-weight:800;color:#0A1628">${v||0}</div></div>`).join('')}
            </div>`;
        }

        out.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          ${autoIndexNote}
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            ${sourceBadge}
            ${j.chunksUsed ? `<span style="font-size:0.7rem;color:#9CA3AF">Searched ${j.indexCount||0} chunks · used ${j.chunksUsed} most relevant</span>` : ''}
          </div>
          <div style="font-size:0.95rem;line-height:1.6;color:#0A1628">${ansHtml}</div>
          ${dataChips}
          ${topScoreHtml}
          ${fallbackHtml}
        </div>`;
      } catch(e) { out.innerHTML = '<div style="color:#DC2626">'+esc(e.message)+'</div>'; }
    });
  };

  /* ═══════════ INFOGRAPHIC GENERATOR (Napkin-style) ═══════════ */
  window.buildInfographics = async function(){
    const wrap = document.getElementById('infographicsWrap'); if (!wrap) return;
    const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hdrs = (window.apiHeaders ? window.apiHeaders() : { 'Content-Type':'application/json' });
    wrap.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px;display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">TOPIC</label><input id="igTopic" placeholder="e.g. The 5 stages of a B2B sales funnel" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">LAYOUT</label><select id="igLayout" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box">${['funnel','list','comparison','journey','quadrant','pyramid','cycle'].map(l=>'<option value="'+l+'">'+l+'</option>').join('')}</select></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">ITEMS</label><input id="igCount" type="number" min="3" max="7" value="5" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box"></div>
        <button id="igGo" style="background:linear-gradient(135deg,#0f766e,#0284c7);color:#fff;border:0;padding:10px 22px;border-radius:7px;font-weight:800;cursor:pointer">✨ Generate</button>
      </div>
      <div id="igOut"></div>
      <h3 style="margin:24px 0 10px;color:#0A1628;font-family:Sora,sans-serif">📚 Recent</h3>
      <div id="igHistory"></div>`;

    function renderSVG(d){
      const w=800,h=500,pal=d.palette||{primary:'#0066FF',accent:'#0f766e',text:'#0A1628'};
      const items=d.items||[];
      let body='';
      if (d.layout==='funnel') {
        const max=items.length, step=(h-160)/max;
        body = items.map((it,i)=>{const top=120+i*step; const ww=w-160-i*((w-160)/max*0.6); const x=(w-ww)/2; return `<polygon points="${x},${top} ${x+ww},${top} ${x+ww-((w-160)/max*0.6)/2},${top+step-10} ${x+((w-160)/max*0.6)/2},${top+step-10}" fill="${i%2?pal.accent:pal.primary}" opacity="${0.5+i*0.08}"/><text x="${w/2}" y="${top+step/2}" text-anchor="middle" fill="#fff" font-weight="800" font-size="16">${esc(it.label)}</text><text x="${w/2}" y="${top+step/2+18}" text-anchor="middle" fill="#fff" font-size="11" opacity="0.9">${esc(it.value||'')}</text>`;}).join('');
      } else if (d.layout==='comparison') {
        const cw=(w-100)/2;
        body = items.slice(0,2).map((it,i)=>`<rect x="${50+i*cw}" y="120" width="${cw-10}" height="${h-160}" fill="${i?pal.accent:pal.primary}" rx="12"/><text x="${50+i*cw+cw/2}" y="160" text-anchor="middle" fill="#fff" font-weight="800" font-size="22">${esc(it.label)}</text><text x="${50+i*cw+cw/2}" y="200" text-anchor="middle" fill="#fff" font-size="14" opacity="0.9">${esc(it.value||'')}</text><foreignObject x="${60+i*cw}" y="220" width="${cw-30}" height="${h-260}"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#fff;font-size:13px;line-height:1.5">${esc(it.detail||'')}</div></foreignObject>`).join('');
      } else if (d.layout==='quadrant') {
        body=`<line x1="${w/2}" y1="100" x2="${w/2}" y2="${h-40}" stroke="#E5E7EB" stroke-width="2"/><line x1="60" y1="${(h+60)/2}" x2="${w-60}" y2="${(h+60)/2}" stroke="#E5E7EB" stroke-width="2"/>`+items.slice(0,4).map((it,i)=>{const cx=(i%2?3*w/4:w/4); const cy=(i<2?(h+60)/4+60:(h+60)*3/4+30); return `<circle cx="${cx}" cy="${cy}" r="60" fill="${i%2?pal.accent:pal.primary}" opacity="0.85"/><text x="${cx}" y="${cy}" text-anchor="middle" fill="#fff" font-weight="800" font-size="14">${esc(it.label)}</text><text x="${cx}" y="${cy+18}" text-anchor="middle" fill="#fff" font-size="11">${esc(it.value||'')}</text>`;}).join('');
      } else if (d.layout==='pyramid') {
        const max=items.length, step=(h-160)/max;
        body=items.map((it,i)=>{const top=120+i*step; const lvl=i+1; const ww=200+lvl*((w-300)/max); const x=(w-ww)/2; return `<rect x="${x}" y="${top}" width="${ww}" height="${step-8}" fill="${i%2?pal.accent:pal.primary}" rx="6" opacity="${1-i*0.1}"/><text x="${w/2}" y="${top+step/2}" text-anchor="middle" fill="#fff" font-weight="800" font-size="15">${esc(it.label)}</text>`;}).join('');
      } else if (d.layout==='cycle') {
        const cx=w/2, cy=h/2+20, r=160;
        body=items.map((it,i)=>{const a=(i/items.length)*2*Math.PI-Math.PI/2; const x=cx+r*Math.cos(a), y=cy+r*Math.sin(a); return `<circle cx="${x}" cy="${y}" r="55" fill="${i%2?pal.accent:pal.primary}"/><text x="${x}" y="${y}" text-anchor="middle" fill="#fff" font-weight="800" font-size="13">${esc(it.label)}</text><text x="${x}" y="${y+16}" text-anchor="middle" fill="#fff" font-size="10">${esc(it.value||'')}</text>`;}).join('')+`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${pal.primary}" stroke-width="2" stroke-dasharray="6 6" opacity="0.4"/>`;
      } else if (d.layout==='journey') {
        const step=(w-120)/items.length;
        body=`<line x1="60" y1="${h/2}" x2="${w-60}" y2="${h/2}" stroke="${pal.primary}" stroke-width="3"/>`+items.map((it,i)=>{const x=60+step*i+step/2; return `<circle cx="${x}" cy="${h/2}" r="38" fill="${i%2?pal.accent:pal.primary}"/><text x="${x}" y="${h/2+5}" text-anchor="middle" fill="#fff" font-weight="800" font-size="14">${i+1}</text><text x="${x}" y="${h/2-55}" text-anchor="middle" fill="${pal.text}" font-weight="700" font-size="13">${esc(it.label)}</text><text x="${x}" y="${h/2+75}" text-anchor="middle" fill="#6B7280" font-size="11">${esc(it.value||'')}</text>`;}).join('');
      } else {
        body=items.map((it,i)=>`<rect x="60" y="${120+i*65}" width="${w-120}" height="55" fill="${i%2?pal.accent:pal.primary}" rx="8" opacity="0.92"/><text x="80" y="${152+i*65}" fill="#fff" font-weight="800" font-size="16">${i+1}. ${esc(it.label)}</text><text x="${w-80}" y="${152+i*65}" text-anchor="end" fill="#fff" font-size="13" opacity="0.9">${esc(it.value||'')}</text>`).join('');
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:900px;height:auto;background:#fff;border-radius:12px;border:1px solid #E5E7EB">
        <text x="${w/2}" y="50" text-anchor="middle" fill="${pal.text}" font-weight="900" font-size="26" font-family="Sora,sans-serif">${esc(d.title||'')}</text>
        ${d.subtitle?`<text x="${w/2}" y="78" text-anchor="middle" fill="#6B7280" font-size="14">${esc(d.subtitle)}</text>`:''}
        ${body}
        <text x="${w/2}" y="${h-15}" text-anchor="middle" fill="${pal.accent}" font-size="12" font-style="italic">${esc(d.takeaway||'')}</text>
      </svg>`;
    }

    // Sanitize id to filename-safe chars before using anywhere
    const safeId = s => String(s||'infographic').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40) || 'infographic';
    function show(d, id){
      const svg = renderSVG(d);
      const sid = safeId(id);
      const out = document.getElementById('igOut');
      out.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
        ${svg}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="igDlSvg" style="background:#0066FF;color:#fff;border:0;padding:8px 16px;border-radius:6px;font-weight:700;cursor:pointer">⬇ SVG</button>
          <button id="igDlPng" style="background:#0f766e;color:#fff;border:0;padding:8px 16px;border-radius:6px;font-weight:700;cursor:pointer">⬇ PNG</button>
        </div>
      </div>`;
      window._igLastSvg = svg;
      document.getElementById('igDlSvg').addEventListener('click', () => doDownload(sid, 'svg'));
      document.getElementById('igDlPng').addEventListener('click', () => doDownload(sid, 'png'));
    }
    function doDownload(id, kind){
      const svg = window._igLastSvg; if (!svg) return;
      const sid = safeId(id);
      if (kind==='svg') { const blob=new Blob([svg],{type:'image/svg+xml'}); const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=sid+'.svg'; a.click(); URL.revokeObjectURL(u); return; }
      const img=new Image(); const blob=new Blob([svg],{type:'image/svg+xml'}); const u=URL.createObjectURL(blob);
      img.onload=()=>{const c=document.createElement('canvas');c.width=1600;c.height=1000;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1600,1000);x.drawImage(img,0,0,1600,1000);const a=document.createElement('a');a.href=c.toDataURL('image/png');a.download=sid+'.png';a.click();URL.revokeObjectURL(u);};
      img.src=u;
    }

    async function loadHistory(){
      try {
        const r = await fetch('/api/infographics/list', { headers: hdrs });
        const j = await r.json();
        const h = document.getElementById('igHistory');
        if (!j.items?.length) { h.innerHTML = '<div style="color:#9CA3AF;font-size:0.85rem">No infographics yet.</div>'; return; }
        h.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${j.items.map((it,i)=>`<div class="igHistItem" data-idx="${i}" style="background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:12px;cursor:pointer"><div style="font-weight:700;font-size:0.85rem;color:#0A1628">${esc(it.title||it.topic||'Untitled')}</div><div style="font-size:0.7rem;color:#6B7280;margin-top:4px">${esc(it.layout)} · ${(it.items||[]).length} items</div></div>`).join('')}</div>`;
        window._igHistItems = j.items;
        h.querySelectorAll('.igHistItem').forEach(el => el.addEventListener('click', () => {
          const it = window._igHistItems[parseInt(el.dataset.idx,10)];
          if (it) { show(it, it.id||'infographic'); window.scrollTo({top:0,behavior:'smooth'}); }
        }));
      } catch(e) {}
    }

    document.getElementById('igGo').addEventListener('click', async () => {
      const topic = document.getElementById('igTopic').value.trim();
      const layout = document.getElementById('igLayout').value;
      const itemCount = parseInt(document.getElementById('igCount').value, 10) || 5;
      if (!topic) { alert('Topic required'); return; }
      document.getElementById('igOut').innerHTML = '<div style="color:#9CA3AF">⏳ Designing…</div>';
      try {
        const r = await fetch('/api/infographics/generate', { method:'POST', headers: hdrs, body: JSON.stringify({ topic, layout, itemCount }) });
        const j = await r.json();
        if (!j.ok) { document.getElementById('igOut').innerHTML = '<div style="color:#DC2626">'+esc(j.error||'failed')+'</div>'; return; }
        show(j.infographic, j.id);
        loadHistory();
      } catch(e) { document.getElementById('igOut').innerHTML = '<div style="color:#DC2626">'+esc(e.message)+'</div>'; }
    });
    loadHistory();
  };

  /* ═══════════ HEATMAPS (Microsoft Clarity) ═══════════ */
  window.buildHeatmaps = async function(){
    const wrap = document.getElementById('heatmapsWrap'); if (!wrap) return;
    const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hdrs = (window.apiHeaders ? window.apiHeaders() : { 'Content-Type':'application/json' });
    wrap.innerHTML = '<div style="color:#9CA3AF">Loading…</div>';
    try {
      const c = await fetch('/api/heatmaps/config', { headers: hdrs }).then(r=>r.json());
      const ins = await fetch('/api/heatmaps/insights', { headers: hdrs }).then(r=>r.json());
      wrap.innerHTML = `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
          <h3 style="margin:0 0 10px;font-family:Sora,sans-serif">🔌 Connect Microsoft Clarity (free)</h3>
          <p style="color:#6B7280;font-size:0.85rem;margin:0 0 12px">1. Sign up at <a href="https://clarity.microsoft.com" target="_blank" rel="noopener" style="color:#0066FF">clarity.microsoft.com</a> (free, no card). 2. Create a project, copy the <strong>Project ID</strong>. 3. (Optional) Generate an API token in Settings → Data Export.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
            <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">PROJECT ID</label><input id="hmPid" value="${esc(c.project_id||'')}" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box"></div>
            <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">API TOKEN (optional)</label><input id="hmTok" type="password" placeholder="${c.has_token?'(set — replace to update)':'paste token'}" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box"></div>
            <button id="hmSave" style="background:#0066FF;color:#fff;border:0;padding:10px 22px;border-radius:7px;font-weight:800;cursor:pointer">💾 Save</button>
          </div>
        </div>
        ${c.snippet ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:14px;margin-bottom:18px"><div style="font-weight:800;color:#92400E;margin-bottom:6px">📋 Paste this snippet on your site (before &lt;/head&gt;) to start collecting data</div><pre style="background:#fff;padding:10px;border-radius:6px;font-size:0.74rem;overflow-x:auto;margin:0">${esc(c.snippet)}</pre></div>` : ''}
        ${c.dashboard_url ? `<a href="${esc(c.dashboard_url)}" target="_blank" rel="noopener" style="display:inline-block;margin-bottom:18px;background:linear-gradient(135deg,#0f766e,#0f766e);color:#fff;padding:10px 22px;border-radius:7px;font-weight:800;text-decoration:none">🔗 Open Clarity Dashboard →</a>` : ''}
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <h3 style="margin:0 0 12px;font-family:Sora,sans-serif">📊 Insights (last ${ins.days||3} day${ins.days===1?'':'s'})</h3>
          ${ins.note ? `<div style="background:#F0F9FF;border:1px solid #BAE6FD;color:#075985;padding:10px;border-radius:6px;margin-bottom:14px;font-size:0.84rem">${esc(ins.note)}</div>` : ''}
          ${ins.byUrl?.length ? `<div style="margin-bottom:16px"><div style="font-weight:800;margin-bottom:6px">Top URLs (Clarity)</div><pre style="background:#F9FAFB;padding:10px;border-radius:6px;font-size:0.78rem;overflow-x:auto">${esc(JSON.stringify(ins.byUrl.slice(0,8),null,2))}</pre></div>` : ''}
          ${ins.byDevice?.length ? `<div style="margin-bottom:16px"><div style="font-weight:800;margin-bottom:6px">By Device</div><pre style="background:#F9FAFB;padding:10px;border-radius:6px;font-size:0.78rem;overflow-x:auto">${esc(JSON.stringify(ins.byDevice,null,2))}</pre></div>` : ''}
          <div><div style="font-weight:800;margin-bottom:6px">Your tracked landing pages</div>${ins.landingPages?.length ? `<table style="width:100%;border-collapse:collapse;font-size:0.85rem"><thead><tr style="background:#F9FAFB;text-align:left"><th style="padding:8px">Page</th><th style="padding:8px">Traffic</th><th style="padding:8px">Conversions</th></tr></thead><tbody>${ins.landingPages.map(p=>`<tr style="border-top:1px solid #F3F4F6"><td style="padding:8px">${esc(p.title||p.slug)}</td><td style="padding:8px">${p.traffic_total||0}</td><td style="padding:8px">${p.conv_total||0}</td></tr>`).join('')}</tbody></table>` : '<div style="color:#9CA3AF;font-size:0.85rem">No landing pages yet — build some in Reach → Landing Pages.</div>'}</div>
          ${(ins.notes||[]).length ? `<div style="margin-top:14px;padding:10px;background:#FEF2F2;color:#991B1B;border-radius:6px;font-size:0.78rem">${ins.notes.map(esc).join('<br>')}</div>` : ''}
        </div>`;
      document.getElementById('hmSave').addEventListener('click', async () => {
        const project_id = document.getElementById('hmPid').value.trim();
        const api_token = document.getElementById('hmTok').value.trim();
        try {
          await fetch('/api/heatmaps/config', { method:'POST', headers: hdrs, body: JSON.stringify({ project_id, api_token }) });
          window.buildHeatmaps();
        } catch(e) { alert(e.message); }
      });
    } catch(e) { wrap.innerHTML = '<div style="color:#DC2626">'+esc(e.message)+'</div>'; }
  };

  /* ═══════════ QUESTION MINING (AnswerThePublic) ═══════════ */
  window.buildQuestionMiner = async function(){
    const wrap = document.getElementById('questionMinerWrap'); if (!wrap) return;
    const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hdrs = (window.apiHeaders ? window.apiHeaders() : { 'Content-Type':'application/json' });

    // Auto-fill seed from analysis data: prefer industry, fall back to brand name
    const _ad = window.analysisData || {};
    const _autoSeed = (typeof _ad.industry === 'string' ? _ad.industry : (_ad.industry && _ad.industry.name) || '')
      || _ad.brandName || '';

    wrap.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px;display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">SEED KEYWORD / TOPIC ${_autoSeed ? '<span style="color:#15803D;font-weight:600">(auto-filled from your analysis)</span>' : ''}</label>
          <input id="qmSeed" value="${esc(_autoSeed)}" placeholder="e.g. solar panel installation" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box;background:${_autoSeed?'#F0FDF4':'#fff'}">
        </div>
        <button id="qmGo" style="background:linear-gradient(135deg,#0066FF,#0f766e);color:#fff;border:0;padding:10px 22px;border-radius:7px;font-weight:800;cursor:pointer">🔎 Mine Questions</button>
      </div>
      <div id="qmOut"></div>`;
    document.getElementById('qmGo').addEventListener('click', async () => {
      const seed = document.getElementById('qmSeed').value.trim();
      const out = document.getElementById('qmOut');
      if (!seed) { out.innerHTML = '<div style="background:#FEF3C7;color:#92400E;padding:10px 14px;border-radius:8px">⚠️ Please enter a keyword or topic to mine questions for.</div>'; return; }
      out.innerHTML = '<div style="color:#9CA3AF">⏳ Asking Google what people ask…</div>';
      try {
        const r = await fetch('/api/question-miner/mine', { method:'POST', headers: hdrs, body: JSON.stringify({ seed }) });
        const j = await r.json();
        if (!j.ok) { out.innerHTML = '<div style="color:#DC2626">'+esc(j.error||'failed')+'</div>'; return; }
        const buckets = Object.keys(j.grouped||{}).sort();
        out.innerHTML = `<div style="margin-bottom:12px;font-size:0.85rem;color:#6B7280">${j.total} question(s) for <strong>${esc(j.seed)}</strong> · source: ${esc(j.source)}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">${buckets.map(b => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px"><div style="font-weight:800;color:#0A1628;text-transform:uppercase;font-size:0.78rem;margin-bottom:8px">${esc(b)} (${j.grouped[b].length})</div>${j.grouped[b].map(q => `<div style="padding:8px 0;border-top:1px solid #F3F4F6;display:flex;justify-content:space-between;gap:8px;align-items:start"><div style="font-size:0.84rem;color:#374151;line-height:1.4">${esc(q.question)}</div><button onclick="window._qmAdd(this, ${JSON.stringify(q.question).replace(/"/g,'&quot;')})" style="background:#F0FDF4;border:1px solid #86EFAC;color:#065F46;padding:4px 8px;border-radius:5px;font-size:0.7rem;font-weight:700;cursor:pointer;flex-shrink:0">+ Calendar</button></div>`).join('')}</div>`).join('')}</div>`;
      } catch(e) { out.innerHTML = '<div style="color:#DC2626">'+esc(e.message)+'</div>'; }
    });
    window._qmAdd = async function(btn, question){
      try {
        const r = await fetch('/api/question-miner/to-calendar', { method:'POST', headers: hdrs, body: JSON.stringify({ question, channel:'blog' }) });
        const j = await r.json();
        if (j.ok) { btn.textContent = '✅ Added'; btn.style.background='#D1FAE5'; btn.disabled=true; }
        else { btn.textContent = '⚠'; }
      } catch(e) { btn.textContent = '⚠'; }
    };
  };

  /* ═══════════ AI PROVIDERS (BYO LLM) ═══════════ */
  window.buildAiProviders = async function(){
    const wrap = document.getElementById('aiProvidersWrap'); if (!wrap) return;
    const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hdrs = (window.apiHeaders ? window.apiHeaders() : { 'Content-Type':'application/json' });
    const CATS = [
      { key:'writing',  label:'✍️ Writing',  hint:'Copy, ad creative, content calendar, cold emails' },
      { key:'analysis', label:'🧮 Analysis', hint:'Attack plans, scoring, classification, Q&A over your data' },
      { key:'vision',   label:'👁️ Vision',   hint:'Image understanding, brand audits, screenshot reviews' },
      { key:'audio',    label:'🎙️ Audio',    hint:'Voice-over / TTS for storyboards' }
    ];
    const PRESETS = [
      { name:'Groq Llama 3.1 70B', base_url:'https://api.groq.com/openai/v1', model:'llama-3.1-70b-versatile' },
      { name:'DeepSeek Chat',      base_url:'https://api.deepseek.com',       model:'deepseek-chat' },
      { name:'Mistral Large',      base_url:'https://api.mistral.ai/v1',      model:'mistral-large-latest' },
      { name:'OpenRouter',         base_url:'https://openrouter.ai/api/v1',   model:'meta-llama/llama-3.1-70b-instruct' },
      { name:'Together AI',        base_url:'https://api.together.xyz/v1',    model:'meta-llama/Llama-3-70b-chat-hf' },
      { name:'Ollama (local)',     base_url:'http://localhost:11434/v1',      model:'llama3.1' },
      { name:'Azure OpenAI',       base_url:'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',  model:'gpt-5' }
    ];

    async function load(){
      try {
        const [list, active] = await Promise.all([
          fetch('/api/ai-providers/list',   { headers: hdrs }).then(r=>r.json()),
          fetch('/api/ai-providers/active', { headers: hdrs }).then(r=>r.json())
        ]);
        render(list.items || [], active.active || {});
      } catch(e) { wrap.innerHTML = '<div style="color:#DC2626">'+esc(e.message)+'</div>'; }
    }

    function render(items, active){
      wrap.innerHTML = `
        <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:14px;margin-bottom:18px;font-size:0.86rem;color:#075985">
          <strong>How this works:</strong> InfoGenie ships with OpenAI, Claude, Perplexity, Gemini and Cloudflare AI built in. Add your own OpenAI-compatible endpoint here, mark it as <em>default</em> for a category, and the matching features will route through it first. Empty = fall back to built-ins.
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:18px">
          ${CATS.map(c => { const a = active[c.key]; return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:12px"><div style="font-weight:800;color:#0A1628">${c.label}</div><div style="font-size:0.72rem;color:#6B7280;margin:4px 0 8px">${c.hint}</div><div style="font-size:0.82rem;color:${a?'#065F46':'#9CA3AF'};font-weight:700">${a ? esc(a.name) + ' · ' + esc(a.model) : '— (using built-in)'}</div></div>`; }).join('')}
        </div>

        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
          <h3 style="margin:0 0 12px;font-family:Sora,sans-serif">➕ Add Provider</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">DISPLAY NAME</label><input id="apName" placeholder="e.g. Groq Llama 3.1" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box"></div>
            <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">CATEGORY</label><select id="apCat" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box">${CATS.map(c=>'<option value="'+c.key+'">'+c.label+'</option>').join('')}</select></div>
            <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">BASE URL (OpenAI-compatible)</label><input id="apUrl" placeholder="https://api.groq.com/openai/v1" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box"></div>
            <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">MODEL</label><input id="apModel" placeholder="llama-3.1-70b-versatile" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box"></div>
            <div style="grid-column:span 2"><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">API KEY</label><input id="apKey" type="password" placeholder="sk-…" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;box-sizing:border-box"></div>
            <div style="grid-column:span 2"><label style="display:flex;align-items:center;gap:6px;font-size:0.84rem;color:#374151"><input type="checkbox" id="apDef" checked> Set as default for this category</label></div>
          </div>
          <div style="margin-bottom:10px">
            <div style="font-size:0.72rem;font-weight:700;color:#6B7280;margin-bottom:4px">PRESETS (click to pre-fill)</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">${PRESETS.map((p,i)=>`<button class="apPre" data-idx="${i}" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:5px 10px;border-radius:14px;font-size:0.74rem;cursor:pointer">${esc(p.name)}</button>`).join('')}</div>
          </div>
          <button id="apAdd" style="background:linear-gradient(135deg,#0066FF,#0f766e);color:#fff;border:0;padding:10px 22px;border-radius:7px;font-weight:800;cursor:pointer">💾 Add Provider</button>
        </div>

        <h3 style="margin:0 0 10px;font-family:Sora,sans-serif">📚 Configured Providers (${items.length})</h3>
        ${items.length ? `<div style="display:flex;flex-direction:column;gap:8px">${items.map(it => `
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center">
            <div>
              <div style="font-weight:800;color:#0A1628">${esc(it.name)} ${it.is_default?'<span style="background:#D1FAE5;color:#065F46;font-size:0.68rem;padding:2px 6px;border-radius:10px;margin-left:6px">DEFAULT</span>':''} ${it.enabled?'':'<span style="background:#FEE2E2;color:#991B1B;font-size:0.68rem;padding:2px 6px;border-radius:10px;margin-left:6px">DISABLED</span>'}</div>
              <div style="font-size:0.78rem;color:#6B7280;margin-top:3px">${esc(it.category)} · <code style="background:#F3F4F6;padding:1px 5px;border-radius:3px">${esc(it.model)}</code> · ${esc(it.base_url)} · key ${esc(it.api_key_preview||'(not set)')}</div>
              <div id="apTest_${it.id}" style="margin-top:6px;font-size:0.78rem"></div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="apTest" data-id="${it.id}" style="background:#F0F9FF;border:1px solid #BAE6FD;color:#075985;padding:6px 12px;border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer">🧪 Test</button>
              <button class="apDef2" data-id="${it.id}" data-cat="${esc(it.category)}" style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:6px 12px;border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer">⭐ Default</button>
              <button class="apTog" data-id="${it.id}" data-en="${it.enabled?0:1}" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:6px 12px;border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer">${it.enabled?'⏸ Disable':'▶ Enable'}</button>
              <button class="apDel" data-id="${it.id}" style="background:#FEE2E2;border:1px solid #FCA5A5;color:#991B1B;padding:6px 12px;border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer">🗑</button>
            </div>
          </div>`).join('')}</div>` : '<div style="color:#9CA3AF;font-size:0.85rem">No providers configured yet — add one above.</div>'}
      `;

      document.querySelectorAll('.apPre').forEach(b => b.addEventListener('click', () => {
        const p = PRESETS[parseInt(b.dataset.idx,10)];
        document.getElementById('apName').value  = p.name;
        document.getElementById('apUrl').value   = p.base_url;
        document.getElementById('apModel').value = p.model;
      }));
      document.getElementById('apAdd').addEventListener('click', async () => {
        const body = {
          name:       document.getElementById('apName').value.trim(),
          category:   document.getElementById('apCat').value,
          base_url:   document.getElementById('apUrl').value.trim(),
          model:      document.getElementById('apModel').value.trim(),
          api_key:    document.getElementById('apKey').value.trim(),
          is_default: document.getElementById('apDef').checked
        };
        if (!body.name || !body.base_url || !body.model || !body.api_key) { alert('Name, base URL, model and API key are required.'); return; }
        try {
          const r = await fetch('/api/ai-providers/create', { method:'POST', headers: hdrs, body: JSON.stringify(body) });
          const j = await r.json();
          if (!j.ok) { alert(j.error || 'failed'); return; }
          load();
        } catch(e) { alert(e.message); }
      });
      document.querySelectorAll('.apTest').forEach(b => b.addEventListener('click', async () => {
        const id = b.dataset.id; const out = document.getElementById('apTest_'+id);
        out.innerHTML = '<span style="color:#9CA3AF">⏳ Testing…</span>';
        try {
          const j = await fetch('/api/ai-providers/test/'+id, { method:'POST', headers: hdrs }).then(r=>r.json());
          if (j.ok) out.innerHTML = `<span style="color:#065F46;font-weight:700">✅ ${j.latency_ms}ms · "${esc(String(j.sample||'').slice(0,80))}"</span>`;
          else      out.innerHTML = `<span style="color:#991B1B;font-weight:700">❌ ${esc(j.error || ('HTTP ' + (j.status||'?')))}</span>`;
        } catch(e) { out.innerHTML = '<span style="color:#991B1B">❌ '+esc(e.message)+'</span>'; }
      }));
      document.querySelectorAll('.apDef2').forEach(b => b.addEventListener('click', async () => {
        try { await fetch('/api/ai-providers/update/'+b.dataset.id, { method:'POST', headers: hdrs, body: JSON.stringify({ is_default: true }) }); load(); }
        catch(e) { alert(e.message); }
      }));
      document.querySelectorAll('.apTog').forEach(b => b.addEventListener('click', async () => {
        try { await fetch('/api/ai-providers/update/'+b.dataset.id, { method:'POST', headers: hdrs, body: JSON.stringify({ enabled: b.dataset.en === '1' }) }); load(); }
        catch(e) { alert(e.message); }
      }));
      document.querySelectorAll('.apDel').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this provider? Routes using it will fall back to built-in.')) return;
        try { await fetch('/api/ai-providers/'+b.dataset.id, { method:'DELETE', headers: hdrs }); load(); }
        catch(e) { alert(e.message); }
      }));
    }

    wrap.innerHTML = '<div style="color:#9CA3AF">Loading…</div>';
    load();
  };

  /* ═══════════ AD SWIPE FILE ═══════════ */
  window.buildAdSwipe = async function(){
    const wrap = document.getElementById('adSwipeWrap');
    if (!wrap) return;
    const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hdrs = (window.apiHeaders ? window.apiHeaders() : { 'Content-Type':'application/json' });

    async function load(){
      const tag = document.getElementById('asTag')?.value.trim() || '';
      const adv = document.getElementById('asAdv')?.value.trim() || '';
      const isFiltered = !!(tag || adv);
      const qs = new URLSearchParams();
      if (tag) qs.set('tag', tag);
      if (adv) qs.set('advertiser', adv);

      // Visual feedback: show spinner in list + disable + time the Filter button
      const filterBtn = document.getElementById('asFilterBtn');
      const listEl = document.getElementById('asList');
      const t0 = Date.now();
      let timerIv = null;
      if (filterBtn) {
        filterBtn.disabled = true;
        filterBtn.style.opacity = '0.7';
        filterBtn.style.cursor = 'wait';
        filterBtn.innerHTML = '⏳ 0.0s';
        timerIv = setInterval(() => {
          filterBtn.innerHTML = `⏳ ${((Date.now()-t0)/1000).toFixed(1)}s`;
        }, 100);
      }
      if (listEl) {
        listEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:#6B7280;font-size:0.87rem">
          <span style="display:inline-block;width:18px;height:18px;border:2px solid #E5E7EB;border-top-color:#0066FF;border-radius:50%;animation:asSpin2 0.7s linear infinite;flex-shrink:0"></span>
          <style>@keyframes asSpin2{to{transform:rotate(360deg)}}</style>
          Searching your swipe file${isFiltered ? ' with the selected filters' : ''}…
        </div>`;
      }

      try {
        const r = await fetch('/api/ad-swipe/list?' + qs.toString(), { headers: hdrs });
        const j = await r.json();
        renderList(j.items || [], isFiltered, { tag, adv });
      } catch(e) {
        if (listEl) listEl.innerHTML = '<div style="color:#DC2626;padding:16px">'+esc(e.message)+'</div>';
      } finally {
        if (timerIv) clearInterval(timerIv);
        if (filterBtn) {
          filterBtn.disabled = false;
          filterBtn.style.opacity = '';
          filterBtn.style.cursor = '';
          filterBtn.innerHTML = '🔍 Filter';
        }
      }
    }

    function renderList(items, isFiltered, filters){
      const out = document.getElementById('asList');
      if (!items.length) {
        if (isFiltered) {
          const parts = [];
          if (filters && filters.adv) parts.push(`advertiser "<strong>${esc(filters.adv)}</strong>"`);
          if (filters && filters.tag) parts.push(`tag "<strong>${esc(filters.tag)}</strong>"`);
          out.innerHTML = `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:32px;text-align:center;color:#6B7280">
            <div style="font-size:1.4rem;margin-bottom:10px">🔍</div>
            <div style="font-weight:700;color:#374151;margin-bottom:6px">No saved ads match ${parts.join(' and ')}</div>
            <div style="font-size:0.82rem">Try clearing the filters, or go to <strong>Compete → Ad Library Spy</strong> to search and save ads for this advertiser.</div>
            <button onclick="window._asClearFilters()" style="margin-top:14px;background:#0066FF;color:#fff;border:0;padding:8px 20px;border-radius:6px;font-weight:700;cursor:pointer;font-size:0.82rem">Clear Filters</button>
          </div>`;
        } else {
          out.innerHTML = '<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:32px;text-align:center;color:#6B7280">Your swipe file is empty. Open <strong>Compete → Ad Library Spy</strong>, search a competitor, and click <strong>💾 Save to Swipe File</strong> on any winning ad.</div>';
        }
        return;
      }
      out.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px">${items.map(it => `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
            <div style="font-weight:800;color:#0A1628;font-size:0.92rem">${esc(it.advertiser)}</div>
            <div style="background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:800">${esc(it.source.toUpperCase())}</div>
          </div>
          ${it.headline ? `<div style="font-weight:700;color:#1E1B4B;font-size:0.86rem">${esc(it.headline)}</div>` : ''}
          ${it.body ? `<div style="color:#374151;font-size:0.8rem;line-height:1.45;white-space:pre-wrap;max-height:120px;overflow-y:auto">${esc(it.body.slice(0,400))}</div>` : ''}
          <div style="display:flex;gap:8px;align-items:center">
            <label style="font-size:0.7rem;color:#6B7280;font-weight:700">SCORE</label>
            <input type="number" min="0" max="10" value="${it.score||0}" data-id="${it.id}" class="as-score" style="width:60px;padding:4px 6px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem">
            <span style="font-size:0.68rem;color:#9CA3AF">/10</span>
          </div>
          <input class="as-tags" data-id="${it.id}" placeholder="tags (comma-separated)" value="${esc((it.tags||[]).join(', '))}" style="width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.78rem;box-sizing:border-box">
          <textarea class="as-notes" data-id="${it.id}" rows="2" placeholder="What makes this work?" style="width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.78rem;font-family:inherit;box-sizing:border-box;resize:vertical">${esc(it.notes||'')}</textarea>
          <div style="display:flex;gap:6px;margin-top:4px">
            <button onclick="window._asUpdate(${it.id}, this)" style="flex:1;background:#0066FF;color:#fff;border:0;padding:7px;border-radius:6px;font-size:0.74rem;font-weight:800;cursor:pointer">💾 Save</button>
            ${it.snapshot_url && /^https?:\/\//i.test(it.snapshot_url) ? `<a href="${esc(it.snapshot_url)}" target="_blank" rel="noopener" style="background:#F3F4F6;color:#374151;padding:7px 10px;border-radius:6px;font-size:0.74rem;font-weight:700;text-decoration:none">View →</a>` : ''}
            <button onclick="window._asDelete(${it.id})" style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:7px 10px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">🗑</button>
          </div>
          <div style="font-size:0.66rem;color:#9CA3AF">Saved ${new Date(it.saved_at).toLocaleDateString()}</div>
        </div>`).join('')}</div>`;
    }

    wrap.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px;margin-bottom:18px">
        <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">FILTER BY ADVERTISER</label>
            <div style="display:flex;gap:6px">
              <select id="asAdvPick" onchange="window._asAdvPickChange()" style="padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.82rem;min-width:170px;background:#fff">
                <option value="">— pick from your brands —</option>
              </select>
              <input id="asAdv" list="asAdvList" placeholder="any (or type)" style="flex:1;min-width:120px;padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.85rem;box-sizing:border-box">
              <datalist id="asAdvList"></datalist>
            </div>
          </div>
          <div style="flex:1;min-width:220px">
            <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">
              <span>FILTER BY TAG</span>
              <button type="button" onclick="window._asSuggestTags()" style="background:linear-gradient(135deg,#0f766e,#0066FF);color:#fff;border:0;padding:3px 10px;border-radius:12px;font-size:0.68rem;font-weight:800;cursor:pointer">🤖 AI Suggest</button>
            </label>
            <input id="asTag" list="asTagList" placeholder="any (or type)" style="width:100%;padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.85rem;box-sizing:border-box">
            <datalist id="asTagList"></datalist>
          </div>
          <button id="asFilterBtn" onclick="window._asReload()" style="background:#0066FF;color:#fff;border:0;padding:9px 18px;border-radius:6px;font-weight:800;cursor:pointer;font-size:0.84rem">🔍 Filter</button>
          <button onclick="window._asClearFilters()" style="background:#F3F4F6;color:#374151;border:1px solid #D1D5DB;padding:9px 14px;border-radius:6px;font-weight:700;cursor:pointer;font-size:0.82rem">Clear</button>
        </div>
        <div id="asTagSuggest" style="display:none;margin-top:10px;padding:10px;background:#F5F3FF;border:1px solid #DDD6FE;border-radius:8px"></div>
      </div>
      <div id="asList"><div style="color:#9CA3AF">Loading swipe file…</div></div>
    `;

    // ── Populate advertiser dropdown: own brand + analysed competitors + advertisers already in the swipe file
    (async function _asPopulateAdv(){
      const ad = window.analysisData || {};
      const norm = u => String(u||'').replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/.*$/,'').trim().toLowerCase();
      const domToBrand = d => { const c = (d||'').split('.')[0]; return c ? c.charAt(0).toUpperCase()+c.slice(1) : ''; };
      const own = ad.brandName || ad.companyName || domToBrand(norm(ad.url || ad.domain || ''));
      const comps = (Array.isArray(ad.competitors) ? ad.competitors : []).map(c => c.name || domToBrand(norm(c.domain||c.url||c.website||''))).filter(Boolean);
      let saved = [];
      try { const j = await fetch('/api/ad-swipe/advertisers', { headers: hdrs }).then(x => x.json()); saved = (j.advertisers || []).map(x => x.advertiser).filter(Boolean); } catch {}
      const sel = document.getElementById('asAdvPick'); const dl = document.getElementById('asAdvList');
      if (!sel || !dl) return;
      const opts = ['<option value="">— pick from your brands —</option>'];
      if (own) opts.push(`<option value="${esc(own)}">🏠 Your brand — ${esc(own)}</option>`);
      if (comps.length) {
        opts.push('<optgroup label="Your analysed competitors">');
        comps.forEach(n => opts.push(`<option value="${esc(n)}">${esc(n)}</option>`));
        opts.push('</optgroup>');
      }
      const inSwipeOnly = saved.filter(s => s !== own && !comps.includes(s));
      if (inSwipeOnly.length) {
        opts.push('<optgroup label="Already in your swipe file">');
        inSwipeOnly.forEach(n => opts.push(`<option value="${esc(n)}">${esc(n)}</option>`));
        opts.push('</optgroup>');
      }
      sel.innerHTML = opts.join('');
      const dlSet = new Set([own, ...comps, ...saved].filter(Boolean));
      dl.innerHTML = Array.from(dlSet).map(n => `<option value="${esc(n)}">`).join('');
    })();

    // ── Populate existing-tag datalist
    (async function _asPopulateTags(){
      try {
        const j = await fetch('/api/ad-swipe/tags', { headers: hdrs }).then(x => x.json());
        const dl = document.getElementById('asTagList'); if (dl) dl.innerHTML = (j.tags||[]).map(t => `<option value="${esc(t)}">`).join('');
      } catch {}
    })();

    window._asAdvPickChange = function(){
      const sel = document.getElementById('asAdvPick'); const inp = document.getElementById('asAdv');
      if (sel && inp && sel.value) inp.value = sel.value;
    };
    window._asClearFilters = function(){
      const a = document.getElementById('asAdv'); if (a) a.value = '';
      const t = document.getElementById('asTag'); if (t) t.value = '';
      const s = document.getElementById('asAdvPick'); if (s) s.value = '';
      const box = document.getElementById('asTagSuggest'); if (box) box.style.display = 'none';
      load();
    };
    window._asSuggestTags = async function(){
      const box = document.getElementById('asTagSuggest'); if (!box) return;
      box.style.display = 'block';
      box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:#6B21A8;font-size:0.82rem;font-weight:700"><span style="display:inline-block;width:14px;height:14px;border:2px solid #DDD6FE;border-top-color:#0f766e;border-radius:50%;animation:asSpin 0.8s linear infinite"></span> Reading your saved ads and proposing useful filter tags…<style>@keyframes asSpin{to{transform:rotate(360deg)}}</style></div>';
      // ── Pass brand + competitors so the endpoint can give tailored starter tags when the swipe file is still empty
      const brand = (window.analysisData && window.analysisData.brandName) || '';
      const competitors = (window.analysisData && Array.isArray(window.analysisData.competitors))
        ? window.analysisData.competitors.map(c => c.name || c.domain).filter(Boolean).slice(0, 8)
        : [];
      try {
        const r = await fetch('/api/ad-swipe/suggest-tags', { method:'POST', headers: hdrs, body: JSON.stringify({ brand, competitors }) });
        // ── Robust parse: read as text first so we never throw "Unexpected end of JSON input"
        const txt = await r.text();
        let j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
        if (!j) { box.innerHTML = `<div style="color:#991B1B;font-size:0.82rem">Server returned an empty / non-JSON response (HTTP ${r.status}). Try again in a moment.</div>`; return; }
        if (!j.ok && (!j.suggestions || !j.suggestions.length)) { box.innerHTML = `<div style="color:#991B1B;font-size:0.82rem">${esc(j.error||'AI suggest failed')}</div>`; return; }
        const sugs = j.suggestions || [];
        if (!sugs.length) { box.innerHTML = '<div style="color:#6B21A8;font-size:0.82rem">No tag suggestions returned — try saving a few more ads first.</div>'; return; }
        const noteLine = j.note ? `<div style="font-size:0.7rem;color:#0f766e;margin-bottom:6px;font-style:italic">${esc(j.note)}</div>` : '';
        box.innerHTML = `<div style="font-size:0.74rem;font-weight:800;color:#6B21A8;margin-bottom:8px">🤖 Click a tag to filter${j.source==='saved_ads'?' — InfoGenie grouped your saved ads by these angles':' (starter tags — save ads for tailored ones)'}:</div>${noteLine}<div style="display:flex;flex-wrap:wrap;gap:6px">${sugs.map(s => `<button type="button" onclick="window._asApplyTag('${esc(s.tag).replace(/'/g,'&#39;')}')" title="${esc(s.why||'')}" style="background:#fff;border:1px solid #C4B5FD;color:#5B21B6;padding:5px 12px;border-radius:14px;font-size:0.78rem;font-weight:700;cursor:pointer">${esc(s.tag)}</button>`).join('')}</div>`;
      } catch(e) { box.innerHTML = `<div style="color:#991B1B;font-size:0.82rem">${esc(e.message)}</div>`; }
    };
    window._asApplyTag = function(t){
      const inp = document.getElementById('asTag'); if (inp) inp.value = t;
      load();
    };

    window._asReload = load;
    window._asUpdate = async function(id, btn){
      const tagEl = document.querySelector('.as-tags[data-id="'+id+'"]');
      const notesEl = document.querySelector('.as-notes[data-id="'+id+'"]');
      const scoreEl = document.querySelector('.as-score[data-id="'+id+'"]');
      const tags = tagEl.value.split(',').map(t => t.trim()).filter(Boolean);
      try {
        const r = await fetch('/api/ad-swipe/'+id+'/update', { method:'POST', headers: hdrs, body: JSON.stringify({ tags, notes: notesEl.value, score: parseInt(scoreEl.value,10)||0 }) });
        const j = await r.json();
        if (j.ok) { btn.textContent = '✅ Saved'; setTimeout(() => btn.textContent = '💾 Save', 1500); }
        else { btn.textContent = '⚠ ' + (j.error||'fail'); }
      } catch(e) { btn.textContent = '⚠ ' + e.message; }
    };
    window._asDelete = async function(id){
      if (!confirm('Delete this saved ad?')) return;
      try {
        await fetch('/api/ad-swipe/'+id, { method:'DELETE', headers: hdrs });
        load();
      } catch(e) { alert(e.message); }
    };
    await load();
  };

  /* ═══════════ BRAND FOUNDATION ═══════════ */
  window.buildBrandFoundation = async function(){
    const wrap = document.getElementById('brandFoundationWrap');
    if (!wrap) return;
    const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hdrs = (window.apiHeaders ? window.apiHeaders() : { 'Content-Type':'application/json' });
    let f = {};
    try {
      const r = await fetch('/api/brand-foundation', { headers: hdrs });
      const j = await r.json();
      f = j.foundation || {};
    } catch(e) { f = {}; }

    const card = (title, body) => `<div style="background:#fff;border:1px solid #FCD34D;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 1px 2px rgba(0,0,0,.04)"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="margin:0;font-size:1.05rem;color:#92400E;font-weight:800;letter-spacing:-.01em">${title}</h3></div>${body}</div>`;
    const inp = (id, val, ph, rows=2) => `<textarea id="bf-${id}" rows="${rows}" placeholder="${esc(ph)}" style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-family:inherit;font-size:0.95rem;resize:vertical">${esc(val||'')}</textarea>`;
    const lbl = t => `<div style="font-size:0.8rem;font-weight:700;color:#475569;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.04em">${t}</div>`;
    const slider = (id, val, t) => `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#475569;margin-bottom:2px"><span>${t}</span><span id="bf-${id}-v">${val||5}</span></div><input id="bf-${id}" type="range" min="0" max="10" value="${val||5}" style="width:100%" oninput="document.getElementById('bf-${id}-v').textContent=this.value"></div>`;
    const btn = (label, onclick, bg='#92400E') => `<button onclick="${onclick}" style="background:${bg};color:#fff;border:none;padding:8px 14px;border-radius:7px;font-weight:700;cursor:pointer;font-size:0.85rem">${label}</button>`;

    wrap.innerHTML = `
      <div style="max-width:980px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#FCD34D 0%,#F59E0B 100%);border-radius:16px;padding:28px;margin-bottom:24px;color:#1E293B">
          <h1 style="margin:0 0 8px;font-size:1.8rem;font-weight:900;letter-spacing:-.02em">🏛️ Brand Foundation</h1>
          <p style="margin:0;font-size:1rem;line-height:1.5;opacity:.9">The 5 pillars every other AI tool reads from. Fill this in once — your ads, emails, landing pages, social posts, and voice scripts will all stay on-brand. <strong>Visual identity is intentionally last.</strong></p>
        </div>

        ${card('Pillar 1 — Purpose <span style="font-weight:400;color:#94A3B8;font-size:0.85rem">· Why does your business exist beyond making money?</span>', `
          ${lbl('Why we exist (2 sentences, customer-centred)')}
          ${inp('purpose_why', f.purpose_why, "We help small e-commerce brands compete with Amazon's ad budget by automating the strategic thinking, not just the clicks...", 3)}
          ${lbl('Beyond profit (1 sentence — concrete, not "change the world")')}
          ${inp('purpose_beyond_money', f.purpose_beyond_money, 'Every retired ad budget that goes to a small brand instead of a giant is one less monopoly day...', 2)}
          <div style="margin-top:10px">${btn('🤖 AI Suggest Purpose', 'window._bfSuggest("purpose")')}</div>
        `)}

        ${card('Pillar 2 — Audience Clarity <span style="font-weight:400;color:#94A3B8;font-size:0.85rem">· A specific PERSON, not a demographic</span>', `
          ${lbl('Persona name')}
          ${inp('icp_name', f.icp_name, 'Maya', 1)}
          ${lbl('Role + context')}
          ${inp('icp_role', f.icp_role, 'Solo founder, DTC skincare brand, 2 years in, $30k/mo revenue', 1)}
          ${lbl('Their pain (in their words)')}
          ${inp('icp_pain', f.icp_pain, "I throw money at Meta ads and the dashboards lie to me. I can't tell what's working.", 2)}
          ${lbl('Cheap solution they already tried and why it failed')}
          ${inp('icp_tried_cheap', f.icp_tried_cheap, 'Hired a $500/mo "AI ad manager" that just paused campaigns at random and called it optimisation', 2)}
          ${lbl('Specific outcome they want')}
          ${inp('icp_dream_outcome', f.icp_dream_outcome, 'A 2.5x ROAS within 60 days with a system I actually understand', 2)}
          <div style="margin-top:10px">${btn('🤖 AI Suggest ICP', 'window._bfSuggest("icp")')}</div>
        `)}

        ${card('Pillar 3 — Brand Voice <span style="font-weight:400;color:#94A3B8;font-size:0.85rem">· If your brand could speak, what would it sound like?</span>', `
          ${slider('voice_tone_warm', f.voice_tone_warm, 'Warm  ←→  Cool')}
          ${slider('voice_tone_witty', f.voice_tone_witty, 'Witty  ←→  Serious')}
          ${slider('voice_tone_bold', f.voice_tone_bold, 'Bold/Direct  ←→  Soft')}
          ${lbl('Things we DO say (one per line)')}
          ${inp('voice_we_say', f.voice_we_say, "Honest numbers · Plain English · We'll tell you when it isn't working", 3)}
          ${lbl("Things we DON'T say (one per line)")}
          ${inp('voice_we_dont_say', f.voice_we_dont_say, 'Synergy · Game-changer · Revolutionary · 10x · Disrupt', 3)}
          ${lbl('Banned words (comma-separated — voice check will flag these)')}
          ${inp('voice_banned_words', f.voice_banned_words, 'synergy, leverage, ninja, rockstar, disrupt, game-changer, revolutionary', 1)}
        `)}

        ${card('Pillar 4 — Messaging <span style="font-weight:400;color:#94A3B8;font-size:0.85rem">· Can a stranger repeat what you do in one sentence?</span>', `
          ${lbl('One-sentence positioning (~20 words max)')}
          ${inp('positioning_statement', f.positioning_statement, 'We help DTC founders hit 2.5x ROAS in 60 days without hiring an agency or learning Google Ads.', 2)}
          ${lbl('Why it works (1 sentence — the proof / mechanism)')}
          ${inp('positioning_proof', f.positioning_proof, 'Our AI runs the same 6-hourly pause/scale rules the top 1% of agencies use — without the $5k/mo retainer.', 2)}
          <div style="margin-top:10px">${btn('🤖 AI Suggest Positioning', 'window._bfSuggest("positioning")')}</div>
        `)}

        ${card('Pillar 5 — Visual Identity <span style="font-weight:400;color:#94A3B8;font-size:0.85rem">· Last on purpose</span>', `
          <p style="margin:0;color:#475569;font-size:0.95rem;line-height:1.55">Your logo, palette, fonts, and templates live in <strong>Creator Studio → Brand Kit</strong>. Build the four invisible pillars above first, then your visuals will finally mean something.</p>
          <div style="margin-top:14px">${btn('Open Creator Studio →', "window.showView && window.showView('studio')", '#0EA5E9')}</div>
        `)}

        ${card('🧪 Voice Check', `
          <p style="margin:0 0 10px;color:#475569;font-size:0.9rem">Paste any ad copy, email, or post — get a 0-100 voice score, banned-word flags, and a rewrite in your voice.</p>
          <textarea id="bf-voice-check" rows="4" placeholder="Paste copy here..." style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-family:inherit;font-size:0.95rem;resize:vertical"></textarea>
          <div style="margin-top:10px">${btn('🔍 Audit Voice', 'window._bfVoiceCheck()')}</div>
          <div id="bf-voice-result" style="margin-top:14px"></div>
        `)}

        <div style="position:sticky;bottom:18px;background:#fff;border:2px solid #F59E0B;border-radius:14px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 8px 24px rgba(0,0,0,.12);margin-top:24px">
          <div style="font-size:0.9rem;color:#475569"><strong style="color:#92400E">Last saved:</strong> <span id="bf-saved">${f.updated_at ? new Date(f.updated_at).toLocaleString() : 'never'}</span></div>
          <button onclick="window._bfSaveAll()" style="background:#92400E;color:#fff;border:none;padding:12px 22px;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.95rem">💾 Save Foundation</button>
        </div>
      </div>
    `;

    const fields = ['purpose_why','purpose_beyond_money','icp_name','icp_role','icp_pain','icp_tried_cheap','icp_dream_outcome','voice_tone_warm','voice_tone_witty','voice_tone_bold','voice_we_say','voice_we_dont_say','voice_banned_words','positioning_statement','positioning_proof'];
    const getVal = id => { const el = document.getElementById('bf-'+id); return el ? el.value : ''; };

    window._bfSaveAll = async function(){
      const payload = {};
      fields.forEach(f => { payload[f] = getVal(f); });
      try {
        const r = await fetch('/api/brand-foundation/save', { method:'POST', headers:hdrs, body: JSON.stringify(payload) });
        const j = await r.json();
        if (j.ok) {
          document.getElementById('bf-saved').textContent = new Date(j.foundation.updated_at).toLocaleString();
          if (window.showToast) window.showToast('Brand Foundation saved — every AI tool will now use it', 'success');
          else alert('Saved.');
        } else { alert('Save failed: '+(j.error||'unknown')); }
      } catch(e) { alert('Save failed: '+e.message); }
    };

    window._bfSuggest = async function(kind){
      const ep = kind==='purpose' ? '/api/brand-foundation/suggest-purpose'
              : kind==='icp'     ? '/api/brand-foundation/suggest-icp'
              :                    '/api/brand-foundation/suggest-positioning';
      const body = kind==='positioning' ? {} : { brand: getVal('icp_name')||'', offer: getVal('positioning_statement')||'', industry:'', hint: getVal('purpose_why')||'' };
      try {
        const r = await fetch(ep, { method:'POST', headers:hdrs, body: JSON.stringify(body) });
        const j = await r.json();
        if (!j.ok) return alert(j.error || 'AI unavailable');
        Object.keys(j.suggestion).forEach(k => { const el = document.getElementById('bf-'+k); if (el) el.value = j.suggestion[k]; });
        if (window.showToast) window.showToast('AI draft inserted — review and edit before saving', 'success');
      } catch(e) { alert('Suggest failed: '+e.message); }
    };

    window._bfVoiceCheck = async function(){
      const text = document.getElementById('bf-voice-check').value.trim();
      if (!text) return alert('Paste some copy first');
      const out = document.getElementById('bf-voice-result');
      out.innerHTML = '<div style="color:#64748b;font-style:italic">Auditing...</div>';
      try {
        const r = await fetch('/api/brand-foundation/voice-check', { method:'POST', headers:hdrs, body: JSON.stringify({ text }) });
        const j = await r.json();
        if (!j.ok) { out.innerHTML = '<div style="color:#DC2626">'+(j.error||'failed')+'</div>'; return; }
        const a = j.audit;
        const scoreColor = a.score>=80 ? '#10B981' : a.score>=60 ? '#F59E0B' : '#DC2626';
        out.innerHTML = `
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
            <div style="background:${scoreColor};color:#fff;font-size:1.6rem;font-weight:900;padding:10px 18px;border-radius:10px;min-width:80px;text-align:center">${a.score}/100</div>
            <div style="flex:1">
              ${(a.issues||[]).map(i => `<div style="font-size:0.88rem;color:#475569;margin-bottom:2px">• ${esc(i)}</div>`).join('')}
              ${(a.banned_word_hits||[]).length ? `<div style="font-size:0.85rem;color:#DC2626;margin-top:4px"><strong>Banned words:</strong> ${a.banned_word_hits.map(esc).join(', ')}</div>` : ''}
            </div>
          </div>
          <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:10px;padding:12px"><div style="font-size:0.8rem;font-weight:700;color:#15803D;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Rewrite in your voice</div><div style="white-space:pre-wrap;font-size:0.95rem;line-height:1.5">${esc(a.rewrite||'')}</div></div>
        `;
      } catch(e) { out.innerHTML = '<div style="color:#DC2626">Audit failed: '+esc(e.message)+'</div>'; }
    };
  };

  /* ═══════════ BUDGET BOARD ═══════════ */
  window.buildBudgetBoard = async function(){
    const wrap = document.getElementById('budgetBoardWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="max-width:1200px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div>
            <h1 style="margin:0;font-size:1.6rem;color:#0F172A">💰 Budget Board</h1>
            <p style="margin:6px 0 0;color:#64748B;font-size:0.92rem">Set a monthly target, log every dollar spent, see where it's going.</p>
          </div>
          <input type="month" id="bb_month" value="${_ymToday()}" style="padding:8px 12px;border:1px solid #BBF7D0;border-radius:8px;font-weight:600">
        </div>
        <div id="bb_platform_notice" style="margin-bottom:16px"></div>
        <div id="bb_kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
          <div style="background:#fff;border:1px solid #BBF7D0;border-radius:12px;padding:18px">
            <h3 style="margin:0 0 12px;color:#15803D;font-size:1rem">Set monthly budget</h3>
            <label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Total target (USD)</label>
            <input id="bb_target" type="number" placeholder="5000" style="width:100%;padding:9px;border:1px solid #BBF7D0;border-radius:8px;margin-bottom:10px">
            <label style="display:block;font-size:0.78rem;font-weight:700;color:#475569;margin-bottom:4px">Allocations by channel (USD, optional)</label>
            <div id="bb_alloc" style="display:grid;gap:6px;margin-bottom:12px"></div>
            <button id="bb_save_budget" style="padding:9px 18px;background:#16A34A;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Save Budget</button>
          </div>
          <div style="background:#fff;border:1px solid #BBF7D0;border-radius:12px;padding:18px">
            <h3 style="margin:0 0 12px;color:#15803D;font-size:1rem">Log a spend</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
              <select id="bb_sp_ch" style="padding:9px;border:1px solid #BBF7D0;border-radius:8px"><option>Meta Ads</option><option>Google Ads</option><option>TikTok Ads</option><option>Email</option><option>SMS</option><option>WhatsApp</option><option>Influencer</option><option>SEO</option><option>Events</option><option>Other</option></select>
              <input id="bb_sp_amt" type="number" placeholder="Amount USD" step="0.01" style="padding:9px;border:1px solid #BBF7D0;border-radius:8px">
            </div>
            <input id="bb_sp_notes" placeholder="Notes (optional)" style="width:100%;padding:9px;border:1px solid #BBF7D0;border-radius:8px;margin-bottom:10px">
            <button id="bb_log" style="padding:9px 18px;background:#0EA5E9;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Log Spend</button>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #BBF7D0;border-radius:12px;padding:18px;margin-bottom:20px">
          <h3 style="margin:0 0 12px;color:#15803D;font-size:1rem">Spend analysis — by channel</h3>
          <div id="bb_breakdown"></div>
        </div>
        <div style="background:#fff;border:1px solid #BBF7D0;border-radius:12px;padding:18px">
          <h3 style="margin:0 0 12px;color:#15803D;font-size:1rem">Recent spend events</h3>
          <div id="bb_recent"></div>
        </div>
      </div>`;
    const channels = ['Meta Ads','Google Ads','TikTok Ads','Email','SMS','WhatsApp','Influencer','SEO','Events','Other'];
    document.getElementById('bb_alloc').innerHTML = channels.map(c=>`<div style="display:grid;grid-template-columns:140px 1fr;gap:8px;align-items:center"><label style="font-size:0.78rem;color:#475569">${c}</label><input data-alloc="${c}" type="number" placeholder="0" style="padding:6px;border:1px solid #BBF7D0;border-radius:6px"></div>`).join('');

    async function refresh(){
      const month = document.getElementById('bb_month').value;
      // Show connect notices for any ad platform that isn't wired up yet
      try {
        const ps = await _f('/api/ad-platforms/status');
        const missing = [
          { key:'google',    name:'Google Ads',   icon:'🔵', connected: ps.googleAds },
          { key:'meta',      name:'Meta Ads',     icon:'📘', connected: ps.meta      },
          { key:'tiktok',    name:'TikTok Ads',   icon:'⚫', connected: ps.tiktok    },
          { key:'microsoft', name:'Microsoft Ads',icon:'🟦', connected: ps.microsoft },
        ].filter(p => !p.connected);
        const noticeEl = document.getElementById('bb_platform_notice');
        if (noticeEl) {
          noticeEl.innerHTML = missing.length ? `
            <div style="display:grid;gap:8px">
              ${missing.map(p => `
                <div style="display:flex;align-items:flex-start;gap:10px;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;font-size:0.78rem;color:#92400E;line-height:1.5">
                  <span style="font-size:1rem">${p.icon}</span>
                  <div>⚠️ <strong>${_esc(p.name)} is not connected</strong> — connect it to auto-import spend data into the Budget Board.<br>
                  <a href="#" onclick="navigateTo&&navigateTo('settings');return false;" style="color:#92400E;font-weight:700;text-decoration:underline">Go to Settings → Integrations →</a></div>
                </div>`).join('')}
            </div>` : '';
        }
      } catch (_e) {}
      const s = await _f('/api/budget/summary?month='+encodeURIComponent(month));
      const remaining = s.remaining_cents;
      const util = s.utilization_pct;
      document.getElementById('bb_kpis').innerHTML = `
        ${[
          {label:'Target', val:_money(s.target_cents), color:'#0F172A'},
          {label:'Spent', val:_money(s.spent_cents), color:'#0EA5E9'},
          {label:'Remaining', val:_money(remaining), color: remaining<0?'#DC2626':'#16A34A'},
          {label:'Utilization', val: util==null?'—':util+'%', color: util>100?'#DC2626':util>80?'#F59E0B':'#16A34A'}
        ].map(k=>`<div style="background:#fff;border:1px solid #BBF7D0;border-radius:10px;padding:14px"><div style="font-size:0.74rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">${k.label}</div><div style="font-size:1.4rem;font-weight:800;color:${k.color}">${k.val}</div></div>`).join('')}
      `;
      document.getElementById('bb_breakdown').innerHTML = s.by_channel.length===0
        ? '<div style="color:#94A3B8;text-align:center;padding:20px">No spend logged this month yet.</div>'
        : `<table style="width:100%;border-collapse:collapse">
          <thead><tr style="text-align:left;color:#64748B;font-size:0.78rem;border-bottom:1px solid #E2E8F0"><th style="padding:8px">Channel</th><th style="padding:8px">Allocated</th><th style="padding:8px">Spent</th><th style="padding:8px">Utilization</th><th style="padding:8px">Bar</th></tr></thead>
          <tbody>${s.by_channel.map(b=>{
            const u = b.utilization;
            const barW = u==null?0:Math.min(100,u);
            const barColor = u>100?'#DC2626':u>80?'#F59E0B':'#16A34A';
            return `<tr style="border-bottom:1px solid #F1F5F9"><td style="padding:8px;font-weight:600">${_esc(b.channel)}</td><td style="padding:8px;color:#64748B">${_money(b.allocated_cents)}</td><td style="padding:8px;font-weight:700">${_money(b.spent_cents)}</td><td style="padding:8px">${u==null?'—':u+'%'}</td><td style="padding:8px;width:200px"><div style="background:#F1F5F9;border-radius:99px;height:8px;overflow:hidden"><div style="height:100%;width:${barW}%;background:${barColor}"></div></div></td></tr>`;
          }).join('')}</tbody></table>`;
      const er = await _f('/api/budget/spend/recent');
      document.getElementById('bb_recent').innerHTML = er.events.length===0
        ? '<div style="color:#94A3B8;text-align:center;padding:20px">Nothing logged yet.</div>'
        : `<table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left;color:#64748B;font-size:0.78rem;border-bottom:1px solid #E2E8F0"><th style="padding:8px">Date</th><th style="padding:8px">Channel</th><th style="padding:8px">Amount</th><th style="padding:8px">Source</th><th style="padding:8px">Notes</th></tr></thead><tbody>${er.events.slice(0,20).map(e=>`<tr style="border-bottom:1px solid #F1F5F9"><td style="padding:6px 8px;color:#64748B">${(e.occurred_at||'').slice(0,10)}</td><td style="padding:6px 8px;font-weight:600">${_esc(e.channel)}</td><td style="padding:6px 8px;font-weight:700">${_money(e.amount_cents)}</td><td style="padding:6px 8px;color:#94A3B8;font-size:0.84rem">${_esc(e.source||'')}</td><td style="padding:6px 8px;color:#64748B">${_esc(e.notes||'')}</td></tr>`).join('')}</tbody></table>`;
    }

    document.getElementById('bb_month').onchange = refresh;
    document.getElementById('bb_save_budget').onclick = async ()=>{
      const target = (+document.getElementById('bb_target').value||0)*100;
      const by_channel = {};
      document.querySelectorAll('#bb_alloc input[data-alloc]').forEach(i=>{ const v=+i.value; if (v>0) by_channel[i.dataset.alloc]=v*100; });
      try{ await _f('/api/budget/budgets',{method:'POST',body:{period_month:document.getElementById('bb_month').value, target_cents:target, by_channel}}); _toast('Budget saved'); refresh(); }
      catch(e){_toast(e.message,'err');}
    };
    document.getElementById('bb_log').onclick = async ()=>{
      const amt = +document.getElementById('bb_sp_amt').value;
      if (!amt){ _toast('Amount required','err'); return; }
      try{ await _f('/api/budget/spend',{method:'POST',body:{channel:document.getElementById('bb_sp_ch').value, amount_cents:Math.round(amt*100), notes:document.getElementById('bb_sp_notes').value, source:'manual'}});
        document.getElementById('bb_sp_amt').value=''; document.getElementById('bb_sp_notes').value=''; _toast('Logged'); refresh(); }
      catch(e){_toast(e.message,'err');}
    };
    refresh();
  };

  /* ═══════════ WEB ANALYTICS ═══════════ */
  window.buildWebAnalytics = async function(){
    const wrap = document.getElementById('webAnalyticsWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="max-width:1200px;margin:0 auto">
        <div style="margin-bottom:20px">
          <h1 style="margin:0;font-size:1.6rem;color:#0F172A">📈 Web Analytics</h1>
          <p style="margin:6px 0 0;color:#64748B;font-size:0.92rem">Acquisition · Behaviour · Mobile — derived from your tracked sites + ad-platform insights.</p>
        </div>
        <div id="wa_banner" style="margin-bottom:18px"></div>
        <div id="wa_kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px">
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
            <h3 style="margin:0 0 12px;color:#0F172A;font-size:1rem">🤝 Acquisition — Channels (last 30d)</h3>
            <div id="wa_chans"></div>
          </div>
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
            <h3 style="margin:0 0 12px;color:#0F172A;font-size:1rem">📄 Behaviour — Top Landing Pages</h3>
            <div id="wa_pages"></div>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <h3 style="margin:0 0 12px;color:#0F172A;font-size:1rem">📱 Mobile — Pages needing attention (PageSpeed)</h3>
          <div id="wa_mobile"></div>
        </div>
      </div>`;
    try{
      const [sum, acq, beh, mob] = await Promise.all([
        _f('/api/web-analytics/summary'),
        _f('/api/web-analytics/acquisition'),
        _f('/api/web-analytics/behaviour'),
        _f('/api/web-analytics/mobile')
      ]);
      if (!sum.ga4_connected){
        document.getElementById('wa_banner').innerHTML = `<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:10px;padding:14px;color:#92400E;font-size:0.88rem">ℹ️ <strong>GA4 not connected</strong> — showing data derived from your ad-platform insights and tracked-site audits. To unlock full Source/Medium, Country, and real session/exit data, connect Google Analytics in <a href="#" onclick="navigateTo('settings');return false;" style="color:#92400E;font-weight:700">Settings → Integrations</a>.</div>`;
      }
      document.getElementById('wa_kpis').innerHTML = [
        {label:'Sessions (30d)', val:(sum.sessions||0).toLocaleString(), color:'#0EA5E9'},
        {label:'Impressions (30d)', val:(sum.impressions||0).toLocaleString(), color:'#0284c7'},
        {label:'Ad Spend (30d)', val:_money(sum.spend_cents||0), color:'#16A34A'}
      ].map(k=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px"><div style="font-size:0.74rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">${k.label}</div><div style="font-size:1.4rem;font-weight:800;color:${k.color}">${k.val}</div></div>`).join('');
      document.getElementById('wa_chans').innerHTML = acq.channels.length===0
        ? '<div style="color:#94A3B8;text-align:center;padding:20px;font-size:0.88rem">No ad-platform data ingested yet.</div>'
        : `<table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left;color:#64748B;font-size:0.76rem;border-bottom:1px solid #E5E7EB"><th style="padding:6px">Channel</th><th style="padding:6px">Sessions</th><th style="padding:6px">Impressions</th></tr></thead><tbody>${acq.channels.map(c=>`<tr style="border-bottom:1px solid #F1F5F9"><td style="padding:6px;font-weight:600">${_esc(c.channel)}</td><td style="padding:6px;font-weight:700">${(c.sessions||0).toLocaleString()}</td><td style="padding:6px">${(c.impressions||0).toLocaleString()}</td></tr>`).join('')}</tbody></table>`;
      document.getElementById('wa_pages').innerHTML = beh.landing_pages.length===0
        ? '<div style="color:#94A3B8;text-align:center;padding:20px;font-size:0.88rem">No landing-page data yet. Run a Landing Pages audit to populate.</div>'
        : `<ul style="margin:0;padding-left:18px">${beh.landing_pages.slice(0,12).map(p=>`<li style="margin-bottom:6px;font-size:0.86rem"><a href="${_esc(_safeUrl(p.url||''))}" target="_blank" rel="noopener" style="color:#0EA5E9;text-decoration:none">${_esc(p.title||p.url)}</a> ${p.score!=null?`<span style="color:#64748B;font-size:0.78rem">· score ${p.score}</span>`:''}</li>`).join('')}</ul>`;
      document.getElementById('wa_mobile').innerHTML = (!mob.pages || mob.pages.length===0)
        ? '<div style="color:#94A3B8;text-align:center;padding:20px;font-size:0.88rem">No mobile audits yet. Run Web Vitals to populate.</div>'
        : `<table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left;color:#64748B;font-size:0.76rem;border-bottom:1px solid #E5E7EB"><th style="padding:6px">URL</th><th style="padding:6px">Mobile Score</th><th style="padding:6px">LCP (ms)</th><th style="padding:6px">CLS</th></tr></thead><tbody>${mob.pages.slice(0,12).map(p=>`<tr style="border-bottom:1px solid #F1F5F9"><td style="padding:6px;font-size:0.84rem"><a href="${_esc(_safeUrl(p.url||''))}" target="_blank" rel="noopener" style="color:#0EA5E9;text-decoration:none">${_esc(p.url||'')}</a></td><td style="padding:6px;font-weight:700;color:${p.mobile_score>=80?'#16A34A':p.mobile_score>=50?'#F59E0B':'#DC2626'}">${p.mobile_score!=null?p.mobile_score:'—'}</td><td style="padding:6px">${p.mobile_lcp_ms||'—'}</td><td style="padding:6px">${p.mobile_cls||'—'}</td></tr>`).join('')}</tbody></table>`;
    }catch(e){
      wrap.querySelector('#wa_banner').innerHTML = '<div style="background:#FEE2E2;border:1px solid #FCA5A5;color:#B91C1C;border-radius:10px;padding:14px">Failed to load analytics: '+_esc(e.message)+'</div>';
    }
  };
})();
