/* ══════════════════════════════════════════════════════════════════════════
   ig_manual_comp_autoseo.js — extracted from app.js (see public/js/README.md)

   Manual Competitor Entry + Launch Now  (toggleManualCompPanel /
   addManualCompetitor / removeManualCompetitor / renderManualCompChips /
   launchNow) followed by the Auto-SEO Pro cluster (buildAutoSEO + the
   auto-SEO calendar: publishNowFromCal / calEditArticle / calSaveEdit /
   calDeleteArticle / showAutoSeoCalendar, plus keyword / backlink / outreach /
   settings / traffic renderers and the window._autoSeo* / window._manualCompetitors
   state).

   Moved VERBATIM, wrapped in one IIFE. Functions reachable from inline onclick=
   handlers, from index.html, or from code still in app.js (navigateTo's
   buildAutoSEO() dispatch, buildMasterCalendar's _artDate()) are re-exported on
   window at the bottom so bare global lookups still resolve.

   Shared globals (analysisData, showToast, navigateTo, _esc, _safeUrl, Chart,
   window._autoSeoDomain/_autoSeoIndustry, …) stay in app.js and resolve at call
   time via the shared global lexical environment / window.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
/* ══════════════════════════════════════════════════════════════
   MANUAL COMPETITOR ENTRY + LAUNCH NOW
   ══════════════════════════════════════════════════════════════ */

window._manualCompetitors = [];

function toggleManualCompPanel() {
  const panel = document.getElementById('mcPanel');
  const btn   = document.getElementById('mcToggleBtn');
  if (!panel || !btn) return;
  const open = !panel.classList.contains('hidden');
  if (open) {
    panel.classList.add('hidden');
    btn.classList.remove('active');
  } else {
    panel.classList.remove('hidden');
    btn.classList.add('active');
    document.getElementById('mcInput')?.focus();
  }
}

