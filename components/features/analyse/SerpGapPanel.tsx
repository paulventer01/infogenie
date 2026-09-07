'use client';

import { useCallback, useState } from 'react';
import { apiPost } from '@/lib/api';

type Opportunity = {
  keyword: string;
  competitor_domain: string;
  competitor_url: string;
  competitor_title?: string;
  position: number | null;
  my_position: number | null;
  opportunity_score: number;
  reasons?: string[];
  suggested_action?: string;
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
};

export default function SerpGapPanel() {
  const [domain, setDomain] = useState('');
  const [keywords, setKeywords] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ops, setOps] = useState<Opportunity[]>([]);
  const [summary, setSummary] = useState('');

  const run = useCallback(async () => {
    if (!domain.trim() || !keywords.trim()) return;
    setLoading(true);
    setError(null);
    const kws = keywords.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
    const res = await apiPost<{ ok?: boolean; error?: string; opportunities: Opportunity[]; summary?: string }>(
      '/api/serp-gap/analyze',
      { domain: domain.trim(), my_domain: domain.trim(), keywords: kws }
    );
    if (!res.ok) {
      setError(res.error || 'Analyze failed');
      setLoading(false);
      return;
    }
    setOps(res.opportunities || []);
    setSummary(res.summary || '');
    setLoading(false);
  }, [domain, keywords]);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>🎯 SERP Gap Analyzer</h1>
      <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 6 }}>
        Find easy-rank / weak-page opportunities where rivals hold fragile positions — feeds Attack Plan.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 180px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Your domain</label>
          <input style={inputStyle} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yoursite.com" />
        </div>
        <div style={{ flex: '2 1 280px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Seed keywords</label>
          <input
            style={inputStyle}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="best crm software, email marketing tool"
          />
        </div>
        <button
          type="button"
          disabled={loading || !domain.trim() || !keywords.trim()}
          onClick={run}
          style={{
            padding: '9px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#D97706',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            opacity: loading || !domain.trim() || !keywords.trim() ? 0.6 : 1,
          }}
        >
          {loading ? 'Finding…' : 'Find gaps'}
        </button>
      </div>

      {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 12 }}>{error}</p>}
      {summary && <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 12 }}>{summary}</p>}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Opportunities ({ops.length})</div>
        {ops.length === 0 && !loading && (
          <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>Run an analysis to surface weak competitor pages.</p>
        )}
        {ops.map((o, i) => (
          <div
            key={`${o.keyword}-${o.competitor_domain}-${i}`}
            style={{
              border: '1px solid #E5E7EB',
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{o.keyword}</div>
              <div style={{ fontSize: 12, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {o.competitor_url}
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>{(o.reasons || []).join(' · ') || o.suggested_action || ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid #D1D5DB' }}>
                #{o.position ?? '—'}
              </span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#F3F4F6' }}>
                {o.competitor_domain}
              </span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#D97706', color: '#fff' }}>
                Score {o.opportunity_score}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
