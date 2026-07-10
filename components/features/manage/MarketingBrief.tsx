import React, { useEffect, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface BriefSignal {
  kind: 'warning' | 'win' | 'opportunity' | 'info';
  pillar: string;
  headline: string;
  detail?: string;
  action_view?: string;
}

interface BriefSection {
  title: string;
  kind: 'warning' | 'win' | 'opportunity' | 'info';
  items: string[];
}

interface Brief {
  id: number;
  brand: string;
  headline: string;
  greeting: string;
  signals: BriefSignal[];
  sections: BriefSection[];
  active_pillars: string[];
  generated_by: string;
  created_at: string;
  delivered_to: { channel: string; at: string; ok: boolean }[];
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
  win:         { bg: '#F0FDF4', border: '#BBF7D0', badge: '#16A34A', icon: '✅' },
  opportunity: { bg: '#EFF6FF', border: '#BFDBFE', badge: '#2563EB', icon: '💡' },
  info:        { bg: '#F8FAFC', border: '#E2E8F0', badge: '#64748B', icon: 'ℹ️' },
};

const CAT_ICON: Record<string, string> = {
  budget: '💰', channel: '📡', creative: '🎨', audience: '👥',
  seo: '🔍', lifecycle: '🔄', competitive: '⚔️',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function navigate(view: string) {
  if (!view) return;
  document.dispatchEvent(new CustomEvent('ig:spa-navigate', { detail: { view } }));
  if (typeof (window as any).navigateTo === 'function') (window as any).navigateTo(view);
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
      <div style={{ background: 'linear-gradient(135deg,#0F172A,#1E3A5F)', padding: '14px 18px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7DD3FC', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              🌅 Morning Digest · {ageStr}
            </div>
            <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{digest.headline}</div>
          </div>
          <button
            onClick={() => navigate('digest')}
            style={{ flexShrink: 0, padding: '5px 12px', background: 'rgba(255,255,255,0.1)', color: '#BAE6FD', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
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
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#1E3A5F,#0369A1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
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
          style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#1E3A5F,#0369A1)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
        >
          Run Decision Engine →
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ background: 'linear-gradient(135deg,#1E1B4B,#312E81)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#A5B4FC', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          🧭 Top Priorities · Decision Engine
        </div>
        <button
          onClick={onNavigateFull}
          style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.1)', color: '#C7D2FE', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}
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
  const [data, setData]             = useState<MergedPayload | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [delivered, setDelivered]   = useState(false);
  const [error, setError]           = useState('');
  const [tab, setTab]               = useState<'brief' | 'history'>('brief');
  const [cadence, setCadence]       = useState<Cadence>('daily');
  const [savingCadence, setSavingCadence] = useState(false);

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

  const saveCadence = useCallback(async (c: Cadence) => {
    setSavingCadence(true);
    try {
      await fetch('/api/marketing-brief/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadence: c }),
      });
      setCadence(c);
    } catch { /* ignore */ } finally { setSavingCadence(false); }
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

  const { brief, digest, recommendations } = data || {};

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 14px 52px', fontFamily: "'Inter','Segoe UI',sans-serif" }}>

      {/* ── Hero header ───────────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg,#1E1B4B 0%,#312E81 55%,#4338CA 100%)', borderRadius: 16, padding: '26px 28px 22px', marginBottom: 18, color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -28, right: -28, width: 150, height: 150, background: 'rgba(255,255,255,0.04)', borderRadius: '50%', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -40, right: 55, width: 90, height: 90, background: 'rgba(255,255,255,0.03)', borderRadius: '50%', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A5B4FC', marginBottom: 6 }}>
              📋 Today's Marketing Brief · {formattedDate}
            </div>
            <h1 style={{ margin: 0, fontSize: '1.22rem', fontWeight: 800, lineHeight: 1.3, color: '#fff' }}>
              {brief?.headline || 'Your AI Marketing Director'}
            </h1>
            {brief?.greeting && (
              <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: '#C7D2FE', lineHeight: 1.5 }}>{brief.greeting}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', flexWrap: 'wrap', flexShrink: 0 }}>
            <button
              onClick={() => load(true)} disabled={refreshing}
              style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.18)', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', opacity: refreshing ? 0.6 : 1 }}
            >
              {refreshing ? '⏳ Refreshing…' : '🔄 Refresh'}
            </button>
            <button
              onClick={deliver} disabled={delivering || delivered}
              style={{ padding: '6px 12px', background: delivered ? '#16A34A' : 'rgba(255,255,255,0.12)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.18)', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
            >
              {delivered ? '✓ Sent' : delivering ? 'Sending…' : '📤 Send to Slack'}
            </button>
          </div>
        </div>

        {/* Cadence selector */}
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#A5B4FC', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cadence:</span>
          {(Object.entries(CADENCES) as [Cadence, CadenceMeta][]).map(([key, meta]) => (
            <button
              key={key} onClick={() => saveCadence(key)} disabled={savingCadence}
              title={meta.plan + ' plan'}
              style={{
                padding: '3px 9px', borderRadius: 5, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                background: cadence === key ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${cadence === key ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.14)'}`,
                color: cadence === key ? '#fff' : '#A5B4FC',
              }}
            >
              {meta.label} <span style={{ opacity: 0.65, fontSize: '0.6rem' }}>({meta.plan})</span>
            </button>
          ))}
        </div>

        {/* Active pillars */}
        {(brief?.active_pillars || []).length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(brief!.active_pillars).slice(0, 8).map(p => (
              <span key={p} style={{ background: 'rgba(255,255,255,0.09)', color: '#E0E7FF', borderRadius: 4, padding: '2px 7px', fontSize: '0.65rem', fontWeight: 600 }}>{p}</span>
            ))}
            <span style={{ background: 'rgba(255,255,255,0.05)', color: '#A5B4FC', borderRadius: 4, padding: '2px 7px', fontSize: '0.65rem' }}>
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
          {/* Signal count chips */}
          {(brief?.signals || []).length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, marginBottom: 18 }}>
              {(['warning', 'win', 'opportunity'] as const).map(kind => {
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
                style={{ flexShrink: 0, padding: '6px 12px', background: '#0F172A', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer' }}
              >
                Generate Digest →
              </button>
            </div>
          )}

          {/* ── Decision Engine priorities — inline ──────────────────────── */}
          <SectionLabel label="🧭 Top Priorities" />
          <RecsPanel
            recs={recommendations || []}
            onNavigateFull={() => navigate('decision-engine')}
          />

          {/* ── Brief signal headlines ───────────────────────────────────── */}
          {(brief?.sections || []).length > 0 && (
            <>
              <SectionLabel label="📡 Signal Headlines" />
              <div style={{ marginBottom: 8 }}>
                {(brief!.sections).map((s, i) => <BriefSectionCard key={i} section={s} />)}
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
