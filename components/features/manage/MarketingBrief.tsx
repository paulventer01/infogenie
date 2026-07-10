import React, { useEffect, useState, useCallback } from 'react';

interface BriefSignal {
  kind: 'warning' | 'win' | 'opportunity' | 'info';
  pillar: string;
  headline: string;
  detail?: string;
  action_view?: string;
  action_label?: string;
}

interface BriefAction {
  label: string;
  rationale: string;
  expected_impact: string;
  view: string;
  priority: number;
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
  actions: BriefAction[];
  sections: BriefSection[];
  active_pillars: string[];
  generated_by: string;
  delivered_to: { channel: string; at: string; ok: boolean }[];
  created_at: string;
}

const KIND_STYLE: Record<string, { bg: string; border: string; badge: string; icon: string }> = {
  warning:     { bg: '#FFF7ED', border: '#FED7AA', badge: '#EA580C', icon: '⚠️' },
  win:         { bg: '#F0FDF4', border: '#BBF7D0', badge: '#16A34A', icon: '✅' },
  opportunity: { bg: '#EFF6FF', border: '#BFDBFE', badge: '#2563EB', icon: '💡' },
  info:        { bg: '#F8FAFC', border: '#E2E8F0', badge: '#64748B', icon: 'ℹ️' },
};

function navigate(view: string) {
  if (!view) return;
  const ev = new CustomEvent('ig:spa-navigate', { detail: { view } });
  window.dispatchEvent(ev);
  if (typeof (window as any).navigateTo === 'function') (window as any).navigateTo(view);
}

