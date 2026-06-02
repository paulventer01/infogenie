/* ============================================================================
 * ig_content_traffic.js — Content Score (T39-A) · AI Traffic Monitor · Visibility Leaderboard
 * Extracted verbatim from app.js (per public/js/README.md). Plain global script,
 * loaded after app.js in index.html. Public entries: window.buildContentScore,
 * window.buildAiTrafficMonitor, window.buildVisLeaderboard.
 * ========================================================================== */

// ============================================================================
// T39-A — Content Score Auto-Optimize
// ============================================================================
window.buildContentScore = function() {
  const wrap = document.getElementById('contentScoreWrap'); if (!wrap) return;
  const prefUrl = (window._currentAnalysis?.url || window.analysisData?.url || '').trim();
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
      <h3 style="margin:0 0 12px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">📊 Content Score Analyzer</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">PAGE URL</label>
          <input id="csUrl" value="${_escapeHtml(prefUrl)}" placeholder="https://yoursite.com/blog/post" style="width:100%;padding:8px;border:1.5px solid #D1D5DB;border-radius:6px;font-size:0.84rem;box-sizing:border-box;background:${prefUrl?'#F0FDF4':'#fff'}">
        </div>
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">TARGET KEYWORD <span style="color:#9CA3AF;font-weight:400">(optional)</span></label>
          <input id="csKw" placeholder="e.g. email marketing software" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;box-sizing:border-box">
        </div>
        <button id="csGo" style="padding:9px 20px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);border:none;border-radius:6px;color:#fff;font-size:0.84rem;font-weight:800;cursor:pointer;white-space:nowrap">Analyze</button>
      </div>
    </div>
    <div id="csOut"></div>`;

  document.getElementById('csGo').addEventListener('click', async () => {
    const url = document.getElementById('csUrl').value.trim();
    const kw  = document.getElementById('csKw').value.trim();
    const out = document.getElementById('csOut');
    if (!url) { out.innerHTML = '<div style="color:#991B1B">⚠ URL is required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF;padding:20px 0">⏳ Fetching page and scoring…</div>';
    try {
      const r = await fetch('/api/content-score/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, keyword: kw }),
      }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;border-radius:8px;padding:14px">${_escapeHtml(r.error)}</div>`; return; }
      window._csLastResult = r;
      _csRender(out, r);
    } catch(e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

function _csRender(out, r) {
  const score = r.score || 0;
  const scoreColor = score >= 80 ? '#10B981' : score >= 55 ? '#F59E0B' : '#EF4444';
  const scoreBg    = score >= 80 ? '#ECFDF5' : score >= 55 ? '#FFFBEB' : '#FEF2F2';
  const subscoreOrder = ['keyTerms','metaTags','contentDepth','headings','featuredSnippet','schema','links','images'];
  const statusIcon = { pass: '✅', warn: '⚠️', fail: '❌' };
  out.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        <div style="text-align:center;min-width:90px">
          <div style="font-size:2.8rem;font-weight:900;color:${scoreColor};line-height:1">${score}</div>
          <div style="font-size:0.72rem;color:#6B7280;font-weight:700;margin-top:2px">/ 100</div>
          <div style="font-size:0.68rem;font-weight:800;padding:2px 10px;border-radius:10px;background:${scoreBg};color:${scoreColor};margin-top:4px">${score>=80?'STRONG':score>=55?'NEEDS WORK':'CRITICAL'}</div>
        </div>
        <div style="flex:1;min-width:180px">
          <div style="height:10px;background:#E5E7EB;border-radius:10px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:${score}%;background:${scoreColor};border-radius:10px;transition:width .4s"></div>
          </div>
          <div style="font-size:0.78rem;color:#374151">Signals: ${r.signals?.wordCount||0} words · ${r.signals?.h1Count||0}×H1 · ${r.signals?.h2Count||0}×H2 · Schema: ${(r.signals?.schemaTypes||[]).length} types</div>
          ${kw?`<div style="font-size:0.72rem;color:#6B7280;margin-top:3px">Keyword: <strong>"${_escapeHtml(r.keyword)}"</strong></div>`:''}
        </div>
        <button id="csAutoOpt" style="padding:9px 18px;background:linear-gradient(135deg,#10B981,#0EA5E9);border:none;border-radius:8px;color:#fff;font-size:0.82rem;font-weight:800;cursor:pointer">⚡ Auto-Optimize All</button>
      </div>
    </div>
    <div style="display:grid;gap:8px" id="csBreakdown">
      ${subscoreOrder.map(k => {
        const b = r.breakdown[k]; if (!b) return '';
        const pct = Math.round((b.score / b.max) * 100);
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:9px;padding:12px 14px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:1rem">${statusIcon[b.status]||'⚪'}</span>
            <div style="flex:1">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-size:0.84rem;font-weight:700;color:#0A1628">${_escapeHtml(b.label)}</span>
                <span style="font-size:0.78rem;font-weight:800;color:${b.status==='pass'?'#10B981':b.status==='warn'?'#F59E0B':'#EF4444'}">${b.score}/${b.max}</span>
              </div>
              <div style="height:5px;background:#F3F4F6;border-radius:5px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${b.status==='pass'?'#10B981':b.status==='warn'?'#F59E0B':'#EF4444'};border-radius:5px"></div>
              </div>
              ${b.detail?`<div style="font-size:0.72rem;color:#6B7280;margin-top:4px">${_escapeHtml(b.detail)}</div>`:''}
            </div>
            ${b.status !== 'pass' ? `<button onclick="window._csFixIt('${k}')" data-key="${k}" style="flex-shrink:0;padding:5px 12px;background:#EDE9FE;border:none;border-radius:5px;color:#7C3AED;font-size:0.7rem;font-weight:800;cursor:pointer">🔧 Fix It</button>` : ''}
          </div>
          <div id="csFix_${k}" style="display:none;margin-top:8px;padding:10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.78rem;color:#374151;line-height:1.5"></div>
        </div>`;
      }).join('')}
    </div>
    <div id="csAutoOptOut" style="margin-top:14px"></div>`;

  const kw = r.keyword;
  document.getElementById('csAutoOpt')?.addEventListener('click', async () => {
    const btn = document.getElementById('csAutoOpt');
    const aOut = document.getElementById('csAutoOptOut');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Optimizing…'; }
    aOut.innerHTML = '<div style="color:#9CA3AF;font-size:0.82rem">⏳ Running AI fixes on all failing subscores…</div>';
    try {
      const url = document.getElementById('csUrl')?.value.trim() || r.url;
      const res = await fetch('/api/content-score/auto-optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, keyword: kw }),
      }).then(x => x.json());
      if (!res.ok) { aOut.innerHTML = `<div style="color:#991B1B">${_escapeHtml(res.error)}</div>`; return; }
      const fixEntries = Object.entries(res.fixes || {});
      if (!fixEntries.length) { aOut.innerHTML = '<div style="color:#10B981;font-size:0.82rem">✅ All subscores passing — nothing to fix!</div>'; return; }
      aOut.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
        <div style="font-size:0.86rem;font-weight:800;color:#0A1628;margin-bottom:12px">⚡ Auto-Optimization Report</div>
        <div style="display:grid;gap:10px">
          ${fixEntries.map(([k, f]) => `
            <div style="border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px">
              <div style="font-size:0.78rem;font-weight:800;color:#7C3AED;margin-bottom:5px">${_escapeHtml(f.label)}</div>
              <div style="font-size:0.8rem;color:#374151;line-height:1.5">${_escapeHtml(f.suggestion)}</div>
              ${f.example?`<div style="margin-top:6px;padding:7px 10px;background:#F9FAFB;border-radius:5px;font-size:0.75rem;color:#6B7280;font-family:monospace">${_escapeHtml(f.example)}</div>`:''}
            </div>`).join('')}
        </div>
      </div>`;
    } catch(e) { aOut.innerHTML = `<div style="color:#991B1B">Error: ${_escapeHtml(e.message)}</div>`; }
    finally { if (btn) { btn.disabled = false; btn.textContent = '⚡ Auto-Optimize All'; } }
  });

  window._csFixIt = async function(key) {
    const b = r.breakdown[key]; if (!b) return;
    const fixDiv = document.getElementById('csFix_' + key); if (!fixDiv) return;
    fixDiv.style.display = 'block';
    fixDiv.innerHTML = '⏳ Generating AI fix…';
    try {
      const res = await fetch('/api/content-score/fix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscore: b.label, detail: b.detail, keyword: r.keyword, pageTitle: '' }),
      }).then(x => x.json());
      if (!res.ok || !res.suggestion) { fixDiv.innerHTML = `<em>${_escapeHtml(b.fix || 'No AI suggestion available')}</em>`; return; }
      fixDiv.innerHTML = `<div style="font-weight:600;color:#7C3AED;margin-bottom:4px">AI Suggestion:</div>${_escapeHtml(res.suggestion)}${res.example?`<div style="margin-top:6px;padding:6px 9px;background:#fff;border:1px solid #E5E7EB;border-radius:5px;font-family:monospace;font-size:0.74rem;color:#374151">${_escapeHtml(res.example)}</div>`:''}`;
    } catch(e) { fixDiv.innerHTML = `<em style="color:#991B1B">Error: ${_escapeHtml(e.message)}</em>`; }
  };
}

// ============================================================================
// T39-B — AI Traffic Monitor
// ============================================================================
window.buildAiTrafficMonitor = function() {
  const wrap = document.getElementById('atWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:linear-gradient(135deg,#0A1628,#1E1B4B);border-radius:12px;padding:18px;margin-bottom:16px;color:#fff">
      <h3 style="margin:0 0 6px;font-family:Sora,sans-serif;font-size:1rem">🤖 AI Traffic Monitor</h3>
      <p style="margin:0;font-size:0.8rem;color:rgba(255,255,255,.65);line-height:1.45">Track how much traffic your site receives from ChatGPT, Perplexity, Claude, Gemini and other AI engines. Paste a tiny script on your site to start tracking.</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px" id="atTopCards"></div>
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
      <div style="font-size:0.84rem;font-weight:800;color:#0A1628;margin-bottom:12px">➕ Register a Site</div>
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">SITE NAME</label><input id="atName" placeholder="My Blog" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">DOMAIN</label><input id="atDomain" placeholder="myblog.com" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
        <button id="atRegister" style="padding:8px 16px;background:#0A1628;border:none;border-radius:6px;color:#fff;font-size:0.82rem;font-weight:800;cursor:pointer">Register</button>
      </div>
    </div>
    <div id="atSites"></div>`;

  async function _atLoad() {
    const cardsEl = document.getElementById('atTopCards');
    const sitesEl = document.getElementById('atSites');
    try {
      const sr = await fetch('/api/ai-traffic/sites').then(x => x.json());
      const sites = sr.sites || [];
      if (!sites.length) {
        cardsEl.innerHTML = '';
        sitesEl.innerHTML = `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:28px;text-align:center;color:#6B7280">
          <div style="font-size:2rem;margin-bottom:8px">🤖</div>
          <div style="font-weight:700;margin-bottom:6px">No sites registered yet</div>
          <div style="font-size:0.8rem">Register your first site above to start tracking AI referral traffic.</div>
        </div>`;
        return;
      }
      // Load stats for all sites in parallel
      const stats = await Promise.all(sites.map(s => fetch('/api/ai-traffic/stats?sid=' + encodeURIComponent(s.id)).then(x => x.json()).catch(() => ({ ok: false, total: 0 }))));
      const totalHits = stats.reduce((a, s) => a + (s.total || 0), 0);
      const allSources = {};
      stats.forEach(s => (s.bySource||[]).forEach(b => { allSources[b.source] = (allSources[b.source]||0) + b.hits; }));
      const topSource = Object.entries(allSources).sort((a,b)=>b[1]-a[1])[0];
      cardsEl.innerHTML = `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px">
          <div style="font-size:0.7rem;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:6px">Total AI Referrals (30d)</div>
          <div style="font-size:2rem;font-weight:900;color:#0A1628">${totalHits.toLocaleString()}</div>
        </div>
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px">
          <div style="font-size:0.7rem;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:6px">Top AI Source</div>
          <div style="font-size:2rem;font-weight:900;color:#0A1628">${topSource ? _escapeHtml(topSource[0]) : '—'}</div>
          ${topSource ? `<div style="font-size:0.74rem;color:#6B7280;margin-top:2px">${topSource[1]} hits</div>` : ''}
        </div>`;
      sitesEl.innerHTML = sites.map((site, i) => {
        const st = stats[i] || {};
        const snippetId = 'atSnippet_' + site.id;
        const origin = window.location.origin;
        const snippet = `<script src="${origin}/api/ai-traffic/embed.js?sid=${site.id}" async><\/script>`;
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-weight:800;color:#0A1628;font-size:0.92rem">${_escapeHtml(site.name)}</div>
              <div style="font-size:0.72rem;color:#6B7280">${_escapeHtml(site.domain)} · Registered ${new Date(site.created_at).toLocaleDateString()}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="font-size:1.3rem;font-weight:900;color:#0A1628">${(st.total||0).toLocaleString()}</span>
              <span style="font-size:0.68rem;color:#6B7280;font-weight:700">AI hits<br>last 30d</span>
              ${st.trend !== null && st.trend !== undefined ? `<span style="padding:2px 8px;border-radius:4px;font-size:0.68rem;font-weight:800;background:${st.trend>=0?'#ECFDF5':'#FEF2F2'};color:${st.trend>=0?'#065F46':'#991B1B'}">${st.trend>=0?'↑':'↓'} ${Math.abs(st.trend)}%</span>` : ''}
            </div>
          </div>
          ${(st.bySource||[]).length ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            ${(st.bySource||[]).map(b => `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;padding:6px 10px;text-align:center;min-width:70px">
              <div style="font-size:1rem">${b.icon||'🤖'}</div>
              <div style="font-size:0.78rem;font-weight:700;color:#0A1628">${_escapeHtml(b.source)}</div>
              <div style="font-size:0.7rem;color:#6B7280">${b.hits} hits · ${b.share}%</div>
            </div>`).join('')}
          </div>` : '<div style="font-size:0.78rem;color:#9CA3AF;margin-bottom:10px">No AI referrals recorded yet.</div>'}
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;padding:10px">
            <div style="font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:5px">TRACKING SNIPPET — paste in your site &lt;head&gt;</div>
            <code id="${snippetId}" style="font-size:0.72rem;color:#374151;word-break:break-all;display:block">${_escapeHtml(snippet)}</code>
            <button onclick="navigator.clipboard?.writeText(document.getElementById('${snippetId}')?.textContent||'').then(()=>showToast('✅ Snippet copied!'))" style="margin-top:6px;padding:4px 10px;background:#DBEAFE;border:none;border-radius:5px;font-size:0.7rem;font-weight:700;color:#1D4ED8;cursor:pointer">📋 Copy snippet</button>
          </div>
        </div>`;
      }).join('');
    } catch(e) { sitesEl.innerHTML = `<div style="color:#991B1B">Error: ${_escapeHtml(e.message)}</div>`; }
  }

  document.getElementById('atRegister').addEventListener('click', async () => {
    const name   = document.getElementById('atName')?.value.trim();
    const domain = document.getElementById('atDomain')?.value.trim();
    if (!name || !domain) { showToast('⚠️ Name and domain required'); return; }
    const btn = document.getElementById('atRegister');
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await fetch('/api/ai-traffic/sites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain }),
      }).then(x => x.json());
      if (!r.ok) { showToast('⚠️ ' + r.error); return; }
      document.getElementById('atName').value = '';
      document.getElementById('atDomain').value = '';
      showToast('✅ Site registered!');
      _atLoad();
    } catch(e) { showToast('❌ ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Register'; }
  });

  _atLoad();
};

// ============================================================================
// T39-C — Visibility Rank Leaderboard (AI Visibility Δ table)
// ============================================================================
window.buildVisLeaderboard = function() {
  const wrap = document.getElementById('vlWrap'); if (!wrap) return;
  const brand = (window.analysisData?.brandName || '').trim();
  wrap.innerHTML = `
    <div style="background:linear-gradient(135deg,#1E1B4B,#0A1628);border-radius:12px;padding:18px;margin-bottom:16px;color:#fff">
      <h3 style="margin:0 0 6px;font-family:Sora,sans-serif;font-size:1rem">🏆 Visibility Rank Table</h3>
      <p style="margin:0;font-size:0.8rem;color:rgba(255,255,255,.65)">See how you and your competitors rank across AI engines — with Δ vs your last run.</p>
    </div>
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:14px;display:flex;gap:10px;align-items:end">
      <div style="flex:1"><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">FILTER BY BRAND</label><input id="vlBrand" value="${_escapeHtml(brand)}" placeholder="Leave blank for latest run" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
      <button id="vlLoad" style="padding:9px 20px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);border:none;border-radius:6px;color:#fff;font-size:0.84rem;font-weight:800;cursor:pointer">Load</button>
    </div>
    <div id="vlOut"></div>`;

  async function _vlLoad() {
    const out = document.getElementById('vlOut');
    const b   = document.getElementById('vlBrand')?.value.trim() || '';
    out.innerHTML = '<div style="color:#9CA3AF;padding:12px 0">⏳ Loading leaderboard…</div>';
    try {
      const r = await fetch('/api/ai-visibility/leaderboard' + (b ? '?brand=' + encodeURIComponent(b) : '')).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="color:#991B1B">${_escapeHtml(r.error)}</div>`; return; }
      if (!r.leaderboard || !r.leaderboard.length) {
        out.innerHTML = `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:28px;text-align:center;color:#6B7280">
          <div style="font-size:2rem;margin-bottom:8px">📊</div>
          <div style="font-weight:700;margin-bottom:6px">No AI Visibility runs yet</div>
          <div style="font-size:0.8rem">Run an <strong>AI Visibility</strong> scan first — the leaderboard will appear here.</div>
          <button onclick="navigateTo('aivisibility')" style="margin-top:12px;padding:8px 18px;background:#7C3AED;border:none;border-radius:6px;color:#fff;font-size:0.8rem;font-weight:700;cursor:pointer">Go to AI Visibility →</button>
        </div>`;
        return;
      }
      const providers = Array.isArray(r.run?.providers) ? (typeof r.run.providers === 'string' ? JSON.parse(r.run.providers) : r.run.providers) : [];
      const ts = r.run?.created_at ? new Date(r.run.created_at).toLocaleString() : '';
      const prevTs = r.prevRun?.created_at ? new Date(r.prevRun.created_at).toLocaleString() : null;
      out.innerHTML = `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-size:0.84rem;font-weight:800;color:#0A1628">Brand: ${_escapeHtml(r.brand)}</div>
              <div style="font-size:0.72rem;color:#6B7280">Run: ${ts}${prevTs?' · vs '+prevTs:' · (no prior run for delta)'}</div>
              <div style="font-size:0.72rem;color:#6B7280">Providers: ${providers.join(', ')||'—'}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:1.6rem;font-weight:900;color:#7C3AED">${r.summary?.youShare||0}%</div>
              <div style="font-size:0.68rem;color:#6B7280;font-weight:700">YOUR SOV</div>
            </div>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
              <thead>
                <tr style="background:#F9FAFB">
                  <th style="padding:8px 12px;text-align:left;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">RANK</th>
                  <th style="padding:8px 12px;text-align:left;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">BRAND</th>
                  <th style="padding:8px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">MENTIONS</th>
                  <th style="padding:8px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">SOV %</th>
                  <th style="padding:8px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">Δ SOV</th>
                  <th style="padding:8px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">RANK Δ</th>
                  <th style="padding:8px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">1ST CITES</th>
                </tr>
              </thead>
              <tbody>
                ${r.leaderboard.map(row => {
                  const isYou = row.isYou;
                  const rowBg = isYou ? '#F5F3FF' : 'transparent';
                  const deltaShareTxt = row.deltaShare !== null ? (row.deltaShare >= 0 ? `+${row.deltaShare}pp` : `${row.deltaShare}pp`) : '—';
                  const deltaShareColor = row.deltaShare !== null ? (row.deltaShare > 0 ? '#10B981' : row.deltaShare < 0 ? '#EF4444' : '#6B7280') : '#9CA3AF';
                  const rankDeltaTxt = row.rankDelta !== null ? (row.rankDelta > 0 ? `↑${row.rankDelta}` : row.rankDelta < 0 ? `↓${Math.abs(row.rankDelta)}` : '—') : '—';
                  const rankDeltaColor = row.rankDelta !== null ? (row.rankDelta > 0 ? '#10B981' : row.rankDelta < 0 ? '#EF4444' : '#6B7280') : '#9CA3AF';
                  return `<tr style="background:${rowBg};border-bottom:1px solid #F3F4F6">
                    <td style="padding:9px 12px;font-weight:800;color:${isYou?'#7C3AED':'#374151'}">${row.rank}</td>
                    <td style="padding:9px 12px;font-weight:${isYou?800:600};color:${isYou?'#7C3AED':'#0A1628'}">${_escapeHtml(row.brand)}${isYou?' 👈':''}</td>
                    <td style="padding:9px 12px;text-align:right;color:#374151">${row.mentions}</td>
                    <td style="padding:9px 12px;text-align:right;font-weight:700;color:#0A1628">${row.share}%</td>
                    <td style="padding:9px 12px;text-align:right;font-weight:700;color:${deltaShareColor}">${deltaShareTxt}</td>
                    <td style="padding:9px 12px;text-align:right;font-weight:700;color:${rankDeltaColor}">${rankDeltaTxt}</td>
                    <td style="padding:9px 12px;text-align:right;color:#6B7280">${row.firstCites}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    } catch(e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  }

  document.getElementById('vlLoad').addEventListener('click', _vlLoad);
  _vlLoad();
};
