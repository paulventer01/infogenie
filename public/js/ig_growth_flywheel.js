'use strict';
/* global navigateTo */

(function () {

const STAGE_META = {
  research:      { icon: '🔍', label: 'Research',      color: '#6366f1', desc: 'Know your market & competitors' },
  gaps:          { icon: '📊', label: 'Gaps',           color: '#f59e0b', desc: 'Spot what you\'re missing' },
  opportunities: { icon: '💡', label: 'Opportunities',  color: '#10b981', desc: 'Find the highest-leverage moves' },
  execute:       { icon: '🚀', label: 'Execute',        color: '#3b82f6', desc: 'Launch campaigns & content' },
  evaluate:      { icon: '📈', label: 'Evaluate',       color: '#8b5cf6', desc: 'Measure what\'s working' },
  report:        { icon: '📬', label: 'Report',         color: '#ec4899', desc: 'Share results, feed back in' },
};
const ORDER = ['research','gaps','opportunities','execute','evaluate','report'];

function _esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function _nav(view) {
  if (typeof navigateTo === 'function') navigateTo(view);
}

function _badge(count) {
  if (!count) return '<span class="fw-badge fw-badge-zero">0</span>';
  return `<span class="fw-badge">${count}</span>`;
}

function _renderStage(id, data, isNext) {
  const m = STAGE_META[id];
  const tools = (data.tools || []).map(t =>
    `<button class="fw-tool-btn" onclick="event.stopPropagation();window._fwNav('${_esc(t.view)}')">${_esc(t.label)}</button>`
  ).join('');
  return `
<div class="fw-stage${isNext ? ' fw-stage-next' : ''}" data-stage="${id}" style="--stage-color:${m.color}" onclick="window._fwNav('${data.view}')">
  <div class="fw-stage-icon">${m.icon}</div>
  <div class="fw-stage-name">${m.label}</div>
  <div class="fw-stage-desc">${m.desc}</div>
  <div class="fw-stage-stat">${_badge(data.count)} <span class="fw-stat-label">${_esc(data.label)}</span></div>
  <div class="fw-stage-tools">${tools}</div>
  ${isNext ? '<div class="fw-next-flag">⚡ Next action</div>' : ''}
</div>`;
}

function _renderFlywheel(data) {
  const { stages, order, nextAction } = data;
  const top = order.slice(0, 3);
  const bot = order.slice(3).reverse();

  const topCards = top.map(id => _renderStage(id, stages[id], nextAction.stage === id)).join(`<div class="fw-arrow-h">→</div>`);
  const botCards = bot.map(id => _renderStage(id, stages[id], nextAction.stage === id)).join(`<div class="fw-arrow-h">→</div>`);

  const totalActivity = order.reduce((s, id) => s + stages[id].count, 0);
  const activeStages = order.filter(id => stages[id].count > 0).length;

  return `
<style>
.fw-wrap { max-width:960px; margin:0 auto; padding:0 16px 40px; }
.fw-hero { text-align:center; margin-bottom:32px; }
.fw-hero h3 { font-size:1.5rem; font-weight:700; margin:0 0 6px; }
.fw-hero p { color:var(--text-muted,#6b7280); margin:0; }
.fw-stats-row { display:flex; gap:16px; justify-content:center; flex-wrap:wrap; margin-bottom:32px; }
.fw-stat-pill { background:var(--card-bg,#fff); border:1px solid var(--border,#e5e7eb); border-radius:12px; padding:12px 24px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,.06); }
.fw-stat-pill .sp-val { font-size:1.6rem; font-weight:800; color:var(--text,#111); }
.fw-stat-pill .sp-lbl { font-size:.75rem; color:var(--text-muted,#6b7280); margin-top:2px; }
.fw-ring { display:flex; flex-direction:column; gap:0; align-items:center; margin-bottom:28px; }
.fw-row { display:flex; align-items:center; gap:0; flex-wrap:wrap; justify-content:center; }
.fw-arrow-h { font-size:1.4rem; color:var(--text-muted,#9ca3af); padding:0 4px; flex-shrink:0; }
.fw-arrow-v { font-size:1.4rem; color:var(--text-muted,#9ca3af); align-self:flex-end; margin-right:10px; }
.fw-arrow-v-left { font-size:1.4rem; color:var(--text-muted,#9ca3af); align-self:flex-start; margin-left:10px; }
.fw-back-row { display:flex; width:100%; justify-content:space-between; align-items:center; padding:4px 24px; }
.fw-back-line { flex:1; border-top:2px dashed var(--border,#d1d5db); margin:0 8px; position:relative; }
.fw-back-line::after { content:''; position:absolute; left:0; top:-5px; border:5px solid transparent; border-right-color:var(--border,#d1d5db); }
.fw-stage { background:var(--card-bg,#fff); border:2px solid var(--stage-color); border-radius:16px; padding:16px 14px; width:220px; cursor:pointer; transition:transform .18s,box-shadow .18s; position:relative; text-align:center; }
.fw-stage:hover { transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,.12); }
.fw-stage-next { box-shadow:0 0 0 3px var(--stage-color); }
.fw-stage-icon { font-size:1.6rem; margin-bottom:4px; }
.fw-stage-name { font-weight:700; font-size:1rem; color:var(--stage-color); margin-bottom:2px; }
.fw-stage-desc { font-size:.72rem; color:var(--text-muted,#6b7280); margin-bottom:8px; min-height:28px; }
.fw-stage-stat { display:flex; align-items:center; justify-content:center; gap:6px; margin-bottom:8px; }
.fw-badge { background:var(--stage-color); color:#fff; border-radius:20px; padding:2px 10px; font-size:.8rem; font-weight:700; }
.fw-badge-zero { background:var(--border,#e5e7eb); color:var(--text-muted,#9ca3af); }
.fw-stat-label { font-size:.72rem; color:var(--text-muted,#6b7280); }
.fw-stage-tools { display:flex; flex-direction:column; gap:4px; }
.fw-tool-btn { background:transparent; border:1px solid var(--stage-color); color:var(--stage-color); border-radius:6px; padding:4px 8px; font-size:.72rem; cursor:pointer; transition:background .15s; text-align:left; }
.fw-tool-btn:hover { background:var(--stage-color); color:#fff; }
.fw-next-flag { position:absolute; top:-11px; left:50%; transform:translateX(-50%); background:var(--stage-color); color:#fff; font-size:.65rem; font-weight:700; border-radius:8px; padding:2px 8px; white-space:nowrap; }
.fw-next-card { background:var(--card-bg,#fff); border:2px solid var(--primary,#4f46e5); border-radius:16px; padding:20px 24px; max-width:600px; margin:0 auto 24px; display:flex; align-items:flex-start; gap:16px; box-shadow:0 4px 16px rgba(79,70,229,.12); }
.fw-next-card .fn-icon { font-size:2rem; flex-shrink:0; }
.fw-next-card .fn-title { font-weight:700; font-size:1rem; margin-bottom:4px; }
.fw-next-card .fn-msg { font-size:.85rem; color:var(--text-muted,#6b7280); margin-bottom:12px; }
.fw-next-card .fn-btn { background:var(--primary,#4f46e5); color:#fff; border:none; border-radius:8px; padding:8px 18px; font-size:.85rem; font-weight:600; cursor:pointer; }
.fw-next-card .fn-btn:hover { opacity:.88; }
.fw-refresh-btn { display:block; margin:0 auto; background:transparent; border:1px solid var(--border,#e5e7eb); color:var(--text-muted,#6b7280); border-radius:8px; padding:7px 18px; font-size:.8rem; cursor:pointer; }
.fw-refresh-btn:hover { border-color:var(--primary,#4f46e5); color:var(--primary,#4f46e5); }
@media(max-width:700px){
  .fw-stage{width:calc(50vw - 40px); padding:12px 8px;}
  .fw-arrow-h{font-size:1rem;}
  .fw-tool-btn{font-size:.65rem;}
}
@media(max-width:480px){
  .fw-stage{width:calc(100vw - 48px); margin:4px 0;}
  .fw-row{flex-direction:column;}
  .fw-arrow-h{transform:rotate(90deg);}
  .fw-back-row{display:none;}
}
</style>
<div class="fw-wrap">
  <div class="fw-hero">
    <h3>⚙️ Performance Growth Flywheel</h3>
    <p>InfoGenie runs this loop autonomously — the more stages active, the faster you grow.</p>
  </div>
  <div class="fw-stats-row">
    <div class="fw-stat-pill"><div class="sp-val">${activeStages}<span style="font-size:1rem;font-weight:400">/6</span></div><div class="sp-lbl">Stages active</div></div>
    <div class="fw-stat-pill"><div class="sp-val">${totalActivity}</div><div class="sp-lbl">Total actions tracked</div></div>
  </div>
  <div class="fw-ring">
    <div class="fw-row">${topCards}</div>
    <div class="fw-back-row">
      <span style="font-size:.75rem;color:var(--text-muted,#9ca3af)">↑ feeds back in</span>
      <div class="fw-back-line"></div>
      <span style="font-size:.75rem;color:var(--text-muted,#9ca3af)">cycle continues ↓</span>
    </div>
    <div class="fw-row">${botCards}</div>
  </div>
  <div class="fw-next-card">
    <div class="fn-icon">${STAGE_META[nextAction.stage].icon}</div>
    <div>
      <div class="fn-title">Next best action — ${STAGE_META[nextAction.stage].label}</div>
      <div class="fn-msg">${_esc(nextAction.message)}</div>
      <button class="fn-btn" onclick="window._fwNav('${_esc(nextAction.view)}')">Go to ${STAGE_META[nextAction.stage].label} →</button>
    </div>
  </div>
  <button class="fw-refresh-btn" onclick="window._fwRefresh()">↻ Refresh flywheel</button>
</div>`;
}

async function buildFlywheel() {
  const wrap = document.getElementById('flywheelWrap');
  if (!wrap) return;

  window._fwNav = (view) => _nav(view);

  wrap.innerHTML = '<div style="text-align:center;padding:60px 0;color:var(--text-muted,#6b7280)">⚙️ Loading flywheel…</div>';

  const load = async () => {
    try {
      const r = await fetch('/api/flywheel/summary');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      wrap.innerHTML = _renderFlywheel(data);
    } catch (e) {
      wrap.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444">Failed to load flywheel: ${_esc(e.message)}</div>`;
    }
  };

  window._fwRefresh = load;
  await load();
}

window.buildFlywheel = buildFlywheel;

})();
