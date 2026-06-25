// =============================================================================
// ig_intel_pack_b.js — standalone integration & intel view-builders (pack B)
// -----------------------------------------------------------------------------
// Carved out of app.js verbatim. Holds independent standalone window.buildX
// view-builders that each render their own view from /api/ data and only read
// (never mutate) window.analysisData. Public entry points stay on window;
// feature-private helpers are scoped to this file's IIFE.
//
// Builders: buildLlmScan · buildPostPerformance · buildEmailBroadcast ·
//   buildHunter · buildLinkedinAds · buildCanvaLauncher · buildCrmSync ·
//   buildEmployeeAdvocacy · buildSocialListening · buildMediaIntel ·
//   buildHashtagIntel · buildMapsIntel · buildCreativeIntel ·
//   buildYtCommentMiner · buildLinkProspector
//
// Shared globals (showToast, navigateTo, _esc, _escapeHtml, _safeUrl,
// analysisData, _dataBadge, Chart, …) come from app.js at call time.
// =============================================================================
(function () {
// ── AI Search Visibility — Live LLM Scan (DataForSEO AI Optimization) ────
// Uses viewId 'llm-scan' and writes into #llmScanWrap (separate from the older
// buildAiVisibility/aiVisWrap tracker which uses simulated platform scores).
window._aivState = { lastResult: null, history: [] };

window.buildLlmScan = function() {
  const main = document.getElementById('llmScanWrap');
  if (!main) return;
  const e = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const brand = (window.analysisData && window.analysisData.url)
              || (window._brandKit && window._brandKit.name)
              || '';
  const comps = ((window.analysisData && Array.isArray(window.analysisData.competitors))
                ? window.analysisData.competitors : [])
              .map(c => (c && (c.name || c.brand)) || '').filter(Boolean).slice(0, 10);

  const defaultPrompts = [
    'What are the best companies for ' + (brand ? 'the industry of ' + brand : 'small businesses') + '?',
    'Who are the top alternatives to ' + (brand || 'leading providers') + '?',
    'Compare the top providers in this space and recommend one.'
  ];

  main.innerHTML = `
    <div>
      <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:14px;padding:18px;margin-bottom:18px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px">
          <div>
            <label style="font-weight:700;font-size:.82rem;color:#0F172A;display:block;margin-bottom:4px">Your brand</label>
            <input id="aivBrand" type="text" value="${e(brand)}" placeholder="e.g. InfoGenie"
              style="width:100%;padding:9px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.92rem"/>
          </div>
          <div>
            <label style="font-weight:700;font-size:.82rem;color:#0F172A;display:block;margin-bottom:4px">Competitors (comma-separated, up to 10)</label>
            <input id="aivComps" type="text" value="${e(comps.join(', '))}" placeholder="e.g. HubSpot, Mailchimp, Klaviyo"
              style="width:100%;padding:9px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.92rem"/>
          </div>
        </div>

        <label style="font-weight:700;font-size:.82rem;color:#0F172A;display:block;margin-bottom:4px">Prompts (one per line, up to 6)</label>
        <textarea id="aivPrompts" rows="4" placeholder="One question per line"
          style="width:100%;padding:9px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.92rem;font-family:inherit;resize:vertical">${e(defaultPrompts.join('\n'))}</textarea>

        <div style="margin-top:12px">
          <div style="font-weight:700;font-size:.82rem;color:#0F172A;margin-bottom:6px">LLM providers</div>
          <div style="display:flex;gap:14px;flex-wrap:wrap">
            ${['chatgpt','perplexity','gemini','claude'].map(p => `
              <label style="display:flex;align-items:center;gap:6px;font-size:.88rem;color:#0F172A;cursor:pointer">
                <input type="checkbox" class="aivProv" value="${p}" ${p==='chatgpt'||p==='perplexity'?'checked':''}/>
                ${p === 'chatgpt' ? 'ChatGPT' : p[0].toUpperCase()+p.slice(1)}
              </label>
            `).join('')}
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap">
          <div style="font-size:.78rem;color:#64748B">
            Each (provider × prompt) is one paid LLM call on your DataForSEO AI Optimization plan.
          </div>
          <div style="display:flex;gap:8px">
            <button id="aivHistBtn" style="padding:9px 16px;border:1px solid #CBD5E1;background:#FFF;border-radius:8px;font-weight:600;cursor:pointer;color:#0F172A">📜 History</button>
            <button id="aivRunBtn" style="padding:9px 18px;border:0;background:#4338CA;color:#FFF;border-radius:8px;font-weight:700;cursor:pointer">▶ Run Visibility Scan</button>
          </div>
        </div>
      </div>

      <div id="aivResult"></div>
    </div>
  `;

  document.getElementById('aivRunBtn').onclick = window._aivRun;
  document.getElementById('aivHistBtn').onclick = window._aivLoadHistory;
};

window._aivRun = async function() {
  const e = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const brand = document.getElementById('aivBrand').value.trim();
  const competitors = document.getElementById('aivComps').value.split(',').map(s => s.trim()).filter(Boolean);
  const prompts = document.getElementById('aivPrompts').value.split('\n').map(s => s.trim()).filter(Boolean);
  const providers = Array.from(document.querySelectorAll('.aivProv:checked')).map(c => c.value);
  const out = document.getElementById('aivResult');
  if (!brand) { out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">Brand name is required.</div>`; return; }
  if (prompts.length === 0) { out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">At least one prompt is required.</div>`; return; }
  if (providers.length === 0) { out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">Pick at least one LLM provider.</div>`; return; }

  const total = providers.length * prompts.length;
  out.innerHTML = `<div style="padding:18px;background:#EEF2FF;border-radius:12px;color:#3730A3;font-weight:600;text-align:center">⏳ Querying ${providers.length} LLM${providers.length>1?'s':''} × ${prompts.length} prompt${prompts.length>1?'s':''} = ${total} live LLM call${total>1?'s':''}… this can take 30-90 seconds.</div>`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (window.API_KEY) headers['x-api-key'] = window.API_KEY;
    const r = await fetch('/api/ai-visibility/run', {
      method: 'POST', headers,
      body: JSON.stringify({ brand, competitors, prompts, providers })
    });
    const data = await r.json();
    if (!data.ok) {
      out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">${e(data.error || 'Scan failed')}</div>`;
      return;
    }
    window._aivState.lastResult = data;
    window._aivRender(data);
  } catch (err) {
    out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">Network error: ${e(err.message)}</div>`;
  }
};

window._aivRender = function(data) {
  const e = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const out = document.getElementById('aivResult');
  if (!out) return;
  const summary = data.summary || {};
  const sov = summary.sov || [];
  const youShare = Math.round((summary.youShare || 0) * 100);
  const ranked = sov.slice().sort((a,b)=>b.mentions-a.mentions);
  const youRank = ranked.findIndex(s => s.brand === data.brand) + 1;
  const maxMentions = Math.max(1, ...sov.map(s => s.mentions));

  const sovBars = sov.map(s => {
    const w = Math.max(2, Math.round((s.mentions / maxMentions) * 100));
    const isYou = s.brand === data.brand;
    const pct = Math.round((s.share || 0) * 100);
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:.85rem">
          <span style="font-weight:${isYou?'800':'600'};color:${isYou?'#4338CA':'#0F172A'}">${e(s.brand)}${isYou?' (you)':''}</span>
          <span style="color:#64748B">${s.mentions} mentions · ${pct}% SoV · cited first ${s.firstCites}x</span>
        </div>
        <div style="height:10px;background:#F1F5F9;border-radius:6px;overflow:hidden">
          <div style="width:${w}%;height:100%;background:${isYou?'#4338CA':'#94A3B8'}"></div>
        </div>
      </div>`;
  }).join('');

  const cells = [];
  for (const provider of data.providers) {
    for (const prompt of data.prompts) {
      const c = (data.results[provider] || {})[prompt] || {};
      const ms = c.mentions || {};
      const allBrands = [data.brand, ...(data.competitors || [])];
      const mentionsRow = allBrands.map(b => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${b===data.brand?'#EEF2FF':'#F1F5F9'};color:${b===data.brand?'#4338CA':'#475569'};font-size:.72rem;margin:2px 4px 2px 0;font-weight:${b===data.brand?'700':'500'}">${e(b)}: ${ms[b]||0}</span>`).join('');
      cells.push(`
        <details style="background:#FFF;border:1px solid #E2E8F0;border-radius:10px;margin-bottom:8px">
          <summary style="padding:10px 14px;cursor:pointer;font-size:.86rem">
            <strong style="color:#4338CA">${e(provider)}</strong>
            <span style="color:#64748B"> · ${e(prompt.slice(0, 90))}${prompt.length>90?'…':''}</span>
            ${c.error ? `<span style="color:#B91C1C;font-size:.75rem;margin-left:6px">⚠ ${e(c.error)}</span>` : ''}
          </summary>
          <div style="padding:0 14px 14px">
            <div style="margin-bottom:8px">${mentionsRow}</div>
            <div style="background:#F8FAFC;padding:10px;border-radius:8px;font-size:.84rem;color:#0F172A;white-space:pre-wrap;line-height:1.5;max-height:280px;overflow:auto">${e(c.text || '(no response)')}</div>
          </div>
        </details>`);
    }
  }

  out.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
      <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:12px;padding:16px">
        <div style="font-size:.78rem;color:#64748B;font-weight:600">Your share of voice</div>
        <div style="font-size:2rem;font-weight:800;color:#4338CA">${youShare}%</div>
        <div style="font-size:.78rem;color:#64748B">${summary.youMentions || 0} mentions across ${summary.answeredRuns || 0}/${summary.totalRuns || 0} LLM responses</div>
      </div>
      <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:12px;padding:16px">
        <div style="font-size:.78rem;color:#64748B;font-weight:600">Your rank</div>
        <div style="font-size:2rem;font-weight:800;color:${youRank===1?'#10B981':youRank<=3?'#0EA5E9':'#B91C1C'}">${youRank || '—'}${youRank?' / '+ranked.length:''}</div>
        <div style="font-size:.78rem;color:#64748B">Position by total mentions</div>
      </div>
      <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:12px;padding:16px">
        <div style="font-size:.78rem;color:#64748B;font-weight:600">Strongest LLM for you</div>
        <div style="font-size:1.4rem;font-weight:800;color:#0F172A">${summary.topProvider ? e(summary.topProvider.provider) : '—'}</div>
        <div style="font-size:.78rem;color:#64748B">${summary.topProvider ? summary.topProvider.mentions + ' mentions of you' : 'No data'} · cost $${(data.cost_usd||0).toFixed(4)}</div>
      </div>
    </div>

    <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:14px;padding:18px;margin-bottom:16px">
      <h3 style="margin:0 0 12px;color:#0F172A;font-size:1.1rem">Share of voice across all LLM answers</h3>
      ${sovBars || '<div style="color:#64748B">No mentions detected.</div>'}
    </div>

    <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:14px;padding:18px">
      <h3 style="margin:0 0 12px;color:#0F172A;font-size:1.1rem">Per-prompt LLM responses</h3>
      ${cells.join('') || '<div style="color:#64748B">No responses.</div>'}
    </div>
  `;
};

window._aivLoadHistory = async function() {
  const e = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const out = document.getElementById('aivResult');
  out.innerHTML = `<div style="padding:14px;background:#EEF2FF;border-radius:8px;color:#3730A3">⏳ Loading history…</div>`;
  try {
    const headers = {};
    if (window.API_KEY) headers['x-api-key'] = window.API_KEY;
    const r = await fetch('/api/ai-visibility/runs', { headers });
    const data = await r.json();
    if (!data.ok) { out.innerHTML = `<div style="padding:14px;background:#FEF2F2;color:#991B1B;border-radius:8px">${e(data.error||'Failed')}</div>`; return; }
    if (!data.runs.length) { out.innerHTML = `<div style="padding:14px;background:#F1F5F9;color:#475569;border-radius:8px">No past runs yet. Run a scan above to start tracking.</div>`; return; }
    const rows = data.runs.map(r => {
      const s = r.summary || {};
      const youShare = Math.round((s.youShare || 0) * 100);
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #F1F5F9">
          <div>
            <div style="font-weight:700;color:#0F172A">${e(r.brand)}</div>
            <div style="font-size:.76rem;color:#64748B">${new Date(r.created_at).toLocaleString()} · ${(r.providers||[]).length} provider(s) · ${(r.prompts||[]).length} prompt(s)</div>
          </div>
          <div style="display:flex;gap:14px;align-items:center">
            <div style="font-size:.92rem;font-weight:700;color:#4338CA">${youShare}% SoV</div>
            <div style="font-size:.76rem;color:#64748B">$${Number(r.cost_usd||0).toFixed(4)}</div>
          </div>
        </div>`;
    }).join('');
    out.innerHTML = `<div style="background:#FFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden"><div style="padding:12px 14px;background:#F8FAFC;font-weight:700;color:#0F172A">Past AI Visibility runs</div>${rows}</div>`;
  } catch (err) {
    out.innerHTML = `<div style="padding:14px;background:#FEF2F2;color:#991B1B;border-radius:8px">Network error: ${e(err.message)}</div>`;
  }
};

