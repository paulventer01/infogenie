'use client';

import { useCallback, useState } from 'react';
import { apiPost } from '@/lib/api';

type Point = {
  date: string;
  visits: number;
  search?: number;
  social?: number;
  direct?: number;
  referral?: number;
  email?: number;
  paid?: number;
};

type AnalyzeResult = {
  ok?: boolean;
  error?: string;
  domain: string;
  competitors: string[];
  granularity: string;
  growth_pct: number;
  growth: Record<string, number>;
  channel_mix: Record<string, number>;
  channel_mix_fine?: Record<string, number>;
  series: Record<string, Point[]>;
  insight?: string;
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
};

const btnStyle = {
  padding: '9px 16px',
  borderRadius: 8,
  border: 'none',
  background: '#059669',
  color: '#fff',
  fontWeight: 700,
  fontSize: '0.8rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export default function DailyTrendsPanel() {
  const [domain, setDomain] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeResult | null>(null);

  const analyze = useCallback(async () => {
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    const comps = competitors.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
    const res = await apiPost<AnalyzeResult>('/api/daily-trends/analyze', {
      domain: domain.trim(),
      competitors: comps,
      days: 30,
    });
    if (!res.ok) {
      setError(res.error || 'Analyze failed');
      setLoading(false);
      return;
    }
    setData(res);
    setLoading(false);
  }, [domain, competitors]);

  const primarySeries = data?.series?.[data.domain] || [];
  const maxVisits = Math.max(1, ...primarySeries.map((p) => p.visits || 0));

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>📊 Daily Trends</h1>
      <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 6 }}>
        Track competitor traffic shifts day-by-day across search, social, direct, referral, email, and paid.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Domain</label>
          <input
            style={inputStyle}
            placeholder="Enter domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && analyze()}
          />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Competitors</label>
          <input
            style={inputStyle}
            placeholder="comp1.com, comp2.com"
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
          />
        </div>
        <button type="button" style={{ ...btnStyle, opacity: loading || !domain.trim() ? 0.6 : 1 }} disabled={loading || !domain.trim()} onClick={analyze}>
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 12 }}>{error}</p>}

      {data && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#F3F4F6' }}>
              {data.granularity}
            </span>
            <span
              style={{
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 999,
                background: data.growth_pct >= 0 ? '#059669' : '#E11D48',
                color: '#fff',
              }}
            >
              Growth {data.growth_pct >= 0 ? '+' : ''}
              {data.growth_pct}%
            </span>
          </div>
          {data.insight && <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>{data.insight}</p>}

          <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Daily visits — {data.domain}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 140 }}>
              {primarySeries.map((p) => (
                <div
                  key={p.date}
                  title={`${p.date}: ${p.visits.toLocaleString()}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: `${Math.max(4, (p.visits / maxVisits) * 100)}%`,
                    background: 'rgba(5,150,105,0.8)',
                    borderRadius: '3px 3px 0 0',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>
              <span>{primarySeries[0]?.date}</span>
              <span>{primarySeries[primarySeries.length - 1]?.date}</span>
            </div>
          </div>

          <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Paid vs owned channel split</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8 }}>
              {Object.entries(data.channel_mix_fine || data.channel_mix || {})
                .filter(([ch]) =>
                  [
                    'organic_search',
                    'paid_search',
                    'organic_social',
                    'paid_social',
                    'direct',
                    'referral',
                    'email',
                    'display',
                  ].includes(ch)
                )
                .map(([ch, v]) => (
                  <div key={ch} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'capitalize' }}>
                      {ch.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{Number(v).toLocaleString()}</div>
                  </div>
                ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, marginTop: 12 }}>
            {Object.entries(data.channel_mix || {}).map(([ch, v]) => (
              <div key={ch} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'capitalize' }}>{ch} (rollup)</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{Number(v).toLocaleString()}</div>
              </div>
            ))}
          </div>

          {(data.competitors || []).length > 0 && (
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Competitor overlay</div>
              {data.competitors.map((c) => {
                const series = data.series?.[c] || [];
                const last = series[series.length - 1]?.visits || 0;
                const g = data.growth?.[c];
                return (
                  <div key={c} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
                    <span style={{ fontWeight: 600 }}>{c}</span>
                    <span>
                      {last.toLocaleString()}
                      {g != null && (
                        <span style={{ marginLeft: 8, color: g >= 0 ? '#059669' : '#E11D48' }}>
                          {g >= 0 ? '+' : ''}
                          {g}%
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
