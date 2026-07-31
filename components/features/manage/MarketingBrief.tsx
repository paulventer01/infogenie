"use client";

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { apiPut } from '@/lib/api';
import { showToast } from '@/hooks/useToast';
import { goToView } from '@/lib/nav';

// ── Types ────────────────────────────────────────────────────────────────────

interface BriefSignal {
  kind: 'warning' | 'win' | 'opportunity' | 'info' | 'risk' | 'foresight';
  pillar: string;
  headline: string;
  detail?: string;
  action_view?: string;
  horizon?: string;
}

interface BriefSection {
  title: string;
  kind: 'warning' | 'win' | 'opportunity' | 'info' | 'risk' | 'foresight';
  items: string[];
}

interface Brief {
  id: number;
  brand: string;
  headline: string;
  greeting: string;
  signals: BriefSignal[];
  sections: BriefSection[];
  actions?: BriefAction[];
  active_pillars: string[];
  generated_by: string;
  created_at: string;
  delivered_to: { channel: string; at: string; ok: boolean }[];
}

interface BriefAction {
  label?: string;
  rationale?: string;
  expected_impact?: string;
  why_best?: string;
  view?: string;
  priority?: number;
}

interface TodoAction {
  key: string;
  answer: string;
  recommendation: string;
  whyBest: string;
  followThrough: string;
  view: string;
  impact: string;
  source: "brief" | "competitive" | "decision";
  priority: number;
}

interface DigestSection { title: string; body: string }
interface Digest {
  id: number;
  headline: string;
  summary_md: string;
  sections: DigestSection[];
  generated_by: string;
  created_at: string;
}

interface Rec {
  id: number;
  category: string;
  title: string;
  recommendation: string;
  expected_impact?: string;
  confidence_pct: number;
  cost_estimate?: string;
  time_to_result?: string;
  priority_score: number;
  data_sources?: string;
  why_best?: string;
}

interface MergedPayload {
  ok: boolean;
  cadence: Cadence;
  brief: Brief | null;
  digest: Digest | null;
  recommendations: Rec[];
}

type Cadence = 'weekly' | 'daily' | 'daily-per-client';
interface CadenceMeta { label: string; plan: string }
const CADENCES: Record<Cadence, CadenceMeta> = {
  weekly:             { label: 'Weekly',          plan: 'Solo'   },
  daily:              { label: 'Daily',            plan: 'Growth' },
  'daily-per-client': { label: 'Daily per-client', plan: 'Agency' },
};

// ── Visual constants ─────────────────────────────────────────────────────────

const KIND_STYLE: Record<string, { bg: string; border: string; badge: string; icon: string }> = {
  warning:     { bg: '#FFF7ED', border: '#FED7AA', badge: '#EA580C', icon: '⚠️' },
  risk:        { bg: '#FEF2F2', border: '#FECACA', badge: '#DC2626', icon: '🔮' },
  win:         { bg: '#F0FDF4', border: '#BBF7D0', badge: '#16A34A', icon: '✅' },
  opportunity: { bg: '#EFF6FF', border: '#BFDBFE', badge: '#2563EB', icon: '💡' },
  foresight:   { bg: '#ECFDF5', border: '#A7F3D0', badge: '#059669', icon: '🔭' },
  info:        { bg: '#F8FAFC', border: '#E2E8F0', badge: '#64748B', icon: 'ℹ️' },
};

const CAT_ICON: Record<string, string> = {
  budget: '💰', channel: '📡', creative: '🎨', audience: '👥',
  seo: '🔍', lifecycle: '🔄', competitive: '⚔️',
};