function SectionCard({ section }: { section: BriefSection }) {
  const style = KIND_STYLE[section.kind] || KIND_STYLE.info;
  return (
    <div style={{ background: style.bg, border: `1.5px solid ${style.border}`, borderRadius: 10, padding: '14px 18px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: '1rem' }}>{style.icon}</span>
        <span style={{ fontWeight: 700, fontSize: '0.82rem', color: style.badge, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{section.title}</span>
      </div>
      <ul style={{ margin: 0, padding: '0 0 0 18px' }}>
        {section.items.map((item, i) => (
          <li key={i} style={{ fontSize: '0.84rem', color: '#1E293B', lineHeight: 1.55, marginBottom: 3 }}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ActionRow({ action, index }: { action: BriefAction; index: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '11px 14px', background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 9, marginBottom: 8 }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.75rem', flexShrink: 0, marginTop: 1 }}>
        {index + 1}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0F172A', marginBottom: 2 }}>{action.label}</div>
        <div style={{ fontSize: '0.78rem', color: '#475569', marginBottom: 4, lineHeight: 1.45 }}>{action.rationale}</div>
        {action.expected_impact && (
          <span style={{ display: 'inline-block', background: '#EFF6FF', color: '#2563EB', borderRadius: 5, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 600 }}>
            {action.expected_impact}
          </span>
        )}
      </div>
      {action.view && (
        <button
          onClick={() => navigate(action.view)}
          style={{ flexShrink: 0, padding: '5px 12px', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          Go →
        </button>
      )}
    </div>
  );
}

export default function MarketingBrief() {
  const [brief, setBrief]       = useState<Brief | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [error, setError]       = useState('');
  const [delivered, setDelivered] = useState(false);
  const [tab, setTab]           = useState<'brief' | 'history'>('brief');
  const [history, setHistory]   = useState<Brief[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const loadToday = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const endpoint = force
        ? '/api/marketing-brief/generate'
        : '/api/marketing-brief/today';
      const res = await fetch(endpoint, force ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: '' }),
      } : undefined);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to load brief');
      setBrief(data.brief);
    } catch (e: any) {
      setError(e.message || 'Failed to load brief');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await fetch('/api/marketing-brief/history?limit=14');
      const data = await res.json();
      if (data.ok) setHistory(data.briefs || []);
    } catch { /* ignore */ }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);

  useEffect(() => {
    if (tab === 'history' && history.length === 0) loadHistory();
  }, [tab, history.length, loadHistory]);

  const deliver = async () => {
    if (!brief) return;
    setDelivering(true);
    try {
      await fetch(`/api/marketing-brief/${brief.id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: ['slack'] }),
      });
      setDelivered(true);
      setTimeout(() => setDelivered(false), 3000);
    } catch { /* ignore */ }
    finally { setDelivering(false); }
  };

  const formattedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 16, color: '#64748B' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #E2E8F0', borderTopColor: '#6366F1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ fontSize: '0.9rem' }}>Generating your marketing brief…</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ padding: 32, textAlign: 'center', color: '#EF4444' }}>
      <div style={{ fontSize: '2rem', marginBottom: 10 }}>⚠️</div>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Could not load brief</div>
      <div style={{ fontSize: '0.82rem', color: '#64748B', marginBottom: 16 }}>{error}</div>
      <button onClick={() => loadToday()} style={{ padding: '8px 18px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 16px 48px', fontFamily: "'Inter','Segoe UI',sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ background: 'linear-gradient(135deg,#1E1B4B 0%,#312E81 60%,#4338CA 100%)', borderRadius: 16, padding: '28px 30px 24px', marginBottom: 20, color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 160, height: 160, background: 'rgba(255,255,255,0.04)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', bottom: -40, right: 60, width: 100, height: 100, background: 'rgba(255,255,255,0.03)', borderRadius: '50%' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A5B4FC', marginBottom: 6 }}>
              📋 Today's Marketing Brief · {formattedDate}
            </div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, lineHeight: 1.3, color: '#fff', maxWidth: 560 }}>
              {brief?.headline || 'Your AI Marketing Director is ready'}
            </h1>
            {brief?.greeting && (
              <p style={{ margin: '10px 0 0', fontSize: '0.84rem', color: '#C7D2FE', lineHeight: 1.5 }}>{brief.greeting}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', flexShrink: 0 }}>
            <button
              onClick={() => loadToday(true)}
              disabled={refreshing}
              style={{ padding: '7px 14px', background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.18)', borderRadius: 7, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', opacity: refreshing ? 0.6 : 1 }}
            >
              {refreshing ? '⏳ Refreshing…' : '🔄 Refresh'}
            </button>
            <button
              onClick={deliver}
              disabled={delivering || delivered}
              style={{ padding: '7px 14px', background: delivered ? '#16A34A' : 'rgba(255,255,255,0.12)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.18)', borderRadius: 7, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
            >
              {delivered ? '✓ Sent' : delivering ? 'Sending…' : '📤 Send to Slack'}
            </button>
          </div>
        </div>
        {brief && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(brief.active_pillars || []).slice(0, 8).map(p => (
              <span key={p} style={{ background: 'rgba(255,255,255,0.1)', color: '#E0E7FF', borderRadius: 5, padding: '2px 8px', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em' }}>{p}</span>
            ))}
            <span style={{ background: 'rgba(255,255,255,0.06)', color: '#A5B4FC', borderRadius: 5, padding: '2px 8px', fontSize: '0.68rem' }}>
              via {brief.generated_by === 'openai' ? 'GPT-4o' : 'template fallback'}
            </span>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#F1F5F9', borderRadius: 8, padding: 4, width: 'fit-content' }}>
        {(['brief', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '6px 18px', borderRadius: 6, border: 'none', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
            background: tab === t ? '#fff' : 'transparent',
            color: tab === t ? '#1E293B' : '#64748B',
            boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
          }}>
            {t === 'brief' ? "Today's Brief" : '📅 History'}
          </button>
        ))}
      </div>

      {tab === 'brief' && brief && (
        <>
          {/* ── Signal Summary Row ── */}
          {(brief.signals || []).length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 20 }}>
              {(['warning','win','opportunity'] as const).map(kind => {
                const count = (brief.signals || []).filter(s => s.kind === kind).length;
                if (!count) return null;
                const s = KIND_STYLE[kind];
                return (
                  <div key={kind} style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 9, padding: '12px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>{s.icon}</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: s.badge }}>{count}</div>
                    <div style={{ fontSize: '0.72rem', color: s.badge, fontWeight: 600, textTransform: 'capitalize' }}>{kind}{count > 1 ? 's' : ''}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Sections ── */}
          <h2 style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 12px' }}>Signal Headlines</h2>
          {(brief.sections || []).length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: '0.85rem', background: '#F8FAFC', borderRadius: 10, marginBottom: 20 }}>
              No signals yet — connect more features to see live data here.
            </div>
          ) : (
            <div style={{ marginBottom: 24 }}>
              {(brief.sections || []).map((s, i) => <SectionCard key={i} section={s} />)}
            </div>
          )}

          {/* ── Actions ── */}
          <h2 style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 12px' }}>Recommended Actions</h2>
          {(brief.actions || []).length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: '0.85rem', background: '#F8FAFC', borderRadius: 10 }}>
              No actions generated yet.
              <button onClick={() => navigate('decision-engine')} style={{ display: 'block', margin: '12px auto 0', padding: '8px 18px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                Run Decision Engine →
              </button>
            </div>
          ) : (
            <div>
              {(brief.actions || []).sort((a, b) => a.priority - b.priority).map((action, i) => (
                <ActionRow key={i} action={action} index={i} />
              ))}
            </div>
          )}

          {/* ── Footer ── */}
          <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => navigate('decision-engine')} style={{ padding: '8px 16px', background: '#F1F5F9', color: '#374151', border: '1.5px solid #E2E8F0', borderRadius: 7, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>
              🧭 Full Decision Engine
            </button>
            <button onClick={() => navigate('digest')} style={{ padding: '8px 16px', background: '#F1F5F9', color: '#374151', border: '1.5px solid #E2E8F0', borderRadius: 7, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>
              🌅 Daily Digest
            </button>
            <button onClick={() => navigate('alert-routing')} style={{ padding: '8px 16px', background: '#F1F5F9', color: '#374151', border: '1.5px solid #E2E8F0', borderRadius: 7, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>
              🔔 Alert Routing
            </button>
          </div>
        </>
      )}

      {tab === 'history' && (
        <div>
          {histLoading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#94A3B8' }}>Loading history…</div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#94A3B8' }}>No previous briefs found.</div>
          ) : (
            history.map(b => (
              <div key={b.id} style={{ background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: '14px 18px', marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginBottom: 4 }}>
                    {new Date(b.created_at).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                    {' · '}{b.active_pillars?.length || 0} pillars · {b.generated_by}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0F172A' }}>{b.headline}</div>
                </div>
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/marketing-brief/${b.id}`);
                    const data = await res.json();
                    if (data.ok) { setBrief(data.brief); setTab('brief'); }
                  }}
                  style={{ padding: '5px 14px', background: '#fff', color: '#374151', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  View
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
