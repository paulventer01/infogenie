(function igDiag(){
  if (window.IGDiag) return;

  const KEY = 'ig_diag_open';
  const events = [];
  const MAX = 500;
  let panel, list, startedAt = performance.now();

  function fmtMs(ms) {
    if (ms < 1000) return ms.toFixed(0) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }
  function nowRel() { return fmtMs(performance.now() - startedAt); }

  function log(label, detail, kind) {
    const e = {
      t: performance.now(),
      rel: nowRel(),
      wall: new Date().toLocaleTimeString(),
      label: String(label || ''),
      detail: detail == null ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
      kind: kind || 'info'
    };
    events.push(e);
    if (events.length > MAX) events.shift();
    if (list && panel && !panel.classList.contains('hidden')) appendRow(e);
    updateCount();
    // Mirror to console so server-side log fetchers can see the breadcrumb
    // trail too (the in-page panel needs the user to look at it).
    const prefix = '[IGDiag ' + e.rel + ']';
    if (kind === 'error')      console.error(prefix, label, detail || '');
    else if (kind === 'mark')  console.log(prefix + ' ★', label, detail || '');
    else                       console.log(prefix, label, detail || '');
    // Persist to server log via sendBeacon — survives page freezes & refreshes
    // so we can reconstruct the trail of any analyse-flow hang from the
    // workflow log. Fire-and-forget, never throws, never blocks.
    try {
      const payload = JSON.stringify({ rel: e.rel, kind: e.kind, label: e.label, detail: e.detail });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/diag-beacon', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/diag-beacon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(()=>{});
      }
    } catch(_) {}
    return e;
  }
  function reset(label) {
    events.length = 0;
    startedAt = performance.now();
    if (list) list.innerHTML = '';
    log(label || 'Diagnostic reset', null, 'mark');
  }
  function mark(label, detail) { return log(label, detail, 'mark'); }
  function err(label, detail)  { return log(label, detail, 'error'); }

  function appendRow(e) {
    const row = document.createElement('div');
    const c = e.kind === 'error' ? '#FCA5A5' : e.kind === 'mark' ? '#FBBF24' : '#A7F3D0';
    row.style.cssText = 'padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.06);font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.4;color:#E5E7EB;display:grid;grid-template-columns:64px 1fr;gap:8px;align-items:start';
    row.innerHTML =
      '<span style="color:#94A3B8;white-space:nowrap">'+e.rel+'</span>' +
      '<span><span style="color:'+c+';font-weight:700">'+escapeHtml(e.label)+'</span>' +
      (e.detail ? '<span style="color:#CBD5E1;opacity:.85"> · '+escapeHtml(e.detail)+'</span>' : '') +
      '</span>';
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function buildPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'igDiagPanel';
    panel.className = 'hidden';
    panel.style.cssText = 'position:fixed;right:14px;bottom:60px;width:440px;max-width:calc(100vw - 28px);height:380px;background:#0F172A;color:#E5E7EB;border:1px solid #334155;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.5);z-index:2147483646;display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,Segoe UI,sans-serif';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#1E293B;border-bottom:1px solid #334155">' +
        '<div style="font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#7DD3FC">🔧 Diagnostic Log</div>' +
        '<div style="display:flex;gap:6px">' +
          '<button id="igDiagClear" title="Clear" style="background:#334155;color:#E5E7EB;border:none;border-radius:5px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer">Clear</button>' +
          '<button id="igDiagCopy"  title="Copy log to clipboard" style="background:#334155;color:#E5E7EB;border:none;border-radius:5px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer">Copy</button>' +
          '<button id="igDiagClose" title="Close" style="background:#334155;color:#E5E7EB;border:none;border-radius:5px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer">✕</button>' +
        '</div>' +
      '</div>' +
      '<div id="igDiagList" style="flex:1;overflow:auto;background:#0B1220"></div>' +
      '<div style="padding:6px 10px;background:#1E293B;border-top:1px solid #334155;font-size:10px;color:#94A3B8;display:flex;justify-content:space-between"><span>Toggle: <strong>Ctrl+Shift+D</strong></span><span id="igDiagCount">0 events</span></div>';
    document.body.appendChild(panel);
    list = panel.querySelector('#igDiagList');
    panel.querySelector('#igDiagClose').onclick = hide;
    panel.querySelector('#igDiagClear').onclick = () => { events.length = 0; list.innerHTML = ''; startedAt = performance.now(); updateCount(); };
    panel.querySelector('#igDiagCopy').onclick  = () => {
      const txt = events.map(e => '[' + e.rel.padStart(8) + '] ' + e.label + (e.detail ? ' · ' + e.detail : '')).join('\n');
      navigator.clipboard.writeText(txt).then(() => {
        const b = panel.querySelector('#igDiagCopy'); const old = b.textContent;
        b.textContent = '✓ Copied'; setTimeout(() => b.textContent = old, 1200);
      });
    };
    events.forEach(appendRow);
    updateCount();
  }

  function buildToggle() {
    const btn = document.createElement('button');
    btn.id = 'igDiagToggle';
    btn.title = 'Toggle diagnostic log (Ctrl+Shift+D)';
    btn.textContent = '🔧';
    btn.style.cssText = 'position:fixed;right:14px;bottom:14px;width:38px;height:38px;border-radius:50%;background:#0F172A;color:#7DD3FC;border:1px solid #334155;font-size:18px;cursor:pointer;z-index:2147483647;box-shadow:0 6px 18px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center';
    btn.onclick = toggle;
    document.body.appendChild(btn);
  }

  function show() {
    buildPanel();
    // Backfill any events captured while the panel was hidden / not yet built
    if (list) {
      list.innerHTML = '';
      events.forEach(appendRow);
      updateCount();
    }
    panel.classList.remove('hidden');
    panel.style.display = 'flex';
    try { localStorage.setItem(KEY, '1'); } catch(_){}
  }
  function hide() { if (panel) { panel.classList.add('hidden'); panel.style.display = 'none'; } try { localStorage.setItem(KEY, '0'); } catch(_){} }
  function toggle() { if (!panel || panel.classList.contains('hidden')) show(); else hide(); }
  function updateCount() {
    if (!panel) return;
    const el = panel.querySelector('#igDiagCount');
    if (el) el.textContent = events.length + ' events';
  }

  // ── Verbose stage helpers ───────────────────────────────────────────────────
  // stage(name, fn)        sync wrapper: logs start, runs, logs end+duration+DOM-delta
  // asyncStage(name, fn)   same for async functions (awaitable)
  // heartbeat(label)       starts a 250ms tick that logs every 1s while alive
  //                        → if main thread freezes you see the gap in server log
  // domStats()             returns {nodes, listeners?} snapshot
  function domStats() {
    let n = 0;
    try { n = document.getElementsByTagName('*').length; } catch(_) {}
    return { nodes: n };
  }
  function memStats() {
    if (performance && performance.memory) {
      return { usedMB: +(performance.memory.usedJSHeapSize/1048576).toFixed(1) };
    }
    return null;
  }
  function _detailStr(d0, d1) {
    const dn = d1.nodes - d0.nodes;
    const parts = [];
    parts.push('Δnodes=' + (dn >= 0 ? '+' : '') + dn);
    parts.push('total=' + d1.nodes);
    const m1 = memStats();
    if (m1) parts.push('mem=' + m1.usedMB + 'MB');
    return parts.join(' · ');
  }
  function stage(name, fn) {
    const t0 = performance.now();
    const d0 = domStats();
    mark('▶ ' + name);
    let out, threw;
    try { out = fn(); } catch (e) { threw = e; err(name + ' THREW', e && e.message || String(e)); }
    const dt = performance.now() - t0;
    const d1 = domStats();
    const slow = dt > 50 ? ' ⚠SLOW' : '';
    log('◀ ' + name + slow, dt.toFixed(0) + 'ms · ' + _detailStr(d0, d1));
    if (threw) throw threw;
    return out;
  }
  async function asyncStage(name, fn) {
    const t0 = performance.now();
    const d0 = domStats();
    mark('▶ ' + name + ' (async)');
    let out, threw;
    try { out = await fn(); } catch (e) { threw = e; err(name + ' THREW', e && e.message || String(e)); }
    const dt = performance.now() - t0;
    const d1 = domStats();
    const slow = dt > 250 ? ' ⚠SLOW' : '';
    log('◀ ' + name + ' (async)' + slow, dt.toFixed(0) + 'ms · ' + _detailStr(d0, d1));
    if (threw) throw threw;
    return out;
  }
  let _hbTimer = null, _hbLabel = '', _hbStart = 0, _hbN = 0, _hbLast = 0;
  function startHeartbeat(label, periodMs) {
    stopHeartbeat();
    _hbLabel = label || 'heartbeat';
    _hbStart = performance.now();
    _hbLast  = _hbStart;
    _hbN = 0;
    mark('💓 heartbeat start', _hbLabel);
    _hbTimer = setInterval(() => {
      _hbN++;
      const now = performance.now();
      const gap = now - _hbLast;
      _hbLast = now;
      const sec = ((now - _hbStart)/1000).toFixed(1);
      // Flag gaps >500ms (we tick every 250ms) — that's main-thread starvation
      const flag = gap > 500 ? ' ⚠GAP ' + gap.toFixed(0) + 'ms' : '';
      log('💓 ' + _hbLabel + ' #' + _hbN + flag, sec + 's · ' + domStats().nodes + ' nodes');
    }, periodMs || 250);
  }
  function stopHeartbeat() {
    if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; mark('💓 heartbeat stop', _hbLabel); }
  }

  window.IGDiag = { log, mark, err, reset, show, hide, toggle, events,
                    stage, asyncStage, startHeartbeat, stopHeartbeat,
                    domStats, memStats };

  function init() {
    buildToggle();
    try {
      if (localStorage.getItem(KEY) === '1') show();
    } catch(_){}
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault(); toggle();
      }
    });
    // Capture unhandled errors automatically
    window.addEventListener('error', (ev) => err('window error', (ev.message || '') + ' @ ' + (ev.filename || '') + ':' + (ev.lineno || '')));
    window.addEventListener('unhandledrejection', (ev) => err('unhandled rejection', String(ev.reason && (ev.reason.message || ev.reason) || 'unknown')));
    log('Diagnostic ready', 'Press Ctrl+Shift+D or click 🔧 to toggle', 'mark');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