function addManualCompetitor() {
  const input = document.getElementById('mcInput');
  if (!input) return;
  let raw = input.value.trim().replace(/https?:\/\//i,'').replace(/^www\./,'').replace(/\/.*$/,'').toLowerCase();
  if (!raw || raw.length < 3) { showToast('⚠ Enter a valid competitor domain e.g. competitor.com'); return; }
  if (!raw.includes('.')) { showToast('⚠ Enter a full domain e.g. competitor.com'); return; }
  if (window._manualCompetitors.find(c => c.domain === raw)) { showToast('Already added: ' + raw); input.value=''; return; }
  if (window._manualCompetitors.length >= 10) { showToast('⚠ Max 10 manual competitors'); return; }

  // Build a lightweight competitor stub — will be enriched by analysis
  const logo = raw.charAt(0).toUpperCase();
  const comp = {
    name: raw.split('.')[0].charAt(0).toUpperCase() + raw.split('.')[0].slice(1),
    url: 'https://' + raw, domain: raw, logo,
    traffic: '—', ctr: '—', roas: null, adSpend: '—',
    topChannel: '—', threatLevel: 'unknown', manual: true,
    campaigns: [], suggestions: [],
    audiences: [{ label: 'Auto-detected on analysis', pct: '—' }],
    topKeywords: [], estimatedROI: 'Pending analysis'
  };
  window._manualCompetitors.push(comp);
  input.value = '';
  renderManualCompChips();
  showToast('✅ Added ' + raw + ' — included in next analysis');
}

function removeManualCompetitor(domain) {
  window._manualCompetitors = window._manualCompetitors.filter(c => c.domain !== domain);
  renderManualCompChips();
}

function renderManualCompChips() {
  const wrap = document.getElementById('mcChips');
  const countEl = document.getElementById('mcCount');
  if (!wrap) return;
  const list = window._manualCompetitors;

  wrap.innerHTML = list.map(c => `
    <span class="mc-chip">
      <span>${c.domain}</span>
      <button class="mc-chip-remove" onclick="removeManualCompetitor('${c.domain}')" title="Remove">✕</button>
    </span>`).join('');

  if (countEl) {
    if (list.length > 0) {
      countEl.textContent = list.length;
      countEl.classList.remove('hidden');
    } else {
      countEl.classList.add('hidden');
    }
  }
}

function launchNow() {
  if (analysisData) {
    navigateTo('campaigns');
    setTimeout(() => showToast('🚀 Campaign builder ready — select a campaign to launch'), 300);
  } else {
    // Prompt user to run analysis first, but still navigate
    const url = document.getElementById('websiteInput')?.value?.trim();
    if (url && url.length > 3) {
      showToast('🔍 Running quick analysis then launching campaigns…');
      const country  = document.getElementById('targetCountry')?.value || 'global';
      const industry = document.getElementById('industryInput')?.value  || '';
      runAnalysis(url, country, industry).then(() => {
        navigateTo('campaigns');
        setTimeout(() => showToast('🚀 Campaigns ready — select one to launch'), 400);
      });
    } else {
      showToast('⚠ Enter your website URL first — then click Launch Campaign');
      document.getElementById('websiteInput')?.focus();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOSEO Calendar Modal ─────────────────────────────────────────────────────
// ── Publish Now from Calendar ─────────────────────────────────────────────
function publishNowFromCal(idx) {
  const art = window._autoSeoArticles && window._autoSeoArticles[idx];
  if (!art) return;
  const ep = document.getElementById('cal-edit-popup');
  if (ep) ep.remove();
  const wpOk = !!(window._wpCreds && window._wpCreds.siteUrl && window._wpCreds.appPassword);
  if (wpOk && art.generatedHtml) {
    publishSingleArticle(idx).then(() => {
      const cm = document.getElementById('autoseo-cal-modal');
      if (cm) cm.remove();
      showAutoSeoCalendar();
    }).catch(() => {});
  } else {
    // Mark as published manually (no WP or not yet written)
    art.status = art.generatedHtml ? 'published' : art.status;
    if (!art.generatedHtml) {
      showToast('⚠️ Write the article first before publishing');
      return;
    }
    const cm = document.getElementById('autoseo-cal-modal');
    if (cm) cm.remove();
    showAutoSeoCalendar();
    buildAutoSEO();
    showToast('✅ Article #' + (idx+1) + ' marked as published');
  }
}

// ── Calendar Edit / Delete helpers ──────────────────────────────────────────
function calEditArticle(idx) {
  const art = window._autoSeoArticles && window._autoSeoArticles[idx];
  if (!art) return;
  const sch = window._autoSeoSchedule || {};
  const currentDate = art.customDate || _artDate(idx, sch);
  const safeTitle = (art.title || '').replace(/"/g, '&quot;');

  const popup = document.createElement('div');
  popup.id = 'cal-edit-popup';
  popup.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px';
  popup.innerHTML =
    '<div style="background:white;border-radius:16px;padding:26px;width:100%;max-width:460px;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">' +
        '<div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#111827">✏️ Edit Article #' + (idx+1) + '</div>' +
        '<button onclick="document.getElementById(&apos;cal-edit-popup&apos;).remove()" style="background:#F3F4F6;border:none;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:0.9rem;color:#6B7280">✕</button>' +
      '</div>' +
      '<label style="font-size:0.75rem;font-weight:600;color:#374151;display:block;margin-bottom:14px">Article Title' +
        '<input id="cal-edit-title" value="' + safeTitle + '" style="display:block;width:100%;margin-top:5px;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.85rem;outline:none;box-sizing:border-box;color:#111827" placeholder="Article title">' +
      '</label>' +
      '<label style="font-size:0.75rem;font-weight:600;color:#374151;display:block;margin-bottom:20px">Scheduled Date' +
        '<input type="date" id="cal-edit-date" value="' + currentDate + '" style="display:block;width:100%;margin-top:5px;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.85rem;outline:none;box-sizing:border-box;color:#111827">' +
      '</label>' +
      '<div style="display:flex;gap:10px">' +
        '<button onclick="calSaveEdit(' + idx + ')" style="flex:1;padding:10px;background:linear-gradient(135deg,#0066FF,#0052CC);border:none;border-radius:9px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">💾 Save</button>' +
        '<button onclick="publishNowFromCal(' + idx + ')" style="padding:10px 14px;background:linear-gradient(135deg,#059669,#047857);border:none;border-radius:9px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">🚀 Publish Now</button>' +
        '<button onclick="calDeleteArticle(' + idx + ')" style="padding:10px 14px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:9px;font-size:0.82rem;font-weight:700;color:#DC2626;cursor:pointer">🗑️ Delete</button>' +
        '<button onclick="document.getElementById(&apos;cal-edit-popup&apos;).remove()" style="padding:10px 14px;background:#F3F4F6;border:none;border-radius:9px;font-size:0.82rem;font-weight:700;color:#6B7280;cursor:pointer">Cancel</button>' +
      '</div>' +
    '</div>';

  popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
  document.body.appendChild(popup);
}

function calSaveEdit(idx) {
  const art = window._autoSeoArticles && window._autoSeoArticles[idx];
  if (!art) return;
  const newTitle = (document.getElementById('cal-edit-title') || {}).value || '';
  const newDate  = (document.getElementById('cal-edit-date')  || {}).value || '';
  if (newTitle.trim()) art.title = newTitle.trim();
  if (newDate)         art.customDate = newDate;
  const ep = document.getElementById('cal-edit-popup');
  if (ep) ep.remove();
  const cm = document.getElementById('autoseo-cal-modal');
  if (cm) cm.remove();
  showAutoSeoCalendar();
  buildAutoSEO();
  showToast('✅ Article #' + (idx+1) + ' updated');
}

function calDeleteArticle(idx) {
  if (!confirm('Delete article #' + (idx+1) + '? This cannot be undone.')) return;
  const ep = document.getElementById('cal-edit-popup');
  if (ep) ep.remove();
  if (window._autoSeoArticles) window._autoSeoArticles.splice(idx, 1);
  const cm = document.getElementById('autoseo-cal-modal');
  if (cm) cm.remove();
  if (window._autoSeoArticles && window._autoSeoArticles.length) showAutoSeoCalendar();
  buildAutoSEO();
  showToast('🗑️ Article deleted from calendar');
}

function showAutoSeoCalendar() {
  const articles = window._autoSeoArticles || [];
  const sch = window._autoSeoSchedule || {};
  if (!articles.length) { showToast('Generate article topics first'); return; }

  // Build date → articles map
  const dateMap = {};
  articles.forEach((a, i) => {
    const d = _artDate(i, sch);
    if (!dateMap[d]) dateMap[d] = [];
    dateMap[d].push({ ...a, idx: i });
  });

  // Determine months to show
  const start = new Date((sch.startDate || new Date().toISOString().split('T')[0]) + 'T00:00:00');
  const end   = new Date((sch.endDate   || new Date(Date.now()+30*864e5).toISOString().split('T')[0]) + 'T00:00:00');

  // Collect all unique months between start and end
  const months = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= lastMonth) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

  const statusColor = s => s === 'published' ? '#059669' : s === 'generated' ? '#1D4ED8' : '#6B7280';
  const statusBg    = s => s === 'published' ? '#DCFCE7' : s === 'generated' ? '#DBEAFE' : '#F3F4F6';
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const calendarHtml = months.map(monthStart => {
    const yr  = monthStart.getFullYear();
    const mo  = monthStart.getMonth();
    const monthName = monthStart.toLocaleDateString('en-US', { month:'long', year:'numeric' });
    const firstDay = monthStart.getDay(); // 0=Sun
    const daysInMonth = new Date(yr, mo+1, 0).getDate();

    // Build cells array: empty + day cells
    const cells = [];
    for (let p = 0; p < firstDay; p++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    // Pad to complete last row
    while (cells.length % 7 !== 0) cells.push(null);

    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i+7));

    return '<div style="margin-bottom:32px">' +
      '<div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#111827;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #E5E7EB">' + monthName + '</div>' +
      '<table style="width:100%;border-collapse:collapse;table-layout:fixed">' +
      '<thead><tr>' + dayNames.map(d => '<th style="text-align:center;font-size:0.65rem;font-weight:700;color:#9CA3AF;padding:4px 2px;text-transform:uppercase">' + d + '</th>').join('') + '</tr></thead>' +
      '<tbody>' + rows.map(row =>
        '<tr>' + row.map(day => {
          if (!day) return '<td style="padding:4px 3px;vertical-align:top;height:80px"></td>';
          const isoDate = yr + '-' + String(mo+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
          const arts    = dateMap[isoDate] || [];
          const isToday = isoDate === new Date().toISOString().split('T')[0];
          const inRange = isoDate >= (sch.startDate||'') && isoDate <= (sch.endDate||'9999');
          return '<td style="padding:4px 3px;vertical-align:top;height:80px;border:1px solid #F3F4F6;border-radius:6px;background:' + (isToday?'#EFF6FF':inRange&&arts.length?'#FAFAFA':'white') + '">' +
            '<div style="font-size:0.72rem;font-weight:' + (isToday?'800':'600') + ';color:' + (isToday?'#1D4ED8':'#374151') + ';margin-bottom:3px;text-align:right;padding-right:3px">' +
              (isToday ? '<span style="background:#1D4ED8;color:white;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:0.68rem">' + day + '</span>' : day) +
            '</div>' +
            arts.map(a =>
              '<div style="border-radius:4px;background:' + statusBg(a.status) + ';color:' + statusColor(a.status) + ';margin-bottom:2px;line-height:1.3;display:flex;align-items:center;gap:1px;overflow:hidden">' +
                '<span onclick="previewGeneratedArticle(' + a.idx + ')" style="flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer;font-size:0.6rem;font-weight:600;padding:2px 4px" title="' + (a.title||'').replace(/"/g,"'") + '">#' + (a.idx+1) + ' ' + (a.title||'').substring(0,22) + '</span>' +
                '<button onclick="calEditArticle(' + a.idx + ')" style="flex-shrink:0;border:none;background:rgba(0,0,0,.06);cursor:pointer;padding:1px 3px;font-size:0.6rem;line-height:1.4;border-radius:3px;color:inherit" title="Edit">✏️</button>' +
                '<button onclick="calDeleteArticle(' + a.idx + ')" style="flex-shrink:0;border:none;background:rgba(239,68,68,.1);cursor:pointer;padding:1px 3px;font-size:0.6rem;line-height:1.4;border-radius:3px;color:#DC2626" title="Delete">🗑</button>' +
                '<button onclick="publishNowFromCal(' + a.idx + ')" style="flex-shrink:0;border:none;background:rgba(5,150,105,.12);cursor:pointer;padding:1px 3px;font-size:0.6rem;line-height:1.4;border-radius:3px;color:#059669" title="Publish Now">🚀</button>' +
              '</div>'
            ).join('') +
          '</td>';
        }).join('') + '</tr>'
      ).join('') +
      '</tbody></table></div>';
  }).join('');

  // Legend
  const legend = '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;padding:12px 16px;background:#F9FAFB;border-radius:10px;align-items:center">' +
    '<span style="font-size:0.72rem;font-weight:700;color:#374151">Legend:</span>' +
    '<span style="font-size:0.7rem;padding:2px 8px;background:#DBEAFE;color:#1D4ED8;border-radius:4px;font-weight:600">✓ Written</span>' +
    '<span style="font-size:0.7rem;padding:2px 8px;background:#DCFCE7;color:#059669;border-radius:4px;font-weight:600">✓ Published</span>' +
    '<span style="font-size:0.7rem;padding:2px 8px;background:#F3F4F6;color:#6B7280;border-radius:4px;font-weight:600">Pending</span>' +
    '<span style="font-size:0.7rem;padding:2px 8px;background:#EFF6FF;color:#1D4ED8;border-radius:4px;font-weight:600">🔵 Today</span>' +
    '<span style="margin-left:auto;font-size:0.7rem;color:#9CA3AF">' + articles.length + ' articles · ' + Object.keys(dateMap).length + ' scheduled dates</span>' +
  '</div>';

  // Modal
  const modal = document.createElement('div');
  modal.id = 'autoseo-cal-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto';
  modal.innerHTML =
    '<div style="background:white;border-radius:18px;width:100%;max-width:960px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.25);margin:auto">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px;background:linear-gradient(135deg,#4C1D95,#5B21B6);color:white">' +
        '<div>' +
          '<div style="font-family:Sora,sans-serif;font-size:1.1rem;font-weight:800">📅 Content Publishing Calendar</div>' +
          '<div style="font-size:0.75rem;opacity:.8;margin-top:2px">Articles scheduled from ' + _fmtDate(sch.startDate) + ' to ' + _fmtDate(sch.endDate) + '</div>' +
        '</div>' +
        '<button onclick="document.getElementById(&apos;autoseo-cal-modal&apos;).remove()" style="background:rgba(255,255,255,.15);border:none;border-radius:8px;color:white;font-size:1rem;width:34px;height:34px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700">✕</button>' +
      '</div>' +
      '<div style="padding:24px">' + legend + calendarHtml + '</div>' +
    '</div>';

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// AUTOSEO PRO ─ buildAutoSEO()
// ═══════════════════════════════════════════════════════════════════════════════
window._autoSeoTab = 'calendar';
window._autoSeoArticles = null;   // generated article topics
window._autoSeoKeywords = null;   // researched keywords
window._autoSeoBacklinks = null;  // backlink opps
window._autoSeoGenLoading = false;
const _today = new Date().toISOString().split('T')[0];
const _nextMonth = new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0];
window._autoSeoSchedule = { frequency: 'monthly', count: 30, tone: 'professional', wordCount: 1200, startDate: _today, endDate: _nextMonth };

// Helper — returns best available domain/industry without requiring a full analysis
function _autoSeoContext() {
  if (analysisData) {
    const domain   = analysisData.url || analysisData.domain || '';
    const industry = (analysisData.industry && typeof analysisData.industry === 'object')
                       ? (analysisData.industry.name || 'General')
                       : (analysisData.industry || 'General');
    const comps = (analysisData.competitors||[]).map(c=>c.name||c.domain||c.url||'').filter(Boolean);
    return { domain, industry, comps };
  }
  // Fall back to stored domain, then to whatever is in the home-page URL field
  const stored = window._autoSeoDomain || '';
  const inp = (document.getElementById('websiteInput')?.value || '')
    .trim().replace(/https?:\/\//,'').replace(/www\./,'').replace(/\/.*$/,'');
  const domain = stored || inp || '';
  return { domain, industry: window._autoSeoIndustry || 'General', comps: [] };
}

function buildAutoSEO() {
  const wrap = document.getElementById('autoseoWrap');
  if (!wrap) return;
  const ctx = _autoSeoContext();
  const d = analysisData;
  const domain    = ctx.domain || 'yourdomain.com';
  const industry  = ctx.industry;
  const tab       = window._autoSeoTab || 'calendar';
  const comps     = ctx.comps;
  const sch       = window._autoSeoSchedule;
  const needsSetup = !analysisData && !window._autoSeoDomain;

  // ── WordPress connection badge ──
  const wpConnected = !!(window._wpCreds && window._wpCreds.siteUrl && window._wpCreds.appPassword);
  const wpBadge = document.getElementById('autoseo-wp-status');
  const wpBtn   = document.getElementById('autoseo-connect-wp-btn');
  if (wpBadge) wpBadge.style.display = wpConnected ? 'flex' : 'none';
  if (wpBtn)   wpBtn.style.display   = wpConnected ? 'none' : 'flex';

  const tabs = [
    { id: 'calendar',  label: '📅 Content Calendar' },
    { id: 'backlinks', label: '🔗 Backlink Targets' },
    { id: 'outreach',  label: '📬 Outreach Sequencer' },
    { id: 'keywords',  label: '🔍 Keyword Research' },
    { id: 'traffic',   label: '📈 Traffic Intel' },
    { id: 'settings',  label: '⚙️ Automation Settings' },
  ];

  wrap.innerHTML = `
${needsSetup ? `
<!-- Domain setup banner -->
<div style="background:linear-gradient(135deg,#EFF6FF,#F5F3FF);border:1.5px solid #C7D2FE;border-radius:14px;padding:18px 22px;margin-bottom:20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
  <div style="font-size:1.6rem">🌐</div>
  <div style="flex:1;min-width:200px">
    <div style="font-size:0.88rem;font-weight:800;color:#3730A3;margin-bottom:2px">Enter your website to get started</div>
    <div style="font-size:0.75rem;color:#6B7280">AutoSEO Pro works best after running a full analysis, but you can start here with just your domain.</div>
  </div>
  <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;flex-wrap:wrap">
    <input id="autoseo-domain-inp" placeholder="yourdomain.com" value="${domain !== 'yourdomain.com' ? domain : ''}" style="padding:9px 14px;border:1.5px solid #C7D2FE;border-radius:9px;font-size:0.82rem;width:200px;outline:none;background:white" onkeydown="if(event.key==='Enter')saveAutoSeoDomain()">
    <input id="autoseo-industry-inp" placeholder="Industry (e.g. Fintech)" value="${window._autoSeoIndustry||''}" style="padding:9px 14px;border:1.5px solid #C7D2FE;border-radius:9px;font-size:0.82rem;width:160px;outline:none;background:white" onkeydown="if(event.key==='Enter')saveAutoSeoDomain()">
    <button onclick="saveAutoSeoDomain()" style="padding:9px 18px;background:linear-gradient(135deg,#4F46E5,#6D28D9);border:none;border-radius:9px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer">Set Domain →</button>
  </div>
</div>` : ''}
<!-- Stats row -->
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px">
  ${[
    { icon:'📄', label:'Articles / Month', val: sch.count, color:'#059669', bg:'#F0FDF4' },
    { icon:'🔗', label:'Backlinks Tracked', val: window._autoSeoBacklinks ? window._autoSeoBacklinks.length : '—', color:'#0066FF', bg:'#EFF6FF' },
    { icon:'🔍', label:'Keywords Found', val: window._autoSeoKeywords ? window._autoSeoKeywords.length : '—', color:'#0f766e', bg:'#F5F3FF' },
    { icon:'🟦', label:'WordPress', val: wpConnected ? 'Connected' : 'Not Connected', color: wpConnected ? '#059669':'#DC2626', bg: wpConnected ? '#F0FDF4':'#FFF1F2' },
  ].map(s=>`
    <div style="background:white;border-radius:14px;border:1.5px solid #E5E7EB;padding:16px 20px;display:flex;align-items:center;gap:14px">
      <div style="width:42px;height:42px;border-radius:10px;background:${s.bg};display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">${s.icon}</div>
      <div>
        <div style="font-size:1.1rem;font-weight:800;color:${s.color}">${s.val}</div>
        <div style="font-size:0.72rem;color:#6B7280;font-weight:600">${s.label}</div>
      </div>
    </div>`).join('')}
</div>

<!-- Tabs -->
<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
  ${tabs.map(t=>`<button onclick="window._autoSeoTab='${t.id}';buildAutoSEO()" style="padding:9px 18px;border-radius:10px;font-size:0.8rem;font-weight:700;cursor:pointer;border:1.5px solid ${tab===t.id?'#0066FF':'#E5E7EB'};background:${tab===t.id?'#0066FF':'white'};color:${tab===t.id?'white':'#374151'}">${t.label}</button>`).join('')}
</div>

<!-- Tab Content -->
<div id="autoseo-tab-body">${renderAutoSeoTab(tab, domain, industry, comps, sch)}</div>
`;
}

function renderAutoSeoTab(tab, domain, industry, comps, sch) {
  if (tab === 'calendar')  return renderAutoSeoCalendar(domain, industry, comps, sch);
  if (tab === 'backlinks') return renderAutoSeoBacklinks(domain, industry, comps);
  if (tab === 'outreach')  return renderAutoSeoOutreach(domain, industry);
  if (tab === 'keywords')  return renderAutoSeoKeywords(domain, industry, comps);
  if (tab === 'traffic')   return renderAutoSeoTraffic(domain, industry);
  if (tab === 'settings')  return renderAutoSeoSettings(sch);
  return '';
}

// ─── TAB 1: Content Calendar ─────────────────────────────────────────────────
function renderAutoSeoCalendar(domain, industry, comps, sch) {
  const articles = window._autoSeoArticles;
  const wpOk     = !!(window._wpCreds && window._wpCreds.siteUrl && window._wpCreds.appPassword);

  return `
<div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;overflow:hidden">
  <div style="padding:20px 24px;border-bottom:1.5px solid #F3F4F6;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-size:1rem;font-weight:800;color:#111827">📅 Monthly Content Calendar</div>
      <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">${sch.count} SEO-optimised articles for <strong>${domain}</strong> in the <strong>${industry}</strong> niche</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${articles ? `<button onclick="addAllGeneratedToSocialCalendar()" style="padding:9px 14px;background:linear-gradient(135deg,#0f766e,#5B21B6);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">📲 Add All to Social</button>` : ''}
      ${articles ? `<button onclick="publishAllToWordPress()" ${!wpOk?'disabled title="Connect WordPress first"':''} style="padding:9px 14px;background:${wpOk?'linear-gradient(135deg,#2563EB,#1D4ED8)':'#E5E7EB'};border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:${wpOk?'white':'#9CA3AF'};cursor:${wpOk?'pointer':'not-allowed'}">🟦 Publish All to WP</button>` : ''}
      <button onclick="generateArticleTopics()" id="gen-topics-btn" style="padding:9px 18px;background:linear-gradient(135deg,#059669,#047857);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer;display:flex;align-items:center;gap:6px">
        <span id="gen-topics-icon">✨</span> <span id="gen-topics-label">${articles ? 'Regenerate Topics' : 'Generate ' + sch.count + ' Article Topics'}</span><span id="gen-topics-timer" style="font-size:0.7rem;font-weight:600;opacity:0.85;display:none;margin-left:2px;background:rgba(0,0,0,0.2);padding:1px 6px;border-radius:5px">0s</span>
      </button>
    </div>
  </div>
  <!-- Date Range Row -->
  <div style="padding:14px 24px;background:#F9FAFB;border-bottom:1.5px solid #F3F4F6;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <span style="font-size:0.75rem;font-weight:700;color:#374151;white-space:nowrap">📆 Publishing Schedule:</span>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <label style="font-size:0.72rem;font-weight:600;color:#6B7280">Start Date
        <input type="date" id="seo-start-date" value="${sch.startDate}" onchange="window._autoSeoSchedule.startDate=this.value;buildAutoSEO()"
          style="display:block;margin-top:3px;padding:6px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.78rem;outline:none;background:white">
      </label>
      <span style="font-size:0.9rem;color:#9CA3AF;margin-top:16px">→</span>
      <label style="font-size:0.72rem;font-weight:600;color:#6B7280">End Date
        <input type="date" id="seo-end-date" value="${sch.endDate}" onchange="window._autoSeoSchedule.endDate=this.value;buildAutoSEO()"
          style="display:block;margin-top:3px;padding:6px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.78rem;outline:none;background:white">
      </label>
    </div>
    ${articles ? `<span style="font-size:0.72rem;color:#6B7280;margin-left:4px">Articles auto-spread across date range · 1 article every ${_artInterval(sch)} day(s)</span>
      <button onclick="showAutoSeoCalendar()" style="margin-left:10px;padding:5px 12px;background:linear-gradient(135deg,#6D28D9,#5B21B6);border:none;border-radius:8px;font-size:0.72rem;font-weight:700;color:white;cursor:pointer;display:inline-flex;align-items:center;gap:5px;vertical-align:middle">📅 Calendar View</button>` : ''}
  </div>
  <div id="calendar-content" style="padding:20px 24px">
    ${articles ? renderArticleGrid(articles, wpOk, sch) : renderCalendarEmpty(sch.count)}
  </div>
</div>`;
}

function renderCalendarEmpty(count) {
  return `
<div style="text-align:center;padding:50px 20px">
  <div style="font-size:3rem;margin-bottom:12px">📄</div>
  <div style="font-size:1.1rem;font-weight:700;color:#111827;margin-bottom:8px">Generate Your ${count}-Article Content Plan</div>
  <div style="font-size:0.82rem;color:#6B7280;max-width:400px;margin:0 auto 24px">InfoGenie will create a complete monthly content calendar with SEO-optimised article topics, target keywords, and publishing schedule tailored to your niche.</div>
  <button onclick="generateArticleTopics()" style="padding:12px 28px;background:linear-gradient(135deg,#059669,#047857);border:none;border-radius:10px;font-size:0.88rem;font-weight:700;color:white;cursor:pointer">✨ Generate Article Topics</button>
</div>`;
}

// Compute how many days apart articles should be published
function _artInterval(sch) {
  const s = new Date(sch.startDate || new Date());
  const e = new Date(sch.endDate   || new Date(Date.now()+30*24*60*60*1000));
  const totalDays = Math.max(1, Math.round((e - s) / (1000*60*60*24)));
  const count = window._autoSeoArticles?.length || sch.count || 30;
  return Math.max(1, Math.round(totalDays / count));
}

// Compute the scheduled publish date for article index i
function _artDate(i, sch) {
  // Respect per-article custom date override
  const arts = window._autoSeoArticles;
  if (arts && arts[i] && arts[i].customDate) return arts[i].customDate;
  const s        = new Date(sch.startDate || new Date());
  const interval = _artInterval(sch);
  const d        = new Date(s.getTime() + i * interval * 24*60*60*1000);
  return d.toISOString().split('T')[0];
}

function _fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function renderArticleGrid(articles, wpOk, sch) {
  sch = sch || window._autoSeoSchedule;
  const weeks = [[], [], [], []];
  articles.forEach((a, i) => weeks[Math.floor(i / Math.ceil(articles.length / 4))].push({ ...a, idx: i }));

  // Compute week date labels
  const weekStarts = [0,1,2,3].map(wi => {
    const firstInWeek = wi * Math.ceil(articles.length / 4);
    return _artDate(firstInWeek, sch);
  });
  const weekEnds = [0,1,2,3].map(wi => {
    const lastInWeek = Math.min(articles.length - 1, (wi + 1) * Math.ceil(articles.length / 4) - 1);
    return _artDate(lastInWeek, sch);
  });

  return weeks.filter(w => w.length).map((week, wi) => `
<div style="margin-bottom:20px">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
    <span style="font-size:0.72rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">Week ${wi + 1}</span>
    <span style="font-size:0.68rem;color:#9CA3AF;font-weight:600">${_fmtDate(weekStarts[wi])} — ${_fmtDate(weekEnds[wi])}</span>
  </div>
  <div style="display:grid;gap:10px">
    ${week.map(a => {
      const pubDate = _artDate(a.idx, sch);
      const alreadyInSocial = (window._socialPosts||[]).some(p => p.sourceArticleIdx === a.idx);
      return `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1.5px solid #E5E7EB;border-radius:12px;background:#FAFAFA">
      <div style="flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${a.status === 'published' ? '#059669' : a.status === 'generated' ? '#0066FF' : '#E5E7EB'};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;color:${a.status === 'published' || a.status === 'generated' ? 'white' : '#6B7280'}">${a.idx + 1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.85rem;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.title}</div>
        <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;align-items:center">
          <span style="font-size:0.66rem;padding:2px 7px;background:#EFF6FF;border-radius:4px;color:#1D4ED8;font-weight:600">${a.keyword}</span>
          <span style="font-size:0.66rem;padding:2px 7px;background:#F5F3FF;border-radius:4px;color:#6D28D9;font-weight:600">${a.intent || 'Informational'}</span>
          <span style="font-size:0.66rem;padding:2px 7px;background:${a.status === 'published' ? '#DCFCE7' : a.status === 'generated' ? '#DBEAFE' : '#F3F4F6'};border-radius:4px;color:${a.status === 'published' ? '#059669' : a.status === 'generated' ? '#1D4ED8' : '#6B7280'};font-weight:700">${a.status === 'published' ? '✓ Published' : a.status === 'generated' ? '✓ Written' : 'Pending'}</span>
          <span style="font-size:0.66rem;padding:2px 7px;background:#FFF7ED;border-radius:4px;color:#0b5f59;font-weight:600">📅 ${_fmtDate(pubDate)}</span>
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
        ${a.status === 'generating'
  ? `<button disabled id="write-btn-${a.idx}" style="padding:5px 10px;background:linear-gradient(135deg,#0066FF,#0052CC);border:none;border-radius:7px;font-size:0.67rem;font-weight:700;color:white;cursor:not-allowed;display:inline-flex;align-items:center;gap:5px;opacity:.9"><span style="width:11px;height:11px;border:2px solid rgba(255,255,255,.3);border-top-color:white;border-radius:50%;animation:spin .7s linear infinite;display:inline-block;flex-shrink:0"></span>Writing…</button>`
  : a.status !== 'generated' && a.status !== 'published'
  ? `<button onclick="generateSingleArticle(${a.idx})" style="padding:5px 10px;background:linear-gradient(135deg,#0066FF,#0052CC);border:none;border-radius:7px;font-size:0.67rem;font-weight:700;color:white;cursor:pointer">✍️ Write</button>`
  : ''}
        ${a.generatedHtml ? `<button onclick="previewGeneratedArticle(${a.idx})" style="padding:5px 10px;background:white;border:1px solid #E5E7EB;border-radius:7px;font-size:0.67rem;font-weight:700;color:#374151;cursor:pointer">👁 Preview</button>` : ''}
        ${a.generatedHtml ? `<button onclick="addArticleToSocialCalendar(${a.idx})" style="padding:5px 10px;background:${alreadyInSocial?'#F0FDF4':'linear-gradient(135deg,#0f766e,#5B21B6)'};border:${alreadyInSocial?'1px solid #BBF7D0':'none'};border-radius:7px;font-size:0.67rem;font-weight:700;color:${alreadyInSocial?'#059669':'white'};cursor:pointer">${alreadyInSocial?'✓ In Social':'📲 Social'}</button>` : ''}
        ${a.status === 'generated' && wpOk ? `<button onclick="publishSingleArticle(${a.idx})" style="padding:5px 10px;background:linear-gradient(135deg,#059669,#047857);border:none;border-radius:7px;font-size:0.67rem;font-weight:700;color:white;cursor:pointer">🟦 Publish</button>` : ''}
      </div>
    </div>`;
    }).join('')}
  </div>
</div>`).join('');
}

// ─── TAB 2: Backlink Opportunities ───────────────────────────────────────────
function renderAutoSeoBacklinks(domain, industry, comps) {
  const opps = window._autoSeoBacklinks;
  // Data-mode honesty: these opportunities are AI-generated. demo → badge the
  // header; strict → the server returns data_unavailable, so withhold the table.
  const _blUnavail = window._autoSeoBacklinksUnavailable === true;
  const _blDemoPill = (window._autoSeoBacklinksDemo && opps && opps.length && typeof window._demoBadge === 'function')
    ? ' ' + window._demoBadge('AI estimate') : '';
  return `
<div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;overflow:hidden">
  <div style="padding:20px 24px;border-bottom:1.5px solid #F3F4F6;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-size:1rem;font-weight:800;color:#111827">🔗 High-Authority Backlink Opportunities${_blDemoPill}</div>
      <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">AI-identified link prospects tailored to <strong>${domain}</strong></div>
    </div>
    <button onclick="loadBacklinkOpps()" id="bl-opps-btn" style="padding:9px 18px;background:linear-gradient(135deg,#0066FF,#0052CC);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">🔍 ${opps ? 'Refresh Opportunities' : 'Find Backlink Targets'}</button>
  </div>
  <div id="bl-opps-content" style="padding:20px 24px">
    ${_blUnavail && typeof window._dataUnavailableState === 'function'
      ? window._dataUnavailableState('Backlink opportunities are AI-generated suggestions, not verified live link data. Demo Data Mode is off, so estimated results are hidden. An administrator can enable Demo Data Mode for this client in the Admin portal.')
      : opps ? renderBacklinkTable(opps) : `
<div style="text-align:center;padding:50px 20px">
  <div style="font-size:3rem;margin-bottom:12px">🔗</div>
  <div style="font-size:1.1rem;font-weight:700;color:#111827;margin-bottom:8px">Discover 5+ High-Authority Backlink Targets</div>
  <div style="font-size:0.82rem;color:#6B7280;max-width:420px;margin:0 auto 24px">Our AI analyses your niche and competitors to surface the best link-building opportunities — guest posts, resource pages, HARO, directories and more.</div>
  <button onclick="loadBacklinkOpps()" style="padding:12px 28px;background:linear-gradient(135deg,#0066FF,#0052CC);border:none;border-radius:10px;font-size:0.88rem;font-weight:700;color:white;cursor:pointer">🔍 Find Backlink Targets</button>
</div>`}
  </div>
</div>`;
}

function renderBacklinkTable(opps) {
  const diffColor = { Easy: '#059669', Medium: '#D97706', Hard: '#DC2626' };
  const diffBg    = { Easy: '#F0FDF4', Medium: '#FFFBEB', Hard: '#FFF1F2' };
  const typeColor = '#0066FF';
  return `
<div style="overflow-x:auto">
<table style="width:100%;border-collapse:collapse;font-size:0.8rem">
  <thead>
    <tr style="background:#F9FAFB">
      ${['Site','DR','Type','Outreach Angle','Difficulty','Action'].map(h=>`<th style="padding:10px 14px;text-align:left;font-size:0.7rem;font-weight:700;color:#6B7280;text-transform:uppercase;border-bottom:1.5px solid #E5E7EB">${h}</th>`).join('')}
    </tr>
  </thead>
  <tbody>
    ${opps.map((o, i) => `
    <tr style="border-bottom:1px solid #F3F4F6;${i % 2 === 0 ? '' : 'background:#FAFAFA'}">
      <td style="padding:12px 14px;font-weight:700;color:#111827">${o.site}<br><a href="${o.url}" target="_blank" style="font-size:0.65rem;color:#0066FF;font-weight:500;text-decoration:none">${o.url}</a></td>
      <td style="padding:12px 14px;text-align:center"><span style="font-weight:800;color:#0066FF">${o.dr}</span></td>
      <td style="padding:12px 14px"><span style="padding:3px 8px;background:#EFF6FF;border-radius:5px;font-size:0.66rem;font-weight:700;color:${typeColor}">${o.type}</span></td>
      <td style="padding:12px 14px;color:#374151;max-width:260px">${o.angle}</td>
      <td style="padding:12px 14px;text-align:center"><span style="padding:3px 9px;border-radius:5px;font-size:0.66rem;font-weight:700;background:${diffBg[o.difficulty]||'#F3F4F6'};color:${diffColor[o.difficulty]||'#374151'}">${o.difficulty}</span></td>
      <td style="padding:12px 14px">
        <button onclick="copyOutreachEmail(${i})" title="Copy outreach email template" style="padding:5px 10px;background:white;border:1px solid #E5E7EB;border-radius:7px;font-size:0.67rem;font-weight:700;color:#374151;cursor:pointer">📧 Copy Pitch</button>
      </td>
    </tr>`).join('')}
  </tbody>
</table>
</div>
<div style="margin-top:16px;padding:14px 16px;background:#F0FDF4;border-radius:10px;border:1px solid #BBF7D0;display:flex;align-items:center;gap:10px">
  <span style="font-size:1.2rem">💡</span>
  <div style="font-size:0.75rem;color:#065F46;font-weight:600">Pro Tip: Start with <strong>Easy</strong> targets — even 3-4 quality links from DR 60+ sites can lift your domain authority significantly within 90 days.</div>
</div>`;
}

// ─── TAB 3: Keyword Research ──────────────────────────────────────────────────
function renderAutoSeoKeywords(domain, industry, comps) {
  const kws = window._autoSeoKeywords;
  return `
<div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;overflow:hidden">
  <div style="padding:20px 24px;border-bottom:1.5px solid #F3F4F6;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-size:1rem;font-weight:800;color:#111827">🔍 Advanced Keyword Research</div>
      <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">High-value, low-competition opportunities for <strong>${domain}</strong></div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="kw-seed" placeholder="Seed keyword (optional)" style="padding:8px 12px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.78rem;width:180px;outline:none">
      <button onclick="loadKeywordResearch()" id="kw-btn" style="padding:9px 18px;background:linear-gradient(135deg,#0f766e,#5B21B6);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">🔍 ${kws ? 'Refresh' : 'Research Keywords'}</button>
    </div>
  </div>
  <div id="kw-content" style="padding:20px 24px">
    ${kws ? renderKeywordTable(kws) : `
<div style="text-align:center;padding:50px 20px">
  <div style="font-size:3rem;margin-bottom:12px">🔍</div>
  <div style="font-size:1.1rem;font-weight:700;color:#111827;margin-bottom:8px">Uncover Winning Keywords</div>
  <div style="font-size:0.82rem;color:#6B7280;max-width:420px;margin:0 auto 24px">AI-powered research surfaces high-volume, low-difficulty keywords your competitors haven't fully captured — perfect for quick wins.</div>
  <button onclick="loadKeywordResearch()" style="padding:12px 28px;background:linear-gradient(135deg,#0f766e,#5B21B6);border:none;border-radius:10px;font-size:0.88rem;font-weight:700;color:white;cursor:pointer">🔍 Start Keyword Research</button>
</div>`}
  </div>
</div>`;
}

function renderKeywordTable(kws) {
  const intentColor = { Informational:'#0066FF', Commercial:'#0f766e', Transactional:'#059669', Navigational:'#D97706' };
  const intentBg    = { Informational:'#EFF6FF', Commercial:'#F5F3FF', Transactional:'#F0FDF4', Navigational:'#FFFBEB' };
  const sorted = [...kws].sort((a, b) => b.opportunity_score - a.opportunity_score);
  return `
<div style="overflow-x:auto">
<table style="width:100%;border-collapse:collapse;font-size:0.8rem">
  <thead>
    <tr style="background:#F9FAFB">
      ${['Keyword','Monthly Volume','Difficulty','CPC','Intent','Opp. Score','Content Angle'].map(h=>`<th style="padding:10px 12px;text-align:left;font-size:0.68rem;font-weight:700;color:#6B7280;text-transform:uppercase;border-bottom:1.5px solid #E5E7EB">${h}</th>`).join('')}
    </tr>
  </thead>
  <tbody>
    ${sorted.map((k, i) => {
      const diffColor = k.difficulty < 30 ? '#059669' : k.difficulty < 60 ? '#D97706' : '#DC2626';
      const oppColor  = k.opportunity_score >= 8 ? '#059669' : k.opportunity_score >= 5 ? '#D97706' : '#6B7280';
      return `
    <tr style="border-bottom:1px solid #F3F4F6;${i % 2 === 0 ? '' : 'background:#FAFAFA'}">
      <td style="padding:11px 12px;font-weight:700;color:#111827">${k.keyword}</td>
      <td style="padding:11px 12px;text-align:center;font-weight:700;color:#0066FF">${(k.monthly_volume||0).toLocaleString()}</td>
      <td style="padding:11px 12px;text-align:center"><span style="font-weight:800;color:${diffColor}">${k.difficulty}</span></td>
      <td style="padding:11px 12px;text-align:center;color:#374151">$${parseFloat(k.cpc||0).toFixed(2)}</td>
      <td style="padding:11px 12px"><span style="padding:3px 8px;border-radius:5px;font-size:0.65rem;font-weight:700;background:${intentBg[k.intent]||'#F3F4F6'};color:${intentColor[k.intent]||'#374151'}">${k.intent||'—'}</span></td>
      <td style="padding:11px 12px;text-align:center"><span style="font-weight:800;color:${oppColor}">${k.opportunity_score}/10</span></td>
      <td style="padding:11px 12px;color:#374151;max-width:200px;font-size:0.72rem">${k.content_angle||'—'}</td>
    </tr>`;
    }).join('')}
  </tbody>
</table>
</div>
<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
  <button onclick="addKeywordsToCalendar()" style="padding:8px 16px;background:linear-gradient(135deg,#059669,#047857);border:none;border-radius:8px;font-size:0.75rem;font-weight:700;color:white;cursor:pointer">📅 Add Top Keywords to Calendar</button>
  <button onclick="copyKeywordsCSV()" style="padding:8px 16px;background:white;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.75rem;font-weight:700;color:#374151;cursor:pointer">📋 Copy as CSV</button>
</div>`;
}

// ─── TAB 4: Automation Settings ───────────────────────────────────────────────
function renderAutoSeoSettings(sch) {
  const wpOk = !!(window._wpCreds && window._wpCreds.siteUrl && window._wpCreds.appPassword);
  return `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">

  <!-- Publishing Schedule -->
  <div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;padding:22px 24px">
    <div style="font-size:0.95rem;font-weight:800;color:#111827;margin-bottom:16px">⚡ Publishing Schedule</div>
    <div style="display:flex;flex-direction:column;gap:14px">
      <label style="font-size:0.78rem;font-weight:700;color:#374151">Articles per month
        <input id="seo-count" type="number" min="1" max="60" value="${sch.count}" oninput="window._autoSeoSchedule.count=+this.value" style="margin-top:5px;display:block;width:100%;padding:8px 12px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.82rem;outline:none">
      </label>
      <label style="font-size:0.78rem;font-weight:700;color:#374151">Target word count
        <select id="seo-wc" onchange="window._autoSeoSchedule.wordCount=+this.value" style="margin-top:5px;display:block;width:100%;padding:8px 12px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.82rem;outline:none;background:white">
          ${[800,1000,1200,1500,2000,2500].map(w=>`<option value="${w}" ${sch.wordCount==w?'selected':''}>${w.toLocaleString()} words</option>`).join('')}
        </select>
      </label>
      <label style="font-size:0.78rem;font-weight:700;color:#374151">Content tone
        <select id="seo-tone" onchange="window._autoSeoSchedule.tone=this.value" style="margin-top:5px;display:block;width:100%;padding:8px 12px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.82rem;outline:none;background:white">
          ${['professional','conversational','authoritative','friendly','educational'].map(t=>`<option value="${t}" ${sch.tone==t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
        </select>
      </label>
      <button onclick="saveAutoSeoSettings()" style="padding:10px;background:linear-gradient(135deg,#059669,#047857);border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer;margin-top:4px">💾 Save Settings</button>
    </div>
  </div>

  <!-- WordPress Connection -->
  <div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;padding:22px 24px">
    <div style="font-size:0.95rem;font-weight:800;color:#111827;margin-bottom:6px">🟦 WordPress Auto-Publishing</div>
    <div style="font-size:0.75rem;color:#6B7280;margin-bottom:16px">Articles are published as drafts — you approve &amp; go live from WP Admin</div>
    ${wpOk ? `
    <div style="padding:14px;background:#F0FDF4;border:1.5px solid #BBF7D0;border-radius:10px;margin-bottom:14px">
      <div style="font-size:0.78rem;font-weight:700;color:#065F46;margin-bottom:4px">✅ WordPress Connected</div>
      <div style="font-size:0.72rem;color:#059669">${window._wpCreds.siteUrl}</div>
    </div>
    <button onclick="openWpCredentialsModal()" style="width:100%;padding:10px;background:white;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.8rem;font-weight:700;color:#374151;cursor:pointer">🔄 Update Credentials</button>` : `
    <div style="padding:14px;background:#FFF7ED;border:1.5px solid #FED7AA;border-radius:10px;margin-bottom:14px">
      <div style="font-size:0.78rem;font-weight:700;color:#92400E;margin-bottom:4px">⚠️ WordPress Not Connected</div>
      <div style="font-size:0.72rem;color:#B45309">Connect your WordPress site to enable auto-publishing</div>
    </div>
    <button onclick="openWpCredentialsModal()" style="width:100%;padding:10px;background:linear-gradient(135deg,#0066FF,#0052CC);border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer">🟦 Connect WordPress</button>`}
  </div>

  <!-- 24/7 Automation Status -->
  <div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;padding:22px 24px;grid-column:span 2">
    <div style="font-size:0.95rem;font-weight:800;color:#111827;margin-bottom:16px">🤖 AutoSEO Automation Status</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
      ${[
        { icon:'📄', title:'Content Generation', desc:'AI writes articles based on your calendar topics & keywords', status:'Ready', ok:true },
        { icon:'🔍', title:'Keyword Monitoring', desc:'Tracks ranking changes and surfaces new opportunities weekly', status:'Active', ok:true },
        { icon:'🟦', title:'WordPress Publishing', desc:'Publishes generated drafts automatically on schedule', status: wpOk ? 'Connected' : 'Setup Required', ok: wpOk },
      ].map(f=>`
      <div style="padding:16px;border:1.5px solid ${f.ok?'#BBF7D0':'#FED7AA'};border-radius:12px;background:${f.ok?'#F0FDF4':'#FFFBEB'}">
        <div style="font-size:1.5rem;margin-bottom:8px">${f.icon}</div>
        <div style="font-size:0.82rem;font-weight:800;color:#111827;margin-bottom:4px">${f.title}</div>
        <div style="font-size:0.72rem;color:#6B7280;margin-bottom:10px">${f.desc}</div>
        <span style="padding:3px 9px;border-radius:5px;font-size:0.65rem;font-weight:700;background:${f.ok?'#DCFCE7':'#FEF3C7'};color:${f.ok?'#059669':'#D97706'}">${f.status}</span>
      </div>`).join('')}
    </div>
  </div>

</div>`;
}

// ─── Action Functions ─────────────────────────────────────────────────────────
function saveAutoSeoDomain() {
  const domInp = document.getElementById('autoseo-domain-inp');
  const indInp = document.getElementById('autoseo-industry-inp');
  const dom = domInp?.value?.trim().replace(/https?:\/\//,'').replace(/www\./,'').replace(/\//,'') || '';
  if (!dom) { showToast('⚠️ Please enter your domain'); domInp?.focus(); return; }
  window._autoSeoDomain   = dom;
  window._autoSeoIndustry = indInp?.value?.trim() || 'General';
  showToast(`✅ Domain set to ${dom}`);
  buildAutoSEO();
}

async function generateArticleTopics() {
  const ctx = _autoSeoContext();
  if (!ctx.domain) {
    showToast('⚠️ Enter your domain in the field above first');
    document.getElementById('autoseo-domain-inp')?.focus();
    return;
  }
  const btn = document.getElementById('gen-topics-btn');
  const icon = document.getElementById('gen-topics-icon');
  const lbl  = document.getElementById('gen-topics-label');
  const timer = document.getElementById('gen-topics-timer');
  if (btn) { btn.disabled = true; if(icon) icon.textContent = '⏳'; if(lbl) lbl.textContent = 'Generating…'; }
  if (timer) { timer.style.display = 'inline-block'; timer.textContent = '0s'; }
  const genStart = Date.now();
  const genInterval = setInterval(() => {
    const secs = Math.floor((Date.now() - genStart) / 1000);
    const display = secs < 60 ? secs + 's' : Math.floor(secs/60) + 'm ' + (secs%60) + 's';
    if (timer) timer.textContent = display;
  }, 1000);
  const sch   = window._autoSeoSchedule;
  const comps = ctx.comps;
  try {
    const resp = await fetch('/api/generate-article-topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: ctx.domain, industry: ctx.industry, competitors: comps, count: sch.count, tone: sch.tone })
    });
    const data = await resp.json();
    if (data.topics && data.topics.length) {
      window._autoSeoArticles = data.topics.map(t => ({ ...t, status: 'pending', generatedHtml: null }));
      showToast(`✅ ${data.topics.length} article topics generated in ${Math.floor((Date.now()-genStart)/1000)}s!`);
    } else { showToast('⚠️ Could not generate topics — try again'); }
  } catch(e) { showToast('❌ Error: ' + e.message); }
  finally {
    clearInterval(genInterval);
    if (timer) { timer.style.display = 'none'; }
    if (btn) { btn.disabled = false; if(icon) icon.textContent = '✨'; if(lbl) lbl.textContent = 'Regenerate Topics'; }
    buildAutoSEO();
  }
}

async function generateSingleArticle(idx) {
  if (!window._autoSeoArticles || !window._autoSeoArticles[idx]) return;
  const art = window._autoSeoArticles[idx];
  const ctx = _autoSeoContext();
  art.status = 'generating';
  buildAutoSEO();
  try {
    const resp = await fetch('/api/generate-seo-article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: art.title, keyword: art.keyword, domain: ctx.domain||'yourdomain.com',
        industry: ctx.industry, competitors: ctx.comps,
        wordCount: window._autoSeoSchedule.wordCount, tone: window._autoSeoSchedule.tone
      })
    });
    const data = await resp.json();
    if (data.content) {
      art.generatedHtml = data.content;
      art.status = 'generated';
      art.wordCount = data.wordCount;
      showToast(`✅ Article written: "${art.title.substring(0,40)}…"`);
    } else { art.status = 'pending'; showToast('⚠️ Could not write article'); }
  } catch(e) { art.status = 'pending'; showToast('❌ Error: ' + e.message); }
  buildAutoSEO();
}

async function publishSingleArticle(idx) {
  if (!window._autoSeoArticles || !window._autoSeoArticles[idx]) return;
  const art = window._autoSeoArticles[idx];
  if (!art.generatedHtml) { showToast('⚠️ Generate the article first'); return; }
  const creds = window._wpCreds;
  if (!creds || !creds.siteUrl || !creds.appPassword) { showToast('⚠️ Connect WordPress first'); openWpCredentialsModal(); return; }
  art.status = 'publishing';
  buildAutoSEO();
  try {
    const resp = await fetch('/api/publish-to-wordpress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteUrl: creds.siteUrl, username: creds.username, appPassword: creds.appPassword, title: art.title, content: art.generatedHtml })
    });
    const data = await resp.json();
    if (data.url) {
      art.status = 'published';
      art.wpUrl  = data.url;
      showToast('🟦 Published to WordPress as draft!');
    } else { art.status = 'generated'; showToast('⚠️ Publish failed: ' + (data.error||'Unknown error')); }
  } catch(e) { art.status = 'generated'; showToast('❌ ' + e.message); }
  buildAutoSEO();
}

async function publishAllToWordPress() {
  const arts = (window._autoSeoArticles||[]).filter(a => a.status === 'generated');
  if (!arts.length) { showToast('⚠️ No generated articles to publish'); return; }
  showToast(`🚀 Publishing ${arts.length} articles…`);
  for (const a of arts) {
    const idx = window._autoSeoArticles.indexOf(a);
    await publishSingleArticle(idx);
    await new Promise(r => setTimeout(r, 600));
  }
  showToast('✅ All articles published to WordPress!');
}

function previewGeneratedArticle(idx) {
  const art = window._autoSeoArticles && window._autoSeoArticles[idx];
  if (!art || !art.generatedHtml) return;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
<div style="background:white;border-radius:16px;width:820px;max-width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden">
  <div style="padding:16px 20px;border-bottom:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:0.95rem;font-weight:800;color:#111827">${art.title}</div>
      <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">~${art.wordCount||1200} words · Keyword: <strong>${art.keyword}</strong></div>
    </div>
    <button onclick="this.closest('[style*=fixed]').remove()" style="padding:6px 12px;background:#F3F4F6;border:none;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:700">✕ Close</button>
  </div>
  <div id="art-preview-scroll" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch">
    <div id="art-preview-body" style="padding:24px 30px;font-size:0.88rem;line-height:1.7;color:#374151">${art.generatedHtml}</div>
    <div id="art-fact-check-results" style="padding:0 30px 24px"></div>
  </div>
  <div style="padding:14px 20px;border-top:1px solid #E5E7EB;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
    <button id="art-fact-check-btn" onclick="runArticleFactCheck(${idx})" style="padding:8px 16px;background:linear-gradient(135deg,#0f766e,#4338CA);border:none;border-radius:8px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">🔍 Check Facts</button>
    <button onclick="navigator.clipboard.writeText(document.querySelector('#art-preview-body').innerHTML);showToast('📋 Copied!')" style="padding:8px 16px;background:white;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer">📋 Copy HTML</button>
    ${!!(window._wpCreds&&window._wpCreds.siteUrl) ? `<button onclick="this.closest('[style*=fixed]').remove();publishSingleArticle(${idx})" style="padding:8px 16px;background:linear-gradient(135deg,#059669,#047857);border:none;border-radius:8px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">🟦 Publish to WP</button>` : ''}
  </div>
</div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function runArticleFactCheck(idx) {
  const art = window._autoSeoArticles && window._autoSeoArticles[idx];
  if (!art || !art.generatedHtml) return;
  const ctx = _autoSeoContext();
  const btn = document.getElementById('art-fact-check-btn');
  const out = document.getElementById('art-fact-check-results');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Scraping & checking…'; }
  if (out) out.innerHTML = `<div style="padding:14px;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:10px;font-size:0.78rem;color:#64748B;margin:10px 0">Scraping <strong>${ctx.domain||'your site'}</strong> and grading every factual claim against your live source-of-truth…</div>`;
  try {
    const resp = await fetch('/api/content-fact-check', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ content: art.generatedHtml, domain: ctx.domain || 'yourdomain.com' })
    });
    const d = await resp.json();
    if (!d.ok) { if(out) out.innerHTML = `<div style="padding:12px;background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;font-size:0.78rem;color:#991B1B;margin:10px 0">❌ ${d.error||'Fact-check failed'}</div>`; return; }
    if (!d.sourceFetched) { if(out) out.innerHTML = `<div style="padding:12px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;font-size:0.78rem;color:#92400E;margin:10px 0">⚠️ ${d.note}</div>`; return; }
    art.factCheck = d;
    const score = d.alignmentScore || 0;
    const scoreColor = score >= 80 ? '#10B981' : score >= 60 ? '#F59E0B' : '#DC2626';
    const verdict = score >= 80 ? '✅ Safe to Publish' : score >= 60 ? '⚠️ Review Recommended' : '🛑 Hold — fix contradictions';
    const esc = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const renderList = (arr, color, bg, icon, fields) => arr.length ? `<div style="margin-top:10px"><div style="font-size:0.74rem;font-weight:800;color:${color};margin-bottom:6px">${icon} ${arr.length} ${esc(fields.label)}</div>${arr.slice(0,8).map(x => `<div style="background:${bg};border-left:3px solid ${color};padding:8px 11px;border-radius:6px;margin-bottom:5px;font-size:0.74rem;line-height:1.5"><div style="font-weight:700;color:#0A1628">${esc(x.claim)}</div><div style="color:#475569;margin-top:3px;font-style:italic">${esc(x[fields.detail])}</div></div>`).join('')}</div>` : '';
    if (out) out.innerHTML = `<div style="background:white;border:2px solid ${scoreColor};border-radius:12px;padding:14px 16px;margin:12px 0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div><div style="font-size:0.85rem;font-weight:800;color:#0A1628">Fact Alignment Report</div><div style="font-size:0.7rem;color:#6B7280;margin-top:2px">Graded against ${ctx.domain} (${(d.sourceLength/1000).toFixed(1)}k chars scraped)</div></div>
        <div style="text-align:right"><div style="font-size:1.6rem;font-weight:800;color:${scoreColor}">${score}<span style="font-size:0.8rem">/100</span></div><div style="font-size:0.7rem;font-weight:700;color:${scoreColor}">${verdict}</div></div>
      </div>
      ${d.summary ? `<div style="font-size:0.76rem;color:#374151;background:#F8FAFC;padding:8px 11px;border-radius:7px;margin-bottom:6px"><strong>Verdict:</strong> ${esc(d.summary)}</div>` : ''}
      ${((d.contradicting&&d.contradicting.length) || (d.unverifiable&&d.unverifiable.length)) ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px"><button id="art-auto-correct-btn" onclick="runArticleAutoCorrect(${idx})" style="padding:8px 14px;background:linear-gradient(135deg,#10B981,#059669);border:none;border-radius:8px;font-size:0.78rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;box-shadow:0 2px 6px rgba(16,185,129,.35)">🪄 Auto-Correct (${(d.contradicting||[]).length + (d.unverifiable||[]).length} issues)</button><span style="font-size:0.7rem;color:#6B7280;align-self:center">Rewrites flagged claims to match ${esc(ctx.domain)} — preserves your HTML structure</span></div>` : ''}
      ${renderList(d.contradicting||[], '#DC2626', '#FEF2F2', '🛑', { label:'Contradicting Claims', detail:'correction' })}
      ${renderList(d.unverifiable||[],  '#F59E0B', '#FFFBEB', '⚠️', { label:'Unverifiable Claims', detail:'reason' })}
      ${renderList(d.aligned||[],       '#10B981', '#F0FDF4', '✅', { label:'Aligned Claims', detail:'evidence' })}
    </div>`;
    // Auto-scroll the report into view so the user sees the verdict immediately
    requestAnimationFrame(() => {
      const scroller = document.getElementById('art-preview-scroll');
      const target = document.getElementById('art-fact-check-results');
      if (scroller && target) {
        scroller.scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' });
      }
    });
  } catch(e) {
    if (out) out.innerHTML = `<div style="padding:12px;background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;font-size:0.78rem;color:#991B1B;margin:10px 0">❌ ${e.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Re-check Facts'; }
  }
}

async function runArticleAutoCorrect(idx) {
  const art = window._autoSeoArticles && window._autoSeoArticles[idx];
  if (!art || !art.factCheck) { showToast('⚠️ Run a fact-check first'); return; }
  const ctx = _autoSeoContext();
  const btn = document.getElementById('art-auto-correct-btn');
  const out = document.getElementById('art-fact-check-results');
  const startedAt = Date.now();
  let timerInt = null;
  if (btn) {
    btn.disabled = true;
    const fmt = () => { const s = Math.floor((Date.now()-startedAt)/1000); return `⏳ Auto-correcting… ${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
    btn.textContent = fmt();
    timerInt = setInterval(() => { if (btn) btn.textContent = fmt(); }, 1000);
  }
  try {
    const r = await fetch('/api/content-fact-check/auto-correct', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        content: art.generatedHtml,
        contradictions: art.factCheck.contradicting || [],
        unverifiable: art.factCheck.unverifiable || [],
        domain: ctx.domain || 'yourdomain.com'
      })
    }).then(x => x.json());
    if (!r.ok) { showToast('❌ ' + (r.error || 'Auto-correct failed')); return; }
    art.generatedHtml = r.correctedHtml || art.generatedHtml;
    const body = document.getElementById('art-preview-body');
    if (body) body.innerHTML = art.generatedHtml;
    const editsHtml = (r.edits || []).slice(0, 12).map(e => `
      <div style="background:#F0FDF4;border-left:3px solid #10B981;padding:8px 11px;border-radius:6px;margin-bottom:6px;font-size:0.74rem;line-height:1.5">
        <div style="color:#991B1B;text-decoration:line-through">${(e.before||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>
        <div style="color:#065F46;font-weight:700;margin-top:3px">→ ${(e.after||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>
        <div style="color:#475569;font-style:italic;margin-top:2px">${(e.reason||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>
      </div>`).join('');
    const elapsed = Math.floor((Date.now()-startedAt)/1000);
    if (out) out.innerHTML = `<div style="background:white;border:2px solid #10B981;border-radius:12px;padding:14px 16px;margin:12px 0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div><div style="font-size:0.85rem;font-weight:800;color:#0A1628">🪄 Auto-Correct Complete</div><div style="font-size:0.7rem;color:#6B7280;margin-top:2px">${(r.edits||[]).length} passages rewritten in ${elapsed}s · article HTML updated above</div></div>
        <button onclick="runArticleFactCheck(${idx})" style="padding:8px 14px;background:linear-gradient(135deg,#0f766e,#4338CA);border:none;border-radius:8px;font-size:0.74rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer">🔄 Re-check Facts</button>
      </div>
      ${editsHtml ? `<div style="margin-top:8px"><div style="font-size:0.74rem;font-weight:800;color:#065F46;margin-bottom:6px">✅ Edits applied</div>${editsHtml}</div>` : '<div style="font-size:0.74rem;color:#6B7280">No edits returned by the model.</div>'}
    </div>`;
    showToast(`✨ Auto-corrected ${(r.edits||[]).length} passages in ${elapsed}s`);
  } catch (e) {
    showToast('❌ ' + (e.message || 'Auto-correct failed'));
  } finally {
    if (timerInt) clearInterval(timerInt);
    if (btn) { btn.disabled = false; btn.textContent = '🪄 Auto-Correct'; }
  }
}

async function loadBacklinkOpps() {
  const ctx = _autoSeoContext();
  if (!ctx.domain) { showToast('⚠️ Enter your domain in the field above first'); document.getElementById('autoseo-domain-inp')?.focus(); return; }
  const btn = document.getElementById('bl-opps-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analysing…'; }
  const kws = (window._autoSeoKeywords||[]).slice(0,5).map(k=>k.keyword);
  try {
    const resp = await fetch('/api/backlink-opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: ctx.domain, industry: ctx.industry, competitors: ctx.comps, keywords: kws })
    });
    const data = await resp.json();
    // Capture the server's data-mode verdict so the tab can badge (demo) or
    // withhold (strict) these AI-generated link prospects honestly.
    window._autoSeoBacklinksUnavailable = data.data_unavailable === true;
    window._autoSeoBacklinksDemo = (data._dataMode === 'demo' || data._demo === true);
    window._autoSeoBacklinks = data.opportunities || [];
    if (window._autoSeoBacklinksUnavailable) {
      showToast('📭 Backlink data unavailable — Demo Data Mode is off (admin can enable it).');
    } else {
      showToast(`✅ Found ${window._autoSeoBacklinks.length} backlink opportunities!`);
    }
  } catch(e) { showToast('❌ ' + e.message); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Refresh Opportunities'; }
    buildAutoSEO();
  }
}

async function loadKeywordResearch() {
  const ctx = _autoSeoContext();
  if (!ctx.domain) { showToast('⚠️ Enter your domain in the field above first'); document.getElementById('autoseo-domain-inp')?.focus(); return; }
  const btn = document.getElementById('kw-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Researching…'; }
  const seed = document.getElementById('kw-seed')?.value?.trim() || '';
  try {
    const resp = await fetch('/api/keyword-research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: ctx.domain, industry: ctx.industry, seedKeyword: seed, competitors: ctx.comps })
    });
    const data = await resp.json();
    window._autoSeoKeywords = data.keywords || [];
    showToast(`✅ Found ${window._autoSeoKeywords.length} keyword opportunities!`);
  } catch(e) { showToast('❌ ' + e.message); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Refresh'; }
    buildAutoSEO();
  }
}

function addKeywordsToCalendar() {
  const kws = window._autoSeoKeywords;
  if (!kws || !kws.length) { showToast('⚠️ No keywords to add'); return; }
  const top5 = [...kws].sort((a,b)=>b.opportunity_score-a.opportunity_score).slice(0,5);
  if (!window._autoSeoArticles) window._autoSeoArticles = [];
  top5.forEach(k => {
    if (!window._autoSeoArticles.find(a=>a.keyword===k.keyword)) {
      window._autoSeoArticles.push({ title: k.content_angle || `Complete Guide to ${k.keyword}`, keyword: k.keyword, intent: k.intent, status: 'pending', generatedHtml: null });
    }
  });
  window._autoSeoTab = 'calendar';
  buildAutoSEO();
  showToast(`📅 Added ${top5.length} keywords to your content calendar!`);
}

function copyKeywordsCSV() {
  const kws = window._autoSeoKeywords;
  if (!kws || !kws.length) { showToast('⚠️ No keywords to copy'); return; }
  const csv = ['Keyword,Volume,Difficulty,CPC,Intent,Score,Content Angle',
    ...kws.map(k=>`"${k.keyword}",${k.monthly_volume||0},${k.difficulty||0},$${k.cpc||0},"${k.intent||''}",${k.opportunity_score||0},"${k.content_angle||''}"`)
  ].join('\n');
  navigator.clipboard.writeText(csv).then(()=>showToast('📋 Keywords copied as CSV!'));
}

function copyOutreachEmail(idx) {
  const opp = window._autoSeoBacklinks && window._autoSeoBacklinks[idx];
  if (!opp) return;
  const ctx = _autoSeoContext();
  const email = `Subject: Guest Post Opportunity — ${ctx.domain||'Our Site'}

Hi ${opp.site} Team,

I came across your site and noticed you cover topics relevant to ${ctx.industry||'our industry'}.

${opp.angle}

I'd love to contribute a high-quality, original article to your publication. In return, a contextual backlink to ${ctx.domain||'our site'} would be greatly appreciated.

Would you be open to a quick chat or can I send over some topic ideas?

Best regards,
[Your Name]
${ctx.domain||'yourdomain.com'}`;
  navigator.clipboard.writeText(email).then(()=>showToast('📧 Outreach email copied to clipboard!'));
}

function addArticleToSocialCalendar(idx) {
  const art = window._autoSeoArticles && window._autoSeoArticles[idx];
  if (!art) return;
  const sch     = window._autoSeoSchedule;
  const pubDate = _artDate(idx, sch);
  const ctx     = _autoSeoContext();
  const domain  = ctx.domain || 'yourdomain.com';

  // Build social caption from the article title/keyword
  const caption = `📝 New Article: "${art.title}"\n\n` +
    `Looking to learn more about ${art.keyword}? We've just published a comprehensive guide covering everything you need to know.\n\n` +
    `👉 Read it now at ${domain}\n\n` +
    `#${(art.keyword||'').replace(/\s+/g,'')} #${ctx.industry.replace(/\s+/g,'')} #SEO #ContentMarketing`;

  if (!window._socialPosts) window._socialPosts = [];

  // Add one post per main platform
  const platforms = ['Blog / LinkedIn', 'Instagram', 'Twitter / X'];
  let added = 0;
  platforms.forEach(platform => {
    // Avoid duplicate: same article + platform
    const exists = window._socialPosts.some(p => p.sourceArticleIdx === idx && p.platform === platform);
    if (!exists) {
      window._socialPosts.push({
        id: 'art_' + idx + '_' + platform.replace(/\W+/g,'') + '_' + Date.now(),
        platform,
        caption,
        scheduledDate: pubDate,
        scheduledTime: '09:00',
        status: 'scheduled',
        sourceArticleIdx: idx,
        sourceArticleTitle: art.title,
        fileName: null,
        createdAt: new Date().toLocaleString()
      });
      added++;
    }
  });

  if (added > 0) {
    showToast(`📲 Added "${art.title.substring(0,35)}…" to Social Calendar on ${_fmtDate(pubDate)}`);
    buildAutoSEO();
  } else {
    showToast('ℹ️ This article is already in the Social Calendar');
  }
}

function addAllGeneratedToSocialCalendar() {
  const arts = (window._autoSeoArticles||[]).filter(a => a.generatedHtml);
  if (!arts.length) { showToast('⚠️ Write at least one article first — then add to Social Calendar'); return; }
  arts.forEach(a => {
    const idx = window._autoSeoArticles.indexOf(a);
    addArticleToSocialCalendar(idx);
  });
  showToast(`📲 ${arts.length} articles added to Social Calendar!`);
}

function saveAutoSeoSettings() {
  showToast('✅ AutoSEO settings saved!');
  buildAutoSEO();
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOSEO: OUTREACH SEQUENCER + TRAFFIC INTEL
// ═══════════════════════════════════════════════════════════════════════════════
window._autoSeoOutreach = {};   // keyed by backlink index: { emails, status, senderName }
window._autoSeoTraffic  = null; // traffic projection data

// ─── TAB 3: Outreach Sequencer ────────────────────────────────────────────────
function renderAutoSeoOutreach(domain, industry) {
  const opps = window._autoSeoBacklinks;
  const orMap = window._autoSeoOutreach || {};

  if (!opps || !opps.length) {
    return `
<div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;padding:40px;text-align:center">
  <div style="font-size:3rem;margin-bottom:14px">📬</div>
  <div style="font-size:1.05rem;font-weight:800;color:#111827;margin-bottom:8px">No Backlink Targets Yet</div>
  <div style="font-size:0.82rem;color:#6B7280;max-width:380px;margin:0 auto 20px">Find backlink targets first — then the Outreach Sequencer will auto-generate personalised 3-email sequences for each one.</div>
  <button onclick="window._autoSeoTab='backlinks';buildAutoSEO()" style="padding:11px 24px;background:linear-gradient(135deg,#0066FF,#0052CC);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">🔍 Find Backlink Targets First</button>
</div>`;
  }

  const statuses = { 'not_started':'Not Started', 'email1_sent':'Email 1 Sent', 'followup_sent':'Follow-up Sent', 'final_sent':'Final Sent', 'responded':'Responded ✉️', 'secured':'🔗 Link Secured' };
  const statusColors = { not_started:'#6B7280', email1_sent:'#0066FF', followup_sent:'#0f766e', final_sent:'#D97706', responded:'#059669', secured:'#059669' };
  const statusBg     = { not_started:'#F3F4F6', email1_sent:'#EFF6FF', followup_sent:'#F5F3FF', final_sent:'#FFFBEB', responded:'#DCFCE7', secured:'#F0FDF4' };

  const secured = Object.values(orMap).filter(o => o.status === 'secured').length;
  const active  = Object.values(orMap).filter(o => o.status !== 'not_started' && o.status !== 'secured').length;
  const total   = opps.length;

  return `
<div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;overflow:hidden">
  <div style="padding:20px 24px;border-bottom:1.5px solid #F3F4F6;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-size:1rem;font-weight:800;color:#111827">📬 Backlink Outreach Sequencer</div>
      <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">AI-written 3-email sequences — copy, send, track, get links</div>
    </div>
    <div style="display:flex;gap:12px">
      <div style="text-align:center;padding:8px 16px;background:#F0FDF4;border-radius:10px">
        <div style="font-size:1.1rem;font-weight:800;color:#059669">${secured}</div>
        <div style="font-size:0.65rem;color:#6B7280;font-weight:600">Links Secured</div>
      </div>
      <div style="text-align:center;padding:8px 16px;background:#EFF6FF;border-radius:10px">
        <div style="font-size:1.1rem;font-weight:800;color:#0066FF">${active}</div>
        <div style="font-size:0.65rem;color:#6B7280;font-weight:600">Active Outreach</div>
      </div>
      <div style="text-align:center;padding:8px 16px;background:#F3F4F6;border-radius:10px">
        <div style="font-size:1.1rem;font-weight:800;color:#374151">${total}</div>
        <div style="font-size:0.65rem;color:#6B7280;font-weight:600">Total Targets</div>
      </div>
    </div>
  </div>
  <!-- Sender name field -->
  <div style="padding:12px 24px;background:#F9FAFB;border-bottom:1px solid #F3F4F6;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <span style="font-size:0.75rem;font-weight:700;color:#374151">Sender Name:</span>
    <input id="outreach-sender" placeholder="e.g. Sarah from ${domain}" value="${window._autoSeoSenderName||''}" style="padding:7px 12px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.8rem;width:220px;outline:none;background:white" onchange="window._autoSeoSenderName=this.value">
    <span style="font-size:0.72rem;color:#9CA3AF">Used in personalised email signatures</span>
  </div>
  <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px">
    ${opps.map((opp, i) => {
      const or = orMap[i] || { status: 'not_started', emails: null };
      const statusKey = or.status || 'not_started';
      return `
    <div style="border:1.5px solid ${statusKey === 'secured' ? '#BBF7D0' : '#E5E7EB'};border-radius:14px;overflow:hidden;background:${statusKey === 'secured' ? '#F0FDF4' : 'white'}">
      <div style="padding:14px 18px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="toggleOutreachRow(${i})">
        <div style="flex-shrink:0;width:36px;height:36px;border-radius:9px;background:#F3F4F6;display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:800;color:#374151">DR<br>${opp.dr}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.88rem;font-weight:800;color:#111827">${opp.site}</div>
          <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">${opp.type} · ${opp.url}</div>
        </div>
        <span style="padding:4px 10px;border-radius:6px;font-size:0.68rem;font-weight:700;background:${statusBg[statusKey]};color:${statusColors[statusKey]}">${statuses[statusKey]}</span>
        <select onchange="setOutreachStatus(${i},this.value);event.stopPropagation()" style="padding:5px 8px;border:1px solid #E5E7EB;border-radius:7px;font-size:0.68rem;background:white;cursor:pointer">
          ${Object.entries(statuses).map(([k,v])=>`<option value="${k}" ${statusKey===k?'selected':''}>${v}</option>`).join('')}
        </select>
        ${!or.emails ? `<button onclick="generateOutreachSequence(${i});event.stopPropagation()" id="gen-seq-${i}" style="padding:6px 14px;background:linear-gradient(135deg,#0066FF,#0052CC);border:none;border-radius:8px;font-size:0.7rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">✍️ Generate Sequence</button>` : `<button onclick="toggleOutreachRow(${i})" style="padding:6px 14px;background:white;border:1px solid #E5E7EB;border-radius:8px;font-size:0.7rem;font-weight:700;color:#374151;cursor:pointer">View Emails ▾</button>`}
      </div>
      ${or.emails ? `
      <div id="outreach-emails-${i}" style="display:none;border-top:1px solid #F3F4F6;padding:16px 18px;background:#F9FAFB">
        <div style="display:flex;flex-direction:column;gap:12px">
          ${or.emails.map((e,ei)=>`
          <div style="background:white;border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div>
                <span style="font-size:0.7rem;font-weight:800;color:#0066FF;background:#EFF6FF;padding:2px 8px;border-radius:4px">${ei===0?'Email 1 — Day 0':ei===1?'Email 2 — Day 5 Follow-up':'Email 3 — Day 10 Final'}</span>
                <span style="font-size:0.75rem;font-weight:700;color:#111827;margin-left:8px">${e.subject}</span>
              </div>
              <button onclick="copyOutreachEmailText('${i}_${ei}')" style="padding:4px 10px;background:white;border:1px solid #E5E7EB;border-radius:7px;font-size:0.67rem;font-weight:700;color:#374151;cursor:pointer">📋 Copy</button>
            </div>
            <div id="email-body-${i}_${ei}" style="font-size:0.78rem;color:#374151;line-height:1.6;white-space:pre-wrap;background:#F9FAFB;padding:10px 12px;border-radius:8px">${e.body}</div>
          </div>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
    }).join('')}
  </div>
</div>`;
}

function toggleOutreachRow(i) {
  const el = document.getElementById('outreach-emails-' + i);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function setOutreachStatus(i, status) {
  if (!window._autoSeoOutreach) window._autoSeoOutreach = {};
  if (!window._autoSeoOutreach[i]) window._autoSeoOutreach[i] = { status: 'not_started', emails: null };
  window._autoSeoOutreach[i].status = status;
  if (status === 'secured') showToast('🎉 Link secured! Great work — this will boost your domain authority.');
  buildAutoSEO();
}

function copyOutreachEmailText(key) {
  const el = document.getElementById('email-body-' + key);
  if (!el) return;
  const parts = key.split('_');
  const i = parts[0], ei = parts[1];
  const or = window._autoSeoOutreach && window._autoSeoOutreach[i];
  if (!or || !or.emails || !or.emails[ei]) return;
  const subj = or.emails[ei].subject;
  const body = or.emails[ei].body;
  navigator.clipboard.writeText(`Subject: ${subj}\n\n${body}`).then(() => showToast('📋 Email copied to clipboard!'));
}

async function generateOutreachSequence(idx) {
  const opps = window._autoSeoBacklinks;
  if (!opps || !opps[idx]) return;
  const btn = document.getElementById('gen-seq-' + idx);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Writing…'; }
  const opp  = opps[idx];
  const ctx  = _autoSeoContext();
  const sender = window._autoSeoSenderName || document.getElementById('outreach-sender')?.value || 'The Team';
  try {
    const resp = await fetch('/api/generate-outreach-sequence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: opp.site, url: opp.url, type: opp.type, angle: opp.angle, domain: ctx.domain, industry: ctx.industry, senderName: sender })
    });
    const data = await resp.json();
    if (!window._autoSeoOutreach) window._autoSeoOutreach = {};
    if (!window._autoSeoOutreach[idx]) window._autoSeoOutreach[idx] = { status: 'not_started' };
    window._autoSeoOutreach[idx].emails = data.emails || [];
    showToast(`✅ 3-email sequence written for ${opp.site}!`);
  } catch(e) { showToast('❌ ' + e.message); }
  buildAutoSEO();
  // Auto-open the emails panel
  setTimeout(() => { const el = document.getElementById('outreach-emails-' + idx); if (el) el.style.display = 'block'; }, 100);
}

// ─── TAB 5: Traffic Intel ─────────────────────────────────────────────────────
function renderAutoSeoTraffic(domain, industry) {
  const td = window._autoSeoTraffic;
  const articlesCount = (window._autoSeoArticles || []).length;
  const backlinksCount = Object.values(window._autoSeoOutreach || {}).filter(o => o.status === 'secured').length;

  return `
<div style="display:flex;flex-direction:column;gap:18px">

  <!-- Header card -->
  <div style="background:var(--ig-grad);border-radius:16px;padding:22px 26px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px">
    <div>
      <div style="font-size:1.05rem;font-weight:800;color:white;margin-bottom:4px">📈 90-Day Traffic Intelligence</div>
      <div style="font-size:0.78rem;color:#93C5FD">AI-powered organic growth projections for <strong>${domain}</strong></div>
    </div>
    <button onclick="loadTrafficProjection()" id="traffic-gen-btn" style="padding:10px 22px;background:linear-gradient(135deg,#00E5FF,#0066FF);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">${td ? '🔄 Refresh Projection' : '📈 Generate Projection'}</button>
  </div>

  ${!td ? `
  <!-- Empty state -->
  <div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;padding:50px;text-align:center">
    <div style="font-size:3.5rem;margin-bottom:14px">📊</div>
    <div style="font-size:1.05rem;font-weight:800;color:#111827;margin-bottom:8px">Your Traffic Growth Forecast</div>
    <div style="font-size:0.82rem;color:#6B7280;max-width:440px;margin:0 auto 10px">Based on your content calendar (${articlesCount} articles) and backlinks (${backlinksCount} secured), InfoGenie projects your organic traffic growth over the next 90 days.</div>
    <div style="font-size:0.78rem;color:#9CA3AF;margin-bottom:24px">More articles written + more links secured = higher projections</div>
    <button onclick="loadTrafficProjection()" style="padding:12px 28px;background:linear-gradient(135deg,#0066FF,#0052CC);border:none;border-radius:10px;font-size:0.88rem;font-weight:700;color:white;cursor:pointer">📈 Generate My Traffic Forecast</button>
  </div>` : renderTrafficDashboard(td, domain, articlesCount, backlinksCount)}

  <!-- Google Search Console connection -->
  <div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;padding:20px 24px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <div style="width:36px;height:36px;border-radius:9px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;font-size:1.2rem">🔍</div>
      <div>
        <div style="font-size:0.9rem;font-weight:800;color:#111827">Connect Google Search Console</div>
        <div style="font-size:0.72rem;color:#6B7280">Import real impressions, clicks & keyword rankings for live data</div>
      </div>
      <span style="margin-left:auto;padding:4px 10px;background:#FEF3C7;border-radius:6px;font-size:0.67rem;font-weight:700;color:#D97706">Coming Soon</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
      ${[
        { icon:'📊', t:'Real Impressions', d:'Live data from Google instead of projections' },
        { icon:'🎯', t:'Actual Rankings', d:'See exactly where you rank for each keyword' },
        { icon:'📈', t:'Click-Through Rate', d:'Track how many searchers actually visit your site' },
      ].map(f=>`
      <div style="padding:12px;background:#F9FAFB;border-radius:10px;border:1px solid #E5E7EB">
        <div style="font-size:1.2rem;margin-bottom:6px">${f.icon}</div>
        <div style="font-size:0.78rem;font-weight:700;color:#111827;margin-bottom:3px">${f.t}</div>
        <div style="font-size:0.68rem;color:#6B7280">${f.d}</div>
      </div>`).join('')}
    </div>
  </div>

</div>`;
}

function renderTrafficDashboard(td, domain, articlesCount, backlinksCount) {
  const fmt = n => n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n||0);
  const pct = td.growth_pct_90d || 0;
  const months = td.monthly_breakdown || [];
  const maxTraffic = Math.max(...months.map(m => m.total_traffic || 0), td.projected_monthly_90d || 1);

  // Bar chart data
  const bars = [
    { label: 'Baseline',  val: td.baseline_monthly || 0,       color: '#E5E7EB' },
    { label: 'Month 1',   val: td.projected_monthly_30d || 0,  color: '#93C5FD' },
    { label: 'Month 2',   val: td.projected_monthly_60d || 0,  color: '#3B82F6' },
    { label: 'Month 3',   val: td.projected_monthly_90d || 0,  color: '#0066FF' },
  ];
  const maxVal = Math.max(...bars.map(b=>b.val), 1);

  return `
  <!-- KPI row -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
    ${[
      { icon:'👥', label:'Baseline Traffic', val: fmt(td.baseline_monthly), sub:'/month', color:'#374151', bg:'#F3F4F6' },
      { icon:'📈', label:'Projected (90d)', val: fmt(td.projected_monthly_90d), sub:'/month', color:'#0066FF', bg:'#EFF6FF' },
      { icon:'🚀', label:'Growth Forecast', val: '+'+pct+'%', sub:'in 90 days', color:'#059669', bg:'#F0FDF4' },
      { icon:'🔗', label:'DA Improvement', val: '+'+(td.da_improvement||'3-5'), sub:'points est.', color:'#0f766e', bg:'#F5F3FF' },
    ].map(s=>`
    <div style="background:white;border-radius:14px;border:1.5px solid #E5E7EB;padding:16px 18px;display:flex;align-items:center;gap:12px">
      <div style="width:40px;height:40px;border-radius:10px;background:${s.bg};display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">${s.icon}</div>
      <div>
        <div style="font-size:1.15rem;font-weight:800;color:${s.color}">${s.val}<span style="font-size:0.65rem;font-weight:600;color:#9CA3AF;margin-left:3px">${s.sub}</span></div>
        <div style="font-size:0.7rem;color:#6B7280;font-weight:600">${s.label}</div>
      </div>
    </div>`).join('')}
  </div>

  <!-- Traffic projection chart -->
  <div style="background:white;border-radius:16px;border:1.5px solid #E5E7EB;padding:22px 24px">
    <div style="font-size:0.9rem;font-weight:800;color:#111827;margin-bottom:18px">📊 90-Day Organic Traffic Projection</div>
    <div style="display:flex;align-items:flex-end;gap:16px;height:160px;padding:0 10px">
      ${bars.map(b=>{
        const h = Math.round((b.val / maxVal) * 140);
        return `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
          <div style="font-size:0.72rem;font-weight:700;color:#374151">${fmt(b.val)}</div>
          <div style="width:100%;height:${h}px;background:${b.color};border-radius:8px 8px 0 0;transition:height .3s;min-height:4px"></div>
          <div style="font-size:0.67rem;color:#6B7280;font-weight:600;text-align:center">${b.label}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:16px;padding:12px 14px;background:#F0FDF4;border-radius:10px;border:1px solid #BBF7D0;font-size:0.75rem;color:#065F46">
      <strong>🤖 AI Insight:</strong> Based on ${articlesCount} articles planned and ${backlinksCount} backlinks secured. ${td.top_opportunities?.[0]||'Focus on publishing consistently to compound your SEO gains.'}
    </div>
  </div>

  <!-- Two columns: keyword rankings + opportunities -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">

    <!-- Keyword rankings -->
    <div style="background:white;border-radius:14px;border:1.5px solid #E5E7EB;padding:18px 20px">
      <div style="font-size:0.88rem;font-weight:800;color:#111827;margin-bottom:14px">🎯 Keyword Ranking Forecast</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(td.keyword_rankings||[]).map(k=>{
          const imp = (k.current_position||50) - (k.projected_position_90d||30);
          return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#F9FAFB;border-radius:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:0.78rem;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${k.keyword}</div>
            <div style="font-size:0.65rem;color:#9CA3AF">${(k.monthly_volume||0).toLocaleString()} searches/mo</div>
          </div>
          <div style="text-align:center;min-width:36px">
            <div style="font-size:0.7rem;color:#9CA3AF">Now</div>
            <div style="font-size:0.82rem;font-weight:800;color:#374151">#${k.current_position||'50+'}</div>
          </div>
          <div style="font-size:0.9rem;color:#9CA3AF">→</div>
          <div style="text-align:center;min-width:36px">
            <div style="font-size:0.7rem;color:#9CA3AF">90d</div>
            <div style="font-size:0.82rem;font-weight:800;color:#059669">#${k.projected_position_90d||'20'}</div>
          </div>
          ${imp>0?`<span style="font-size:0.65rem;font-weight:700;color:#059669;background:#DCFCE7;padding:2px 6px;border-radius:4px">+${imp}</span>`:''}
        </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Opportunities -->
    <div style="background:white;border-radius:14px;border:1.5px solid #E5E7EB;padding:18px 20px">
      <div style="font-size:0.88rem;font-weight:800;color:#111827;margin-bottom:14px">💡 Top Growth Opportunities</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${(td.top_opportunities||[]).map((opp,i)=>`
        <div style="display:flex;gap:10px;padding:10px 12px;background:#F9FAFB;border-radius:10px;border-left:3px solid ${['#0066FF','#0f766e','#059669'][i]}">
          <span style="font-size:1rem;flex-shrink:0">${['🚀','🔗','📝'][i]}</span>
          <div style="font-size:0.78rem;color:#374151;line-height:1.5">${opp}</div>
        </div>`).join('')}
      </div>
      <div style="margin-top:14px;padding:12px;background:#FFF7ED;border-radius:10px;border:1px solid #FED7AA">
        <div style="font-size:0.72rem;font-weight:700;color:#92400E;margin-bottom:4px">📅 Recommended Action Plan</div>
        <div style="font-size:0.7rem;color:#B45309;line-height:1.5">
          Week 1–2: Publish first 8 articles from your calendar<br>
          Week 2–4: Send outreach sequences to top 3 backlink targets<br>
          Month 2: Add generated articles to Social Calendar<br>
          Month 3: Review rankings, refresh top-performing content
        </div>
      </div>
    </div>

  </div>`;
}

async function loadTrafficProjection() {
  const btn = document.getElementById('traffic-gen-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analysing…'; }
  const ctx = _autoSeoContext();
  const kws = window._autoSeoKeywords || [];
  const articlesCount = (window._autoSeoArticles||[]).length;
  const backlinksCount = Object.values(window._autoSeoOutreach||{}).filter(o=>o.status==='secured').length;
  try {
    const resp = await fetch('/api/traffic-projection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: ctx.domain, industry: ctx.industry, articlesPublished: articlesCount, backlinksSecured: backlinksCount, keywords: kws })
    });
    const data = await resp.json();
    window._autoSeoTraffic = data;
    showToast('📈 Traffic projection generated!');
  } catch(e) { showToast('❌ ' + e.message); }
  finally { buildAutoSEO(); }
}

/* ── re-export public entry points on window (onclick / index.html / app.js) ── */
window.toggleManualCompPanel = toggleManualCompPanel;
window.addManualCompetitor = addManualCompetitor;
window.removeManualCompetitor = removeManualCompetitor;
window.launchNow = launchNow;
window.publishNowFromCal = publishNowFromCal;
window.calEditArticle = calEditArticle;
window.calSaveEdit = calSaveEdit;
window.calDeleteArticle = calDeleteArticle;
window.showAutoSeoCalendar = showAutoSeoCalendar;
window.buildAutoSEO = buildAutoSEO;
window._artDate = _artDate;
window.saveAutoSeoDomain = saveAutoSeoDomain;
window.previewGeneratedArticle = previewGeneratedArticle;
window.addKeywordsToCalendar = addKeywordsToCalendar;
window.copyKeywordsCSV = copyKeywordsCSV;
window.copyOutreachEmail = copyOutreachEmail;
window.addArticleToSocialCalendar = addArticleToSocialCalendar;
window.addAllGeneratedToSocialCalendar = addAllGeneratedToSocialCalendar;
window.saveAutoSeoSettings = saveAutoSeoSettings;
window.toggleOutreachRow = toggleOutreachRow;
window.setOutreachStatus = setOutreachStatus;
window.copyOutreachEmailText = copyOutreachEmailText;
window.generateArticleTopics = generateArticleTopics;
window.generateSingleArticle = generateSingleArticle;
window.publishSingleArticle = publishSingleArticle;
window.publishAllToWordPress = publishAllToWordPress;
window.runArticleFactCheck = runArticleFactCheck;
window.runArticleAutoCorrect = runArticleAutoCorrect;
window.loadBacklinkOpps = loadBacklinkOpps;
window.loadKeywordResearch = loadKeywordResearch;
window.generateOutreachSequence = generateOutreachSequence;
window.loadTrafficProjection = loadTrafficProjection;
})();