const CAT_TO_VIEW: Record<string, string> = {
  budget: 'budget',
  channel: 'campaigns',
  creative: 'creative',
  audience: 'audience',
  seo: 'seo-roadmap',
  lifecycle: 'reengage',
  competitive: 'battleplan',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function navigate(view: string) {
  if (!view) return;
  // Prefer Next router when available (set by MarketingBrief root)
  const r = (window as unknown as { __igBriefRouter?: { push: (p: string) => void } }).__igBriefRouter;
  if (r) {
    try {
      goToView(r as Parameters<typeof goToView>[0], view);
      return;
    } catch { /* fall through */ }
  }
  document.dispatchEvent(new CustomEvent('ig:spa-navigate', { detail: { view } }));
  try {
    const w = window as unknown as { navigateTo?: (v: string) => void };
    if (typeof w.navigateTo === 'function') w.navigateTo(view);
  } catch { /* ignore */ }
}

function buildCompetitiveTodos(): TodoAction[] {
  if (typeof window === 'undefined') return [];
  const ad = (window as unknown as {
    analysisData?: {
      url?: string;
      industry?: { name?: string } | string;
      competitors?: {
        name?: string;
        roas?: number | string;
        ctr?: string | number;
        topChannel?: string;
        suggestions?: string[];
        topKeywords?: string[];
        threatLevel?: string;
      }[];
      websiteKPIs?: { roas?: number | string };
    };
  }).analysisData;
  if (!ad?.competitors?.length) return [];

  const comps = ad.competitors;
  const top = comps[0];
  const industry = typeof ad.industry === 'string' ? ad.industry : ad.industry?.name || 'your market';
  const yourRoas = parseFloat(String(ad.websiteKPIs?.roas || 2.8)) || 2.8;
  const topRoas = parseFloat(String(top?.roas || 3.5)) || 3.5;
  const todos: TodoAction[] = [];

  todos.push({
    key: 'comp-counter-top',
    answer: `${top?.name || 'Your top competitor'} is the primary threat in ${industry}${top?.topChannel ? ` (strongest on ${top.topChannel})` : ''}, running ~${topRoas.toFixed(1)}× ROAS vs your ~${yourRoas.toFixed(1)}× benchmark.`,
    recommendation: `Build and launch a counter-campaign against ${top?.name || 'them'} this week — hit their weakest messaging and steal share on their primary channel.`,
    whyBest: 'Direct counter-positioning against the #1 threat protects share faster than broad brand campaigns that ignore who is winning today.',
    followThrough: 'Open Battle Plan →',
    view: 'battleplan',
    impact: 'Direct competitive advantage',
    source: 'competitive',
    priority: 1,
  });

  const weak = comps.find((c) => parseFloat(String(c.roas || 99)) < yourRoas) || comps[comps.length - 1];
  if (weak && weak.name !== top?.name) {
    todos.push({
      key: 'comp-steal-share',
      answer: `${weak.name} shows a softer ROAS (~${parseFloat(String(weak.roas || 2)).toFixed(1)}×) — an opening to take share with better creative and tighter targeting.`,
      recommendation: `Prioritise a lookalike / conquest campaign aimed at ${weak.name}'s audience before they recover.`,
      whyBest: 'Attacking a soft ROAS competitor converts existing market demand faster than cold prospecting into a new audience.',
      followThrough: 'Open Campaigns →',
      view: 'campaigns',
      impact: 'Capture competitor share',
      source: 'competitive',
      priority: 2,
    });
  }

  const kwComp = comps.find((c) => (c.topKeywords || []).length > 0) || top;
  const kw = (kwComp?.topKeywords || [])[0];
  if (kw) {
    todos.push({
      key: 'comp-keyword',
      answer: `${kwComp?.name || 'Competitors'} rank/bid around “${kw}” — a high-intent term in ${industry}.`,
      recommendation: `Create a Search conquest play for “${kw}” with a comparison landing angle vs ${kwComp?.name || 'the leader'}.`,
      whyBest: 'High-intent conquest keywords beat broad awareness spend because buyers are already searching with purchase language.',
      followThrough: 'Keyword / SEO roadmap →',
      view: 'seo-roadmap',
      impact: 'Win high-intent demand',
      source: 'competitive',
      priority: 3,
    });
  }

  const tip = (top?.suggestions || [])[0];
  if (tip) {
    todos.push({
      key: 'comp-suggestion',
      answer: `Competitive intel flags a concrete gap vs ${top?.name || 'the field'}.`,
      recommendation: tip,
      whyBest: 'Closing a named competitive gap is higher-certainty than inventing a new angle without evidence.',
      followThrough: 'Open Competitors →',
      view: 'competitors',
      impact: 'Close a known weakness',
      source: 'competitive',
      priority: 4,
    });
  }

  return todos;
}

function mergeTodoActions(brief: Brief | null, recs: Rec[]): TodoAction[] {
  const out: TodoAction[] = [];
  const seen = new Set<string>();

  const push = (a: TodoAction) => {
    const sig = `${a.view}|${a.recommendation.slice(0, 48)}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(a);
  };

  buildCompetitiveTodos().forEach(push);

  (brief?.actions || []).forEach((a, i) => {
    const viewRaw = a.view || 'action-queue';
    const view =
      viewRaw === 'battle' || viewRaw === 'war-room' ? 'battleplan'
      : viewRaw === 'decision-engine' ? 'action-queue'
      : viewRaw;
    push({
      key: `brief-${i}-${view}`,
      answer: a.rationale || 'Signal from today’s Marketing Brief.',
      recommendation: a.label || 'Take the recommended action.',
      whyBest: a.why_best || 'This is the highest-leverage next step given today’s live signals and the least setup required to move the needle.',
      followThrough: `Open ${view.replace(/-/g, ' ')} →`,
      view,
      impact: a.expected_impact || 'Advance today’s plan',
      source: 'brief',
      priority: a.priority || 10 + i,
    });
  });

  recs.slice(0, 4).forEach((r) => {
    push({
      key: `rec-${r.id}`,
      answer: `${r.category} opportunity with ${r.confidence_pct}% confidence${r.data_sources ? ` · ${r.data_sources}` : ''}.`,
      recommendation: r.recommendation || r.title,
      whyBest: r.why_best || `Best route in ${r.category}: expected ${r.expected_impact || 'material lift'} at ${r.cost_estimate || 'controlled cost'} within ${r.time_to_result || 'weeks'}.`,
      followThrough: `Act in ${CAT_TO_VIEW[r.category] || 'action-queue'} →`,
      view: CAT_TO_VIEW[r.category] || 'action-queue',
      impact: r.expected_impact || r.title,
      source: 'decision',
      priority: 20 + (100 - (r.priority_score || 0)),
    });
  });

  if (!out.length) {
    out.push({
      key: 'fallback-analyse',
      answer: 'No live competitive or decision signals yet for today’s brief.',
      recommendation: 'Run a fresh competitor analysis, then return here for a ranked “what to do today” list.',
      whyBest: 'Without mapped competitor and performance data, any recommendation lacks credibility — analysis is the least-setup unlock for everything downstream.',
      followThrough: 'Run Analysis →',
      view: 'home',
      impact: 'Unlock strategic actions',
      source: 'brief',
      priority: 99,
    });
  }

  return out.sort((a, b) => a.priority - b.priority).slice(0, 6);
}

function WhatToDoToday({ actions }: { actions: TodoAction[] }) {
  return (
    <div
      id="ig-what-to-do-today"
      style={{
        background: 'linear-gradient(135deg,#0C1222 0%,#0F766E 55%,#0284C7 100%)',
        borderRadius: 16,
        padding: '20px 22px',
        marginBottom: 8,
        color: '#fff',
        boxShadow: '0 10px 28px rgba(15,23,42,0.18)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)', marginBottom: 4 }}>
            ⚔️ What to do today
          </div>
          <div style={{ fontFamily: 'Sora,sans-serif', fontSize: '1.15rem', fontWeight: 800, color: '#FFFFFF' }}>
            Strategic actions to gain advantage over competitors
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.85)', marginTop: 4, maxWidth: 640, lineHeight: 1.45 }}>
            Each item diagnoses the problem, recommends the best route, explains why that route wins, and links you to the exact tool to execute.
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('action-queue')}
          style={{ padding: '8px 14px', background: '#fff', color: '#0F766E', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          Full Action Queue →
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {actions.map((a, idx) => (
          <div
            key={a.key}
            style={{
              background: 'rgba(255,255,255,0.97)',
              borderRadius: 12,
              padding: '14px 16px',
              color: '#0F172A',
              border: '1px solid rgba(255,255,255,0.35)',
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#0F766E,#0284C7)', color: '#fff', fontWeight: 800, fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {idx + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0F766E', marginBottom: 3 }}>
                  Answer · {a.source === 'competitive' ? 'Competitive intel' : a.source === 'decision' ? 'Decision Engine' : 'Morning Brief'}
                </div>
                <div style={{ fontSize: '0.84rem', color: '#334155', lineHeight: 1.45, marginBottom: 8 }}>{a.answer}</div>
                <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1D4ED8', marginBottom: 3 }}>
                  Recommendation
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0F172A', lineHeight: 1.4, marginBottom: 8 }}>{a.recommendation}</div>
                {a.whyBest && (
                  <>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B45309', marginBottom: 3 }}>
                      Why this is the best route
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#57534E', lineHeight: 1.45, marginBottom: 8 }}>{a.whyBest}</div>
                  </>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ background: '#ECFDF5', color: '#047857', borderRadius: 6, padding: '3px 8px', fontSize: '0.7rem', fontWeight: 700 }}>{a.impact}</span>
                  <button
                    type="button"
                    onClick={() => navigate(a.view)}
                    style={{ marginLeft: 'auto', padding: '8px 14px', background: 'linear-gradient(135deg,#0066FF,#0EA5E9)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: '0.78rem', cursor: 'pointer' }}
                  >
                    Follow-through · {a.followThrough}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <h2 style={{ fontSize: '0.72rem', fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.11em', margin: '24px 0 10px' }}>
      {label}
    </h2>
  );
}

function BriefSectionCard({ section }: { section: BriefSection }) {
  const s = KIND_STYLE[section.kind] || KIND_STYLE.info;
  return (
    <div style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
        <span>{s.icon}</span>
        <span style={{ fontWeight: 700, fontSize: '0.78rem', color: s.badge, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{section.title}</span>
      </div>
      <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
        {section.items.map((item, i) => (
          <li key={i} style={{ fontSize: '0.82rem', color: '#1E293B', lineHeight: 1.55, marginBottom: 2 }}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Digest panel ─────────────────────────────────────────────────────────────

function DigestPanel({ digest }: { digest: Digest }) {
  const [expanded, setExpanded] = useState(false);
  const sections = (digest.sections || []).slice(0, expanded ? 6 : 3);
  const age = Math.round((Date.now() - new Date(digest.created_at).getTime()) / 3600000);
  const ageStr = age < 2 ? 'Just now' : age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`;

  return (
    <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{ background: 'linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)', padding: '14px 18px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7DD3FC', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              🌅 Morning Digest · {ageStr}
            </div>
            <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>{digest.headline}</div>
          </div>
          <button
            onClick={() => navigate('digest')}
            style={{ flexShrink: 0, padding: '5px 12px', background: 'rgba(255,255,255,0.1)', color: '#64748b', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Full Digest →
          </button>
        </div>
      </div>

      {/* Summary */}
      {digest.summary_md && (
        <div style={{ padding: '12px 18px 0', fontSize: '0.82rem', color: '#374151', lineHeight: 1.6, borderBottom: sections.length > 0 ? '1px solid #F1F5F9' : 'none' }}>
          {digest.summary_md.slice(0, 300)}{digest.summary_md.length > 300 ? '…' : ''}
        </div>
      )}

      {/* Sections */}
      {sections.length > 0 && (
        <div style={{ padding: '10px 18px 14px' }}>
          {sections.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: i < sections.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
              <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#0369A1', minWidth: 80, flexShrink: 0 }}>{s.title}</span>
              <span style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>{s.body}</span>
            </div>
          ))}
          {(digest.sections || []).length > 3 && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ marginTop: 8, padding: '4px 10px', background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: 5, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}
            >
              {expanded ? '▲ Show less' : `▼ +${(digest.sections || []).length - 3} more sections`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Decision Engine recommendations panel ────────────────────────────────────

const CONF_COLOR = (pct: number) =>
  pct >= 75 ? '#16A34A' : pct >= 55 ? '#D97706' : '#94A3B8';

function RecCard({ rec, onAct, onDismiss }: {
  rec: Rec;
  onAct: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState(false);

  const handleAct = async () => {
    setActing(true);
    try {
      await fetch(`/api/decision-engine/act/${rec.id}`, { method: 'POST' });
      setDone(true);
      setTimeout(() => onAct(rec.id), 1200);
    } catch { setActing(false); }
  };

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 14px',
      background: done ? '#F0FDF4' : '#F8FAFC',
      border: `1.5px solid ${done ? '#BBF7D0' : '#E2E8F0'}`,
      borderRadius: 9, marginBottom: 8, transition: 'all 0.3s',
    }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#0f766e,#0284c7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
        {CAT_ICON[rec.category] || '📌'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 3 }}>
          <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0F172A', flex: 1 }}>{rec.title}</span>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: CONF_COLOR(rec.confidence_pct), whiteSpace: 'nowrap', flexShrink: 0 }}>
            {rec.confidence_pct}% conf
          </span>
        </div>
        <div style={{ fontSize: '0.77rem', color: '#475569', lineHeight: 1.45, marginBottom: 6 }}>{rec.recommendation}</div>
        {rec.why_best && (
          <div style={{ fontSize: '0.74rem', color: '#78716C', lineHeight: 1.4, marginBottom: 6, fontStyle: 'italic' }}>
            Why best: {rec.why_best}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rec.expected_impact && (
            <span style={{ background: '#EFF6FF', color: '#2563EB', borderRadius: 4, padding: '1px 6px', fontSize: '0.68rem', fontWeight: 600 }}>
              {rec.expected_impact}
            </span>
          )}
          {rec.time_to_result && (
            <span style={{ background: '#F0FDF4', color: '#16A34A', borderRadius: 4, padding: '1px 6px', fontSize: '0.68rem', fontWeight: 600 }}>
              ⏱ {rec.time_to_result}
            </span>
          )}
          {rec.cost_estimate && (
            <span style={{ background: '#FFF7ED', color: '#C2410C', borderRadius: 4, padding: '1px 6px', fontSize: '0.68rem', fontWeight: 600 }}>
              {rec.cost_estimate}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <button
          onClick={() => navigate(CAT_TO_VIEW[rec.category] || 'action-queue')}
          title="Open the tool to execute this"
          style={{
            padding: '4px 10px', background: '#EEF2FF', color: '#1D4ED8',
            border: '1px solid #C7D2FE', borderRadius: 5, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
          }}
        >
          Go →
        </button>
        <button
          onClick={handleAct}
          disabled={acting || done}
          title="Mark as acted on"
          style={{
            padding: '4px 10px', background: done ? '#16A34A' : 'linear-gradient(135deg,#0066FF,#0EA5E9)',
            color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
            opacity: acting ? 0.7 : 1,
          }}
        >
          {done ? '✓ Done' : acting ? '…' : 'Act ✓'}
        </button>
        <button
          onClick={() => onDismiss(rec.id)}
          title="Dismiss this recommendation"
          style={{ padding: '4px 10px', background: 'transparent', color: '#94A3B8', border: '1px solid #E2E8F0', borderRadius: 5, fontSize: '0.7rem', cursor: 'pointer' }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function RecsPanel({ recs: initialRecs, onNavigateFull }: { recs: Rec[]; onNavigateFull: () => void }) {
  const [recs, setRecs] = useState(initialRecs);

  useEffect(() => { setRecs(initialRecs); }, [initialRecs]);

  const handleDismiss = async (id: number) => {
    try {
      await fetch(`/api/decision-engine/dismiss/${id}`, { method: 'POST' });
      setRecs(r => r.filter(x => x.id !== id));
    } catch { /* ignore */ }
  };

  const handleAct = (id: number) => setRecs(r => r.filter(x => x.id !== id));

  if (recs.length === 0) {
    return (
      <div style={{ padding: '16px 18px', background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 12, textAlign: 'center' }}>
        <div style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: 10 }}>
          No active recommendations — run the Decision Engine to generate priorities.
        </div>
        <button
          onClick={onNavigateFull}
          style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0f766e,#0284c7)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
        >
          Run Decision Engine →
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ background: 'linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#0f766e', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          🧭 Top Priorities · Decision Engine
        </div>
        <button
          onClick={onNavigateFull}
          style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.1)', color: '#475569', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}
        >
          All recs →
        </button>
      </div>
      <div style={{ padding: '10px 12px 4px' }}>
        {recs.map(rec => (
          <RecCard key={rec.id} rec={rec} onAct={handleAct} onDismiss={handleDismiss} />
        ))}
      </div>
    </div>
  );
}

// ── History tab ──────────────────────────────────────────────────────────────

interface HistoryBrief {
  id: number;
  headline: string;
  active_pillars?: string[];
  generated_by: string;
  created_at: string;
}

function HistoryTab() {
  const [list, setList] = useState<HistoryBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Brief | null>(null);

  useEffect(() => {
    fetch('/api/marketing-brief/history?limit=14')
      .then(r => r.json())
      .then(d => { if (d.ok) setList(d.briefs || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 32, color: '#94A3B8' }}>Loading…</div>;
  if (list.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: '#94A3B8' }}>No previous briefs yet.</div>;

  if (selected) {
    return (
      <div>
        <button
          onClick={() => setSelected(null)}
          style={{ marginBottom: 14, padding: '5px 12px', background: '#F1F5F9', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', color: '#374151' }}
        >
          ← Back to history
        </button>
        <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0F172A', marginBottom: 14 }}>{selected.headline}</div>
        {(selected.sections || []).map((s, i) => <BriefSectionCard key={i} section={s} />)}
      </div>
    );
  }

  return (
    <div>
      {list.map(b => (
        <div key={b.id} style={{ background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginBottom: 3 }}>
              {new Date(b.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {' · '}{b.active_pillars?.length || 0} pillars · {b.generated_by}
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0F172A' }}>{b.headline}</div>
          </div>
          <button
            onClick={async () => {
              const res = await fetch(`/api/marketing-brief/${b.id}`);
              const d = await res.json();
              if (d.ok) setSelected(d.brief);
            }}
            style={{ padding: '5px 12px', background: '#fff', color: '#374151', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer' }}
          >
            View
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MarketingBrief() {
  const router = useRouter();
  const [data, setData]             = useState<MergedPayload | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [delivered, setDelivered]   = useState(false);
  const [error, setError]           = useState('');
  const [tab, setTab]               = useState<'brief' | 'history'>('brief');
  const [cadence, setCadence]       = useState<Cadence>('daily');
  const [savingCadence, setSavingCadence] = useState(false);
  const [compTick, setCompTick]     = useState(0);

  useEffect(() => {
    (window as unknown as { __igBriefRouter?: typeof router }).__igBriefRouter = router;
    return () => {
      try {
        delete (window as unknown as { __igBriefRouter?: typeof router }).__igBriefRouter;
      } catch { /* ignore */ }
    };
  }, [router]);

  const load = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const url = `/api/marketing-brief/merged${force ? '?force=1' : ''}`;
      const res = await fetch(url);
      const d: MergedPayload = await res.json();
      if (!d.ok) throw new Error((d as any).error || 'Failed');
      setData(d);
      setCadence(d.cadence || 'daily');
    } catch (e: any) {
      setError(e.message || 'Failed to load brief');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh when a fresh analysis completes so the brief reflects new data
  useEffect(() => {
    const onAnalysis = () => {
      load(true);
      setCompTick((t) => t + 1);
    };
    document.addEventListener('ig:analysis-ready', onAnalysis);
    document.addEventListener('ig:analysis-updated', onAnalysis);
    return () => {
      document.removeEventListener('ig:analysis-ready', onAnalysis);
      document.removeEventListener('ig:analysis-updated', onAnalysis);
    };
  }, [load]);

  const saveCadence = useCallback(async (c: Cadence) => {
    // Always move the selection immediately so the control feels live.
    setCadence((prev) => {
      if (prev === c) return prev;
      return c;
    });
    setSavingCadence(true);
    try {
      const r = await apiPut<{ ok?: boolean; cadence?: Cadence; error?: string }>(
        '/api/marketing-brief/settings',
        { cadence: c },
      );
      if (!r || r.ok === false) {
        showToast((r && r.error) || 'Could not save cadence');
        // Keep the optimistic selection — preference is still what the user picked;
        // retry on next interaction. Re-sync from server on next full load.
        return;
      }
      const next = (r.cadence || c) as Cadence;
      setCadence(next);
      setData((d) => (d ? { ...d, cadence: next } : d));
      showToast(`Cadence set to ${CADENCES[next].label} (${CADENCES[next].plan})`);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not save cadence');
    } finally {
      setSavingCadence(false);
    }
  }, []);

  const deliver = async () => {
    if (!data?.brief) return;
    setDelivering(true);
    try {
      await fetch(`/api/marketing-brief/${data.brief.id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: ['slack'] }),
      });
      setDelivered(true);
      setTimeout(() => setDelivered(false), 3000);
    } catch { /* ignore */ } finally { setDelivering(false); }
  };

  const brief = data?.brief ?? null;
  const digest = data?.digest ?? null;
  const recommendations = data?.recommendations ?? [];
  // Must stay above any early returns — Rules of Hooks
  const todayActions = useMemo(
    () => mergeTodoActions(brief, recommendations),
    // compTick forces rebuild when analysisData arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brief, recommendations, compTick],
  );

  const formattedDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, gap: 16, color: '#64748B' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #E2E8F0', borderTopColor: '#6366F1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ fontSize: '0.88rem' }}>Assembling your morning brief…</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', marginBottom: 8 }}>⚠️</div>
      <div style={{ fontWeight: 600, color: '#EF4444', marginBottom: 6 }}>Could not load brief</div>
      <div style={{ fontSize: '0.82rem', color: '#64748B', marginBottom: 14 }}>{error}</div>
      <button onClick={() => load()} style={{ padding: '8px 18px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 14px 52px', fontFamily: "'Inter','Segoe UI',sans-serif" }}>

      {/* ── Hero header ───────────────────────────────────────────────────── */}
      <div
        className="ig-panel-hero"
        data-ig-light-hero="1"
        style={{
        background: 'radial-gradient(ellipse 75% 65% at 10% 15%, rgba(15,118,110,0.16), transparent 55%), radial-gradient(ellipse 55% 50% at 92% 85%, rgba(2,132,199,0.14), transparent 50%), linear-gradient(135deg, #e8f6f3 0%, #eaf2fb 48%, #eef4ff 100%)',
        borderRadius: 16,
        padding: '26px 28px 22px',
        marginBottom: 18,
        color: '#0f172a',
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid rgba(15, 118, 110, 0.16)',
        boxShadow: '0 10px 28px rgba(15, 23, 42, 0.06)',
      }}>
        <div style={{ position: 'absolute', top: -28, right: -28, width: 150, height: 150, background: 'rgba(15,118,110,0.06)', borderRadius: '50%', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -40, right: 55, width: 90, height: 90, background: 'rgba(2,132,199,0.07)', borderRadius: '50%', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0f766e', marginBottom: 6 }}>
              📋 Today&apos;s Marketing Brief · {formattedDate}
            </div>
            <h1 style={{ margin: 0, fontSize: '1.22rem', fontWeight: 800, lineHeight: 1.3, color: '#0f172a' }}>
              {brief?.headline || 'Your AI Marketing Director'}
            </h1>
            {brief?.greeting && (
              <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>{brief.greeting}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', flexWrap: 'wrap', flexShrink: 0 }}>
            <button
              onClick={() => load(true)} disabled={refreshing}
              style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.75)', color: '#0f172a', border: '1.5px solid rgba(15, 118, 110, 0.22)', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', opacity: refreshing ? 0.6 : 1 }}
            >
              {refreshing ? '⏳ Refreshing…' : '🔄 Refresh'}
            </button>
            <button
              onClick={deliver} disabled={delivering || delivered}
              style={{ padding: '6px 12px', background: delivered ? '#16A34A' : 'linear-gradient(135deg,#0f766e,#0284c7)', color: '#fff', border: delivered ? '1.5px solid #16A34A' : '1.5px solid transparent', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
            >
              {delivered ? '✓ Sent' : delivering ? 'Sending…' : '📤 Send to Slack'}
            </button>
          </div>
        </div>

        {/* Cadence selector — native radios so clicks always register */}
        <div
          id="ig-brief-cadence"
          role="radiogroup"
          aria-label="Brief cadence"
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            position: 'relative',
            zIndex: 5,
          }}
        >
          <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cadence:</span>
          {(Object.entries(CADENCES) as [Cadence, CadenceMeta][]).map(([key, meta]) => {
            const isSelected = cadence === key;
            const id = `ig-cadence-${key}`;
            return (
              <label
                key={key}
                htmlFor={id}
                title={`${meta.plan} plan — ${meta.label} brief cadence`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.18s',
                  background: isSelected ? '#0f766e' : 'rgba(255,255,255,0.95)',
                  border: `1.5px solid ${isSelected ? '#0f766e' : 'rgba(15, 118, 110, 0.22)'}`,
                  color: isSelected ? '#fff' : '#334155',
                  boxShadow: isSelected ? '0 4px 12px rgba(15, 118, 110, 0.22)' : 'none',
                  userSelect: 'none',
                }}
              >
                <input
                  id={id}
                  type="radio"
                  name="ig-brief-cadence"
                  value={key}
                  checked={isSelected}
                  onChange={() => {
                    void saveCadence(key);
                  }}
                  style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
                />
                <span>
                  {meta.label}{' '}
                  <span style={{ opacity: 0.75, fontSize: '0.62rem' }}>({meta.plan})</span>
                  {isSelected && <span style={{ marginLeft: 5, fontSize: '0.62rem' }}>✓</span>}
                </span>
              </label>
            );
          })}
          {savingCadence && <span style={{ fontSize: '0.65rem', color: '#0f766e', opacity: 0.85 }}>Saving…</span>}
        </div>

        {/* Active pillars */}
        {(brief?.active_pillars || []).length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(brief!.active_pillars).slice(0, 8).map(p => (
              <span key={p} style={{ background: 'rgba(15, 118, 110, 0.1)', color: '#0f766e', borderRadius: 4, padding: '2px 7px', fontSize: '0.65rem', fontWeight: 700 }}>{p}</span>
            ))}
            <span style={{ background: 'rgba(2, 132, 199, 0.1)', color: '#0369a1', borderRadius: 4, padding: '2px 7px', fontSize: '0.65rem', fontWeight: 600 }}>
              via {brief?.generated_by === 'openai' ? 'GPT-4o' : 'template'}
            </span>
          </div>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 18, background: '#F1F5F9', borderRadius: 8, padding: 3, width: 'fit-content' }}>
        {(['brief', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '5px 16px', borderRadius: 6, border: 'none', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer',
            background: tab === t ? '#fff' : 'transparent',
            color: tab === t ? '#1E293B' : '#64748B',
            boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.07)' : 'none',
          }}>
            {t === 'brief' ? '📋 Today' : '📅 History'}
          </button>
        ))}
      </div>

      {/* ── Today's Brief tab ─────────────────────────────────────────────── */}
      {tab === 'brief' && (
        <>
          {/* ── What to do today — answer · recommendation · follow-through ─ */}
          <SectionLabel label="⚔️ What to do today" />
          <WhatToDoToday actions={todayActions} />

          {/* Future risks & opportunities — foresight layer */}
          {((brief?.signals || []).some(s => s.kind === 'risk' || s.kind === 'foresight')
            || (brief?.sections || []).some(s => s.kind === 'risk' || s.kind === 'foresight')) && (
            <>
              <SectionLabel label="🔮 Future risks & opportunities" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10, marginBottom: 8 }}>
                {(brief!.sections || []).filter(s => s.kind === 'risk' || s.kind === 'foresight').map((s, i) => (
                  <BriefSectionCard key={`foresight-sec-${i}`} section={s} />
                ))}
                {(brief!.signals || [])
                  .filter(s => s.kind === 'risk' || s.kind === 'foresight')
                  .slice(0, 6)
                  .map((s, i) => {
                    const st = KIND_STYLE[s.kind] || KIND_STYLE.info;
                    return (
                      <div key={`foresight-sig-${i}`} style={{ background: st.bg, border: `1.5px solid ${st.border}`, borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <span>{st.icon}</span>
                          <span style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: st.badge }}>
                            {s.kind === 'risk' ? 'Risk' : 'Opportunity'}{s.horizon ? ` · ${s.horizon}` : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0F172A', lineHeight: 1.35, marginBottom: 4 }}>{s.headline}</div>
                        {s.detail && <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>{s.detail}</div>}
                        {s.action_view && (
                          <button
                            type="button"
                            onClick={() => navigate(s.action_view === 'crisis' ? 'crisis-radar' : s.action_view!)}
                            style={{ marginTop: 8, padding: '5px 10px', background: '#fff', border: `1px solid ${st.border}`, borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, color: st.badge, cursor: 'pointer' }}
                          >
                            Investigate →
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </>
          )}

          {/* Signal count chips + inline opportunity cards */}
          {(brief?.signals || []).length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 12 }}>
                {(['warning', 'risk', 'win', 'opportunity', 'foresight'] as const).map(kind => {
                  const count = (brief!.signals || []).filter(s => s.kind === kind).length;
                  if (!count) return null;
                  const s = KIND_STYLE[kind];
                  return (
                    <div key={kind} style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 9, padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.3rem', marginBottom: 3 }}>{s.icon}</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s.badge }}>{count}</div>
                      <div style={{ fontSize: '0.68rem', color: s.badge, fontWeight: 700, textTransform: 'capitalize' }}>{kind}{count !== 1 ? 's' : ''}</div>
                    </div>
                  );
                })}
              </div>

              {/* Opportunity sections — shown directly under the chips */}
              {(brief?.sections || []).filter(s => s.kind === 'opportunity').length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  {(brief!.sections).filter(s => s.kind === 'opportunity').map((s, i) => (
                    <BriefSectionCard key={i} section={s} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Morning Digest — inline ──────────────────────────────────── */}
          <SectionLabel label="🌅 Morning Digest" />
          {digest ? (
            <DigestPanel digest={digest} />
          ) : (
            <div style={{ padding: '14px 18px', background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: '0.82rem', color: '#94A3B8' }}>No digest generated yet for your brand.</span>
              <button
                onClick={() => navigate('digest')}
                style={{ flexShrink: 0, padding: '6px 12px', background: '#eef4ff', color: '#0f172a', border: 'none', borderRadius: 6, fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer' }}
              >
                Generate Digest →
              </button>
            </div>
          )}

          {/* ── Decision Engine priorities — inline ──────────────────────── */}
          <SectionLabel label="🧭 Top Priorities" />
          <RecsPanel
            recs={recommendations || []}
            onNavigateFull={() => navigate('action-queue')}
          />

          {/* ── Signal Headlines (warnings, wins, info — not opportunities) ── */}
          {(brief?.sections || []).filter(s => s.kind !== 'opportunity' && s.kind !== 'risk' && s.kind !== 'foresight').length > 0 && (
            <>
              <SectionLabel label="📡 Signal Headlines" />
              <div style={{ marginBottom: 8 }}>
                {(brief!.sections).filter(s => s.kind !== 'opportunity' && s.kind !== 'risk' && s.kind !== 'foresight').map((s, i) => (
                  <BriefSectionCard key={i} section={s} />
                ))}
              </div>
            </>
          )}

          {/* ── Footer ──────────────────────────────────────────────────── */}
          <div style={{ marginTop: 22, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => navigate('home')}
              style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#0066FF,#0EA5E9)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.76rem', cursor: 'pointer' }}
            >
              🔍 Run Analysis
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={() => navigate('alert-routing')} style={{ padding: '7px 13px', background: '#F1F5F9', color: '#374151', border: '1.5px solid #E2E8F0', borderRadius: 6, fontWeight: 600, fontSize: '0.74rem', cursor: 'pointer' }}>
              🔔 Alert Routing
            </button>
          </div>
        </>
      )}

      {/* ── History tab ───────────────────────────────────────────────────── */}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}
