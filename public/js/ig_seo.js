// ============================================================================
// ig_seo.js — SEO view-builders extracted from app.js (Task: app.js split)
// Tiers: T22 On-Page Auditor · T29 Multi-Page Crawler · T30 GEO Audit ·
//        Local SEO · Social/OG Tags. Plain global script; loaded after app.js.
// Public entry points: window.buildSeoAuditor / buildSeoCrawler / buildGeoAudit
//                      / buildLocalSeo / buildSocialTags
// Moved verbatim — see public/js/README.md and appjs-split-convention.md.
// ============================================================================
// ============================================================================
// Local numeric helper (mirrors ig_intel_pack_a.js — not exposed on window)
// ============================================================================
function _n(x, d) { const v = Number(x); return Number.isFinite(v) ? Math.round(v) : (d || 0); }

// ============================================================================
// SEO ON-PAGE AUDITOR (Tier 22)
// ============================================================================
window.buildSeoAuditor = function() {
  const wrap = document.getElementById('seoWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:3fr 1fr;gap:10px;align-items:end">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">URL TO AUDIT</label>
          <input id="seoUrl" placeholder="https://yoursite.com/page" style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.86rem;box-sizing:border-box"></div>
        <div><button id="seoGo" style="width:100%;background:linear-gradient(135deg,#10B981,#0066FF);color:#fff;border:none;padding:10px 16px;border-radius:6px;font-size:0.86rem;font-weight:800;cursor:pointer">🧭 Run Audit</button></div>
      </div>
    </div>
    <div id="seoOut"></div>
  `;
  document.getElementById('seoGo').addEventListener('click', async () => {
    let url = document.getElementById('seoUrl').value.trim();
    if (!url) { document.getElementById('seoOut').innerHTML = '<div style="color:#991B1B">⚠ Enter a URL</div>'; return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const out = document.getElementById('seoOut');
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Fetching page + running 19 checks (5-15s)…</div>';
    try {
      const r = await fetch('/api/seo-auditor/audit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const gradeColor = { A:'#10B981', B:'#0E9F6E', C:'#F59E0B', D:'#F97316', F:'#EF4444' }[r.grade] || '#6B7280';
      const statusColor = { pass:'#10B981', warn:'#F59E0B', fail:'#EF4444' };
      const statusIcon = { pass:'✓', warn:'⚠', fail:'✗' };
      const sorted = [...r.checks].sort((a,b) => {
        const order = { fail:0, warn:1, pass:2 };
        return order[a.status] - order[b.status] || b.weight - a.weight;
      });
      out.innerHTML = `
        <div style="background:linear-gradient(135deg,${gradeColor},${gradeColor}dd);color:#fff;border-radius:14px;padding:24px;margin-bottom:18px;display:grid;grid-template-columns:auto 1fr auto;gap:24px;align-items:center">
          <div style="text-align:center"><div style="font-size:4rem;font-weight:800;line-height:1">${r.score}</div><div style="font-size:0.78rem;opacity:.85;font-weight:700;letter-spacing:1px">/ 100</div></div>
          <div>
            <div style="font-size:1.6rem;font-weight:800;margin-bottom:4px">Grade ${r.grade}</div>
            <div style="font-size:0.86rem;opacity:.95;margin-bottom:8px">${_escapeHtml(r.url)}</div>
            <div style="display:flex;gap:18px;font-size:0.84rem;opacity:.95">
              <span>✓ ${_n(r.summary.passed)} passed</span>
              <span>⚠ ${_n(r.summary.warned)} warnings</span>
              <span>✗ ${_n(r.summary.failed)} failed</span>
            </div>
          </div>
          ${r.runId ? `<button id="seoToTasks" data-run="${r.runId}" style="background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.5);padding:10px 16px;border-radius:8px;font-size:0.84rem;font-weight:800;cursor:pointer;white-space:nowrap">📋 Add to Task Manager</button>` : ''}
        </div>
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px 18px;margin-bottom:14px">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;font-size:0.78rem">
            <div><span style="color:#6B7280;font-weight:700">TITLE</span><div style="color:#0A1628">${_escapeHtml((r.summary.title||'').slice(0, 80) || '(missing)')}</div></div>
            <div><span style="color:#6B7280;font-weight:700">H1 COUNT</span><div style="color:#0A1628">${_n(r.summary.h1Count)}</div></div>
            <div><span style="color:#6B7280;font-weight:700">WORDS</span><div style="color:#0A1628">${_n(r.summary.words)}</div></div>
            <div><span style="color:#6B7280;font-weight:700">IMAGES</span><div style="color:#0A1628">${_n(r.summary.imgCount)}</div></div>
          </div>
        </div>
        <div style="display:grid;gap:10px">${sorted.map(c => `
          <div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${statusColor[c.status]};border-radius:10px;padding:12px 16px">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:4px">
              <strong style="color:#0A1628;font-size:0.9rem"><span style="color:${statusColor[c.status]};margin-right:6px;font-weight:800">${statusIcon[c.status]}</span>${_escapeHtml(c.label)}</strong>
              <span style="font-size:0.7rem;color:#9CA3AF">${c.earned}/${c.weight} pts</span>
            </div>
            <div style="font-size:0.82rem;color:#374151;margin-left:20px">${_escapeHtml(c.message)}</div>
            ${c.status !== 'pass' ? `<div style="font-size:0.78rem;color:#7C3AED;margin-top:4px;margin-left:20px"><strong>Fix:</strong> ${_escapeHtml(c.fix)}</div>` : ''}
          </div>`).join('')}</div>`;
      const btn = document.getElementById('seoToTasks');
      if (btn) btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = '⏳ Importing…';
        const j = await fetch('/api/seo-tasks/import-from-audit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ auditRunId: parseInt(btn.getAttribute('data-run'),10) }) }).then(x=>x.json()).catch(e=>({ok:false,error:e.message}));
        btn.disabled = false;
        if (!j.ok) { btn.textContent = '⚠ ' + j.error.slice(0, 30); return; }
        btn.textContent = `✓ ${j.created} added${j.skipped?` · ${j.skipped} dup`:''}`;
        btn.style.background = 'rgba(255,255,255,.35)';
      });
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// EMBEDDABLE SEO WIDGET (Tier 23) — manage sites + view leads + copy embed snippet
// ============================================================================
window.buildSeoWidget = function() {
  const wrap = document.getElementById('swWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 12px;font-size:1rem;color:#0A1628">➕ Create a new widget</h3>
      <div style="display:grid;grid-template-columns:2fr 1fr 2fr 2fr 1fr;gap:10px;align-items:end">
        <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:3px">SITE NAME</label><input id="swName" placeholder="My Agency" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:3px">ACCENT</label><input id="swAccent" type="color" value="#0066FF" style="width:100%;height:35px;padding:2px;border:1px solid #D1D5DB;border-radius:5px;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:3px">CTA TEXT</label><input id="swCta" value="Get my free SEO audit" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:3px">YOUR EMAIL (opt.)</label><input id="swOwner" placeholder="you@agency.com" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
        <div><button id="swCreate" style="width:100%;background:linear-gradient(135deg,#7C3AED,#0066FF);color:#fff;border:none;padding:9px 14px;border-radius:6px;font-size:0.82rem;font-weight:800;cursor:pointer">Create</button></div>
      </div>
    </div>
    <div id="swList"></div>
  `;
  document.getElementById('swCreate').addEventListener('click', async () => {
    const name = document.getElementById('swName').value.trim();
    const accent = document.getElementById('swAccent').value;
    const ctaText = document.getElementById('swCta').value.trim();
    const ownerEmail = document.getElementById('swOwner').value.trim();
    if (!name) { alert('Site name required'); return; }
    const r = await fetch('/api/seo-widget/sites', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, accent, ctaText, ownerEmail }) }).then(x => x.json());
    if (!r.ok) { alert(r.error); return; }
    document.getElementById('swName').value = '';
    _swLoad();
  });
  function _swLoad() {
    fetch('/api/seo-widget/sites').then(x => x.json()).then(j => {
      const list = document.getElementById('swList');
      if (!j.ok || !j.sites.length) { list.innerHTML = '<div style="color:#9CA3AF;text-align:center;padding:30px">No widgets yet — create your first one above.</div>'; return; }
      const origin = window.location.origin;
      list.innerHTML = j.sites.map(s => {
        const snippet = `<div id="infogenie-seo-widget"></div>\n<script src="${origin}/api/seo-widget/embed/${s.id}.js" async></script>`;
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;margin-bottom:12px">
            <div>
              <h3 style="margin:0;font-size:1.04rem;color:#0A1628">${_escapeHtml(s.name)} <span style="background:${_escapeHtml(s.accent)};display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:middle;margin-left:6px"></span></h3>
              <div style="font-size:0.74rem;color:#6B7280;margin-top:3px">ID: <code style="font-size:0.72rem">${_escapeHtml(s.id)}</code> · ${_n(s.lead_count)} leads captured</div>
            </div>
            <div style="display:flex;gap:6px">
              <button data-id="${_escapeHtml(s.id)}" class="swViewLeads" style="background:#fff;border:1px solid #D1D5DB;color:#374151;padding:6px 12px;border-radius:5px;font-size:0.76rem;font-weight:700;cursor:pointer">👥 Leads (${_n(s.lead_count)})</button>
              <button data-id="${_escapeHtml(s.id)}" class="swDel" style="background:#fff;border:1px solid #FCA5A5;color:#B91C1C;padding:6px 12px;border-radius:5px;font-size:0.76rem;font-weight:700;cursor:pointer">🗑</button>
            </div>
          </div>
          <div style="font-size:0.72rem;color:#6B7280;font-weight:700;margin-bottom:5px">📋 EMBED SNIPPET — paste anywhere on your marketing site</div>
          <pre style="background:#0F172A;color:#A7F3D0;padding:12px;border-radius:8px;font-size:0.74rem;line-height:1.5;overflow-x:auto;margin:0"><code>${_escapeHtml(snippet)}</code></pre>
          <button data-snippet="${_escapeHtml(snippet)}" class="swCopy" style="background:#0066FF;color:#fff;border:none;padding:6px 14px;border-radius:5px;font-size:0.76rem;font-weight:700;cursor:pointer;margin-top:8px">📋 Copy snippet</button>
          <div id="leads-${_escapeHtml(s.id)}" style="margin-top:14px"></div>
        </div>`;
      }).join('');
      list.querySelectorAll('.swCopy').forEach(b => b.addEventListener('click', e => {
        navigator.clipboard.writeText(e.currentTarget.getAttribute('data-snippet') || '').then(() => {
          const o = e.currentTarget.textContent; e.currentTarget.textContent = '✓ Copied'; setTimeout(() => { e.currentTarget.textContent = o; }, 1500);
        });
      }));
      list.querySelectorAll('.swDel').forEach(b => b.addEventListener('click', async e => {
        if (!confirm('Delete this widget? Leads will be removed too.')) return;
        await fetch(`/api/seo-widget/sites/${e.currentTarget.getAttribute('data-id')}`, { method:'DELETE' });
        _swLoad();
      }));
      list.querySelectorAll('.swViewLeads').forEach(b => b.addEventListener('click', async e => {
        const id = e.currentTarget.getAttribute('data-id');
        const target = document.getElementById('leads-' + id);
        const r = await fetch(`/api/seo-widget/sites/${id}/leads`).then(x => x.json());
        if (!r.ok || !r.leads.length) { target.innerHTML = '<div style="color:#9CA3AF;font-size:0.78rem;padding:8px">No leads yet.</div>'; return; }
        target.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:0.78rem">
          <thead><tr style="background:#F9FAFB"><th style="padding:6px;text-align:left;border-bottom:1px solid #E5E7EB">Email</th><th style="padding:6px;text-align:left;border-bottom:1px solid #E5E7EB">URL Audited</th><th style="padding:6px;text-align:left;border-bottom:1px solid #E5E7EB">Score</th><th style="padding:6px;text-align:left;border-bottom:1px solid #E5E7EB">When</th></tr></thead>
          <tbody>${r.leads.map(l => `<tr><td style="padding:6px;border-bottom:1px solid #F3F4F6">${_escapeHtml(l.email)}</td><td style="padding:6px;border-bottom:1px solid #F3F4F6"><a href="${_safeUrl(l.url)}" target="_blank" rel="noopener" style="color:#0066FF;text-decoration:none">${_escapeHtml(l.url.slice(0, 50))}↗</a></td><td style="padding:6px;border-bottom:1px solid #F3F4F6"><strong>${_n(l.score)}</strong> · ${_escapeHtml(l.grade)}</td><td style="padding:6px;border-bottom:1px solid #F3F4F6">${new Date(l.created_at).toLocaleDateString()}</td></tr>`).join('')}</tbody>
        </table>`;
      }));
    }).catch(() => {});
  }
  _swLoad();
};

