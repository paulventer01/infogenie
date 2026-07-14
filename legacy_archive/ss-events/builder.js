  // ═══════════════════════════════════════════════════════════════════════════
  // T105 — SERVER-SIDE EVENT MANAGER
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildSsEvents = async function () {
    const el = document.getElementById('view-ss-events');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>📡 Server-Side Event Manager</h1><p>Collect and attribute conversion events from any source — web, mobile, phone calls, offline sales — without browser restrictions.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="sse-report">Attribution Report</button><button class="ig-tab" data-tab="sse-sources">Event Sources</button><button class="ig-tab" data-tab="sse-ingest">Ingest Event</button></div>
<div id="sse-report" class="ig-tab-panel"><div id="sse-report-content"><div class="ig-spinner">Loading…</div></div></div>
<div id="sse-sources" class="ig-tab-panel hidden">
  <div class="ig-toolbar"><button class="btn btn-primary" id="sse-add-src">+ Add Event Source</button></div>
  <div id="sse-src-list"><div class="ig-spinner">Loading…</div></div>
</div>
<div id="sse-ingest" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:500px">
    <h3>Manual Event Ingest</h3>
    <label>Event Name<input type="text" id="sse-ev-name" class="ig-input" placeholder="purchase / phone_call / demo_request"></label>
    <label>Value ($)<input type="number" id="sse-ev-value" class="ig-input" placeholder="250"></label>
    <label>Email (will be hashed)<input type="email" id="sse-ev-email" class="ig-input" placeholder="customer@example.com"></label>
    <label>Click ID (fbclid / gclid)<input type="text" id="sse-ev-clid" class="ig-input" placeholder="optional"></label>
    <button class="btn btn-primary" id="sse-ingest-btn">Ingest Event</button>
    <div id="sse-ingest-result" style="margin-top:10px"></div>
  </div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'sse-sources') loadSources();
    }));

    async function loadReport() {
      const d = await _api('/api/ss-events/report?days=30');
      const c = el.querySelector('#sse-report-content');
      if (!d.ok) { c.innerHTML = '<div class="ig-empty">No events yet. Add an event source and start ingesting.</div>'; return; }
      c.innerHTML = `<div class="ig-stats-row">
        <div class="ig-stat"><div class="ig-stat-val">${(d.totals.events || 0).toLocaleString()}</div><div class="ig-stat-label">Total Events (30d)</div></div>
        <div class="ig-stat"><div class="ig-stat-val">$${(d.totals.revenue || 0).toLocaleString()}</div><div class="ig-stat-label">Revenue Tracked</div></div>
        <div class="ig-stat"><div class="ig-stat-val">${d.by_source.length}</div><div class="ig-stat-label">Active Sources</div></div>
      </div>
      <div class="ig-two-col" style="margin-top:20px">
        <div><h4>By Event Type</h4><table class="ig-table"><thead><tr><th>Event</th><th>Count</th><th>Revenue</th></tr></thead><tbody>
          ${(d.by_event || []).map(e => `<tr><td><code>${_esc(e.event_name)}</code></td><td>${e.n}</td><td>${e.revenue ? '$' + (+e.revenue).toFixed(2) : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <div><h4>By Source</h4><table class="ig-table"><thead><tr><th>Source</th><th>Events</th></tr></thead><tbody>
          ${(d.by_source || []).map(s => `<tr><td>${_esc(s.source_name)}</td><td>${s.n}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    }

    async function loadSources() {
      const d = await _api('/api/ss-events/sources');
      const c = el.querySelector('#sse-src-list');
      if (!d.ok || !d.sources.length) { c.innerHTML = '<div class="ig-empty">No event sources yet. Add one to get an ingest URL.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Name</th><th>Type</th><th>Events</th><th>Ingest URL</th><th>Last Event</th><th></th></tr></thead><tbody>` +
        d.sources.map(s => `<tr><td>${_esc(s.source_name)}</td><td><span class="badge badge-info">${_esc(s.source_type)}</span></td><td>${s.event_count}</td><td><code style="font-size:.78rem">/api/ss-events/ingest/${_esc(s.ingest_token)}</code></td><td>${_ts(s.last_event_at)}</td><td><button class="btn btn-sm btn-danger" data-del="${s.id}">Del</button></td></tr>`).join('') +
        '</tbody></table>';
      c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await _api('/api/ss-events/sources/' + b.dataset.del, { method: 'DELETE' }); loadSources(); }));
    }

    el.querySelector('#sse-add-src').addEventListener('click', () => {
      const name = prompt('Source name (e.g. "Shopify checkout"):'); if (!name) return;
      const type = prompt('Source type (web / mobile / offline / crm / phone / pos):') || 'web';
      _api('/api/ss-events/sources/add', { method: 'POST', body: JSON.stringify({ source_name: name, source_type: type }) }).then(d => {
        if (d.ok) { alert(`Source created!\nIngest URL: /api/ss-events/ingest/${d.source.ingest_token}\nPOST JSON events to this URL.`); loadSources(); }
      });
    });

    el.querySelector('#sse-ingest-btn').addEventListener('click', async () => {
      const d = await _api('/api/ss-events/ingest', { method: 'POST', body: JSON.stringify({ events: [{ event_name: el.querySelector('#sse-ev-name').value, value: +el.querySelector('#sse-ev-value').value || null, email: el.querySelector('#sse-ev-email').value, fbclid: el.querySelector('#sse-ev-clid').value || null }] }) });
      el.querySelector('#sse-ingest-result').innerHTML = d.ok ? `<div class="ig-alert ig-alert-success">✅ ${d.ingested} event ingested</div>` : `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`;
      if (d.ok) loadReport();
    });

    loadReport();
  };

