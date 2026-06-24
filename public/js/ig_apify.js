// ─────────────────────────────────────────────────────────────────────────────
// T65 · Organic Social Monitor — TikTok organic search via Apify
// T66 · Local Lead Finder       — Google Maps business leads via Apify
// ─────────────────────────────────────────────────────────────────────────────

(function () {
function _apEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _apFmt(n) {
  n = parseInt(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
function _apSpinner(msg) {
  return `<div style="display:flex;align-items:center;gap:10px;padding:12px 0">
    <div style="width:16px;height:16px;border:2px solid #00C9C8;border-top-color:transparent;border-radius:50%;animation:_apSpin 0.8s linear infinite;flex-shrink:0"></div>
    <span style="font-size:0.85rem;color:rgba(255,255,255,0.6)">${_apEsc(msg)}</span>
  </div><style>@keyframes _apSpin{to{transform:rotate(360deg)}}</style>`;
}
function _apAlert(msg, type) {
  const map = {
    error:   { bg:'rgba(220,38,38,0.15)',  border:'rgba(220,38,38,0.4)',   fg:'#FCA5A5' },
    success: { bg:'rgba(16,185,129,0.15)', border:'rgba(16,185,129,0.4)',  fg:'#6EE7B7' },
    info:    { bg:'rgba(0,102,255,0.15)',  border:'rgba(0,102,255,0.4)',   fg:'#93C5FD' }
  };
  const c = map[type] || map.info;
  return `<div style="background:${c.bg};border:1px solid ${c.border};color:${c.fg};padding:10px 14px;border-radius:8px;font-size:0.84rem">${_apEsc(msg)}</div>`;
}

// ── No-key banner ─────────────────────────────────────────────────────────
function _apNoKeyBanner(feature) {
  return `<div style="background:linear-gradient(135deg,rgba(13,31,53,0.95),rgba(9,22,40,0.95));border:1px solid rgba(0,201,200,0.25);border-radius:14px;padding:32px;text-align:center;margin:16px 0">
    <div style="font-size:2.4rem;margin-bottom:10px">🔑</div>
    <div style="font-weight:800;font-size:1.1rem;color:#fff;margin-bottom:6px;font-family:'Sora',sans-serif">APIFY_API_KEY required</div>
    <div style="font-size:0.85rem;color:rgba(255,255,255,0.5);max-width:400px;margin:0 auto 20px">
      ${_apEsc(feature)} uses Apify's web scraping platform. Add your free Apify API key to unlock it.
    </div>
    <a href="https://console.apify.com/sign-up" target="_blank" rel="noopener"
       style="display:inline-block;padding:11px 26px;background:linear-gradient(135deg,#0066FF,#00C9C8);color:#fff;border-radius:8px;font-weight:700;font-size:0.85rem;text-decoration:none;box-shadow:0 4px 14px rgba(0,102,255,0.35)">
      Get Free Apify Key →
    </a>
    <div style="font-size:0.75rem;color:rgba(255,255,255,0.35);margin-top:12px">Then add it in <strong style="color:rgba(255,255,255,0.55)">Settings → Integrations → Apify</strong></div>
  </div>`;
}

// ── Shared helper: derive default keyword from analysis data ───────────────
function _orgDefaultKeyword() {
  const _ad = window.analysisData || {};
  if (_ad.brandName) return _ad.brandName;
  if (_ad.brand && typeof _ad.brand === 'string') return _ad.brand;
  if (_ad.companyName) return _ad.companyName;
  const dom = String(_ad.url || _ad.domain || '')
    .replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].split('.')[0].trim();
  return dom ? dom.charAt(0).toUpperCase() + dom.slice(1) : '';
}

// ═══════════════════════════════════════════════════════════════════════════
//  T65 · ORGANIC SOCIAL MONITOR
// ═══════════════════════════════════════════════════════════════════════════

window.buildOrganic = function() {
  const wrap = document.getElementById('organicWrap');
  if (!wrap || wrap._built) return;
  wrap._built = true;

  wrap.innerHTML = `
<div style="background:linear-gradient(135deg,#0D1F35 0%,#091628 100%);border-radius:16px;padding:28px 32px;margin-bottom:24px;border:1px solid rgba(0,201,200,0.15);box-shadow:0 8px 32px rgba(0,0,0,0.3);position:relative;overflow:hidden">
  <div style="position:absolute;top:0;right:0;width:220px;height:220px;background:radial-gradient(circle,rgba(255,0,80,0.08) 0%,transparent 70%);pointer-events:none"></div>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
    <div style="width:44px;height:44px;background:linear-gradient(135deg,#FF0050,#FF3B5C);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;box-shadow:0 4px 12px rgba(255,0,80,0.4);flex-shrink:0">📱</div>
    <div>
      <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:2px">ANALYSE · ORGANIC SOCIAL MONITOR</div>
      <h1 style="margin:0;font-size:1.5rem;font-weight:800;color:#fff;font-family:'Sora',sans-serif;line-height:1.2">Organic Social Monitor</h1>
    </div>
  </div>
  <p style="margin:8px 0 0 56px;font-size:0.88rem;color:rgba(255,255,255,0.5);line-height:1.5">Track any brand or keyword's organic TikTok content — views, engagement, top creators. Powered by Apify.</p>
</div>

<div style="background:linear-gradient(135deg,#0D1F35 0%,#091628 100%);border:1px solid rgba(0,201,200,0.2);border-radius:14px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.25)">
  <div style="display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:end">
    <div>
      <label style="display:block;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:6px">Brand · Keyword · Hashtag</label>
      <input id="orgKeyword" style="width:100%;box-sizing:border-box;background:#0A1628;border:1.5px solid rgba(0,201,200,0.3);border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;outline:none;transition:border-color 0.2s" placeholder="e.g. Nike, #CleanTok, Stanley Cup" onfocus="this.style.borderColor='rgba(0,201,200,0.7)'" onblur="this.style.borderColor='rgba(0,201,200,0.3)'">
    </div>
    <div>
      <label style="display:block;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:6px">Results</label>
      <select id="orgLimit" style="background:#0A1628;border:1.5px solid rgba(0,201,200,0.3);border-radius:8px;padding:10px 14px;color:#fff;font-size:0.88rem;cursor:pointer;color-scheme:dark;outline:none">
        <option value="10">10 videos</option>
        <option value="20" selected>20 videos</option>
        <option value="30">30 videos</option>
      </select>
    </div>
    <button id="orgRunBtn" onclick="window._orgRun()" style="background:linear-gradient(135deg,#FF0050,#FF3B5C);color:#fff;border:none;border-radius:8px;padding:10px 22px;font-weight:700;font-size:0.88rem;cursor:pointer;display:flex;align-items:center;gap:7px;box-shadow:0 4px 14px rgba(255,0,80,0.35);transition:opacity 0.2s;white-space:nowrap" onmouseover="this.style.opacity='0.88'" onmouseout="this.style.opacity='1'">
      <span style="font-size:1rem">🔍</span> Search TikTok
    </button>
  </div>
  <div id="orgStatus" style="margin-top:12px"></div>
</div>
<div id="orgResults"></div>`;

  // Pre-fill keyword — runs synchronously at build time.
  // _orgAutoFillKeyword is also called on every navigation so it re-checks
  // even if analysisData wasn't available when the view was first built.
  window._orgAutoFillKeyword();
};

// Called on every navigation to organic-social (from app.js).
// Safe to call multiple times — only fills if the field is still empty.
window._orgAutoFillKeyword = function() {
  const kwEl = document.getElementById('orgKeyword');
  if (!kwEl || kwEl.value.trim()) return;
  const kw = _orgDefaultKeyword();
  if (!kw) return;
  kwEl.value = kw;
  kwEl.dispatchEvent(new Event('input', { bubbles: true }));
};

window._orgRun = async function() {
  const keyword  = (document.getElementById('orgKeyword')||{}).value?.trim();
  const limit    = parseInt((document.getElementById('orgLimit')||{}).value) || 20;
  const statusEl = document.getElementById('orgStatus');
  const resEl    = document.getElementById('orgResults');
  const btn      = document.getElementById('orgRunBtn');
  if (!keyword) { if (statusEl) statusEl.innerHTML = _apAlert('Enter a keyword or hashtag', 'error'); return; }
  if (statusEl) statusEl.innerHTML = _apSpinner('Starting Apify TikTok Scraper…');
  if (resEl)    resEl.innerHTML = '';
  if (btn)      { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerHTML = '<span>⏳</span> Starting…'; }
  try {
    const d = await fetch('/api/apify/tiktok-organic', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, limit })
    }).then(r => r.json());
    if (!d.ok) {
      if (statusEl) statusEl.innerHTML = d.error?.includes('APIFY_API_KEY')
        ? _apNoKeyBanner('Organic Social Monitor')
        : _apAlert(d.error || 'Failed to start', 'error');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<span>🔍</span> Search TikTok'; }
      return;
    }
    if (statusEl) statusEl.innerHTML = _apSpinner('TikTok scrape running… checking every 8s (usually 30-90s)');
    window._apPoll(d.run_id, d.dataset_id, 'organic', btn, statusEl, resEl, 0, keyword, limit);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = _apAlert('Request failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<span>🔍</span> Search TikTok'; }
  }
};

