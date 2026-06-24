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
  return `<div style="display:flex;align-items:center;gap:10px;padding:14px 0">
    <div style="width:18px;height:18px;border:2.5px solid #FF0050;border-top-color:transparent;border-radius:50%;animation:_apSpin 0.75s linear infinite;flex-shrink:0"></div>
    <span style="font-size:0.85rem;color:rgba(255,255,255,0.55)">${_apEsc(msg)}</span>
  </div><style>@keyframes _apSpin{to{transform:rotate(360deg)}}</style>`;
}
function _apAlert(msg, type) {
  const map = {
    error:   { bg:'rgba(220,38,38,0.12)',  border:'rgba(220,38,38,0.35)',   fg:'#FCA5A5' },
    success: { bg:'rgba(16,185,129,0.12)', border:'rgba(16,185,129,0.35)',  fg:'#6EE7B7' },
    info:    { bg:'rgba(0,102,255,0.12)',  border:'rgba(0,102,255,0.35)',   fg:'#93C5FD' }
  };
  const c = map[type] || map.info;
  return `<div style="background:${c.bg};border:1px solid ${c.border};color:${c.fg};padding:11px 16px;border-radius:10px;font-size:0.84rem">${_apEsc(msg)}</div>`;
}
function _apNoKeyBanner(feature) {
  return `<div style="background:linear-gradient(135deg,rgba(13,31,53,0.98),rgba(9,22,40,0.98));border:1px solid rgba(255,0,80,0.25);border-radius:16px;padding:36px;text-align:center;margin:20px 0">
    <div style="font-size:2.8rem;margin-bottom:12px">🔑</div>
    <div style="font-weight:800;font-size:1.1rem;color:#fff;margin-bottom:8px;font-family:'Sora',sans-serif">APIFY_API_KEY required</div>
    <div style="font-size:0.85rem;color:rgba(255,255,255,0.45);max-width:420px;margin:0 auto 22px;line-height:1.6">
      ${_apEsc(feature)} uses Apify's scraping platform. Add your free API key to unlock it.
    </div>
    <a href="https://console.apify.com/sign-up" target="_blank" rel="noopener"
       style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#FF0050,#FF3B5C);color:#fff;border-radius:10px;font-weight:700;font-size:0.88rem;text-decoration:none;box-shadow:0 4px 20px rgba(255,0,80,0.4)">
      Get Free Apify Key →
    </a>
    <div style="font-size:0.74rem;color:rgba(255,255,255,0.3);margin-top:14px">Add it in <strong style="color:rgba(255,255,255,0.5)">Settings → Integrations → Apify</strong></div>
  </div>`;
}

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
  const _V = 'AP3';
  if (!wrap || wrap._igBuilt === _V) return;
  wrap._igBuilt = _V;

  wrap.innerHTML = `
<style>
@keyframes _ttGlow { 0%,100%{opacity:.6} 50%{opacity:1} }
@keyframes _ttPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
@keyframes _ttFadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
.tt-card { animation: _ttFadeUp 0.35s ease both; }
.tt-card:hover { transform: translateY(-3px) !important; box-shadow: 0 12px 40px rgba(255,0,80,0.2) !important; }
.tt-search-input::placeholder { color:rgba(255,255,255,0.3); }
.tt-search-input:focus { border-color: rgba(255,0,80,0.8) !important; box-shadow: 0 0 0 3px rgba(255,0,80,0.15) !important; }
</style>

<!-- ── HERO BANNER ──────────────────────────────────────────────────── -->
<div style="background:#0A0A0A;border-radius:20px;padding:36px 40px;margin-bottom:22px;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,0.06)">
  <!-- duotone corner glows -->
  <div style="position:absolute;top:-60px;left:-60px;width:300px;height:300px;background:radial-gradient(circle,rgba(255,0,80,0.22) 0%,transparent 65%);pointer-events:none;animation:_ttGlow 4s ease infinite"></div>
  <div style="position:absolute;bottom:-60px;right:-40px;width:280px;height:280px;background:radial-gradient(circle,rgba(0,201,200,0.18) 0%,transparent 65%);pointer-events:none;animation:_ttGlow 4s ease infinite 2s"></div>
  <!-- grid texture -->
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;border-radius:20px"></div>

  <div style="position:relative;display:flex;align-items:center;gap:20px">
    <!-- TikTok-style icon -->
    <div style="flex-shrink:0;width:64px;height:64px;background:#000;border:2px solid rgba(255,255,255,0.1);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:2rem;box-shadow:4px 4px 0 #FF0050,-4px -4px 0 #00C9C8;animation:_ttPulse 3s ease infinite">📱</div>
    <div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
        <span style="font-size:0.6rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.35)">ANALYSE</span>
        <span style="color:rgba(255,255,255,0.2);font-size:0.55rem">›</span>
        <span style="font-size:0.6rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,0,80,0.8)">ORGANIC SOCIAL MONITOR</span>
        <span style="background:rgba(255,0,80,0.15);border:1px solid rgba(255,0,80,0.4);color:#FF0050;font-size:0.55rem;font-weight:800;padding:2px 7px;border-radius:20px;letter-spacing:0.06em">● LIVE</span>
      </div>
      <h1 style="margin:0 0 6px;font-size:2rem;font-weight:900;color:#fff;font-family:'Sora',sans-serif;letter-spacing:-0.02em;line-height:1.1">Organic Social Monitor</h1>
      <p style="margin:0;font-size:0.88rem;color:rgba(255,255,255,0.4);line-height:1.5">Track any brand or keyword's TikTok content — views, engagement &amp; top creators. Powered by Apify.</p>
    </div>
  </div>
</div>

<!-- ── SEARCH BAR ──────────────────────────────────────────────────── -->
<div style="background:#111;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:22px 24px;margin-bottom:22px">
  <div style="display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center">
    <!-- Search input with pill design -->
    <div style="position:relative">
      <div style="position:absolute;left:16px;top:50%;transform:translateY(-50%);font-size:1rem;pointer-events:none;opacity:0.5">🔎</div>
      <input id="orgKeyword" data-ig-skip
        class="tt-search-input"
        style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.12);border-radius:12px;padding:13px 16px 13px 44px;color:#fff;font-size:0.95rem;outline:none;transition:border-color 0.2s,box-shadow 0.2s;font-family:'Sora',sans-serif"
        placeholder="Brand, keyword or hashtag — e.g. Nike, #CleanTok">
    </div>

    <!-- Results count pills -->
    <div style="display:flex;gap:6px">
      ${[10,20,30].map(n=>`<button onclick="document.querySelectorAll('.tt-cnt-pill').forEach(b=>{b.style.background='rgba(255,255,255,0.05)';b.style.color='rgba(255,255,255,0.5)';b.style.borderColor='rgba(255,255,255,0.12)'});this.style.background='rgba(255,0,80,0.2)';this.style.color='#FF0050';this.style.borderColor='rgba(255,0,80,0.5)';window._orgLimit=${n}" class="tt-cnt-pill" style="background:${n===20?'rgba(255,0,80,0.2)':'rgba(255,255,255,0.05)'};border:1.5px solid ${n===20?'rgba(255,0,80,0.5)':'rgba(255,255,255,0.12)'};color:${n===20?'#FF0050':'rgba(255,255,255,0.5)'};border-radius:8px;padding:8px 14px;font-size:0.8rem;font-weight:700;cursor:pointer;transition:all 0.15s">${n}</button>`).join('')}
    </div>

    <!-- Search button -->
    <button id="orgRunBtn" onclick="window._orgRun()"
      style="background:linear-gradient(135deg,#FF0050 0%,#FF3B5C 100%);color:#fff;border:none;border-radius:12px;padding:13px 28px;font-weight:800;font-size:0.9rem;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 4px 20px rgba(255,0,80,0.4),inset 0 1px 0 rgba(255,255,255,0.15);transition:all 0.2s;font-family:'Sora',sans-serif;letter-spacing:0.01em;white-space:nowrap"
      onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 8px 28px rgba(255,0,80,0.5),inset 0 1px 0 rgba(255,255,255,0.15)'"
      onmouseout="this.style.transform='none';this.style.boxShadow='0 4px 20px rgba(255,0,80,0.4),inset 0 1px 0 rgba(255,255,255,0.15)'">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      Search TikTok
    </button>
  </div>
  <div id="orgStatus" style="margin-top:10px"></div>
</div>

<div id="orgResults"></div>`;

  window._orgLimit = 20;
  window._orgAutoFillKeyword();
};

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
  const limit    = window._orgLimit || 20;
  const statusEl = document.getElementById('orgStatus');
  const resEl    = document.getElementById('orgResults');
  const btn      = document.getElementById('orgRunBtn');
  if (!keyword) { if (statusEl) statusEl.innerHTML = _apAlert('Enter a brand, keyword or hashtag to search', 'error'); return; }
  if (statusEl) statusEl.innerHTML = _apSpinner('Starting Apify TikTok Scraper…');
  if (resEl)    resEl.innerHTML = '';
  if (btn)      { btn.disabled = true; btn.style.opacity = '0.65'; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Starting…'; }
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
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Search TikTok'; }
      return;
    }
    if (statusEl) statusEl.innerHTML = _apSpinner('TikTok scrape running… checking every 8s (usually 30-90s)');
    window._apPoll(d.run_id, d.dataset_id, 'organic', btn, statusEl, resEl, 0, keyword, limit);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = _apAlert('Request failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Search TikTok'; }
  }
};

