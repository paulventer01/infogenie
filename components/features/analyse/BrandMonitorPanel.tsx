'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

type Dash = {
  ok?: boolean;
  error?: string;
  brand?: string;
  inbox_new: number;
  mentions: Array<{
    source?: string;
    title?: string;
    content?: string;
    sentiment?: string;
    occurred_at?: string;
  }>;
  crisis: Array<{ severity?: string; title?: string; summary?: string }>;
  media: Array<{ title?: string; source?: string; sentiment?: string }>;
  sov: Array<{ brand?: string; mentions?: number; pos_count?: number; neu_count?: number; neg_count?: number }>;
  alerts: Array<{ type?: string; severity?: string; text?: string }>;
  summary?: string;
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
};

export default function BrandMonitorPanel() {
  const [brand, setBrand] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Dash | null>(null);

  const load = useCallback(async (b?: string) => {
    setLoading(true);
    setError(null);
    const q = b?.trim() ? `?brand=${encodeURIComponent(b.trim())}` : '';
    const res = await apiGet<Dash>(`/api/brand-monitor/dashboard${q}`);
    if (!res.ok) {
      setError(res.error || 'Load failed');
      setLoading(false);
      return;
    }
    setData(res);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sov = data?.sov?.[0];
  const pos = sov?.pos_count ?? 0;
  const neu = sov?.neu_count ?? 0;
  const neg = sov?.neg_count ?? 0;
  const mentionTotal = (data?.mentions?.length || 0) + (data?.media?.length || 0);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>📡 Brand Monitoring</h1>
      <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 6 }}>
        Complements Crisis Radar and mention SoV — unified brand mention pulse across inbox, media, and social.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Brand filter (optional)</label>
          <input style={inputStyle} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" />
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => load(brand)}
          style={{
            padding: '9px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#E11D48',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 12 }}>{error}</p>}
      {data?.summary && <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 12 }}>{data.summary}</p>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10, marginTop: 16 }}>
            {[
              { label: 'Recent mentions', value: String(mentionTotal) },
              { label: 'Inbox new', value: String(data.inbox_new) },
              { label: 'Crisis alerts', value: String(data.crisis?.length || 0), color: '#E11D48' },
              { label: 'SoV sentiment', value: `+${pos} · =${neu} · -${neg}` },
            ].map((k) => (
              <div key={k.label} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#6B7280' }}>{k.label}</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: k.color || undefined }}>{k.value}</div>
              </div>
            ))}
          </div>

          {(data.alerts || []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Alerts</div>
              {data.alerts.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '8px 0',
                    borderBottom: '1px solid #F3F4F6',
                  }}
                >
                  <span style={{ fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.text}</span>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: a.severity === 'high' ? '#E11D48' : '#D97706',
                      color: '#fff',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {a.type}:{a.severity}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent mentions</div>
            {(data.mentions || []).length === 0 && (
              <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>No recent mentions in aggregated sources yet.</p>
            )}
            {(data.mentions || []).map((m, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 0',
                  borderBottom: '1px solid #F3F4F6',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                    {m.title || m.content?.slice(0, 100) || 'Mention'}
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>
                    {m.source}
                    {m.occurred_at ? ` · ${m.occurred_at}` : ''}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background:
                      m.sentiment === 'positive' ? '#059669' : m.sentiment === 'negative' ? '#E11D48' : '#6B7280',
                    color: '#fff',
                    height: 'fit-content',
                  }}
                >
                  {m.sentiment || 'neutral'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