function _renderOrganic(items, keyword) {
  const el = document.getElementById('orgResults');
  if (!el) return;
  if (!items.length) { el.innerHTML = _apAlert('No videos found — try a different keyword or hashtag', 'info'); return; }
  window._orgLastItems   = items;
  window._orgLastKeyword = keyword;
  const totalViews = items.reduce((a, v) => a + (parseInt(v.playCount) || 0), 0);
  const avgLikes   = Math.round(items.reduce((a, v) => a + (parseInt(v.diggCount) || 0), 0) / items.length);
  const cards = items.map((v, i) => {
    const views    = parseInt(v.playCount)    || 0;
    const likes    = parseInt(v.diggCount)    || 0;
    const comments = parseInt(v.commentCount) || 0;
    const shares   = parseInt(v.shareCount)   || 0;
    const author   = v.authorMeta?.name || v.author?.nickname || v.authorNickname || 'unknown';
    const desc     = (v.text || v.description || '').slice(0, 220);
    const url      = v.webVideoUrl || v.videoUrl || '';
    const er       = views > 0 ? ((likes / views) * 100).toFixed(2) + '%' : '—';
    const erNum    = parseFloat(er) || 0;
    const isTop    = i === 0 && views > 0;
    const erColor  = erNum > 2 ? '#34D399' : erNum > 0.5 ? '#FBBF24' : '#F87171';
    return `<div style="background:linear-gradient(135deg,#0D1F35,#091628);border:1px solid ${isTop?'rgba(255,0,80,0.5)':'rgba(0,201,200,0.18)'};border-radius:12px;padding:16px;position:relative;transition:border-color 0.2s" onmouseover="this.style.borderColor='${isTop?'rgba(255,0,80,0.8)':'rgba(0,201,200,0.45)'}'" onmouseout="this.style.borderColor='${isTop?'rgba(255,0,80,0.5)':'rgba(0,201,200,0.18)'}'">
      ${isTop?'<div style="position:absolute;top:12px;right:12px;background:linear-gradient(135deg,#FF0050,#FF3B5C);color:#fff;font-size:0.6rem;font-weight:800;padding:3px 8px;border-radius:20px;letter-spacing:0.05em">👑 TOP</div>':''}
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
        <div style="width:34px;height:34px;background:linear-gradient(135deg,#E21221,#FF0050);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.75rem;font-weight:800;flex-shrink:0">${_apEsc(author.slice(0,2).toUpperCase())}</div>
        <div style="font-weight:700;font-size:0.85rem;color:#fff">@${_apEsc(author)}</div>
        ${url ? `<a href="${_apEsc(url)}" target="_blank" rel="noopener" style="margin-left:auto;font-size:0.7rem;color:#FF0050;font-weight:800;text-decoration:none;white-space:nowrap;background:rgba(255,0,80,0.1);padding:3px 9px;border-radius:20px;border:1px solid rgba(255,0,80,0.3)">▶ Watch</a>` : ''}
      </div>
      <div style="font-size:0.79rem;color:rgba(255,255,255,0.6);line-height:1.55;margin-bottom:12px;min-height:36px">${_apEsc(desc)}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;font-size:0.7rem;text-align:center">
        ${[['👁',_apFmt(views),'Views'],['❤️',_apFmt(likes),'Likes'],['💬',_apFmt(comments),'Cmts'],['📤',_apFmt(shares),'Shares']].map(([ic,val,lbl])=>
          `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:7px;padding:6px 3px"><div style="font-size:0.9rem;margin-bottom:2px">${ic}</div><div style="font-weight:800;color:#fff;font-size:0.77rem">${val}</div><div style="color:rgba(255,255,255,0.35);font-size:0.62rem">${lbl}</div></div>`
        ).join('')}
      </div>
      <div style="margin-top:9px;font-size:0.72rem;color:rgba(255,255,255,0.4)">Engagement: <strong style="color:${erColor}">${er}</strong></div>
    </div>`;
  }).join('');

  el.innerHTML = `
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
  ${[['📹',items.length + ' Videos','Scraped'],['👁',_apFmt(totalViews),'Total Views'],['❤️',_apFmt(avgLikes)+' avg','Likes/Video']].map(([ic,v,l])=>
    `<div style="background:linear-gradient(135deg,#0D1F35,#091628);border:1px solid rgba(0,201,200,0.18);border-radius:12px;padding:16px;text-align:center"><div style="font-size:1.5rem;margin-bottom:4px">${ic}</div><div style="font-weight:800;font-size:1.15rem;color:#fff;font-family:'Sora',sans-serif">${v}</div><div style="font-size:0.72rem;color:rgba(255,255,255,0.4);margin-top:2px">${l}</div></div>`
  ).join('')}
</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
  <div style="font-weight:700;color:#fff;font-size:0.95rem;font-family:'Sora',sans-serif">TikTok results for "<span style="color:#FF0050">${_apEsc(keyword)}</span>"</div>
  <button onclick="window._orgExport()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.7);border-radius:8px;padding:7px 14px;font-size:0.78rem;font-weight:600;cursor:pointer" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">⬇ Export CSV</button>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px">${cards}</div>`;
}

window._orgExport = function() {
  const items = window._orgLastItems || [];
  const rows  = [['Author', 'Description', 'Views', 'Likes', 'Comments', 'Shares', 'EngagementRate%', 'URL']];
  items.forEach(v => {
    const views = parseInt(v.playCount)||0;
    const likes = parseInt(v.diggCount)||0;
    const er = views > 0 ? ((likes/views)*100).toFixed(2) : '0';
    rows.push([
      v.authorMeta?.name || v.author?.nickname || '',
      '"' + (v.text||v.description||'').replace(/"/g,'""').replace(/\n/g,' ') + '"',
      views, likes, parseInt(v.commentCount)||0, parseInt(v.shareCount)||0, er,
      v.webVideoUrl || v.videoUrl || ''
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'tiktok_organic_' + (window._orgLastKeyword||'export').replace(/\W+/g,'_') + '.csv';
  a.click();
};

// ═══════════════════════════════════════════════════════════════════════════
//  T66 · LOCAL LEAD FINDER
// ═══════════════════════════════════════════════════════════════════════════

window.buildLocalLeads = function() {
  const wrap = document.getElementById('localLeadsWrap');
  if (!wrap || wrap._built) return;
  wrap._built = true;
  wrap.innerHTML = `
<div style="background:linear-gradient(135deg,#0D1F35 0%,#091628 100%);border-radius:16px;padding:28px 32px;margin-bottom:24px;border:1px solid rgba(0,201,200,0.15);box-shadow:0 8px 32px rgba(0,0,0,0.3);position:relative;overflow:hidden">
  <div style="position:absolute;top:0;right:0;width:200px;height:200px;background:radial-gradient(circle,rgba(0,201,200,0.07) 0%,transparent 70%);pointer-events:none"></div>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
    <div style="width:44px;height:44px;background:linear-gradient(135deg,#0066FF,#00C9C8);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;box-shadow:0 4px 12px rgba(0,102,255,0.4);flex-shrink:0">📍</div>
    <div>
      <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:2px">ANALYSE · LOCAL LEAD FINDER</div>
      <h1 style="margin:0;font-size:1.5rem;font-weight:800;color:#fff;font-family:'Sora',sans-serif;line-height:1.2">Local Lead Finder</h1>
    </div>
  </div>
  <p style="margin:8px 0 0 56px;font-size:0.88rem;color:rgba(255,255,255,0.5);line-height:1.5">Pull live business leads from Google Maps — name, address, phone, website, rating, hours. Export to CSV or push to HubSpot.</p>
</div>

<div style="background:linear-gradient(135deg,#0D1F35 0%,#091628 100%);border:1px solid rgba(0,201,200,0.2);border-radius:14px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.25)">
  <div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:14px;align-items:end">
    <div>
      <label style="display:block;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:6px">Business Category</label>
      <input id="llCat" style="width:100%;box-sizing:border-box;background:#0A1628;border:1.5px solid rgba(0,201,200,0.3);border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;outline:none;transition:border-color 0.2s" placeholder="e.g. dentists, gyms, coffee shops" onfocus="this.style.borderColor='rgba(0,201,200,0.7)'" onblur="this.style.borderColor='rgba(0,201,200,0.3)'">
    </div>
    <div>
      <label style="display:block;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:6px">Location</label>
      <input id="llLoc" style="width:100%;box-sizing:border-box;background:#0A1628;border:1.5px solid rgba(0,201,200,0.3);border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;outline:none;transition:border-color 0.2s" placeholder="e.g. Miami FL, London UK, Toronto" onfocus="this.style.borderColor='rgba(0,201,200,0.7)'" onblur="this.style.borderColor='rgba(0,201,200,0.3)'">
    </div>
    <div>
      <label style="display:block;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:6px">Limit</label>
      <select id="llLimit" style="background:#0A1628;border:1.5px solid rgba(0,201,200,0.3);border-radius:8px;padding:10px 14px;color:#fff;font-size:0.88rem;cursor:pointer;color-scheme:dark;outline:none">
        <option value="10">10</option>
        <option value="20" selected>20</option>
        <option value="30">30</option>
      </select>
    </div>
    <button id="llRunBtn" onclick="window._llRun()" style="background:linear-gradient(135deg,#0066FF,#00C9C8);color:#fff;border:none;border-radius:8px;padding:10px 22px;font-weight:700;font-size:0.88rem;cursor:pointer;display:flex;align-items:center;gap:7px;box-shadow:0 4px 14px rgba(0,102,255,0.35);transition:opacity 0.2s;white-space:nowrap" onmouseover="this.style.opacity='0.88'" onmouseout="this.style.opacity='1'">
      <span style="font-size:1rem">🗺</span> Find Leads
    </button>
  </div>
  <div id="llStatus" style="margin-top:12px"></div>
</div>
<div id="llResults"></div>`;
};

window._llRun = async function() {
  const cat   = (document.getElementById('llCat')||{}).value?.trim();
  const loc   = (document.getElementById('llLoc')||{}).value?.trim();
  const limit = parseInt((document.getElementById('llLimit')||{}).value) || 20;
  const statusEl = document.getElementById('llStatus');
  const resEl    = document.getElementById('llResults');
  const btn      = document.getElementById('llRunBtn');
  if (!cat || !loc) { if (statusEl) statusEl.innerHTML = _apAlert('Category and location are both required', 'error'); return; }
  const query = `${cat} in ${loc}`;
  if (statusEl) statusEl.innerHTML = _apSpinner(`Starting Google Maps scrape for "${query}"…`);
  if (resEl)    resEl.innerHTML = '';
  if (btn)      { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerHTML = '<span>⏳</span> Starting…'; }
  try {
    const d = await fetch('/api/apify/maps-leads', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit })
    }).then(r => r.json());
    if (!d.ok) {
      if (statusEl) statusEl.innerHTML = d.error?.includes('APIFY_API_KEY')
        ? _apNoKeyBanner('Local Lead Finder')
        : _apAlert(d.error || 'Failed to start', 'error');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<span>🗺</span> Find Leads'; }
      return;
    }
    if (statusEl) statusEl.innerHTML = _apSpinner('Maps scrape running… checking every 8s (usually 45-120s)');
    window._apPoll(d.run_id, d.dataset_id, 'leads', btn, statusEl, resEl, 0, query, limit);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = _apAlert('Request failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<span>🗺</span> Find Leads'; }
  }
};

function _llStars(r) {
  const full = Math.round(r || 0);
  return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}

function _renderLeads(items, query) {
  const el = document.getElementById('llResults');
  if (!el) return;
  if (!items.length) { el.innerHTML = _apAlert('No businesses found — try a broader category or different location', 'info'); return; }
  window._llLastItems = items;
  window._llLastQuery = query;
  const withPhone   = items.filter(b => b.phone || b.phoneUnformatted).length;
  const withWebsite = items.filter(b => b.website).length;
  const avgRating   = (items.reduce((a, b) => a + (parseFloat(b.totalScore) || 0), 0) / items.length).toFixed(1);
  const cards = items.map(b => {
    const name    = b.title || b.name || '';
    const addr    = b.address || b.vicinity || '';
    const phone   = b.phone || b.phoneUnformatted || '';
    const website = b.website || '';
    const rating  = parseFloat(b.totalScore || b.rating) || 0;
    const reviews = parseInt(b.reviewsCount || b.userRatingsTotal) || 0;
    const cat     = (Array.isArray(b.categories) ? b.categories[0] : b.categoryName) || '';
    const hours   = b.openingHours?.join(', ') || '';
    const mapUrl  = b.url || '';
    return `<div style="background:linear-gradient(135deg,#0D1F35,#091628);border:1px solid rgba(0,201,200,0.18);border-radius:12px;padding:16px;transition:border-color 0.2s" onmouseover="this.style.borderColor='rgba(0,201,200,0.45)'" onmouseout="this.style.borderColor='rgba(0,201,200,0.18)'">
      <div style="font-weight:800;font-size:0.9rem;color:#fff;margin-bottom:2px;font-family:'Sora',sans-serif">${_apEsc(name)}</div>
      ${cat ? `<div style="font-size:0.68rem;color:rgba(0,201,200,0.8);margin-bottom:8px;text-transform:capitalize;font-weight:600">${_apEsc(cat)}</div>` : ''}
      ${rating ? `<div style="color:#FBBF24;font-size:0.82rem;margin-bottom:7px" title="${rating.toFixed(1)} stars, ${reviews} reviews">${_llStars(rating)} <span style="color:rgba(255,255,255,0.4);font-size:0.72rem">${rating.toFixed(1)} (${_apFmt(reviews)})</span></div>` : ''}
      ${addr    ? `<div style="font-size:0.79rem;color:rgba(255,255,255,0.6);margin-bottom:4px">📍 ${_apEsc(addr)}</div>` : ''}
      ${phone   ? `<div style="font-size:0.79rem;color:rgba(255,255,255,0.6);margin-bottom:4px">📞 <a href="tel:${_apEsc(phone)}" style="color:#60A5FA;text-decoration:none">${_apEsc(phone)}</a></div>` : ''}
      ${website ? `<div style="font-size:0.79rem;margin-bottom:6px">🌐 <a href="${_apEsc(website)}" target="_blank" rel="noopener" style="color:#60A5FA;text-decoration:none">${_apEsc(website.replace(/^https?:\/\//,'').slice(0,38))}</a></div>` : ''}
      ${hours   ? `<div style="font-size:0.68rem;color:rgba(255,255,255,0.35);margin-bottom:10px" title="${_apEsc(hours)}">🕐 ${_apEsc(hours.slice(0,60))}${hours.length>60?'…':''}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        ${mapUrl  ? `<a href="${_apEsc(mapUrl)}" target="_blank" rel="noopener" style="font-size:0.7rem;padding:5px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);border-radius:6px;text-decoration:none;font-weight:600">🗺 Maps</a>` : ''}
        ${website ? `<a href="${_apEsc(website)}" target="_blank" rel="noopener" style="font-size:0.7rem;padding:5px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);border-radius:6px;text-decoration:none;font-weight:600">🌐 Site</a>` : ''}
        <button onclick='window._llCopyLead(${JSON.stringify({name,addr,phone,website}).replace(/'/g,"&#39;")})' style="font-size:0.7rem;padding:5px 10px;background:rgba(0,201,200,0.1);border:1px solid rgba(0,201,200,0.3);color:#00C9C8;border-radius:6px;cursor:pointer;font-weight:600">📋 Copy</button>
      </div>
    </div>`;
  }).join('');
  el.innerHTML = `
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
  ${[['📍',items.length + ' Businesses','Found'],['📞',withPhone + ' / ' + items.length,'With Phone'],['🌐',withWebsite + ' / ' + items.length,'With Website']].map(([ic,v,l])=>
    `<div style="background:linear-gradient(135deg,#0D1F35,#091628);border:1px solid rgba(0,201,200,0.18);border-radius:12px;padding:16px;text-align:center"><div style="font-size:1.5rem;margin-bottom:4px">${ic}</div><div style="font-weight:800;font-size:1.1rem;color:#fff;font-family:'Sora',sans-serif">${v}</div><div style="font-size:0.72rem;color:rgba(255,255,255,0.4);margin-top:2px">${l}</div></div>`
  ).join('')}
</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
  <div style="font-weight:700;color:#fff;font-size:0.95rem;font-family:'Sora',sans-serif">Results for "<span style="color:#00C9C8">${_apEsc(query)}</span>"</div>
  <div style="display:flex;gap:8px">
    <button onclick="window._llExport()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.7);border-radius:8px;padding:7px 14px;font-size:0.78rem;font-weight:600;cursor:pointer" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">⬇ Export CSV</button>
    <button onclick="window._llPushHubSpot()" style="background:rgba(255,127,0,0.1);border:1px solid rgba(255,127,0,0.3);color:#FB923C;border-radius:8px;padding:7px 14px;font-size:0.78rem;font-weight:600;cursor:pointer" onmouseover="this.style.background='rgba(255,127,0,0.18)'" onmouseout="this.style.background='rgba(255,127,0,0.1)'">→ HubSpot</button>
  </div>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:12px">${cards}</div>`;
}

