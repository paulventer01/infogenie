  // ═══════════════════════════════════════════════════════════════════════════
  // T107 — RCS & APPLE MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildRcs = async function () {
    const el = document.getElementById('view-rcs');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>💬 RCS &amp; Apple Messages</h1><p>Rich Communication Services and Apple Messages for Business — interactive rich cards, CTA buttons, carousels, and AI-generated campaigns.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="rcs-list">Campaigns</button><button class="ig-tab" data-tab="rcs-ai">AI Generate</button></div>
<div id="rcs-list" class="ig-tab-panel">
  <div class="ig-toolbar"><button class="btn btn-primary" id="rcs-new">+ New Campaign</button></div>
  <div id="rcs-campaigns"><div class="ig-spinner">Loading…</div></div>
</div>
<div id="rcs-ai" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:540px">
    <h3>🤖 AI Rich Message Generator</h3>
    <label>Channel<select id="rcs-channel" class="ig-select"><option value="rcs">RCS (Android)</option><option value="apple_messages">Apple Messages for Business</option></select></label>
    <label>Campaign Goal<input type="text" id="rcs-goal" class="ig-input" placeholder="Drive Black Friday sales / Book a demo / Recover abandoned cart"></label>
    <label>Brand Name<input type="text" id="rcs-brand" class="ig-input" placeholder="Acme Co."></label>
    <label>Offer / Key Message<input type="text" id="rcs-offer" class="ig-input" placeholder="30% off for 24 hours"></label>
    <label>CTA Label<input type="text" id="rcs-cta-label" class="ig-input" placeholder="Claim Offer"></label>
    <label>CTA URL<input type="url" id="rcs-cta-url" class="ig-input" placeholder="https://yoursite.com/offer"></label>
    <button class="btn btn-primary" id="rcs-gen-btn">✨ Generate Rich Campaign</button>
    <div id="rcs-gen-result" style="margin-top:16px"></div>
  </div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
    }));

    async function loadCampaigns() {
      const d = await _api('/api/rcs/campaigns');
      const c = el.querySelector('#rcs-campaigns');
      if (!d.ok || !d.campaigns.length) { c.innerHTML = '<div class="ig-empty">No RCS campaigns yet. Create one above or use the AI generator.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Name</th><th>Channel</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Status</th><th>Created</th></tr></thead><tbody>` +
        d.campaigns.map(c2 => `<tr><td>${_esc(c2.name)}</td><td><span class="badge badge-info">${_esc(c2.channel)}</span></td><td>${c2.sent_count}</td><td>${c2.delivered_count}</td><td>${c2.read_count}</td><td>${_badge(c2.status, STATUS_MAP)}</td><td>${_ts(c2.created_at)}</td></tr>`).join('') +
        '</tbody></table>';
    }

    el.querySelector('#rcs-new').addEventListener('click', () => {
      const name = prompt('Campaign name:'); if (!name) return;
      const body = prompt('Message body text:'); if (!body) return;
      _api('/api/rcs/campaigns/create', { method: 'POST', body: JSON.stringify({ name, message_body: body }) }).then(loadCampaigns);
    });

    el.querySelector('#rcs-gen-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#rcs-gen-btn');
      btn.disabled = true; btn.textContent = '⏳ Generating…';
      const d = await _api('/api/rcs/campaigns/0/ai-generate', { method: 'POST', body: JSON.stringify({ channel: el.querySelector('#rcs-channel').value, goal: el.querySelector('#rcs-goal').value, brand_name: el.querySelector('#rcs-brand').value, offer: el.querySelector('#rcs-offer').value, cta_label: el.querySelector('#rcs-cta-label').value, cta_url: el.querySelector('#rcs-cta-url').value }) });
      btn.disabled = false; btn.textContent = '✨ Generate Rich Campaign';
      const res = el.querySelector('#rcs-gen-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }
      const g = d.generated;
      res.innerHTML = `<div class="ig-form-card">
        <h4>Generated Campaign — ${_esc(g.campaign_name)}</h4>
        <div class="ig-two-col">
          <div><label>Message Body (plain text fallback)</label><div class="ig-copybox">${_esc(g.message_body)}</div></div>
          <div><label>Rich Card</label><div class="ig-copybox" style="font-size:.83rem">${_esc(JSON.stringify(g.rich_card, null, 2))}</div></div>
        </div>
        <label>CTA Buttons</label><div class="ig-copybox" style="font-size:.83rem">${_esc(JSON.stringify(g.cta_buttons, null, 2))}</div>
        <label>Suggested Replies</label><div>${(g.suggested_replies || []).map(r => `<span class="badge badge-neutral" style="margin:2px">${_esc(r)}</span>`).join('')}</div>
        <label>Best Send Time</label><div class="ig-copybox">${_esc(g.best_send_time)}</div>
        <button class="btn btn-success" id="rcs-save-gen">Save as Campaign</button>
      </div>`;
      res.querySelector('#rcs-save-gen').addEventListener('click', async () => {
        const d2 = await _api('/api/rcs/campaigns/create', { method: 'POST', body: JSON.stringify({ name: g.campaign_name, channel: el.querySelector('#rcs-channel').value, message_body: g.message_body, rich_card: g.rich_card, cta_buttons: g.cta_buttons, sender_name: g.sender_name }) });
        if (d2.ok) { alert('Campaign saved!'); loadCampaigns(); }
      });
    });

    loadCampaigns();
  };

