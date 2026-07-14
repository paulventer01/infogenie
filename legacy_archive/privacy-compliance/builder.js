  // ═══════════════════════════════════════════════════════════════════════════
  // T109 — GLOBAL PRIVACY AUTO-COMPLIANCE
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildPrivacyCompliance = async function () {
    const el = document.getElementById('view-privacy-compliance');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>🔐 Privacy Auto-Compliance</h1><p>Auto-scrub PII from lists, check Do-Not-Call registries, validate consent for GDPR/CCPA/TCPA, and run full compliance audits.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="pc-tools">Compliance Tools</button><button class="ig-tab" data-tab="pc-audit">AI Audit</button><button class="ig-tab" data-tab="pc-history">History</button></div>
<div id="pc-tools" class="ig-tab-panel">
  <div class="ig-three-col" style="gap:16px">
    <div class="ig-form-card">
      <h3>🧹 PII Scrubber</h3>
      <p style="font-size:.85rem">Paste contact JSON or CSV rows. AI detects SSNs, credit card numbers, passport numbers, and other PII.</p>
      <textarea id="pc-contacts" class="ig-textarea" rows="5" placeholder='[{"email":"john@x.com","name":"John"},{"email":"jane@y.com","ssn":"123-45-6789"}]'></textarea>
      <button class="btn btn-primary" id="pc-scrub-btn" style="margin-top:8px">🧹 Scrub PII</button>
      <div id="pc-scrub-result" style="margin-top:10px"></div>
    </div>
    <div class="ig-form-card">
      <h3>📵 DNC Checker</h3>
      <p style="font-size:.85rem">Paste phone numbers to check against Do-Not-Call registries (TCPA compliance).</p>
      <textarea id="pc-phones" class="ig-textarea" rows="5" placeholder="One phone number per line:\n+18005551234\n+12125559876"></textarea>
      <button class="btn btn-primary" id="pc-dnc-btn" style="margin-top:8px">📵 Check DNC</button>
      <div id="pc-dnc-result" style="margin-top:10px"></div>
    </div>
    <div class="ig-form-card">
      <h3>✅ Consent Validator</h3>
      <p style="font-size:.85rem">Validate consent records against GDPR, CCPA, and CAN-SPAM requirements.</p>
      <textarea id="pc-consent" class="ig-textarea" rows="5" placeholder='[{"email":"a@b.com","consent_date":"2024-01-01","consent_source":"web_form","consent_explicit":true}]'></textarea>
      <select id="pc-jurisdictions" class="ig-select"><option value="EU_GDPR">EU GDPR</option><option value="US_CCPA">US CCPA</option><option value="CAN_SPAM">CAN-SPAM</option></select>
      <button class="btn btn-primary" id="pc-consent-btn" style="margin-top:8px">✅ Validate</button>
      <div id="pc-consent-result" style="margin-top:10px"></div>
    </div>
  </div>
</div>
<div id="pc-audit" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:520px">
    <h3>🔍 Full Compliance Audit</h3>
    <label>List Type<input type="text" id="pc-list-type" class="ig-input" placeholder="email marketing list / SMS subscribers / lead database"></label>
    <label>Channels<input type="text" id="pc-channels" class="ig-input" placeholder="email, sms, phone"></label>
    <label>Jurisdictions (comma-separated)<input type="text" id="pc-jur" class="ig-input" value="EU_GDPR, US_CCPA, CAN_SPAM, TCPA"></label>
    <button class="btn btn-primary" id="pc-audit-btn">🔍 Run AI Audit</button>
    <div id="pc-audit-result" style="margin-top:12px"></div>
  </div>
</div>
<div id="pc-history" class="ig-tab-panel hidden">
  <div id="pc-history-list"><div class="ig-spinner">Loading…</div></div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'pc-history') loadHistory();
    }));

    function riskBadge(r) { return `<span class="badge badge-${r === 'high' || r === 'critical' ? 'danger' : r === 'medium' ? 'warning' : 'success'}">${r}</span>`; }

    el.querySelector('#pc-scrub-btn').addEventListener('click', async () => {
      let contacts;
      try { contacts = JSON.parse(el.querySelector('#pc-contacts').value); } catch { contacts = []; }
      if (!contacts.length) { el.querySelector('#pc-scrub-result').innerHTML = `<div class="ig-alert ig-alert-danger">Paste valid JSON array of contacts</div>`; return; }
      const d = await _api('/api/privacy-compliance/scrub', { method: 'POST', body: JSON.stringify({ contacts }) });
      const res = el.querySelector('#pc-scrub-result');
      if (d.ok) res.innerHTML = `<div class="ig-alert ig-alert-${d.risk_level === 'low' ? 'success' : 'warning'}">Scanned ${d.input_count} contacts — ${d.flagged_count} flagged · Risk: ${riskBadge(d.risk_level)}<br>Issues found: ${d.issues.join(', ') || 'none'}</div>`;
    });

    el.querySelector('#pc-dnc-btn').addEventListener('click', async () => {
      const phones = el.querySelector('#pc-phones').value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!phones.length) return;
      const d = await _api('/api/privacy-compliance/check-dnc', { method: 'POST', body: JSON.stringify({ phone_numbers: phones }) });
      const res = el.querySelector('#pc-dnc-result');
      if (d.ok) res.innerHTML = `<div class="ig-alert ig-alert-${d.flagged === 0 ? 'success' : 'warning'}">Checked ${d.checked} numbers — ${d.flagged} DNC-flagged · ${d.safe} safe to contact</div>
        ${d.results.filter(r => r.status === 'do_not_contact').map(r => `<div style="font-size:.82rem;color:#c00">⛔ ${_esc(r.phone)} — ${_esc(r.reason || 'DNC flagged')}</div>`).join('')}`;
    });

    el.querySelector('#pc-consent-btn').addEventListener('click', async () => {
      let contacts;
      try { contacts = JSON.parse(el.querySelector('#pc-consent').value); } catch { contacts = []; }
      if (!contacts.length) return;
      const j = el.querySelector('#pc-jurisdictions').value;
      const d = await _api('/api/privacy-compliance/validate-consent', { method: 'POST', body: JSON.stringify({ contacts, jurisdictions: [j] }) });
      const res = el.querySelector('#pc-consent-result');
      if (d.ok) res.innerHTML = `<div class="ig-alert ig-alert-${d.non_compliant === 0 ? 'success' : 'warning'}">✅ ${d.compliant} compliant · ⚠️ ${d.non_compliant} non-compliant for ${j}</div>`;
    });

    el.querySelector('#pc-audit-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#pc-audit-btn');
      btn.disabled = true; btn.textContent = '⏳ Auditing…';
      const d = await _api('/api/privacy-compliance/audit', { method: 'POST', body: JSON.stringify({ list_type: el.querySelector('#pc-list-type').value, channels: el.querySelector('#pc-channels').value.split(',').map(s => s.trim()), jurisdictions: el.querySelector('#pc-jur').value.split(',').map(s => s.trim()) }) });
      btn.disabled = false; btn.textContent = '🔍 Run AI Audit';
      const res = el.querySelector('#pc-audit-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }
      const a = d.audit;
      res.innerHTML = `<div class="ig-form-card">
        <div class="ig-stats-row"><div class="ig-stat"><div class="ig-stat-val">${a.estimated_compliance_score || 0}/100</div><div class="ig-stat-label">Compliance Score</div></div><div class="ig-stat"><div class="ig-stat-val">${riskBadge(a.overall_risk)}</div><div class="ig-stat-label">Overall Risk</div></div></div>
        <p style="font-size:.9rem;margin:12px 0">${_esc(a.summary)}</p>
        <h4>Required Actions</h4>
        ${(a.required_actions || []).map(act => `<div class="ig-card" style="margin-bottom:8px;border-left:4px solid ${act.urgency === 'immediate' ? '#ef4444' : '#f59e0b'}">
          <div><strong>${_esc(act.action)}</strong> · <span class="badge badge-info">${_esc(act.jurisdiction)}</span> · <span class="badge badge-${act.urgency === 'immediate' ? 'danger' : 'warning'}">${_esc(act.urgency)}</span></div>
          <div style="font-size:.85rem;margin-top:4px">${_esc(act.description)}</div>
        </div>`).join('')}
      </div>`;
    });

    async function loadHistory() {
      const d = await _api('/api/privacy-compliance/history');
      const c = el.querySelector('#pc-history-list');
      if (!d.ok || !d.history.length) { c.innerHTML = '<div class="ig-empty">No compliance checks yet.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Type</th><th>Jurisdiction</th><th>Input</th><th>Flagged</th><th>Risk</th><th>Date</th></tr></thead><tbody>` +
        d.history.map(h => `<tr><td>${_esc(h.check_type)}</td><td>${_esc(h.jurisdiction || '—')}</td><td>${h.input_count || 0}</td><td>${h.flagged_count || 0}</td><td>${riskBadge(h.risk_level || 'low')}</td><td>${_ts(h.created_at)}</td></tr>`).join('') +
        '</tbody></table>';
    }
  };

