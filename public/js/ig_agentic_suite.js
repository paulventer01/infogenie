(function () {
  'use strict';

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _api(path, opts) { return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts }).then(r => r.json()); }
  function _badge(val, map) { const e = map[val] || map['default'] || { label: val, cls: 'neutral' }; return `<span class="badge badge-${e.cls}">${_esc(e.label || val)}</span>`; }
  function _ts(d) { return d ? new Date(d).toLocaleString() : '—'; }

  const STATUS_MAP = { running: { label: 'Running', cls: 'info' }, completed: { label: 'Completed', cls: 'success' }, success: { label: 'Success', cls: 'success' }, failed: { label: 'Failed', cls: 'danger' }, partial: { label: 'Partial', cls: 'warning' }, draft: { label: 'Draft', cls: 'neutral' }, active: { label: 'Active', cls: 'success' }, paused: { label: 'Paused', cls: 'warning' }, detected: { label: 'Detected', cls: 'danger' }, healing: { label: 'Healing', cls: 'warning' }, resubmitted: { label: 'Resubmitted', cls: 'info' }, resolved: { label: 'Resolved', cls: 'success' }, sent: { label: 'Sent', cls: 'success' }, queued: { label: 'Queued', cls: 'neutral' }, default: { label: 'Unknown', cls: 'neutral' } };

  // ═══════════════════════════════════════════════════════════════════════════
  // T103 — SELF-HEALING AD ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildSelfHealing = async function () {
    const el = document.getElementById('view-self-healing');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>🩹 Self-Healing Ad Accounts</h1><p>AI detects rejected ads, rewrites them to meet platform policies, and prepares them for instant resubmission.</p></div>
<div class="ig-toolbar">
  <button class="btn btn-primary" id="sh-report-btn">+ Report Rejection</button>
</div>
<div id="sh-list"><div class="ig-spinner">Loading…</div></div>
<div id="sh-heal-panel" class="hidden" style="margin-top:20px"></div>`;

    async function loadHistory() {
      const d = await _api('/api/self-healing/history');
      const c = el.querySelector('#sh-list');
      if (!d.ok || !d.rejections.length) { c.innerHTML = '<div class="ig-empty">No rejected ads logged yet. Report a rejection to start AI healing.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Platform</th><th>Ad Name</th><th>Rejection Reason</th><th>Status</th><th>Confidence</th><th>Detected</th><th>Actions</th></tr></thead><tbody>` +
        d.rejections.map(r => `<tr>
          <td><span class="badge badge-info">${_esc(r.platform)}</span></td>
          <td>${_esc(r.ad_name || r.ad_id || '—')}</td>
          <td style="max-width:200px;font-size:.83rem">${_esc(r.rejection_reason.slice(0,100))}</td>
          <td>${_badge(r.status, STATUS_MAP)}</td>
          <td>${r.latest_confidence ? r.latest_confidence + '%' : '—'}</td>
          <td>${_ts(r.detected_at)}</td>
          <td>
            ${r.status === 'detected' || r.status === 'healing' ? `<button class="btn btn-sm btn-primary" data-heal="${r.id}">🤖 AI Heal</button>` : ''}
            ${r.status === 'healing' ? `<button class="btn btn-sm btn-success" data-resubmit="${r.id}">✓ Mark Resubmitted</button>` : ''}
            ${r.status !== 'resolved' ? `<button class="btn btn-sm btn-secondary" data-resolve="${r.id}">Resolve</button>` : ''}
          </td>
        </tr>`).join('') + '</tbody></table>';

      c.querySelectorAll('[data-heal]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = '⏳ Healing…';
        const d2 = await _api('/api/self-healing/heal/' + b.dataset.heal, { method: 'POST' });
        if (d2.ok) {
          const h = el.querySelector('#sh-heal-panel');
          h.classList.remove('hidden');
          h.innerHTML = `<div class="ig-form-card"><h3>✅ AI-Healed Copy — Confidence: ${d2.healed.confidence_pct}%</h3>
            <div class="ig-two-col">
              <div><label>Healed Headline</label><div class="ig-copybox">${_esc(d2.healed.healed_headline)}</div></div>
              <div><label>Strategy</label><div class="ig-copybox" style="font-size:.84rem">${_esc(d2.healed.heal_strategy)}</div></div>
            </div>
            <label>Healed Ad Copy</label><div class="ig-copybox">${_esc(d2.healed.healed_copy)}</div>
            <label>Policy Fixes</label><ul>${(d2.healed.policy_fixes || []).map(f => `<li>${_esc(f)}</li>`).join('')}</ul>
            <button class="btn btn-sm btn-success" data-resubmit="${b.dataset.heal}">✓ Mark as Resubmitted</button>
          </div>`;
          h.querySelector('[data-resubmit]').addEventListener('click', async () => {
            await _api('/api/self-healing/resubmit/' + b.dataset.heal, { method: 'POST' }); loadHistory(); h.classList.add('hidden');
          });
        }
        loadHistory();
      }));
      c.querySelectorAll('[data-resubmit]').forEach(b => b.addEventListener('click', async () => { await _api('/api/self-healing/resubmit/' + b.dataset.resubmit, { method: 'POST' }); loadHistory(); }));
      c.querySelectorAll('[data-resolve]').forEach(b => b.addEventListener('click', async () => { await _api('/api/self-healing/resolve/' + b.dataset.resolve, { method: 'POST' }); loadHistory(); }));
    }

    el.querySelector('#sh-report-btn').addEventListener('click', () => {
      const platform = prompt('Platform (meta / google / tiktok / linkedin):') || 'meta';
      const ad_name = prompt('Ad name or ID:') || 'Unknown Ad';
      const rejection_reason = prompt('Paste the rejection reason from the platform:');
      if (!rejection_reason) return;
      const original_copy = prompt('Paste the original ad copy:') || '';
      _api('/api/self-healing/check', { method: 'POST', body: JSON.stringify({ platform, ad_name, rejection_reason, original_copy }) }).then(loadHistory);
    });

    loadHistory();
  };

  // ── navigateTo hooks ───────────────────────────────────────────────────────
  const _origNav = window.navigateTo;
  window.navigateTo = function (view) {
    if (_origNav) _origNav(view);
    const builders = {
      'self-healing':       window.buildSelfHealing,
    };
    if (builders[view]) builders[view]();
  };
})();
