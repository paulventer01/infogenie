/* ig_brand24_suite.js — Brand Intelligence Suite (10 features)
   Builders: reputationScore · presenceScore · ave · anomalyDetector ·
             intentRadar · hashtagTracker · influenceScore · projectCompare ·
             geoInsights · ugcDiscovery
   Loaded after app.js. Follows the standard no-arg builder pattern:
   each function looks up its own wrap div by ID. */

(function () {
  'use strict';

  /* ── Shared helpers ─────────────────────────────────────────────────────── */
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _fmtMoney(n) { return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function _fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }
  function _pill(label, cls) { return '<span class="badge bg-' + _esc(cls) + '">' + _esc(label) + '</span>'; }
  function _sentColor(s) { return s === 'positive' ? 'success' : s === 'negative' ? 'danger' : 'secondary'; }
  function _sevColor(s) { return s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'info' : 'secondary'; }

  async function _post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
    return r.json();
  }
  async function _get(path) {
    const r = await fetch(path, { credentials: 'same-origin' });
    return r.json();
  }

  function _spinner() { return '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted">Analysing with AI…</p></div>'; }
  function _empty(msg) { return '<div class="text-center py-5 text-muted"><p>' + _esc(msg) + '</p></div>'; }

  function _scoreGauge(score, label) {
    const color = score >= 70 ? '#22c55e' : score >= 45 ? '#f59e0b' : '#ef4444';
    const circ = 2 * Math.PI * 66;
    const off = circ * (1 - Math.min(100, Math.max(0, score)) / 100);
    return '<div class="text-center mb-4"><svg width="160" height="160" viewBox="0 0 160 160">' +
      '<circle cx="80" cy="80" r="66" fill="none" stroke="#e5e7eb" stroke-width="14"/>' +
      '<circle cx="80" cy="80" r="66" fill="none" stroke="' + color + '" stroke-width="14" stroke-dasharray="' + circ + '" stroke-dashoffset="' + off + '" stroke-linecap="round" transform="rotate(-90 80 80)"/>' +
      '<text x="80" y="76" text-anchor="middle" font-size="34" font-weight="700" fill="' + color + '">' + Math.round(score) + '</text>' +
      '<text x="80" y="98" text-anchor="middle" font-size="13" fill="#6b7280">/ 100</text>' +
      '</svg><div class="fw-semibold">' + _esc(label) + '</div></div>';
  }

  function _bar(label, val, max) {
    max = max || 100;
    const pct = Math.min(100, Math.round((val / max) * 100));
    const col = pct >= 70 ? '#22c55e' : pct >= 45 ? '#f59e0b' : '#ef4444';
    return '<div class="mb-3"><div class="d-flex justify-content-between mb-1 small"><span>' + _esc(label) + '</span><strong>' + pct + (max === 100 ? '' : '') + '</strong></div>' +
      '<div class="progress" style="height:8px"><div class="progress-bar" style="width:' + pct + '%;background:' + col + '"></div></div></div>';
  }

  function _tbl(rows, cols) {
    if (!rows || !rows.length) return _empty('No history yet — run your first analysis above.');
    return '<div class="table-responsive"><table class="table table-sm table-hover mb-0"><thead><tr>' +
      cols.map(c => '<th class="small">' + _esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + cols.map(c => '<td class="small">' + (c.fn ? c.fn(r) : _esc(String(r[c.key] ?? ''))) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     1. REPUTATION SCORE
  ───────────────────────────────────────────────────────────────────────── */
  window.buildReputationScore = async function () {
    const wrap = document.getElementById('reputationScoreWrap');
    if (!wrap) return;
    wrap.innerHTML = _spinner();
    const hist = await _get('/api/reputation-score/history').catch(() => ({ rows: [] }));
    const latest = hist.rows && hist.rows[0];

    wrap.innerHTML = `<div class="row g-4">
      <div class="col-12 col-lg-6">
        <div class="card mb-4"><div class="card-body">
          <h5 class="card-title">Calculate Reputation Score</h5>
          <p class="text-muted small">Aggregates your Crisis Radar sentiment, Share of Voice, and crisis incident data into a single brand health number.</p>
          <label class="form-label fw-semibold">Brand Name</label>
          <input id="rs-brand" class="form-control mb-3" placeholder="e.g. Notion" value="${latest ? _esc(latest.brand) : ''}">
          <button id="rs-run" class="btn btn-primary w-100">⭐ Calculate Score</button>
        </div></div>
        <div id="rs-result"></div>
      </div>
      <div class="col-12 col-lg-6"><div class="card"><div class="card-body">
        <h5 class="card-title">History</h5>
        <div id="rs-hist">${_tbl(hist.rows, [
          { label: 'Brand', key: 'brand' },
          { label: 'Score', fn: r => '<strong style="color:' + (r.overall_score >= 70 ? '#22c55e' : r.overall_score >= 45 ? '#f59e0b' : '#ef4444') + '">' + r.overall_score + '</strong>' },
          { label: 'Grade', fn: r => _pill(r.grade, r.grade === 'A' ? 'success' : r.grade === 'B' ? 'info' : r.grade === 'C' ? 'warning' : 'danger') },
          { label: 'Trend', fn: r => r.trend === 'up' ? '📈' : r.trend === 'down' ? '📉' : '→' },
          { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
        ])}</div>
      </div></div></div>
    </div>`;

    document.getElementById('rs-run').addEventListener('click', async () => {
      const brand = document.getElementById('rs-brand').value.trim();
      if (!brand) return;
      const rd = document.getElementById('rs-result');
      rd.innerHTML = _spinner();
      document.getElementById('rs-run').disabled = true;
      const d = await _post('/api/reputation-score/calculate', { brand }).catch(e => ({ ok: false, error: e.message }));
      document.getElementById('rs-run').disabled = false;
      if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
      rd.innerHTML = '<div class="card"><div class="card-body">' + _scoreGauge(d.overall_score, 'Reputation Score') +
        '<div class="text-center mb-3">' + _pill(d.grade, d.grade === 'A' ? 'success' : d.grade === 'B' ? 'info' : d.grade === 'C' ? 'warning' : 'danger') +
        ' <span class="small text-muted ms-1">Trend: ' + (d.trend === 'up' ? '📈 Improving' : d.trend === 'down' ? '📉 Declining' : '→ Stable') + '</span></div>' +
        _bar('Sentiment', d.sentiment_score) + _bar('Volume Trend', d.volume_score) +
        _bar('Share of Voice', d.sov_score) + _bar('Crisis Health', d.crisis_score) + _bar('Reach', d.reach_score) +
        (d.summary ? '<p class="small text-muted mt-3">' + _esc(d.summary.slice(0, 400)) + '</p>' : '') +
        (d.recommendations && d.recommendations.length ? '<h6 class="mt-3">Recommendations</h6><ul class="small">' + d.recommendations.map(r => '<li>' + _esc(r) + '</li>').join('') + '</ul>' : '') +
        '</div></div>';
      const h2 = await _get('/api/reputation-score/history').catch(() => ({ rows: [] }));
      document.getElementById('rs-hist').innerHTML = _tbl(h2.rows, [
        { label: 'Brand', key: 'brand' },
        { label: 'Score', fn: r => '<strong>' + r.overall_score + '</strong>' },
        { label: 'Grade', fn: r => _pill(r.grade, r.grade === 'A' ? 'success' : 'warning') },
        { label: 'Trend', fn: r => r.trend === 'up' ? '📈' : r.trend === 'down' ? '📉' : '→' },
        { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
      ]);
    });
  };

  /* ─────────────────────────────────────────────────────────────────────────
     2. PRESENCE SCORE
  ───────────────────────────────────────────────────────────────────────── */
  window.buildPresenceScore = async function () {
    const wrap = document.getElementById('presenceScoreWrap');
    if (!wrap) return;
    wrap.innerHTML = _spinner();
    const hist = await _get('/api/presence-score/history').catch(() => ({ rows: [] }));

    wrap.innerHTML = `<div class="row g-4">
      <div class="col-12 col-lg-5">
        <div class="card mb-4"><div class="card-body">
          <h5 class="card-title">Calculate Presence Score</h5>
          <label class="form-label fw-semibold">Brand Name</label>
          <input id="ps-brand" class="form-control mb-3" placeholder="e.g. HubSpot">
          <label class="form-label fw-semibold">Competitors (optional)</label>
          <input id="ps-comps" class="form-control mb-3" placeholder="Salesforce, Pipedrive">
          <button id="ps-run" class="btn btn-primary w-100">📡 Calculate Presence</button>
        </div></div>
        <div id="ps-result"></div>
      </div>
      <div class="col-12 col-lg-7"><div class="card"><div class="card-body">
        <h5 class="card-title">History</h5>
        <div id="ps-hist">${_tbl(hist.rows, [
          { label: 'Brand', key: 'brand' },
          { label: 'Score', fn: r => '<strong>' + r.overall_score + '/100</strong>' },
          { label: 'Search', key: 'search_presence' },
          { label: 'Social', key: 'social_presence' },
          { label: 'News', key: 'news_presence' },
          { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
        ])}</div>
      </div></div></div>
    </div>`;

    document.getElementById('ps-run').addEventListener('click', async () => {
      const brand = document.getElementById('ps-brand').value.trim();
      if (!brand) return;
      const competitors = document.getElementById('ps-comps').value.split(',').map(s => s.trim()).filter(Boolean);
      const rd = document.getElementById('ps-result');
      rd.innerHTML = _spinner();
      document.getElementById('ps-run').disabled = true;
      const d = await _post('/api/presence-score/calculate', { brand, competitors }).catch(e => ({ ok: false, error: e.message }));
      document.getElementById('ps-run').disabled = false;
      if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
      rd.innerHTML = '<div class="card"><div class="card-body">' + _scoreGauge(d.overall_score, 'Presence Score') +
        _bar('Search Presence', d.search_presence) + _bar('Social Media', d.social_presence) +
        _bar('News Coverage', d.news_presence) + _bar('Community', d.community_presence) + _bar('Influencer', d.influencer_presence) +
        (d.insights && d.insights.length ? '<h6 class="mt-3">Insights</h6><ul class="small">' + d.insights.map(i => '<li>' + _esc(i) + '</li>').join('') + '</ul>' : '') +
        (d.vs_competitors && d.vs_competitors.length ? '<h6 class="mt-3">vs Competitors</h6>' + d.vs_competitors.map(c => '<div class="d-flex justify-content-between small py-1 border-bottom"><span>' + _esc(c.brand) + '</span><strong>' + c.overall_score + '</strong></div>').join('') : '') +
        '</div></div>';
      const h2 = await _get('/api/presence-score/history').catch(() => ({ rows: [] }));
      document.getElementById('ps-hist').innerHTML = _tbl(h2.rows, [
        { label: 'Brand', key: 'brand' },
        { label: 'Score', fn: r => r.overall_score + '/100' },
        { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
      ]);
    });
  };

  /* ─────────────────────────────────────────────────────────────────────────
     3. AVE
  ───────────────────────────────────────────────────────────────────────── */
  window.buildAve = async function () {
    const wrap = document.getElementById('aveWrap');
    if (!wrap) return;
    wrap.innerHTML = _spinner();
    const hist = await _get('/api/ave/history').catch(() => ({ rows: [] }));

    wrap.innerHTML = `<div class="row g-4">
      <div class="col-12 col-lg-5">
        <div class="card mb-4"><div class="card-body">
          <h5 class="card-title">Calculate Media Value</h5>
          <label class="form-label fw-semibold">Brand Name</label>
          <input id="ave-brand" class="form-control mb-3" placeholder="e.g. Stripe">
          <label class="form-label fw-semibold">Period</label>
          <select id="ave-period" class="form-select mb-3">
            <option value="7d">Last 7 days</option>
            <option value="30d" selected>Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <label class="form-label fw-semibold">Industry</label>
          <input id="ave-ind" class="form-control mb-3" placeholder="e.g. fintech" value="technology">
          <button id="ave-run" class="btn btn-primary w-100">💵 Calculate AVE</button>
        </div></div>
        <div id="ave-result"></div>
      </div>
      <div class="col-12 col-lg-7"><div class="card"><div class="card-body">
        <h5 class="card-title">History</h5>
        <div id="ave-hist">${_tbl(hist.rows, [
          { label: 'Brand', key: 'brand' },
          { label: 'Period', key: 'period' },
          { label: 'Total AVE', fn: r => '<strong>' + _fmtMoney(r.total_ave_usd) + '</strong>' },
          { label: 'Mentions', fn: r => _fmtNum(r.total_mentions) },
          { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
        ])}</div>
      </div></div></div>
    </div>`;

    document.getElementById('ave-run').addEventListener('click', async () => {
      const brand = document.getElementById('ave-brand').value.trim();
      if (!brand) return;
      const period = document.getElementById('ave-period').value;
      const industry = document.getElementById('ave-ind').value.trim() || 'technology';
      const rd = document.getElementById('ave-result');
      rd.innerHTML = _spinner();
      document.getElementById('ave-run').disabled = true;
      const d = await _post('/api/ave/calculate', { brand, period, industry }).catch(e => ({ ok: false, error: e.message }));
      document.getElementById('ave-run').disabled = false;
      if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
      const chs = d.channels || {};
      rd.innerHTML = '<div class="card"><div class="card-body">' +
        '<div class="text-center mb-4"><div style="font-size:2.6rem;font-weight:700;color:#22c55e">' + _fmtMoney(d.total_ave_usd) + '</div>' +
        '<div class="text-muted small">Advertising Value Equivalent — ' + _fmtNum(d.total_mentions) + ' media mentions</div></div>' +
        '<h6>By Channel</h6>' +
        Object.entries(chs).map(([ch, v]) =>
          '<div class="d-flex justify-content-between align-items-center py-2 border-bottom small">' +
          '<span class="text-capitalize">' + _esc(ch.replace(/_/g, ' ')) + '</span>' +
          '<span>' + (v.mentions || 0) + ' mentions → <strong>' + _fmtMoney(v.ave_usd) + '</strong></span></div>').join('') +
        (d.methodology ? '<p class="small text-muted mt-3">' + _esc(d.methodology) + '</p>' : '') +
        '</div></div>';
      const h2 = await _get('/api/ave/history').catch(() => ({ rows: [] }));
      document.getElementById('ave-hist').innerHTML = _tbl(h2.rows, [
        { label: 'Brand', key: 'brand' },
        { label: 'AVE', fn: r => _fmtMoney(r.total_ave_usd) },
        { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
      ]);
    });
  };

  /* ─────────────────────────────────────────────────────────────────────────
     4. AI ANOMALY DETECTOR
  ───────────────────────────────────────────────────────────────────────── */
  window.buildAnomalyDetector = async function () {
    const wrap = document.getElementById('anomalyDetectorWrap');
    if (!wrap) return;
    wrap.innerHTML = _spinner();
    const hist = await _get('/api/anomaly-detector/history').catch(() => ({ rows: [] }));
    const openRows = (hist.rows || []).filter(r => r.severity !== 'none' && !r.resolved);

    wrap.innerHTML = `<div class="row g-4">
      <div class="col-12 col-lg-5">
        <div class="card mb-4"><div class="card-body">
          <h5 class="card-title">Scan for Anomalies</h5>
          <p class="small text-muted">Uses your Crisis Radar data to detect statistical spikes — AI explains what caused it.</p>
          <label class="form-label fw-semibold">Brand Name</label>
          <input id="ad-brand" class="form-control mb-3" placeholder="e.g. Acme Corp">
          <button id="ad-run" class="btn btn-primary w-100">🔍 Scan Now</button>
        </div></div>
        <div id="ad-result"></div>
      </div>
      <div class="col-12 col-lg-7">
        ${openRows.length ? '<div class="alert alert-warning mb-3"><strong>' + openRows.length + ' open anomal' + (openRows.length > 1 ? 'ies' : 'y') + ' detected</strong></div>' : ''}
        <div class="card"><div class="card-body">
          <h5 class="card-title">Detection History</h5>
          <div id="ad-hist">${_tbl((hist.rows || []).filter(r => r.severity !== 'none'), [
            { label: 'Brand', key: 'brand' },
            { label: 'Type', fn: r => _esc((r.anomaly_type || '').replace(/_/g, ' ')) },
            { label: 'Severity', fn: r => _pill(r.severity, _sevColor(r.severity)) },
            { label: 'Spike', fn: r => (r.spike_factor || 1) + 'x' },
            { label: 'Status', fn: r => r.resolved ? _pill('Resolved', 'success') : '<button class="btn btn-xs btn-outline-success btn-sm" onclick="window._adResolve(' + r.id + ')">Resolve</button>' },
            { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
          ])}</div>
        </div></div>
      </div>
    </div>`;

    async function _refreshHist() {
      const h = await _get('/api/anomaly-detector/history').catch(() => ({ rows: [] }));
      document.getElementById('ad-hist').innerHTML = _tbl((h.rows || []).filter(r => r.severity !== 'none'), [
        { label: 'Brand', key: 'brand' },
        { label: 'Type', fn: r => _esc((r.anomaly_type || '').replace(/_/g, ' ')) },
        { label: 'Severity', fn: r => _pill(r.severity, _sevColor(r.severity)) },
        { label: 'Spike', fn: r => (r.spike_factor || 1) + 'x' },
        { label: 'Status', fn: r => r.resolved ? _pill('Resolved', 'success') : '<button class="btn btn-xs btn-outline-success btn-sm" onclick="window._adResolve(' + r.id + ')">Resolve</button>' },
        { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
      ]);
    }

    window._adResolve = async (id) => {
      await fetch('/api/anomaly-detector/' + id + '/resolve', { method: 'PATCH', credentials: 'same-origin' });
      _refreshHist();
    };

    document.getElementById('ad-run').addEventListener('click', async () => {
      const brand = document.getElementById('ad-brand').value.trim();
      if (!brand) return;
      const rd = document.getElementById('ad-result');
      rd.innerHTML = _spinner();
      document.getElementById('ad-run').disabled = true;
      const d = await _post('/api/anomaly-detector/scan', { brand }).catch(e => ({ ok: false, error: e.message }));
      document.getElementById('ad-run').disabled = false;
      if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
      const sev = d.severity || 'none';
      const sevCls = { critical: 'danger', high: 'warning', medium: 'info', none: 'success' }[sev] || 'secondary';
      rd.innerHTML = '<div class="card"><div class="card-body">' +
        '<div class="mb-3">' + _pill(sev === 'none' ? '✅ All Clear' : sev.toUpperCase(), sevCls) +
        (sev !== 'none' ? ' <span class="small ms-2">' + _pill((d.anomaly_type || '').replace(/_/g, ' '), 'light') + '</span>' : '') + '</div>' +
        (sev !== 'none' ? '<div class="small mb-2"><strong>Spike factor:</strong> ' + (d.spike_factor || 1) + '× baseline</div>' : '') +
        '<p class="small">' + _esc(d.ai_explanation) + '</p>' +
        (d.recommended_action ? '<div class="alert alert-light small mt-2"><strong>Action:</strong> ' + _esc(d.recommended_action) + '</div>' : '') +
        (d.affected_channels && d.affected_channels.length ? '<div class="small text-muted">Channels flagged: ' + d.affected_channels.join(', ') + '</div>' : '') +
        '</div></div>';
      _refreshHist();
    });
  };

  /* ─────────────────────────────────────────────────────────────────────────
     5. INTENT RADAR
  ───────────────────────────────────────────────────────────────────────── */
  window.buildIntentRadar = async function () {
    const wrap = document.getElementById('intentRadarWrap');
    if (!wrap) return;
    wrap.innerHTML = _spinner();
    const hist = await _get('/api/intent-radar/history').catch(() => ({ rows: [] }));

    wrap.innerHTML = `<div class="row g-4">
      <div class="col-12 col-lg-5">
        <div class="card mb-4"><div class="card-body">
          <h5 class="card-title">Scan Intent Signals</h5>
          <p class="small text-muted">Scans online forums, Reddit, and social media to find people actively researching or about to buy.</p>
          <label class="form-label fw-semibold">Your Brand</label>
          <input id="ir-brand" class="form-control mb-3" placeholder="e.g. Notion">
          <label class="form-label fw-semibold">Competitors (optional)</label>
          <input id="ir-comps" class="form-control mb-3" placeholder="Obsidian, Roam Research">
          <button id="ir-run" class="btn btn-primary w-100">🎯 Scan Intent Signals</button>
        </div></div>
        <div id="ir-result"></div>
      </div>
      <div class="col-12 col-lg-7"><div class="card"><div class="card-body">
        <h5 class="card-title">History</h5>
        <div id="ir-hist">${_tbl(hist.rows, [
          { label: 'Brand', key: 'brand' },
          { label: 'Signals', key: 'total_signals' },
          { label: 'Ready to Buy', fn: r => '<strong class="text-success">' + r.ready_to_buy + '</strong>' },
          { label: 'Comparing', key: 'comparing' },
          { label: 'At Risk', fn: r => '<span class="text-danger">' + r.churned + '</span>' },
          { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
        ])}</div>
      </div></div></div>
    </div>`;

    document.getElementById('ir-run').addEventListener('click', async () => {
      const brand = document.getElementById('ir-brand').value.trim();
      if (!brand) return;
      const competitors = document.getElementById('ir-comps').value.split(',').map(s => s.trim()).filter(Boolean);
      const rd = document.getElementById('ir-result');
      rd.innerHTML = _spinner();
      document.getElementById('ir-run').disabled = true;
      const d = await _post('/api/intent-radar/scan', { brand, competitors }).catch(e => ({ ok: false, error: e.message }));
      document.getElementById('ir-run').disabled = false;
      if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
      rd.innerHTML = '<div class="card"><div class="card-body">' +
        '<div class="small mb-3"><strong>' + (d.total_signals || 0) + '</strong> intent signals found</div>' +
        _bar('Early Research', d.early_research || 0, Math.max(1, d.total_signals)) +
        _bar('Comparing Options', d.comparing || 0, Math.max(1, d.total_signals)) +
        _bar('Ready to Buy', d.ready_to_buy || 0, Math.max(1, d.total_signals)) +
        _bar('At Risk / Churning', d.churned || 0, Math.max(1, d.total_signals)) +
        (d.top_opportunity ? '<div class="alert alert-info mt-3 small"><strong>Top Opportunity:</strong> ' + _esc(d.top_opportunity) + '</div>' : '') +
        (d.signals && d.signals.length ? '<h6 class="mt-3">Signal Feed</h6>' +
          d.signals.slice(0, 5).map(s => '<div class="border rounded p-2 mb-2 small">' +
            _pill((s.intent_stage || '').replace(/_/g, ' '), s.intent_stage === 'ready_to_buy' ? 'success' : s.intent_stage === 'churned' ? 'danger' : 'warning') + ' ' +
            _pill(s.platform || '', 'secondary') +
            '<p class="mt-1 mb-0">' + _esc(s.excerpt || '') + '</p>' +
            (s.opportunity ? '<em class="text-muted">' + _esc(s.opportunity) + '</em>' : '') + '</div>').join('') : '') +
        '</div></div>';
      const h2 = await _get('/api/intent-radar/history').catch(() => ({ rows: [] }));
      document.getElementById('ir-hist').innerHTML = _tbl(h2.rows, [
        { label: 'Brand', key: 'brand' },
        { label: 'Signals', key: 'total_signals' },
        { label: 'Ready', fn: r => r.ready_to_buy },
        { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
      ]);
    });
  };

  /* ─────────────────────────────────────────────────────────────────────────
     6. HASHTAG TRACKER
  ───────────────────────────────────────────────────────────────────────── */
  window.buildHashtagTracker = async function () {
    const wrap = document.getElementById('hashtagTrackerWrap');
    if (!wrap) return;

    async function _render() {
      const watches = await _get('/api/hashtag-tracker/watches').catch(() => ({ rows: [] }));
      const rows = watches.rows || [];
      wrap.innerHTML = `<div class="row g-4">
        <div class="col-12 col-lg-4">
          <div class="card mb-4"><div class="card-body">
            <h5 class="card-title">Track a Hashtag</h5>
            <label class="form-label fw-semibold">Hashtag (without #)</label>
            <input id="ht-tag" class="form-control mb-3" placeholder="e.g. buildinpublic">
            <label class="form-label fw-semibold small">Platforms</label>
            <div class="d-flex gap-3 mb-3 small">
              <label><input type="checkbox" id="ht-tw" checked> Twitter/X</label>
              <label><input type="checkbox" id="ht-ig" checked> Instagram</label>
              <label><input type="checkbox" id="ht-tt" checked> TikTok</label>
            </div>
            <button id="ht-add" class="btn btn-outline-primary w-100">+ Add to Watchlist</button>
          </div></div>
          <div class="card"><div class="card-body">
            <h5 class="card-title">Watchlist</h5>
            <div id="ht-list">${rows.length ? rows.map(w =>
              '<div class="d-flex justify-content-between align-items-center py-2 border-bottom">' +
              '<div><strong>#' + _esc(w.hashtag) + '</strong><br><span class="small text-muted">' + (w.platforms || []).join(', ') + '</span></div>' +
              '<div class="d-flex gap-1">' +
              '<button class="btn btn-sm btn-primary" onclick="window._htScan(' + w.id + ')">Scan</button>' +
              '<button class="btn btn-sm btn-outline-danger" onclick="window._htDel(' + w.id + ')">×</button>' +
              '</div></div>').join('') : '<p class="small text-muted">No hashtags tracked yet.</p>'}</div>
          </div></div>
        </div>
        <div class="col-12 col-lg-8">
          <div class="card"><div class="card-body">
            <h5 class="card-title">Latest Scan</h5>
            <div id="ht-result">${_empty('Select a hashtag and click Scan.')}</div>
          </div></div>
        </div>
      </div>`;

      document.getElementById('ht-add').addEventListener('click', async () => {
        const tag = document.getElementById('ht-tag').value.trim();
        if (!tag) return;
        const platforms = [];
        if (document.getElementById('ht-tw').checked) platforms.push('twitter');
        if (document.getElementById('ht-ig').checked) platforms.push('instagram');
        if (document.getElementById('ht-tt').checked) platforms.push('tiktok');
        await _post('/api/hashtag-tracker/watches', { hashtag: tag, platforms });
        _render();
      });

      window._htDel = async (id) => {
        await fetch('/api/hashtag-tracker/watches/' + id, { method: 'DELETE', credentials: 'same-origin' });
        _render();
      };

      window._htScan = async (id) => {
        const rd = document.getElementById('ht-result');
        rd.innerHTML = _spinner();
        const d = await _post('/api/hashtag-tracker/scan/' + id, {}).catch(e => ({ ok: false, error: e.message }));
        if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
        const velCls = d.velocity === 'rising' ? 'success' : d.velocity === 'falling' ? 'danger' : 'secondary';
        rd.innerHTML = '<h5>#' + _esc(d.hashtag) + ' ' + _pill(d.velocity || 'stable', velCls) + '</h5>' +
          '<div class="row g-3 mb-4">' +
          '<div class="col-4"><div class="card text-center p-3"><div style="font-size:1.6rem;font-weight:700">' + _fmtNum(d.total_posts) + '</div><div class="small text-muted">Posts</div></div></div>' +
          '<div class="col-4"><div class="card text-center p-3"><div style="font-size:1.6rem;font-weight:700">' + _fmtNum(d.estimated_reach) + '</div><div class="small text-muted">Est. Reach</div></div></div>' +
          '<div class="col-4"><div class="card text-center p-3"><div style="font-size:1.1rem;font-weight:700"><span class="text-success">' + (d.sentiment_pos || 0) + '%</span> / <span class="text-danger">' + (d.sentiment_neg || 0) + '%</span></div><div class="small text-muted">+/−</div></div></div>' +
          '</div>' +
          (d.top_influencers && d.top_influencers.length ? '<h6>Top Influencers</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Account</th><th>Platform</th><th>Followers</th><th>Engagement</th></tr></thead><tbody>' +
            d.top_influencers.map(i => '<tr><td>@' + _esc(i.username || '') + '</td><td>' + _esc(i.platform || '') + '</td><td>' + _fmtNum(i.followers) + '</td><td>' + _esc(i.engagement_rate || '') + '</td></tr>').join('') + '</tbody></table></div>' : '') +
          (d.top_posts && d.top_posts.length ? '<h6 class="mt-3">Top Posts</h6>' + d.top_posts.slice(0, 4).map(p => '<div class="border rounded p-2 mb-2 small"><strong>' + _esc(p.author || '') + '</strong> · ' + _esc(p.platform || '') + '<br>' + _esc(p.text || '') + '</div>').join('') : '');
      };
    }
    _render();
  };

  /* ─────────────────────────────────────────────────────────────────────────
     7. INFLUENCE SCORE
  ───────────────────────────────────────────────────────────────────────── */
  window.buildInfluenceScore = async function () {
    const wrap = document.getElementById('influenceScoreWrap');
    if (!wrap) return;
    wrap.innerHTML = _spinner();
    const hist = await _get('/api/influence-score/history').catch(() => ({ rows: [] }));

    wrap.innerHTML = `<div class="row g-4">
      <div class="col-12 col-lg-5">
        <div class="card mb-4"><div class="card-body">
          <h5 class="card-title">Score Mention Sources</h5>
          <p class="small text-muted">Ranks every source mentioning your brand by authority, follower count, and engagement.</p>
          <label class="form-label fw-semibold">Brand Name</label>
          <input id="isc-brand" class="form-control mb-3" placeholder="e.g. Linear">
          <button id="isc-run" class="btn btn-primary w-100">🏆 Score Sources</button>
        </div></div>
        <div id="isc-result"></div>
      </div>
      <div class="col-12 col-lg-7"><div class="card"><div class="card-body">
        <h5 class="card-title">History</h5>
        <div id="isc-hist">${_tbl(hist.rows, [
          { label: 'Brand', key: 'brand' },
          { label: 'Top Source', key: 'top_source' },
          { label: 'Score', fn: r => '<strong>' + r.top_source_score + '/100</strong>' },
          { label: 'Total Reach', fn: r => _fmtNum(r.total_potential_reach) },
          { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
        ])}</div>
      </div></div></div>
    </div>`;

    document.getElementById('isc-run').addEventListener('click', async () => {
      const brand = document.getElementById('isc-brand').value.trim();
      if (!brand) return;
      const rd = document.getElementById('isc-result');
      rd.innerHTML = _spinner();
      document.getElementById('isc-run').disabled = true;
      const d = await _post('/api/influence-score/analyse', { brand }).catch(e => ({ ok: false, error: e.message }));
      document.getElementById('isc-run').disabled = false;
      if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
      rd.innerHTML = '<div class="card"><div class="card-body">' +
        '<div class="small mb-2"><strong>Total potential reach: </strong>' + _fmtNum(d.total_potential_reach) + '</div>' +
        (d.insight ? '<p class="small text-muted mb-3">' + _esc(d.insight) + '</p>' : '') +
        '<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Source</th><th>Type</th><th>Score</th><th>Reach</th></tr></thead><tbody>' +
        (d.sources || []).sort((a, b) => (b.influence_score || 0) - (a.influence_score || 0)).map(s =>
          '<tr><td><strong>' + _esc(s.name || '') + '</strong><br><span class="small text-muted">' + _esc(s.platform || '') + '</span></td>' +
          '<td>' + _pill(s.type || '', 'secondary') + '</td>' +
          '<td><div class="d-flex align-items-center gap-2 small"><div class="progress flex-grow-1" style="height:6px;min-width:50px"><div class="progress-bar bg-primary" style="width:' + (s.influence_score || 0) + '%"></div></div><strong>' + (s.influence_score || 0) + '</strong></div></td>' +
          '<td class="small">' + _fmtNum(s.estimated_reach) + '</td></tr>').join('') +
        '</tbody></table></div></div></div>';
      const h2 = await _get('/api/influence-score/history').catch(() => ({ rows: [] }));
      document.getElementById('isc-hist').innerHTML = _tbl(h2.rows, [
        { label: 'Brand', key: 'brand' },
        { label: 'Top Source', key: 'top_source' },
        { label: 'Score', fn: r => r.top_source_score },
        { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
      ]);
    });
  };

  /* ─────────────────────────────────────────────────────────────────────────
     8. PROJECT COMPARISON
  ───────────────────────────────────────────────────────────────────────── */
  window.buildProjectCompare = async function () {
    const wrap = document.getElementById('projectCompareWrap');
    if (!wrap) return;
    wrap.innerHTML = _spinner();
    const hist = await _get('/api/project-compare/history').catch(() => ({ rows: [] }));

    wrap.innerHTML = `<div class="row g-4">
      <div class="col-12 col-lg-4">
        <div class="card mb-4"><div class="card-body">
          <h5 class="card-title">Compare Brands</h5>
          <p class="small text-muted">Enter 2–5 brands. We compare traffic, social, sentiment, mentions, SoV, and authority side-by-side.</p>
          <div id="pc-inputs">
            <input class="form-control mb-2 pc-in" placeholder="Your brand">
            <input class="form-control mb-2 pc-in" placeholder="Competitor 1">
            <input class="form-control mb-2 pc-in" placeholder="Competitor 2 (optional)">
          </div>
          <button class="btn btn-sm btn-outline-secondary mb-3" id="pc-add">+ Add Brand</button><br>
          <button id="pc-run" class="btn btn-primary w-100">⚖️ Compare</button>
        </div></div>
      </div>
      <div class="col-12 col-lg-8">
        <div id="pc-result">${_empty('Enter brands and click Compare.')}</div>
        <div class="card mt-4"><div class="card-body">
          <h5 class="card-title">History</h5>
          <div id="pc-hist">${_tbl(hist.rows, [
            { label: 'Brands', fn: r => (r.brands || []).join(' vs ') },
            { label: 'Winner', fn: r => '<strong>' + _esc(r.winner || '') + '</strong>' },
            { label: 'Summary', fn: r => r.summary ? '<span class="small">' + _esc((r.summary || '').slice(0, 80)) + '…</span>' : '' },
            { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
          ])}</div>
        </div></div>
      </div>
    </div>`;

    document.getElementById('pc-add').addEventListener('click', () => {
      const d = document.getElementById('pc-inputs');
      const n = document.createElement('input');
      n.className = 'form-control mb-2 pc-in';
      n.placeholder = 'Brand ' + (d.querySelectorAll('.pc-in').length + 1);
      d.appendChild(n);
    });

    document.getElementById('pc-run').addEventListener('click', async () => {
      const brands = Array.from(document.querySelectorAll('.pc-in')).map(i => i.value.trim()).filter(Boolean);
      if (brands.length < 2) { alert('Enter at least 2 brands'); return; }
      const rd = document.getElementById('pc-result');
      rd.innerHTML = _spinner();
      document.getElementById('pc-run').disabled = true;
      const d = await _post('/api/project-compare/run', { brands }).catch(e => ({ ok: false, error: e.message }));
      document.getElementById('pc-run').disabled = false;
      if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
      const results = d.results || [];
      rd.innerHTML = '<div class="card"><div class="card-body">' +
        (d.winner ? '<div class="alert alert-success mb-3"><strong>🏆 Winner: ' + _esc(d.winner) + '</strong>' + (d.summary ? '<br><span class="small">' + _esc(d.summary) + '</span>' : '') + '</div>' : '') +
        '<div class="table-responsive"><table class="table table-sm table-bordered"><thead><tr><th>Metric</th>' +
        results.map(r => '<th class="text-center' + (r.brand === d.winner ? ' table-success' : '') + '">' + _esc(r.brand) + '</th>').join('') + '</tr></thead><tbody>' +
        [
          { l: 'Monthly Traffic', k: 'monthly_traffic', f: v => _fmtNum(v) },
          { l: 'Social Following', k: 'social_following', f: v => _fmtNum(v) },
          { l: 'Positive Sentiment', k: 'sentiment_positive', f: v => v + '%' },
          { l: 'Brand Mentions/mo', k: 'brand_mentions', f: v => _fmtNum(v) },
          { l: 'Share of Voice', k: 'sov_pct', f: v => v + '%' },
          { l: 'Domain Authority', k: 'domain_authority', f: v => v + '/100' },
          { l: 'Overall Score', k: 'overall_score', f: v => '<strong>' + v + '/100</strong>' }
        ].map(row => '<tr><td class="small fw-semibold">' + _esc(row.l) + '</td>' +
          results.map(r => '<td class="text-center small">' + row.f(r[row.k] || 0) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div></div></div>';
      const h2 = await _get('/api/project-compare/history').catch(() => ({ rows: [] }));
      document.getElementById('pc-hist').innerHTML = _tbl(h2.rows, [
        { label: 'Brands', fn: r => (r.brands || []).join(' vs ') },
        { label: 'Winner', key: 'winner' },
        { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
      ]);
    });
  };

  /* ─────────────────────────────────────────────────────────────────────────
     9. GEOLOCATION INSIGHTS
  ───────────────────────────────────────────────────────────────────────── */
  window.buildGeoInsights = async function () {
    const wrap = document.getElementById('geoInsightsWrap');
    if (!wrap) return;
    wrap.innerHTML = _spinner();
    const hist = await _get('/api/geo-insights/history').catch(() => ({ rows: [] }));

    wrap.innerHTML = `<div class="row g-4">
      <div class="col-12 col-lg-4">
        <div class="card mb-4"><div class="card-body">
          <h5 class="card-title">Geolocation Insights</h5>
          <label class="form-label fw-semibold">Brand Name</label>
          <input id="gi-brand" class="form-control mb-3" placeholder="e.g. Figma">
          <label class="form-label fw-semibold">Regions</label>
          <input id="gi-regions" class="form-control mb-3" placeholder="US, UK, Germany…" value="United States, United Kingdom, Canada, Australia, Germany, India, Brazil">
          <button id="gi-run" class="btn btn-primary w-100">🌍 Analyse Regions</button>
        </div></div>
      </div>
      <div class="col-12 col-lg-8">
        <div id="gi-result">${_empty('Enter a brand and click Analyse Regions.')}</div>
      </div>
    </div>
    <div class="card mt-4"><div class="card-body">
      <h5 class="card-title">History</h5>
      <div id="gi-hist">${_tbl(hist.rows, [
        { label: 'Brand', key: 'brand' },
        { label: 'Top Region', key: 'top_region' },
        { label: 'Sentiment', fn: r => _pill(r.top_region_sentiment, _sentColor(r.top_region_sentiment)) },
        { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
      ])}</div>
    </div></div>`;

    document.getElementById('gi-run').addEventListener('click', async () => {
      const brand = document.getElementById('gi-brand').value.trim();
      if (!brand) return;
      const regions = document.getElementById('gi-regions').value.split(',').map(s => s.trim()).filter(Boolean);
      const rd = document.getElementById('gi-result');
      rd.innerHTML = _spinner();
      document.getElementById('gi-run').disabled = true;
      const d = await _post('/api/geo-insights/scan', { brand, regions }).catch(e => ({ ok: false, error: e.message }));
      document.getElementById('gi-run').disabled = false;
      if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
      const bd = d.breakdown || [];
      rd.innerHTML = '<div class="card"><div class="card-body">' +
        (d.top_region ? '<div class="mb-3 small"><strong>' + _esc(d.top_region) + '</strong> leads · ' + _pill(d.top_region_sentiment, _sentColor(d.top_region_sentiment)) + ' sentiment</div>' : '') +
        '<div class="table-responsive"><table class="table table-sm table-hover"><thead><tr><th>Region</th><th>Mention Share</th><th>Sentiment</th><th>Trend</th><th>Key Topics</th></tr></thead><tbody>' +
        bd.map(r => '<tr><td><strong>' + _esc(r.region) + '</strong></td>' +
          '<td class="small"><div class="d-flex align-items-center gap-2"><div class="progress" style="height:6px;width:60px"><div class="progress-bar" style="width:' + Math.min(100, (r.mention_share_pct || 0) * 2) + '%;background:#6366f1"></div></div>' + (r.mention_share_pct || 0) + '%</div></td>' +
          '<td>' + _pill(r.sentiment || 'neutral', _sentColor(r.sentiment)) + '</td>' +
          '<td class="small">' + (r.trend === 'growing' ? '📈' : r.trend === 'declining' ? '📉' : '→') + ' ' + _esc(r.trend || '') + '</td>' +
          '<td class="small">' + (r.key_topics || []).slice(0, 3).join(', ') + '</td></tr>').join('') +
        '</tbody></table></div>' +
        (d.strategic_notes && d.strategic_notes.length ? '<h6 class="mt-3">Strategic Notes</h6><ul class="small">' + d.strategic_notes.map(n => '<li>' + _esc(n) + '</li>').join('') + '</ul>' : '') +
        '</div></div>';
      const h2 = await _get('/api/geo-insights/history').catch(() => ({ rows: [] }));
      document.getElementById('gi-hist').innerHTML = _tbl(h2.rows, [
        { label: 'Brand', key: 'brand' },
        { label: 'Top Region', key: 'top_region' },
        { label: 'Sentiment', fn: r => _pill(r.top_region_sentiment, _sentColor(r.top_region_sentiment)) },
        { label: 'Date', fn: r => new Date(r.created_at).toLocaleDateString() }
      ]);
    });
  };

  /* ─────────────────────────────────────────────────────────────────────────
     10. UGC DISCOVERY
  ───────────────────────────────────────────────────────────────────────── */
  window.buildUgcDiscovery = async function () {
    const wrap = document.getElementById('ugcDiscoveryWrap');
    if (!wrap) return;

    async function _render(filterBrand) {
      wrap.innerHTML = _spinner();
      const items = await _get('/api/ugc-discovery/items' + (filterBrand ? '?brand=' + encodeURIComponent(filterBrand) : '')).catch(() => ({ rows: [] }));
      const rows = items.rows || [];
      const stCls = { new: 'secondary', saved: 'info', approved: 'success', archived: 'light' };

      wrap.innerHTML = `<div class="row g-4">
        <div class="col-12 col-lg-4">
          <div class="card mb-4"><div class="card-body">
            <h5 class="card-title">Discover UGC</h5>
            <label class="form-label fw-semibold">Brand Name</label>
            <input id="ugc-brand" class="form-control mb-3" placeholder="e.g. Figma" value="${filterBrand ? _esc(filterBrand) : ''}">
            <label class="form-label fw-semibold small">Content Types</label>
            <div class="d-flex flex-wrap gap-2 mb-3 small">
              <label><input type="checkbox" class="ugc-t" value="review" checked> Reviews</label>
              <label><input type="checkbox" class="ugc-t" value="post" checked> Posts</label>
              <label><input type="checkbox" class="ugc-t" value="video" checked> Videos</label>
              <label><input type="checkbox" class="ugc-t" value="testimonial" checked> Testimonials</label>
            </div>
            <button id="ugc-disc" class="btn btn-primary w-100 mb-2">📸 Discover UGC</button>
            <button id="ugc-reload" class="btn btn-outline-secondary w-100">🔄 Reload Library</button>
          </div></div>
          <div id="ugc-disc-result"></div>
        </div>
        <div class="col-12 col-lg-8">
          <div class="card"><div class="card-body">
            <h5 class="card-title">UGC Library <span class="badge bg-secondary">${rows.length}</span></h5>
            <div id="ugc-lib">${rows.length ? rows.map(item =>
              '<div class="border rounded p-3 mb-3" id="ugc-' + item.id + '">' +
              '<div class="d-flex justify-content-between align-items-start mb-2">' +
              '<div class="d-flex gap-1 flex-wrap">' + _pill(item.platform, 'secondary') + ' ' + _pill(item.ugc_type, 'info') + ' ' + _pill(item.sentiment, _sentColor(item.sentiment)) + '</div>' +
              '<div class="d-flex gap-1">' +
              (item.status !== 'approved' ? '<button class="btn btn-sm btn-success" onclick="window._ugcSt(' + item.id + ',\'approved\',\'' + _esc(filterBrand || '') + '\')">✓ Approve</button>' : _pill('Approved', 'success')) + ' ' +
              (item.status !== 'saved' ? '<button class="btn btn-sm btn-outline-primary" onclick="window._ugcSt(' + item.id + ',\'saved\',\'' + _esc(filterBrand || '') + '\')">Save</button>' : '') + ' ' +
              '<button class="btn btn-sm btn-outline-danger" onclick="window._ugcDel(' + item.id + ')">×</button>' +
              '</div></div>' +
              '<p class="mb-1 small">' + _esc((item.content || '').slice(0, 200)) + '</p>' +
              '<div class="small text-muted">by <strong>' + _esc(item.author || '') + '</strong>' +
              (item.estimated_reach ? ' · reach ~' + _fmtNum(item.estimated_reach) : '') + '</div>' +
              (item.url ? '<a href="' + _esc(item.url) + '" target="_blank" rel="noopener" class="small">View →</a>' : '') +
              '</div>').join('') :
              _empty('No UGC in library yet. Run a discovery scan above.')}</div>
          </div></div>
        </div>
      </div>`;

      document.getElementById('ugc-disc').addEventListener('click', async () => {
        const brand = document.getElementById('ugc-brand').value.trim();
        if (!brand) return;
        const ugc_types = Array.from(document.querySelectorAll('.ugc-t:checked')).map(c => c.value);
        const rd = document.getElementById('ugc-disc-result');
        rd.innerHTML = _spinner();
        document.getElementById('ugc-disc').disabled = true;
        const d = await _post('/api/ugc-discovery/discover', { brand, ugc_types }).catch(e => ({ ok: false, error: e.message }));
        document.getElementById('ugc-disc').disabled = false;
        if (!d.ok) { rd.innerHTML = '<div class="alert alert-danger">' + _esc(d.error) + '</div>'; return; }
        rd.innerHTML = '<div class="alert alert-success">Found <strong>' + d.discovered + '</strong> UGC items — <strong>' + d.saved + '</strong> saved.</div>';
        setTimeout(() => _render(brand), 800);
      });

      document.getElementById('ugc-reload').addEventListener('click', () => {
        _render(document.getElementById('ugc-brand').value.trim() || undefined);
      });

      window._ugcSt = async (id, status, brand) => {
        await fetch('/api/ugc-discovery/items/' + id + '/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }), credentials: 'same-origin' });
        _render(brand || undefined);
      };
      window._ugcDel = async (id) => {
        await fetch('/api/ugc-discovery/items/' + id, { method: 'DELETE', credentials: 'same-origin' });
        document.getElementById('ugc-' + id)?.remove();
      };
    }
    _render();
  };

})();
