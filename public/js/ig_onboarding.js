// ============================================================================
// ig_onboarding.js — Onboarding Wizard + Global Tour Button extracted from app.js
// (Task: app.js split). Novice-friendly UX layer. Plain global script; loaded
// after app.js. Public entry point: window.openOnboarding.
// Moved verbatim — see public/js/README.md and appjs-split-convention.md.
// ============================================================================
// ─── Onboarding Wizard + Global Tour Button (novice-friendly UX layer) ───
(function(){
  const LS_DONE = 'ig_onboarded';
  const LS_DATA = 'ig_onboarding_data';

  const GOALS = [
    { id:'leads',     emoji:'🧲', title:'More leads',          desc:'Fill the pipeline with qualified prospects' },
    { id:'sales',     emoji:'💰', title:'More sales',          desc:'Convert traffic into paying customers' },
    { id:'awareness', emoji:'📣', title:'Brand awareness',     desc:'Get my name out — reach + share of voice' },
    { id:'reactivate',emoji:'🔁', title:'Re-activate customers', desc:'Win back churned + dormant buyers' }
  ];
  const CHANNELS = [
    { id:'meta',     emoji:'📘', label:'Meta Ads (Facebook + Instagram)' },
    { id:'google',   emoji:'🔍', label:'Google Ads (Search + YouTube)' },
    { id:'tiktok',   emoji:'🎵', label:'TikTok Ads' },
    { id:'email',    emoji:'✉️', label:'Email (newsletters + drips)' },
    { id:'whatsapp', emoji:'💬', label:'WhatsApp + SMS' },
    { id:'seo',      emoji:'🌐', label:'SEO + organic content' }
  ];
  const GOAL_NEXT = {
    leads:      { view:'lead-finder',     label:'Open B2B Lead Finder' },
    sales:      { view:'campaigns',       label:'Open Campaign Strategy' },
    awareness:  { view:'sov-tracker',     label:'Open Share of Voice' },
    reactivate: { view:'reengage',        label:'Open Re-Engage Customers' }
  };

  let state = { step:0, goal:null, biz:'', site:'', industry:'', comps:['','',''], channels:[] };
  try { const s = localStorage.getItem(LS_DATA); if (s) state = Object.assign(state, JSON.parse(s)); } catch(_){}

  // Bootstrap deferred to DOMContentLoaded — the wizard/tour HTML is appended
  // AFTER the <script src="/app.js"> tag, so DOM IDs don't exist at parse time.
  function _init(){
  const $ = id => document.getElementById(id);
  const overlay = $('ig-onb-overlay'), body = $('ig-onb-body');
  if (!overlay || !body) { console.warn('[onboarding] DOM not ready, aborting init'); return; }

  function _e(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function paintSteps(){
    const dots = overlay.querySelectorAll('.igsteps span');
    dots.forEach((d,i) => { d.className = i < state.step ? 'done' : i === state.step ? 'cur' : ''; });
    $('ig-onb-back').style.display = state.step === 0 ? 'none' : 'inline-block';
    $('ig-onb-next').textContent = state.step === 4 ? '🚀 Take me there' : 'Continue →';
  }

  function renderStep(){
    paintSteps();
    if (state.step === 0) {
      $('ig-onb-title').textContent = "Welcome to InfoGenie 👋";
      $('ig-onb-sub').textContent   = "First — what do you want to achieve?";
      body.innerHTML = `<div class="igchoice">${GOALS.map(g=>`<button data-g="${g.id}" class="${state.goal===g.id?'sel':''}"><span class="e">${g.emoji}</span><div class="t">${g.title}</div><div class="d">${g.desc}</div></button>`).join('')}</div>`;
      body.querySelectorAll('button[data-g]').forEach(b => b.onclick = () => { state.goal = b.dataset.g; persist(); renderStep(); });
    } else if (state.step === 1) {
      $('ig-onb-title').textContent = "Tell us about your business";
      $('ig-onb-sub').textContent   = "We'll personalise everything from this — you can change it later.";
      body.innerHTML = `
        <label>Business name</label><input type="text" id="ob-biz" value="${_e(state.biz)}" placeholder="Acme Co" autocomplete="off">
        <label>Website (optional)</label><input type="url" id="ob-site" value="${_e(state.site)}" placeholder="https://acme.com" autocomplete="off">
        <label>Industry</label>
        <select id="ob-ind"><option value="">— pick one —</option>${['SaaS','E-commerce','Local services','Agency','Consulting','Education','Healthcare','Real estate','Finance','Hospitality','Manufacturing','Non-profit','Other'].map(i=>`<option ${state.industry===i?'selected':''}>${i}</option>`).join('')}</select>`;
    } else if (state.step === 2) {
      $('ig-onb-title').textContent = "Add 1–3 competitors";
      $('ig-onb-sub').textContent   = "Optional. We'll auto-pull their ads, keywords, and landing pages once you do.";
      body.innerHTML = [0,1,2].map(i => `<label>Competitor ${i+1} ${i?'<span style="color:#94A3B8;font-weight:500">(optional)</span>':''}</label><input type="text" id="ob-c${i}" value="${_e(state.comps[i]||'')}" placeholder="competitor${i+1}.com or brand name" autocomplete="off">`).join('');
    } else if (state.step === 3) {
      $('ig-onb-title').textContent = "Where do you want to grow?";
      $('ig-onb-sub').textContent   = "Pick the channels you'll use. We'll only show tools that match.";
      body.innerHTML = `<div style="display:grid;gap:6px">${CHANNELS.map(c=>{ const sel = state.channels.includes(c.id); return `<label class="igchk ${sel?'sel':''}" data-c="${c.id}"><input type="checkbox" ${sel?'checked':''}> <span style="font-size:1.1rem">${c.emoji}</span> ${c.label}</label>`;}).join('')}</div>`;
      body.querySelectorAll('label[data-c]').forEach(l => l.onclick = e => {
        if (e.target.tagName === 'INPUT') return;
        const cb = l.querySelector('input'); cb.checked = !cb.checked;
        const id = l.dataset.c;
        state.channels = cb.checked ? [...new Set([...state.channels, id])] : state.channels.filter(x=>x!==id);
        l.classList.toggle('sel', cb.checked); persist();
      });
      body.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => {
        const id = cb.parentElement.dataset.c;
        state.channels = cb.checked ? [...new Set([...state.channels, id])] : state.channels.filter(x=>x!==id);
        cb.parentElement.classList.toggle('sel', cb.checked); persist();
      });
    } else {
      const goal = GOALS.find(g => g.id === state.goal) || GOALS[0];
      const next = GOAL_NEXT[state.goal] || GOAL_NEXT.leads;
      $('ig-onb-title').textContent = "You're all set 🎉";
      $('ig-onb-sub').textContent   = "Here's what InfoGenie will do for you next.";
      body.innerHTML = `
        <div style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4);border:1px solid #BFDBFE;border-radius:12px;padding:18px;margin-bottom:14px">
          <div style="font-size:.78rem;color:#0369A1;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Your focus</div>
          <div style="font-size:1.05rem;font-weight:800;color:#0F172A">${goal.emoji} ${_e(goal.title)}</div>
          <div style="font-size:.86rem;color:#334155;margin-top:4px">${_e(goal.desc)}</div>
        </div>
        <div style="display:grid;gap:8px;font-size:.88rem;color:#334155">
          <div>✅ <strong>Recommended starting point:</strong> ${_e(next.label)}</div>
          <div>✅ <strong>Then follow:</strong> Manage → 📅 7-Day Marketing Playbook for a guided week-by-week plan.</div>
          <div>✅ <strong>Or visualise the whole journey:</strong> Manage → 🎯 Growth Methodology (5 stages).</div>
          <div style="margin-top:6px;color:#64748B;font-size:.82rem">💡 The blue <strong>?</strong> button (bottom-right) gives you per-page help on every screen.</div>
        </div>`;
    }
  }

  function persist(){
    if (state.step === 1) {
      const b = $('ob-biz'), s = $('ob-site'), i = $('ob-ind');
      if (b) state.biz = b.value.trim();
      if (s) state.site = s.value.trim();
      if (i) state.industry = i.value;
    }
    if (state.step === 2) {
      [0,1,2].forEach(i => { const el = $('ob-c'+i); if (el) state.comps[i] = el.value.trim(); });
    }
    try { localStorage.setItem(LS_DATA, JSON.stringify(state)); } catch(_){}
  }

  function open(reset){
    if (reset) state = { step:0, goal:null, biz:'', site:'', industry:'', comps:['','',''], channels:[] };
    state.step = 0; renderStep(); overlay.classList.add('show');
  }
  function close(done){
    overlay.classList.remove('show');
    if (done) { try { localStorage.setItem(LS_DONE, '1'); } catch(_){} }
  }

  // Defensive: if any sub-element is missing (SPA may have re-rendered the
  // body), abort gracefully instead of throwing on null.onclick.
  const _skip = $('ig-onb-skip'), _back = $('ig-onb-back'), _next = $('ig-onb-next');
  if (!_skip || !_back || !_next) { console.warn('[onboarding] wizard buttons missing — aborting init'); return; }
  _skip.onclick = () => { persist(); close(true); };
  _back.onclick = () => { persist(); if (state.step > 0) state.step--; renderStep(); };
  _next.onclick = () => {
    persist();
    if (state.step === 0 && !state.goal) { if (window.showToast) showToast('Pick a goal first'); return; }
    if (state.step < 4) { state.step++; renderStep(); return; }
    close(true);
    const next = GOAL_NEXT[state.goal] || GOAL_NEXT.leads;
    const link = document.querySelector(`.nav-link[data-view="${next.view}"]`);
    if (link) link.click();
    else if (typeof navigateTo === 'function') { try { navigateTo(next.view); } catch(_){} }
  };

  // First-run trigger: open once a .nav-link[data-view] exists in the DOM
  // (proxy for "logged in"). Retries via MutationObserver so a slow async
  // login render still triggers the wizard.
  let _autoOpened = false;
  function _tryAutoOpen(){
    if (_autoOpened) return;
    try {
      if (localStorage.getItem(LS_DONE)) { _autoOpened = true; return; }
      if (!document.querySelector('.nav-link[data-view]')) return;
      _autoOpened = true;
      setTimeout(open, 600);
    } catch(_){ _autoOpened = true; }
  }
  _tryAutoOpen();
  if (!_autoOpened) {
    const mo = new MutationObserver(() => { _tryAutoOpen(); if (_autoOpened) mo.disconnect(); });
    try { mo.observe(document.body, { childList:true, subtree:true }); } catch(_){}
    setTimeout(() => { try { mo.disconnect(); } catch(_){} }, 30000); // safety stop after 30s
  }

  window.openOnboarding = () => open(true);

  // ─── Per-view help dictionary for the global Tour button ───
  const HELP = {
    'home': { title:'Dashboard', body:'Your daily command centre — campaigns, ad spend, leads, and AI Team status at a glance.', tips:['Pin your most-used widgets via the gear icon','Click any KPI to drill into its source view'] },
    'dashboard': { title:'Dashboard', body:'Your daily command centre — campaigns, ad spend, leads, and AI Team status at a glance.', tips:['Pin your most-used widgets via the gear icon','Click any KPI to drill into its source view'] },
    'studio': { title:'Creator Studio', body:'All-in-one creator hub: brand kit, image tools, video, presentations, and email signatures — every tile is AI-powered.', tips:['Set up your brand kit FIRST so other tools auto-style','Generated assets save under My Assets'] },
    'web-analytics': { title:'Web Analytics', body:'Read-only acquisition + behaviour summary: channel sessions, top landing pages, mobile PageSpeed scores. Last 30 days.', tips:['Connect GA4 in Settings for full Source/Medium + Country','Banner shows when GA4 is missing'] },
    'budget-board': { title:'Budget Board', body:'Per-month target + per-channel allocations + spend log. Shows target vs actual, utilisation, and 30-day trend.', tips:['Other services (e.g. the optimizer) can mirror outflows here','Log manual spend for offline channels'] },
    'brand-calendar': { title:'Brand Calendar', body:'Unified planner across 10 categories: Brand · Email · SMS+WhatsApp · Social · Content · Ads · Event · Surveys · Website · My Activities.', tips:['Sidebar filter narrows the month grid','Click any day to add an item'] },
    'brand-foundation': { title:'Brand Foundation', body:'The five pillars every other AI tool reads from: Purpose · Audience Clarity (ICP) · Voice · Messaging · Visual Identity. Fill it once, and your ads, emails, landing pages, social posts and voice scripts all stay on-brand.', tips:['Use the AI Suggest buttons to draft each section','Paste any copy into the Voice Check tool to score it 0-100','Visual identity is intentionally last — get the invisible layers right first'] },
    'competitors': { title:'Competitor Profiles', body:'Add competitors to auto-pull their ads, landing pages, keywords, and pricing.', tips:['Start with 3–5 direct competitors','Use 🤖 Discovery if you don\'t know who they are yet'] },
    'campaigns': { title:'Campaign Strategy', body:'Build a campaign brief that auto-launches across Meta, Google, and TikTok — and registers itself in the AI Optimizer.', tips:['The optimizer turns ON by default for safety','Without ad-platform creds, campaigns save locally so you can still review them'] },
    'ai-team': { title:'Your AI Executive Team', body:'8 AI officers (marketing/sales/analyst/content/seo/cro/finance/ops) work autonomously on tasks you assign.', tips:['Open Daily Report Scheduler to see honest done/blocked status','Officers cross-reference real DB activity, not self-reports'] },
    'optimizer': { title:'AI Campaign Optimizer', body:'Hourly performance ingest, 6-hourly pause/scale rules, 12-hourly budget reallocation. Default: dry-run.', tips:['Flip to LIVE once you trust the recommendations','Multi-Armed Bandit runs on Meta + Google'] },
    'playbook-7day': { title:'7-Day Marketing Playbook', body:'A guided week: Day 1 Research → Day 7 Reporting. Click 🤖 AI Suggest on any step or ▶ Run Autonomously to assign every step to your AI Team.', tips:['Suggestions are grounded in your real DB activity','Run history is kept for the last 50 runs'] },
    'growth-methodology': { title:'Growth Methodology', body:'A 5-stage visual map of how InfoGenie powers Diagnose → Analyse → Implement → Prove → Compound.', tips:['Click any number to see the features behind that stage','Each feature has an Open → button that jumps you straight there'] },
    'journey-builder': { title:'Customer Journey Builder', body:'Multi-step flows: trigger → wait → condition → action. Actions fan out to email, SMS, WhatsApp, AI voice, web push, or contact tagging.', tips:['Runs tick every 60 seconds','Pause anytime — no enrolments are lost'] },
    'omnichannel': { title:'Omnichannel Composer', body:'Write once → fan out across Email + SMS + WhatsApp + AI Voice + Web Push.', tips:['Per-channel "configured" status shows which providers are wired','Each contact gets one send per selected channel'] },
    'whatsapp': { title:'WhatsApp Channel', body:'Send and receive WhatsApp messages via Meta Cloud API. Templates, bulk send, and unified inbox routing.', tips:['Requires WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN','Add the App Secret in production for signature verification'] },
    'voice-caller': { title:'AI Voice Caller', body:'Outbound AI voice calls via Vapi.ai — a real AI agent has the conversation, you get the transcript.', tips:['Configure your AI assistant in Vapi first','Webhook captures the full call transcript'] },
    'bookings': { title:'Bookings', body:'Configure your availability and share a public booking page (/book/your-slug).', tips:['Confirmation emails go via Resend','Bookings appear in HubSpot if synced'] },
    'site-builder': { title:'Site Builder', body:'Block-based public landing pages. Drag, drop, publish.', tips:['Pages publish to /lp/your-slug','Pair with Link-in-Bio for full sales funnels'] },
    'linksell': { title:'Link-in-Bio + Stripe', body:'Sell direct from a public bio page (/bio/your-slug). Optional Stripe checkout.', tips:['Without STRIPE_SECRET_KEY, links still work — just no checkout','Webhook updates order status automatically'] },
    'audiences-dynamic': { title:'Dynamic Audiences', body:'Live rule-based contact segments that recompute every 15 minutes. Bind to drip sequences or HubSpot lists.', tips:['Churn-risk audience auto-fires a single-touch win-back drip','Membership writes mirror to HubSpot Static List'] },
    'signal-triggers': { title:'Real-time Signal Triggers', body:'Bridge between observable signals (mention spike, sentiment drop, competitor price, etc.) and journey enrolment.', tips:['Use "Manual fire" to test before going live','Other services call fireSignal() to feed events in'] }
  };
  const HELP_GENERIC = { title:'Help', body:'Every view has hover tooltips, right-click menus where applicable, and the Command Bar (Cmd/Ctrl+K) for quick navigation.', tips:['Use the breadcrumb at the top to navigate up','Check the user manual for screenshots + step-by-step walkthroughs'] };

  const tourBtn = $('ig-tour-btn'), tourOv = $('ig-tour-overlay');
  if (!tourBtn || !tourOv) { console.warn('[onboarding] tour DOM missing — wizard still active, tour disabled'); return; }
  function showTourBtn(){ if (document.querySelector('.nav-link[data-view]')) tourBtn.classList.add('show'); }
  showTourBtn();
  setInterval(showTourBtn, 2500); // safety net for late login

  function openTour(){
    const cur = (typeof currentView === 'string' && currentView) ? currentView : 'home';
    const h = HELP[cur] || HELP_GENERIC;
    $('ig-tour-title').textContent = '💡 ' + h.title;
    $('ig-tour-body').innerHTML = `<div>${_e(h.body)}</div>${h.tips && h.tips.length ? `<div style="margin-top:10px;font-weight:700;color:#0F172A;font-size:.82rem">Tips</div><ul>${h.tips.map(t=>`<li>${_e(t)}</li>`).join('')}</ul>` : ''}<div style="margin-top:14px;padding:10px 12px;background:#F8FAFC;border-radius:8px;font-size:.78rem;color:#64748B">Current view: <code style="background:#fff;padding:2px 6px;border-radius:4px;border:1px solid #E2E8F0">${_e(cur)}</code></div>`;
    tourOv.classList.add('show');
  }
  tourBtn.onclick = openTour;
  $('ig-tour-x').onclick = () => tourOv.classList.remove('show');
  tourOv.addEventListener('click', e => { if (e.target === tourOv) tourOv.classList.remove('show'); });
  $('ig-tour-restart').onclick = () => { tourOv.classList.remove('show'); window.openOnboarding(); };
  $('ig-tour-manual').onclick = () => { window.open('/attached_assets/InfoGenie_User_Manual.pdf','_blank'); };

  // Keyboard shortcut: Shift+? opens the tour for the current view.
  document.addEventListener('keydown', e => { if (e.shiftKey && e.key === '?' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'')) { e.preventDefault(); openTour(); } });
  } // end _init
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();
})();
