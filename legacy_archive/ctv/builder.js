  // ═══════════════════════════════════════════════════════════════════════════
  // T106 — CTV & STREAMING AUDIO
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildCtv = async function () {
    const el = document.getElementById('view-ctv');
    if (!el) return;
    const cfg = await _api('/api/ctv/config');
    const platforms = cfg.platforms || [];
    el.innerHTML = `<div class="view-header"><h1>📺 Connected TV &amp; Streaming Audio</h1><p>Plan, brief, and manage campaigns on Roku, Hulu, Amazon Fire TV, Spotify, Pandora, and Apple Podcast Ads — with AI creative briefs.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="ctv-campaigns">Campaigns</button><button class="ig-tab" data-tab="ctv-create">New Campaign</button></div>
<div id="ctv-campaigns" class="ig-tab-panel"><div id="ctv-list"><div class="ig-spinner">Loading…</div></div></div>
<div id="ctv-create" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:600px">
    <h3>New CTV / Streaming Audio Campaign</h3>
    <label>Campaign Name<input type="text" id="ctv-name" class="ig-input" placeholder="Q3 Brand Awareness — Roku"></label>
    <label>Platform<select id="ctv-platform" class="ig-select">
      ${platforms.map(p => `<option value="${p.id}">[${p.type === 'streaming_audio' ? '🎵' : '📺'}] ${p.name} — min $${p.min_budget.toLocaleString()}</option>`).join('')}
    </select></label>
    <label>Objective<select id="ctv-objective" class="ig-select">
      ${(cfg.objectives || []).map(o => `<option value="${o}">${o.replace(/_/g,' ')}</option>`).join('')}
    </select></label>
    <label>Total Budget ($)<input type="number" id="ctv-budget" class="ig-input" placeholder="5000"></label>
    <label>Daily Budget ($)<input type="number" id="ctv-daily" class="ig-input" placeholder="167"></label>
    <label>Start Date<input type="date" id="ctv-start" class="ig-input"></label>
    <label>End Date<input type="date" id="ctv-end" class="ig-input"></label>
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-primary" id="ctv-create-btn">Create Campaign</button>
    </div>
    <div id="ctv-create-result" style="margin-top:10px"></div>
  </div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'ctv-campaigns') loadCampaigns();
    }));

    async function loadCampaigns() {
      const d = await _api('/api/ctv/campaigns');
      const c = el.querySelector('#ctv-list');
      if (!d.ok || !d.campaigns.length) { c.innerHTML = '<div class="ig-empty">No CTV/audio campaigns yet. Create one to get started.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Name</th><th>Platform</th><th>Type</th><th>Budget</th><th>Projected Reach</th><th>CPM</th><th>Status</th><th>Actions</th></tr></thead><tbody>` +
        d.campaigns.map(c2 => `<tr>
          <td><strong>${_esc(c2.name)}</strong></td>
          <td>${_esc(c2.platform)}</td>
          <td><span class="badge ${c2.campaign_type === 'streaming_audio' ? 'badge-info' : 'badge-success'}">${_esc(c2.campaign_type)}</span></td>
          <td>$${c2.budget}</td>
          <td>${c2.projected_reach ? c2.projected_reach.toLocaleString() : '—'}</td>
          <td>$${c2.projected_cpm || '—'}</td>
          <td>${_badge(c2.status, STATUS_MAP)}</td>
          <td><button class="btn btn-sm btn-primary" data-brief="${c2.id}">✍️ AI Brief</button>
              <button class="btn btn-sm btn-success" data-activate="${c2.id}">Activate</button></td>
        </tr>`).join('') + '</tbody></table>';
      c.querySelectorAll('[data-brief]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = '⏳';
        const brand = prompt('Your brand name:') || '';
        const audience = prompt('Target audience:') || '';
        const d2 = await _api('/api/ctv/campaigns/' + b.dataset.brief + '/ai-brief', { method: 'POST', body: JSON.stringify({ brand_name: brand, target_audience: audience }) });
        b.disabled = false; b.textContent = '✍️ AI Brief';
        if (d2.ok) alert(`✅ AI Creative Brief\n\nHeadline: ${d2.brief.headline}\n\nScript:\n${d2.brief.script}\n\nCTA: ${d2.brief.cta}\n\nProduction Notes: ${d2.brief.production_notes}`);
      }));
      c.querySelectorAll('[data-activate]').forEach(b => b.addEventListener('click', async () => { await _api('/api/ctv/campaigns/' + b.dataset.activate + '/status', { method: 'PUT', body: JSON.stringify({ status: 'active' }) }); loadCampaigns(); }));
    }

    el.querySelector('#ctv-create-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#ctv-create-btn');
      btn.disabled = true;
      const d = await _api('/api/ctv/campaigns/create', { method: 'POST', body: JSON.stringify({ name: el.querySelector('#ctv-name').value, platform: el.querySelector('#ctv-platform').value, objective: el.querySelector('#ctv-objective').value, budget: el.querySelector('#ctv-budget').value, daily_budget: el.querySelector('#ctv-daily').value, start_date: el.querySelector('#ctv-start').value, end_date: el.querySelector('#ctv-end').value }) });
      btn.disabled = false;
      const res = el.querySelector('#ctv-create-result');
      if (d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-success">✅ Campaign created! Projected reach: ${(d.campaign.projected_reach || 0).toLocaleString()} · CPM: $${d.campaign.projected_cpm}</div>`; }
      else { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; }
    });

    loadCampaigns();
  };

