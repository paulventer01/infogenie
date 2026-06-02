// ============================================================================
// InfoGenie — extracted feature module: Journey Builder + Signal Triggers + Omnichannel Composer
// ----------------------------------------------------------------------------
// PART OF THE app.js SPLIT (see public/js/README.md). This file was carved out
// of the monolithic app.js with NO behavior change. Conventions:
//   • Classic <script> (NOT an ES module). Loaded from index.html AFTER app.js
//     with its own ?v= cache-bust string, so editing this feature only forces a
//     re-download of THIS file, not the whole 50k-line app.js.
//   • Every public entry point stays attached to window (e.g. window.buildX),
//     exactly as before, so navigateTo()'s dispatch and inline onclick= handlers
//     keep resolving. Feature-private helpers stay inside the IIFE.
//   • Shared globals (showToast, navigateTo, _esc, _safeUrl, analysisData, …)
//     are defined in app.js and are available here at call time.
// ============================================================================

/* ──────────────────────────────────────────────────────────────────────────
   Customer Journey Builder + Real-time Signal Triggers + Omnichannel Composer
   Three new feature surfaces. Each renders into its own view container.
   ────────────────────────────────────────────────────────────────────────── */
(function(){
  function _esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  async function _f(url, opts){
    const r = await fetch(url, Object.assign({headers:{'Content-Type':'application/json'}}, opts||{}, opts&&opts.body?{body:typeof opts.body==='string'?opts.body:JSON.stringify(opts.body)}:{}));
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(j.error||('HTTP '+r.status));
    return j;
  }
  function _toast(msg, kind){
    if (typeof showToast==='function') return showToast((kind==='err'?'⚠️ ':'✓ ')+msg);
    alert(msg);
  }

  /* ═══════════ JOURNEY BUILDER ═══════════ */
  window.buildJourneyBuilder = async function(){
    const wrap = document.getElementById('journeyBuilderWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="max-width:1200px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
          <div>
            <h1 style="margin:0;font-size:1.6rem;color:#0F172A">🛤️ Customer Journey Builder</h1>
            <p style="margin:6px 0 0;color:#64748B;font-size:0.92rem">Map a sequence of triggers, waits, conditions and channel sends. Each enrolled contact walks through it automatically.</p>
          </div>
          <button id="jb_new" style="padding:10px 18px;background:linear-gradient(135deg,#06B6D4,#0EA5E9);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer">+ New Journey</button>
        </div>
        <div id="jb_list" style="display:grid;gap:14px"></div>
        <div id="jb_editor" style="display:none;margin-top:24px;background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:24px"></div>
      </div>`;
    document.getElementById('jb_new').onclick = ()=> openEditor(null);

    async function refresh(){
      const list = document.getElementById('jb_list');
      list.innerHTML = '<div style="color:#94A3B8">Loading…</div>';
      try{
        const {journeys=[]} = await _f('/api/journeys');
        if (!journeys.length){ list.innerHTML = '<div style="background:#fff;border:1px dashed #CBD5E1;border-radius:12px;padding:32px;text-align:center;color:#64748B">No journeys yet. Click <strong>+ New Journey</strong> to create your first one.</div>'; return; }
        list.innerHTML = journeys.map(j=>`
          <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:18px;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center">
            <div>
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
                <strong style="font-size:1.05rem;color:#0F172A">${_esc(j.name)}</strong>
                <span style="padding:3px 9px;border-radius:99px;font-size:0.7rem;font-weight:700;background:${j.status==='active'?'#DCFCE7':j.status==='paused'?'#FEF3C7':'#F1F5F9'};color:${j.status==='active'?'#15803D':j.status==='paused'?'#A16207':'#475569'}">${j.status.toUpperCase()}</span>
              </div>
              <div style="color:#64748B;font-size:0.85rem">${_esc(j.description||'No description')} · ${(j.nodes||[]).length} steps · started ${j.stats?.started||0} · completed ${j.stats?.completed||0}</div>
            </div>
            <div style="display:flex;gap:8px">
              <button data-edit="${j.id}" style="padding:7px 13px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.82rem">Edit</button>
              <button data-toggle="${j.id}" data-status="${j.status}" style="padding:7px 13px;background:${j.status==='active'?'#FEF3C7':'#DCFCE7'};border:1px solid ${j.status==='active'?'#FBBF24':'#86EFAC'};border-radius:8px;cursor:pointer;font-weight:600;font-size:0.82rem">${j.status==='active'?'Pause':'Activate'}</button>
              <button data-start="${j.id}" style="padding:7px 13px;background:#0EA5E9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.82rem">Test Run</button>
              <button data-del="${j.id}" style="padding:7px 11px;background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.82rem">✕</button>
            </div>
          </div>`).join('');
        list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(b.dataset.edit));
        list.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async ()=>{
          const ns = b.dataset.status==='active'?'paused':'active';
          try{ await _f('/api/journeys/'+b.dataset.toggle+'/status',{method:'POST',body:{status:ns}}); _toast('Status → '+ns); refresh(); }catch(e){_toast(e.message,'err');}
        });
        list.querySelectorAll('[data-start]').forEach(b=>b.onclick=async ()=>{
          const email = prompt('Test contact email:','test@example.com'); if (!email) return;
          try{ await _f('/api/journeys/'+b.dataset.start+'/start',{method:'POST',body:{contact_email:email}}); _toast('Test enrolled ✓'); refresh(); }catch(e){_toast(e.message,'err');}
        });
        list.querySelectorAll('[data-del]').forEach(b=>b.onclick=async ()=>{
          if (!confirm('Delete this journey and all run history?')) return;
          try{ await _f('/api/journeys/'+b.dataset.del,{method:'DELETE'}); _toast('Deleted'); refresh(); }catch(e){_toast(e.message,'err');}
        });
      }catch(e){ list.innerHTML = '<div style="color:#B91C1C">'+_esc(e.message)+'</div>'; }
    }

    async function openEditor(id){
      const ed = document.getElementById('jb_editor');
      ed.style.display = 'block';
      let journey = { id:null, name:'New Journey', description:'', status:'draft', trigger_type:'manual', nodes:[{id:'n1',type:'trigger',config:{}}], edges:[] };
      if (id){
        try{ const r = await _f('/api/journeys/'+id); journey = r.journey; }catch(e){_toast(e.message,'err');}
      }
      function render(){
        ed.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:18px">
            <div style="flex:1">
              <input id="jed_name" value="${_esc(journey.name)}" placeholder="Journey name" style="width:100%;padding:10px;font-size:1.1rem;font-weight:700;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:8px">
              <textarea id="jed_desc" rows="2" placeholder="What does this journey do?" style="width:100%;padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-family:inherit">${_esc(journey.description||'')}</textarea>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <button id="jed_save" style="padding:10px 18px;background:linear-gradient(135deg,#06B6D4,#0EA5E9);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">💾 Save</button>
              <button id="jed_close" style="padding:8px 18px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;cursor:pointer">Close</button>
            </div>
          </div>
          <h3 style="margin:0 0 12px;color:#0F172A;font-size:1rem">Steps (top → bottom)</h3>
          <div id="jed_nodes" style="display:grid;gap:10px;margin-bottom:14px"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button data-add="wait" style="padding:8px 14px;background:#FEF3C7;border:1px solid #FBBF24;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85rem">+ Wait</button>
            <button data-add="condition" style="padding:8px 14px;background:#DBEAFE;border:1px solid #60A5FA;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85rem">+ Condition (if/then)</button>
            <button data-add="action" style="padding:8px 14px;background:#DCFCE7;border:1px solid #86EFAC;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85rem">+ Send (Email/SMS/WhatsApp/Voice/Push/Tag)</button>
          </div>`;
        const nodesDiv = ed.querySelector('#jed_nodes');
        nodesDiv.innerHTML = journey.nodes.map((n,idx)=>{
          const c = n.config||{};
          if (n.type==='trigger') return `
            <div style="background:#F0F9FF;border:2px solid #06B6D4;border-radius:10px;padding:14px">
              <div style="font-weight:700;color:#0369A1;margin-bottom:6px">⚡ Trigger (entry point)</div>
              <div style="color:#475569;font-size:0.85rem">Contacts enter here. Trigger via the "Test Run" button, an enrolled audience, or a Signal Trigger pointed at this journey.</div>
            </div>`;
          if (n.type==='wait') return `
            <div style="background:#FFFBEB;border:1px solid #FBBF24;border-radius:10px;padding:14px;display:flex;gap:12px;align-items:center">
              <span style="font-weight:700;color:#A16207;width:80px">⏳ Wait</span>
              <input type="number" data-nidx="${idx}" data-nkey="minutes" value="${c.minutes||60}" min="1" style="width:100px;padding:6px 8px;border:1px solid #FBBF24;border-radius:6px"> minutes
              <button data-del-node="${idx}" style="margin-left:auto;padding:5px 10px;background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;border-radius:6px;cursor:pointer;font-weight:600">✕</button>
            </div>`;
          if (n.type==='condition') return `
            <div style="background:#EFF6FF;border:1px solid #60A5FA;border-radius:10px;padding:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span style="font-weight:700;color:#1D4ED8;width:80px">🔀 If</span>
              <input data-nidx="${idx}" data-nkey="key" value="${_esc(c.key||'')}" placeholder="contact field (e.g. country)" style="flex:1;min-width:140px;padding:6px 8px;border:1px solid #60A5FA;border-radius:6px">
              <span>=</span>
              <input data-nidx="${idx}" data-nkey="equals" value="${_esc(c.equals||'')}" placeholder="value (e.g. US)" style="flex:1;min-width:120px;padding:6px 8px;border:1px solid #60A5FA;border-radius:6px">
              <button data-del-node="${idx}" style="padding:5px 10px;background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;border-radius:6px;cursor:pointer;font-weight:600">✕</button>
            </div>`;
          // action
          return `
            <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:10px;padding:14px;display:grid;grid-template-columns:80px 140px 1fr auto;gap:8px;align-items:start">
              <span style="font-weight:700;color:#15803D;align-self:center">📤 Send</span>
              <select data-nidx="${idx}" data-nkey="channel" style="padding:6px 8px;border:1px solid #86EFAC;border-radius:6px">
                ${['email','sms','whatsapp','voice','webpush','tag'].map(o=>`<option value="${o}" ${c.channel===o?'selected':''}>${o}</option>`).join('')}
              </select>
              <div style="display:flex;flex-direction:column;gap:6px">
                <input data-nidx="${idx}" data-nkey="subject" value="${_esc(c.subject||'')}" placeholder="Subject / push title (email + push)" style="padding:6px 8px;border:1px solid #86EFAC;border-radius:6px">
                <textarea data-nidx="${idx}" data-nkey="message" rows="2" placeholder="Message body / SMS text / voice script / tag name" style="padding:6px 8px;border:1px solid #86EFAC;border-radius:6px;font-family:inherit">${_esc(c.message||'')}</textarea>
              </div>
              <button data-del-node="${idx}" style="padding:5px 10px;background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;border-radius:6px;cursor:pointer;font-weight:600;align-self:start">✕</button>
            </div>`;
        }).join('');

        ed.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{
          const t = b.dataset.add;
          const id = 'n'+(journey.nodes.length+1)+'_'+Math.random().toString(36).slice(2,5);
          const cfg = t==='wait'?{minutes:60}:t==='condition'?{key:'',equals:''}:{channel:'email',subject:'',message:''};
          // Wire edge from previous node → this one
          const prev = journey.nodes[journey.nodes.length-1];
          journey.nodes.push({id, type:t, config:cfg});
          if (prev) journey.edges.push({from:prev.id, to:id});
          render();
        });
        ed.querySelectorAll('[data-del-node]').forEach(b=>b.onclick=()=>{
          const i = +b.dataset.delNode;
          const removed = journey.nodes[i];
          journey.nodes.splice(i,1);
          journey.edges = journey.edges.filter(e=>e.from!==removed.id && e.to!==removed.id);
          // Re-link sequential
          journey.edges = journey.nodes.slice(0,-1).map((n,k)=>({from:n.id, to:journey.nodes[k+1].id}));
          render();
        });
        ed.querySelectorAll('[data-nidx]').forEach(inp=>{
          inp.onchange = ()=>{
            const i = +inp.dataset.nidx, k = inp.dataset.nkey;
            journey.nodes[i].config = journey.nodes[i].config||{};
            journey.nodes[i].config[k] = inp.type==='number'?+inp.value:inp.value;
          };
        });
        ed.querySelector('#jed_close').onclick = ()=>{ ed.style.display='none'; };
        ed.querySelector('#jed_save').onclick = async ()=>{
          journey.name = ed.querySelector('#jed_name').value.trim();
          journey.description = ed.querySelector('#jed_desc').value;
          if (!journey.name){ _toast('Name required','err'); return; }
          // Make sure edges form a sequential chain
          journey.edges = journey.nodes.slice(0,-1).map((n,k)=>({from:n.id, to:journey.nodes[k+1].id}));
          try{ const r = await _f('/api/journeys',{method:'POST',body:journey}); journey.id = r.id; _toast('Saved'); refresh(); }
          catch(e){ _toast(e.message,'err'); }
        };
      }
      render();
    }

    refresh();
  };

  /* ═══════════ SIGNAL TRIGGERS ═══════════ */
  window.buildSignalTriggers = async function(){
    const wrap = document.getElementById('signalTriggersWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="max-width:1100px;margin:0 auto">
        <div style="margin-bottom:24px">
          <h1 style="margin:0;font-size:1.6rem;color:#0F172A">⚡ Real-time Signal Triggers</h1>
          <p style="margin:6px 0 0;color:#64748B;font-size:0.92rem">When something happens out in the wild — a mention spike, a competitor price change, a bad review — automatically enrol affected contacts into a customer journey.</p>
        </div>
        <div style="background:#fff;border:1px solid #FBBF24;border-radius:14px;padding:20px;margin-bottom:20px">
          <h3 style="margin:0 0 14px;color:#92400E;font-size:1rem">+ New Trigger</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <input id="st_name" placeholder="Trigger name (e.g. 'High-volume mentions → win-back')" style="padding:9px;border:1px solid #FBBF24;border-radius:8px">
            <select id="st_type" style="padding:9px;border:1px solid #FBBF24;border-radius:8px"></select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
            <input id="st_minval" type="number" placeholder="Optional: minValue threshold" style="padding:9px;border:1px solid #FBBF24;border-radius:8px">
            <input id="st_keyword" placeholder="Optional: keyword filter" style="padding:9px;border:1px solid #FBBF24;border-radius:8px">
            <select id="st_journey" style="padding:9px;border:1px solid #FBBF24;border-radius:8px"></select>
          </div>
          <button id="st_add" style="padding:10px 18px;background:#F59E0B;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Create Trigger</button>
        </div>
        <h3 style="margin:0 0 12px;color:#0F172A;font-size:1.05rem">Active triggers</h3>
        <div id="st_list" style="display:grid;gap:10px;margin-bottom:24px"></div>
        <div style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:20px">
          <h3 style="margin:0 0 12px;color:#0F172A;font-size:1rem">🧪 Manually fire a signal (test)</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:center">
            <select id="st_fire_type" style="padding:9px;border:1px solid #E2E8F0;border-radius:8px"></select>
            <input id="st_fire_email" placeholder="contact email" style="padding:9px;border:1px solid #E2E8F0;border-radius:8px">
            <input id="st_fire_value" type="number" placeholder="value (optional)" style="padding:9px;border:1px solid #E2E8F0;border-radius:8px">
            <button id="st_fire" style="padding:9px 16px;background:#0EA5E9;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Fire 🚀</button>
          </div>
        </div>
      </div>`;

    const [{types=[]}, {journeys=[]}] = await Promise.all([_f('/api/signal-triggers/types'), _f('/api/journeys')]);
    const fillTypes = sel => { sel.innerHTML = types.map(t=>`<option value="${t.id}">${_esc(t.label)}</option>`).join(''); };
    fillTypes(document.getElementById('st_type'));
    fillTypes(document.getElementById('st_fire_type'));
    document.getElementById('st_journey').innerHTML = '<option value="">— Pick a journey to launch —</option>'+journeys.map(j=>`<option value="${j.id}">${_esc(j.name)}</option>`).join('');

    document.getElementById('st_add').onclick = async ()=>{
      const name = document.getElementById('st_name').value.trim();
      const signal_type = document.getElementById('st_type').value;
      const journey_id = document.getElementById('st_journey').value;
      if (!name){ _toast('Name required','err'); return; }
      if (!journey_id){ _toast('Pick a journey','err'); return; }
      const condition = {};
      const mv = document.getElementById('st_minval').value; if (mv) condition.minValue = +mv;
      const kw = document.getElementById('st_keyword').value.trim(); if (kw) condition.keyword = kw;
      try{ await _f('/api/signal-triggers',{method:'POST',body:{name,signal_type,condition,journey_id,enabled:true}}); _toast('Trigger created'); refresh(); }
      catch(e){_toast(e.message,'err');}
    };
    document.getElementById('st_fire').onclick = async ()=>{
      const signal_type = document.getElementById('st_fire_type').value;
      const email = document.getElementById('st_fire_email').value.trim();
      const value = document.getElementById('st_fire_value').value;
      try{ const r = await _f('/api/signal-triggers/fire',{method:'POST',body:{signal_type, payload:{email, value:value?+value:undefined}}}); _toast('Fired · matched '+r.matched+' triggers'); }
      catch(e){_toast(e.message,'err');}
    };

    async function refresh(){
      const list = document.getElementById('st_list');
      try{
        const {triggers=[]} = await _f('/api/signal-triggers');
        if (!triggers.length){ list.innerHTML='<div style="background:#fff;border:1px dashed #CBD5E1;border-radius:10px;padding:20px;text-align:center;color:#64748B">No triggers yet</div>'; return; }
        list.innerHTML = triggers.map(t=>`
          <div style="background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:14px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center">
            <div>
              <strong style="color:#0F172A">${_esc(t.name)}</strong>
              <div style="color:#64748B;font-size:0.84rem;margin-top:3px">${_esc(t.signal_type)} → journey ${_esc(t.journey_id||'(none)')} · fired ${t.fire_count||0}× ${t.last_fired_at?'· last '+new Date(t.last_fired_at).toLocaleString():''}</div>
            </div>
            <button data-del="${t.id}" style="padding:6px 12px;background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;border-radius:7px;cursor:pointer;font-weight:600">Delete</button>
          </div>`).join('');
        list.querySelectorAll('[data-del]').forEach(b=>b.onclick=async ()=>{
          if (!confirm('Delete this trigger?')) return;
          try{ await _f('/api/signal-triggers/'+b.dataset.del,{method:'DELETE'}); refresh(); }catch(e){_toast(e.message,'err');}
        });
      }catch(e){ list.innerHTML='<div style="color:#B91C1C">'+_esc(e.message)+'</div>'; }
    }
    refresh();
  };

  /* ═══════════ OMNICHANNEL COMPOSER ═══════════ */
  window.buildOmnichannel = async function(){
    const wrap = document.getElementById('omnichannelWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="max-width:1100px;margin:0 auto">
        <div style="margin-bottom:24px">
          <h1 style="margin:0;font-size:1.6rem;color:#0F172A">📡 Omnichannel Composer</h1>
          <p style="margin:6px 0 0;color:#64748B;font-size:0.92rem">Write your message once. Pick which channels to send through. We fan it out — Email · SMS · WhatsApp · AI Voice Call · Web Push.</p>
        </div>
        <div id="oc_channels" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px"></div>
        <div style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:22px">
          <label style="display:block;font-weight:700;color:#0F172A;margin-bottom:6px">Subject / Push Title</label>
          <input id="oc_subject" placeholder="Used by Email + Web Push" style="width:100%;padding:10px;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:14px">
          <label style="display:block;font-weight:700;color:#0F172A;margin-bottom:6px">Message Body</label>
          <textarea id="oc_body" rows="5" placeholder="The message — kept short for SMS, used as the script for AI Voice." style="width:100%;padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-family:inherit;margin-bottom:14px"></textarea>
          <label style="display:block;font-weight:700;color:#0F172A;margin-bottom:6px">Recipients (one per line — <code>email,phone</code>)</label>
          <textarea id="oc_recips" rows="4" placeholder="alice@example.com,+15551234567&#10;bob@example.com,+15559876543" style="width:100%;padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-family:monospace;font-size:0.86rem;margin-bottom:14px"></textarea>
          <div style="display:flex;gap:10px;align-items:center">
            <button id="oc_send" style="padding:12px 22px;background:linear-gradient(135deg,#6366F1,#8B5CF6);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer">🚀 Send to selected channels</button>
            <span id="oc_status" style="color:#64748B;font-size:0.86rem"></span>
          </div>
          <div id="oc_results" style="margin-top:18px"></div>
        </div>
      </div>`;
    const {channels=[]} = await _f('/api/omnichannel/channels');
    document.getElementById('oc_channels').innerHTML = channels.map(c=>`
      <label style="background:#fff;border:2px solid ${c.configured?'#86EFAC':'#E2E8F0'};border-radius:12px;padding:14px;cursor:pointer;display:block">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <input type="checkbox" data-ch="${c.id}" ${c.configured?'checked':''}>
          <strong style="color:#0F172A">${_esc(c.label)}</strong>
        </div>
        <div style="font-size:0.74rem;color:${c.configured?'#15803D':'#94A3B8'}">${c.configured?'✓ Configured · '+_esc(c.via):'Not configured · '+_esc(c.via)}</div>
      </label>`).join('');

    document.getElementById('oc_send').onclick = async ()=>{
      const channels = Array.from(document.querySelectorAll('#oc_channels input:checked')).map(i=>i.dataset.ch);
      if (!channels.length){ _toast('Pick at least one channel','err'); return; }
      const subject = document.getElementById('oc_subject').value;
      const body = document.getElementById('oc_body').value.trim();
      if (!body){ _toast('Message body required','err'); return; }
      const contacts = document.getElementById('oc_recips').value.split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
        const [a,b] = line.split(',').map(s=>(s||'').trim());
        const c = {};
        if (a && a.includes('@')) c.email = a; else if (a) c.phone = a;
        if (b && b.includes('@')) c.email = b; else if (b) c.phone = b;
        return c;
      });
      if (!contacts.length && !channels.includes('webpush')){ _toast('Add at least one recipient (or pick Web Push to broadcast)','err'); return; }
      const status = document.getElementById('oc_status'); status.textContent = 'Sending…';
      try{
        const r = await _f('/api/omnichannel/send',{method:'POST',body:{channels, contacts: contacts.length?contacts:[{}], subject, body}});
        const ok = r.results.filter(x=>x.ok).length, fail = r.results.length-ok;
        status.textContent = `Done · ${ok} ok · ${fail} failed`;
        document.getElementById('oc_results').innerHTML = `<details style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px"><summary style="cursor:pointer;font-weight:600">View ${r.results.length} send results</summary><pre style="margin:10px 0 0;white-space:pre-wrap;font-size:0.78rem;color:#475569">${_esc(JSON.stringify(r.results,null,2))}</pre></details>`;
      }catch(e){ status.textContent = ''; _toast(e.message,'err'); }
    };
  };
})();