window._llCopyLead = function(lead) {
  const text = [lead.name, lead.addr, lead.phone, lead.website].filter(Boolean).join('\n');
  navigator.clipboard?.writeText(text).catch(() => {});
};

window._llExport = function() {
  const items = window._llLastItems || [];
  const rows  = [['Name','Category','Address','Phone','Website','Rating','Reviews']];
  items.forEach(b => rows.push([
    '"' + (b.title||b.name||'').replace(/"/g,'""') + '"',
    '"' + ((Array.isArray(b.categories)?b.categories[0]:b.categoryName)||'').replace(/"/g,'""') + '"',
    '"' + (b.address||b.vicinity||'').replace(/"/g,'""') + '"',
    b.phone||b.phoneUnformatted||'',
    b.website||'',
    b.totalScore||b.rating||'',
    b.reviewsCount||b.userRatingsTotal||''
  ]));
  const csv = rows.map(r => r.join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'local_leads_' + (window._llLastQuery||'export').replace(/\W+/g,'_') + '.csv';
  a.click();
};

window._llPushHubSpot = async function() {
  const items = window._llLastItems || [];
  if (!items.length) return;
  const btn = document.querySelector('[onclick="window._llPushHubSpot()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Pushing…'; }
  let ok = 0; let fail = 0;
  for (const b of items.slice(0, 20)) {
    const name = b.title || b.name || 'Unknown';
    try {
      const r = await fetch('/api/hubspot/create-company', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          domain: b.website ? b.website.replace(/^https?:\/\//,'').split('/')[0] : '',
          phone: b.phone || b.phoneUnformatted || '',
          address: b.address || '',
          city: b.city || '',
          country: b.countryCode || ''
        })
      }).then(x => x.json());
      if (r.ok) ok++; else fail++;
    } catch (_) { fail++; }
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '→ HubSpot'; }
  const statusEl = document.getElementById('llStatus');
  if (statusEl) statusEl.innerHTML = _apAlert(`Pushed to HubSpot: ${ok} companies created${fail?' · '+fail+' failed':''}`, ok > 0 ? 'success' : 'error');
};

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED APIFY POLLER
// ═══════════════════════════════════════════════════════════════════════════

window._apPoll = function(runId, datasetId, mode, btn, statusEl, resEl, attempts, query, limit) {
  const MAX      = 40; // 40 × 8s = ~5.5 min
  const btnLabel = mode === 'organic'
    ? '<span>🔍</span> Search TikTok'
    : '<span>🗺</span> Find Leads';
  if (attempts >= MAX) {
    if (statusEl) statusEl.innerHTML = _apAlert('Apify timed out — the scraper took too long. Try a smaller result count.', 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = btnLabel; }
    return;
  }
  setTimeout(async () => {
    try {
      const url = `/api/apify/run-status?run_id=${encodeURIComponent(runId)}&dataset_id=${encodeURIComponent(datasetId||'')}&limit=${limit||25}`;
      const d   = await fetch(url, { credentials: 'same-origin' }).then(r => r.json());
      if (d.error) {
        if (statusEl) statusEl.innerHTML = _apAlert(d.error, 'error');
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = btnLabel; }
        return;
      }
      if (d.status === 'failed') {
        if (statusEl) statusEl.innerHTML = _apAlert('Scrape failed: ' + (d.error || 'unknown'), 'error');
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = btnLabel; }
        return;
      }
      if (d.status === 'pending') {
        if (statusEl) statusEl.innerHTML = _apSpinner(`Still running… attempt ${attempts + 1}/${MAX} (${(attempts+1)*8}s elapsed)`);
        window._apPoll(runId, datasetId, mode, btn, statusEl, resEl, attempts + 1, query, limit);
        return;
      }
      // Complete
      if (statusEl) statusEl.innerHTML = _apAlert(`✓ Scraped ${(d.items||[]).length} results`, 'success');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = btnLabel; }
      if (mode === 'organic') _renderOrganic(d.items || [], query || '');
      else                    _renderLeads(d.items || [], query || '');
    } catch (e) {
      if (statusEl) statusEl.innerHTML = _apAlert('Poll error: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = btnLabel; }
    }
  }, 8000);
};

})();