// ============================================================================
// SEO TASK MANAGER (Tier 24)
// ============================================================================
window.buildSeoTasks = function() {
  const wrap = document.getElementById('seoTasksWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div id="stStats" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px"></div>
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px;margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:end">
      <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:3px">STATUS</label>
        <select id="stFltStatus" style="padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem">
          <option value="">All</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="snoozed">Snoozed</option><option value="done">Done</option><option value="wont_fix">Won't fix</option>
        </select></div>
      <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:3px">PRIORITY</label>
        <select id="stFltPri" style="padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem">
          <option value="">All</option><option value="1">P1 (high)</option><option value="2">P2 (med)</option><option value="3">P3 (low)</option>
        </select></div>
      <div style="flex:1;min-width:160px"><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:3px">URL CONTAINS</label>
        <input id="stFltUrl" placeholder="example.com" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
      <button id="stApply" style="background:#0066FF;color:#fff;border:none;padding:8px 16px;border-radius:5px;font-size:0.82rem;font-weight:800;cursor:pointer">Filter</button>
      <div style="flex:1"></div>
      <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:3px">RE-AUDIT URL</label>
        <input id="stReUrl" placeholder="https://yoursite.com" style="padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;width:240px;box-sizing:border-box"></div>
      <button id="stReGo" style="background:linear-gradient(135deg,#10B981,#0066FF);color:#fff;border:none;padding:8px 16px;border-radius:5px;font-size:0.82rem;font-weight:800;cursor:pointer">🔄 Re-audit & auto-close</button>
    </div>
    <div id="stList"></div>
  `;
  const $ = id => document.getElementById(id);
  const PRI = { 1:{label:'P1',color:'#EF4444'}, 2:{label:'P2',color:'#F59E0B'}, 3:{label:'P3',color:'#9CA3AF'} };
  const STATUS_OPTS = [['open','Open'],['in_progress','In progress'],['snoozed','Snoozed'],['done','Done'],['wont_fix',"Won't fix"]];

  function loadStats() {
    fetch('/api/seo-tasks/stats').then(x=>x.json()).then(j => {
      if (!j.ok) return;
      const s = j.stats;
      const card = (label, n, color) => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:12px;text-align:center"><div style="font-size:1.6rem;font-weight:800;color:${color}">${_n(n||0)}</div><div style="font-size:0.7rem;color:#6B7280;font-weight:700;margin-top:2px">${label}</div></div>`;
      $('stStats').innerHTML = card('OPEN', s.open, '#EF4444') + card('IN PROGRESS', s.in_progress, '#F59E0B') + card('SNOOZED', s.snoozed, '#9CA3AF') + card('DONE', s.done, '#10B981') + card('TOTAL', s.total, '#0A1628');
    }).catch(()=>{});
  }
  function load() {
    const q = new URLSearchParams();
    if ($('stFltStatus').value) q.set('status', $('stFltStatus').value);
    if ($('stFltPri').value) q.set('priority', $('stFltPri').value);
    if ($('stFltUrl').value) q.set('url', $('stFltUrl').value);
    fetch('/api/seo-tasks/list?' + q.toString()).then(x=>x.json()).then(j => {
      if (!j.ok) { $('stList').innerHTML = '<div style="color:#B91C1C">'+_escapeHtml(j.error)+'</div>'; return; }
      if (!j.tasks.length) { $('stList').innerHTML = '<div style="color:#9CA3AF;text-align:center;padding:30px;background:#fff;border-radius:10px">No tasks yet. Run an audit and click <strong>📋 Add to Task Manager</strong>.</div>'; return; }
      $('stList').innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
          <thead><tr style="background:#F9FAFB">
            <th style="padding:10px;text-align:left;border-bottom:1px solid #E5E7EB;width:50px">P</th>
            <th style="padding:10px;text-align:left;border-bottom:1px solid #E5E7EB">Issue</th>
            <th style="padding:10px;text-align:left;border-bottom:1px solid #E5E7EB">URL</th>
            <th style="padding:10px;text-align:left;border-bottom:1px solid #E5E7EB;width:130px">Status</th>
            <th style="padding:10px;text-align:left;border-bottom:1px solid #E5E7EB;width:140px">Assignee</th>
            <th style="padding:10px;text-align:left;border-bottom:1px solid #E5E7EB;width:120px">Due</th>
            <th style="padding:10px;text-align:left;border-bottom:1px solid #E5E7EB;width:50px"></th>
          </tr></thead>
          <tbody>${j.tasks.map(t => {
            const p = PRI[t.priority] || PRI[3];
            const isClosed = t.status === 'done' || t.status === 'wont_fix';
            return `<tr data-id="${t.id}" style="${isClosed?'opacity:0.55':''}">
              <td style="padding:10px;border-bottom:1px solid #F3F4F6"><span style="background:${p.color};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:800">${p.label}</span></td>
              <td style="padding:10px;border-bottom:1px solid #F3F4F6"><strong style="color:#0A1628">${_escapeHtml(t.label)}</strong><div style="font-size:0.74rem;color:#6B7280;margin-top:2px">${_escapeHtml((t.message||'').slice(0,120))}</div>${t.fix?`<div style="font-size:0.72rem;color:#7C3AED;margin-top:2px"><strong>Fix:</strong> ${_escapeHtml(t.fix.slice(0,140))}</div>`:''}</td>
              <td style="padding:10px;border-bottom:1px solid #F3F4F6"><a href="${_safeUrl(t.source_url)}" target="_blank" rel="noopener" style="color:#0066FF;text-decoration:none;font-size:0.78rem">${_escapeHtml((t.source_url||'').slice(0,40))}↗</a></td>
              <td style="padding:10px;border-bottom:1px solid #F3F4F6"><select class="stStatus" style="width:100%;padding:5px;border:1px solid #D1D5DB;border-radius:4px;font-size:0.76rem">${STATUS_OPTS.map(([v,l]) => `<option value="${v}"${t.status===v?' selected':''}>${l}</option>`).join('')}</select></td>
              <td style="padding:10px;border-bottom:1px solid #F3F4F6"><input class="stAssignee" value="${_escapeHtml(t.assignee||'')}" placeholder="—" style="width:100%;padding:5px;border:1px solid #D1D5DB;border-radius:4px;font-size:0.76rem;box-sizing:border-box"></td>
              <td style="padding:10px;border-bottom:1px solid #F3F4F6"><input type="date" class="stDue" value="${t.due_date?String(t.due_date).slice(0,10):''}" style="padding:5px;border:1px solid #D1D5DB;border-radius:4px;font-size:0.76rem"></td>
              <td style="padding:10px;border-bottom:1px solid #F3F4F6"><button class="stDel" style="background:none;border:none;color:#B91C1C;cursor:pointer;font-size:1rem">🗑</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`;
      // Wire up edits
      $('stList').querySelectorAll('tr[data-id]').forEach(tr => {
        const id = tr.getAttribute('data-id');
        const patch = body => fetch('/api/seo-tasks/' + id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(()=>loadStats());
        tr.querySelector('.stStatus').addEventListener('change', e => { patch({ status: e.target.value }); tr.style.opacity = (e.target.value==='done'||e.target.value==='wont_fix') ? 0.55 : 1; });
        tr.querySelector('.stAssignee').addEventListener('change', e => patch({ assignee: e.target.value }));
        tr.querySelector('.stDue').addEventListener('change', e => patch({ dueDate: e.target.value || null }));
        tr.querySelector('.stDel').addEventListener('click', () => { if (!confirm('Delete this task?')) return; fetch('/api/seo-tasks/' + id, { method:'DELETE' }).then(() => { load(); loadStats(); }); });
      });
    }).catch(e => { $('stList').innerHTML = '<div style="color:#B91C1C">'+_escapeHtml(e.message)+'</div>'; });
  }
  $('stApply').addEventListener('click', load);
  $('stReGo').addEventListener('click', async () => {
    let url = $('stReUrl').value.trim(); if (!url) { alert('Enter a URL to re-audit'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    $('stReGo').disabled = true; $('stReGo').textContent = '⏳ Auditing…';
    const r = await fetch('/api/seo-tasks/reaudit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) }).then(x => x.json()).catch(e => ({ ok:false, error:e.message }));
    $('stReGo').disabled = false; $('stReGo').textContent = '🔄 Re-audit & auto-close';
    if (!r.ok) { alert(r.error); return; }
    alert(`✓ New score: ${r.score}/100 (${r.grade})\nAuto-closed: ${r.autoClosed} task(s)\nNewly imported: ${r.imported} task(s)`);
    load(); loadStats();
  });
  loadStats(); load();
};

// ============================================================================
// SCHEMA.ORG / JSON-LD GENERATOR (Tier 25)
// ============================================================================
window.buildSchemaGenerator = function() {
  const wrap = document.getElementById('sgWrap'); if (!wrap) return;
  wrap.innerHTML = '<div style="color:#9CA3AF">Loading schema types…</div>';
  fetch('/api/schema-generator/types').then(x=>x.json()).then(j => {
    if (!j.ok) { wrap.innerHTML = '<div style="color:#B91C1C">'+_escapeHtml(j.error||'load failed')+'</div>'; return; }
    const TYPES = j.types;
    const typeKeys = Object.keys(TYPES);
    wrap.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
        <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:6px">SCHEMA TYPE</label>
        <div id="sgTypeBar" style="display:flex;gap:8px;flex-wrap:wrap"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <h3 style="margin:0 0 12px;font-size:1rem;color:#0A1628">📝 Fields</h3>
          <div id="sgForm"></div>
          <div style="margin-top:14px;display:flex;gap:8px">
            <input id="sgName" placeholder="Block name (for saving)" style="flex:1;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
            <button id="sgSave" style="background:linear-gradient(135deg,#7C3AED,#0066FF);color:#fff;border:none;padding:8px 16px;border-radius:5px;font-size:0.82rem;font-weight:800;cursor:pointer">💾 Save</button>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0;font-size:1rem;color:#0A1628">📋 JSON-LD output</h3>
            <button id="sgCopy" style="background:#0066FF;color:#fff;border:none;padding:6px 14px;border-radius:5px;font-size:0.78rem;font-weight:700;cursor:pointer">📋 Copy</button>
          </div>
          <pre id="sgOut" style="background:#0F172A;color:#A7F3D0;padding:14px;border-radius:8px;font-size:0.74rem;line-height:1.5;overflow:auto;max-height:480px;margin:0"><code>Pick a type to start →</code></pre>
        </div>
      </div>
      <div style="margin-top:24px"><h3 style="font-size:0.94rem;color:#374151;margin-bottom:10px">💾 Saved blocks</h3><div id="sgSaved"></div></div>
    `;
    const $ = id => document.getElementById(id);
    let currentType = typeKeys[0];

    $('sgTypeBar').innerHTML = typeKeys.map(t => `<button data-t="${t}" class="sgType" style="background:#fff;border:1px solid #D1D5DB;color:#374151;padding:7px 14px;border-radius:18px;font-size:0.8rem;font-weight:700;cursor:pointer">${_escapeHtml(TYPES[t].label||t)}</button>`).join('');
    function selectType(t) {
      currentType = t;
      $('sgTypeBar').querySelectorAll('.sgType').forEach(b => {
        const sel = b.getAttribute('data-t')===t;
        b.style.background = sel ? '#0066FF' : '#fff';
        b.style.color = sel ? '#fff' : '#374151';
        b.style.borderColor = sel ? '#0066FF' : '#D1D5DB';
      });
      renderForm();
    }
    function fieldInput(f, value, prefix='') {
      const id = `sgf_${prefix}${f.key}`;
      const v = value == null ? '' : value;
      const req = f.required ? '<span style="color:#EF4444">*</span>' : '';
      const help = f.help ? `<div style="font-size:0.7rem;color:#9CA3AF;margin-top:2px">${_escapeHtml(f.help)}</div>` : '';
      if (f.kind === 'textarea') return `<div style="margin-bottom:10px"><label style="display:block;font-size:0.72rem;font-weight:700;color:#6B7280;margin-bottom:3px">${_escapeHtml(f.key)} ${req}</label><textarea id="${id}" rows="2" placeholder="${_escapeHtml(f.placeholder||'')}" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box;font-family:inherit;resize:vertical">${_escapeHtml(v)}</textarea>${help}</div>`;
      if (f.kind === 'date')   return `<div style="margin-bottom:10px"><label style="display:block;font-size:0.72rem;font-weight:700;color:#6B7280;margin-bottom:3px">${_escapeHtml(f.key)} ${req}</label><input id="${id}" type="date" value="${_escapeHtml(v)}" style="padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem">${help}</div>`;
      if (f.kind === 'number') return `<div style="margin-bottom:10px"><label style="display:block;font-size:0.72rem;font-weight:700;color:#6B7280;margin-bottom:3px">${_escapeHtml(f.key)} ${req}</label><input id="${id}" type="number" step="any" value="${_escapeHtml(v)}" placeholder="${_escapeHtml(f.placeholder||'')}" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box">${help}</div>`;
      // text/url/email/tel
      return `<div style="margin-bottom:10px"><label style="display:block;font-size:0.72rem;font-weight:700;color:#6B7280;margin-bottom:3px">${_escapeHtml(f.key)} ${req}</label><input id="${id}" type="${f.kind==='url'?'url':f.kind==='email'?'email':f.kind==='tel'?'tel':'text'}" value="${_escapeHtml(v)}" placeholder="${_escapeHtml(f.placeholder||'')}" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box">${help}</div>`;
    }
    function renderForm() {
      const def = TYPES[currentType];
      const html = def.fields.map(f => {
        if (f.kind === 'repeat') {
          // repeat group — initial 1 row
          const subs = f.subFields || [{ key: f.subKey || 'value', kind: 'text', placeholder: f.placeholder || '' }];
          return `<div style="margin-bottom:14px;border:1px dashed #D1D5DB;border-radius:8px;padding:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong style="font-size:0.78rem;color:#374151">${_escapeHtml(f.key)} ${f.required?'<span style="color:#EF4444">*</span>':''}</strong>
              <button data-key="${f.key}" data-subs='${JSON.stringify(subs).replace(/'/g, "&apos;")}' class="sgAddRow" style="background:#10B981;color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:0.74rem;font-weight:700;cursor:pointer">+ Add row</button>
            </div>
            <div id="sgRep_${f.key}" data-subs='${JSON.stringify(subs).replace(/'/g, "&apos;")}'></div>
            ${f.help?`<div style="font-size:0.7rem;color:#9CA3AF;margin-top:4px">${_escapeHtml(f.help)}</div>`:''}
          </div>`;
        }
        return fieldInput(f, '');
      }).join('');
      $('sgForm').innerHTML = html;
      // Add an initial row to each repeat group
      def.fields.filter(f => f.kind === 'repeat').forEach(f => addRepeatRow(f.key, f.subFields || [{ key: f.subKey || 'value', kind: 'text', placeholder: f.placeholder || '' }]));
      $('sgForm').querySelectorAll('.sgAddRow').forEach(b => b.addEventListener('click', e => {
        const key = e.currentTarget.getAttribute('data-key');
        const subs = JSON.parse(e.currentTarget.getAttribute('data-subs').replace(/&apos;/g, "'"));
        addRepeatRow(key, subs);
      }));
      // Live regenerate on every input
      $('sgForm').addEventListener('input', regen);
      regen();
    }
    function addRepeatRow(key, subs) {
      const container = document.getElementById('sgRep_' + key);
      const idx = container.children.length;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:start';
      row.innerHTML = subs.map(s => {
        const inputId = `sgrep_${key}_${idx}_${s.key}`;
        if (s.kind === 'textarea') return `<textarea data-key="${s.key}" id="${inputId}" rows="2" placeholder="${_escapeHtml(s.placeholder||s.key)}" style="flex:1;padding:6px;border:1px solid #D1D5DB;border-radius:4px;font-size:0.78rem;font-family:inherit;resize:vertical"></textarea>`;
        return `<input data-key="${s.key}" id="${inputId}" type="${s.kind==='url'?'url':'text'}" placeholder="${_escapeHtml(s.placeholder||s.key)}" style="flex:1;padding:6px;border:1px solid #D1D5DB;border-radius:4px;font-size:0.78rem">`;
      }).join('') + '<button class="sgRmRow" style="background:none;border:none;color:#B91C1C;cursor:pointer;font-size:1rem">×</button>';
      container.appendChild(row);
      row.querySelector('.sgRmRow').addEventListener('click', () => { row.remove(); regen(); });
    }
    function collect() {
      const def = TYPES[currentType];
      const fields = {};
      def.fields.forEach(f => {
        if (f.kind === 'repeat') {
          const container = document.getElementById('sgRep_' + f.key);
          const subs = f.subFields || [{ key: f.subKey || 'value' }];
          const rows = Array.from(container.children).map(row => {
            if (subs.length === 1) {
              const inp = row.querySelector('[data-key]'); return inp ? inp.value.trim() : '';
            }
            const obj = {};
            row.querySelectorAll('[data-key]').forEach(inp => { obj[inp.getAttribute('data-key')] = inp.value.trim(); });
            return obj;
          }).filter(v => v && (typeof v === 'string' ? v : Object.values(v).some(x => x)));
          if (rows.length) fields[f.key] = rows;
        } else {
          const v = (document.getElementById('sgf_' + f.key)?.value || '').trim();
          if (v) fields[f.key] = v;
        }
      });
      return fields;
    }
    function regen() {
      const fields = collect();
      fetch('/api/schema-generator/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type: currentType, fields }) })
        .then(x => x.json()).then(j => {
          if (!j.ok) { $('sgOut').innerHTML = '<code style="color:#FCA5A5">'+_escapeHtml(j.error)+'</code>'; return; }
          $('sgOut').innerHTML = '<code>' + _escapeHtml(j.jsonld) + '</code>';
        }).catch(e => { $('sgOut').innerHTML = '<code style="color:#FCA5A5">'+_escapeHtml(e.message)+'</code>'; });
    }
    function loadSaved() {
      fetch('/api/schema-generator/list').then(x=>x.json()).then(j => {
        if (!j.ok) return;
        if (!j.blocks.length) { $('sgSaved').innerHTML = '<div style="color:#9CA3AF;font-size:0.82rem">No saved blocks yet.</div>'; return; }
        $('sgSaved').innerHTML = j.blocks.map(b => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
          <div><strong>${_escapeHtml(b.name)}</strong> <span style="background:#EEF2FF;color:#4338CA;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;margin-left:6px">${_escapeHtml(b.type)}</span><div style="font-size:0.7rem;color:#9CA3AF;margin-top:2px">${new Date(b.created_at).toLocaleString()}</div></div>
          <div style="display:flex;gap:6px"><button data-b='${JSON.stringify(b.jsonld).replace(/'/g, "&apos;")}' class="sgCopySaved" style="background:#0066FF;color:#fff;border:none;padding:5px 10px;border-radius:4px;font-size:0.74rem;font-weight:700;cursor:pointer">📋 Copy</button><button data-id="${b.id}" class="sgDel" style="background:none;border:1px solid #FCA5A5;color:#B91C1C;padding:5px 10px;border-radius:4px;font-size:0.74rem;font-weight:700;cursor:pointer">🗑</button></div>
        </div>`).join('');
        $('sgSaved').querySelectorAll('.sgCopySaved').forEach(b => b.addEventListener('click', e => {
          const text = JSON.parse(e.currentTarget.getAttribute('data-b').replace(/&apos;/g, "'"));
          navigator.clipboard.writeText(text); const o = e.currentTarget.textContent; e.currentTarget.textContent = '✓'; setTimeout(()=>e.currentTarget.textContent=o, 1500);
        }));
        $('sgSaved').querySelectorAll('.sgDel').forEach(b => b.addEventListener('click', async e => {
          if (!confirm('Delete this saved block?')) return;
          await fetch('/api/schema-generator/' + e.currentTarget.getAttribute('data-id'), { method:'DELETE' });
          loadSaved();
        }));
      });
    }
    $('sgCopy').addEventListener('click', () => {
      const text = $('sgOut').textContent || '';
      navigator.clipboard.writeText(text).then(() => { const o = $('sgCopy').textContent; $('sgCopy').textContent = '✓ Copied'; setTimeout(()=>$('sgCopy').textContent=o, 1500); });
    });
    $('sgSave').addEventListener('click', async () => {
      const name = $('sgName').value.trim() || `${currentType} ${new Date().toLocaleDateString()}`;
      const fields = collect();
      const r = await fetch('/api/schema-generator/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, type: currentType, fields }) }).then(x=>x.json());
      if (!r.ok) { alert(r.error); return; }
      $('sgName').value = ''; loadSaved();
    });
    $('sgTypeBar').querySelectorAll('.sgType').forEach(b => b.addEventListener('click', e => selectType(e.currentTarget.getAttribute('data-t'))));
    selectType(currentType);
    loadSaved();
  });
};

// ── Tier 26 — Unified Conversation Inbox ───────────────────────────────────
window.buildUnifiedInbox = function() {
  const wrap = document.getElementById('uiboxWrap');
  if (!wrap) return;
  const esc = (window._escapeHtml) || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
  const safeUrl = (window._safeUrl) || ((u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } });

  const SOURCES = [
    { k: '',          label: 'All sources',  emoji: '📬' },
    { k: 'gmail',     label: 'Gmail',        emoji: '📧' },
    { k: 'reddit',    label: 'Reddit',       emoji: '👽' },
    { k: 'twitter',   label: 'Twitter/X',    emoji: '🐦' },
    { k: 'review',    label: 'Reviews',      emoji: '⭐' },
    { k: 'quora',     label: 'Quora',        emoji: '❓' },
    { k: 'glassdoor', label: 'Glassdoor',    emoji: '🏢' },
    { k: 'newsletter',label: 'Newsletters',  emoji: '📧' },
    { k: 'chatbot',   label: 'Chatbot',      emoji: '💬' },
  ];
  const STATUSES = [
    { k: '',          label: 'All' },
    { k: 'new',       label: 'New' },
    { k: 'replied',   label: 'Replied' },
    { k: 'resolved',  label: 'Resolved' },
    { k: 'snoozed',   label: 'Snoozed' },
  ];
  const SENT_DOT = { positive:'#16a34a', negative:'#dc2626', neutral:'#94a3b8' };

  const filt = { source: '', status: '', sentiment: '', q: '' };

  wrap.innerHTML = `
    <div class="dna-card" style="padding:18px;margin-bottom:16px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:700;font-size:1.05rem">Inbox</div>
          <div id="uiboxStats" style="color:#64748b;font-size:0.85rem;margin-top:2px">Loading…</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" id="uiboxIngest">🔄 Refresh from sources</button>
        </div>
      </div>
    </div>

    <div class="dna-card" style="padding:14px;margin-bottom:16px">
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:240px">
          <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:4px">Search</label>
          <input id="uiboxQ" type="text" placeholder="title, content or author…" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff)">
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:4px">Source</label>
          <select id="uiboxSource" style="padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff)">
            ${SOURCES.map(s => `<option value="${esc(s.k)}">${esc(s.emoji + ' ' + s.label)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:4px">Status</label>
          <select id="uiboxStatus" style="padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff)">
            ${STATUSES.map(s => `<option value="${esc(s.k)}">${esc(s.label)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:4px">Sentiment</label>
          <select id="uiboxSent" style="padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff)">
            <option value="">Any</option>
            <option value="positive">😀 Positive</option>
            <option value="neutral">😐 Neutral</option>
            <option value="negative">😠 Negative</option>
          </select>
        </div>
      </div>
    </div>

    <div id="uiboxList" class="dna-card" style="padding:0"></div>
  `;

  const sourceEmoji = (k) => (SOURCES.find(s => s.k === k) || {}).emoji || '•';
  const fmtDate = (d) => { if (!d) return ''; try { const x = new Date(d); return x.toLocaleString(); } catch { return String(d); } };

  function loadStats() {
    fetch('/api/unified-inbox/stats').then(x => x.json()).then(j => {
      if (!j.ok) return;
      const s = j.stats || {};
      const st = s.status || {};
      document.getElementById('uiboxStats').innerHTML =
        `<strong>${s.total || 0}</strong> items · `
        + `<span style="color:#0ea5e9">${st.new || 0} new</span> · `
        + `<span style="color:#64748b">${st.replied || 0} replied</span> · `
        + `<span style="color:#16a34a">${st.resolved || 0} resolved</span> · `
        + `<span style="color:#94a3b8">${st.snoozed || 0} snoozed</span>`;
    }).catch(() => {});
  }

  function loadGmail() {
    const list = document.getElementById('uiboxList');
    list.innerHTML = '<div style="padding:32px;text-align:center;color:#64748b">Loading Gmail threads…</div>';
    fetch('/api/integrations/workspace/gmail/threads?max=20', { credentials: 'same-origin' })
      .then(x => x.json())
      .then(j => {
        if (!j.ok) {
          const notConn = j.error && (j.error.includes('not connected') || j.error.includes('token_refresh'));
          list.innerHTML = notConn
            ? `<div style="padding:48px 32px;text-align:center;color:#64748b">
                 <div style="font-size:2rem;margin-bottom:8px">📧</div>
                 <strong>Google Workspace not connected</strong><br>
                 <span style="font-size:0.85rem">Go to <a href="#" onclick="navigateTo('settings')">Settings → Google Workspace</a> and click <strong>Connect via OAuth</strong> to enable Gmail in your inbox.</span>
               </div>`
            : `<div style="padding:32px;text-align:center;color:#dc2626">Failed to load Gmail: ${esc(j.error || 'unknown')}</div>`;
          return;
        }
        if (!j.threads || !j.threads.length) {
          list.innerHTML = '<div style="padding:48px 32px;text-align:center;color:#64748b"><div style="font-size:2rem;margin-bottom:8px">📭</div>No Gmail threads found.</div>';
          return;
        }
        list.innerHTML = j.threads.map(t => `
          <div class="uibox-row" data-gthread="${esc(t.id)}" style="padding:14px 18px;border-bottom:1px solid var(--border-color,#e2e8f0);display:flex;gap:14px;align-items:flex-start;cursor:pointer">
            <div style="width:10px;height:10px;border-radius:50%;background:${t.unread ? '#0ea5e9' : '#cbd5e1'};margin-top:7px;flex-shrink:0" title="${t.unread ? 'Unread' : 'Read'}"></div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
                <span style="font-size:0.78rem;background:var(--bg-secondary,#f1f5f9);padding:2px 8px;border-radius:10px">📧 gmail</span>
                ${t.unread ? '<span class="uibox-badge uibox-st-new">new</span>' : ''}
                <span style="font-size:0.78rem;color:#64748b">${esc(t.from.replace(/<[^>]+>/g,'').trim() || 'Unknown')}</span>
                <span style="font-size:0.72rem;color:#94a3b8">· ${esc(t.date ? new Date(t.date).toLocaleString() : '')}</span>
                ${t.messageCount > 1 ? `<span style="font-size:0.72rem;color:#94a3b8">· ${t.messageCount} messages</span>` : ''}
              </div>
              <div style="font-weight:600;margin-bottom:2px">${esc(t.subject)}</div>
              <div style="color:#475569;font-size:0.9rem">${esc(String(t.snippet || '').slice(0, 200))}</div>
              <div id="gthread-body-${esc(t.id)}" style="display:none;margin-top:10px"></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
              <button class="btn btn-link gmail-reply-btn" data-tid="${esc(t.id)}" data-to="${esc(t.from)}" data-subj="${esc(t.subject)}" style="font-size:0.78rem;padding:4px 8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;color:#0369a1;cursor:pointer">↩ Reply</button>
            </div>
          </div>
        `).join('');

        list.querySelectorAll('[data-gthread]').forEach(row => {
          row.addEventListener('click', async (e) => {
            if (e.target.closest('.gmail-reply-btn')) return;
            const tid = row.getAttribute('data-gthread');
            const bodyEl = document.getElementById('gthread-body-' + tid);
            if (!bodyEl) return;
            if (bodyEl.style.display === 'block') { bodyEl.style.display = 'none'; return; }
            bodyEl.style.display = 'block';
            bodyEl.innerHTML = '<div style="color:#64748b;font-size:0.85rem">Loading thread…</div>';
            try {
              const r = await fetch(`/api/integrations/workspace/gmail/threads/${encodeURIComponent(tid)}`, { credentials: 'same-origin' });
              const td = await r.json();
              if (!td.ok) throw new Error(td.error || 'unknown');
              bodyEl.innerHTML = td.messages.map(m => `
                <div style="margin-bottom:10px;padding:10px 12px;background:var(--bg-secondary,#f8fafc);border-left:3px solid #0ea5e9;border-radius:0 6px 6px 0">
                  <div style="font-size:0.72rem;color:#64748b;margin-bottom:4px">
                    <strong>${esc(m.from)}</strong> → ${esc(m.to)} · ${esc(m.date ? new Date(m.date).toLocaleString() : '')}
                  </div>
                  <div style="font-size:0.85rem;color:#1e293b;white-space:pre-wrap;word-break:break-word">${esc(m.body || m.snippet || '')}</div>
                </div>
              `).join('');
            } catch (err) {
              bodyEl.innerHTML = `<div style="color:#dc2626;font-size:0.85rem">Failed to load thread: ${esc(err.message)}</div>`;
            }
          });
        });

        list.querySelectorAll('.gmail-reply-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tid  = btn.getAttribute('data-tid');
            const to   = btn.getAttribute('data-to');
            const subj = btn.getAttribute('data-subj');
            _gmailReplyModal(tid, to, subj);
          });
        });
      })
      .catch(err => {
        list.innerHTML = `<div style="padding:32px;text-align:center;color:#dc2626">Failed: ${esc(err.message)}</div>`;
      });
  }

  function _gmailReplyModal(threadId, to, subject) {
    const existing = document.getElementById('gmailReplyModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'gmailReplyModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:var(--card-bg,#fff);border-radius:14px;padding:24px;max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2)">
        <div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">↩ Reply via Gmail</div>
        <div style="font-size:0.8rem;color:#64748b;margin-bottom:16px">To: ${esc(to)} · ${esc(subject ? (subject.startsWith('Re:') ? subject : 'Re: ' + subject) : 'Re:')}</div>
        <textarea id="gmailReplyBody" rows="6" placeholder="Type your reply…" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font-family:inherit;font-size:0.9rem;box-sizing:border-box;resize:vertical"></textarea>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
          <button onclick="document.getElementById('gmailReplyModal').remove()" style="padding:8px 16px;background:var(--bg-secondary,#f1f5f9);border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-weight:600">Cancel</button>
          <button id="gmailSendBtn" style="padding:8px 18px;background:#0ea5e9;color:white;border:0;border-radius:8px;font-weight:700;cursor:pointer">📤 Send Reply</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('gmailSendBtn').onclick = async () => {
      const body = (document.getElementById('gmailReplyBody') || {}).value || '';
      if (!body.trim()) { alert('Please type a reply first.'); return; }
      const sendBtn = document.getElementById('gmailSendBtn');
      sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
      try {
        const r = await fetch('/api/integrations/workspace/gmail/reply', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId, to, subject, body }),
        });
        const j = await r.json();
        if (j.ok) {
          modal.remove();
          if (window.showToast) showToast('✅ Reply sent via Gmail');
        } else {
          alert('Failed to send: ' + (j.error || 'unknown'));
          sendBtn.disabled = false; sendBtn.textContent = '📤 Send Reply';
        }
      } catch (err) {
        alert('Error: ' + err.message);
        sendBtn.disabled = false; sendBtn.textContent = '📤 Send Reply';
      }
    };
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }

  function load() {
    const list = document.getElementById('uiboxList');
    list.innerHTML = '<div style="padding:32px;text-align:center;color:#64748b">Loading…</div>';
    if (filt.source === 'gmail') { loadGmail(); return; }
    const q = new URLSearchParams();
    if (filt.source) q.set('source', filt.source);
    if (filt.status) q.set('status', filt.status);
    if (filt.sentiment) q.set('sentiment', filt.sentiment);
    if (filt.q) q.set('q', filt.q);
    q.set('limit', '100');
    fetch('/api/unified-inbox/list?' + q.toString()).then(x => x.json()).then(j => {
      if (!j.ok) { list.innerHTML = '<div style="padding:32px;text-align:center;color:#dc2626">Failed to load.</div>'; return; }
      if (!j.items.length) {
        list.innerHTML = '<div style="padding:48px 32px;text-align:center;color:#64748b"><div style="font-size:2rem;margin-bottom:8px">📭</div>Inbox empty for these filters.<br><span style="font-size:0.85rem">Hit <strong>Refresh from sources</strong> above to pull from Reddit Pulse, Twitter/X Pulse, Reviews, Quora, Glassdoor, Newsletter mentions and Chatbot conversations.</span></div>';
        return;
      }
      list.innerHTML = j.items.map((it) => {
        const dot = SENT_DOT[it.sentiment] || '#cbd5e1';
        const url = it.source_url ? `<a href="${esc(safeUrl(it.source_url))}" target="_blank" rel="noopener" style="margin-left:8px;font-size:0.78rem;color:#0ea5e9">open ↗</a>` : '';
        const statusBadge = `<span class="uibox-badge uibox-st-${esc(it.status)}">${esc(it.status)}</span>`;
        return `
          <div class="uibox-row" data-id="${it.id}" style="padding:14px 18px;border-bottom:1px solid var(--border-color,#e2e8f0);display:flex;gap:14px;align-items:flex-start">
            <div title="${esc(it.sentiment || 'unknown')}" style="width:10px;height:10px;border-radius:50%;background:${dot};margin-top:7px;flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
                <span style="font-size:0.78rem;background:var(--bg-secondary,#f1f5f9);padding:2px 8px;border-radius:10px">${esc(sourceEmoji(it.source) + ' ' + it.source)}</span>
                ${statusBadge}
                <span style="font-size:0.78rem;color:#64748b">${esc(it.author || 'Anonymous')}</span>
                <span style="font-size:0.72rem;color:#94a3b8">· ${esc(fmtDate(it.occurred_at || it.ingested_at))}</span>
                ${url}
              </div>
              ${it.title ? `<div style="font-weight:600;margin-bottom:2px">${esc(it.title)}</div>` : ''}
              ${it.content ? `<div style="color:#475569;font-size:0.9rem;white-space:pre-wrap;word-break:break-word">${esc(String(it.content).slice(0, 400))}${it.content.length > 400 ? '…' : ''}</div>` : ''}
              ${it.notes ? `<div style="margin-top:6px;padding:6px 10px;background:var(--bg-secondary,#f8fafc);border-left:3px solid #0ea5e9;font-size:0.82rem;color:#475569"><strong>Note:</strong> ${esc(it.notes)}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
              <select class="uibox-status" data-id="${it.id}" style="padding:4px 8px;border:1px solid var(--border-color,#e2e8f0);border-radius:4px;font-size:0.78rem;background:var(--card-bg,#fff)">
                ${['new','replied','resolved','snoozed'].map(s => `<option value="${s}"${s === it.status ? ' selected':''}>${s}</option>`).join('')}
              </select>
              <button class="btn btn-link uibox-note" data-id="${it.id}" style="font-size:0.78rem;padding:2px 6px">📝 Note</button>
              <button class="btn btn-link uibox-del" data-id="${it.id}" style="font-size:0.78rem;padding:2px 6px;color:#dc2626">🗑</button>
            </div>
          </div>
        `;
      }).join('');
      list.querySelectorAll('.uibox-status').forEach(sel => {
        sel.addEventListener('change', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          const status = e.currentTarget.value;
          await fetch('/api/unified-inbox/' + id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
          loadStats();
        });
      });
      list.querySelectorAll('.uibox-note').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          const note = prompt('Note:');
          if (note == null) return;
          await fetch('/api/unified-inbox/' + id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ notes: note }) });
          load();
        });
      });
      list.querySelectorAll('.uibox-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          if (!confirm('Delete this inbox item?')) return;
          const id = e.currentTarget.getAttribute('data-id');
          await fetch('/api/unified-inbox/' + id, { method:'DELETE' });
          load(); loadStats();
        });
      });
    }).catch(() => { list.innerHTML = '<div style="padding:32px;text-align:center;color:#dc2626">Failed to load.</div>'; });
  }

  document.getElementById('uiboxIngest').addEventListener('click', async (e) => {
    const b = e.currentTarget; const old = b.innerHTML;
    b.innerHTML = '⏳ Refreshing…'; b.disabled = true;
    try {
      const r = await fetch('/api/unified-inbox/ingest', { method:'POST' }).then(x => x.json());
      if (r.ok) {
        const c = r.counts || {};
        const summary = Object.entries(c).filter(([k,v]) => !k.endsWith('_error') && v > 0).map(([k,v]) => `${v} ${k}`).join(', ') || 'no new items';
        alert('Pulled: ' + summary);
      } else { alert('Failed: ' + (r.error || 'unknown')); }
    } catch (err) { alert('Failed: ' + err.message); }
    b.innerHTML = old; b.disabled = false;
    load(); loadStats();
  });

  let qTimer;
  document.getElementById('uiboxQ').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { filt.q = e.target.value.trim(); load(); }, 250);
  });
  document.getElementById('uiboxSource').addEventListener('change', (e) => { filt.source = e.target.value; load(); });
  document.getElementById('uiboxStatus').addEventListener('change', (e) => { filt.status = e.target.value; load(); });
  document.getElementById('uiboxSent').addEventListener('change', (e) => { filt.sentiment = e.target.value; load(); });

  // tiny CSS for status badges (idempotent inject)
  if (!document.getElementById('uiboxBadgeCss')) {
    const st = document.createElement('style');
    st.id = 'uiboxBadgeCss';
    st.textContent = `.uibox-badge{font-size:0.72rem;padding:2px 8px;border-radius:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px}
      .uibox-st-new{background:#e0f2fe;color:#0369a1}
      .uibox-st-replied{background:#f1f5f9;color:#475569}
      .uibox-st-resolved{background:#dcfce7;color:#166534}
      .uibox-st-snoozed{background:#fef3c7;color:#92400e}`;
    document.head.appendChild(st);
  }

  loadStats();
  load();
};

