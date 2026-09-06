'use client';

import { useCallback, useState } from 'react';
import { apiPost } from '@/lib/api';

type Row = {
  domain: string;
  share_pct: number;
  visits_est?: number | null;
  type?: string;
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
} as const;

export default function SourcesDestinationsPanel() {
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referrers, setReferrers] = useState<Row[]>([]);
  const [destinations, setDestinations] = useState<Row[]>([]);
  const [insights, setInsights] = useState<string[]>([]);
  const [source, setSource] = useState('');

  const run = useCallback(async () => {
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    const res = await apiPost<{
      ok?: boolean;
      error?: string;
      referrers?: Row[];
      destinations?: Row[];
      insights?: string[];
      source?: string;
    }>('/api/traffic-sources/analyze', { domain: domain.trim() });
    if (!res.ok) {
      setError(res.error || 'Analyze failed');
      setLoading(false);
      return;
    }
    setReferrers(res.referrers || []);
    setDestinations(res.destinations || []);
    setInsights(res.insights || []);
    setSource(res.source || '');
    setLoading(false);
  }, [domain]);

  const list = (title: string, rows: Row[]) => (
    <div style={{ flex: 1, minWidth: 280, border: '1px solid #E5E7EB', borderRadius: 10, padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {rows.length === 0 && <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>No rows yet.</p>}
      {rows.map((r) => (
        <div
          key={r.domain + title}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{r.domain}</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>{r.type || '—'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700 }}>{r.share_pct}%</div>
            {r.visits_est != null && (
              <div style={{ fontSize: 11, color: '#6B7280' }}>{Number(r.visits_est).toLocaleString()}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>🔗 Sources & Destinations</h1>
      <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 6 }}>
        Referral partners and outbound destinations — grow alliances, spot conversion leaks.
      </p>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 240px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Domain</label>
          <input style={inputStyle} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yoursite.com" />
        </div>
        <button
          type="button"
          disabled={loading || !domain.trim()}
          onClick={run}
          style={{
            padding: '9px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#0F766E',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            opacity: loading || !domain.trim() ? 0.6 : 1,
          }}
        >
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 12 }}>{error}</p>}
      {source && (
        <span style={{ display: 'inline-block', marginTop: 10, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#F3F4F6' }}>
          Source: {source}
        </span>
      )}
      {insights.map((t, i) => (
        <p key={i} style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 8 }}>
          {t}
        </p>
      ))}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
        {list('Top sources (referrers)', referrers)}
        {list('Top destinations', destinations)}
      </div>
    </div>
  );
}