function _renderOrganic(items, keyword) {
  const el = document.getElementById('orgResults');
  if (!el) return;
  if (!items.length) { el.innerHTML = _apAlert('No videos found — try a different keyword or hashtag', 'info'); return; }
  window._orgLastItems   = items;
  window._orgLastKeyword = keyword;

  const totalViews = items.reduce((a, v) => a + (parseInt(v.playCount) || 0), 0);
  const totalLikes = items.reduce((a, v) => a + (parseInt(v.diggCount) || 0), 0);
  const avgEr = totalViews > 0 ? ((totalLikes / totalViews) * 100).toFixed(2) : '0';
  const topVideo = items.reduce((b, v) => (parseInt(v.playCount)||0) > (parseInt(b.playCount)||0) ? v : b, items[0]);

  // Stat cards
  const stats = `
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px">
  ${[
    ['📹', items.length, 'Videos', '#FF0050'],
    ['👁', _apFmt(totalViews), 'Total Views', '#00C9C8'],
    ['❤️', _apFmt(totalLikes), 'Total Likes', '#F59E0B'],
    ['📊', avgEr + '%', 'Avg ER', '#818CF8']
  ].map(([ic,v,l,col])=>`
  <div style="background:#111;border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:18px 20px;position:relative;overflow:hidden">
    <div style="position:absolute;top:-20px;right:-20px;font-size:3rem;opacity:0.07;pointer-events:none">${ic}</div>
    <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:6px">${l}</div>
    <div style="font-size:1.5rem;font-weight:900;color:${col};font-family:'Sora',sans-serif;line-height:1">${v}</div>
  </div>`).join('')}
</div>`;

  // Result header
  const header = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <div>
    <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:3px">TIKTOK RESULTS</div>
    <div style="font-size:1.05rem;font-weight:800;color:#fff;font-family:'Sora',sans-serif">Results for <span style="color:#FF0050">"${_apEsc(keyword)}"</span></div>
  </div>
  <button onclick="window._orgExport()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);border-radius:10px;padding:9px 18px;font-size:0.78rem;font-weight:700;cursor:pointer;transition:all 0.15s" onmouseover="this.style.background='rgba(255,255,255,0.1)';this.style.color='#fff'" onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.color='rgba(255,255,255,0.6)'">
    ⬇ Export CSV
  </button>
</div>`;

  // Video cards
  const cards = items.map((v, i) => {
    const views    = parseInt(v.playCount)    || 0;
    const likes    = parseInt(v.diggCount)    || 0;
    const comments = parseInt(v.commentCount) || 0;
    const shares   = parseInt(v.shareCount)   || 0;
    const author   = v.authorMeta?.name || v.author?.nickname || v.authorNickname || 'unknown';
    const desc     = (v.text || v.description || '').slice(0, 180);
    const url      = v.webVideoUrl || v.videoUrl || '';
    const er       = views > 0 ? ((likes / views) * 100).toFixed(2) : '0';
    const erNum    = parseFloat(er);
    const erColor  = erNum > 2 ? '#34D399' : erNum > 0.5 ? '#FBBF24' : '#F87171';
    const isTop    = i === 0 && views > 0;
    const initials = author.slice(0,2).toUpperCase();
    const delay    = (i * 0.04).toFixed(2);

    // Hashtags extraction
    const tags = (v.text || '').match(/#\w+/g) || [];
    const tagHtml = tags.slice(0,3).map(t=>`<span style="background:rgba(255,0,80,0.1);border:1px solid rgba(255,0,80,0.25);color:#FF6B8A;font-size:0.62rem;padding:2px 7px;border-radius:20px;font-weight:600">${_apEsc(t)}</span>`).join('');

    return `<div class="tt-card" style="animation-delay:${delay}s;background:#111;border:1px solid ${isTop?'rgba(255,0,80,0.4)':'rgba(255,255,255,0.07)'};border-radius:16px;overflow:hidden;transition:transform 0.2s,box-shadow 0.2s;position:relative">
  ${isTop?`<div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#FF0050,#FF3B5C,#FF6B8A)"></div>`:''}
  <div style="padding:16px 18px">
    <!-- Creator row -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div style="width:38px;height:38px;background:linear-gradient(135deg,#FF0050,#FF3B5C);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.8rem;font-weight:900;flex-shrink:0;box-shadow:0 2px 10px rgba(255,0,80,0.4)">${_apEsc(initials)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:0.88rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">@${_apEsc(author)}</div>
        ${isTop?`<div style="font-size:0.62rem;color:#FF0050;font-weight:700;letter-spacing:0.06em">👑 TOP PERFORMING</div>`:``}
      </div>
      ${url?`<a href="${_apEsc(url)}" target="_blank" rel="noopener" style="flex-shrink:0;background:rgba(255,0,80,0.12);border:1px solid rgba(255,0,80,0.3);color:#FF0050;font-size:0.72rem;font-weight:800;padding:5px 12px;border-radius:20px;text-decoration:none;transition:all 0.15s" onmouseover="this.style.background='rgba(255,0,80,0.25)'" onmouseout="this.style.background='rgba(255,0,80,0.12)'">▶ Watch</a>`:''}
    </div>

    <!-- Description -->
    <div style="font-size:0.8rem;color:rgba(255,255,255,0.55);line-height:1.6;margin-bottom:10px;min-height:40px">${_apEsc(desc)}${desc.length>=180?'…':''}</div>

    <!-- Hashtag pills -->
    ${tagHtml?`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">${tagHtml}</div>`:''}

    <!-- Metrics grid -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
      ${[['👁',_apFmt(views),'Views'],['❤️',_apFmt(likes),'Likes'],['💬',_apFmt(comments),'Cmts'],['🔁',_apFmt(shares),'Shares']].map(([ic,val,lbl])=>`
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:8px 4px;text-align:center">
        <div style="font-size:0.85rem;margin-bottom:2px">${ic}</div>
        <div style="font-size:0.82rem;font-weight:800;color:#fff">${val}</div>
        <div style="font-size:0.58rem;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.05em">${lbl}</div>
      </div>`).join('')}
    </div>

    <!-- ER bar -->
    <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
      <div style="font-size:0.62rem;color:rgba(255,255,255,0.3);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;flex-shrink:0">Engagement</div>
      <div style="flex:1;height:4px;background:rgba(255,255,255,0.07);border-radius:4px;overflow:hidden">
        <div style="width:${Math.min(erNum*20,100)}%;height:100%;background:${erColor};border-radius:4px;transition:width 0.6s ease"></div>
      </div>
      <div style="font-size:0.75rem;font-weight:800;color:${erColor};flex-shrink:0">${er}%</div>
    </div>
  </div>
</div>`;
  }).join('');

  el.innerHTML = stats + header + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">${cards}</div>`;
}

window._orgExport = function() {
  const items = window._orgLastItems || [];
  const rows  = [['Author','Description','Views','Likes','Comments','Shares','EngagementRate%','URL']];
  items.forEach(v => {
    const views = parseInt(v.playCount)||0;
    const likes = parseInt(v.diggCount)||0;
    rows.push([
      v.authorMeta?.name || v.author?.nickname || '',
      '"'+(v.text||v.description||'').replace(/"/g,'""').replace(/\n/g,' ')+'"',
      views, likes, parseInt(v.commentCount)||0, parseInt(v.shareCount)||0,
      views>0?((likes/views)*100).toFixed(2):'0',
      v.webVideoUrl||v.videoUrl||''
    ]);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download= 'tiktok_organic_'+(window._orgLastKeyword||'export').replace(/\W+/g,'_')+'.csv';
  a.click();
};

// ═══════════════════════════════════════════════════════════════════════════
//  T66 · LOCAL LEAD FINDER
// ═══════════════════════════════════════════════════════════════════════════

window.buildLocalLeads = function() {
  const wrap = document.getElementById('localLeadsWrap');
  const _V = 'AP3';
  if (!wrap || wrap._igBuilt === _V) return;
  wrap._igBuilt = _V;
  wrap.innerHTML = `
<div style="background:#0A0A0A;border-radius:20px;padding:36px 40px;margin-bottom:22px;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,0.06)">
  <div style="position:absolute;top:-50px;left:-50px;width:280px;height:280px;background:radial-gradient(circle,rgba(0,102,255,0.18) 0%,transparent 65%);pointer-events:none"></div>
  <div style="position:absolute;bottom:-50px;right:-30px;width:240px;height:240px;background:radial-gradient(circle,rgba(0,201,200,0.15) 0%,transparent 65%);pointer-events:none"></div>
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;border-radius:20px"></div>
  <div style="position:relative;display:flex;align-items:center;gap:20px">
    <div style="flex-shrink:0;width:64px;height:64px;background:#000;border:2px solid rgba(255,255,255,0.1);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:2rem;box-shadow:4px 4px 0 #0066FF,-4px -4px 0 #00C9C8">📍</div>
    <div>
      <div style="font-size:0.6rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(0,201,200,0.8);margin-bottom:5px">ANALYSE · LOCAL LEAD FINDER</div>
      <h1 style="margin:0 0 6px;font-size:2rem;font-weight:900;color:#fff;font-family:'Sora',sans-serif;letter-spacing:-0.02em;line-height:1.1">Local Lead Finder</h1>
      <p style="margin:0;font-size:0.88rem;color:rgba(255,255,255,0.4);line-height:1.5">Pull live business leads from Google Maps — phone, website, rating, hours. Export to CSV or push to HubSpot.</p>
    </div>
  </div>
</div>

<div style="background:#111;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:22px 24px;margin-bottom:22px">
  <div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:12px;align-items:end">
    <div>
      <label style="display:block;font-size:0.62rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:7px">Business Category</label>
      <div style="position:relative">
        <div style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:0.9rem;pointer-events:none;opacity:0.5">🏢</div>
        <input id="llCat" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.12);border-radius:12px;padding:13px 14px 13px 38px;color:#fff;font-size:0.9rem;outline:none;transition:border-color 0.2s,box-shadow 0.2s" placeholder="dentists, gyms, coffee shops" onfocus="this.style.borderColor='rgba(0,201,200,0.7)';this.style.boxShadow='0 0 0 3px rgba(0,201,200,0.1)'" onblur="this.style.borderColor='rgba(255,255,255,0.12)';this.style.boxShadow='none'">
      </div>
    </div>
    <div>
      <label style="display:block;font-size:0.62rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:7px">Location</label>
      <div style="position:relative">
        <div style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:0.9rem;pointer-events:none;opacity:0.5">📍</div>
        <input id="llLoc" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.12);border-radius:12px;padding:13px 14px 13px 38px;color:#fff;font-size:0.9rem;outline:none;transition:border-color 0.2s,box-shadow 0.2s" placeholder="Miami FL, London UK, Toronto" onfocus="this.style.borderColor='rgba(0,201,200,0.7)';this.style.boxShadow='0 0 0 3px rgba(0,201,200,0.1)'" onblur="this.style.borderColor='rgba(255,255,255,0.12)';this.style.boxShadow='none'">
      </div>
    </div>
    <div>
      <label style="display:block;font-size:0.62rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:7px">Limit</label>
      <select id="llLimit" style="background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.12);border-radius:12px;padding:13px 14px;color:#fff;font-size:0.88rem;cursor:pointer;color-scheme:dark;outline:none;height:48px">
        <option value="10">10</option>
        <option value="20" selected>20</option>
        <option value="30">30</option>
      </select>
    </div>
    <button id="llRunBtn" onclick="window._llRun()"
      style="background:linear-gradient(135deg,#0066FF 0%,#00C9C8 100%);color:#fff;border:none;border-radius:12px;padding:13px 26px;font-weight:800;font-size:0.9rem;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 4px 20px rgba(0,102,255,0.35),inset 0 1px 0 rgba(255,255,255,0.15);transition:all 0.2s;white-space:nowrap"
      onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 8px 28px rgba(0,102,255,0.5),inset 0 1px 0 rgba(255,255,255,0.15)'"
      onmouseout="this.style.transform='none';this.style.boxShadow='0 4px 20px rgba(0,102,255,0.35),inset 0 1px 0 rgba(255,255,255,0.15)'">
      🗺 Find Leads
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
  if (btn)      { btn.disabled = true; btn.style.opacity = '0.65'; btn.textContent = '⏳ Starting…'; }
  try {
    const d = await fetch('/api/apify/maps-leads', {
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ query, limit })
    }).then(r=>r.json());
    if (!d.ok) {
      if (statusEl) statusEl.innerHTML = d.error?.includes('APIFY_API_KEY')
        ? _apNoKeyBanner('Local Lead Finder')
        : _apAlert(d.error || 'Failed to start', 'error');
      if (btn) { btn.disabled=false; btn.style.opacity='1'; btn.textContent='🗺 Find Leads'; }
      return;
    }
    if (statusEl) statusEl.innerHTML = _apSpinner('Maps scrape running… checking every 8s (usually 45-120s)');
    window._apPoll(d.run_id, d.dataset_id, 'leads', btn, statusEl, resEl, 0, query, limit);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = _apAlert('Request failed: '+e.message, 'error');
    if (btn) { btn.disabled=false; btn.style.opacity='1'; btn.textContent='🗺 Find Leads'; }
  }
};

function _llStars(r) {
  const full = Math.round(r||0);
  return '★'.repeat(full)+'☆'.repeat(Math.max(0,5-full));
}

function _renderLeads(items, query) {
  const el = document.getElementById('llResults');
  if (!el) return;
  if (!items.length) { el.innerHTML = _apAlert('No businesses found — try a broader category or different location','info'); return; }
  window._llLastItems = items;
  window._llLastQuery = query;
  const withPhone   = items.filter(b=>b.phone||b.phoneUnformatted).length;
  const withWebsite = items.filter(b=>b.website).length;
  const avgRating   = (items.reduce((a,b)=>a+(parseFloat(b.totalScore)||0),0)/items.length).toFixed(1);

  const statRow = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
    ${[['📍',items.length,'Found','#0066FF'],['📞',withPhone,'With Phone','#00C9C8'],['🌐',withWebsite,'With Website','#34D399'],['⭐',avgRating,'Avg Rating','#FBBF24']].map(([ic,v,l,col])=>`
    <div style="background:#111;border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px 18px;position:relative;overflow:hidden">
      <div style="position:absolute;top:-18px;right:-18px;font-size:2.8rem;opacity:0.07">${ic}</div>
      <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:5px">${l}</div>
      <div style="font-size:1.4rem;font-weight:900;color:${col};font-family:'Sora',sans-serif">${v}</div>
    </div>`).join('')}
  </div>`;

  const cards = items.map(b=>{
    const name    = b.title||b.name||'';
    const addr    = b.address||b.vicinity||'';
    const phone   = b.phone||b.phoneUnformatted||'';
    const website = b.website||'';
    const rating  = parseFloat(b.totalScore||b.rating)||0;
    const reviews = parseInt(b.reviewsCount||b.userRatingsTotal)||0;
    const cat     = (Array.isArray(b.categories)?b.categories[0]:b.categoryName)||'';
    const hours   = b.openingHours?.join(', ')||'';
    const mapUrl  = b.url||'';
    return `<div style="background:#111;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:18px;transition:transform 0.2s,border-color 0.2s,box-shadow 0.2s" onmouseover="this.style.transform='translateY(-2px)';this.style.borderColor='rgba(0,201,200,0.35)';this.style.boxShadow='0 8px 28px rgba(0,102,255,0.15)'" onmouseout="this.style.transform='none';this.style.borderColor='rgba(255,255,255,0.07)';this.style.boxShadow='none'">
      <div style="font-weight:800;font-size:0.92rem;color:#fff;margin-bottom:3px;font-family:'Sora',sans-serif">${_apEsc(name)}</div>
      ${cat?`<div style="font-size:0.68rem;color:rgba(0,201,200,0.8);margin-bottom:7px;font-weight:700;text-transform:capitalize">${_apEsc(cat)}</div>`:''}
      ${rating?`<div style="color:#FBBF24;font-size:0.84rem;margin-bottom:8px">${_llStars(rating)} <span style="color:rgba(255,255,255,0.4);font-size:0.72rem">${rating.toFixed(1)} (${_apFmt(reviews)})</span></div>`:''}
      ${addr?`<div style="font-size:0.79rem;color:rgba(255,255,255,0.5);margin-bottom:4px">📍 ${_apEsc(addr)}</div>`:''}
      ${phone?`<div style="font-size:0.79rem;margin-bottom:4px">📞 <a href="tel:${_apEsc(phone)}" style="color:#60A5FA;text-decoration:none">${_apEsc(phone)}</a></div>`:''}
      ${website?`<div style="font-size:0.79rem;margin-bottom:7px">🌐 <a href="${_apEsc(website)}" target="_blank" rel="noopener" style="color:#60A5FA;text-decoration:none">${_apEsc(website.replace(/^https?:\/\//,'').slice(0,38))}</a></div>`:''}
      ${hours?`<div style="font-size:0.68rem;color:rgba(255,255,255,0.3);margin-bottom:10px" title="${_apEsc(hours)}">🕐 ${_apEsc(hours.slice(0,58))}${hours.length>58?'…':''}</div>`:''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        ${mapUrl?`<a href="${_apEsc(mapUrl)}" target="_blank" rel="noopener" style="font-size:0.7rem;padding:5px 11px;background:rgba(0,102,255,0.1);border:1px solid rgba(0,102,255,0.3);color:#60A5FA;border-radius:8px;text-decoration:none;font-weight:700">🗺 Maps</a>`:''}
        ${website?`<a href="${_apEsc(website)}" target="_blank" rel="noopener" style="font-size:0.7rem;padding:5px 11px;background:rgba(0,201,200,0.08);border:1px solid rgba(0,201,200,0.25);color:#00C9C8;border-radius:8px;text-decoration:none;font-weight:700">🌐 Site</a>`:''}
        <button onclick='window._llCopyLead(${JSON.stringify({name,addr,phone,website}).replace(/'/g,"&#39;")})' style="font-size:0.7rem;padding:5px 11px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);border-radius:8px;cursor:pointer;font-weight:700">📋 Copy</button>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = statRow +
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:1rem;font-weight:800;color:#fff;font-family:'Sora',sans-serif">Results for "<span style="color:#00C9C8">${_apEsc(query)}</span>"</div>
      <div style="display:flex;gap:8px">
        <button onclick="window._llExport()" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);border-radius:10px;padding:8px 16px;font-size:0.78rem;font-weight:700;cursor:pointer" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='rgba(255,255,255,0.6)'">⬇ CSV</button>
        <button onclick="window._llPushHubSpot()" style="background:rgba(255,107,0,0.1);border:1px solid rgba(255,107,0,0.3);color:#FB923C;border-radius:10px;padding:8px 16px;font-size:0.78rem;font-weight:700;cursor:pointer" onmouseover="this.style.background='rgba(255,107,0,0.2)'" onmouseout="this.style.background='rgba(255,107,0,0.1)'">→ HubSpot</button>
      </div>
    </div>` +
    `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${cards}</div>`;
}

window._llCopyLead = function(lead) {
  const text = [lead.name,lead.addr,lead.phone,lead.website].filter(Boolean).join('\n');
  navigator.clipboard?.writeText(text).catch(()=>{});
};

window._llExport = function() {
  const items = window._llLastItems||[];
  const rows  = [['Name','Category','Address','Phone','Website','Rating','Reviews']];
  items.forEach(b=>rows.push([
    '"'+(b.title||b.name||'').replace(/"/g,'""')+'"',
    '"'+((Array.isArray(b.categories)?b.categories[0]:b.categoryName)||'').replace(/"/g,'""')+'"',
    '"'+(b.address||b.vicinity||'').replace(/"/g,'""')+'"',
    b.phone||b.phoneUnformatted||'',b.website||'',
    b.totalScore||b.rating||'',b.reviewsCount||b.userRatingsTotal||''
  ]));
  const csv = rows.map(r=>r.join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download= 'local_leads_'+(window._llLastQuery||'export').replace(/\W+/g,'_')+'.csv';
  a.click();
};

window._llPushHubSpot = async function() {
  const items = window._llLastItems||[];
  if (!items.length) return;
  const btn = document.querySelector('[onclick="window._llPushHubSpot()"]');
  if (btn) { btn.disabled=true; btn.textContent='⏳ Pushing…'; }
  let ok=0,fail=0;
  for (const b of items.slice(0,20)) {
    try {
      const r = await fetch('/api/hubspot/create-company',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          name:b.title||b.name||'Unknown',
          domain:b.website?b.website.replace(/^https?:\/\//,'').split('/')[0]:'',
          phone:b.phone||b.phoneUnformatted||'',
          address:b.address||'',city:b.city||'',country:b.countryCode||''
        })
      }).then(x=>x.json());
      if (r.ok) ok++; else fail++;
    } catch(_){fail++;}
  }
  if (btn) { btn.disabled=false; btn.textContent='→ HubSpot'; }
  const statusEl = document.getElementById('llStatus');
  if (statusEl) statusEl.innerHTML = _apAlert(`Pushed to HubSpot: ${ok} companies created${fail?' · '+fail+' failed':''}`,ok>0?'success':'error');
};

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED APIFY POLLER
// ═══════════════════════════════════════════════════════════════════════════

window._apPoll = function(runId,datasetId,mode,btn,statusEl,resEl,attempts,query,limit){
  const MAX = 40;
  const btnReset = () => {
    if (!btn) return;
    btn.disabled=false; btn.style.opacity='1';
    btn.innerHTML = mode==='organic'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Search TikTok'
      : '🗺 Find Leads';
  };
  if (attempts>=MAX) {
    if (statusEl) statusEl.innerHTML=_apAlert('Apify timed out — try a smaller result count.','error');
    btnReset(); return;
  }
  setTimeout(async()=>{
    try {
      const url=`/api/apify/run-status?run_id=${encodeURIComponent(runId)}&dataset_id=${encodeURIComponent(datasetId||'')}&limit=${limit||25}`;
      const d=await fetch(url,{credentials:'same-origin'}).then(r=>r.json());
      if (d.error) { if(statusEl) statusEl.innerHTML=_apAlert(d.error,'error'); btnReset(); return; }
      if (d.status==='failed') { if(statusEl) statusEl.innerHTML=_apAlert('Scrape failed: '+(d.error||'unknown'),'error'); btnReset(); return; }
      if (d.status==='pending') {
        if(statusEl) statusEl.innerHTML=_apSpinner(`Still running… attempt ${attempts+1}/${MAX} (${(attempts+1)*8}s elapsed)`);
        window._apPoll(runId,datasetId,mode,btn,statusEl,resEl,attempts+1,query,limit); return;
      }
      if(statusEl) statusEl.innerHTML=_apAlert(`✓ Scraped ${(d.items||[]).length} results`,'success');
      btnReset();
      if (mode==='organic') _renderOrganic(d.items||[],query||'');
      else                  _renderLeads(d.items||[],query||'');
    } catch(e) { if(statusEl) statusEl.innerHTML=_apAlert('Poll error: '+e.message,'error'); btnReset(); }
  },8000);
};

})();