// ============================================================================
// T40-A — Post Performance (all posts ranked by engagement across all accounts)
// ============================================================================
window.buildPostPerformance = function() {
  const wrap = document.getElementById('ppWrap'); if (!wrap) return;
  const profileId = (window._socialProfileId || '').trim();

  const PLATFORM_EMOJI = { instagram:'📸', facebook:'📘', twitter:'🐦', linkedin:'💼', tiktok:'🎵', youtube:'▶️', pinterest:'📌', reddit:'🔴', bluesky:'🟦', threads:'🧵', googlebusiness:'🏢', telegram:'✈️', discord:'💬', snapchat:'👻', whatsapp:'💬' };
  const platEmoji = p => PLATFORM_EMOJI[String(p||'').toLowerCase()] || '🌐';
  const fmtNum  = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n);
  const fmtDate = s => { if (!s) return ''; try { return new Date(s).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'2-digit'}); } catch { return ''; } };

  let _currentSort = 'engagement';
  let _currentRange = '30d';
  let _posts = [];

  function _metaStat(label, val, color) {
    return `<div style="background:#F9FAFB;border-radius:10px;padding:14px 18px;text-align:center;min-width:100px">
      <div style="font-size:1.4rem;font-weight:900;color:${color||'#0A1628'}">${fmtNum(val)}</div>
      <div style="font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;margin-top:2px">${label}</div>
    </div>`;
  }

  function _renderPosts(posts) {
    if (!posts.length) return `<div style="text-align:center;padding:48px;color:#6B7280;font-size:0.9rem">No posts found for this period.</div>`;
    return posts.map((p, i) => {
      const engRate = p.engRate > 0 ? `<span style="background:#EDE9FE;color:#7C3AED;font-size:0.7rem;font-weight:700;padding:2px 7px;border-radius:99px">${p.engRate}% ER</span>` : '';
      const postUrl = p.url ? `<a href="${_safeUrl(p.url)}" target="_blank" rel="noopener" style="color:#6B7280;font-size:0.75rem;text-decoration:none">↗ View post</a>` : '';
      return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:8px;display:flex;gap:14px;align-items:flex-start">
        <div style="font-size:1.4rem;line-height:1;padding-top:2px">${platEmoji(p.platform)}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <span style="font-size:0.72rem;font-weight:700;color:#374151;text-transform:capitalize">${_escapeHtml(p.platform)}</span>
            ${p.username ? `<span style="font-size:0.72rem;color:#9CA3AF">@${_escapeHtml(p.username)}</span>` : ''}
            <span style="font-size:0.7rem;color:#9CA3AF">${fmtDate(p.publishedAt)}</span>
            ${engRate}
            ${postUrl}
          </div>
          <div style="font-size:0.83rem;color:#374151;line-height:1.4;margin-bottom:8px;word-break:break-word">${p.text ? _escapeHtml(p.text.slice(0,200))+(p.text.length>200?'…':'') : '<em style="color:#9CA3AF">No text preview</em>'}</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${p.impressions ? `<span style="font-size:0.72rem;color:#6B7280">👁 ${fmtNum(p.impressions)}</span>` : ''}
            <span style="font-size:0.72rem;color:#6B7280">❤️ ${fmtNum(p.likes)}</span>
            <span style="font-size:0.72rem;color:#6B7280">💬 ${fmtNum(p.comments)}</span>
            <span style="font-size:0.72rem;color:#6B7280">🔁 ${fmtNum(p.shares)}</span>
            ${p.clicks ? `<span style="font-size:0.72rem;color:#6B7280">🖱 ${fmtNum(p.clicks)}</span>` : ''}
            <span style="font-size:0.75rem;font-weight:700;color:#0A1628">Total: ${fmtNum(p.engTotal)}</span>
          </div>
        </div>
        <div style="font-size:1.1rem;font-weight:900;color:#D1D5DB;min-width:28px;text-align:right">#${i+1}</div>
      </div>`;
    }).join('');
  }

  async function _load() {
    if (!profileId) {
      wrap.innerHTML = `<div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:20px;font-size:0.88rem;color:#92400E">
        Connect a social account in <strong>Social Publisher</strong> first — your profile ID is needed to load post analytics.</div>`;
      return;
    }
    wrap.innerHTML = `<div style="text-align:center;padding:40px;color:#6B7280">Loading post analytics…</div>`;
    try {
      const r = await fetch(`/api/social-publisher/posts-performance?profileId=${encodeURIComponent(profileId)}&range=${_currentRange}&sort=${_currentSort}`).then(x=>x.json());
      if (r.note) { wrap.innerHTML = `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:20px;text-align:center;color:#6B7280;font-size:0.88rem">${_escapeHtml(r.note)}</div>`; return; }
      if (!r.ok) throw new Error(r.error || 'API error');
      _posts = r.posts || [];
      const t = r.totals || {};

      wrap.innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
          ${_metaStat('Total Posts', _posts.length, '#0A1628')}
          ${_metaStat('Impressions', t.impressions||0, '#0066FF')}
          ${_metaStat('Likes', t.likes||0, '#EF4444')}
          ${_metaStat('Comments', t.comments||0, '#F59E0B')}
          ${_metaStat('Shares', t.shares||0, '#10B981')}
          ${_metaStat('Clicks', t.clicks||0, '#7C3AED')}
          ${_metaStat('Total Eng.', t.engTotal||0, '#0A1628')}
        </div>
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:16px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span style="font-size:0.8rem;font-weight:700;color:#374151;margin-right:4px">Sort by:</span>
            ${['engagement','impressions','clicks','likes','date'].map(s=>`<button id="ppSort_${s}" onclick="window._ppSetSort('${s}')" style="padding:5px 12px;border-radius:6px;font-size:0.76rem;font-weight:700;border:1px solid ${_currentSort===s?'#7C3AED':'#E5E7EB'};background:${_currentSort===s?'#EDE9FE':'#fff'};color:${_currentSort===s?'#7C3AED':'#374151'};cursor:pointer">${s.charAt(0).toUpperCase()+s.slice(1)}</button>`).join('')}
            <span style="margin-left:auto;font-size:0.8rem;font-weight:700;color:#374151">Range:</span>
            ${['7d','30d','90d'].map(r=>`<button id="ppRange_${r}" onclick="window._ppSetRange('${r}')" style="padding:5px 10px;border-radius:6px;font-size:0.76rem;font-weight:700;border:1px solid ${_currentRange===r?'#0066FF':'#E5E7EB'};background:${_currentRange===r?'#EFF6FF':'#fff'};color:${_currentRange===r?'#0066FF':'#374151'};cursor:pointer">${r}</button>`).join('')}
          </div>
        </div>
        <div id="ppList">${_renderPosts(_posts)}</div>
      `;
    } catch(e) {
      wrap.innerHTML = `<div style="color:#991B1B;padding:16px">Error: ${_escapeHtml(e.message)}</div>`;
    }
  }

  window._ppSetSort = async function(s) {
    _currentSort = s;
    await _load();
  };
  window._ppSetRange = async function(r) {
    _currentRange = r;
    await _load();
  };

  _load();
};

// ============================================================================
// T40-B — Email Broadcast + Tracking Dashboard
// ============================================================================
window.buildEmailBroadcast = function() {
  const wrap = document.getElementById('ebWrap'); if (!wrap) return;
  let _view = 'list';    // list | create | detail
  let _selectedId = null;
  let _detailTab = 'stats'; // stats | recipients

  const fmtPct  = n => (n || 0).toFixed(1) + '%';
  const fmtNum  = n => Number(n||0).toLocaleString();
  const fmtDate = s => { if (!s) return '—'; try { return new Date(s).toLocaleString(undefined,{month:'short',day:'numeric',year:'2-digit',hour:'2-digit',minute:'2-digit'}); } catch { return s; } };
  const statusBadge = s => {
    const cfg = { draft:'#6B7280:#F3F4F6', sending:'#D97706:#FEF3C7', sent:'#059669:#D1FAE5', paused:'#7C3AED:#EDE9FE' }[s] || '#6B7280:#F3F4F6';
    const [fg,bg] = cfg.split(':');
    return `<span style="background:${bg};color:${fg};font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:capitalize">${s}</span>`;
  };
  const recipBadge = s => {
    const colors = { queued:'#6B7280', sent:'#374151', opened:'#0066FF', clicked:'#7C3AED', bounced:'#EF4444', complained:'#D97706', unsubscribed:'#9CA3AF' };
    const bg = { queued:'#F3F4F6', sent:'#F9FAFB', opened:'#EFF6FF', clicked:'#EDE9FE', bounced:'#FEE2E2', complained:'#FEF3C7', unsubscribed:'#F3F4F6' };
    return `<span style="background:${bg[s]||'#F3F4F6'};color:${colors[s]||'#6B7280'};font-size:0.68rem;font-weight:700;padding:2px 7px;border-radius:99px;text-transform:capitalize">${s}</span>`;
  };

  function _statCard(label, val, sub, color) {
    return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px 20px;text-align:center;min-width:110px;flex:1">
      <div style="font-size:1.6rem;font-weight:900;color:${color||'#0A1628'}">${val}</div>
      <div style="font-size:0.7rem;font-weight:700;color:#374151;margin-top:2px">${label}</div>
      ${sub ? `<div style="font-size:0.68rem;color:#9CA3AF;margin-top:1px">${sub}</div>` : ''}
    </div>`;
  }

  async function _renderList() {
    wrap.innerHTML = `<div style="text-align:center;padding:32px;color:#6B7280">Loading broadcasts…</div>`;
    try {
      const r = await fetch('/api/email-broadcast/broadcasts').then(x=>x.json());
      if (!r.ok) throw new Error(r.error);
      const bcs = r.broadcasts || [];
      wrap.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
          <button onclick="window._ebCreate()" style="padding:9px 20px;background:linear-gradient(135deg,#0066FF,#7C3AED);border:none;border-radius:8px;color:#fff;font-size:0.84rem;font-weight:700;cursor:pointer">+ New Broadcast</button>
        </div>
        ${!bcs.length ? `
          <div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:12px;padding:48px;text-align:center;color:#6B7280">
            <div style="font-size:2rem;margin-bottom:10px">📧</div>
            <div style="font-weight:700;color:#374151;margin-bottom:6px">No broadcasts yet</div>
            <div style="font-size:0.85rem">Create your first broadcast to send bulk emails with open &amp; click tracking.</div>
          </div>` :
          `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
              <thead><tr style="background:#F9FAFB">
                <th style="padding:10px 14px;text-align:left;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">NAME</th>
                <th style="padding:10px 14px;text-align:left;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">SUBJECT</th>
                <th style="padding:10px 14px;text-align:center;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">STATUS</th>
                <th style="padding:10px 14px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">RECIPIENTS</th>
                <th style="padding:10px 14px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">OPEN RATE</th>
                <th style="padding:10px 14px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">CLICK RATE</th>
                <th style="padding:10px 14px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">BOUNCES</th>
                <th style="padding:10px 14px;text-align:right;font-size:0.7rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">SENT</th>
                <th style="padding:10px 14px;border-bottom:1px solid #E5E7EB"></th>
              </tr></thead>
              <tbody>
                ${bcs.map(b => {
                  const s = b.sent_count || 0;
                  const openRate  = s > 0 ? fmtPct((b.open_count/s)*100) : '—';
                  const clickRate = s > 0 ? fmtPct((b.click_count/s)*100) : '—';
                  const bounceRate = s > 0 ? fmtPct((b.bounce_count/s)*100) : '—';
                  return `<tr style="border-bottom:1px solid #F3F4F6;cursor:pointer" onclick="window._ebDetail(${b.id})">
                    <td style="padding:10px 14px;font-weight:700;color:#0A1628">${_escapeHtml(b.name)}</td>
                    <td style="padding:10px 14px;color:#374151;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escapeHtml(b.subject)}</td>
                    <td style="padding:10px 14px;text-align:center">${statusBadge(b.status)}</td>
                    <td style="padding:10px 14px;text-align:right;color:#374151">${fmtNum(b.recipient_count)}</td>
                    <td style="padding:10px 14px;text-align:right;font-weight:700;color:${s>0?'#059669':'#9CA3AF'}">${openRate}</td>
                    <td style="padding:10px 14px;text-align:right;font-weight:700;color:${s>0?'#7C3AED':'#9CA3AF'}">${clickRate}</td>
                    <td style="padding:10px 14px;text-align:right;color:${b.bounce_count>0?'#EF4444':'#9CA3AF'}">${bounceRate}</td>
                    <td style="padding:10px 14px;text-align:right;color:#6B7280">${fmtDate(b.sent_at)}</td>
                    <td style="padding:10px 14px;text-align:right">
                      <button onclick="event.stopPropagation();window._ebDelete(${b.id})" style="padding:3px 8px;background:transparent;border:1px solid #E5E7EB;border-radius:5px;font-size:0.72rem;color:#6B7280;cursor:pointer">🗑</button>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`
        }
      `;
    } catch(e) { wrap.innerHTML = `<div style="color:#991B1B;padding:16px">Error: ${_escapeHtml(e.message)}</div>`; }
  }

  window._ebCreate = function() {
    wrap.innerHTML = `
      <div style="max-width:680px">
        <button onclick="window.buildEmailBroadcast()" style="background:transparent;border:none;color:#6B7280;font-size:0.82rem;cursor:pointer;margin-bottom:16px">← Back to broadcasts</button>
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px">
          <h3 style="margin:0 0 18px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">📧 Create New Broadcast</h3>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div><label style="font-size:0.78rem;font-weight:700;color:#374151;display:block;margin-bottom:4px">Campaign Name</label>
              <input id="eb_name" type="text" placeholder="e.g. May Newsletter 2025" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.85rem;color:#0A1628"></div>
            <div><label style="font-size:0.78rem;font-weight:700;color:#374151;display:block;margin-bottom:4px">Subject Line</label>
              <input id="eb_subject" type="text" placeholder="e.g. Here's what we've been working on…" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.85rem;color:#0A1628"></div>
            <div style="display:flex;gap:12px">
              <div style="flex:1"><label style="font-size:0.78rem;font-weight:700;color:#374151;display:block;margin-bottom:4px">From Name</label>
                <input id="eb_from_name" type="text" placeholder="InfoGenie" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.85rem;color:#0A1628"></div>
              <div style="flex:1"><label style="font-size:0.78rem;font-weight:700;color:#374151;display:block;margin-bottom:4px">From Email <span style="font-weight:400;color:#9CA3AF">(must be verified in Resend)</span></label>
                <input id="eb_from_email" type="email" placeholder="hello@yourcompany.com" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.85rem;color:#0A1628"></div>
            </div>
            <div><label style="font-size:0.78rem;font-weight:700;color:#374151;display:block;margin-bottom:4px">Email Body (HTML)</label>
              <textarea id="eb_html" rows="8" placeholder="<h1>Hello!</h1><p>Your email body here…</p>" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.82rem;font-family:monospace;color:#0A1628;resize:vertical"></textarea></div>
            <div><label style="font-size:0.78rem;font-weight:700;color:#374151;display:block;margin-bottom:4px">Plain-text fallback <span style="font-weight:400;color:#9CA3AF">(optional)</span></label>
              <textarea id="eb_text" rows="3" placeholder="Plain text version for email clients that don't render HTML" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.82rem;color:#0A1628;resize:vertical"></textarea></div>
          </div>
          <div style="margin-top:18px;display:flex;gap:10px">
            <button onclick="window._ebSaveDraft()" style="padding:10px 22px;background:linear-gradient(135deg,#0066FF,#7C3AED);border:none;border-radius:8px;color:#fff;font-size:0.84rem;font-weight:700;cursor:pointer">Save Draft →</button>
            <button onclick="window.buildEmailBroadcast()" style="padding:10px 16px;background:#F3F4F6;border:none;border-radius:8px;color:#374151;font-size:0.84rem;font-weight:600;cursor:pointer">Cancel</button>
          </div>
          <div id="eb_createMsg" style="margin-top:12px;font-size:0.82rem"></div>
        </div>
      </div>`;
  };

  window._ebSaveDraft = async function() {
    const name       = document.getElementById('eb_name')?.value.trim();
    const subject    = document.getElementById('eb_subject')?.value.trim();
    const from_name  = document.getElementById('eb_from_name')?.value.trim();
    const from_email = document.getElementById('eb_from_email')?.value.trim();
    const body_html  = document.getElementById('eb_html')?.value.trim();
    const body_text  = document.getElementById('eb_text')?.value.trim();
    const msg = document.getElementById('eb_createMsg');
    if (!name || !subject || (!body_html && !body_text)) { if(msg) msg.innerHTML = '<span style="color:#EF4444">Name, subject and body are required.</span>'; return; }
    if(msg) msg.innerHTML = '<span style="color:#6B7280">Saving…</span>';
    try {
      const r = await fetch('/api/email-broadcast/broadcasts', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name, subject, from_name, from_email, body_html, body_text })
      }).then(x=>x.json());
      if (!r.ok) throw new Error(r.error);
      window._ebDetail(r.broadcast.id);
    } catch(e) { if(msg) msg.innerHTML = `<span style="color:#EF4444">${_escapeHtml(e.message)}</span>`; }
  };

  window._ebDetail = async function(id) {
    _selectedId = id;
    wrap.innerHTML = `<div style="text-align:center;padding:32px;color:#6B7280">Loading…</div>`;
    try {
      const [bcR, statsR] = await Promise.all([
        fetch(`/api/email-broadcast/broadcasts/${id}`).then(x=>x.json()),
        fetch(`/api/email-broadcast/broadcasts/${id}/stats`).then(x=>x.json())
      ]);
      if (!bcR.ok) throw new Error(bcR.error);
      const bc = bcR.broadcast;
      const st = statsR.ok ? statsR : { sent_count:0, open_rate:0, click_rate:0, bounce_rate:0, delivery_rate:0, by_status:{} };
      const canSend = ['draft','paused'].includes(bc.status);

      wrap.innerHTML = `
        <button onclick="window.buildEmailBroadcast()" style="background:transparent;border:none;color:#6B7280;font-size:0.82rem;cursor:pointer;margin-bottom:16px">← Back to broadcasts</button>
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px">
            <div>
              <div style="font-size:1.05rem;font-weight:800;color:#0A1628">${_escapeHtml(bc.name)}</div>
              <div style="font-size:0.8rem;color:#6B7280;margin-top:2px">Subject: <em>${_escapeHtml(bc.subject)}</em></div>
              <div style="font-size:0.78rem;color:#9CA3AF;margin-top:2px">From: ${_escapeHtml(bc.from_name)} &lt;${_escapeHtml(bc.from_email||'—')}&gt; · ${fmtDate(bc.sent_at||bc.created_at)}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              ${statusBadge(bc.status)}
              ${canSend ? `<button onclick="window._ebSend(${id})" style="padding:8px 18px;background:linear-gradient(135deg,#059669,#0066FF);border:none;border-radius:7px;color:#fff;font-size:0.82rem;font-weight:700;cursor:pointer">🚀 Send Now</button>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
            ${_statCard('Recipients', fmtNum(bc.recipient_count), 'in list', '#374151')}
            ${_statCard('Delivered', fmtNum(st.sent_count), fmtPct(st.delivery_rate||0)+' delivery', '#0066FF')}
            ${_statCard('Opened', fmtNum(st.open_count||0), fmtPct(st.open_rate||0)+' rate', '#059669')}
            ${_statCard('Clicked', fmtNum(st.click_count||0), fmtPct(st.click_rate||0)+' rate', '#7C3AED')}
            ${_statCard('Bounced', fmtNum(st.bounce_count||0), fmtPct(st.bounce_rate||0)+' rate', '#EF4444')}
            ${_statCard('Complained', fmtNum(st.complaint_count||0), '', '#D97706')}
          </div>
          <div id="eb_detailMsg" style="font-size:0.82rem;margin-bottom:10px"></div>
          <div style="display:flex;gap:8px;border-bottom:1px solid #E5E7EB;margin-bottom:14px">
            ${['stats','recipients','add-recipients'].map(t=>`<button onclick="window._ebTab('${t}',${id})" style="padding:7px 14px;background:transparent;border:none;border-bottom:${_detailTab===t?'2px solid #7C3AED':'2px solid transparent'};font-size:0.8rem;font-weight:700;color:${_detailTab===t?'#7C3AED':'#6B7280'};cursor:pointer">${t==='stats'?'📊 Stats':t==='recipients'?'👥 Recipients':'➕ Add Recipients'}</button>`).join('')}
          </div>
          <div id="eb_tabContent">Loading…</div>
        </div>`;
      window._ebTab(_detailTab, id);
    } catch(e) { wrap.innerHTML = `<div style="color:#991B1B;padding:16px">Error: ${_escapeHtml(e.message)}</div>`; }
  };

  window._ebTab = async function(tab, id) {
    _detailTab = tab;
    const tc = document.getElementById('eb_tabContent'); if (!tc) return;
    // Refresh tab button styles
    document.querySelectorAll('#ebWrap button').forEach(b => {
      const t = b.getAttribute('onclick');
      if (t && t.includes("_ebTab(")) {
        const active = t.includes(`'${tab}'`);
        b.style.borderBottom = active ? '2px solid #7C3AED' : '2px solid transparent';
        b.style.color = active ? '#7C3AED' : '#6B7280';
      }
    });
    if (tab === 'stats') {
      tc.innerHTML = `<div style="font-size:0.82rem;color:#6B7280">Stats are shown in the cards above. Send rate, open rate, click rate and bounce rate update in real time as Resend delivers and recipients engage.</div>
        <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:12px 16px;margin-top:12px;font-size:0.8rem;color:#92400E">
          <strong>Webhook setup:</strong> To get live open/click/bounce tracking, add <code>POST ${window.location.origin}/api/email-broadcast/webhook</code> as an endpoint in your <a href="https://resend.com/webhooks" target="_blank" style="color:#0066FF">Resend Webhooks dashboard</a> and select the <em>email.opened, email.clicked, email.bounced, email.complained</em> events.
        </div>`;
    } else if (tab === 'recipients') {
      tc.innerHTML = `<div style="color:#6B7280;font-size:0.82rem">Loading recipients…</div>`;
      try {
        const r = await fetch(`/api/email-broadcast/broadcasts/${id}/recipients?limit=200`).then(x=>x.json());
        if (!r.ok) throw new Error(r.error);
        const recips = r.recipients || [];
        if (!recips.length) { tc.innerHTML = `<div style="color:#6B7280;font-size:0.82rem;padding:12px">No recipients yet — use the "Add Recipients" tab to upload contacts.</div>`; return; }
        tc.innerHTML = `
          <div style="font-size:0.76rem;color:#6B7280;margin-bottom:8px">${fmtNum(r.total)} total recipients</div>
          <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.8rem">
            <thead><tr style="background:#F9FAFB">
              <th style="padding:7px 10px;text-align:left;font-size:0.68rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">EMAIL</th>
              <th style="padding:7px 10px;text-align:left;font-size:0.68rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">NAME</th>
              <th style="padding:7px 10px;text-align:center;font-size:0.68rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">STATUS</th>
              <th style="padding:7px 10px;text-align:right;font-size:0.68rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">SENT</th>
              <th style="padding:7px 10px;text-align:right;font-size:0.68rem;font-weight:700;color:#6B7280;border-bottom:1px solid #E5E7EB">OPENED</th>
            </tr></thead>
            <tbody>
              ${recips.map(r => `<tr style="border-bottom:1px solid #F3F4F6">
                <td style="padding:7px 10px;color:#374151">${_escapeHtml(r.email)}</td>
                <td style="padding:7px 10px;color:#6B7280">${_escapeHtml(r.name||'—')}</td>
                <td style="padding:7px 10px;text-align:center">${recipBadge(r.status)}</td>
                <td style="padding:7px 10px;text-align:right;color:#9CA3AF;font-size:0.72rem">${fmtDate(r.sent_at)}</td>
                <td style="padding:7px 10px;text-align:right;color:#9CA3AF;font-size:0.72rem">${fmtDate(r.opened_at)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`;
      } catch(e) { tc.innerHTML = `<div style="color:#EF4444;font-size:0.82rem">${_escapeHtml(e.message)}</div>`; }
    } else if (tab === 'add-recipients') {
      tc.innerHTML = `
        <div style="max-width:500px">
          <div style="font-size:0.82rem;color:#374151;margin-bottom:10px">Paste one email per line, or use CSV format: <code>email,name</code></div>
          <textarea id="eb_recipInput" rows="8" placeholder="alice@example.com, Alice Smith&#10;bob@example.com&#10;carol@example.com, Carol" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:0.82rem;font-family:monospace;color:#0A1628;resize:vertical;margin-bottom:10px"></textarea>
          <button onclick="window._ebAddRecipients(${id})" style="padding:9px 20px;background:#0066FF;border:none;border-radius:7px;color:#fff;font-size:0.82rem;font-weight:700;cursor:pointer">Add Recipients</button>
          <div id="eb_recipMsg" style="margin-top:8px;font-size:0.8rem"></div>
        </div>`;
    }
  };

  window._ebAddRecipients = async function(id) {
    const raw = document.getElementById('eb_recipInput')?.value || '';
    const msg = document.getElementById('eb_recipMsg');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const emails = lines.map(l => {
      const parts = l.split(',');
      return { email: parts[0].trim().toLowerCase(), name: (parts[1]||'').trim().replace(/^["']|["']$/g,'') };
    }).filter(r => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
    if (!emails.length) { if(msg) msg.innerHTML = '<span style="color:#EF4444">No valid email addresses found.</span>'; return; }
    if(msg) msg.innerHTML = `<span style="color:#6B7280">Adding ${emails.length} recipients…</span>`;
    try {
      const r = await fetch(`/api/email-broadcast/broadcasts/${id}/recipients`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ emails })
      }).then(x=>x.json());
      if (!r.ok) throw new Error(r.error);
      if(msg) msg.innerHTML = `<span style="color:#059669">Added ${r.added} new recipients (${r.total - r.added} duplicates skipped).</span>`;
      setTimeout(() => window._ebDetail(id), 1200);
    } catch(e) { if(msg) msg.innerHTML = `<span style="color:#EF4444">${_escapeHtml(e.message)}</span>`; }
  };

  window._ebSend = async function(id) {
    const msg = document.getElementById('eb_detailMsg');
    if (!confirm('Send this broadcast to all queued recipients? This cannot be undone.')) return;
    if(msg) msg.innerHTML = '<span style="color:#6B7280">Sending…</span>';
    try {
      const r = await fetch(`/api/email-broadcast/broadcasts/${id}/send`, { method:'POST' }).then(x=>x.json());
      if (!r.ok) throw new Error(r.error);
      if(msg) msg.innerHTML = `<span style="color:#059669">${_escapeHtml(r.message)}</span>`;
      setTimeout(() => window._ebDetail(id), 2000);
    } catch(e) { if(msg) msg.innerHTML = `<span style="color:#EF4444">${_escapeHtml(e.message)}</span>`; }
  };

  window._ebDelete = async function(id) {
    if (!confirm('Delete this broadcast? This cannot be undone.')) return;
    try {
      await fetch(`/api/email-broadcast/broadcasts/${id}`, { method:'DELETE' });
      window.buildEmailBroadcast();
    } catch(e) { alert('Error: ' + e.message); }
  };

  _renderList();
};

// ── T41-A Hunter.io Email Finder ──────────────────────────────────────────────
window.buildHunter = function() {
  const wrap = document.getElementById('hunterWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const tabs = [
    { id: 'domain',   label: '🔍 Domain Search',   title: 'Find all emails at a domain' },
    { id: 'finder',   label: '🎯 Email Finder',     title: 'Find a specific person\'s email' },
    { id: 'verifier', label: '✅ Email Verifier',   title: 'Verify any email address' },
    { id: 'history',  label: '🕘 Search History',   title: 'Past searches' }
  ];
  let activeTab = 'domain';

  function render() {
    wrap.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">
        ${tabs.map(t => `<button onclick="window._hunterTab('${t.id}')" style="padding:8px 18px;border-radius:20px;border:2px solid ${activeTab===t.id?'#6C63FF':'#E5E7EB'};background:${activeTab===t.id?'#6C63FF':'#fff'};color:${activeTab===t.id?'#fff':'#374151'};font-size:0.84rem;font-weight:600;cursor:pointer">${t.label}</button>`).join('')}
      </div>
      <div id="hunterTabBody"></div>`;
    const body = document.getElementById('hunterTabBody');
    if (activeTab === 'domain')   renderDomain(body);
    else if (activeTab === 'finder')   renderFinder(body);
    else if (activeTab === 'verifier') renderVerifier(body);
    else renderHistory(body);
  }

  window._hunterTab = function(t) { activeTab = t; render(); };

  function _confidenceColor(n) { return n >= 80 ? '#16A34A' : n >= 50 ? '#D97706' : '#DC2626'; }
  function _verifyColor(s) { return {deliverable:'#16A34A', risky:'#D97706', undeliverable:'#DC2626', unknown:'#6B7280'}[s] || '#6B7280'; }

  function renderDomain(body) {
    body.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px;max-width:640px;margin-bottom:24px">
        <h3 style="margin:0 0 4px;font-size:1rem;font-weight:700;color:#111">Domain Search</h3>
        <p style="margin:0 0 18px;font-size:0.84rem;color:#6B7280">Find all email addresses associated with a company domain.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <input id="hDomain" placeholder="acme.com" style="flex:1;min-width:200px;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.9rem">
          <select id="hType" style="padding:10px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.84rem;background:#fff">
            <option value="">All types</option><option value="personal">Personal only</option><option value="generic">Generic only</option>
          </select>
          <button onclick="window._hunterDomainSearch()" style="padding:10px 20px;background:#6C63FF;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Search</button>
        </div>
        <p style="margin:10px 0 0;font-size:0.78rem;color:#9CA3AF">No API key yet? <strong>Add HUNTER_API_KEY</strong> to environment secrets — <a href="https://hunter.io/api-keys" target="_blank" style="color:#6C63FF">get your free key at hunter.io</a> (25 searches/month free).</p>
      </div>
      <div id="hunterDomainResult"></div>`;

    window._hunterDomainSearch = async function() {
      const domain = document.getElementById('hDomain')?.value.trim();
      const type   = document.getElementById('hType')?.value;
      if (!domain) return;
      const res = document.getElementById('hunterDomainResult');
      res.innerHTML = '<div style="color:#6B7280;font-size:0.9rem;padding:12px">Searching...</div>';
      try {
        const r = await fetch('/api/hunter/domain-search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain, type }) });
        const d = await r.json();
        if (!d.ok) { res.innerHTML = `<div style="color:#DC2626;padding:12px;background:#FEF2F2;border-radius:8px">${_escapeHtml(d.error || 'Search failed')}</div>`; return; }
        const { result } = d;
        res.innerHTML = `
          <div style="margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap">
            <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px 24px;text-align:center"><div style="font-size:1.6rem;font-weight:800;color:#16A34A">${result.emails.length}</div><div style="font-size:0.78rem;color:#6B7280">Emails found</div></div>
            <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:16px 24px;text-align:center"><div style="font-size:1.1rem;font-weight:700;color:#1D4ED8">${_escapeHtml(result.organization || result.domain)}</div><div style="font-size:0.78rem;color:#6B7280">${_escapeHtml(result.pattern ? 'Pattern: ' + result.pattern : result.country || '')}</div></div>
          </div>
          ${result.emails.length === 0 ? '<div style="color:#6B7280;padding:16px;background:#F9FAFB;border-radius:8px;text-align:center">No emails found for this domain.</div>' :
          `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.84rem">
            <thead><tr style="background:#F9FAFB">${['Email','Confidence','Name','Position','Type','Sources'].map(h=>`<th style="padding:10px 14px;text-align:left;border-bottom:2px solid #E5E7EB;font-weight:700;color:#374151">${h}</th>`).join('')}</tr></thead>
            <tbody>${result.emails.map(e=>`<tr style="border-bottom:1px solid #F3F4F6">
              <td style="padding:10px 14px;font-family:monospace;font-size:0.83rem">${_escapeHtml(e.value)}</td>
              <td style="padding:10px 14px"><span style="color:${_confidenceColor(e.confidence)};font-weight:700">${e.confidence}%</span></td>
              <td style="padding:10px 14px">${_escapeHtml((e.first_name+' '+e.last_name).trim() || '—')}</td>
              <td style="padding:10px 14px;color:#6B7280">${_escapeHtml(e.position || '—')}</td>
              <td style="padding:10px 14px;text-transform:capitalize">${_escapeHtml(e.type || '—')}</td>
              <td style="padding:10px 14px;color:#6B7280">${e.sources}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}`;
      } catch(err) { res.innerHTML = `<div style="color:#DC2626;padding:12px">Error: ${_escapeHtml(err.message)}</div>`; }
    };
  }

  function renderFinder(body) {
    body.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px;max-width:640px;margin-bottom:24px">
        <h3 style="margin:0 0 4px;font-size:1rem;font-weight:700;color:#111">Email Finder</h3>
        <p style="margin:0 0 18px;font-size:0.84rem;color:#6B7280">Know the name? Hunter will find their most likely email address.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <input id="hFFirst" data-ig-skip placeholder="First name" style="padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.9rem">
          <input id="hFLast"  data-ig-skip placeholder="Last name"  style="padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.9rem">
        </div>
        <div style="display:flex;gap:10px">
          <input id="hFDomain" data-ig-skip placeholder="company.com" style="flex:1;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.9rem">
          <button onclick="window._hunterFinder()" style="padding:10px 20px;background:#6C63FF;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Find Email</button>
        </div>
      </div>
      <div id="hunterFinderResult"></div>`;

    window._hunterFinder = async function() {
      const fn = document.getElementById('hFFirst')?.value.trim();
      const ln = document.getElementById('hFLast')?.value.trim();
      const dm = document.getElementById('hFDomain')?.value.trim();
      if (!fn || !ln || !dm) { alert('Please fill in first name, last name and domain.'); return; }
      const res = document.getElementById('hunterFinderResult');
      res.innerHTML = '<div style="color:#6B7280;padding:12px">Finding email...</div>';
      try {
        const r = await fetch('/api/hunter/email-finder', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ first_name:fn, last_name:ln, domain:dm }) });
        const d = await r.json();
        if (!d.ok) { res.innerHTML = `<div style="color:#DC2626;padding:12px;background:#FEF2F2;border-radius:8px">${_escapeHtml(d.error)}</div>`; return; }
        const e = d.result;
        res.innerHTML = e.email ? `
          <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:20px 24px;max-width:500px">
            <div style="font-size:1.1rem;font-weight:800;color:#16A34A;font-family:monospace;margin-bottom:8px">${_escapeHtml(e.email)}</div>
            <div style="display:flex;gap:24px;font-size:0.84rem;color:#374151">
              <span>Score: <strong style="color:${_confidenceColor(e.score)}">${e.score}%</strong></span>
              ${e.position ? `<span>Role: <strong>${_escapeHtml(e.position)}</strong></span>` : ''}
              ${e.company ? `<span>Company: <strong>${_escapeHtml(e.company)}</strong></span>` : ''}
              <span>Sources: <strong>${e.sources}</strong></span>
            </div>
            <button onclick="navigator.clipboard.writeText('${_escapeHtml(e.email).replace(/'/g,"\\'")}');this.textContent='✅ Copied!';setTimeout(()=>this.textContent='📋 Copy Email',1500)" style="margin-top:12px;padding:8px 16px;background:#6C63FF;color:#fff;border:none;border-radius:7px;font-size:0.84rem;font-weight:600;cursor:pointer">📋 Copy Email</button>
          </div>` : '<div style="color:#6B7280;padding:16px;background:#F9FAFB;border-radius:8px">No email found for this person. Try a domain search to see all emails on record.</div>';
      } catch(err) { res.innerHTML = `<div style="color:#DC2626;padding:12px">Error: ${_escapeHtml(err.message)}</div>`; }
    };
  }

  function renderVerifier(body) {
    body.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px;max-width:560px;margin-bottom:24px">
        <h3 style="margin:0 0 4px;font-size:1rem;font-weight:700;color:#111">Email Verifier</h3>
        <p style="margin:0 0 18px;font-size:0.84rem;color:#6B7280">Check deliverability before you send — avoid bounces and protect your sender reputation.</p>
        <div style="display:flex;gap:10px">
          <input id="hVerEmail" placeholder="name@company.com" style="flex:1;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.9rem">
          <button onclick="window._hunterVerify()" style="padding:10px 20px;background:#6C63FF;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Verify</button>
        </div>
      </div>
      <div id="hunterVerifyResult"></div>`;

    window._hunterVerify = async function() {
      const email = document.getElementById('hVerEmail')?.value.trim();
      if (!email) return;
      const res = document.getElementById('hunterVerifyResult');
      res.innerHTML = '<div style="color:#6B7280;padding:12px">Verifying...</div>';
      try {
        const r = await fetch('/api/hunter/email-verifier', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
        const d = await r.json();
        if (!d.ok) { res.innerHTML = `<div style="color:#DC2626;padding:12px;background:#FEF2F2;border-radius:8px">${_escapeHtml(d.error)}</div>`; return; }
        const v = d.result;
        const statusColor = _verifyColor(v.status);
        const checks = [
          { label:'Format valid',   val: v.regexp },
          { label:'MX records',     val: v.mx_records },
          { label:'SMTP check',     val: v.smtp_check },
          { label:'Not disposable', val: v.disposable === false },
          { label:'Not catch-all',  val: v.accept_all === false },
          { label:'Not blocked',    val: v.block === false }
        ];
        res.innerHTML = `
          <div style="background:#fff;border:2px solid ${statusColor};border-radius:12px;padding:20px 24px;max-width:500px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
              <div style="width:14px;height:14px;border-radius:50%;background:${statusColor}"></div>
              <span style="font-size:1rem;font-weight:800;color:${statusColor};text-transform:capitalize">${_escapeHtml(v.status)}</span>
              <span style="font-size:0.84rem;color:#6B7280;margin-left:auto">Score: <strong style="color:${_confidenceColor(v.score)}">${v.score}%</strong></span>
            </div>
            <div style="font-family:monospace;font-size:0.9rem;color:#374151;margin-bottom:16px">${_escapeHtml(v.email)}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${checks.map(c=>`<div style="display:flex;align-items:center;gap:8px;font-size:0.83rem;color:#374151">
                <span style="color:${c.val?'#16A34A':'#DC2626'}">${c.val?'✓':'✗'}</span>${_escapeHtml(c.label)}
              </div>`).join('')}
            </div>
          </div>`;
      } catch(err) { res.innerHTML = `<div style="color:#DC2626;padding:12px">Error: ${_escapeHtml(err.message)}</div>`; }
    };
  }

  function renderHistory(body) {
    body.innerHTML = '<div style="color:#6B7280;padding:12px">Loading history...</div>';
    fetch('/api/hunter/history').then(r=>r.json()).then(d=>{
      if (!d.ok || !d.history.length) { body.innerHTML = '<div style="color:#6B7280;padding:16px;background:#F9FAFB;border-radius:8px;text-align:center">No searches yet.</div>'; return; }
      const typeColors = { domain:'#6C63FF', finder:'#059669', verifier:'#D97706' };
      body.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.84rem">
        <thead><tr style="background:#F9FAFB">${['Type','Query','Result','Date'].map(h=>`<th style="padding:10px 14px;text-align:left;border-bottom:2px solid #E5E7EB;font-weight:700;color:#374151">${h}</th>`).join('')}</tr></thead>
        <tbody>${d.history.map(h=>{
          let resultText = '';
          if (h.type==='domain') resultText = `${h.total_emails||0} emails found`;
          else if (h.type==='finder') resultText = h.found_email || 'Not found';
          else resultText = h.verify_status || '—';
          return `<tr style="border-bottom:1px solid #F3F4F6">
            <td style="padding:10px 14px"><span style="padding:3px 10px;border-radius:12px;background:${typeColors[h.type]||'#6B7280'}20;color:${typeColors[h.type]||'#6B7280'};font-size:0.78rem;font-weight:700;text-transform:capitalize">${_escapeHtml(h.type)}</span></td>
            <td style="padding:10px 14px;font-family:monospace;font-size:0.83rem">${_escapeHtml(h.query)}</td>
            <td style="padding:10px 14px;color:#374151">${_escapeHtml(resultText)}</td>
            <td style="padding:10px 14px;color:#9CA3AF;font-size:0.8rem">${new Date(h.created_at).toLocaleDateString()}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }).catch(()=>{ body.innerHTML = '<div style="color:#DC2626;padding:12px">Failed to load history.</div>'; });
  }

  render();
};

// ── T41-B LinkedIn Ad Spy ─────────────────────────────────────────────────────
window.buildLinkedinAds = function() {
  const wrap = document.getElementById('linkedinAdsWrap');
  if (!wrap) return;

  let history = [];

  async function loadHistory() {
    try { const r = await fetch('/api/linkedin-ads/history'); const d = await r.json(); history = d.history || []; } catch { history = []; }
  }

  async function render() {
    await loadHistory();
    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:900px;margin-bottom:24px">
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px">
          <h3 style="margin:0 0 4px;font-size:1rem;font-weight:700;color:#111">Research Competitor LinkedIn Ads</h3>
          <p style="margin:0 0 16px;font-size:0.83rem;color:#6B7280">AI-powered research against the LinkedIn Ad Library — ad formats, copy themes, targeting signals, budget tier and gaps to exploit.</p>
          <input id="ladCompany" data-ig-skip placeholder="Company name or domain (e.g. hubspot.com)" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.9rem;margin-bottom:10px">
          <input id="ladIndustry" placeholder="Industry (optional)" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.9rem;margin-bottom:14px">
          <div style="display:flex;gap:10px">
            <button onclick="window._ladSearch()" style="flex:1;padding:11px;background:#0077B5;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">🔍 Research Ads</button>
            <button onclick="window.open('https://www.linkedin.com/ad-library/','_blank')" style="padding:11px 14px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;font-size:0.84rem;cursor:pointer">Open Library ↗</button>
          </div>
        </div>
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:20px">
          <h4 style="margin:0 0 10px;font-size:0.9rem;font-weight:700;color:#1D4ED8">Recent Searches</h4>
          ${history.length === 0 ? '<p style="font-size:0.83rem;color:#6B7280;margin:0">No searches yet.</p>' :
          history.slice(0,5).map(h=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer" data-company="${_escapeHtml(h.company)}" onclick="document.getElementById('ladCompany').value=this.dataset.company">
            <span style="font-size:0.84rem;font-weight:600;color:#1D4ED8">💼 ${_escapeHtml(h.company)}</span>
            <span style="font-size:0.75rem;color:#9CA3AF;margin-left:auto">${new Date(h.created_at).toLocaleDateString()}</span>
          </div>`).join('')}
        </div>
      </div>
      <div id="ladResult"></div>`;

    window._ladSearch = async function() {
      const company  = document.getElementById('ladCompany')?.value.trim();
      const industry = document.getElementById('ladIndustry')?.value.trim();
      if (!company) { alert('Enter a company name.'); return; }
      const res = document.getElementById('ladResult');
      res.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:32px;text-align:center;color:#6B7280">
        <div style="font-size:1.4rem;margin-bottom:8px">🔍</div>
        Researching ${_escapeHtml(company)} LinkedIn ads — this takes 10–20 seconds...
      </div>`;
      try {
        const r = await fetch('/api/linkedin-ads/search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ company, industry }) });
        const d = await r.json();
        if (!d.ok) { res.innerHTML = `<div style="color:#DC2626;padding:16px;background:#FEF2F2;border-radius:10px">${_escapeHtml(d.error)}</div>`; return; }
        const x = d.result;

        const fmtTable = (arr, cols) => arr && arr.length ? `<table style="width:100%;border-collapse:collapse;font-size:0.83rem;margin-top:8px">
          <thead><tr>${cols.map(c=>`<th style="padding:8px 12px;text-align:left;background:#F9FAFB;border-bottom:2px solid #E5E7EB;font-weight:700;color:#374151">${c}</th>`).join('')}</tr></thead>
          <tbody>${arr.map(row=>`<tr style="border-bottom:1px solid #F3F4F6">${Object.values(row).map(v=>`<td style="padding:8px 12px;color:#374151">${_escapeHtml(String(v||''))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>` : '<p style="color:#9CA3AF;font-size:0.83rem;margin:8px 0">No data available.</p>';

        const section = (title, content) => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:18px 20px;margin-bottom:14px">
          <h4 style="margin:0 0 10px;font-size:0.9rem;font-weight:700;color:#111">${title}</h4>${content}</div>`;

        const chipList = (arr) => arr && arr.length ? arr.map(s=>`<span style="display:inline-block;padding:4px 12px;margin:3px;border-radius:12px;background:#F0F7FF;border:1px solid #BFDBFE;color:#1D4ED8;font-size:0.8rem">${_escapeHtml(String(s))}</span>`).join('') : '<span style="color:#9CA3AF;font-size:0.83rem">Not available</span>';

        res.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;background:#0077B5;color:#fff;padding:16px 20px;border-radius:12px">
            <span style="font-size:1.5rem">💼</span>
            <div><div style="font-size:1.1rem;font-weight:800">${_escapeHtml(x.company || company)} — LinkedIn Ad Intelligence</div>
            <div style="font-size:0.84rem;opacity:0.85;margin-top:2px">${_escapeHtml(x.posting_cadence ? 'Cadence: ' + x.posting_cadence : '')} ${_escapeHtml(x.budget_signal ? '· Budget: ' + x.budget_signal : '')}</div></div>
            <a href="https://www.linkedin.com/ad-library/search?q=${encodeURIComponent(company)}" target="_blank" style="margin-left:auto;padding:8px 14px;background:rgba(255,255,255,0.2);border-radius:8px;color:#fff;text-decoration:none;font-size:0.83rem;font-weight:600">View Library ↗</a>
          </div>

          ${section('Overview', `<p style="margin:0;font-size:0.88rem;color:#374151;line-height:1.6">${_escapeHtml(x.overview || 'No overview available.')}</p>`)}

          ${section('Ad Formats Used', fmtTable(x.ad_formats, ['Format','Usage','Frequency']))}

          ${section('Copy Themes & CTAs', fmtTable(x.copy_themes, ['Theme','Example Headline','Example CTA']))}

          ${section('Targeting Signals', `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><div style="font-size:0.78rem;font-weight:700;color:#6B7280;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Likely Audiences</div>${chipList(x.targeting?.likely_audiences)}</div>
              <div><div style="font-size:0.78rem;font-weight:700;color:#6B7280;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Job Titles</div>${chipList(x.targeting?.job_titles)}</div>
              <div><div style="font-size:0.78rem;font-weight:700;color:#6B7280;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Industries</div>${chipList(x.targeting?.industries)}</div>
              <div><div style="font-size:0.78rem;font-weight:700;color:#6B7280;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Seniority</div>${chipList(x.targeting?.seniority)}</div>
            </div>`)}

          ${section('Gaps to Exploit', `<ol style="margin:0;padding-left:20px">${(x.gaps_to_exploit||[]).map(g=>`<li style="font-size:0.85rem;color:#374151;margin-bottom:6px;line-height:1.5">${_escapeHtml(g)}</li>`).join('') || '<li style="color:#9CA3AF">No gaps identified.</li>'}</ol>`)}

          ${x.top_performing_angles && x.top_performing_angles.length ? section('Top Performing Angles', chipList(x.top_performing_angles)) : ''}`;

        await loadHistory();
      } catch(err) { res.innerHTML = `<div style="color:#DC2626;padding:16px">Error: ${_escapeHtml(err.message)}</div>`; }
    };
  }

  render();
};

// ── T41-C Canva Template Launcher ────────────────────────────────────────────
window.buildCanvaLauncher = function() {
  const wrap = document.getElementById('canvaWrap');
  if (!wrap) return;

  let activeCategory = 'social-post';
  let templates = [];

  async function load() {
    try { const r = await fetch('/api/canva/templates'); const d = await r.json(); templates = d.templates || []; } catch { templates = []; }
    render();
  }

  function render() {
    const cat = templates.find(t => t.category === activeCategory) || templates[0];
    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1100px">
        <div>
          <h3 style="margin:0 0 14px;font-size:1rem;font-weight:700;color:#111">Browse by Content Type</h3>
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:24px">
            ${templates.map(t=>`<button onclick="window._canvaCategory('${t.category}')" style="text-align:left;padding:10px 16px;border-radius:10px;border:2px solid ${activeCategory===t.category?'#7B68EE':'#E5E7EB'};background:${activeCategory===t.category?'#F5F3FF':'#fff'};cursor:pointer;font-size:0.88rem;display:flex;align-items:center;gap:10px">
              <span style="font-size:1.2rem">${t.icon}</span>
              <div>
                <div style="font-weight:700;color:${activeCategory===t.category?'#7B68EE':'#111'}">${_escapeHtml(t.label)}</div>
                <div style="font-size:0.77rem;color:#6B7280;margin-top:1px">${_escapeHtml(t.description)}</div>
              </div>
            </button>`).join('')}
          </div>
        </div>

        <div>
          <h3 style="margin:0 0 14px;font-size:1rem;font-weight:700;color:#111">${cat ? _escapeHtml(cat.icon + ' ' + cat.label) : 'Templates'}</h3>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">
            ${cat ? cat.templates.map(t=>`
              <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:14px">
                <div style="flex:1">
                  <div style="font-weight:700;font-size:0.9rem;color:#111">${_escapeHtml(t.name)}</div>
                  <div style="font-size:0.78rem;color:#6B7280;margin-top:2px">Platform: ${_escapeHtml(t.platform)}</div>
                </div>
                <a href="${_safeUrl(t.url)}" target="_blank" style="padding:8px 16px;background:#7B68EE;color:#fff;border-radius:8px;text-decoration:none;font-size:0.83rem;font-weight:700;white-space:nowrap">Open in Canva ↗</a>
              </div>`).join('') : ''}
          </div>

          <div style="background:#FFF8F0;border:1px solid #FDE68A;border-radius:12px;padding:20px">
            <h4 style="margin:0 0 10px;font-size:0.9rem;font-weight:700;color:#92400E">📋 Format Copy for Canva</h4>
            <p style="margin:0 0 12px;font-size:0.82rem;color:#78350F">Paste your InfoGenie content below and get it formatted for easy copy-paste into any Canva text field.</p>
            <select id="canvaFormatType" style="width:100%;padding:9px 12px;border:1px solid #FCA5A5;border-radius:8px;font-size:0.84rem;background:#fff;margin-bottom:10px">
              <option value="social-post">Social Post</option>
              <option value="carousel">Carousel (slides)</option>
              <option value="email">Email</option>
              <option value="ad-creative">Ad Creative</option>
              <option value="blog">Blog / Article</option>
            </select>
            <input id="canvaTitle" placeholder="Headline / Title" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.84rem;margin-bottom:8px">
            <textarea id="canvaBody" placeholder="Body copy..." rows="4" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.84rem;resize:vertical;margin-bottom:8px"></textarea>
            <input id="canvaCta" placeholder="CTA text (e.g. Learn More)" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.84rem;margin-bottom:10px">
            <button onclick="window._canvaFormat()" style="width:100%;padding:10px;background:#7B68EE;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Format for Canva</button>
            <div id="canvaFormatResult" style="margin-top:12px"></div>
          </div>
        </div>
      </div>

      <div style="margin-top:24px;background:linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 100%);border:1.5px solid #DDD6FE;border-radius:14px;padding:22px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <span style="font-size:1.4rem">🪄</span>
          <div>
            <h3 style="margin:0;font-size:1rem;font-weight:800;color:#4C1D95">Image Background Remover</h3>
            <p style="margin:2px 0 0;font-size:0.78rem;color:#6D28D9">Powered by remove.bg · Perfect for ad creatives, product shots &amp; Canva templates</p>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px">
          <div>
            <label style="font-size:0.8rem;font-weight:700;color:#4C1D95;display:block;margin-bottom:6px">Upload an image</label>
            <input type="file" id="rbgFileInput" accept="image/*" style="display:none" onchange="window._rbgHandleFile(this)">
            <button onclick="document.getElementById('rbgFileInput').click()" style="width:100%;padding:10px 14px;background:#fff;border:2px dashed #A78BFA;border-radius:10px;color:#6D28D9;font-weight:700;cursor:pointer;font-size:0.84rem">📁 Choose file (JPG, PNG, WebP)</button>
          </div>
          <div>
            <label style="font-size:0.8rem;font-weight:700;color:#4C1D95;display:block;margin-bottom:6px">Or paste an image URL</label>
            <div style="display:flex;gap:8px">
              <input id="rbgUrlInput" data-ig-skip placeholder="https://example.com/product.jpg" style="flex:1;padding:9px 12px;border:1.5px solid #C4B5FD;border-radius:8px;font-size:0.82rem">
              <button onclick="window._rbgHandleUrl()" style="padding:9px 16px;background:#7B68EE;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;white-space:nowrap">Remove BG</button>
            </div>
          </div>
        </div>
        <div id="rbgResult" style="margin-top:14px"></div>
      </div>`;

    window._canvaCategory = function(c) { activeCategory = c; render(); };

    window._canvaFormat = async function() {
      const type  = document.getElementById('canvaFormatType')?.value;
      const title = document.getElementById('canvaTitle')?.value.trim();
      const body  = document.getElementById('canvaBody')?.value.trim();
      const cta   = document.getElementById('canvaCta')?.value.trim();
      if (!title && !body) { alert('Add at least a title or body copy.'); return; }
      const res = document.getElementById('canvaFormatResult');
      try {
        const r = await fetch('/api/canva/format', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type, title, body, cta }) });
        const d = await r.json();
        if (!d.ok) { res.innerHTML = `<div style="color:#DC2626;padding:10px">${_escapeHtml(d.error)}</div>`; return; }
        res.innerHTML = `
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:14px">
            <pre style="margin:0;font-size:0.82rem;color:#374151;white-space:pre-wrap;word-break:break-word;font-family:inherit">${_escapeHtml(d.formatted)}</pre>
          </div>
          <button onclick="navigator.clipboard.writeText(${JSON.stringify(d.formatted)});this.textContent='✅ Copied!';setTimeout(()=>this.textContent='📋 Copy to Clipboard',1500)" style="width:100%;margin-top:8px;padding:9px;background:#6C63FF;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">📋 Copy to Clipboard</button>`;
      } catch(err) { res.innerHTML = `<div style="color:#DC2626;padding:10px">Error: ${_escapeHtml(err.message)}</div>`; }
    };

    // ── Background Remover helpers ──────────────────────────────────────────
    async function _rbgProcess(payload, resultEl) {
      resultEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:14px;background:#F5F3FF;border-radius:10px;color:#6D28D9;font-size:0.85rem"><span style="font-size:1.3rem">⏳</span> Removing background… (this can take a few seconds)</div>`;
      try {
        const r = await fetch('/api/tools/remove-bg', {
          method: 'POST',
          headers: payload.json ? { 'Content-Type': 'application/json' } : {},
          body:    payload.json ? JSON.stringify(payload.json) : payload.form
        });
        const d = await r.json();
        if (!d.ok) { resultEl.innerHTML = `<div style="padding:14px;background:#FEE2E2;color:#B91C1C;border-radius:10px;font-size:0.85rem">⚠ ${_escapeHtml(d.error)}</div>`; return; }
        const src = 'data:image/png;base64,' + d.result_b64;
        resultEl.innerHTML = `
          <div style="background:#fff;border:1.5px solid #DDD6FE;border-radius:12px;padding:16px">
            <div style="display:flex;gap:14px;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="font-size:0.78rem;font-weight:700;color:#4C1D95;margin-bottom:8px">✅ Background removed (${d.credits_charged} credit used)</div>
                <img src="${src}" alt="Result" style="max-width:100%;max-height:260px;border-radius:8px;border:1px solid #E5E7EB;background:repeating-conic-gradient(#E5E7EB 0% 25%, #fff 0% 50%) 0 0/20px 20px">
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px">
              <a href="${src}" download="no_bg.png" style="flex:1;text-align:center;padding:9px;background:#7B68EE;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.83rem">⬇ Download PNG</a>
              <button onclick="window._rbgSaveToAssets('${encodeURIComponent(d.result_b64)}')" style="flex:1;padding:9px;background:#10B981;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.83rem">💾 Save to Brand Assets</button>
            </div>
          </div>`;
      } catch(err) {
        resultEl.innerHTML = `<div style="padding:14px;background:#FEE2E2;color:#B91C1C;border-radius:10px;font-size:0.85rem">Error: ${_escapeHtml(err.message)}</div>`;
      }
    }

    window._rbgHandleUrl = async function() {
      const url = document.getElementById('rbgUrlInput')?.value.trim();
      if (!url) { alert('Paste an image URL first.'); return; }
      const res = document.getElementById('rbgResult');
      if (!res) return;
      await _rbgProcess({ json: { image_url: url } }, res);
    };

    window._rbgHandleFile = async function(input) {
      const file = input.files[0];
      if (!file) return;
      const res = document.getElementById('rbgResult');
      if (!res) return;
      const form = new FormData();
      form.append('image', file);
      await _rbgProcess({ form }, res);
    };

    window._rbgSaveToAssets = async function(encodedB64) {
      try {
        const b64 = decodeURIComponent(encodedB64);
        const byteArr = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const blob = new Blob([byteArr], { type: 'image/png' });
        const fname = 'no_bg_' + Date.now() + '.png';
        const file = new File([blob], fname, { type: 'image/png' });
        const form = new FormData();
        form.append('files', file);
        form.append('tag', 'No BG');
        await fetch('/api/creatives/upload', { method: 'POST', body: form });
        showToast('✅ Saved to Brand Assets as "' + fname + '"');
      } catch(e) { showToast('⚠ Save failed: ' + e.message); }
    };
  }

  load();
};

// ── T41-D CRM Sync ────────────────────────────────────────────────────────────
window.buildCrmSync = function() {
  const wrap = document.getElementById('crmSyncWrap');
  if (!wrap) return;

  let providers = [];
  let selectedProvider = null;
  let history = [];
  let activeTab = 'push';

  async function load() {
    try {
      const [pr, hr] = await Promise.all([fetch('/api/crm-sync/providers').then(r=>r.json()), fetch('/api/crm-sync/history').then(r=>r.json())]);
      providers = pr.providers || [];
      history   = hr.history  || [];
      if (!selectedProvider && providers.length) selectedProvider = providers[0].id;
    } catch { providers = []; history = []; }
    render();
  }

  function render() {
    const prov = providers.find(p => p.id === selectedProvider);
    const statusBadge = (p) => p.configured
      ? `<span style="padding:3px 10px;background:#D1FAE5;color:#065F46;border-radius:12px;font-size:0.75rem;font-weight:700">CONFIGURED</span>`
      : `<span style="padding:3px 10px;background:#FEE2E2;color:#991B1B;border-radius:12px;font-size:0.75rem;font-weight:700">NOT SET</span>`;

    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:260px 1fr;gap:20px;max-width:1000px">
        <div>
          <h3 style="margin:0 0 14px;font-size:1rem;font-weight:700;color:#111">Select Platform</h3>
          ${providers.map(p=>`<div onclick="window._crmSelectProvider('${p.id}')" style="background:${selectedProvider===p.id?'#F0F4FF':'#fff'};border:2px solid ${selectedProvider===p.id?p.color:'#E5E7EB'};border-radius:10px;padding:14px 16px;margin-bottom:8px;cursor:pointer">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <span style="font-size:1.4rem">${p.icon}</span>
              <span style="font-weight:700;color:${selectedProvider===p.id?p.color:'#111'}">${_escapeHtml(p.label)}</span>
            </div>
            ${statusBadge(p)}
            ${!p.configured ? `<div style="font-size:0.75rem;color:#9CA3AF;margin-top:6px">Required: ${p.fields.join(', ')}</div>` : ''}
          </div>`).join('')}

          <h4 style="margin:18px 0 10px;font-size:0.88rem;font-weight:700;color:#374151">Sync History</h4>
          ${history.length === 0 ? '<p style="font-size:0.82rem;color:#9CA3AF">No syncs yet.</p>' :
          history.slice(0,5).map(h=>`<div style="font-size:0.8rem;padding:8px 0;border-bottom:1px solid #F3F4F6">
            <div style="display:flex;justify-content:space-between">
              <span style="font-weight:700;color:#374151">${_escapeHtml(h.provider)}</span>
              <span style="color:${h.status==='ok'?'#16A34A':h.status==='partial'?'#D97706':'#DC2626'};font-weight:700">${_escapeHtml(h.status)}</span>
            </div>
            <div style="color:#6B7280">${h.contacts_ok}/${h.contacts_total} pushed · ${new Date(h.created_at).toLocaleDateString()}</div>
          </div>`).join('')}
        </div>

        <div>
          ${prov ? `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;padding:14px 18px;background:${prov.color}18;border:1px solid ${prov.color}44;border-radius:10px">
              <span style="font-size:1.8rem">${prov.icon}</span>
              <div style="flex:1">
                <div style="font-weight:800;font-size:1rem;color:#111">${_escapeHtml(prov.label)}</div>
                <div style="font-size:0.82rem;color:#6B7280">${prov.configured ? 'Ready to sync' : 'API key not yet configured'}</div>
              </div>
              <button onclick="window._crmTest('${prov.id}')" style="padding:8px 16px;background:${prov.color};color:${prov.textColor||'#fff'};border:none;border-radius:8px;font-size:0.83rem;font-weight:700;cursor:pointer">Test Connection</button>
            </div>
            <div id="crmTestResult" style="margin-bottom:14px"></div>

            <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px">
              <h4 style="margin:0 0 14px;font-size:0.9rem;font-weight:700;color:#111">Push Contacts</h4>
              ${prov.id === 'convertkit' ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#92400E;margin-bottom:12px">ConvertKit requires a <strong>Form ID</strong>. Find it in ConvertKit → Forms → click your form → look at the URL: .../forms/<strong>XXXXXX</strong>/edit</div>` : ''}
              ${prov.id === 'mailchimp' ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#92400E;margin-bottom:12px">Mailchimp requires your <strong>Audience/List ID</strong>. Find it in Mailchimp → Audience → Manage Audience → Settings → Audience ID.</div>` : ''}
              <input id="crmListId" placeholder="${prov.id==='convertkit'?'Form ID (e.g. 1234567)':prov.id==='mailchimp'?'Audience ID (e.g. abc123def)':'List ID (optional — leave blank to add without list)'}" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.88rem;margin-bottom:10px">
              <textarea id="crmContacts" placeholder="Paste contacts — one per line.&#10;Accepts: email only, OR email,first_name,last_name&#10;&#10;Examples:&#10;jane@acme.com&#10;john@corp.com,John,Smith" rows="8" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.84rem;resize:vertical;margin-bottom:14px;font-family:monospace"></textarea>
              <button onclick="window._crmPush('${prov.id}')" style="width:100%;padding:12px;background:${prov.color};color:${prov.textColor||'#fff'};border:none;border-radius:8px;font-weight:700;font-size:0.95rem;cursor:pointer">Push to ${_escapeHtml(prov.label)} →</button>
              <div id="crmPushResult" style="margin-top:14px"></div>
            </div>
          ` : '<div style="color:#6B7280;padding:16px">Select a platform to continue.</div>'}
        </div>
      </div>`;

    window._crmSelectProvider = function(id) { selectedProvider = id; render(); };

    window._crmTest = async function(pid) {
      const res = document.getElementById('crmTestResult');
      res.innerHTML = '<div style="color:#6B7280;font-size:0.84rem;padding:10px">Testing connection...</div>';
      try {
        const r = await fetch('/api/crm-sync/test', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ provider: pid }) });
        const d = await r.json();
        res.innerHTML = d.ok
          ? `<div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:8px;padding:10px 14px;color:#065F46;font-size:0.84rem;font-weight:600">✓ ${_escapeHtml(d.message || 'Connected successfully.')}</div>`
          : `<div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:8px;padding:10px 14px;color:#991B1B;font-size:0.84rem">${_escapeHtml(d.error || 'Connection failed — check your API key.')}</div>`;
      } catch(e) { res.innerHTML = `<div style="color:#DC2626;font-size:0.84rem;padding:10px">Error: ${_escapeHtml(e.message)}</div>`; }
    };

    window._crmPush = async function(pid) {
      const raw    = (document.getElementById('crmContacts')?.value || '').trim();
      const listId = (document.getElementById('crmListId')?.value || '').trim();
      if (!raw) { alert('Paste at least one contact email.'); return; }
      const contacts = raw.split('\n').map(line => {
        const parts = line.trim().split(',');
        return { email: (parts[0]||'').trim(), first_name: (parts[1]||'').trim(), last_name: (parts[2]||'').trim() };
      }).filter(c => c.email);
      if (!contacts.length) { alert('No valid email addresses found. Make sure each line starts with an email address.'); return; }
      const res = document.getElementById('crmPushResult');
      const provLabel = providers.find(p=>p.id===pid)?.label || pid;
      res.innerHTML = `<div style="color:#6B7280;font-size:0.84rem;padding:10px">Pushing ${contacts.length} contact${contacts.length!==1?'s':''} to ${_escapeHtml(provLabel)}...</div>`;
      try {
        const r = await fetch('/api/crm-sync/push', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ provider: pid, contacts, list_id: listId, form_id: listId }) });
        const d = await r.json();
        if (!d.ok) { res.innerHTML = `<div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:8px;padding:14px;color:#991B1B;font-size:0.84rem">${_escapeHtml(d.error)}</div>`; return; }
        const statusColor = d.status==='ok'?'#D1FAE5':d.status==='partial'?'#FEF3C7':'#FEE2E2';
        const statusText  = d.status==='ok'?'#065F46':d.status==='partial'?'#92400E':'#991B1B';
        res.innerHTML = `
          <div style="background:${statusColor};border-radius:10px;padding:16px 20px">
            <div style="font-size:1rem;font-weight:800;color:${statusText};margin-bottom:8px">${d.status==='ok'?'✓ All contacts pushed!':d.status==='partial'?'⚠️ Partially pushed':'✗ Push failed'}</div>
            <div style="display:flex;gap:20px;font-size:0.84rem;color:${statusText}">
              <span>Pushed: <strong>${d.pushed}</strong></span>
              <span>Failed: <strong>${d.failed}</strong></span>
              <span>Total: <strong>${d.total}</strong></span>
            </div>
            ${d.errors && d.errors.length ? `<div style="margin-top:10px;font-size:0.78rem;color:#DC2626">${d.errors.map(e=>_escapeHtml(e)).join('<br>')}</div>` : ''}
          </div>`;
        await load();
      } catch(e) { res.innerHTML = `<div style="color:#DC2626;font-size:0.84rem;padding:10px">Error: ${_escapeHtml(e.message)}</div>`; }
    };
  }

  load();
};

(function _bootMetaAdsReturn() {
  const run = () => {
    const qs = new URLSearchParams(window.location.search);
    if (!qs.get('ma_connected') && !qs.get('ma_error') && !qs.get('ma_pick')) return;
    if (typeof navigateTo === 'function') {
      try { navigateTo('settings'); } catch (_) {}
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    setTimeout(run, 300);
  }
})();

// ── T42-A Employee Advocacy ───────────────────────────────────────────────────
window.buildEmployeeAdvocacy = async function() {
  const wrap = document.getElementById('advocacyWrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="text-align:center;padding:40px;color:#6B7280">⏳ Loading…</div>`;

  let posts = [], shareKeys = [], stats = [], activeTab = 'queue';

  async function load() {
    try {
      const [pr, kr, sr] = await Promise.all([
        fetch('/api/advocacy/posts').then(r=>r.json()),
        fetch('/api/advocacy/share-keys').then(r=>r.json()),
        fetch('/api/advocacy/stats').then(r=>r.json())
      ]);
      posts     = pr.posts  || [];
      shareKeys = kr.keys   || [];
      stats     = sr.stats  || [];
    } catch { posts=[]; shareKeys=[]; stats=[]; }
    render();
  }

  function getShareCount(postId) {
    return stats.filter(s=>String(s.post_id)===String(postId)).reduce((a,s)=>a+Number(s.shares),0);
  }
  function platformIcon(p) { return {linkedin:'💼',twitter:'🐦',facebook:'📘',instagram:'📸'}[p]||'🌐'; }

  function render() {
    const shareBase = window.location.origin + '/advocacy/share/';
    wrap.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:24px">
        ${['queue','share','analytics'].map(t=>`<button onclick="window._advTab('${t}')" style="padding:9px 20px;border-radius:8px;border:2px solid ${activeTab===t?'#3B82F6':'#E5E7EB'};background:${activeTab===t?'#EFF6FF':'#fff'};color:${activeTab===t?'#1D4ED8':'#374151'};font-weight:700;cursor:pointer;font-size:0.86rem">${t==='queue'?'📋 Content Queue':t==='share'?'🔗 Share Links':'📊 Analytics'}</button>`).join('')}
      </div>

      ${activeTab==='queue' ? `
        <div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:12px;padding:18px;margin-bottom:20px">
          <h3 style="margin:0 0 14px;font-size:0.95rem;font-weight:800;color:#1E40AF">✏️ Create Approved Post</h3>
          <input id="advTitle" placeholder="Post title (internal reference)" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #BFDBFE;border-radius:8px;font-size:0.85rem;margin-bottom:8px">
          <textarea id="advBody" placeholder="Post copy — what employees will copy and share…" rows="4" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #BFDBFE;border-radius:8px;font-size:0.85rem;resize:vertical;margin-bottom:8px"></textarea>
          <div style="display:flex;gap:14px;margin-bottom:10px;flex-wrap:wrap">
            <label style="font-size:0.8rem;font-weight:700;color:#1E40AF;display:flex;align-items:center;gap:5px"><input type="checkbox" id="advLI" checked> 💼 LinkedIn</label>
            <label style="font-size:0.8rem;font-weight:700;color:#1E40AF;display:flex;align-items:center;gap:5px"><input type="checkbox" id="advTW" checked> 🐦 Twitter/X</label>
            <label style="font-size:0.8rem;font-weight:700;color:#1E40AF;display:flex;align-items:center;gap:5px"><input type="checkbox" id="advFB"> 📘 Facebook</label>
          </div>
          <input id="advCta" placeholder="Optional CTA URL (e.g. blog post link)" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #BFDBFE;border-radius:8px;font-size:0.85rem;margin-bottom:10px">
          <button onclick="window._advCreate()" style="padding:10px 24px;background:#3B82F6;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Add to Queue</button>
        </div>
        ${!posts.length ? `<div style="text-align:center;padding:40px;color:#9CA3AF;background:#F9FAFB;border-radius:12px;border:2px dashed #E5E7EB">No posts yet — create your first approved post above</div>` :
        posts.map(p=>`
          <div style="background:#fff;border:1.5px solid #E5E7EB;border-left:4px solid ${p.status==='active'?'#3B82F6':'#9CA3AF'};border-radius:10px;padding:16px 18px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <div style="font-weight:700;font-size:0.9rem;color:#111;margin-bottom:4px">${_escapeHtml(p.title)}</div>
                <div style="font-size:0.82rem;color:#374151;line-height:1.5;margin-bottom:8px">${_escapeHtml(p.body)}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  ${(p.platforms||[]).map(pl=>`<span style="background:#EFF6FF;color:#1D4ED8;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:700">${platformIcon(pl)} ${pl}</span>`).join('')}
                  ${p.cta_url?`<span style="background:#F0FDF4;color:#166534;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:700">🔗 CTA</span>`:''}
                </div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;flex-wrap:wrap">
                <span style="background:${p.status==='active'?'#DCFCE7':'#F3F4F6'};color:${p.status==='active'?'#166534':'#6B7280'};padding:3px 10px;border-radius:10px;font-size:0.72rem;font-weight:700">${p.status}</span>
                <span style="background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:10px;font-size:0.72rem;font-weight:700">📤 ${getShareCount(p.id)} shares</span>
                <button onclick="window._advCopyPost('${encodeURIComponent(p.body)}')" style="padding:5px 10px;background:#F5F3FF;color:#7B68EE;border:1px solid #DDD6FE;border-radius:6px;font-size:0.75rem;font-weight:700;cursor:pointer">📋 Copy</button>
                <button onclick="window._advToggle('${p.id}','${p.status==='active'?'archived':'active'}')" style="padding:5px 10px;background:#F9FAFB;color:#6B7280;border:1px solid #E5E7EB;border-radius:6px;font-size:0.75rem;font-weight:700;cursor:pointer">${p.status==='active'?'Archive':'Restore'}</button>
                <button onclick="window._advDelete('${p.id}')" style="padding:5px 10px;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;border-radius:6px;font-size:0.75rem;font-weight:700;cursor:pointer">🗑</button>
              </div>
            </div>
          </div>`).join('')}

      ` : activeTab==='share' ? `
        <div style="background:#F0FDF4;border:1.5px solid #BBF7D0;border-radius:12px;padding:18px;margin-bottom:20px">
          <h3 style="margin:0 0 8px;font-size:0.95rem;font-weight:800;color:#166534">🔗 Generate Employee Share Link</h3>
          <p style="margin:0 0 12px;font-size:0.82rem;color:#15803D">Each link gives employees read-only access to your active posts. No login required — just copy and share.</p>
          <div style="display:flex;gap:8px">
            <input id="advKeyLabel" placeholder="Label (e.g. Sales Team, Marketing)" style="flex:1;padding:9px 12px;border:1.5px solid #BBF7D0;border-radius:8px;font-size:0.84rem">
            <button onclick="window._advGenKey()" style="padding:9px 20px;background:#10B981;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Generate</button>
          </div>
        </div>
        ${!shareKeys.length ? `<div style="text-align:center;padding:30px;color:#9CA3AF;background:#F9FAFB;border-radius:12px;border:2px dashed #E5E7EB">No share links yet — generate your first above</div>` :
        shareKeys.map(k=>{
          const url = shareBase + k.share_key;
          return `<div style="background:#fff;border:1.5px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
              <div style="font-weight:700;font-size:0.88rem;color:#111">${_escapeHtml(k.label)}</div>
              <div style="font-size:0.75rem;color:#6B7280;margin-top:2px;word-break:break-all">${url}</div>
            </div>
            <button onclick="navigator.clipboard.writeText('${url}');this.textContent='✅ Copied!';setTimeout(()=>this.textContent='📋 Copy Link',1500)" style="padding:7px 14px;background:#EFF6FF;color:#1D4ED8;border:1.5px solid #BFDBFE;border-radius:7px;font-size:0.8rem;font-weight:700;cursor:pointer;white-space:nowrap">📋 Copy Link</button>
            <a href="${url}" target="_blank" style="padding:7px 14px;background:#F5F3FF;color:#7B68EE;border:1.5px solid #DDD6FE;border-radius:7px;font-size:0.8rem;font-weight:700;text-decoration:none;white-space:nowrap">🔍 Preview</a>
            <button onclick="window._advDeleteKey('${k.share_key}')" style="padding:7px 12px;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;border-radius:7px;font-size:0.8rem;font-weight:700;cursor:pointer">🗑</button>
          </div>`;
        }).join('')}

      ` : `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:24px">
          <div style="background:#EFF6FF;border-radius:12px;padding:18px;text-align:center">
            <div style="font-size:2rem;font-weight:800;color:#1D4ED8">${posts.filter(p=>p.status==='active').length}</div>
            <div style="font-size:0.78rem;color:#1D4ED8;font-weight:700;margin-top:4px">Active Posts</div>
          </div>
          <div style="background:#F0FDF4;border-radius:12px;padding:18px;text-align:center">
            <div style="font-size:2rem;font-weight:800;color:#166534">${stats.reduce((a,s)=>a+Number(s.shares),0)}</div>
            <div style="font-size:0.78rem;color:#166534;font-weight:700;margin-top:4px">Total Shares</div>
          </div>
          <div style="background:#FEF3C7;border-radius:12px;padding:18px;text-align:center">
            <div style="font-size:2rem;font-weight:800;color:#92400E">${shareKeys.length}</div>
            <div style="font-size:0.78rem;color:#92400E;font-weight:700;margin-top:4px">Active Links</div>
          </div>
        </div>
        ${!stats.length ? `<div style="text-align:center;padding:30px;color:#9CA3AF">No share activity yet. Send your share links to the team to start tracking.</div>` :
        `<table style="width:100%;border-collapse:collapse;font-size:0.84rem">
          <thead><tr style="background:#F9FAFB">${['Post ID','Platform','Shares'].map(h=>`<th style="padding:10px 12px;text-align:left;font-weight:700;color:#374151;border-bottom:1px solid #E5E7EB">${h}</th>`).join('')}</tr></thead>
          <tbody>${stats.map(s=>`<tr style="border-bottom:1px solid #F3F4F6"><td style="padding:9px 12px">#${s.post_id}</td><td style="padding:9px 12px">${platformIcon(s.platform)} ${s.platform}</td><td style="padding:9px 12px;font-weight:700">${s.shares}</td></tr>`).join('')}</tbody>
        </table>`}
      `}`;

    window._advTab = t => { activeTab = t; render(); };
    window._advCopyPost = e => { navigator.clipboard.writeText(decodeURIComponent(e)); showToast('✅ Copied!'); };

    window._advCreate = async function() {
      const title = document.getElementById('advTitle')?.value.trim();
      const body  = document.getElementById('advBody')?.value.trim();
      if (!title || !body) { alert('Title and post copy are required.'); return; }
      const platforms = ['linkedin','twitter','facebook'].filter((_,i)=>document.getElementById(['advLI','advTW','advFB'][i])?.checked);
      const cta_url   = document.getElementById('advCta')?.value.trim() || null;
      const r = await fetch('/api/advocacy/posts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, body, platforms, cta_url }) }).then(x=>x.json());
      if (!r.ok) { showToast('⚠ ' + r.error); return; }
      await load(); showToast('✅ Post added to advocacy queue');
    };

    window._advToggle = async (id, status) => {
      await fetch(`/api/advocacy/posts/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
      await load();
    };
    window._advDelete = async id => {
      if (!confirm('Delete this post?')) return;
      await fetch(`/api/advocacy/posts/${id}`, { method:'DELETE' }); await load();
    };
    window._advGenKey = async function() {
      const label = document.getElementById('advKeyLabel')?.value.trim() || 'Team Share Link';
      const r = await fetch('/api/advocacy/share-keys', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ label }) }).then(x=>x.json());
      if (!r.ok) { showToast('⚠ ' + r.error); return; }
      await load(); showToast('✅ Share link generated');
    };
    window._advDeleteKey = async key => {
      if (!confirm('Delete this share link? Employees using it will lose access.')) return;
      await fetch(`/api/advocacy/share-keys/${key}`, { method:'DELETE' }); await load();
    };
  }

  await load();
};

// ── T42-B Social Listening ────────────────────────────────────────────────────
window.buildSocialListening = async function() {
  const wrap = document.getElementById('socialListeningWrap');
  if (!wrap) return;

  const savedBrand = window._slLastBrand || analysisData?.name || '';
  wrap.innerHTML = `
    <div style="background:linear-gradient(135deg,#0F172A 0%,#1E293B 100%);border-radius:14px;padding:22px 24px;margin-bottom:24px;color:#fff">
      <h3 style="margin:0 0 4px;font-size:1.05rem;font-weight:800">👂 What's being said right now</h3>
      <p style="margin:0 0 16px;font-size:0.82rem;opacity:.75">Live sentiment monitoring across Twitter, Reddit, LinkedIn, news and forums</p>
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">
        <div>
          <label style="font-size:0.75rem;font-weight:700;opacity:.75;display:block;margin-bottom:5px">YOUR BRAND</label>
          <input id="slBrand" data-ig-skip value="${_escapeHtml(savedBrand)}" placeholder="e.g. Acme Corp" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid rgba(255,255,255,.2);border-radius:8px;font-size:0.85rem;background:rgba(255,255,255,.1);color:#fff">
        </div>
        <div>
          <label style="font-size:0.75rem;font-weight:700;opacity:.75;display:block;margin-bottom:5px">KEYWORDS / COMPETITORS</label>
          <input id="slKeywords" placeholder="e.g. competitor, product name" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid rgba(255,255,255,.2);border-radius:8px;font-size:0.85rem;background:rgba(255,255,255,.1);color:#fff">
        </div>
        <button onclick="window._slFetch()" style="padding:10px 22px;background:#3B82F6;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;white-space:nowrap">🔍 Scan</button>
      </div>
    </div>
    <div id="slResults"></div>`;

  window._slFetch = async function() {
    const brand    = document.getElementById('slBrand')?.value.trim();
    const kwRaw    = document.getElementById('slKeywords')?.value.trim();
    if (!brand) { alert('Enter your brand name.'); return; }
    window._slLastBrand = brand;
    const keywords = kwRaw ? kwRaw.split(',').map(k=>k.trim()).filter(Boolean) : [];
    const res = document.getElementById('slResults');
    res.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:24px;background:#F8FAFC;border-radius:12px;color:#64748B"><span style="font-size:1.5rem">⏳</span><span>Scanning social channels… (10–20s)</span></div>`;
    try {
      const d = await fetch('/api/social-listening/feed', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, keywords }) }).then(r=>r.json());
      if (!d.ok) { res.innerHTML = `<div style="padding:18px;background:#FEE2E2;color:#B91C1C;border-radius:10px">${_escapeHtml(d.error)}</div>`; return; }

      const sentTotal = ((d.sentiment_summary?.positive||0)+(d.sentiment_summary?.neutral||0)+(d.sentiment_summary?.negative||0)) || 1;
      const sentPct   = s => Math.round(((d.sentiment_summary?.[s]||0)/sentTotal)*100);
      const sentColor = { positive:'#10B981', neutral:'#6B7280', negative:'#EF4444' };
      const srcColor  = { twitter:'#1DA1F2', reddit:'#FF4500', news:'#F59E0B', blog:'#8B5CF6', linkedin:'#0A66C2', forum:'#10B981' };
      const sentBadge = s => `<span style="background:${s==='positive'?'#D1FAE5':s==='negative'?'#FEE2E2':'#F3F4F6'};color:${s==='positive'?'#065F46':s==='negative'?'#991B1B':'#374151'};padding:2px 7px;border-radius:4px;font-size:0.68rem;font-weight:700;text-transform:uppercase">${s}</span>`;

      res.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
          <div style="background:#fff;border:1px solid #E5E7EB;border-top:3px solid #3B82F6;border-radius:10px;padding:14px">
            <div style="font-size:0.7rem;font-weight:700;color:#6B7280;text-transform:uppercase">Mentions</div>
            <div style="font-size:1.6rem;font-weight:800;color:#111;margin-top:3px">${(d.mentions||[]).length}</div>
          </div>
          <div style="background:#fff;border:1px solid #E5E7EB;border-top:3px solid #10B981;border-radius:10px;padding:14px">
            <div style="font-size:0.7rem;font-weight:700;color:#6B7280;text-transform:uppercase">Positive</div>
            <div style="font-size:1.6rem;font-weight:800;color:#10B981;margin-top:3px">${sentPct('positive')}%</div>
          </div>
          <div style="background:#fff;border:1px solid #E5E7EB;border-top:3px solid #EF4444;border-radius:10px;padding:14px">
            <div style="font-size:0.7rem;font-weight:700;color:#6B7280;text-transform:uppercase">Negative</div>
            <div style="font-size:1.6rem;font-weight:800;color:#EF4444;margin-top:3px">${sentPct('negative')}%</div>
          </div>
          <div style="background:#fff;border:1px solid #E5E7EB;border-top:3px solid #F59E0B;border-radius:10px;padding:14px">
            <div style="font-size:0.7rem;font-weight:700;color:#6B7280;text-transform:uppercase">Trending</div>
            <div style="font-size:0.78rem;font-weight:700;color:#92400E;margin-top:5px;line-height:1.5">${(d.trending_keywords||[]).slice(0,3).join(' · ')}</div>
          </div>
        </div>
        ${(d.alerts||[]).length?`<div style="margin-bottom:16px;display:flex;flex-direction:column;gap:8px">${d.alerts.map(a=>`<div style="background:${a.type==='crisis'?'#FEF2F2':'#FEF3C7'};border-left:4px solid ${a.type==='crisis'?'#EF4444':'#F59E0B'};border-radius:8px;padding:10px 14px;font-size:0.83rem;font-weight:600;color:${a.type==='crisis'?'#991B1B':'#92400E'}">⚡ ${_escapeHtml(a.message)}</div>`).join('')}</div>`:''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px">
            <div style="font-size:0.75rem;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:10px">Top Topics</div>
            ${(d.top_topics||[]).map(t=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="width:8px;height:8px;background:#3B82F6;border-radius:50%;flex-shrink:0"></span><span style="font-size:0.82rem;color:#374151">${_escapeHtml(t)}</span></div>`).join('')}
          </div>
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px">
            <div style="font-size:0.75rem;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:10px">Trending Keywords</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${(d.trending_keywords||[]).map(k=>`<span style="background:#EFF6FF;color:#1D4ED8;padding:3px 10px;border-radius:10px;font-size:0.78rem;font-weight:600">${_escapeHtml(k)}</span>`).join('')}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${(d.mentions||[]).map(m=>`
            <div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${sentColor[m.sentiment]||'#E5E7EB'};border-radius:10px;padding:14px 16px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="background:${srcColor[m.source]||'#6B7280'};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.68rem;font-weight:700;text-transform:uppercase">${m.source}</span>
                  <span style="font-size:0.78rem;font-weight:700;color:#374151">${_escapeHtml(m.author||'—')}</span>
                  <span style="font-size:0.72rem;color:#9CA3AF">${_escapeHtml(m.time_ago||'')}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  ${sentBadge(m.sentiment)}
                  ${m.reach==='high'?`<span style="background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:4px;font-size:0.68rem;font-weight:700">HIGH REACH</span>`:''}
                </div>
              </div>
              <div style="font-size:0.84rem;color:#374151;line-height:1.5">${_escapeHtml(m.content||'')}</div>
              ${m.url?`<a href="${_safeUrl(m.url)}" target="_blank" style="font-size:0.75rem;color:#3B82F6;text-decoration:none;margin-top:4px;display:inline-block">View post ↗</a>`:''}
            </div>`).join('')}
        </div>`;
    } catch(e) {
      res.innerHTML = `<div style="padding:18px;background:#FEE2E2;color:#B91C1C;border-radius:10px">Error: ${_escapeHtml(e.message)}</div>`;
    }
  };

  if (savedBrand) setTimeout(() => { try { window._slFetch(); } catch(_) {} }, 300);
};

// ── T42-C Media Intelligence ──────────────────────────────────────────────────
window.buildMediaIntel = async function() {
  const wrap = document.getElementById('mediaIntelWrap');
  if (!wrap) return;

  const savedBrand = window._miLastBrand || analysisData?.name || '';
  let history = [];
  try { const hr = await fetch('/api/media-intel/history').then(r=>r.json()); history = hr.history||[]; } catch(_) {}

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:320px 1fr;gap:20px;max-width:1100px">
      <div>
        <div style="background:linear-gradient(135deg,#1E1B4B 0%,#312E81 100%);border-radius:14px;padding:22px;color:#fff;margin-bottom:16px">
          <h3 style="margin:0 0 4px;font-size:1.05rem;font-weight:800">📰 Media Intel Scan</h3>
          <p style="margin:0 0 14px;font-size:0.8rem;opacity:.75">Journalists, rising stories &amp; PR opportunities</p>
          <label style="font-size:0.72rem;font-weight:700;opacity:.75;display:block;margin-bottom:4px">YOUR BRAND</label>
          <input id="miBrand" data-ig-skip value="${_escapeHtml(savedBrand)}" placeholder="e.g. Acme Corp" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid rgba(255,255,255,.2);border-radius:8px;font-size:0.84rem;background:rgba(255,255,255,.1);color:#fff;margin-bottom:8px">
          <label style="font-size:0.72rem;font-weight:700;opacity:.75;display:block;margin-bottom:4px">COMPETITORS (comma-separated)</label>
          <input id="miComps" placeholder="Competitor A, Competitor B" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid rgba(255,255,255,.2);border-radius:8px;font-size:0.84rem;background:rgba(255,255,255,.1);color:#fff;margin-bottom:8px">
          <label style="font-size:0.72rem;font-weight:700;opacity:.75;display:block;margin-bottom:4px">INDUSTRY</label>
          <input id="miIndustry" placeholder="e.g. SaaS, Fintech, eCommerce" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid rgba(255,255,255,.2);border-radius:8px;font-size:0.84rem;background:rgba(255,255,255,.1);color:#fff;margin-bottom:14px">
          <button onclick="window._miFetch()" style="width:100%;padding:11px;background:#6D28D9;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">🔎 Run Media Scan</button>
        </div>
        <div style="background:#fff;border:1.5px solid #E5E7EB;border-radius:12px;padding:16px">
          <div style="font-size:0.8rem;font-weight:700;color:#374151;margin-bottom:10px">📋 Recent Scans</div>
          ${!history.length?`<div style="font-size:0.8rem;color:#9CA3AF">No scans yet</div>`:
          history.slice(0,6).map(h=>`<div onclick="window._miLoadScan('${h.id}')" style="padding:9px;border-radius:8px;cursor:pointer;border-bottom:1px solid #F3F4F6" onmouseenter="this.style.background='#F9FAFB'" onmouseleave="this.style.background='transparent'">
            <div style="font-size:0.82rem;font-weight:700;color:#111">${_escapeHtml(h.brand)}</div>
            <div style="font-size:0.73rem;color:#9CA3AF">${new Date(h.created_at).toLocaleDateString()} · ${_escapeHtml(h.summary||'')}</div>
          </div>`).join('')}
        </div>
      </div>
      <div id="miResults">
        <div style="text-align:center;padding:60px 20px;color:#9CA3AF;background:#F9FAFB;border-radius:14px;border:2px dashed #E5E7EB">
          <div style="font-size:2.5rem;margin-bottom:12px">📰</div>
          <div style="font-weight:700;color:#374151;margin-bottom:6px">Run a media scan</div>
          <div style="font-size:0.82rem">Enter your brand name and hit scan to see press coverage,<br>journalist targets, and PR opportunities in real time</div>
        </div>
      </div>
    </div>`;

  function renderResults(d) {
    const res = document.getElementById('miResults');
    if (!res) return;
    const catColor  = { product_launch:'#3B82F6',funding:'#10B981',controversy:'#EF4444',partnership:'#F59E0B',hiring:'#8B5CF6',award:'#F59E0B',regulation:'#6B7280',market_trend:'#0EA5E9' };
    const urgColor  = { now:'#EF4444', this_week:'#F59E0B', this_month:'#6B7280' };
    const momBar    = m => `<div style="height:4px;background:#E5E7EB;border-radius:2px;margin-top:6px"><div style="height:4px;background:${m>70?'#EF4444':m>40?'#F59E0B':'#10B981'};width:${m}%;border-radius:2px;transition:width .4s"></div></div>`;

    res.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px">
      ${(d.rising_narratives||[]).length?`<div style="background:#FEF3C7;border:1.5px solid #FDE68A;border-radius:10px;padding:14px">
        <div style="font-size:0.75rem;font-weight:700;color:#92400E;text-transform:uppercase;margin-bottom:8px">🔥 Rising Narratives</div>
        ${d.rising_narratives.map(n=>`<div style="margin-bottom:10px"><div style="font-size:0.85rem;font-weight:700;color:#78350F">${_escapeHtml(n.narrative)}</div><div style="font-size:0.78rem;color:#92400E;margin-top:2px">→ ${_escapeHtml(n.opportunity)}</div>${momBar(n.momentum||50)}</div>`).join('')}
      </div>`:''}

      <div style="background:#fff;border:1.5px solid #E5E7EB;border-radius:10px;padding:14px">
        <div style="font-size:0.75rem;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:10px">📰 Recent Coverage (${(d.stories||[]).length} stories)</div>
        ${(d.stories||[]).map(s=>`<div style="padding:10px 0;border-bottom:1px solid #F3F4F6">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <div style="flex:1;min-width:0">
              <span style="background:${catColor[s.category]||'#6B7280'};color:#fff;padding:1px 7px;border-radius:3px;font-size:0.64rem;font-weight:700;text-transform:uppercase;margin-right:6px">${(s.category||'').replace(/_/g,' ')}</span>
              <span style="font-size:0.83rem;font-weight:700;color:#111">${_escapeHtml(s.headline||'')}</span>
            </div>
            <div style="font-size:0.7rem;color:#9CA3AF;white-space:nowrap;flex-shrink:0">${_escapeHtml(s.published||'')}</div>
          </div>
          <div style="font-size:0.78rem;color:#6B7280;margin-bottom:4px"><strong>${_escapeHtml(s.publication||'')}</strong>${s.journalist?` · ${_escapeHtml(s.journalist)}`:''}</div>
          <div style="font-size:0.8rem;color:#374151;line-height:1.5">${_escapeHtml(s.summary||'')}</div>
          ${momBar(s.momentum||30)}
        </div>`).join('')}
      </div>

      ${(d.journalist_watchlist||[]).length?`<div style="background:#F5F3FF;border:1.5px solid #DDD6FE;border-radius:10px;padding:14px">
        <div style="font-size:0.75rem;font-weight:700;color:#6D28D9;text-transform:uppercase;margin-bottom:10px">📋 Journalist Watchlist</div>
        ${d.journalist_watchlist.map(j=>`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #EDE9FE;flex-wrap:wrap">
          <div style="flex:1;min-width:180px">
            <div style="font-size:0.85rem;font-weight:700;color:#4C1D95">${_escapeHtml(j.name)} <span style="font-weight:400;color:#7C3AED">@ ${_escapeHtml(j.publication)}</span></div>
            <div style="font-size:0.77rem;color:#6D28D9;margin-top:2px">Beat: ${_escapeHtml(j.beat||'')}${j.recent_angle?` · ${_escapeHtml(j.recent_angle)}`:''}</div>
          </div>
          ${j.twitter?`<button onclick="navigator.clipboard.writeText(${JSON.stringify(j.twitter)});this.textContent='✅ Copied!';setTimeout(()=>this.textContent=${JSON.stringify('📋 '+j.twitter)},1500)" style="padding:5px 10px;background:#EDE9FE;color:#6D28D9;border:1px solid #DDD6FE;border-radius:6px;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap">📋 ${_escapeHtml(j.twitter)}</button>`:''}
        </div>`).join('')}
      </div>`:''}

      ${(d.media_opportunities||[]).length?`<div style="background:#F0FDF4;border:1.5px solid #BBF7D0;border-radius:10px;padding:14px">
        <div style="font-size:0.75rem;font-weight:700;color:#166534;text-transform:uppercase;margin-bottom:10px">🎯 Media Opportunities</div>
        ${d.media_opportunities.map(o=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #DCFCE7;flex-wrap:wrap">
          <div style="flex:1;min-width:180px">
            <span style="background:#DCFCE7;color:#166534;padding:1px 7px;border-radius:3px;font-size:0.64rem;font-weight:700;text-transform:uppercase;margin-right:6px">${_escapeHtml(o.type||'')}</span>
            <span style="font-size:0.83rem;font-weight:700;color:#111">${_escapeHtml(o.headline||'')}</span>
            <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">${_escapeHtml(o.outlet||'')}</div>
          </div>
          <span style="background:${urgColor[o.urgency]||'#6B7280'};color:#fff;padding:3px 10px;border-radius:6px;font-size:0.72rem;font-weight:700;white-space:nowrap;flex-shrink:0">${(o.urgency||'').replace(/_/g,' ')}</span>
        </div>`).join('')}
      </div>`:''}
    </div>`;
  }

  window._miFetch = async function() {
    const brand    = document.getElementById('miBrand')?.value.trim();
    const compsRaw = document.getElementById('miComps')?.value.trim();
    const industry = document.getElementById('miIndustry')?.value.trim();
    if (!brand) { alert('Enter your brand name.'); return; }
    window._miLastBrand = brand;
    const competitors = compsRaw ? compsRaw.split(',').map(c=>c.trim()).filter(Boolean) : [];
    const res = document.getElementById('miResults');
    res.innerHTML = `<div style="text-align:center;padding:40px;background:#F8FAFC;border-radius:12px;color:#64748B"><div style="font-size:1.8rem;margin-bottom:10px">⏳</div><div style="font-size:0.85rem">Scanning news, publications and press mentions…<br><span style="opacity:.7">Powered by Perplexity Sonar · 15–25s</span></div></div>`;
    try {
      const d = await fetch('/api/media-intel/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, competitors, industry }) }).then(r=>r.json());
      if (!d.ok) { res.innerHTML = `<div style="padding:18px;background:#FEE2E2;color:#B91C1C;border-radius:10px">${_escapeHtml(d.error)}</div>`; return; }
      renderResults(d);
    } catch(e) {
      res.innerHTML = `<div style="padding:18px;background:#FEE2E2;color:#B91C1C;border-radius:10px">Error: ${_escapeHtml(e.message)}</div>`;
    }
  };

  window._miLoadScan = async function(id) {
    const res = document.getElementById('miResults');
    res.innerHTML = `<div style="text-align:center;padding:24px;color:#6B7280">⏳ Loading scan…</div>`;
    try {
      const d = await fetch(`/api/media-intel/scan/${id}`).then(r=>r.json());
      if (!d.ok) { res.innerHTML = `<div style="padding:18px;background:#FEE2E2;color:#B91C1C;border-radius:10px">${_escapeHtml(d.error)}</div>`; return; }
      renderResults(d);
    } catch(e) {
      res.innerHTML = `<div style="padding:18px;background:#FEE2E2;color:#B91C1C;border-radius:10px">Error: ${_escapeHtml(e.message)}</div>`;
    }
  };

  if (savedBrand) setTimeout(() => { try { window._miFetch(); } catch(_) {} }, 300);
};

// ============================================================================
// ============================================================================
// T40 — Hashtag Intelligence (Instagram & TikTok)
// ============================================================================
window.buildHashtagIntel = async function() {
  const wrap = document.getElementById('hiWrap'); if (!wrap) return;

  const VOL_COLOR = { very_high:'#DC2626', high:'#F97316', medium:'#0EA5E9', low:'#8B5CF6' };
  const CMP_COLOR = { very_high:'#991B1B', high:'#B45309', medium:'#0369A1', low:'#047857' };
  const TRD_ICON  = { viral:'🔥', growing:'📈', stable:'➡️', declining:'📉' };
  const PLAT_GRAD = { instagram:'linear-gradient(135deg,#E1306C,#F77737,#FCAF45)', tiktok:'linear-gradient(135deg,#010101,#25F4EE,#FE2C55)' };

  let _hiRuns = [];
  let _hiSort = { col: null, dir: 1 };
  let _hiCurrent = null; // { seedKeyword, platform, hashtags, clusters }

  try { const rr = await fetch('/api/hashtag-intel/runs').then(x=>x.json()); _hiRuns = rr.runs||[]; } catch(_) {}

  // ── safe clipboard helper (no inline onclick with dynamic data) ──────────
  function _hiCopy(text, label) {
    navigator.clipboard.writeText(text).then(() => { if (typeof showToast === 'function') showToast('📋 ' + (label || 'Copied!')); });
  }

  // ── run history ──────────────────────────────────────────────────────────
  function renderRuns() {
    const hist = document.getElementById('hiHistory');
    if (!hist) return;
    if (!_hiRuns.length) { hist.innerHTML = '<div style="color:#9CA3AF;font-size:0.8rem">No runs yet.</div>'; return; }
    hist.innerHTML = _hiRuns.slice(0,20).map(r => {
      const platIcon = r.platform==='tiktok'?'🎵':'📷';
      const clusters = Array.isArray(r.clusters) ? r.clusters : [];
      return `<div data-runrow="${r.id}" style="display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:10px 14px;margin-bottom:6px;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:180px">
          <span style="font-size:0.72rem;font-weight:700;color:#6B7280;margin-right:8px">${platIcon} ${_escapeHtml(r.platform.toUpperCase())}</span>
          <strong style="color:#0A1628">${_escapeHtml(r.seed_keyword)}</strong>
          <span style="color:#9CA3AF;font-size:0.74rem;margin-left:8px">${r.total_count||0} tags · ${clusters.length} clusters</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:#9CA3AF;font-size:0.72rem">${new Date(r.created_at).toLocaleDateString()}</span>
          <button data-load="${r.id}" style="padding:4px 12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:5px;font-size:0.74rem;font-weight:700;color:#1D4ED8;cursor:pointer">Load</button>
          <button data-del="${r.id}" style="padding:4px 10px;background:#FEE2E2;border:1px solid #FECACA;border-radius:5px;font-size:0.74rem;font-weight:700;color:#B91C1C;cursor:pointer">✕</button>
        </div>
      </div>`;
    }).join('');
    hist.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => _hiLoadRun(b.dataset.load)));
    hist.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this run?')) return;
      try {
        await fetch('/api/hashtag-intel/runs/'+b.dataset.del, { method:'DELETE' });
        _hiRuns = _hiRuns.filter(r => String(r.id) !== b.dataset.del);
        renderRuns();
      } catch(_) {}
    }));
  }

  async function _hiLoadRun(id) {
    const out = document.getElementById('hiOut');
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Loading…</div>';
    try {
      const r = await fetch('/api/hashtag-intel/runs/'+id).then(x=>x.json());
      if (!r.ok) { out.innerHTML = `<div style="color:#B91C1C">${_escapeHtml(r.error)}</div>`; return; }
      _hiRenderResult(r.run.seed_keyword, r.run.platform, r.run.hashtags, r.run.clusters);
    } catch(e) { out.innerHTML = `<div style="color:#B91C1C">Error: ${_escapeHtml(e.message)}</div>`; }
  }

  // ── sortable table ────────────────────────────────────────────────────────
  const VOL_RANK = { very_high:4, high:3, medium:2, low:1 };
  const CMP_RANK = { very_high:4, high:3, medium:2, low:1 };
  const TRD_RANK = { viral:4, growing:3, stable:2, declining:1 };

  function _sortVal(h, col) {
    if (col === 'tag')         return (h.tag||'').toLowerCase();
    if (col === 'volume')      return VOL_RANK[(h.volume||'').toLowerCase()] || 0;
    if (col === 'competition') return CMP_RANK[(h.competition||'').toLowerCase()] || 0;
    if (col === 'trend')       return TRD_RANK[(h.trend||'').toLowerCase()] || 0;
    return 0;
  }

  function _hiSortTable(col) {
    if (_hiSort.col === col) { _hiSort.dir *= -1; } else { _hiSort.col = col; _hiSort.dir = -1; }
    if (!_hiCurrent) return;
    const sorted = [..._hiCurrent.hashtags].sort((a,b) => {
      const av = _sortVal(a, col), bv = _sortVal(b, col);
      return av < bv ? _hiSort.dir : av > bv ? -_hiSort.dir : 0;
    });
    _hiRebuildTable(sorted);
    // update sort indicator
    document.querySelectorAll('[data-sortcol]').forEach(th => {
      const ind = th.querySelector('.sort-ind');
      if (ind) ind.textContent = th.dataset.sortcol === col ? (_hiSort.dir === -1 ? ' ▼' : ' ▲') : ' ⇅';
    });
  }
  window._hiSortTable = _hiSortTable;

  function _hiRebuildTable(hashtags) {
    const tbody = document.getElementById('hiTableBody'); if (!tbody) return;
    tbody.innerHTML = (hashtags||[]).map((h,i) => {
      const tag = h.tag || '';
      const vol = (h.volume||'medium').toLowerCase();
      const cmp = (h.competition||'medium').toLowerCase();
      const trd = (h.trend||'stable').toLowerCase();
      const why = h.whyItWorks || '';
      const vc  = VOL_COLOR[vol]  || '#9CA3AF';
      const cc  = CMP_COLOR[cmp] || '#9CA3AF';
      const ti  = TRD_ICON[trd]  || '➡️';
      return `<tr data-idx="${i}" style="border-bottom:1px solid #F3F4F6">
        <td data-copy="${_escapeHtml(tag)}" style="padding:7px 10px;font-weight:700;color:#1D4ED8;font-size:0.82rem;cursor:pointer;white-space:nowrap">${_escapeHtml(tag)}</td>
        <td style="padding:7px 10px"><span style="background:${vc}22;color:${vc};padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;text-transform:uppercase">${_escapeHtml(vol)}</span></td>
        <td style="padding:7px 10px"><span style="background:${cc}22;color:${cc};padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;text-transform:uppercase">${_escapeHtml(cmp)}</span></td>
        <td style="padding:7px 10px;text-align:center">${ti}</td>
        <td style="padding:7px 10px;color:#6B7280;font-size:0.75rem;max-width:240px">${_escapeHtml(why.slice(0,120))}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" style="padding:14px;color:#9CA3AF">No hashtags.</td></tr>';

    // safe click-to-copy on tag cells
    tbody.querySelectorAll('[data-copy]').forEach(td => {
      td.addEventListener('click', () => {
        _hiCopy(td.dataset.copy, 'Tag copied!');
        td.style.color='#059669'; setTimeout(() => { td.style.color='#1D4ED8'; }, 1200);
      });
    });
  }

  // ── render full result ────────────────────────────────────────────────────
  function _hiRenderResult(seedKeyword, platform, hashtags, clusters) {
    const out = document.getElementById('hiOut'); if (!out) return;
    _hiCurrent = { seedKeyword, platform, hashtags: Array.isArray(hashtags)?hashtags:[], clusters: Array.isArray(clusters)?clusters:[] };
    const platGrad  = PLAT_GRAD[platform] || PLAT_GRAD.instagram;
    const platLabel = platform === 'tiktok' ? 'TikTok' : 'Instagram';
    const platIcon  = platform === 'tiktok' ? '🎵' : '📷';
    const allTags   = _hiCurrent.hashtags.map(h=>h.tag||'').filter(Boolean);

    const clustersHtml = _hiCurrent.clusters.map((cl, i) => {
      const tags = (cl.hashtags||[]).map(t => `<span data-tag="${_escapeHtml(t)}" style="display:inline-block;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;padding:3px 10px;border-radius:14px;font-size:0.74rem;font-weight:700;margin:3px;cursor:pointer" title="Click to copy">${_escapeHtml(t)}</span>`).join('');
      return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid #6366F1;border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;gap:10px;flex-wrap:wrap">
          <div>
            <strong style="color:#0A1628;font-size:0.96rem">${i+1}. ${_escapeHtml(cl.name||'Cluster')}</strong>
            <span style="background:#6366F1;color:#fff;padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:700;margin-left:8px">${_escapeHtml(cl.type||'')}</span>
          </div>
        </div>
        <div style="margin-bottom:8px" data-cluster="${i}">${tags}</div>
        ${cl.strategy ? `<div style="background:#FEF3C7;border-left:3px solid #F59E0B;padding:7px 12px;border-radius:4px;font-size:0.8rem;color:#78350F"><strong>💡 Strategy:</strong> ${_escapeHtml(cl.strategy)}</div>` : ''}
        <div style="margin-top:8px">
          <button data-copyset="${i}" style="padding:4px 12px;background:#F3F4F6;border:1px solid #D1D5DB;border-radius:5px;font-size:0.72rem;font-weight:700;color:#374151;cursor:pointer">📋 Copy ${(cl.hashtags||[]).length} tags</button>
        </div>
      </div>`;
    }).join('');

    out.innerHTML = `
      <div id="hiHeader" style="background:${platGrad};color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:0.74rem;font-weight:700;opacity:.85;text-transform:uppercase;margin-bottom:4px">${platIcon} ${platLabel} · Hashtag Research</div>
            <div style="font-size:1.4rem;font-weight:800">${_escapeHtml(seedKeyword)}</div>
          </div>
          <div style="display:flex;gap:14px;text-align:center">
            <div><div style="font-size:1.6rem;font-weight:800">${allTags.length}</div><div style="font-size:0.7rem;opacity:.85;font-weight:700">HASHTAGS</div></div>
            <div><div style="font-size:1.6rem;font-weight:800">${_hiCurrent.clusters.length}</div><div style="font-size:0.7rem;opacity:.85;font-weight:700">CLUSTERS</div></div>
          </div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="hiCopyAll" style="padding:6px 14px;background:rgba(255,255,255,0.2);border:1.5px solid rgba(255,255,255,0.5);border-radius:6px;color:#fff;font-weight:700;font-size:0.8rem;cursor:pointer">📋 Copy all ${allTags.length} tags</button>
          <button id="hiCopyCaption" style="padding:6px 14px;background:rgba(255,255,255,0.2);border:1.5px solid rgba(255,255,255,0.5);border-radius:6px;color:#fff;font-weight:700;font-size:0.8rem;cursor:pointer">✍️ Caption-ready (top 30)</button>
        </div>
      </div>

      <h3 style="color:#0A1628;font-size:1rem;margin:0 0 12px;font-weight:800">🎯 Strategic Clusters</h3>
      <div id="hiClusters">${clustersHtml || '<div style="color:#9CA3AF">No clusters generated.</div>'}</div>

      <h3 style="color:#0A1628;font-size:1rem;margin:20px 0 10px;font-weight:800">📋 All Hashtags (${allTags.length}) <span style="font-size:0.72rem;font-weight:400;color:#9CA3AF">— click column headers to sort · click tag to copy</span></h3>
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;overflow:auto;margin-bottom:14px">
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
          <thead><tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB">
            <th data-sortcol="tag"         style="padding:8px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.72rem;text-transform:uppercase;cursor:pointer;user-select:none">Hashtag<span class="sort-ind"> ⇅</span></th>
            <th data-sortcol="volume"      style="padding:8px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.72rem;text-transform:uppercase;cursor:pointer;user-select:none">Volume<span class="sort-ind"> ⇅</span></th>
            <th data-sortcol="competition" style="padding:8px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.72rem;text-transform:uppercase;cursor:pointer;user-select:none">Competition<span class="sort-ind"> ⇅</span></th>
            <th data-sortcol="trend"       style="padding:8px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.72rem;text-transform:uppercase;cursor:pointer;user-select:none">Trend<span class="sort-ind"> ⇅</span></th>
            <th style="padding:8px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.72rem;text-transform:uppercase">Why It Works</th>
          </tr></thead>
          <tbody id="hiTableBody"></tbody>
        </table>
      </div>`;

    // safe event binding — sort headers
    out.querySelectorAll('[data-sortcol]').forEach(th => {
      th.addEventListener('click', () => _hiSortTable(th.dataset.sortcol));
    });

    // safe event binding — cluster tag chips
    out.querySelectorAll('[data-tag]').forEach(span => {
      span.addEventListener('click', () => {
        _hiCopy(span.dataset.tag, 'Tag copied!');
        span.style.background='#D1FAE5'; setTimeout(() => { span.style.background='#EFF6FF'; }, 1200);
      });
    });

    // safe event binding — cluster copy buttons
    out.querySelectorAll('[data-copyset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cl = _hiCurrent.clusters[parseInt(btn.dataset.copyset, 10)];
        if (cl) _hiCopy((cl.hashtags||[]).join(' '), (cl.hashtags||[]).length + ' tags copied!');
      });
    });

    // safe event binding — copy-all + caption
    document.getElementById('hiCopyAll').addEventListener('click', () => _hiCopy(allTags.join(' '), allTags.length + ' hashtags copied!'));
    document.getElementById('hiCopyCaption').addEventListener('click', () => _hiCopy(allTags.slice(0,30).join(' '), 'Caption hashtag block copied!'));

    // initial table render
    _hiRebuildTable(_hiCurrent.hashtags);
  }

  // ── shell ─────────────────────────────────────────────────────────────────
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:6px">PLATFORM</label>
        <div style="display:flex;gap:8px" id="hiPlatformPills">
          <button data-plat="instagram" class="hi-pill hi-pill-active" style="padding:7px 18px;border-radius:20px;border:2px solid #E1306C;background:linear-gradient(135deg,#E1306C,#F77737);color:#fff;font-weight:700;font-size:0.82rem;cursor:pointer">📷 Instagram</button>
          <button data-plat="tiktok"    class="hi-pill"               style="padding:7px 18px;border-radius:20px;border:2px solid #D1D5DB;background:#F9FAFB;color:#374151;font-weight:700;font-size:0.82rem;cursor:pointer">🎵 TikTok</button>
        </div>
      </div>
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <label style="font-size:0.7rem;font-weight:700;color:#6B7280">TOPIC / SEED KEYWORD *</label>
          <button id="hiAISuggest" style="padding:3px 10px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);border:none;border-radius:5px;color:#fff;font-size:0.65rem;font-weight:700;cursor:pointer">🧠 AI Suggest</button>
        </div>
        <input id="hiKeyword" placeholder="e.g. skincare routine, personal finance, fitness motivation" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
        <div id="hiSuggestPills" style="display:none;margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"></div>
      </div>
      <button id="hiGo" style="width:100%;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">🏷️ Research Hashtags</button>
      <div style="font-size:0.74rem;color:#6B7280;margin-top:8px">Powered by Perplexity Sonar · AI-researched from real platform data · 20-40s per run</div>
    </div>
    <div id="hiOut"></div>
    <h3 style="margin:24px 0 8px;color:#0A1628;font-size:0.96rem;font-weight:800">📚 Recent Runs</h3>
    <div id="hiHistory"></div>
  `;

  renderRuns();

  // platform pill selection
  let _selectedPlatform = 'instagram';
  document.getElementById('hiPlatformPills').addEventListener('click', e => {
    const btn = e.target.closest('[data-plat]'); if (!btn) return;
    _selectedPlatform = btn.dataset.plat;
    document.querySelectorAll('.hi-pill').forEach(p => {
      const isInsta = p.dataset.plat === 'instagram';
      const isTT    = p.dataset.plat === 'tiktok';
      if (p.dataset.plat === _selectedPlatform) {
        p.style.background = isInsta ? 'linear-gradient(135deg,#E1306C,#F77737)' : 'linear-gradient(135deg,#010101,#25F4EE,#FE2C55)';
        p.style.color = '#fff';
        p.style.borderColor = isInsta ? '#E1306C' : '#25F4EE';
      } else {
        p.style.background = '#F9FAFB';
        p.style.color = '#374151';
        p.style.borderColor = '#D1D5DB';
      }
    });
  });

  // enter key on keyword input
  document.getElementById('hiKeyword').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('hiGo').click();
  });

  // AI Suggest — proposes seed keyword ideas via /api/studio/ai-suggest
  document.getElementById('hiAISuggest').addEventListener('click', async () => {
    const btn = document.getElementById('hiAISuggest');
    const pills = document.getElementById('hiSuggestPills');
    btn.textContent = '⏳ Thinking…'; btn.disabled = true;
    try {
      const platLabel = _selectedPlatform === 'tiktok' ? 'TikTok' : 'Instagram';
      const r = await fetch('/api/studio/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldLabel: `${platLabel} hashtag research seed keyword`,
          fieldPlaceholder: 'e.g. skincare routine, personal finance, fitness motivation',
          context: `Social media hashtag intelligence tool for ${platLabel}. Suggest 5 specific, high-potential seed keyword topics the user might want to research hashtags for. Return a JSON array of 5 short topic strings (2-4 words each). Example: ["skincare routine", "morning workout", "meal prep ideas", "passive income", "travel hacks"]`,
          format: 'json_array'
        })
      }).then(x => x.json());
      let suggestions = [];
      if (r.ok && r.result) {
        try { suggestions = JSON.parse(r.result); } catch(_) {
          // try extracting from string
          const m = String(r.result).match(/\[[\s\S]*\]/);
          if (m) { try { suggestions = JSON.parse(m[0]); } catch(_) {} }
        }
      }
      if (!Array.isArray(suggestions) || !suggestions.length) {
        suggestions = ['skincare routine', 'morning workout', 'meal prep ideas', 'passive income', 'travel hacks'];
      }
      pills.style.display = 'flex';
      pills.innerHTML = suggestions.slice(0,6).map(s => `<button data-sug="${_escapeHtml(String(s).slice(0,80))}" style="padding:4px 12px;background:#EDE9FE;color:#7C3AED;border:1px solid #DDD6FE;border-radius:12px;font-size:0.74rem;font-weight:700;cursor:pointer">${_escapeHtml(String(s).slice(0,80))}</button>`).join('');
      pills.querySelectorAll('[data-sug]').forEach(p => {
        p.addEventListener('click', () => {
          document.getElementById('hiKeyword').value = p.dataset.sug;
          pills.style.display = 'none';
        });
      });
    } catch(_) {}
    btn.textContent = '🧠 AI Suggest'; btn.disabled = false;
  });

  // research button
  document.getElementById('hiGo').addEventListener('click', async () => {
    const seedKeyword = document.getElementById('hiKeyword').value.trim();
    const out = document.getElementById('hiOut');
    if (!seedKeyword) {
      out.innerHTML = '<div style="color:#991B1B;background:#FEE2E2;padding:10px 14px;border-radius:8px">⚠ Topic / keyword is required</div>';
      return;
    }
    const platLabel = _selectedPlatform === 'tiktok' ? 'TikTok' : 'Instagram';
    out.innerHTML = `<div style="text-align:center;padding:40px;background:#F8FAFC;border-radius:12px;color:#64748B"><div style="font-size:1.8rem;margin-bottom:10px">⏳</div><div style="font-size:0.85rem">Researching ${platLabel} hashtags for "<strong>${_escapeHtml(seedKeyword)}</strong>"…<br><span style="opacity:.7">Powered by Perplexity Sonar · 20-40s</span></div></div>`;
    try {
      const r = await fetch('/api/hashtag-intel/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedKeyword, platform: _selectedPlatform })
      }).then(x => x.json());
      if (!r.ok) {
        out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">⚠ ${_escapeHtml(r.error)}</div>`;
        return;
      }
      _hiRenderResult(r.seedKeyword, r.platform, r.hashtags, r.clusters);
      const rr = await fetch('/api/hashtag-intel/runs').then(x => x.json());
      _hiRuns = rr.runs || [];
      renderRuns();
    } catch(e) {
      out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`;
    }
  });
};

// ============================================================================
// T41 — Google Maps Competitor Intelligence
// ============================================================================
window.buildMapsIntel = async function() {
  const wrap = document.getElementById('miWrap'); if (!wrap) return;

  const RATING_COLOR = r => r >= 4.5 ? '#059669' : r >= 4.0 ? '#D97706' : '#DC2626';
  const PRICE_BG     = { '$':'#EDE9FE', '$$':'#DBEAFE', '$$$':'#FEF3C7', '$$$$':'#FEE2E2' };
  const PRICE_COL    = { '$':'#7C3AED', '$$':'#1D4ED8', '$$$':'#92400E', '$$$$':'#991B1B' };

  let _miRuns    = [];
  let _miCurrent = null; // { keyword, region, businesses, market_summary }
  let _miFilter  = { minRating: 0, minReviews: 0, sortCol: 'rating', sortDir: -1 };

  try { const rr = await fetch('/api/maps-intel/runs').then(x=>x.json()); _miRuns = rr.runs||[]; } catch(_) {}

  // ── run history ──────────────────────────────────────────────────────────
  function renderRuns() {
    const hist = document.getElementById('miHistory');
    if (!hist) return;
    if (!_miRuns.length) { hist.innerHTML = '<div style="color:#9CA3AF;font-size:0.8rem">No scans yet.</div>'; return; }
    hist.innerHTML = _miRuns.slice(0,20).map(r => {
      const ms = r.market_summary || {};
      return `<div style="display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:10px 14px;margin-bottom:6px;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <strong style="color:#0A1628">${_escapeHtml(r.keyword)}</strong>
          <span style="color:#6B7280;font-size:0.74rem;margin-left:8px">in ${_escapeHtml(r.region)}</span>
          <span style="color:#9CA3AF;font-size:0.72rem;margin-left:8px">${r.total_count||0} businesses · avg ⭐${ms.avg_rating_benchmark||'N/A'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:#9CA3AF;font-size:0.72rem">${new Date(r.created_at).toLocaleDateString()}</span>
          <button data-load="${r.id}" style="padding:4px 12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:5px;font-size:0.74rem;font-weight:700;color:#1D4ED8;cursor:pointer">Load</button>
          <button data-del="${r.id}"  style="padding:4px 10px;background:#FEE2E2;border:1px solid #FECACA;border-radius:5px;font-size:0.74rem;font-weight:700;color:#B91C1C;cursor:pointer">✕</button>
        </div>
      </div>`;
    }).join('');
    hist.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => _miLoadRun(b.dataset.load)));
    hist.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this scan?')) return;
      try {
        await fetch('/api/maps-intel/runs/'+b.dataset.del, { method:'DELETE' });
        _miRuns = _miRuns.filter(r => String(r.id) !== b.dataset.del);
        renderRuns();
      } catch(_) {}
    }));
  }

  async function _miLoadRun(id) {
    const out = document.getElementById('miOut');
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Loading…</div>';
    try {
      const r = await fetch('/api/maps-intel/runs/'+id).then(x=>x.json());
      if (!r.ok) { out.innerHTML = `<div style="color:#B91C1C">${_escapeHtml(r.error)}</div>`; return; }
      _miRenderResult(r.run.keyword, r.run.region, r.run.businesses, r.run.market_summary);
    } catch(e) { out.innerHTML = `<div style="color:#B91C1C">Error: ${_escapeHtml(e.message)}</div>`; }
  }

  // ── stars renderer ───────────────────────────────────────────────────────
  function _miStars(rating) {
    if (!rating) return '<span style="color:#9CA3AF">N/A</span>';
    const full = Math.floor(rating);
    const half = (rating - full) >= 0.5 ? 1 : 0;
    const emp  = 5 - full - half;
    return '<span style="color:#F59E0B;font-size:0.9rem">' + '★'.repeat(full) + (half?'½':'') + '<span style="opacity:.35">' + '☆'.repeat(emp) + '</span></span> <span style="color:#374151;font-size:0.78rem;font-weight:700">' + rating.toFixed(1) + '</span>';
  }

  // ── table rebuild (re-filters + re-sorts) ────────────────────────────────
  function _miRebuildTable(businesses) {
    const tbody = document.getElementById('miTableBody'); if (!tbody) return;
    let rows = (businesses||[]).filter(b =>
      (b.rating == null || b.rating >= _miFilter.minRating) &&
      (b.review_count == null || b.review_count >= _miFilter.minReviews)
    );
    rows = rows.sort((a,b) => {
      const col = _miFilter.sortCol;
      const av = col === 'rating' ? (a.rating||0) : col === 'review_count' ? (a.review_count||0) : String(a.name||'').toLowerCase();
      const bv = col === 'rating' ? (b.rating||0) : col === 'review_count' ? (b.review_count||0) : String(b.name||'').toLowerCase();
      return av < bv ? _miFilter.sortDir : av > bv ? -_miFilter.sortDir : 0;
    });

    tbody.innerHTML = rows.map((b, i) => {
      const rc  = b.rating ? RATING_COLOR(b.rating) : '#9CA3AF';
      const pbg = PRICE_BG[b.price_range]  || '#F3F4F6';
      const pc  = PRICE_COL[b.price_range] || '#6B7280';
      const websiteHtml = b.website
        ? `<a href="${_safeUrl(b.website)}" target="_blank" rel="noopener noreferrer" style="color:#1D4ED8;font-size:0.74rem;text-decoration:none;font-weight:700">🔗 Visit</a>`
        : '<span style="color:#D1D5DB;font-size:0.74rem">—</span>';
      return `<tr style="border-bottom:1px solid #F3F4F6;${i%2===0?'':'background:#FAFAFA'}">
        <td style="padding:8px 10px">
          <div style="font-weight:700;color:#0A1628;font-size:0.83rem">${_escapeHtml(b.name||'')}</div>
          <div style="color:#9CA3AF;font-size:0.7rem">${_escapeHtml(b.address||'')}</div>
        </td>
        <td style="padding:8px 10px;white-space:nowrap">${_miStars(b.rating)}</td>
        <td style="padding:8px 10px;color:#374151;font-size:0.8rem;font-weight:700">${b.review_count != null ? b.review_count.toLocaleString() : '—'}</td>
        <td style="padding:8px 10px">${b.price_range ? `<span style="background:${pbg};color:${pc};padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:800">${_escapeHtml(b.price_range)}</span>` : '<span style="color:#D1D5DB;font-size:0.74rem">—</span>'}</td>
        <td style="padding:8px 10px">${websiteHtml}</td>
        <td style="padding:8px 10px;color:#4B5563;font-size:0.74rem;max-width:220px">${_escapeHtml((b.competitive_signal||'').slice(0,180))}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="padding:14px;color:#9CA3AF;text-align:center">No businesses match the current filters.</td></tr>';

    // update sort indicators
    document.querySelectorAll('[data-mi-sort]').forEach(th => {
      const ind = th.querySelector('.mi-sort-ind');
      if (ind) ind.textContent = th.dataset.miSort === _miFilter.sortCol ? (_miFilter.sortDir === -1 ? ' ▼' : ' ▲') : ' ⇅';
    });
  }

  // ── render full result ────────────────────────────────────────────────────
  function _miRenderResult(keyword, region, businesses, market_summary) {
    const out = document.getElementById('miOut'); if (!out) return;
    _miCurrent = { keyword, region, businesses: Array.isArray(businesses)?businesses:[], market_summary: market_summary||{} };
    const ms = _miCurrent.market_summary;
    const avgR = ms.avg_rating_benchmark ? parseFloat(ms.avg_rating_benchmark).toFixed(1) : 'N/A';
    const maturityCol = { saturated:'#DC2626', mature:'#F97316', moderate:'#0EA5E9', emerging:'#059669', fragmented:'#8B5CF6' }[ms.market_maturity] || '#6B7280';

    const oppsHtml = (ms.opportunities||[]).map(o =>
      `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px"><span style="color:#059669;font-size:0.85rem;flex-shrink:0">✅</span><div style="color:#374151;font-size:0.8rem">${_escapeHtml(o)}</div></div>`
    ).join('');
    const threatsHtml = (ms.threats||[]).map(t =>
      `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px"><span style="color:#DC2626;font-size:0.85rem;flex-shrink:0">⚠️</span><div style="color:#374151;font-size:0.8rem">${_escapeHtml(t)}</div></div>`
    ).join('');

    out.innerHTML = `
      <div style="background:linear-gradient(135deg,#0F4C81,#1E88E5);color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:0.72rem;font-weight:700;opacity:.8;text-transform:uppercase;margin-bottom:4px">🗺️ Google Maps · Competitive Landscape</div>
            <div style="font-size:1.3rem;font-weight:800">${_escapeHtml(keyword)} <span style="opacity:.8;font-size:1rem">in</span> ${_escapeHtml(region)}</div>
          </div>
          <div style="display:flex;gap:16px;text-align:center">
            <div><div style="font-size:1.5rem;font-weight:800">${_miCurrent.businesses.length}</div><div style="font-size:0.68rem;opacity:.8;font-weight:700">BUSINESSES</div></div>
            <div><div style="font-size:1.5rem;font-weight:800">⭐ ${avgR}</div><div style="font-size:0.68rem;opacity:.8;font-weight:700">AVG RATING</div></div>
            <div><div style="font-size:1.5rem;font-weight:800">${_escapeHtml(ms.density||_miCurrent.businesses.length)}</div><div style="font-size:0.68rem;opacity:.8;font-weight:700">DENSITY</div></div>
          </div>
        </div>
        ${ms.market_maturity ? `<div style="margin-top:10px"><span style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);padding:3px 12px;border-radius:10px;font-size:0.72rem;font-weight:800;text-transform:uppercase">Market: ${_escapeHtml(ms.market_maturity)}</span></div>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px">
          <div style="font-weight:800;color:#065F46;font-size:0.88rem;margin-bottom:10px">🚀 Opportunities (${(ms.opportunities||[]).length})</div>
          ${oppsHtml || '<div style="color:#9CA3AF;font-size:0.8rem">None identified.</div>'}
        </div>
        <div style="background:#FFF5F5;border:1px solid #FED7D7;border-radius:10px;padding:16px">
          <div style="font-weight:800;color:#991B1B;font-size:0.88rem;margin-bottom:10px">⚠️ Threats (${(ms.threats||[]).length})</div>
          ${threatsHtml || '<div style="color:#9CA3AF;font-size:0.8rem">None identified.</div>'}
        </div>
      </div>

      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">
          <div>
            <label style="display:block;font-size:0.68rem;font-weight:700;color:#6B7280;margin-bottom:4px">MIN RATING</label>
            <select id="miMinRating" style="padding:5px 8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.8rem;background:#F9FAFB">
              <option value="0">Any rating</option>
              <option value="3">3.0+</option>
              <option value="3.5">3.5+</option>
              <option value="4">4.0+</option>
              <option value="4.5">4.5+</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.68rem;font-weight:700;color:#6B7280;margin-bottom:4px">MIN REVIEWS</label>
            <select id="miMinReviews" style="padding:5px 8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.8rem;background:#F9FAFB">
              <option value="0">Any count</option>
              <option value="10">10+</option>
              <option value="50">50+</option>
              <option value="100">100+</option>
              <option value="250">250+</option>
            </select>
          </div>
          <div id="miFilterCount" style="font-size:0.78rem;color:#6B7280;padding-bottom:5px"></div>
        </div>
      </div>

      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;overflow:auto;margin-bottom:14px">
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
          <thead><tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB">
            <th data-mi-sort="name"         style="padding:9px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.7rem;text-transform:uppercase;cursor:pointer;user-select:none;min-width:180px">Business<span class="mi-sort-ind"> ⇅</span></th>
            <th data-mi-sort="rating"       style="padding:9px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.7rem;text-transform:uppercase;cursor:pointer;user-select:none;white-space:nowrap">Rating<span class="mi-sort-ind"> ▼</span></th>
            <th data-mi-sort="review_count" style="padding:9px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.7rem;text-transform:uppercase;cursor:pointer;user-select:none;white-space:nowrap">Reviews<span class="mi-sort-ind"> ⇅</span></th>
            <th style="padding:9px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.7rem;text-transform:uppercase;white-space:nowrap">Price</th>
            <th style="padding:9px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.7rem;text-transform:uppercase">Website</th>
            <th style="padding:9px 10px;text-align:left;color:#6B7280;font-weight:700;font-size:0.7rem;text-transform:uppercase;min-width:200px">Competitive Signal</th>
          </tr></thead>
          <tbody id="miTableBody"></tbody>
        </table>
      </div>`;

    // safe event binding — sort headers
    out.querySelectorAll('[data-mi-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.miSort;
        if (_miFilter.sortCol === col) { _miFilter.sortDir *= -1; } else { _miFilter.sortCol = col; _miFilter.sortDir = -1; }
        _miRebuildTable(_miCurrent.businesses);
      });
    });

    // safe event binding — filter dropdowns
    function _applyFilters() {
      _miFilter.minRating  = parseFloat(document.getElementById('miMinRating').value  || '0');
      _miFilter.minReviews = parseInt(document.getElementById('miMinReviews').value   || '0', 10);
      _miRebuildTable(_miCurrent.businesses);
      const visible = _miCurrent.businesses.filter(b =>
        (b.rating == null || b.rating >= _miFilter.minRating) &&
        (b.review_count == null || b.review_count >= _miFilter.minReviews)
      ).length;
      const fc = document.getElementById('miFilterCount');
      if (fc) fc.textContent = `Showing ${visible} of ${_miCurrent.businesses.length} businesses`;
    }
    document.getElementById('miMinRating').addEventListener('change',  _applyFilters);
    document.getElementById('miMinReviews').addEventListener('change', _applyFilters);

    _miRebuildTable(_miCurrent.businesses);
    _applyFilters();
  }

  // ── shell ─────────────────────────────────────────────────────────────────
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <label style="font-size:0.7rem;font-weight:700;color:#6B7280">BUSINESS CATEGORY / KEYWORD *</label>
            <button id="miKwSuggest" style="padding:3px 10px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);border:none;border-radius:5px;color:#fff;font-size:0.65rem;font-weight:700;cursor:pointer">🧠 AI Suggest</button>
          </div>
          <input id="miKeyword" placeholder="e.g. dentist, coffee shop, digital marketing agency" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
          <div id="miKwPills" style="display:none;margin-top:5px;flex-wrap:wrap;gap:5px"></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <label style="font-size:0.7rem;font-weight:700;color:#6B7280">TARGET CITY / REGION *</label>
            <button id="miRgSuggest" style="padding:3px 10px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);border:none;border-radius:5px;color:#fff;font-size:0.65rem;font-weight:700;cursor:pointer">🧠 AI Suggest</button>
          </div>
          <input id="miRegion" placeholder="e.g. Cape Town, Manhattan New York, London UK" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
          <div id="miRgPills" style="display:none;margin-top:5px;flex-wrap:wrap;gap:5px"></div>
        </div>
        <button id="miGo" style="background:linear-gradient(135deg,#0F4C81,#1E88E5);color:#fff;border:none;padding:9px 20px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer;white-space:nowrap;align-self:flex-end">🗺️ Scan Market</button>
      </div>
      <div style="font-size:0.74rem;color:#6B7280;margin-top:8px">Powered by Perplexity Sonar · AI-researched from live Google Maps data · 25-45s per scan</div>
    </div>
    <div id="miOut"></div>
    <h3 style="margin:24px 0 8px;color:#0A1628;font-size:0.96rem;font-weight:800">📚 Recent Scans</h3>
    <div id="miHistory"></div>
  `;

  renderRuns();

  // AI Suggest for keyword
  async function _miAISuggest(inputId, pillsId, btnId, fieldLabel, suggestions) {
    const btn   = document.getElementById(btnId);
    const pills = document.getElementById(pillsId);
    const inp   = document.getElementById(inputId);
    btn.textContent = '⏳…'; btn.disabled = true;
    try {
      const r = await fetch('/api/studio/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldLabel, fieldPlaceholder: inp.placeholder, context: `Google Maps competitor intelligence tool. ${fieldLabel}. Suggest 5 options. Return a JSON array of 5 short strings.`, format: 'json_array' })
      }).then(x => x.json());
      let sugs = suggestions; // fallback
      if (r.ok && r.result) {
        try { sugs = JSON.parse(r.result); } catch(_) {
          const m = String(r.result).match(/\[[\s\S]*\]/);
          if (m) { try { sugs = JSON.parse(m[0]); } catch(_) {} }
        }
      }
      if (!Array.isArray(sugs) || !sugs.length) sugs = suggestions;
      pills.style.display = 'flex';
      pills.innerHTML = sugs.slice(0,6).map(s => `<button data-sug="${_escapeHtml(String(s).slice(0,80))}" style="padding:4px 12px;background:#EDE9FE;color:#7C3AED;border:1px solid #DDD6FE;border-radius:12px;font-size:0.74rem;font-weight:700;cursor:pointer">${_escapeHtml(String(s).slice(0,80))}</button>`).join('');
      pills.querySelectorAll('[data-sug]').forEach(p => {
        p.addEventListener('click', () => { inp.value = p.dataset.sug; pills.style.display = 'none'; });
      });
    } catch(_) {}
    btn.textContent = '🧠 AI Suggest'; btn.disabled = false;
  }

  document.getElementById('miKwSuggest').addEventListener('click', () => {
    // Use keywords already identified in the analysis first — no AI call needed.
    const ad = window.analysisData || {};
    const fromAnalysis = Array.isArray(ad.keywords)
      ? ad.keywords.map(k => typeof k === 'string' ? k : (k.keyword || k.term || '')).filter(Boolean).slice(0, 8)
      : [];
    // Also pull industry name as a useful seed
    const industry = (ad.industry && (ad.industry.name || ad.industry)) || '';
    const combined = [...new Set([...(industry ? [industry] : []), ...fromAnalysis])].slice(0, 8);

    if (combined.length) {
      // Show analysis keywords as clickable pills immediately — no API round-trip
      const btn   = document.getElementById('miKwSuggest');
      const pills = document.getElementById('miKwPills');
      const inp   = document.getElementById('miKeyword');
      pills.style.display = 'flex';
      pills.innerHTML = combined.map(s => `<button data-sug="${_escapeHtml(String(s).slice(0,80))}" style="padding:4px 12px;background:#EDE9FE;color:#7C3AED;border:1px solid #DDD6FE;border-radius:12px;font-size:0.74rem;font-weight:700;cursor:pointer">${_escapeHtml(String(s).slice(0,80))}</button>`).join('');
      pills.querySelectorAll('[data-sug]').forEach(p => {
        p.addEventListener('click', () => { inp.value = p.dataset.sug; pills.style.display = 'none'; });
      });
    } else {
      // No analysis data — fall back to AI-generated suggestions
      _miAISuggest('miKeyword', 'miKwPills', 'miKwSuggest', 'Business category or keyword for local competitor research',
        ['dentist', 'coffee shop', 'digital marketing agency', 'gym', 'accounting firm']);
    }
  });
  document.getElementById('miRgSuggest').addEventListener('click', () =>
    _miAISuggest('miRegion', 'miRgPills', 'miRgSuggest', 'Target city or region for local competitor research',
      ['Cape Town South Africa', 'London UK', 'Manhattan New York', 'Sydney Australia', 'Dubai UAE'])
  );

  // enter key
  ['miKeyword','miRegion'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('miGo').click(); });
  });

  // scan button
  document.getElementById('miGo').addEventListener('click', async () => {
    const keyword = document.getElementById('miKeyword').value.trim();
    const region  = document.getElementById('miRegion').value.trim();
    const out = document.getElementById('miOut');
    if (!keyword) { out.innerHTML = '<div style="color:#991B1B;background:#FEE2E2;padding:10px 14px;border-radius:8px">⚠ Business category / keyword is required</div>'; return; }
    if (!region)  { out.innerHTML = '<div style="color:#991B1B;background:#FEE2E2;padding:10px 14px;border-radius:8px">⚠ Target city / region is required</div>'; return; }
    out.innerHTML = `<div style="text-align:center;padding:40px;background:#F0F7FF;border-radius:12px;color:#1E40AF"><div style="font-size:1.8rem;margin-bottom:10px">🗺️</div><div style="font-size:0.85rem">Scanning <strong>${_escapeHtml(keyword)}</strong> competitors in <strong>${_escapeHtml(region)}</strong>…<br><span style="opacity:.7">Powered by Perplexity Sonar · 25-45s</span></div></div>`;
    try {
      const r = await fetch('/api/maps-intel/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, region })
      }).then(x => x.json());
      if (!r.ok) {
        out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">⚠ ${_escapeHtml(r.error)}</div>`;
        return;
      }
      _miRenderResult(r.keyword, r.region, r.businesses, r.market_summary);
      const rr = await fetch('/api/maps-intel/runs').then(x => x.json());
      _miRuns = rr.runs || [];
      renderRuns();
    } catch(e) {
      out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`;
    }
  });
};

// ============================================================================
// T42 — Creative Intelligence (What Makes Content Perform)
// ============================================================================
window.buildCreativeIntel = async function() {
  const wrap = document.getElementById('ciWrap'); if (!wrap) return;

  const PLATFORM_COLORS = { 'TikTok':'#FF0050', 'YouTube Shorts':'#FF0000', 'Instagram Reels':'#C13584', 'Instagram':'#C13584', 'YouTube':'#FF0000', 'Unknown':'#6B7280' };
  const HOOK_LABELS     = { curiosity_gap:'Curiosity Gap', bold_claim:'Bold Claim', question:'Question Hook', listicle:'Listicle', controversy:'Controversy', story:'Story', how_to:'How-To', social_proof:'Social Proof' };
  const EMOTION_LABELS  = { excitement:'Excitement', fear_of_missing_out:'FOMO', curiosity:'Curiosity', inspiration:'Inspiration', humour:'Humour', relatability:'Relatability', urgency:'Urgency' };
  const MUSIC_LABELS    = { trending_audio:'Trending Audio', voiceover_only:'Voiceover Only', original_music:'Original Music', silence:'Silence / SFX', royalty_free:'Royalty Free' };

  let _ciRuns = [];
  let _ciCurrent = null;

  try { const rr = await fetch('/api/creative-intel/runs').then(x=>x.json()); _ciRuns = rr.runs||[]; } catch(_) {}

  function _fmt(n) {
    if (n == null) return '—';
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n/1000).toFixed(1) + 'K';
    return String(n);
  }

  function renderHistory() {
    const hist = document.getElementById('ciHistory'); if (!hist) return;
    if (!_ciRuns.length) { hist.innerHTML = '<div style="color:#9CA3AF;font-size:0.8rem">No analyses yet.</div>'; return; }
    hist.innerHTML = _ciRuns.slice(0,20).map(r => {
      const urls = Array.isArray(r.urls) ? r.urls : [];
      const p    = r.patterns || {};
      return `<div style="display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:10px 14px;margin-bottom:6px;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <strong style="color:#0A1628">${r.url_count||urls.length} videos analysed</strong>
          <span style="color:#9CA3AF;font-size:0.72rem;margin-left:8px">${p.optimal_length_range||''} · avg ${p.avg_engagement_rate||'?'}% eng</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:#9CA3AF;font-size:0.72rem">${new Date(r.created_at).toLocaleDateString()}</span>
          <button data-load="${r.id}" style="padding:4px 12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:5px;font-size:0.74rem;font-weight:700;color:#1D4ED8;cursor:pointer">Load</button>
          <button data-del="${r.id}"  style="padding:4px 10px;background:#FEE2E2;border:1px solid #FECACA;border-radius:5px;font-size:0.74rem;font-weight:700;color:#B91C1C;cursor:pointer">✕</button>
        </div>
      </div>`;
    }).join('');
    hist.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => _ciLoadRun(b.dataset.load)));
    hist.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this analysis?')) return;
      try {
        await fetch('/api/creative-intel/runs/'+b.dataset.del, { method:'DELETE' });
        _ciRuns = _ciRuns.filter(r => String(r.id) !== b.dataset.del);
        renderHistory();
      } catch(_) {}
    }));
  }

  async function _ciLoadRun(id) {
    const out = document.getElementById('ciOut'); if (!out) return;
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Loading…</div>';
    try {
      const r = await fetch('/api/creative-intel/runs/'+id).then(x=>x.json());
      if (!r.ok) { out.innerHTML = `<div style="color:#B91C1C">${_escapeHtml(r.error)}</div>`; return; }
      _ciRender(r.run.analyses, r.run.patterns, r.run.brief);
    } catch(e) { out.innerHTML = `<div style="color:#B91C1C">Error: ${_escapeHtml(e.message)}</div>`; }
  }

  function _pctBar(pct, color) {
    return `<div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;background:#F3F4F6;border-radius:4px;height:8px;overflow:hidden">
        <div style="width:${Math.min(100,pct||0)}%;background:${color||'#0EA5E9'};height:8px;border-radius:4px"></div>
      </div>
      <div style="min-width:36px;text-align:right;font-size:0.72rem;font-weight:700;color:#374151">${pct||0}%</div>
    </div>`;
  }

  function _ciRender(analyses, patterns, brief) {
    const out = document.getElementById('ciOut'); if (!out) return;
    _ciCurrent = { analyses: analyses||[], patterns: patterns||{}, brief: brief||'' };
    const p = _ciCurrent.patterns;
    const ana = _ciCurrent.analyses;

    // ── per-video card grid ──
    const cardGrid = ana.map(v => {
      const pColor = PLATFORM_COLORS[v.platform] || '#6B7280';
      return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="background:${pColor};color:#fff;padding:2px 8px;border-radius:8px;font-size:0.68rem;font-weight:800">${_escapeHtml(v.platform||'Unknown')}</span>
          ${v.engagement_rate != null ? `<span style="color:#059669;font-size:0.72rem;font-weight:700">${v.engagement_rate}% eng</span>` : ''}
        </div>
        <div style="font-weight:700;color:#0A1628;font-size:0.82rem;line-height:1.3">${_escapeHtml((v.title||'Untitled').slice(0,80))}</div>
        ${v.creator ? `<div style="color:#6B7280;font-size:0.7rem">@${_escapeHtml(v.creator.slice(0,40))}</div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;text-align:center">
          <div style="background:#F9FAFB;border-radius:6px;padding:4px 2px"><div style="font-size:0.78rem;font-weight:800;color:#374151">${_fmt(v.views)}</div><div style="font-size:0.6rem;color:#9CA3AF">VIEWS</div></div>
          <div style="background:#F9FAFB;border-radius:6px;padding:4px 2px"><div style="font-size:0.78rem;font-weight:800;color:#374151">${_fmt(v.likes)}</div><div style="font-size:0.6rem;color:#9CA3AF">LIKES</div></div>
          <div style="background:#F9FAFB;border-radius:6px;padding:4px 2px"><div style="font-size:0.78rem;font-weight:800;color:#374151">${v.duration_sec != null ? v.duration_sec+'s' : '—'}</div><div style="font-size:0.6rem;color:#9CA3AF">LENGTH</div></div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${v.hook_type       ? `<span style="padding:2px 8px;background:#EDE9FE;color:#7C3AED;border-radius:8px;font-size:0.65rem;font-weight:700">${_escapeHtml(HOOK_LABELS[v.hook_type]||v.hook_type)}</span>` : ''}
          ${v.emotion_trigger ? `<span style="padding:2px 8px;background:#FEF3C7;color:#92400E;border-radius:8px;font-size:0.65rem;font-weight:700">${_escapeHtml(EMOTION_LABELS[v.emotion_trigger]||v.emotion_trigger)}</span>` : ''}
          ${v.has_text_overlay ? '<span style="padding:2px 8px;background:#DCFCE7;color:#166534;border-radius:8px;font-size:0.65rem;font-weight:700">📝 Text Overlay</span>' : ''}
          ${v.cta_present      ? '<span style="padding:2px 8px;background:#FEE2E2;color:#991B1B;border-radius:8px;font-size:0.65rem;font-weight:700">📣 CTA</span>' : ''}
          ${v.music_type && v.music_type !== 'silence' ? `<span style="padding:2px 8px;background:#DBEAFE;color:#1D4ED8;border-radius:8px;font-size:0.65rem;font-weight:700">🎵 ${_escapeHtml(MUSIC_LABELS[v.music_type]||v.music_type)}</span>` : ''}
        </div>
        ${v.caption ? `<div style="color:#6B7280;font-size:0.72rem;border-top:1px solid #F3F4F6;padding-top:6px">${_escapeHtml(v.caption.slice(0,120))}${v.caption.length>120?'…':''}</div>` : ''}
      </div>`;
    }).join('');

    // ── winning formula bullets ──
    const formulaBullets = (p.winning_formula||[]).map(f =>
      `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px"><span style="color:#F59E0B;font-size:1rem;flex-shrink:0">⚡</span><div style="color:#374151;font-size:0.82rem">${_escapeHtml(f)}</div></div>`
    ).join('');

    // ── pattern distribution bars ──
    function patternBlock(title, items, colorFn) {
      if (!items || !items.length) return '';
      return `<div style="margin-bottom:14px">
        <div style="font-size:0.72rem;font-weight:700;color:#6B7280;text-transform:uppercase;margin-bottom:6px">${_escapeHtml(title)}</div>
        ${items.slice(0,5).map(it => `<div style="margin-bottom:6px">
          <div style="font-size:0.76rem;color:#374151;margin-bottom:3px">${_escapeHtml(it.label||it.value||'')}</div>
          ${_pctBar(it.pct, colorFn(it.value))}
        </div>`).join('')}
      </div>`;
    }

    const hookItems   = (p.hook_styles||[]).map(h => ({...h, label: HOOK_LABELS[h.value]||h.value}));
    const emotionItems= (p.emotion_triggers||[]).map(e => ({...e, label: EMOTION_LABELS[e.value]||e.value}));
    const musicItems  = (p.music_types||[]).map(m => ({...m, label: MUSIC_LABELS[m.value]||m.value}));
    const lengthItems = (p.length_buckets||[]);

    // ── brief panel ──
    const briefHtml = _escapeHtml(_ciCurrent.brief||'').replace(/^##\s+(.+)$/mg, '<h4 style="font-size:0.88rem;font-weight:800;color:#0A1628;margin:14px 0 4px">$1</h4>')
      .replace(/^#\s+(.+)$/mg, '<h3 style="font-size:1rem;font-weight:800;color:#0A1628;margin:0 0 8px">$1</h3>')
      .replace(/^\*\*(.+?)\*\*/mg, '<strong>$1</strong>')
      .replace(/^- (.+)$/mg, '<div style="display:flex;gap:6px;margin-bottom:5px"><span style="color:#0EA5E9">•</span><span>$1</span></div>')
      .split('\n').join('<br>');

    // brief topic for handoff (extract first non-heading line as topic)
    const briefTopic = encodeURIComponent((_ciCurrent.brief.split('\n').find(l => l.trim() && !l.startsWith('#'))||'').replace(/^[-*]\s*/,'').slice(0,200));

    out.innerHTML = `
      <!-- Summary banner -->
      <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:18px">
        <div style="font-size:0.72rem;font-weight:700;opacity:.8;text-transform:uppercase;margin-bottom:6px">🎬 Creative Intelligence Report</div>
        <div style="display:flex;gap:24px;flex-wrap:wrap">
          <div><div style="font-size:1.6rem;font-weight:800">${ana.length}</div><div style="font-size:0.68rem;opacity:.8;font-weight:700">VIDEOS ANALYSED</div></div>
          <div><div style="font-size:1.6rem;font-weight:800">${p.avg_engagement_rate||'—'}%</div><div style="font-size:0.68rem;opacity:.8;font-weight:700">AVG ENGAGEMENT</div></div>
          <div><div style="font-size:1.6rem;font-weight:800">${p.optimal_length_range||'—'}</div><div style="font-size:0.68rem;opacity:.8;font-weight:700">OPTIMAL LENGTH</div></div>
          <div><div style="font-size:1.6rem;font-weight:800">${p.text_overlay_pct||0}%</div><div style="font-size:0.68rem;opacity:.8;font-weight:700">USE TEXT OVERLAY</div></div>
          <div><div style="font-size:1.6rem;font-weight:800">${p.cta_pct||0}%</div><div style="font-size:0.68rem;opacity:.8;font-weight:700">INCLUDE CTA</div></div>
        </div>
      </div>

      <!-- Per-video cards -->
      <h3 style="font-size:0.94rem;font-weight:800;color:#0A1628;margin:0 0 10px">📹 Video Breakdown (${ana.length})</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:22px">${cardGrid}</div>

      <!-- Patterns + Winning Formula -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px">
          <div style="font-weight:800;color:#0A1628;font-size:0.9rem;margin-bottom:14px">📊 Pattern Analysis</div>
          ${patternBlock('Hook Styles', hookItems, () => '#7C3AED')}
          ${patternBlock('Emotion Triggers', emotionItems, () => '#F59E0B')}
          ${patternBlock('Music / Audio', musicItems, () => '#0EA5E9')}
          ${patternBlock('Video Length', lengthItems, () => '#059669')}
        </div>
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px;display:flex;flex-direction:column">
          <div style="font-weight:800;color:#0A1628;font-size:0.9rem;margin-bottom:12px">⚡ Winning Formula</div>
          <div style="flex:1">${formulaBullets || '<div style="color:#9CA3AF;font-size:0.8rem">No formula generated.</div>'}</div>
        </div>
      </div>

      <!-- Creative Brief -->
      <div style="background:#F0F7FF;border:1px solid #BFDBFE;border-radius:10px;padding:18px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="font-weight:800;color:#1E3A5F;font-size:0.94rem">📋 Creative Brief</div>
          <button id="ciHandoff" style="background:linear-gradient(135deg,#7C3AED,#0EA5E9);color:#fff;border:none;padding:7px 16px;border-radius:6px;font-size:0.78rem;font-weight:800;cursor:pointer">→ Open Video Script Generator</button>
        </div>
        <div style="color:#1E3A5F;font-size:0.82rem;line-height:1.6">${briefHtml}</div>
      </div>
    `;

    // handoff to Video Script Generator
    document.getElementById('ciHandoff').addEventListener('click', () => {
      const topHook = (p.hook_styles&&p.hook_styles[0]&&p.hook_styles[0].value)||'curiosity_gap';
      const topEmo  = (p.emotion_triggers&&p.emotion_triggers[0]&&p.emotion_triggers[0].value)||'excitement';
      const topic   = `Top competitor creative analysis — use a ${(topHook||'').replace(/_/g,' ')} hook with ${(topEmo||'').replace(/_/g,' ')} emotion. Optimal length: ${p.optimal_length_range||'30-60s'}. ${(p.winning_formula||[])[0]||''}`.slice(0,400);
      // navigate to video-script view and pre-fill
      const link = document.querySelector('[data-view="video-script"]');
      if (link) link.click();
      setTimeout(() => {
        const topicEl = document.getElementById('vsScriptTopic') || document.querySelector('#vsWrap textarea') || document.querySelector('[placeholder*="topic" i]');
        if (topicEl) { topicEl.value = topic; topicEl.dispatchEvent(new Event('input')); }
      }, 400);
    });
  }

  // ── shell ──────────────────────────────────────────────────────────────────
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">COMPETITOR VIDEO URLs (one per line, up to 20) — TikTok · YouTube Shorts · Instagram Reels</label>
      <textarea id="ciUrls" rows="5" placeholder="https://www.tiktok.com/@creator/video/123...&#10;https://www.youtube.com/shorts/abc123&#10;https://www.instagram.com/reel/xyz..." style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.82rem;font-family:monospace;box-sizing:border-box;resize:vertical"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px">
        <div style="color:#6B7280;font-size:0.74rem">Powered by Perplexity Sonar + GPT-4o-mini · 30-60s for 10+ videos</div>
        <button id="ciGo" style="background:linear-gradient(135deg,#1a1a2e,#7C3AED);color:#fff;border:none;padding:9px 22px;border-radius:6px;font-size:0.85rem;font-weight:800;cursor:pointer">🎬 Analyse Videos</button>
      </div>
    </div>
    <div id="ciOut"></div>
    <h3 style="margin:24px 0 8px;color:#0A1628;font-size:0.96rem;font-weight:800">📚 Recent Analyses</h3>
    <div id="ciHistory"></div>
  `;

  renderHistory();

  document.getElementById('ciGo').addEventListener('click', async () => {
    const raw  = document.getElementById('ciUrls').value;
    const urls = raw.split(/[\r\n]+/).map(s => s.trim()).filter(u => u.startsWith('http'));
    const out  = document.getElementById('ciOut');
    if (!urls.length) {
      out.innerHTML = '<div style="color:#991B1B;background:#FEE2E2;padding:10px 14px;border-radius:8px">⚠ Paste at least one valid URL (must start with https://)</div>';
      return;
    }
    out.innerHTML = `<div style="text-align:center;padding:40px;background:#F5F3FF;border-radius:12px;color:#4C1D95"><div style="font-size:1.8rem;margin-bottom:10px">🎬</div><div style="font-size:0.85rem">Analysing <strong>${urls.length}</strong> video${urls.length!==1?'s':''}…<br><span style="opacity:.7">Perplexity Sonar + GPT-4o-mini · 30-60s</span></div></div>`;
    try {
      const r = await fetch('/api/creative-intel/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      }).then(x => x.json());
      if (!r.ok) {
        out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">⚠ ${_escapeHtml(r.error)}</div>`;
        return;
      }
      _ciRender(r.analyses, r.patterns, r.brief);
      const rr = await fetch('/api/creative-intel/runs').then(x => x.json());
      _ciRuns = rr.runs || [];
      renderHistory();
    } catch(e) {
      out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`;
    }
  });
};

// ============================================================================
// TIER 43 — YouTube Comment Miner (Content Ideas from Audience Comments)
// ============================================================================
window.buildYtCommentMiner = async function(presetChannelId) {
  const wrap = document.getElementById('ycmWrap');
  if (!wrap) return;

  // Scaffold
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:20px">
      <h3 style="margin:0 0 14px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem;font-weight:800">⛏ Mine Comments</h3>
      <div style="display:grid;gap:12px">
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">TRACKED CHANNEL (from YouTube Monitor)</label>
          <select id="ycmChannelSel" style="width:100%;padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;background:#fff">
            <option value="">— Select a tracked channel —</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:10px;color:#6B7280;font-size:0.8rem">
          <div style="flex:1;height:1px;background:#E5E7EB"></div><span>OR</span><div style="flex:1;height:1px;background:#E5E7EB"></div>
        </div>
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">PASTE A VIDEO URL</label>
          <input id="ycmVideoUrl" type="url" placeholder="https://www.youtube.com/watch?v=..." style="width:100%;padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;box-sizing:border-box">
        </div>
        <div>
          <button id="ycmMineBtn" style="background:linear-gradient(135deg,#FF0000,#FF4444);color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:0.84rem;font-weight:800;cursor:pointer;width:100%">⛏ Mine Comments</button>
        </div>
      </div>
    </div>

    <div id="ycmResult"></div>

    <div id="ycmHistory" style="margin-top:28px"></div>
  `;

  // Load tracked channels
  try {
    const ch = await fetch('/api/youtube-monitor/channels').then(x => x.json());
    const sel = document.getElementById('ycmChannelSel');
    if (ch.ok && ch.channels && ch.channels.length) {
      ch.channels.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.channel_name + (c.brand ? ' — ' + c.brand : '');
        sel.appendChild(opt);
      });
      if (presetChannelId) sel.value = String(presetChannelId);
    }
  } catch (_) {}

  // Apply presetChannelId from global if set
  const pid = presetChannelId || window._ycmPresetChannelId;
  if (pid) {
    const sel = document.getElementById('ycmChannelSel');
    if (sel) sel.value = String(pid);
    window._ycmPresetChannelId = null;
  }

  // Mine button handler
  document.getElementById('ycmMineBtn').addEventListener('click', async () => {
    const channelId = document.getElementById('ycmChannelSel').value;
    const videoUrl  = document.getElementById('ycmVideoUrl').value.trim();
    if (!channelId && !videoUrl) { showToast('⚠ Select a channel or paste a video URL'); return; }

    const out = document.getElementById('ycmResult');
    out.innerHTML = `<div style="text-align:center;padding:40px;background:#FFF7F7;border-radius:12px;color:#991B1B"><div style="font-size:1.8rem;margin-bottom:10px">💬</div><div style="font-size:0.85rem">Mining YouTube comments…<br><span style="opacity:.7">Perplexity Sonar + GPT-4o-mini · 30-60s</span></div></div>`;

    try {
      const body = {};
      if (channelId) body.channelId = parseInt(channelId, 10);
      if (videoUrl)  body.videoUrl  = videoUrl;
      const r = await fetch('/api/yt-comment-miner/mine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(x => x.json());

      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">⚠ ${_escapeHtml(r.error)}</div>`; return; }
      _ycmRender(out, r);
      _ycmLoadHistory();
    } catch (e) {
      out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`;
    }
  });

  _ycmLoadHistory();
};

function _ycmRender(el, r) {
  const sb = r.sentiment_breakdown || {};
  const pos = sb.positive || 0, neu = sb.neutral || 0, neg = sb.negative || 0;

  const questionsHtml = (r.questions || []).map(q => `
    <div style="background:#F9FAFB;border-left:3px solid #3B82F6;border-radius:0 6px 6px 0;padding:8px 12px;margin-bottom:6px">
      <div style="font-size:0.82rem;color:#1E3A5F;font-weight:600">${_escapeHtml(q.text||'')}</div>
      ${q.recurrence ? `<div style="font-size:0.68rem;color:#6B7280;margin-top:2px">~${q.recurrence} mentions</div>` : ''}
    </div>`).join('');

  const themesHtml = (r.themes || []).map(t => {
    const sentCol = { positive:'#065F46', neutral:'#374151', negative:'#991B1B' };
    const sentBg  = { positive:'#ECFDF5', neutral:'#F3F4F6', negative:'#FEF2F2' };
    const s = (t.sentiment||'neutral').toLowerCase();
    return `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>
        <div style="font-size:0.82rem;font-weight:700;color:#0A1628">${_escapeHtml(t.theme||'')}</div>
        ${t.count ? `<div style="font-size:0.7rem;color:#6B7280;margin-top:2px">${t.count} comments</div>` : ''}
      </div>
      <span style="background:${sentBg[s]||sentBg.neutral};color:${sentCol[s]||sentCol.neutral};padding:2px 8px;border-radius:4px;font-size:0.68rem;font-weight:700;white-space:nowrap">${_escapeHtml(t.sentiment||'neutral')}</span>
    </div>`;
  }).join('');

  const ideasHtml = (r.content_ideas || []).map((idea, idx) => {
    const title = _escapeHtml(idea.title || '');
    const angle = _escapeHtml(idea.angle || '');
    const why   = _escapeHtml(idea.why_it_works || '');
    const encTitle = encodeURIComponent(idea.title || '');
    const encAngle = encodeURIComponent(idea.angle || '');
    return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:8px">
        <div style="font-weight:800;color:#0A1628;font-size:0.9rem;line-height:1.35">${title}</div>
        <button data-title="${title}" data-angle="${angle}" class="ycm-cal-btn" style="background:#F0FDF4;border:1px solid #BBF7D0;color:#065F46;padding:5px 10px;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">→ Add to Calendar</button>
      </div>
      ${angle ? `<div style="font-size:0.78rem;color:#374151;margin-bottom:6px"><strong>Angle:</strong> ${angle}</div>` : ''}
      ${why   ? `<div style="font-size:0.75rem;color:#6B7280;background:#F9FAFB;border-radius:6px;padding:6px 8px;border-left:2px solid #D1D5DB"><strong>Why it works:</strong> ${why}</div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:20px">
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
        <div style="font-weight:800;color:#0A1628;font-size:0.88rem;margin-bottom:10px">❓ Recurring Questions (${(r.questions||[]).length})</div>
        ${questionsHtml || '<div style="color:#9CA3AF;font-size:0.82rem">No questions found</div>'}
      </div>
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
        <div style="font-weight:800;color:#0A1628;font-size:0.88rem;margin-bottom:10px">🗂 Content Themes (${(r.themes||[]).length})</div>
        ${themesHtml || '<div style="color:#9CA3AF;font-size:0.82rem">No themes found</div>'}
      </div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:20px">
      <div style="font-weight:800;color:#0A1628;font-size:0.88rem;margin-bottom:12px">😊 Sentiment Breakdown (${r.comment_count||0} comments mined${r.source==='template'?' · demo data':''})</div>
      <div style="display:flex;gap:10px;align-items:center">
        <div style="flex:1;height:16px;border-radius:8px;overflow:hidden;display:flex">
          ${pos ? `<div style="width:${pos}%;background:#10B981"></div>` : ''}
          ${neu ? `<div style="width:${neu}%;background:#9CA3AF"></div>` : ''}
          ${neg ? `<div style="width:${neg}%;background:#EF4444"></div>` : ''}
        </div>
        <div style="display:flex;gap:12px;font-size:0.74rem;white-space:nowrap">
          <span><span style="color:#10B981;font-weight:800">${pos}%</span> positive</span>
          <span><span style="color:#9CA3AF;font-weight:800">${neu}%</span> neutral</span>
          <span><span style="color:#EF4444;font-weight:800">${neg}%</span> negative</span>
        </div>
      </div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
      <div style="font-weight:800;color:#0A1628;font-size:0.88rem;margin-bottom:14px">💡 Content Ideas (${(r.content_ideas||[]).length}) — click <em>Add to Calendar</em> to schedule any idea</div>
      ${ideasHtml || '<div style="color:#9CA3AF;font-size:0.82rem">No ideas generated</div>'}
    </div>
  `;

  // Wire Add to Calendar buttons
  el.querySelectorAll('.ycm-cal-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const title = btn.getAttribute('data-title');
      const angle = btn.getAttribute('data-angle');
      try {
        const payload = {
          brand: '', channel: 'YouTube', headline: title,
          copy: angle || title, cta: 'Watch Now',
          date: new Date(Date.now() + 7*24*3600*1000).toISOString().slice(0,10)
        };
        await fetch('/api/content-calendar/add', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        showToast('✅ Added to Content Calendar');
      } catch (e) { showToast('❌ Failed to add to Calendar'); }
    });
  });
}

async function _ycmLoadHistory() {
  const el = document.getElementById('ycmHistory');
  if (!el) return;
  try {
    const r = await fetch('/api/yt-comment-miner/runs').then(x => x.json());
    if (!r.ok || !r.runs || !r.runs.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
        <div style="font-weight:800;color:#0A1628;font-size:0.88rem;margin-bottom:12px">🕑 Recent Mining Runs</div>
        <div id="ycmHistList"></div>
      </div>`;
    document.getElementById('ycmHistList').innerHTML = r.runs.map(row => {
      const sb = row.sentiment_breakdown || {};
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F3F4F6;gap:10px">
        <div>
          <div style="font-size:0.82rem;font-weight:700;color:#0A1628">${_escapeHtml(row.channel_name||row.video_url||'Unknown')}</div>
          <div style="font-size:0.7rem;color:#9CA3AF">${new Date(row.created_at).toLocaleString()} · ${row.comment_count||0} comments</div>
          ${sb.positive !== undefined ? `<div style="font-size:0.68rem;color:#6B7280;margin-top:2px">😊 ${sb.positive}% · 😐 ${sb.neutral}% · 😠 ${sb.negative}%</div>` : ''}
        </div>
        <button data-run-id="${row.id}" class="ycm-del-btn" style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:5px 10px;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer">🗑</button>
      </div>`;
    }).join('');

    // Wire delete buttons
    el.querySelectorAll('.ycm-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-run-id');
        if (!confirm('Delete this mining run?')) return;
        try {
          await fetch(`/api/yt-comment-miner/runs/${id}`, { method: 'DELETE' });
          _ycmLoadHistory();
          showToast('🗑 Run deleted');
        } catch (e) { showToast('❌ ' + e.message); }
      });
    });
  } catch (_) {}
}

// ============================================================================
// TIER 44 — Link Prospector (Automated Link Building Outreach List)
// ============================================================================
window.buildLinkProspector = async function(presetDomain) {
  const wrap = document.getElementById('lpWrap');
  if (!wrap) return;

  const initDomain = presetDomain || window._lpPresetDomain || '';
  window._lpPresetDomain = null;

  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:20px">
      <h3 style="margin:0 0 14px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem;font-weight:800">🎯 Find Link Prospects</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">TARGET KEYWORD</label>
          <input id="lpKeyword" placeholder="e.g. best email marketing tools" style="width:100%;padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;box-sizing:border-box">
        </div>
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">YOUR DOMAIN</label>
          <input id="lpDomain" placeholder="e.g. yoursite.com" value="${_escapeHtml(initDomain)}" style="width:100%;padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;box-sizing:border-box">
        </div>
        <button id="lpFindBtn" style="background:linear-gradient(135deg,#3B82F6,#1D4ED8);color:#fff;border:none;padding:9px 22px;border-radius:8px;font-size:0.84rem;font-weight:800;cursor:pointer;white-space:nowrap">🎯 Find Prospects</button>
      </div>
      <div style="margin-top:10px">
        <label style="font-size:0.7rem;font-weight:700;color:#6B7280;margin-right:8px">FILTER:</label>
        <select id="lpStrengthFilter" style="padding:4px 8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.78rem;margin-right:8px">
          <option value="">All strengths</option>
          <option value="high">High only</option>
          <option value="medium">Medium+</option>
        </select>
        <label style="font-size:0.7rem;font-weight:700;color:#6B7280;margin-right:4px">Min relevance:</label>
        <select id="lpRelevanceFilter" style="padding:4px 8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.78rem">
          <option value="0">Any</option>
          <option value="60">60+</option>
          <option value="70">70+</option>
          <option value="80">80+</option>
        </select>
      </div>
    </div>

    <div id="lpResult"></div>
    <div id="lpHistory" style="margin-top:28px"></div>
  `;

  document.getElementById('lpFindBtn').addEventListener('click', _lpFind);
  document.getElementById('lpStrengthFilter').addEventListener('change', _lpApplyFilters);
  document.getElementById('lpRelevanceFilter').addEventListener('change', _lpApplyFilters);

  _lpLoadHistory();
};

let _lpLastProspects = [];

async function _lpFind() {
  const keyword = document.getElementById('lpKeyword').value.trim();
  const domain  = document.getElementById('lpDomain').value.trim();
  if (!keyword) { showToast('⚠ Enter a keyword'); return; }
  if (!domain)  { showToast('⚠ Enter your domain'); return; }

  const out = document.getElementById('lpResult');
  out.innerHTML = `<div style="text-align:center;padding:40px;background:#EFF6FF;border-radius:12px;color:#1D4ED8"><div style="font-size:1.8rem;margin-bottom:10px">🎯</div><div style="font-size:0.85rem">Finding link prospects for <strong>${_escapeHtml(keyword)}</strong>…<br><span style="opacity:.7">DataForSEO SERP + Perplexity + GPT-4o-mini · 30-60s</span></div></div>`;

  try {
    const r = await fetch('/api/link-prospector/find', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, domain })
    }).then(x => x.json());

    if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">⚠ ${_escapeHtml(r.error)}</div>`; return; }
    _lpLastProspects = r.prospects || [];
    _lpRender(out, r);
    _lpLoadHistory();
  } catch (e) {
    out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`;
  }
}

function _lpApplyFilters() {
  if (!_lpLastProspects.length) return;
  const strengthFilter  = document.getElementById('lpStrengthFilter').value;
  const relevanceFilter = parseInt(document.getElementById('lpRelevanceFilter').value, 10) || 0;
  const keyword = document.getElementById('lpKeyword').value.trim();
  const domain  = document.getElementById('lpDomain').value.trim();

  let filtered = _lpLastProspects;
  if (strengthFilter === 'high')   filtered = filtered.filter(p => p.domain_strength === 'high');
  if (strengthFilter === 'medium') filtered = filtered.filter(p => p.domain_strength === 'high' || p.domain_strength === 'medium');
  if (relevanceFilter > 0) filtered = filtered.filter(p => (p.content_relevance || 0) >= relevanceFilter);

  const out = document.getElementById('lpResult');
  if (out) _lpRender(out, { prospects: filtered, keyword, domain, total_found: filtered.length, source: '' });
}

function _lpRender(el, r) {
  const keyword = r.keyword || '';
  const domain  = r.domain  || '';
  const prospects = r.prospects || [];

  const strengthPill = s => {
    const cfg = { high: ['#ECFDF5','#065F46','High'], medium: ['#FEF3C7','#92400E','Medium'], low: ['#F3F4F6','#374151','Low'] };
    const c = cfg[s] || cfg.low;
    return `<span style="background:${c[0]};color:${c[1]};padding:2px 7px;border-radius:4px;font-size:0.65rem;font-weight:800">${c[2]}</span>`;
  };

  const priorityPill = (label, score) => {
    const col = label === 'High' ? '#065F46' : label === 'Medium' ? '#92400E' : '#374151';
    const bg  = label === 'High' ? '#ECFDF5' : label === 'Medium' ? '#FEF3C7' : '#F3F4F6';
    return `<span style="background:${bg};color:${col};padding:2px 8px;border-radius:4px;font-size:0.65rem;font-weight:800">${score ? score + ' · ' : ''}${label}</span>`;
  };

  const rows = prospects.map((p, i) => {
    const safeUrl = _safeUrl(p.url) ? `<a href="${_safeUrl(p.url)}" target="_blank" rel="noopener" style="color:#0066FF;font-weight:700;text-decoration:none">${_escapeHtml(p.title || p.url)}</a>` : _escapeHtml(p.title || p.url);
    const encKw     = encodeURIComponent(keyword);
    const encDomain = encodeURIComponent(p.domain);
    const encOffer  = encodeURIComponent('Link building outreach');
    const contactHtml = p.contact_email
      ? `<span style="font-size:0.7rem;color:#0066FF">${_escapeHtml(p.contact_email)}</span>`
      : (p.contact_twitter ? `<span style="font-size:0.7rem;color:#1DA1F2">${_escapeHtml(p.contact_twitter)}</span>` : '<span style="font-size:0.7rem;color:#9CA3AF">—</span>');

    return `<tr style="border-top:1px solid #F3F4F6" data-strength="${_escapeHtml(p.domain_strength||'low')}" data-relevance="${p.content_relevance||0}">
      <td style="padding:10px 12px;vertical-align:top;width:36px;color:#9CA3AF;font-size:0.75rem;text-align:center">${i+1}</td>
      <td style="padding:10px 12px;vertical-align:top;max-width:260px">
        <div style="font-size:0.82rem;line-height:1.35;margin-bottom:3px">${safeUrl}</div>
        <div style="font-size:0.7rem;color:#6B7280">${_escapeHtml(p.domain || '')}</div>
        ${p.outreach_angle ? `<div style="font-size:0.69rem;color:#6B7280;margin-top:3px;font-style:italic">"${_escapeHtml(p.outreach_angle)}"</div>` : ''}
      </td>
      <td style="padding:10px 12px;vertical-align:top;white-space:nowrap">${strengthPill(p.domain_strength||'low')}</td>
      <td style="padding:10px 12px;vertical-align:top">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:60px;height:6px;background:#E5E7EB;border-radius:3px;overflow:hidden"><div style="width:${p.content_relevance||0}%;height:100%;background:#3B82F6"></div></div>
          <span style="font-size:0.72rem;color:#374151;font-weight:700">${p.content_relevance||0}</span>
        </div>
      </td>
      <td style="padding:10px 12px;vertical-align:top;text-align:center">
        ${p.links_to_competitor ? '<span style="font-size:0.72rem;background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:4px;font-weight:700">✓ Yes</span>' : '<span style="color:#9CA3AF;font-size:0.72rem">—</span>'}
      </td>
      <td style="padding:10px 12px;vertical-align:top">${contactHtml}</td>
      <td style="padding:10px 12px;vertical-align:top;white-space:nowrap">${priorityPill(p.priority_label||'Medium', p.priority_score||0)}</td>
      <td style="padding:10px 12px;vertical-align:top">
        <button data-lp-domain="${_escapeHtml(p.domain)}" data-lp-url="${_escapeHtml(p.url)}" data-lp-title="${_escapeHtml(p.title||'')}" data-lp-angle="${_escapeHtml(p.outreach_angle||'')}" class="lp-draft-btn" style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1D4ED8;padding:4px 10px;border-radius:5px;font-size:0.7rem;font-weight:700;cursor:pointer;white-space:nowrap">✉️ Draft</button>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:12px">
      <div style="padding:12px 16px;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;color:#0A1628;font-size:0.88rem">🎯 ${prospects.length} Link Prospects${r.source === 'template' ? ' <span style="font-size:0.7rem;color:#9CA3AF;font-weight:400">(demo data — connect DataForSEO for live results)</span>' : ''}</div>
      </div>
      ${prospects.length ? `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
          <thead><tr style="background:#F9FAFB">
            <th style="padding:8px 12px;text-align:left;color:#6B7280;font-size:0.65rem;font-weight:800">#</th>
            <th style="padding:8px 12px;text-align:left;color:#6B7280;font-size:0.65rem;font-weight:800">PAGE / DOMAIN</th>
            <th style="padding:8px 12px;text-align:left;color:#6B7280;font-size:0.65rem;font-weight:800">STRENGTH</th>
            <th style="padding:8px 12px;text-align:left;color:#6B7280;font-size:0.65rem;font-weight:800">RELEVANCE</th>
            <th style="padding:8px 12px;text-align:left;color:#6B7280;font-size:0.65rem;font-weight:800">LINKS COMPETITORS</th>
            <th style="padding:8px 12px;text-align:left;color:#6B7280;font-size:0.65rem;font-weight:800">CONTACT</th>
            <th style="padding:8px 12px;text-align:left;color:#6B7280;font-size:0.65rem;font-weight:800">PRIORITY</th>
            <th style="padding:8px 12px;text-align:left;color:#6B7280;font-size:0.65rem;font-weight:800">ACTION</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : `<div style="padding:32px;text-align:center;color:#9CA3AF;font-size:0.85rem">No prospects match your filters.</div>`}
    </div>
  `;

  // Wire Draft Outreach buttons
  el.querySelectorAll('.lp-draft-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pDomain  = btn.getAttribute('data-lp-domain');
      const pUrl     = btn.getAttribute('data-lp-url');
      const pTitle   = btn.getAttribute('data-lp-title');
      const pAngle   = btn.getAttribute('data-lp-angle');
      // Pre-fill Cold Email Writer
      window._cePreset = {
        target_company: pDomain,
        target_pain: `They published "${pTitle}" and may be interested in linking to content from ${document.getElementById('lpDomain')?.value || ''} — ${pAngle}`,
        sender_offer: `Link-worthy content on ${document.getElementById('lpKeyword')?.value || ''}`,
      };
      const navLink = document.querySelector('[data-view="cold-email"]');
      if (navLink) navLink.click();
      showToast('✅ Opening Cold Email Writer…');
    });
  });
}

async function _lpLoadHistory() {
  const el = document.getElementById('lpHistory');
  if (!el) return;
  try {
    const r = await fetch('/api/link-prospector/runs').then(x => x.json());
    if (!r.ok || !r.runs || !r.runs.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
        <div style="font-weight:800;color:#0A1628;font-size:0.88rem;margin-bottom:12px">🕑 Recent Prospecting Runs</div>
        <div id="lpHistList"></div>
      </div>`;
    document.getElementById('lpHistList').innerHTML = r.runs.map(row => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F3F4F6;gap:10px">
        <div>
          <div style="font-size:0.82rem;font-weight:700;color:#0A1628">${_escapeHtml(row.keyword)} → ${_escapeHtml(row.domain)}</div>
          <div style="font-size:0.7rem;color:#9CA3AF">${new Date(row.created_at).toLocaleString()} · ${row.total_found||0} prospects</div>
        </div>
        <div style="display:flex;gap:6px">
          <button data-hist-id="${row.id}" class="lp-load-btn" style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1D4ED8;padding:4px 10px;border-radius:5px;font-size:0.7rem;font-weight:700;cursor:pointer">📂 Load</button>
          <button data-del-id="${row.id}" class="lp-del-btn" style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:4px 10px;border-radius:5px;font-size:0.7rem;font-weight:700;cursor:pointer">🗑</button>
        </div>
      </div>`).join('');

    // Wire load buttons
    el.querySelectorAll('.lp-load-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-hist-id');
        try {
          const r2 = await fetch(`/api/link-prospector/runs/${id}`).then(x => x.json());
          if (!r2.ok) return showToast('❌ ' + r2.error);
          _lpLastProspects = r2.run.prospects || [];
          document.getElementById('lpKeyword').value = r2.run.keyword || '';
          document.getElementById('lpDomain').value  = r2.run.domain  || '';
          const out = document.getElementById('lpResult');
          if (out) _lpRender(out, { prospects: _lpLastProspects, keyword: r2.run.keyword, domain: r2.run.domain, source: '' });
        } catch (e) { showToast('❌ ' + e.message); }
      });
    });

    // Wire delete buttons
    el.querySelectorAll('.lp-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-del-id');
        if (!confirm('Delete this prospecting run?')) return;
        try {
          await fetch(`/api/link-prospector/runs/${id}`, { method: 'DELETE' });
          showToast('🗑 Deleted');
          _lpLoadHistory();
        } catch (e) { showToast('❌ ' + e.message); }
      });
    });
  } catch (_) {}
}

})();
