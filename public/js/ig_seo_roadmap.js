'use strict';
/* global navigateTo */

(function () {

const STEPS = [
  {
    id: 'tools',
    num: '01',
    title: 'Set Up SEO Tools',
    desc: 'Connect your AI providers and configure InfoGenie as your SEO command centre.',
    icon: '🛠️',
    color: '#6366f1',
    tools: [{ label: '⚙️ AI Providers', view: 'ai-providers' }, { label: '📊 Web Analytics', view: 'web-analytics' }],
  },
  {
    id: 'keywords',
    num: '02',
    title: 'Keyword Research',
    desc: 'Find high-intent keywords your audience is actively searching for.',
    icon: '🔑',
    color: '#f59e0b',
    tools: [{ label: '🔑 Keyword Explorer', view: 'keyword-explorer' }, { label: '📈 SERP Tracker', view: 'serp-tracker' }],
  },
  {
    id: 'audit',
    num: '03',
    title: 'Website SEO Audit',
    desc: 'Check for technical issues, broken links, page speed, and mobile-friendliness.',
    icon: '🔍',
    color: '#10b981',
    tools: [{ label: '🕸️ Multi-page Crawler', view: 'seo-crawler' }, { label: '📋 On-Page Audit', view: 'seo-auditor' }],
  },
  {
    id: 'onpage',
    num: '04',
    title: 'On-Page SEO',
    desc: 'Optimise titles, meta descriptions, headings, URLs, images, and internal links.',
    icon: '✍️',
    color: '#3b82f6',
    tools: [{ label: '📝 Content Scorer', view: 'content-score' }, { label: '🔗 Internal Link Suggester', view: 'link-suggester' }],
  },
  {
    id: 'content',
    num: '05',
    title: 'Create Quality Content',
    desc: 'Publish helpful, original content that solves your audience\'s problems.',
    icon: '📝',
    color: '#8b5cf6',
    tools: [{ label: '📅 Content Calendar', view: 'content-calendar' }, { label: '🌍 GEO Audit', view: 'geo-audit' }],
  },
  {
    id: 'technical',
    num: '06',
    title: 'Technical SEO',
    desc: 'Fix crawl errors, improve site speed, set up sitemap, robots.txt, and HTTPS.',
    icon: '⚙️',
    color: '#ec4899',
    tools: [{ label: '⚡ Web Vitals', view: 'web-vitals' }, { label: '🧱 Tech Stack Detector', view: 'tech-stack' }],
  },
  {
    id: 'authority',
    num: '07',
    title: 'Build Authority',
    desc: 'Earn quality backlinks through guest posts, digital PR, citations, and outreach.',
    icon: '🏆',
    color: '#14b8a6',
    tools: [{ label: '🔗 Link Prospector', view: 'link-prospector' }, { label: '📡 Backlink Monitor', view: 'backlink-monitor' }],
  },
  {
    id: 'local',
    num: '08',
    title: 'Local SEO',
    desc: 'Optimise Google Business Profile, build local citations, and gather reviews.',
    icon: '📍',
    color: '#f97316',
    tools: [{ label: '📍 Local Lead Finder', view: 'local-leads' }, { label: '🗺️ Local SEO', view: 'local-seo' }],
  },
  {
    id: 'track',
    num: '09',
    title: 'Track & Improve',
    desc: 'Monitor rankings, traffic, and conversions. Analyse and keep iterating.',
    icon: '📈',
    color: '#0ea5e9',
    tools: [{ label: '📈 SERP Tracker', view: 'serp-tracker' }, { label: '📊 Web Analytics', view: 'web-analytics' }],
  },
];

function _esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _nav(view) { if (typeof navigateTo === 'function') navigateTo(view); }

let _progress = {};

function _statusLabel(s) {
  if (s === 'done')        return '<span class="sr-status sr-done">✓ Done</span>';
  if (s === 'in_progress') return '<span class="sr-status sr-wip">⏳ In progress</span>';
  return '<span class="sr-status sr-todo">○ Not started</span>';
}

function _renderStep(step, prog) {
  const st = prog?.status || 'todo';
  const isDone = st === 'done';
  const isWip  = st === 'in_progress';
  const toolBtns = step.tools.map(t =>
    `<button class="sr-tool-btn" onclick="event.stopPropagation();window._srNav('${_esc(t.view)}')">${_esc(t.label)}</button>`
  ).join('');

  return `
<div class="sr-step${isDone ? ' sr-step-done' : isWip ? ' sr-step-wip' : ''}" style="--step-color:${step.color}" data-step-id="${step.id}">
  <div class="sr-step-left">
    <div class="sr-num" style="background:${isDone ? step.color : 'var(--border,#e5e7eb)'}; color:${isDone ? '#fff' : 'var(--text-muted,#9ca3af)'}">
      ${isDone ? '✓' : step.num}
    </div>
  </div>
  <div class="sr-step-body">
    <div class="sr-step-header">
      <span class="sr-step-icon">${step.icon}</span>
      <span class="sr-step-title">${_esc(step.title)}</span>
      ${_statusLabel(st)}
    </div>
    <div class="sr-step-desc">${_esc(step.desc)}</div>
    <div class="sr-step-footer">
      <div class="sr-tools">${toolBtns}</div>
      <div class="sr-actions">
        <button class="sr-status-btn" onclick="window._srCycle('${step.id}','${st}')">
          ${st === 'todo' ? 'Mark in progress' : st === 'in_progress' ? 'Mark done ✓' : 'Reset'}
        </button>
      </div>
    </div>
  </div>
</div>`;
}

function _render() {
  const doneCount = STEPS.filter(s => _progress[s.id]?.status === 'done').length;
  const wipCount  = STEPS.filter(s => _progress[s.id]?.status === 'in_progress').length;
  const pct = Math.round((doneCount / STEPS.length) * 100);

  const barColour = pct === 100 ? '#10b981' : pct > 50 ? '#3b82f6' : '#6366f1';

  const stepsHtml = STEPS.map(s => _renderStep(s, _progress[s.id])).join('');

  return `
<style>
.sr-wrap { max-width:760px; margin:0 auto; padding:0 16px 56px; }
.sr-header { text-align:center; margin-bottom:28px; }
.sr-header h3 { font-size:1.4rem; font-weight:700; margin:0 0 6px; }
.sr-header p { color:var(--text-muted,#6b7280); font-size:.9rem; margin:0; }
.sr-progress-card { background:var(--card-bg,#fff); border:1px solid var(--border,#e5e7eb); border-radius:16px; padding:20px 24px; margin-bottom:28px; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.sr-progress-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.sr-progress-label { font-weight:600; font-size:.95rem; }
.sr-progress-pct { font-size:1.5rem; font-weight:800; color:${barColour}; }
.sr-bar-bg { background:var(--border,#e5e7eb); border-radius:8px; height:10px; overflow:hidden; }
.sr-bar-fill { height:100%; border-radius:8px; background:${barColour}; width:${pct}%; transition:width .5s; }
.sr-progress-sub { display:flex; gap:16px; margin-top:10px; font-size:.8rem; color:var(--text-muted,#6b7280); }
.sr-progress-sub span b { color:var(--text,#111); }
.sr-steps { display:flex; flex-direction:column; gap:12px; }
.sr-step { background:var(--card-bg,#fff); border:1px solid var(--border,#e5e7eb); border-left:4px solid var(--step-color); border-radius:0 12px 12px 0; padding:16px; display:flex; gap:14px; transition:box-shadow .18s; }
.sr-step:hover { box-shadow:0 4px 16px rgba(0,0,0,.08); }
.sr-step-done { opacity:.75; border-left-color:var(--step-color); background:var(--surface,#f9fafb); }
.sr-step-wip { box-shadow:0 0 0 2px var(--step-color); }
.sr-step-left { flex-shrink:0; }
.sr-num { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:.8rem; transition:background .3s,color .3s; }
.sr-step-body { flex:1; min-width:0; }
.sr-step-header { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px; }
.sr-step-icon { font-size:1.1rem; }
.sr-step-title { font-weight:700; font-size:.95rem; }
.sr-status { border-radius:10px; padding:2px 8px; font-size:.7rem; font-weight:600; margin-left:auto; white-space:nowrap; }
.sr-done { background:#d1fae5; color:#065f46; }
.sr-wip  { background:#fef3c7; color:#92400e; }
.sr-todo { background:var(--surface,#f3f4f6); color:var(--text-muted,#6b7280); }
.sr-step-desc { font-size:.82rem; color:var(--text-muted,#6b7280); margin-bottom:10px; line-height:1.5; }
.sr-step-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
.sr-tools { display:flex; gap:6px; flex-wrap:wrap; }
.sr-tool-btn { background:transparent; border:1px solid var(--step-color); color:var(--step-color); border-radius:6px; padding:4px 10px; font-size:.72rem; cursor:pointer; transition:background .15s; }
.sr-tool-btn:hover { background:var(--step-color); color:#fff; }
.sr-actions { flex-shrink:0; }
.sr-status-btn { background:var(--surface,#f3f4f6); border:1px solid var(--border,#e5e7eb); color:var(--text,#374151); border-radius:7px; padding:5px 12px; font-size:.75rem; font-weight:600; cursor:pointer; }
.sr-status-btn:hover { border-color:var(--step-color); color:var(--step-color); }
.sr-congrats { text-align:center; padding:16px; background:linear-gradient(135deg,#d1fae5,#a7f3d0); border-radius:12px; margin-bottom:20px; font-weight:700; color:#065f46; font-size:1rem; display:${pct===100?'block':'none'}; }
</style>
<div class="sr-wrap">
  <div class="sr-header">
    <h3>🗺️ SEO Roadmap</h3>
    <p>A step-by-step system to rank your website — track progress and jump to each InfoGenie tool.</p>
  </div>
  <div class="sr-progress-card">
    <div class="sr-progress-top">
      <div class="sr-progress-label">Your SEO progress</div>
      <div class="sr-progress-pct">${pct}%</div>
    </div>
    <div class="sr-bar-bg"><div class="sr-bar-fill"></div></div>
    <div class="sr-progress-sub">
      <span><b>${doneCount}</b> completed</span>
      <span><b>${wipCount}</b> in progress</span>
      <span><b>${STEPS.length - doneCount - wipCount}</b> remaining</span>
    </div>
  </div>
  <div class="sr-congrats">🎉 All 9 steps complete — your SEO system is fully set up!</div>
  <div class="sr-steps">${stepsHtml}</div>
</div>`;
}

async function _setStatus(stepId, status) {
  try {
    await fetch('/api/seo-roadmap/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId, status }),
    });
    _progress[stepId] = { status, updatedAt: new Date().toISOString() };
  } catch (_) {}
}

async function buildSeoRoadmap() {
  const wrap = document.getElementById('seoRoadmapWrap');
  if (!wrap) return;

  window._srNav = (view) => _nav(view);

  window._srCycle = async (stepId, current) => {
    const next = current === 'todo' ? 'in_progress' : current === 'in_progress' ? 'done' : 'todo';
    await _setStatus(stepId, next);
    wrap.innerHTML = _render();
  };

  wrap.innerHTML = '<div style="text-align:center;padding:60px 0;color:var(--text-muted,#6b7280)">🗺️ Loading roadmap…</div>';

  try {
    const r = await fetch('/api/seo-roadmap/progress');
    if (r.ok) {
      const data = await r.json();
      _progress = data.progress || {};
    }
  } catch (_) {}

  wrap.innerHTML = _render();
}

window.buildSeoRoadmap = buildSeoRoadmap;

})();
