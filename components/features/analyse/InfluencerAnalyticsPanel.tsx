'use client';

import { useCallback, useState } from 'react';
import { apiPost } from '@/lib/api';

type Signal = {
  competitor: string;
  platform: string;
  influencer_handle: string;
  follower_count: number;
  engagement_rate: number;
  theme: string;
  estimated_cost_usd: number;
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
};

export default function InfluencerAnalyticsPanel() {
  const [competitors, setCompetitors] = useState('');
  const [niche, setNiche] = useState('marketing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [summary, setSummary] = useState('');
  const [nextSteps, setNextSteps] = useState<string[]>([]);

  const run = useCallback(async () => {
    const comps = competitors.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!comps.length) return;
    setLoading(true);
    setError(null);
    const res = await apiPost<{
      ok?: boolean;
      error?: string;
      signals: Signal[];
      summary?: string;
      next_steps?: string[];
    }>('/api/influencer-analytics/competitor-campaigns', {
      competitors: comps,
      niche: niche.trim() || 'marketing',
    });
    if (!res.ok) {
      setError(res.error || 'Analyze failed');
      setLoading(false);
      return;
    }
    setSignals(res.signals || []);
    setSummary(res.summary || '');
    setNextSteps(res.next_steps || []);
    setLoading(false);
  }, [competitors, niche]);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>📡 Influencer Analytics</h1>
      <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 6 }}>
        Extend Reach beyond owned channels — competitor creator campaigns, affinity, and estimated cost.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 16 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Competitors</label>
          <input
            style={inputStyle}
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
            placeholder="rival1.com, rival2.com"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Niche</label>
          <input style={inputStyle} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="saas, beauty…" />
        </div>
      </div>
      <button
        type="button"
        disabled={loading || !competitors.trim()}
        onClick={run}
        style={{
          marginTop: 12,
          padding: '9px 16px',
          borderRadius: 8,
          border: 'none',
          background: '#C026D3',
          color: '#fff',
          fontWeight: 700,
          fontSize: '0.8rem',
          cursor: 'pointer',
          opacity: loading || !competitors.trim() ? 0.6 : 1,
        }}
      >
        {loading ? 'Analyzing…' : 'Analyze influencers'}
      </button>

      {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 12 }}>{error}</p>}
      {summary && <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 12 }}>{summary}</p>}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Competitor creator signals ({signals.length})</div>
        {signals.map((s, i) => (
          <div
            key={i}
            style={{
              border: '1px solid #E5E7EB',
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{s.influencer_handle}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>
                {s.competitor} · {s.platform} · {s.theme} · {Math.round(s.follower_count).toLocaleString()} followers · ER{' '}
                {s.engagement_rate}%
              </div>
            </div>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#C026D3', color: '#fff' }}>
              ~${Math.round(s.estimated_cost_usd).toLocaleString()}
            </span>
          </div>
        ))}
        {signals.length === 0 && !loading && (
          <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>Run analysis to see competitor creator activity.</p>
        )}
      </div>

      {nextSteps.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Next steps</div>
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
