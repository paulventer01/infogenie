'use client';

import { useCallback, useState } from 'react';
import { apiPost } from '@/lib/api';

type BrandRow = {
  brand: string;
  is_primary?: boolean;
  estimated_monthly_spend_usd: number;
  active_creatives_est: number;
  channels: Record<string, { active: boolean; share_pct: number; formats: string[] }>;
  top_angle?: string;
};

type Creative = {
  brand?: string;
  platform?: string;
  headline?: string;
  primary_text?: string;
  cta?: string;
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
};

export default function AdIntelPanel() {
  const [domain, setDomain] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<BrandRow[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [insights, setInsights] = useState<string[]>([]);

  const run = useCallback(async () => {
    if (!domain.trim() && !competitors.trim()) return;
    setLoading(true);
    setError(null);
    const res = await apiPost<{
      ok?: boolean;
      error?: string;
      matrix: BrandRow[];
      recent_creatives: Creative[];
      insights: string[];
    }>('/api/ad-intel/overview', {
      domain: domain.trim() || undefined,
      competitors: competitors.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    });
    if (!res.ok) {
      setError(res.error || 'Analyze failed');
      setLoading(false);
      return;
    }
    setMatrix(res.matrix || []);
    setCreatives(res.recent_creatives || []);
    setInsights(res.insights || []);
    setLoading(false);
  }, [domain, competitors]);

  const totalSpend = matrix.reduce((s, r) => s + (r.estimated_monthly_spend_usd || 0), 0) || 1;

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>📣 Ad Intelligence</h1>
      <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 6 }}>
        AdClarity-style view of competitor display, social, and video spend & creatives.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Your domain</label>
          <input style={inputStyle} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yoursite.com" />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Competitors</label>
          <input
            style={inputStyle}
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
            placeholder="rival1.com, rival2.com"
          />
        </div>
        <button
          type="button"
          disabled={loading || (!domain.trim() && !competitors.trim())}
          onClick={run}
          style={{
            padding: '9px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#0284C7',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            opacity: loading || (!domain.trim() && !competitors.trim()) ? 0.6 : 1,
          }}
        >
          {loading ? 'Analyzing…' : 'Analyze ads'}
        </button>
      </div>

      {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 12 }}>{error}</p>}
      {insights.map((t, i) => (
        <p key={i} style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 8 }}>
          {t}
        </p>
      ))}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Spend & channel matrix</div>
        {matrix.map((row) => (
          <div key={row.brand} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>
                {row.brand}
                {row.is_primary ? ' (you)' : ''}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid #D1D5DB' }}>
                  ~${Math.round(row.estimated_monthly_spend_usd).toLocaleString()}/mo
                </span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#0284C7', color: '#fff' }}>
                  SoV {Math.round((row.estimated_monthly_spend_usd / totalSpend) * 100)}%
                </span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 6 }}>
              {Object.entries(row.channels || {}).map(([ch, v]) => (
                <div
                  key={ch}
                  style={{
                    border: '1px solid #E5E7EB',
                    borderRadius: 6,
                    padding: '6px 8px',
                    fontSize: 12,
                    opacity: v.active ? 1 : 0.4,
                  }}
                >
                  <div style={{ color: '#6B7280', textTransform: 'capitalize' }}>{ch}</div>
                  <div style={{ fontWeight: 700 }}>{v.share_pct}%</div>
                  <div style={{ color: '#9CA3AF' }}>{(v.formats || []).join(', ') || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {matrix.length === 0 && !loading && (
          <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>Enter domains to estimate channel spend.</p>
        )}
      </div>

      {creatives.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent creatives</div>
          {creatives.map((c, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                {c.headline || c.primary_text?.slice(0, 80) || 'Creative'}
              </div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>
                {c.brand} · {c.platform} · {c.cta || '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