// ── Tier 27 — Conversion Boosters ──────────────────────────────────────────
window.buildConversionBoosters = function() {
  const wrap = document.getElementById('cnvbWrap');
  if (!wrap) return;
  const esc = (window._escapeHtml) || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

  let DEFAULTS = null;
  let editing = null; // {id, type, name, settings}

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
      <div class="dna-card cb-pick" data-type="social_proof" style="padding:22px;cursor:pointer;border:2px solid transparent;transition:.15s">
        <div style="font-size:1.8rem;margin-bottom:8px">📣</div>
        <div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Social Proof Popup</div>
        <div style="color:#64748b;font-size:0.86rem">Rotating "Sarah from Cape Town just signed up" toasts. Proven 5–15% conversion lift.</div>
      </div>
      <div class="dna-card cb-pick" data-type="exit_intent" style="padding:22px;cursor:pointer;border:2px solid transparent;transition:.15s">
        <div style="font-size:1.8rem;margin-bottom:8px">🚪</div>
        <div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Exit Intent Popup</div>
        <div style="color:#64748b;font-size:0.86rem">Captures email when the visitor's mouse leaves the page. Lands in Unified Inbox.</div>
      </div>
    </div>

    <div id="cbForm" class="dna-card" style="padding:20px;margin-bottom:16px;display:none"></div>

    <div class="dna-card" style="padding:0">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border-color,#e2e8f0);font-weight:700">Your widgets</div>
      <div id="cbList"><div style="padding:32px;text-align:center;color:#64748b">Loading…</div></div>
    </div>
  `;

  fetch('/api/conversion-boosters/defaults').then(x=>x.json()).then(j => { DEFAULTS = j.defaults; });

  function loadList() {
    const list = document.getElementById('cbList');
    fetch('/api/conversion-boosters/widgets').then(x=>x.json()).then(j => {
      if (!j.ok || !j.widgets.length) { list.innerHTML = '<div style="padding:32px;text-align:center;color:#64748b">No widgets yet — click a card above to create your first.</div>'; return; }
      list.innerHTML = j.widgets.map(w => {
        const origin = location.origin;
        const snippet = `<script src="${origin}/api/conversion-boosters/embed/${w.id}.js" async></` + `script>`;
        const emoji = w.type === 'social_proof' ? '📣' : '🚪';
        return `
          <div style="padding:16px 20px;border-bottom:1px solid var(--border-color,#e2e8f0)">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
              <div style="flex:1;min-width:240px">
                <div style="font-weight:700;font-size:1rem;margin-bottom:2px">${emoji} ${esc(w.name)}</div>
                <div style="color:#64748b;font-size:0.82rem">${esc(w.type)} · ${w.views} views · ${w.leads} leads · ID: <code>${esc(w.id)}</code></div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn btn-secondary cb-edit" data-id="${w.id}" data-type="${w.type}" style="font-size:0.82rem">⚙️ Edit</button>
                <button class="btn btn-secondary cb-events" data-id="${w.id}" style="font-size:0.82rem">📊 Activity</button>
                <button class="btn btn-link cb-del" data-id="${w.id}" style="color:#dc2626;font-size:0.82rem">🗑</button>
              </div>
            </div>
            <div style="margin-top:10px">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:4px">Paste this on any page:</label>
              <div style="display:flex;gap:6px">
                <input type="text" readonly value='${esc(snippet)}' style="flex:1;padding:8px 10px;font-family:monospace;font-size:0.78rem;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--bg-secondary,#f8fafc)">
                <button class="btn btn-primary cb-copy" data-snippet='${esc(snippet)}' style="font-size:0.82rem">Copy</button>
              </div>
            </div>
            <div id="cbEv-${w.id}" style="margin-top:12px;display:none"></div>
          </div>
        `;
      }).join('');
      list.querySelectorAll('.cb-copy').forEach(b => b.addEventListener('click', (e) => {
        const s = e.currentTarget.getAttribute('data-snippet');
        navigator.clipboard.writeText(s).then(() => { const o = e.currentTarget.textContent; e.currentTarget.textContent='✓ Copied'; setTimeout(()=>{e.currentTarget.textContent=o;},1500); });
      }));
      list.querySelectorAll('.cb-del').forEach(b => b.addEventListener('click', async (e) => {
        if (!confirm('Delete this widget? The embed snippet will stop working.')) return;
        await fetch('/api/conversion-boosters/widgets/' + e.currentTarget.getAttribute('data-id'), { method:'DELETE' });
        loadList();
      }));
      list.querySelectorAll('.cb-edit').forEach(b => b.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const w = j.widgets.find(x => x.id === id);
        if (w) showForm(w.type, w);
      }));
      list.querySelectorAll('.cb-events').forEach(b => b.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const tgt = document.getElementById('cbEv-' + id);
        if (tgt.style.display === 'block') { tgt.style.display='none'; return; }
        tgt.style.display = 'block'; tgt.innerHTML = '<div style="padding:12px;color:#64748b">Loading…</div>';
        const r = await fetch('/api/conversion-boosters/widgets/' + id + '/events').then(x=>x.json());
        if (!r.ok) { tgt.innerHTML = '<div style="padding:12px;color:#dc2626">Failed</div>'; return; }
        const c = r.counts || {};
        tgt.innerHTML = `<div style="background:var(--bg-secondary,#f8fafc);padding:12px;border-radius:6px;font-size:0.86rem">
          <div style="margin-bottom:8px"><strong>${c.view||0}</strong> views · <strong>${c.lead||0}</strong> leads · <strong>${c.dismiss||0}</strong> dismissals</div>
          ${r.events.length ? '<div style="max-height:240px;overflow-y:auto">' + r.events.map(ev => `<div style="padding:6px 0;border-top:1px solid var(--border-color,#e2e8f0);font-size:0.82rem"><span style="display:inline-block;width:60px;color:${ev.event_type==='lead'?'#16a34a':ev.event_type==='dismiss'?'#dc2626':'#64748b'};font-weight:600">${esc(ev.event_type)}</span> ${ev.email ? esc(ev.email) + ' · ' : ''}<span style="color:#94a3b8">${new Date(ev.created_at).toLocaleString()}</span></div>`).join('') + '</div>' : '<div style="color:#64748b">No activity yet.</div>'}
        </div>`;
      }));
    });
  }

  function showForm(type, w) {
    editing = w || null;
    const def = (DEFAULTS && DEFAULTS[type]) || {};
    const cur = (w && w.settings) || def;
    const form = document.getElementById('cbForm');
    form.style.display = 'block';
    document.querySelectorAll('.cb-pick').forEach(p => p.style.borderColor = p.getAttribute('data-type') === type ? '#0ea5e9' : 'transparent');

    if (type === 'social_proof') {
      const items = (cur.items || def.items || []).map(i => `${i.name} | ${i.location||''} | ${i.action||''} | ${i.when||''}`).join('\n');
      form.innerHTML = `
        <div style="font-weight:700;margin-bottom:14px">${w ? 'Edit' : 'New'} Social Proof Widget</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label>Name<input id="cbName" type="text" value="${esc(w?w.name:'My Social Proof')}" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
          <label>Position<select id="cbPos" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px">
            ${['bottom-left','bottom-right','top-left','top-right'].map(p=>`<option value="${p}"${p===(cur.position||'bottom-left')?' selected':''}>${p}</option>`).join('')}
          </select></label>
          <label>Show every (sec)<input id="cbInt" type="number" min="4" max="120" value="${cur.intervalSeconds||12}" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
          <label>Display for (sec)<input id="cbDisp" type="number" min="2" max="30" value="${cur.displaySeconds||5}" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
          <label>Accent color<input id="cbAcc" type="color" value="${esc(cur.accent||'#10B981')}" style="width:100%;padding:4px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px;height:38px"></label>
        </div>
        <label style="display:block;margin-top:14px">Recent activity items <span style="color:#64748b;font-weight:normal;font-size:0.8rem">(one per line: Name | Location | Action | When)</span>
          <textarea id="cbItems" rows="6" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px;font-family:monospace;font-size:0.82rem">${esc(items)}</textarea>
        </label>
        <div style="margin-top:14px;display:flex;gap:8px"><button class="btn btn-primary" id="cbSave">${w ? '💾 Save' : '🚀 Create widget'}</button><button class="btn btn-link" id="cbCancel">Cancel</button></div>
      `;
      document.getElementById('cbSave').addEventListener('click', () => save(type, () => {
        const items = document.getElementById('cbItems').value.split('\n').map(l => {
          const p = l.split('|').map(s => s.trim()); if (!p[0]) return null;
          return { name:p[0], location:p[1]||'', action:p[2]||'just signed up', when:p[3]||'recently' };
        }).filter(Boolean);
        return {
          position: document.getElementById('cbPos').value,
          intervalSeconds: parseInt(document.getElementById('cbInt').value, 10),
          displaySeconds: parseInt(document.getElementById('cbDisp').value, 10),
          accent: document.getElementById('cbAcc').value,
          items,
        };
      }));
    } else {
      form.innerHTML = `
        <div style="font-weight:700;margin-bottom:14px">${w ? 'Edit' : 'New'} Exit Intent Widget</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label>Name<input id="cbName" type="text" value="${esc(w?w.name:'My Exit Intent')}" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
          <label>Accent color<input id="cbAcc" type="color" value="${esc(cur.accent||'#0066FF')}" style="width:100%;padding:4px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px;height:38px"></label>
        </div>
        <label style="display:block;margin-top:12px">Headline<input id="cbHead" type="text" value="${esc(cur.headline||'Wait — before you go!')}" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
        <label style="display:block;margin-top:12px">Subheadline<input id="cbSub" type="text" value="${esc(cur.subheadline||'')}" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">
          <label>CTA button text<input id="cbCta" type="text" value="${esc(cur.ctaText||'Send me the guide')}" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
          <label>Cookie days <span style="color:#64748b;font-size:0.78rem">(don't re-show)</span><input id="cbCookie" type="number" min="0" max="365" value="${cur.dismissCookieDays||7}" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
          <label>Redirect after submit (optional)<input id="cbRedir" type="url" value="${esc(cur.redirectUrl||'')}" placeholder="https://…" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px"><button class="btn btn-primary" id="cbSave">${w ? '💾 Save' : '🚀 Create widget'}</button><button class="btn btn-link" id="cbCancel">Cancel</button></div>
      `;
      document.getElementById('cbSave').addEventListener('click', () => save(type, () => ({
        headline: document.getElementById('cbHead').value,
        subheadline: document.getElementById('cbSub').value,
        ctaText: document.getElementById('cbCta').value,
        accent: document.getElementById('cbAcc').value,
        dismissCookieDays: parseInt(document.getElementById('cbCookie').value, 10) || 0,
        redirectUrl: document.getElementById('cbRedir').value.trim(),
      })));
    }
    document.getElementById('cbCancel').addEventListener('click', () => { form.style.display='none'; document.querySelectorAll('.cb-pick').forEach(p => p.style.borderColor='transparent'); editing = null; });
  }

  async function save(type, getSettings) {
    const name = document.getElementById('cbName').value.trim() || (type === 'social_proof' ? 'Social Proof' : 'Exit Intent');
    const settings = getSettings();
    const url = editing ? '/api/conversion-boosters/widgets/' + editing.id : '/api/conversion-boosters/widgets';
    const method = editing ? 'PATCH' : 'POST';
    const body = editing ? { name, settings } : { type, name, settings };
    const r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(x=>x.json());
    if (!r.ok) { alert('Failed: ' + (r.error||'unknown')); return; }
    document.getElementById('cbForm').style.display='none';
    document.querySelectorAll('.cb-pick').forEach(p => p.style.borderColor='transparent');
    editing = null;
    loadList();
  }

  document.querySelectorAll('.cb-pick').forEach(p => p.addEventListener('click', (e) => {
    showForm(e.currentTarget.getAttribute('data-type'), null);
  }));

  loadList();
};

// ── Tier 28 — White-Label Reports ──────────────────────────────────────────
window.buildWhiteLabel = function() {
  const wrap = document.getElementById('wlWrap');
  if (!wrap) return;
  const esc = (window._escapeHtml) || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
  wrap.innerHTML = `
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:24px;margin-bottom:18px">
      <div id="wlForm">Loading…</div>
    </div>
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:20px">
      <div style="font-weight:700;margin-bottom:12px">Live Preview</div>
      <p style="color:#64748b;font-size:0.88rem;margin-bottom:14px">Generate a sample report with the current settings to see exactly how your branded exports will look.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/api/white-label/preview/pdf" target="_blank" class="btn btn-secondary">📄 Sample PDF</a>
        <a href="/api/white-label/preview/pptx" target="_blank" class="btn btn-secondary">🎞 Sample PPTX</a>
        <a href="/api/white-label/preview/xlsx" target="_blank" class="btn btn-secondary">📊 Sample XLSX</a>
      </div>
    </div>
  `;
  function render(brand) {
    const b = brand || {};
    document.getElementById('wlForm').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div style="font-weight:700;font-size:1.1rem">Brand Profile</div>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer">
          <input type="checkbox" id="wl-enabled" ${b.enabled ? 'checked' : ''}> Apply white-label to all exports
        </label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <label>Agency / Brand name<input id="wl-name" type="text" maxlength="80" value="${esc(b.agencyName || '')}" placeholder="Acme Marketing" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
        <label>Footer text (overrides "Powered by InfoGenie")<input id="wl-footer" type="text" maxlength="200" value="${esc(b.footerText || '')}" placeholder="Prepared by Acme for ACME CLIENT — Confidential" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:14px">
        <label>Primary colour <span style="color:#64748b;font-size:0.78rem">(cover + headers)</span><input id="wl-primary" type="color" value="${esc(b.primaryColor || '#1E1B4B')}" style="width:100%;padding:4px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px;height:38px"></label>
        <label>Accent colour <span style="color:#64748b;font-size:0.78rem">(footer line)</span><input id="wl-accent" type="color" value="${esc(b.accentColor || '#7C3AED')}" style="width:100%;padding:4px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px;height:38px"></label>
        <label>Body text colour<input id="wl-text" type="color" value="${esc(b.textColor || '#0A1628')}" style="width:100%;padding:4px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px;height:38px"></label>
      </div>
      <div style="margin-top:14px">
        <label style="display:block;margin-bottom:6px;font-weight:600">Logo (PNG or JPG, max 256KB)</label>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <input id="wl-logo-file" type="file" accept="image/png,image/jpeg,image/jpg" style="font-size:0.86rem">
          <button id="wl-logo-clear" class="btn btn-link" style="font-size:0.82rem;color:#dc2626">Remove logo</button>
        </div>
        <div id="wl-logo-preview" style="margin-top:10px">${b.logoDataUrl ? `<img src="${esc(b.logoDataUrl)}" style="max-height:60px;max-width:200px;background:#f1f5f9;padding:8px;border-radius:6px">` : '<span style="color:#64748b;font-size:0.82rem">No logo uploaded.</span>'}</div>
      </div>
      <div style="margin-top:14px;padding:12px;background:var(--bg-secondary,#f8fafc);border-radius:8px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
          <input type="checkbox" id="wl-hide-ig" ${b.hideInfoGenieBranding ? 'checked' : ''}>
          Hide "Powered by InfoGenie" line when no custom footer is set
        </label>
      </div>
      <div style="margin-top:18px;display:flex;gap:8px">
        <button id="wl-save" class="btn btn-primary">💾 Save brand profile</button>
        <button id="wl-reset" class="btn btn-link" style="color:#dc2626">Reset to InfoGenie defaults</button>
      </div>
      <div id="wl-msg" style="margin-top:12px"></div>
    `;
    let logoData = b.logoDataUrl || '';
    document.getElementById('wl-logo-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      if (f.size > 256 * 1024) { alert('Logo too large (max 256KB).'); e.target.value = ''; return; }
      const r = new FileReader();
      r.onload = () => {
        logoData = r.result;
        document.getElementById('wl-logo-preview').innerHTML = `<img src="${logoData}" style="max-height:60px;max-width:200px;background:#f1f5f9;padding:8px;border-radius:6px">`;
      };
      r.readAsDataURL(f);
    });
    document.getElementById('wl-logo-clear').addEventListener('click', (e) => {
      e.preventDefault(); logoData = '';
      document.getElementById('wl-logo-file').value = '';
      document.getElementById('wl-logo-preview').innerHTML = '<span style="color:#64748b;font-size:0.82rem">No logo uploaded.</span>';
    });
    document.getElementById('wl-save').addEventListener('click', async () => {
      const payload = {
        enabled: document.getElementById('wl-enabled').checked,
        agencyName: document.getElementById('wl-name').value.trim(),
        footerText: document.getElementById('wl-footer').value.trim(),
        primaryColor: document.getElementById('wl-primary').value,
        accentColor: document.getElementById('wl-accent').value,
        textColor: document.getElementById('wl-text').value,
        logoDataUrl: logoData,
        hideInfoGenieBranding: document.getElementById('wl-hide-ig').checked,
      };
      const r = await fetch('/api/white-label/profile', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).then(x=>x.json());
      const msg = document.getElementById('wl-msg');
      if (r.ok) { msg.innerHTML = '<div style="background:#dcfce7;color:#166534;padding:10px;border-radius:6px;font-size:0.88rem">✓ Brand profile saved. New exports will use these settings immediately.</div>'; render(r.brand); }
      else { msg.innerHTML = '<div style="background:#fee;color:#dc2626;padding:10px;border-radius:6px;font-size:0.88rem">Save failed: ' + esc(r.error || 'unknown') + '</div>'; }
    });
    document.getElementById('wl-reset').addEventListener('click', async () => {
      if (!confirm('Reset to InfoGenie defaults? This disables white-labelling and clears your logo.')) return;
      const r = await fetch('/api/white-label/profile', { method:'DELETE' }).then(x=>x.json());
      if (r.ok) render(r.brand);
    });
  }
  fetch('/api/white-label/profile').then(x=>x.json()).then(j => {
    if (j.ok) render(j.brand);
    else document.getElementById('wlForm').innerHTML = '<div style="color:#dc2626">Failed to load: ' + esc(j.error || 'unknown') + '</div>';
  });
};

