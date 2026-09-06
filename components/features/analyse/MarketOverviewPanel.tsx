'use client';

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';
import { goToView } from '@/lib/nav';

type Player = {
  domain: string;
  share_pct: number;
  visits_est: number;
  growth_pct?: number | null;
  channels?: Record<string, number>;
};

const lbl: CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '.06em',
};

const trInput: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 9,
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
  background: '#fff',
};

const primaryBtn: CSSProperties = {
  padding: '11px 20px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(135deg,#0066FF,#00C9C8)',
  color: '#fff',
  fontWeight: 700,
  fontSize: '0.84rem',
  cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(0,102,255,.28)',
};

const outlineBtn: CSSProperties = {
  padding: '9px 14px',
  borderRadius: 9,
  border: '1px solid #CBD5E1',
  background: '#fff',
  color: '#0F172A',
  fontWeight: 700,
  fontSize: '0.78rem',
  cursor: 'pointer',
};

function parseCompetitors(raw: string): string[] {
  // Prefer comma/newline splits so "XM Group" stays one competitor.
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 7);
}

function normDomain(d: string): string {
  let s = String(d || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
  if (s && !s.includes('.')) {
    s = s.replace(/\s+/g, '-').replace(/[^a-z0-9.-]/g, '').slice(0, 80);
  } else {
    s = s.replace(/\s+/g, '').slice(0, 200);
  }
  return s;
}

export default function MarketOverviewPanel() {
  const router = useRouter();
  const [category, setCategory] = useState('');
  const [domain, setDomain] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [summary, setSummary] = useState('');
  const [source, setSource] = useState('');
  const [analyzed, setAnalyzed] = useState(false);

  const run = useCallback(async () => {
    if (!category.trim() && !domain.trim()) return;
    setLoading(true);
    setError(null);
    const res = await apiPost<{
      ok?: boolean;
      error?: string;
      players?: Player[];
      summary?: string;
      source?: string;
    }>('/api/market-overview/analyze', {
      category: category.trim() || 'category',
      domain: domain.trim() || undefined,
      competitors: parseCompetitors(competitors),
    });
    if (!res.ok) {
      setError(res.error || 'Analyze failed');
      setLoading(false);
      return;
    }
    setPlayers(res.players || []);
    setSummary(res.summary || '');
    setSource(res.source || '');
    setAnalyzed(true);
    setLoading(false);
  }, [category, domain, competitors]);

  const maxShare = Math.max(1, ...players.map((p) => p.share_pct || 0));
  const leader = players[0];
  const you = useMemo(
    () => (domain.trim() ? players.find((p) => p.domain === normDomain(domain)) : null),
    [players, domain]
  );
  const totalVisits = players.reduce((s, p) => s + (p.visits_est || 0), 0);

  const actions = [
    {
      title: 'Attack share gaps vs the leader',
      desc: leader
        ? `${leader.domain} leads at ~${leader.share_pct}% share — find weak SERP pages to steal.`
        : 'Find easy-rank opportunities where rivals are weak.',
      cta: 'Open SERP Gap',
      view: 'serp-gap',
      color: '#D97706',
    },
    {
      title: 'Watch daily traffic shifts',
      desc: 'Confirm whether share moves are organic, paid, social, or referral before spending.',
      cta: 'Open Daily Trends',
      view: 'daily-trends',
      color: '#059669',
    },
    {
      title: 'Turn gaps into an Attack Plan',
      desc: 'Convert share deficits into an 8-week keyword, channel, and content plan.',
      cta: 'Generate Attack Plan',
      view: 'battleplan',
      color: '#0066FF',
      generate: true,
    },
  ];

  return (
    <div className="view-header-wrap">
      <div
        className="view-header ig-panel-hero"
        style={{
          background: 'linear-gradient(135deg,#e8f0ff 0%,#e7f8f6 55%,#eef6ff 100%)',
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span> <span className="bc-sep">›</span> Market Overview
              </div>
              <h2 className="view-title">🌐 Market Overview</h2>
              <p className="view-sub">
                Category traffic share — see who owns the market, how fast they&apos;re growing, and where you can take share.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            <div>
              <label style={lbl}>Category / industry</label>
              <input
                style={{ ...trInput, marginTop: 6 }}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Fintech & Finance"
              />
            </div>
            <div>
              <label style={lbl}>Your domain</label>
              <input
                style={{ ...trInput, marginTop: 6 }}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="yoursite.com"
              />
            </div>
            <div>
              <label style={lbl}>Competitors (comma-separated)</label>
              <input
                style={{ ...trInput, marginTop: 6 }}
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                placeholder="xm.com, plus500.com, etoro.com"
              />
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                Use commas between brands — e.g. <em>XM Group</em> stays one name if entered as <em>xm.com</em>.
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={loading || (!category.trim() && !domain.trim())}
            onClick={run}
            style={{
              ...primaryBtn,
              marginTop: 14,
              opacity: loading || (!category.trim() && !domain.trim()) ? 0.6 : 1,
            }}
          >
            {loading ? 'Analyzing market…' : 'Analyze market'}
          </button>
        </div>

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
            {error}
          </div>
        )}

        {analyzed && (
          <>
            {/* Metric legend / KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
              {[
                { label: 'Est. category visits', value: totalVisits ? totalVisits.toLocaleString() : '—', hint: 'Sum of tracked players’ estimated monthly visits' },
                { label: 'Your share of voice', value: you ? `${you.share_pct}%` : '—', hint: 'Your % of estimated visits among listed players' },
                { label: 'Market leader', value: leader ? `${leader.domain}` : '—', hint: leader ? `~${leader.share_pct}% share` : 'Run analysis to rank players' },
                { label: 'Data source', value: source || '—', hint: source === 'estimate' ? 'Heuristic until DataForSEO is connected' : 'Live provider metrics' },
              ].map((k) => (
                <div key={k.label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={lbl}>{k.label}</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A', marginTop: 4 }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{k.hint}</div>
                </div>
              ))}
            </div>

            {summary && (
              <div style={{ background: 'linear-gradient(135deg,#F0F9FF,#ECFDF5)', border: '1px solid #BAE6FD', borderRadius: 12, padding: '12px 16px', marginBottom: 14, color: '#0F172A', fontSize: '0.9rem' }}>
                {summary}
              </div>
            )}

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 18, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0F172A' }}>Competitive share ranking</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    Bars = relative share among listed players · % = estimated share of this set · visits = estimated monthly traffic · Δ = growth trend
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
                  <span style={{ padding: '3px 8px', borderRadius: 999, background: '#EFF6FF', color: '#1D4ED8', fontWeight: 700 }}>Share %</span>
                  <span style={{ padding: '3px 8px', borderRadius: 999, background: '#F1F5F9', color: '#475569', fontWeight: 700 }}>Est. visits</span>
                  <span style={{ padding: '3px 8px', borderRadius: 999, background: '#ECFDF5', color: '#047857', fontWeight: 700 }}>Growth Δ</span>
                </div>
              </div>

              {players.length === 0 && (
                <p style={{ color: '#64748B', fontSize: '0.875rem' }}>No players returned — add competitors as domains (comma-separated).</p>
              )}

              {players.map((p, idx) => {
                const isYou = !!domain && p.domain === normDomain(domain);
                return (
                  <div
                    key={p.domain + idx}
                    style={{
                      border: isYou ? '1px solid #93C5FD' : '1px solid #F1F5F9',
                      background: isYou ? '#F8FBFF' : '#fff',
                      borderRadius: 12,
                      padding: '12px 14px',
                      marginTop: 10,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 26, height: 26, borderRadius: 8, background: '#EEF2FF', color: '#3730A3', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
                          #{idx + 1}
                        </span>
                        <div>
                          <div style={{ fontWeight: 800, color: '#0F172A' }}>
                            {p.domain}
                            {isYou ? <span style={{ marginLeft: 8, fontSize: 11, color: '#2563EB', fontWeight: 700 }}>YOU</span> : null}
                            {idx === 0 ? <span style={{ marginLeft: 8, fontSize: 11, color: '#B45309', fontWeight: 700 }}>LEADER</span> : null}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: '0.85rem' }}>
                        <div title="Estimated share of visits among the players in this analysis">
                          <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700 }}>SHARE</div>
                          <div style={{ fontWeight: 800, color: '#1D4ED8' }}>{p.share_pct}%</div>
                        </div>
                        <div title="Estimated monthly visits">
                          <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700 }}>EST. VISITS / MO</div>
                          <div style={{ fontWeight: 800, color: '#0F172A' }}>{Math.round(p.visits_est).toLocaleString()}</div>
                        </div>
                        <div title="Estimated growth trend over the recent window">
                          <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700 }}>GROWTH</div>
                          <div style={{ fontWeight: 800, color: (p.growth_pct ?? 0) >= 0 ? '#059669' : '#DC2626' }}>
                            {p.growth_pct == null ? '—' : `${p.growth_pct >= 0 ? '+' : ''}${p.growth_pct}%`}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style={{ height: 12, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${(p.share_pct / maxShare) * 100}%`,
                          height: '100%',
                          background: isYou
                            ? 'linear-gradient(90deg,#0066FF,#38BDF8)'
                            : 'linear-gradient(90deg,#64748B,#94A3B8)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0F172A' }}>Recommended next steps</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Click through — each action opens the right InfoGenie tool.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
              {actions.map((a) => (
                <div key={a.view} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 99, background: a.color }} />
                  <div style={{ fontWeight: 800, color: '#0F172A' }}>{a.title}</div>
                  <div style={{ fontSize: '0.82rem', color: '#64748B', flex: 1 }}>{a.desc}</div>
                  <button
                    type="button"
                    style={{ ...outlineBtn, borderColor: a.color, color: a.color }}
                    onClick={() =>
                      goToView(
                        router,
                        a.view,
                        'generate' in a && a.generate ? { query: { generate: '1' } } : undefined
                      )
                    }
                  >
                    {a.cta} →
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {!analyzed && !loading && (
          <div style={{ background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 14, padding: 28, textAlign: 'center', color: '#64748B' }}>
            Enter your category and competitor domains, then click <strong>Analyze market</strong> to see share ranking and next actions.
          </div>
        )}
      </div>
    </div>
  );
}
