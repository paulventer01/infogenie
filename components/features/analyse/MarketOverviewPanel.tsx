'use client';

import { useCallback, useState } from 'react';
import { apiPost } from '@/lib/api';

type Player = {
  domain: string;
  share_pct: number;
  visits_est: number;
  growth_pct?: number | null;
  channels?: Record<string, number>;
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
} as const;

export default function MarketOverviewPanel() {
  const [category, setCategory] = useState('');
  const [domain, setDomain] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [summary, setSummary] = useState('');
  const [source, setSource] = useState('');
  const [nextSteps, setNextSteps] = useState<string[]>([]);

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
      next_steps?: string[];
    }>('/api/market-overview/analyze', {
      category: category.trim() || 'category',
      domain: domain.trim() || undefined,
      competitors: competitors.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    });
    if (!res.ok) {
      setError(res.error || 'Analyze failed');
      setLoading(false);
      return;
    }
    setPlayers(res.players || []);
    setSummary(res.summary || '');
    setSource(res.source || '');
    setNextSteps(res.next_steps || []);
    setLoading(false);
  }, [category, domain, competitors]);

  const maxShare = Math.max(1, ...players.map((p) => p.share_pct || 0));

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>🌐 Market Overview</h1>
      <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 6 }}>
        Category share landscape — who owns the market and where you can take share.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginTop: 16 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Category / industry</label>
          <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Fintech & Finance" />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Your domain</label>
          <input style={inputStyle} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yoursite.com" />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Competitors</label>
          <input
            style={inputStyle}
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
            placeholder="rival1.com, rival2.com"
          />
        </div>
      </div>
      <button
        type="button"
        disabled={loading || (!category.trim() && !domain.trim())}
        onClick={run}
        style={{
          marginTop: 12,
          padding: '9px 16px',
          borderRadius: 8,
          border: 'none',
          background: '#1D4ED8',
          color: '#fff',
          fontWeight: 700,
          fontSize: '0.8rem',
          cursor: 'pointer',
          opacity: loading || (!category.trim() && !domain.trim()) ? 0.6 : 1,
        }}
      >
        {loading ? 'Analyzing…' : 'Analyze market'}
      </button>

      {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 12 }}>{error}</p>}
      {summary && <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 12 }}>{summary}</p>}
      {source && (
        <span style={{ display: 'inline-block', marginTop: 8, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#F3F4F6' }}>
          Source: {source}
        </span>
      )}

      <div style={{ marginTop: 16 }}>
        {players.map((p) => (
          <div key={p.domain} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontWeight: 700 }}>{p.domain}</span>
              <span style={{ fontSize: '0.875rem' }}>
                {p.share_pct}% · {Math.round(p.visits_est).toLocaleString()} visits
                {p.growth_pct != null && (
                  <span style={{ marginLeft: 8, color: p.growth_pct >= 0 ? '#059669' : '#E11D48' }}>
                    {p.growth_pct >= 0 ? '+' : ''}
                    {p.growth_pct}%
                  </span>
                )}
              </span>
            </div>
            <div style={{ height: 10, background: '#F3F4F6', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(p.share_pct / maxShare) * 100}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg,#1D4ED8,#06B6D4)',
                }}
              />
            </div>
          </div>
        ))}
        {players.length === 0 && !loading && (
          <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>Enter a category or domain to map market share.</p>
        )}
      </div>

      {nextSteps.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Next steps</div>
          {nextSteps.map((t, i) => (
            <p key={i} style={{ color: '#6B7280', fontSize: '0.875rem', margin: '4px 0' }}>
              · {t}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