// ── T35.1 — Bulk Reporting ─────────────────────────────────────────────────
window.buildBulkReports = function() {
  const wrap = document.getElementById('brWrap'); if (!wrap) return;
  const esc = (window._escapeHtml) || (s => String(s==null?'':s).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:18px">
      <div style="font-weight:800;color:#0A1628;margin-bottom:12px">📥 Upload CSV of URLs</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">Run name</label>
          <input id="brName" placeholder="e.g. Cape Town agency prospects" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem">
        </div>
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">CSV file (one URL per row, max 500)</label>
          <input id="brFile" type="file" accept=".csv,text/csv" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.85rem">
        </div>
      </div>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;color:#374151;margin-bottom:10px">
        <input type="checkbox" id="brHeadless"> Render every page in a real browser (slower, but works for JS-heavy SPAs)
      </label><br>
      <button onclick="_brStart()" style="padding:10px 22px;background:#059669;border:2px solid #059669;border-radius:8px;font-size:0.84rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.4)">📦 Start Batch</button>
      <div style="font-size:0.75rem;color:#6B7280;margin-top:10px">PDFs use your <a href="#" onclick="navigateTo('white-label');return false" style="color:#7C3AED;font-weight:700">White-Label</a> brand profile if it's enabled.</div>
    </div>
    <div id="brList"></div>`;
  _brList();
};
window._brStart = async function() {
  const f = (document.getElementById('brFile')||{}).files?.[0];
  if (!f) return showToast('⚠️ Choose a CSV file first');
  const fd = new FormData();
  fd.append('file', f);
  fd.append('name', (document.getElementById('brName')||{}).value || '');
  fd.append('headless', (document.getElementById('brHeadless')||{}).checked ? '1' : '0');
  showToast('⏳ Uploading and queuing audits…');
  try {
    const r = await fetch('/api/bulk-reports/run', { method:'POST', body: fd }).then(x=>x.json());
    if (!r.ok) return showToast('❌ ' + (r.error||'failed'));
    showToast('✅ Run #' + r.runId + ' started — ' + r.total + ' URLs queued');
    _brList();
  } catch (e) { showToast('❌ ' + e.message); }
};
window._brList = async function() {
  const list = document.getElementById('brList'); if (!list) return;
  list.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;color:#6B7280">⏳ Loading runs…</div>`;
  try {
    const r = await fetch('/api/bulk-reports').then(x=>x.json());
    const runs = r.runs || [];
    if (!runs.length) {
      list.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px;text-align:center;color:#9CA3AF">No bulk runs yet. Upload a CSV above to get started.</div>`;
      return;
    }
    const esc = window._escapeHtml || (s => String(s||''));
    list.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        <div style="padding:14px 18px;border-bottom:1px solid #E5E7EB;font-weight:800;color:#0A1628;display:flex;justify-content:space-between;align-items:center">
          <span>📦 Recent Bulk Runs (${runs.length})</span>
          <button onclick="_brList()" style="padding:6px 12px;background:#F3F4F6;border:1px solid #D1D5DB;border-radius:6px;font-size:0.75rem;cursor:pointer">↻ Refresh</button>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
          <thead><tr style="background:#F9FAFB">
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">RUN</th>
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">STATUS</th>
            <th style="padding:9px 14px;text-align:right;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">PROGRESS</th>
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">DOWNLOADS</th>
            <th></th>
          </tr></thead>
          <tbody>${runs.map(run => {
            const pct = run.total > 0 ? Math.round(((run.completed||0)+(run.failed||0)) / run.total * 100) : 0;
            const tone = run.status==='done' ? '#059669' : run.status==='failed' ? '#DC2626' : '#0066FF';
            return `<tr style="border-top:1px solid #F3F4F6">
              <td style="padding:11px 14px"><div style="font-weight:700;color:#0A1628">${esc(run.name)}</div><div style="font-size:0.72rem;color:#9CA3AF">#${run.id} · ${new Date(run.created_at).toLocaleString()}</div></td>
              <td style="padding:11px 14px"><span style="background:${tone}22;color:${tone};padding:3px 9px;border-radius:6px;font-size:0.72rem;font-weight:700;text-transform:uppercase">${esc(run.status)}</span></td>
              <td style="padding:11px 14px;text-align:right">
                <div style="font-weight:700;color:#0A1628">${run.completed}/${run.total}${run.failed?` <span style="color:#DC2626;font-size:0.78rem">(${run.failed} failed)</span>`:''}</div>
                <div style="background:#E5E7EB;height:5px;border-radius:3px;margin-top:5px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${tone}"></div></div>
              </td>
              <td style="padding:11px 14px">
                <a href="/api/bulk-reports/${run.id}/zip" style="color:#7C3AED;font-weight:700;font-size:0.8rem;text-decoration:none;margin-right:10px">📦 Zip of PDFs</a>
                <a href="/api/bulk-reports/${run.id}/csv" style="color:#0066FF;font-weight:700;font-size:0.8rem;text-decoration:none">📊 CSV</a>
              </td>
              <td style="padding:11px 14px;text-align:right">
                <button onclick="if(confirm('Delete run #${run.id}?')){fetch('/api/bulk-reports/${run.id}',{method:'DELETE'}).then(()=>_brList())}" style="background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:1rem" title="Delete">🗑️</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  } catch (e) { list.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${e.message}</div>`; }
  // Auto-refresh while any run is in flight.
  if (document.getElementById('brList') && document.querySelector('#brList span[style*="0066FF"]')) {
    clearTimeout(window._brTimer);
    window._brTimer = setTimeout(_brList, 5000);
  }
};

// ── T35.2 — Backlink Change Monitor ────────────────────────────────────────
window.buildBacklinkMonitor = function() {
  const wrap = document.getElementById('bmWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:18px">
      <div style="font-weight:800;color:#0A1628;margin-bottom:12px">➕ Add a domain to monitor</div>
      <div style="display:grid;grid-template-columns:2fr 2fr 1fr 1fr;gap:10px;margin-bottom:12px">
        <input id="bmDomain" placeholder="example.com" style="padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem">
        <input id="bmEmail" placeholder="alerts@yourcompany.com (optional)" style="padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem">
        <input id="bmSlack" placeholder="Slack webhook URL (optional)" style="padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem">
        <select id="bmFreq" style="padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem">
          <option value="daily">Daily check</option>
          <option value="weekly">Weekly check</option>
        </select>
      </div>
      <button onclick="_bmAdd()" style="padding:10px 22px;background:#059669;border:2px solid #059669;border-radius:8px;font-size:0.84rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.4)">🛰️ Start Monitoring</button>
      <button onclick="_bmRunAll()" style="padding:10px 22px;background:#fff;border:2px solid #7C3AED;border-radius:8px;font-size:0.84rem;font-weight:800;color:#7C3AED;cursor:pointer;margin-left:8px">⚡ Check All Now</button>
    </div>
    <div id="bmList"></div>
    <div id="bmChanges" style="margin-top:18px"></div>`;
  _bmRefresh();
};
window._bmAdd = async function() {
  const domain = (document.getElementById('bmDomain')||{}).value || '';
  if (!domain.trim()) return showToast('⚠️ Domain required');
  const r = await fetch('/api/backlink-monitor/domains', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
    domain,
    alert_email: (document.getElementById('bmEmail')||{}).value || '',
    alert_slack_webhook: (document.getElementById('bmSlack')||{}).value || '',
    frequency: (document.getElementById('bmFreq')||{}).value || 'daily',
  })}).then(x=>x.json());
  if (!r.ok) return showToast('❌ ' + (r.error||'failed'));
  showToast('✅ Monitoring ' + r.monitor.domain);
  document.getElementById('bmDomain').value = '';
  _bmRefresh();
};
window._bmDel = async function(id) {
  if (!confirm('Stop monitoring this domain?')) return;
  await fetch('/api/backlink-monitor/domains/'+id, { method:'DELETE' });
  _bmRefresh();
};
window._bmRunOne = async function(id) {
  showToast('⏳ Pulling fresh snapshot…');
  const r = await fetch('/api/backlink-monitor/run-now', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ monitor_id: id })}).then(x=>x.json());
  const res = (r.results || [])[0] || {};
  showToast(res.ok ? `✅ Refreshed: ${res.newCount||0} new, ${res.lostCount||0} lost` : '❌ ' + (res.error||'failed'));
  _bmRefresh();
};
window._bmRunAll = async function() {
  showToast('⏳ Running all monitors…');
  const r = await fetch('/api/backlink-monitor/run-now', { method:'POST', headers:{'Content-Type':'application/json'}, body: '{}' }).then(x=>x.json());
  showToast('✅ Processed ' + (r.results||[]).length + ' monitor(s)');
  _bmRefresh();
};
window._bmRefresh = async function() {
  const esc = window._escapeHtml || (s => String(s||''));
  const list = document.getElementById('bmList'); if (!list) return;
  try {
    const [m, c] = await Promise.all([
      fetch('/api/backlink-monitor/domains').then(x=>x.json()),
      fetch('/api/backlink-monitor/changes?limit=200').then(x=>x.json()),
    ]);
    const monitors = m.monitors || [];
    list.innerHTML = monitors.length ? `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        <div style="padding:14px 18px;border-bottom:1px solid #E5E7EB;font-weight:800;color:#0A1628">🛰️ Monitored Domains (${monitors.length})</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
          <thead><tr style="background:#F9FAFB">
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">DOMAIN</th>
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">ALERTS</th>
            <th style="padding:9px 14px;text-align:right;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">REF DOMAINS</th>
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">LAST CHECK</th>
            <th></th>
          </tr></thead>
          <tbody>${monitors.map(mn => `<tr style="border-top:1px solid #F3F4F6">
            <td style="padding:11px 14px;font-weight:700;color:#0A1628">${esc(mn.domain)}</td>
            <td style="padding:11px 14px;color:#374151;font-size:0.78rem">${[mn.alert_email && '✉️ '+esc(mn.alert_email), mn.alert_slack_webhook && '💬 Slack'].filter(Boolean).join(' · ') || '<span style="color:#9CA3AF">— none —</span>'} <span style="color:#9CA3AF">· ${esc(mn.frequency)}</span></td>
            <td style="padding:11px 14px;text-align:right;font-weight:700;color:#0A1628">${(mn.last_total_referring||0).toLocaleString()}</td>
            <td style="padding:11px 14px;color:#6B7280;font-size:0.78rem">${mn.last_run_at ? new Date(mn.last_run_at).toLocaleString() : '<span style="color:#F59E0B">never</span>'}</td>
            <td style="padding:11px 14px;text-align:right;white-space:nowrap">
              <button onclick="_bmRunOne(${mn.id})" style="background:none;border:1px solid #7C3AED;color:#7C3AED;border-radius:6px;padding:4px 10px;font-size:0.72rem;font-weight:700;cursor:pointer">↻ Check</button>
              <button onclick="_bmDel(${mn.id})" style="background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:1rem" title="Stop">🗑️</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px;text-align:center;color:#9CA3AF">No domains monitored yet. Add one above to start tracking link changes.</div>`;
    const changes = c.changes || [];
    document.getElementById('bmChanges').innerHTML = changes.length ? `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        <div style="padding:14px 18px;border-bottom:1px solid #E5E7EB;font-weight:800;color:#0A1628">📜 Recent Link Changes (${changes.length})</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
          <thead><tr style="background:#F9FAFB">
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">WHEN</th>
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">DOMAIN</th>
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">CHANGE</th>
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">REFERRING</th>
            <th style="padding:9px 14px;text-align:right;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">RANK</th>
            <th style="padding:9px 14px;text-align:left;color:#6B7280;font-size:0.7rem;font-weight:800;letter-spacing:.06em">COUNTRY</th>
          </tr></thead>
          <tbody>${changes.map(ch => {
            const tone = ch.change_type === 'new' ? '#059669' : '#DC2626';
            const icon = ch.change_type === 'new' ? '✨ NEW' : '💔 LOST';
            return `<tr style="border-top:1px solid #F3F4F6">
              <td style="padding:9px 14px;color:#6B7280;font-size:0.78rem;white-space:nowrap">${new Date(ch.detected_at).toLocaleString()}</td>
              <td style="padding:9px 14px;font-weight:700;color:#0A1628">${esc(ch.domain)}</td>
              <td style="padding:9px 14px"><span style="background:${tone}22;color:${tone};padding:3px 9px;border-radius:6px;font-size:0.72rem;font-weight:700">${icon}</span></td>
              <td style="padding:9px 14px;color:#374151">${esc(ch.referring_domain)}</td>
              <td style="padding:9px 14px;text-align:right;color:#374151">${ch.rank||0}</td>
              <td style="padding:9px 14px;color:#6B7280">${esc(ch.country||'—')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>` : '';
  } catch (e) { list.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${e.message}</div>`; }
};

// ── T35.3 — Backlink Research deep dimensions (anchors/pages/tlds/countries) ─
window._blResearch = async function() {
  const target = (document.getElementById('blTarget')||{}).value || '';
  if (!target.trim()) return showToast('⚠️ Enter a target first');
  const out = document.getElementById('blResearchOut');
  if (!out) return;
  const esc = window._escapeHtml || (s => String(s||''));
  out.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;color:#6B7280">⏳ Pulling deep research dimensions…</div>`;
  try {
    const [anc, pgs, brk] = await Promise.all([
      fetch('/api/backlinks/anchors',   { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ target, limit:25 })}).then(x=>x.json()),
      fetch('/api/backlinks/pages',     { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ target, limit:25 })}).then(x=>x.json()),
      fetch('/api/backlinks/breakdown', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ target })}).then(x=>x.json()),
    ]);
    const tbl = (title, headers, rows) => `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:14px">
        <div style="padding:12px 16px;border-bottom:1px solid #E5E7EB;font-weight:800;color:#0A1628">${title}</div>
        ${rows.length ? `<table style="width:100%;border-collapse:collapse;font-size:0.83rem">
          <thead><tr style="background:#F9FAFB">${headers.map(h=>`<th style="padding:8px 14px;text-align:${h.align||'left'};color:#6B7280;font-size:0.68rem;font-weight:800;letter-spacing:.06em">${h.label}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r=>`<tr style="border-top:1px solid #F3F4F6">${r.map(c=>`<td style="padding:7px 14px;text-align:${c.align||'left'};color:${c.color||'#374151'}">${c.html||esc(c.v)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>` : `<div style="padding:18px;text-align:center;color:#9CA3AF;font-size:0.82rem">No data returned.</div>`}
      </div>`;
    const fmt = n => Number(n||0).toLocaleString();
    const ancRows = (anc.anchors||[]).map(a => [
      { v: a.anchor || '(empty)', color: '#0A1628' },
      { v: fmt(a.backlinks), align: 'right' },
      { v: fmt(a.referring_domains), align: 'right' },
    ]);
    const pgsRows = (pgs.pages||[]).map(p => [
      { v: p.url || '', color: '#0A1628' },
      { v: fmt(p.backlinks), align: 'right' },
      { v: fmt(p.referring_domains), align: 'right' },
      { v: fmt(p.rank), align: 'right' },
    ]);
    const tldRows = (brk.tlds||[]).map(t => [{ v: t.tld, color: '#0A1628' }, { v: fmt(t.domains), align:'right' }, { v: fmt(t.backlinks), align:'right' }]);
    const ctyRows = (brk.countries||[]).map(t => [{ v: t.country, color: '#0A1628' }, { v: fmt(t.domains), align:'right' }, { v: fmt(t.backlinks), align:'right' }]);
    const note = (anc.note || pgs.note || brk.note) ? `<div style="background:#FEF3C7;color:#92400E;padding:10px 14px;border-radius:8px;font-size:0.78rem;margin-bottom:12px">${esc(anc.note||pgs.note||brk.note)}</div>` : '';
    out.innerHTML = note +
      tbl('🪧 Top Anchor Texts', [{label:'ANCHOR'},{label:'BACKLINKS',align:'right'},{label:'REF DOMAINS',align:'right'}], ancRows) +
      tbl('🏆 Top Linked Pages (yours)', [{label:'PAGE'},{label:'BACKLINKS',align:'right'},{label:'REF DOMAINS',align:'right'},{label:'RANK',align:'right'}], pgsRows) +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${tbl('🌐 Top Linking TLDs', [{label:'TLD'},{label:'DOMAINS',align:'right'},{label:'BACKLINKS',align:'right'}], tldRows)}
        ${tbl('🗺️ Top Linking Countries', [{label:'COUNTRY'},{label:'DOMAINS',align:'right'},{label:'BACKLINKS',align:'right'}], ctyRows)}
      </div>`;
  } catch (e) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${e.message}</div>`; }
};

// ── Tier 29 — Multi-Page SEO Crawler ───────────────────────────────────────
window.buildSeoCrawler = function() {
  const wrap = document.getElementById('scrWrap');
  if (!wrap) return;
  const esc = (window._escapeHtml) || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
  wrap.innerHTML = `
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:20px;margin-bottom:18px">
      <div style="font-weight:700;margin-bottom:12px">Start a new crawl</div>
      <div style="display:grid;grid-template-columns:2fr 1fr auto;gap:10px;align-items:end">
        <label>Root URL<input id="scr-url" type="url" placeholder="https://example.com" style="width:100%;padding:9px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
        <label>Max pages<select id="scr-max" style="width:100%;padding:9px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px">
          <option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option>
        </select></label>
        <button id="scr-go" class="btn btn-primary">🕸️ Start crawl</button>
      </div>
      <div id="scr-active" style="margin-top:14px"></div>
    </div>
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border-color,#e2e8f0);font-weight:700">Recent crawls</div>
      <div id="scr-list" style="padding:14px 20px;color:#64748b">Loading…</div>
    </div>
  `;
  let activeRunId = null, pollTimer = null;

  async function loadList() {
    const r = await fetch('/api/seo-crawler/runs').then(x=>x.json());
    const el = document.getElementById('scr-list');
    if (!r.ok || !r.runs.length) { el.innerHTML = '<div style="color:#64748b">No crawls yet — kick off your first one above.</div>'; return; }
    el.innerHTML = r.runs.map(run => {
      const grade = run.site_grade || '—';
      const score = run.avg_score != null ? Number(run.avg_score).toFixed(1) : '—';
      const gradeColor = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[grade] || '#64748b';
      const statusBadge = run.status === 'running' ? '<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:0.74rem">RUNNING</span>'
                       : run.status === 'partial' ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:0.74rem">PARTIAL</span>'
                       : run.status === 'failed' ? '<span style="background:#fee;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:0.74rem">FAILED</span>'
                       : '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:0.74rem">DONE</span>';
      return `<div style="padding:12px 0;border-top:1px solid var(--border-color,#e2e8f0);display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="font-size:1.6rem;font-weight:800;color:${gradeColor};min-width:42px;text-align:center">${grade}</div>
        <div style="flex:1;min-width:240px">
          <div style="font-weight:600">${esc(run.root_url)} ${statusBadge}</div>
          <div style="color:#64748b;font-size:0.82rem">${run.page_count} pages crawled · avg score ${score} · started ${new Date(run.started_at).toLocaleString()}</div>
        </div>
        <button class="btn btn-primary scr-view" data-id="${esc(run.id)}" style="font-size:0.82rem">🎯 Open Insights & Automate →</button>
        <button class="btn btn-secondary scr-recrawl" data-url="${esc(run.root_url)}" data-max="${run.max_pages||25}" style="font-size:0.82rem" title="Re-crawl this URL">🔄</button>
        <button class="btn btn-link scr-del" data-id="${esc(run.id)}" style="color:#dc2626;font-size:0.82rem">🗑</button>
      </div>`;
    }).join('');
    el.querySelectorAll('.scr-view').forEach(b => b.addEventListener('click', e => viewRun(e.currentTarget.getAttribute('data-id'))));
    el.querySelectorAll('.scr-del').forEach(b => b.addEventListener('click', async e => {
      if (!confirm('Delete this crawl run?')) return;
      await fetch('/api/seo-crawler/runs/' + e.currentTarget.getAttribute('data-id'), { method:'DELETE' });
      loadList();
    }));
    el.querySelectorAll('.scr-recrawl').forEach(b => b.addEventListener('click', async e => {
      const url = e.currentTarget.getAttribute('data-url');
      const maxPages = parseInt(e.currentTarget.getAttribute('data-max'), 10) || 25;
      const r2 = await fetch('/api/seo-crawler/run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url, maxPages }) }).then(x=>x.json());
      if (!r2.ok) { alert('Re-crawl failed: ' + (r2.error || 'unknown')); return; }
      activeRunId = r2.id;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollActive, 2500);
      pollActive();
      loadList();
    }));
  }

  async function viewRun(id) {
    const r = await fetch('/api/seo-crawler/runs/' + id).then(x=>x.json());
    if (!r.ok) { alert('Failed to load run'); return; }
    const run = r.run;
    const pages = r.pages || [];
    const agg = r.aggregate || { topIssues: [], quickWins: [], worstPages: [], totals: { pages: pages.length, failures: 0, warnings: 0, uniqueIssues: 0 } };
    const grade = run.site_grade || '—';
    const gradeColor = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[grade] || '#64748b';
    const sevColor = (n) => n === 0 ? '#16a34a' : n <= 2 ? '#ca8a04' : '#dc2626';

    const quickWinsHtml = agg.quickWins.length ? `
      <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;border-radius:10px;padding:14px;margin-bottom:16px">
        <div style="font-weight:700;color:#78350f;margin-bottom:8px">⚡ Quick wins — fix these first</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${agg.quickWins.map(q => `
            <div style="background:#fff;border-radius:6px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <div style="flex:1;min-width:240px">
                <div style="font-weight:600;color:#0f172a">${esc(q.label)}</div>
                <div style="font-size:0.78rem;color:#475569">Affects <strong>${q.pagesAffected}</strong> of ${agg.totals.pages} pages (${q.pctOfSite}%) · weight ${q.weight}</div>
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-secondary scr-issue-pages" data-cid="${esc(q.id)}" style="font-size:0.78rem;padding:5px 10px">View pages</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : '';

    const topIssuesHtml = agg.topIssues.length ? `
      <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:10px;margin-bottom:16px">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border-color,#e2e8f0);font-weight:700;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <span>🎯 Site-wide top issues (${agg.topIssues.length} unique)</span>
          <span style="font-size:0.78rem;color:#64748b;font-weight:500">Sorted by impact = pages × weight</span>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.86rem">
            <thead style="background:var(--bg-secondary,#f8fafc)"><tr>
              <th style="text-align:left;padding:10px">Issue</th>
              <th style="padding:10px;width:90px">Fail / Warn</th>
              <th style="padding:10px;width:90px">Pages</th>
              <th style="padding:10px;width:80px">Impact</th>
              <th style="padding:10px;width:140px">Action</th>
            </tr></thead>
            <tbody>
              ${agg.topIssues.map(i => `
                <tr style="border-top:1px solid var(--border-color,#e2e8f0)">
                  <td style="padding:8px 10px">
                    <div style="font-weight:600">${esc(i.label)}</div>
                    ${i.fix ? `<div style="font-size:0.78rem;color:#0369a1;margin-top:3px"><strong>Fix:</strong> ${esc(i.fix)}</div>` : ''}
                  </td>
                  <td style="padding:8px 10px;text-align:center"><span style="color:#dc2626;font-weight:700">${i.failCount}</span> / <span style="color:#ca8a04;font-weight:700">${i.warnCount}</span></td>
                  <td style="padding:8px 10px;text-align:center"><strong>${i.pagesAffected}</strong> <span style="color:#64748b">(${i.pctOfSite}%)</span></td>
                  <td style="padding:8px 10px;text-align:center;font-weight:700">${i.impact}</td>
                  <td style="padding:8px 10px"><button class="btn btn-link scr-issue-pages" data-cid="${esc(i.id)}" style="font-size:0.78rem;padding:0">View pages →</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    const worstPagesHtml = agg.worstPages.length ? `
      <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:10px;margin-bottom:16px">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border-color,#e2e8f0);font-weight:700">🔥 Worst-offender pages (lowest scores)</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.86rem">
            <thead style="background:var(--bg-secondary,#f8fafc)"><tr>
              <th style="text-align:left;padding:10px">Page</th>
              <th style="padding:10px;width:70px">Score</th>
              <th style="padding:10px;width:60px">Grade</th>
              <th style="padding:10px;width:160px">Issues</th>
              <th style="padding:10px;width:120px">Action</th>
            </tr></thead>
            <tbody>
              ${agg.worstPages.map(p => {
                const pg = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[p.grade] || '#64748b';
                const s = p.summary || {};
                return `<tr style="border-top:1px solid var(--border-color,#e2e8f0)">
                  <td style="padding:8px 10px"><a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:#0369a1;word-break:break-all">${esc(p.url)}</a></td>
                  <td style="padding:8px 10px;text-align:center;font-weight:700">${p.score}</td>
                  <td style="padding:8px 10px;text-align:center;font-weight:800;color:${pg}">${p.grade}</td>
                  <td style="padding:8px 10px;color:#64748b">${s.passed||0}✓ <span style="color:#ca8a04">${s.warned||0}⚠</span> <span style="color:${sevColor(s.failed||0)}">${s.failed||0}✕</span></td>
                  <td style="padding:8px 10px"><button class="btn btn-link scr-audit-page" data-url="${esc(p.url)}" style="font-size:0.78rem;padding:0">Re-audit →</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    const allPagesHtml = `
      <details style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:10px;margin-bottom:16px">
        <summary style="padding:12px 16px;font-weight:700;cursor:pointer">📄 All ${pages.length} crawled pages</summary>
        <div style="overflow-x:auto;border-top:1px solid var(--border-color,#e2e8f0)">
          <table style="width:100%;border-collapse:collapse;font-size:0.86rem">
            <thead style="background:var(--bg-secondary,#f8fafc)"><tr>
              <th style="text-align:left;padding:10px">Page</th>
              <th style="padding:10px;width:70px">Score</th>
              <th style="padding:10px;width:60px">Grade</th>
              <th style="padding:10px">Issues</th>
            </tr></thead>
            <tbody>
              ${pages.map(p => {
                const pg = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[p.grade] || '#64748b';
                const s = p.summary || {};
                return `<tr style="border-top:1px solid var(--border-color,#e2e8f0)">
                  <td style="padding:8px 10px"><a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:#0369a1;word-break:break-all">${esc(p.url)}</a></td>
                  <td style="padding:8px 10px;text-align:center;font-weight:700">${p.score}</td>
                  <td style="padding:8px 10px;text-align:center;font-weight:800;color:${pg}">${p.grade}</td>
                  <td style="padding:8px 10px;color:#64748b">${s.passed||0} pass · ${s.warned||0} warn · <span style="color:#dc2626">${s.failed||0} fail</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </details>`;

    const html = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto" id="scr-modal-bg">
        <div style="background:var(--bg-secondary,#f8fafc);border-radius:12px;max-width:1100px;width:100%;padding:24px;margin:auto">
          <div style="background:var(--card-bg,#fff);border-radius:10px;padding:18px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
            <div style="flex:1;min-width:240px">
              <div style="font-weight:700;font-size:1.1rem;word-break:break-all">${esc(run.root_url)}</div>
              <div style="color:#64748b;font-size:0.84rem;margin-top:3px">${pages.length} pages · ${esc(run.status)} · ${agg.totals.failures} fails · ${agg.totals.warnings} warnings · ${agg.totals.uniqueIssues} unique issues</div>
            </div>
            <div style="display:flex;gap:14px;align-items:center">
              <div style="text-align:center"><div style="font-size:2.4rem;font-weight:800;color:${gradeColor};line-height:1">${grade}</div><div style="font-size:0.74rem;color:#64748b">Site grade · ${run.avg_score != null ? Number(run.avg_score).toFixed(1) : '—'}/100</div></div>
              <button id="scr-modal-close" class="btn btn-link" style="font-size:1.4rem">✕</button>
            </div>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
            <button id="scr-import-fails" class="btn btn-primary" style="font-size:0.86rem">🚀 Send all CRITICAL issues to SEO Task Manager</button>
            <button id="scr-import-all" class="btn btn-secondary" style="font-size:0.86rem">📋 Send ALL issues (fails + warnings)</button>
            <a href="/api/seo-crawler/runs/${esc(id)}/export.csv" class="btn btn-secondary" style="font-size:0.86rem;text-decoration:none" download>⬇️ Export CSV</a>
            <button id="scr-open-tasks" class="btn btn-secondary" style="font-size:0.86rem">📋 Open SEO Task Manager →</button>
          </div>
          <div id="scr-import-result" style="margin-bottom:14px"></div>

          ${(!agg.topIssues.length && pages.length > 0) ? `
            <div style="background:#FFFBEB;border:1px solid #F59E0B;border-radius:10px;padding:18px;margin-bottom:16px">
              <div style="font-weight:700;color:#78350F;margin-bottom:6px">⚠️ This crawl was run before per-check insights were enabled</div>
              <div style="font-size:0.86rem;color:#78350F;line-height:1.55;margin-bottom:12px">${pages.length} page${pages.length===1?'':'s'} were crawled but the per-check details weren't stored, so we can't show top issues, quick wins or send tasks to the SEO Task Manager. Re-run the crawl below to unlock all the new automation features.</div>
              <button id="scr-recrawl-now" class="btn btn-primary" style="font-size:0.86rem">🔄 Re-crawl ${esc(run.root_url)} now</button>
            </div>
          ` : (!pages.length ? `
            <div style="background:#FFFBEB;border:1px solid #F59E0B;border-radius:10px;padding:18px;margin-bottom:16px;color:#78350F;font-size:0.9rem">No pages were crawled in this run. Try again with a publicly reachable URL.</div>
          ` : '')}

          ${quickWinsHtml}
          ${topIssuesHtml}
          ${worstPagesHtml}
          ${allPagesHtml}
        </div>
      </div>`;
    const wrapEl = document.createElement('div');
    wrapEl.innerHTML = html;
    document.body.appendChild(wrapEl);
    const close = () => wrapEl.remove();
    document.getElementById('scr-modal-close').addEventListener('click', close);
    document.getElementById('scr-modal-bg').addEventListener('click', e => { if (e.target.id === 'scr-modal-bg') close(); });

    const importBtn = (onlyFails) => async () => {
      const resBox = document.getElementById('scr-import-result');
      resBox.innerHTML = `<div style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;padding:10px 14px;border-radius:8px;font-size:0.86rem">⏳ Sending issues to SEO Task Manager…</div>`;
      try {
        const r2 = await fetch('/api/seo-crawler/runs/' + id + '/import-tasks', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ onlyFails })
        }).then(x=>x.json());
        if (!r2.ok) throw new Error(r2.error || 'Import failed');
        resBox.innerHTML = `<div style="background:#dcfce7;border:1px solid #86efac;color:#166534;padding:10px 14px;border-radius:8px;font-size:0.86rem">✓ Created <strong>${r2.created}</strong> new tasks · skipped ${r2.skipped} existing · out of ${r2.total} total issues. <a href="#" id="scr-goto-tasks" style="color:#166534;text-decoration:underline;margin-left:6px">Open SEO Task Manager →</a></div>`;
        const goto = document.getElementById('scr-goto-tasks');
        if (goto) goto.addEventListener('click', e => { e.preventDefault(); close(); if (window.navigateTo) window.navigateTo('seo-tasks'); });
      } catch (e) {
        resBox.innerHTML = `<div style="background:#fee;color:#b91c1c;padding:10px 14px;border-radius:8px;font-size:0.86rem">✕ ${esc(e.message)}</div>`;
      }
    };
    document.getElementById('scr-import-fails').addEventListener('click', importBtn(true));
    document.getElementById('scr-import-all').addEventListener('click', importBtn(false));
    document.getElementById('scr-open-tasks').addEventListener('click', () => { close(); if (window.navigateTo) window.navigateTo('seo-tasks'); });
    const recrawlBtn = document.getElementById('scr-recrawl-now');
    if (recrawlBtn) recrawlBtn.addEventListener('click', async () => {
      recrawlBtn.disabled = true; recrawlBtn.textContent = '⏳ Starting re-crawl…';
      const r2 = await fetch('/api/seo-crawler/run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: run.root_url, maxPages: run.max_pages || 25 }) }).then(x=>x.json()).catch(e=>({ok:false,error:e.message}));
      if (!r2.ok) { alert('Re-crawl failed: ' + (r2.error || 'unknown')); recrawlBtn.disabled = false; recrawlBtn.textContent = '🔄 Re-crawl ' + run.root_url + ' now'; return; }
      close();
      activeRunId = r2.id;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollActive, 2500);
      pollActive();
      loadList();
    });

    // "View pages" → drill into which pages have a specific issue.
    wrapEl.querySelectorAll('.scr-issue-pages').forEach(b => b.addEventListener('click', e => {
      const cid = e.currentTarget.getAttribute('data-cid');
      const issue = agg.topIssues.find(i => i.id === cid);
      if (!issue) return;
      const pagesList = [
        ...issue.sampleFailPages.map(u => ({ u, sev:'fail' })),
        ...issue.sampleWarnPages.map(u => ({ u, sev:'warn' }))
      ];
      const popHtml = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px" id="scr-pop-bg">
          <div style="background:var(--card-bg,#fff);border-radius:10px;max-width:640px;width:100%;max-height:80vh;overflow-y:auto;padding:20px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <div style="font-weight:700">${esc(issue.label)}</div>
              <button id="scr-pop-close" class="btn btn-link" style="font-size:1.2rem">✕</button>
            </div>
            <div style="font-size:0.84rem;color:#475569;margin-bottom:10px">${esc(issue.message || '')}</div>
            ${issue.fix ? `<div style="background:#f0f9ff;border-left:3px solid #0369a1;padding:9px 12px;border-radius:4px;margin-bottom:12px;font-size:0.86rem"><strong>Fix:</strong> ${esc(issue.fix)}</div>` : ''}
            <div style="font-weight:600;margin-bottom:6px;font-size:0.86rem">Affected pages (showing up to 10):</div>
            <div style="display:flex;flex-direction:column;gap:4px">
              ${pagesList.map(p => `<div style="display:flex;gap:8px;align-items:center"><span style="color:${p.sev==='fail'?'#dc2626':'#ca8a04'};font-weight:700;width:50px">${p.sev.toUpperCase()}</span><a href="${esc(p.u)}" target="_blank" rel="noopener" style="color:#0369a1;word-break:break-all;font-size:0.84rem">${esc(p.u)}</a></div>`).join('')}
            </div>
          </div>
        </div>`;
      const pop = document.createElement('div');
      pop.innerHTML = popHtml;
      document.body.appendChild(pop);
      const closePop = () => pop.remove();
      document.getElementById('scr-pop-close').addEventListener('click', closePop);
      document.getElementById('scr-pop-bg').addEventListener('click', ev => { if (ev.target.id === 'scr-pop-bg') closePop(); });
    }));

    // Re-audit a single page → routes to single-page SEO Auditor view with URL pre-filled.
    wrapEl.querySelectorAll('.scr-audit-page').forEach(b => b.addEventListener('click', e => {
      const u = e.currentTarget.getAttribute('data-url');
      close();
      window._seoAuditorPrefill = u;
      if (window.navigateTo) window.navigateTo('seo-auditor');
    }));
  }

  async function pollActive() {
    if (!activeRunId) return;
    const r = await fetch('/api/seo-crawler/runs/' + activeRunId).then(x=>x.json()).catch(() => null);
    if (!r || !r.ok) return;
    const run = r.run;
    const live = r.live || {};
    document.getElementById('scr-active').innerHTML = `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;font-size:0.88rem">
        <div style="font-weight:600;color:#1e40af">${run.status === 'running' ? '⏳ Crawling…' : run.status === 'completed' ? '✓ Crawl complete' : '⚠️ ' + run.status}</div>
        <div style="color:#475569;margin-top:4px">${run.root_url} · ${run.page_count || live.progress || 0} / ${run.max_pages} pages${(live.errors ? ' · ' + live.errors + ' fetch errors' : '')}</div>
      </div>`;
    if (run.status !== 'running') {
      activeRunId = null;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      loadList();
    }
  }

  document.getElementById('scr-go').addEventListener('click', async () => {
    const url = document.getElementById('scr-url').value.trim();
    if (!url) { alert('Enter a URL.'); return; }
    const maxPages = parseInt(document.getElementById('scr-max').value, 10);
    const r = await fetch('/api/seo-crawler/run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url, maxPages }) }).then(x=>x.json());
    if (!r.ok) { alert('Failed: ' + (r.error || 'unknown')); return; }
    activeRunId = r.id;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollActive, 2500);
    pollActive();
    loadList();
  });

  loadList();
};

// ── Tier 30 — GEO Audit (Generative Engine Optimization) ───────────────────
window.buildGeoAudit = function() {
  const wrap = document.getElementById('geoWrap');
  if (!wrap) return;
  const esc = (window._escapeHtml) || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
  wrap.innerHTML = `
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:20px;margin-bottom:18px">
      <div style="font-weight:700;margin-bottom:12px">Run a GEO audit</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end">
        <label>Page URL<input id="geo-url" type="url" placeholder="https://example.com/your-best-article" style="width:100%;padding:9px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
        <button id="geo-go" class="btn btn-primary">🤖 Audit page</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px;color:#475569;font-size:0.86rem;cursor:pointer">
        <input id="geo-headless" type="checkbox"> Render with real browser (slower, but works for SPA / JavaScript-heavy sites)
      </label>
      <p style="color:#64748b;font-size:0.84rem;margin-top:10px;margin-bottom:0">Scores how well a page is structured to be cited by ChatGPT, Perplexity and Gemini. Different from classic SEO — focuses on AI snippet extractability.</p>
    </div>
    <div id="geo-result" style="margin-bottom:18px"></div>
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border-color,#e2e8f0);font-weight:700">Recent audits</div>
      <div id="geo-list" style="padding:14px 20px;color:#64748b">Loading…</div>
    </div>
  `;
  function renderResult(r) {
    const gradeColor = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[r.grade] || '#64748b';
    const sortedChecks = (r.checks || []).slice().sort((a,b) => {
      const ord = { fail: 0, warn: 1, pass: 2 };
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return b.weight - a.weight;
    });
    document.getElementById('geo-result').innerHTML = `
      <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:24px">
        <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:18px">
          <div style="text-align:center;min-width:110px">
            <div style="font-size:3.6rem;font-weight:800;color:${gradeColor};line-height:1">${r.grade}</div>
            <div style="color:#64748b;font-size:0.84rem">GEO grade</div>
          </div>
          <div style="text-align:center;min-width:110px">
            <div style="font-size:2.4rem;font-weight:800">${r.score}</div>
            <div style="color:#64748b;font-size:0.84rem">out of 100</div>
          </div>
          <div style="flex:1;min-width:240px">
            <div style="word-break:break-all;font-weight:600">${esc(r.url)}</div>
            <div style="color:#64748b;font-size:0.84rem;margin-top:4px">${(r.summary && r.summary.passed)||0} pass · ${(r.summary && r.summary.warned)||0} warn · <span style="color:#dc2626">${(r.summary && r.summary.failed)||0} fail</span> · ${(r.summary && r.summary.words)||0} words</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${sortedChecks.map(c => {
            const sColor = c.status === 'pass' ? '#16a34a' : c.status === 'warn' ? '#ca8a04' : '#dc2626';
            const sIcon  = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✕';
            return `<div style="border:1px solid var(--border-color,#e2e8f0);border-left:4px solid ${sColor};border-radius:6px;padding:10px 14px">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
                <div style="font-weight:600"><span style="color:${sColor};margin-right:6px;font-weight:800">${sIcon}</span>${esc(c.label)}</div>
                <div style="color:#64748b;font-size:0.78rem">${c.earned}/${c.weight} pts</div>
              </div>
              <div style="color:#475569;font-size:0.86rem;margin-top:4px">${esc(c.message)}</div>
              ${c.fix && c.status !== 'pass' ? `<div style="color:#0369a1;font-size:0.84rem;margin-top:6px;background:#f0f9ff;padding:8px 10px;border-radius:4px"><strong>Fix:</strong> ${esc(c.fix)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }
  async function loadList() {
    const r = await fetch('/api/geo-audit/runs').then(x=>x.json());
    const el = document.getElementById('geo-list');
    if (!r.ok || !r.runs.length) { el.innerHTML = '<div style="color:#64748b">No audits yet — run your first one above.</div>'; return; }
    el.innerHTML = r.runs.map(run => {
      const gradeColor = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[run.grade] || '#64748b';
      return `<div style="padding:10px 0;border-top:1px solid var(--border-color,#e2e8f0);display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="font-size:1.4rem;font-weight:800;color:${gradeColor};min-width:36px;text-align:center">${run.grade}</div>
        <div style="flex:1;min-width:240px">
          <div style="font-weight:600;word-break:break-all">${esc(run.url)}</div>
          <div style="color:#64748b;font-size:0.78rem">Score ${run.score} · ${new Date(run.created_at).toLocaleString()}</div>
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('geo-go').addEventListener('click', async () => {
    const url = document.getElementById('geo-url').value.trim();
    if (!url) { alert('Enter a URL.'); return; }
    const btn = document.getElementById('geo-go');
    btn.disabled = true; btn.textContent = '⏳ Auditing…';
    document.getElementById('geo-result').innerHTML = '<div style="text-align:center;padding:32px;color:#64748b">Fetching page and running 12 GEO checks…</div>';
    const headless = !!document.getElementById('geo-headless') && document.getElementById('geo-headless').checked;
    const r = await fetch('/api/geo-audit/run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url, headless }) }).then(x=>x.json());
    btn.disabled = false; btn.textContent = '🤖 Audit page';
    if (!r.ok) { document.getElementById('geo-result').innerHTML = '<div style="background:#fee;color:#dc2626;padding:16px;border-radius:8px">Failed: ' + esc(r.error || 'unknown') + '</div>'; return; }
    renderResult(r);
    loadList();
  });
  loadList();
};

// ── Tier 31 — Local SEO Basics ─────────────────────────────────────────────
window.buildLocalSeo = function() {
  const wrap = document.getElementById('lsWrap');
  if (!wrap) return;
  const esc = (window._escapeHtml) || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
  wrap.innerHTML = `
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:20px;margin-bottom:18px">
      <div style="font-weight:700;margin-bottom:12px">Run a Local SEO audit</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end">
        <label>Page URL (homepage or contact page works best)<input id="ls-url" type="url" placeholder="https://yourbusiness.com" style="width:100%;padding:9px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
        <button id="ls-go" class="btn btn-primary">📍 Audit page</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px;color:#475569;font-size:0.86rem;cursor:pointer">
        <input id="ls-headless" type="checkbox"> Render with real browser (slower, but works for SPA / JavaScript-heavy sites)
      </label>
      <p style="color:#64748b;font-size:0.84rem;margin-top:10px;margin-bottom:0">For brick-and-mortar and service-area businesses. 11 checks summing to 100 points covering NAP, schema, GBP link, hours, click-to-call and more.</p>
    </div>
    <div id="ls-result" style="margin-bottom:18px"></div>
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border-color,#e2e8f0);font-weight:700">Recent audits</div>
      <div id="ls-list" style="padding:14px 20px;color:#64748b">Loading…</div>
    </div>
  `;
  function renderResult(r) {
    const gradeColor = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[r.grade] || '#64748b';
    const sortedChecks = (r.checks || []).slice().sort((a,b) => {
      const ord = { fail: 0, warn: 1, pass: 2 };
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return b.weight - a.weight;
    });
    document.getElementById('ls-result').innerHTML = `
      <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:24px">
        <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:18px">
          <div style="text-align:center;min-width:110px">
            <div style="font-size:3.6rem;font-weight:800;color:${gradeColor};line-height:1">${r.grade}</div>
            <div style="color:#64748b;font-size:0.84rem">Local SEO grade</div>
          </div>
          <div style="text-align:center;min-width:110px">
            <div style="font-size:2.4rem;font-weight:800">${r.score}</div>
            <div style="color:#64748b;font-size:0.84rem">out of 100</div>
          </div>
          <div style="flex:1;min-width:240px">
            <div style="word-break:break-all;font-weight:600">${esc(r.url)}</div>
            <div style="color:#64748b;font-size:0.84rem;margin-top:4px">${(r.summary && r.summary.passed)||0} pass · ${(r.summary && r.summary.warned)||0} warn · <span style="color:#dc2626">${(r.summary && r.summary.failed)||0} fail</span></div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${sortedChecks.map(c => {
            const sColor = c.status === 'pass' ? '#16a34a' : c.status === 'warn' ? '#ca8a04' : '#dc2626';
            const sIcon  = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✕';
            return `<div style="border:1px solid var(--border-color,#e2e8f0);border-left:4px solid ${sColor};border-radius:6px;padding:10px 14px">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
                <div style="font-weight:600"><span style="color:${sColor};margin-right:6px;font-weight:800">${sIcon}</span>${esc(c.label)}</div>
                <div style="color:#64748b;font-size:0.78rem">${c.earned}/${c.weight} pts</div>
              </div>
              <div style="color:#475569;font-size:0.86rem;margin-top:4px">${esc(c.message)}</div>
              ${c.fix && c.status !== 'pass' ? `<div style="color:#0369a1;font-size:0.84rem;margin-top:6px;background:#f0f9ff;padding:8px 10px;border-radius:4px"><strong>Fix:</strong> ${esc(c.fix)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }
  async function loadList() {
    const r = await fetch('/api/local-seo/runs').then(x=>x.json());
    const el = document.getElementById('ls-list');
    if (!r.ok || !r.runs.length) { el.innerHTML = '<div style="color:#64748b">No audits yet — run your first one above.</div>'; return; }
    el.innerHTML = r.runs.map(run => {
      const gradeColor = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[run.grade] || '#64748b';
      return `<div style="padding:10px 0;border-top:1px solid var(--border-color,#e2e8f0);display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="font-size:1.4rem;font-weight:800;color:${gradeColor};min-width:36px;text-align:center">${run.grade}</div>
        <div style="flex:1;min-width:240px">
          <div style="font-weight:600;word-break:break-all">${esc(run.url)}</div>
          <div style="color:#64748b;font-size:0.78rem">Score ${run.score} · ${new Date(run.created_at).toLocaleString()}</div>
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('ls-go').addEventListener('click', async () => {
    const url = document.getElementById('ls-url').value.trim();
    if (!url) { alert('Enter a URL.'); return; }
    const btn = document.getElementById('ls-go');
    btn.disabled = true; btn.textContent = '⏳ Auditing…';
    document.getElementById('ls-result').innerHTML = '<div style="text-align:center;padding:32px;color:#64748b">Running 11 local SEO checks…</div>';
    const headless = !!document.getElementById('ls-headless') && document.getElementById('ls-headless').checked;
    const r = await fetch('/api/local-seo/run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url, headless }) }).then(x=>x.json());
    btn.disabled = false; btn.textContent = '📍 Audit page';
    if (!r.ok) { document.getElementById('ls-result').innerHTML = '<div style="background:#fee;color:#dc2626;padding:16px;border-radius:8px">Failed: ' + esc(r.error || 'unknown') + '</div>'; return; }
    renderResult(r);
    loadList();
  });
  loadList();
};

// ── Tier 32 — Social Tags Audit ────────────────────────────────────────────
window.buildSocialTags = function() {
  const wrap = document.getElementById('socialTagsWrap');
  if (!wrap) return;
  const esc = (window._escapeHtml) || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
  wrap.innerHTML = `
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:20px;margin-bottom:18px">
      <div style="font-weight:700;margin-bottom:12px">Audit social tags &amp; tracking</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end">
        <label>Page URL<input id="st-url" type="url" placeholder="https://example.com" style="width:100%;padding:9px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:6px;background:var(--card-bg,#fff);margin-top:4px"></label>
        <button id="st-go" class="btn btn-primary">🔖 Audit page</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px;color:#475569;font-size:0.86rem;cursor:pointer">
        <input id="st-headless" type="checkbox"> Render with real browser (slower, but works for SPA / JavaScript-heavy sites)
      </label>
      <p style="color:#64748b;font-size:0.84rem;margin-top:10px;margin-bottom:0">13 checks for Open Graph, Twitter Cards, Facebook Pixel, GA4, social profile links, favicon and Apple touch icon.</p>
    </div>
    <div id="st-result" style="margin-bottom:18px"></div>
    <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border-color,#e2e8f0);font-weight:700">Recent audits</div>
      <div id="st-list" style="padding:14px 20px;color:#64748b">Loading…</div>
    </div>
  `;
  function renderResult(r) {
    const gradeColor = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[r.grade] || '#64748b';
    const sortedChecks = (r.checks || []).slice().sort((a,b) => {
      const ord = { fail: 0, warn: 1, pass: 2 };
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return b.weight - a.weight;
    });
    const platforms = (r.summary && r.summary.platforms) || [];
    document.getElementById('st-result').innerHTML = `
      <div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:24px">
        <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:18px">
          <div style="text-align:center;min-width:110px">
            <div style="font-size:3.6rem;font-weight:800;color:${gradeColor};line-height:1">${r.grade}</div>
            <div style="color:#64748b;font-size:0.84rem">Social tag grade</div>
          </div>
          <div style="text-align:center;min-width:110px">
            <div style="font-size:2.4rem;font-weight:800">${r.score}</div>
            <div style="color:#64748b;font-size:0.84rem">out of 100</div>
          </div>
          <div style="flex:1;min-width:240px">
            <div style="word-break:break-all;font-weight:600">${esc(r.url)}</div>
            <div style="color:#64748b;font-size:0.84rem;margin-top:4px">${(r.summary && r.summary.passed)||0} pass · ${(r.summary && r.summary.warned)||0} warn · <span style="color:#dc2626">${(r.summary && r.summary.failed)||0} fail</span>${platforms.length ? ' · profiles: ' + esc(platforms.join(', ')) : ''}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${sortedChecks.map(c => {
            const sColor = c.status === 'pass' ? '#16a34a' : c.status === 'warn' ? '#ca8a04' : '#dc2626';
            const sIcon  = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✕';
            return `<div style="border:1px solid var(--border-color,#e2e8f0);border-left:4px solid ${sColor};border-radius:6px;padding:10px 14px">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
                <div style="font-weight:600"><span style="color:${sColor};margin-right:6px;font-weight:800">${sIcon}</span>${esc(c.label)}</div>
                <div style="color:#64748b;font-size:0.78rem">${c.earned}/${c.weight} pts</div>
              </div>
              <div style="color:#475569;font-size:0.86rem;margin-top:4px">${esc(c.message)}</div>
              ${c.fix && c.status !== 'pass' ? `<div style="color:#0369a1;font-size:0.84rem;margin-top:6px;background:#f0f9ff;padding:8px 10px;border-radius:4px"><strong>Fix:</strong> ${esc(c.fix)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }
  async function loadList() {
    const r = await fetch('/api/social-tags/runs').then(x=>x.json());
    const el = document.getElementById('st-list');
    if (!r.ok || !r.runs.length) { el.innerHTML = '<div style="color:#64748b">No audits yet — run your first one above.</div>'; return; }
    el.innerHTML = r.runs.map(run => {
      const gradeColor = { 'A':'#16a34a','B':'#65a30d','C':'#ca8a04','D':'#ea580c','F':'#dc2626' }[run.grade] || '#64748b';
      return `<div style="padding:10px 0;border-top:1px solid var(--border-color,#e2e8f0);display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="font-size:1.4rem;font-weight:800;color:${gradeColor};min-width:36px;text-align:center">${run.grade}</div>
        <div style="flex:1;min-width:240px">
          <div style="font-weight:600;word-break:break-all">${esc(run.url)}</div>
          <div style="color:#64748b;font-size:0.78rem">Score ${run.score} · ${new Date(run.created_at).toLocaleString()}</div>
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('st-go').addEventListener('click', async () => {
    const url = document.getElementById('st-url').value.trim();
    if (!url) { alert('Enter a URL.'); return; }
    const btn = document.getElementById('st-go');
    btn.disabled = true; btn.textContent = '⏳ Auditing…';
    document.getElementById('st-result').innerHTML = '<div style="text-align:center;padding:32px;color:#64748b">Running 13 social tag checks…</div>';
    const headless = !!document.getElementById('st-headless') && document.getElementById('st-headless').checked;
    const r = await fetch('/api/social-tags/run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url, headless }) }).then(x=>x.json());
    btn.disabled = false; btn.textContent = '🔖 Audit page';
    if (!r.ok) { document.getElementById('st-result').innerHTML = '<div style="background:#fee;color:#dc2626;padding:16px;border-radius:8px">Failed: ' + esc(r.error || 'unknown') + '</div>'; return; }
    renderResult(r);
    loadList();
  });
  loadList();
};
