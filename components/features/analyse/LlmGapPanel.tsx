'use client';

import { useCallback, useState } from 'react';
import { apiPost } from '@/lib/api';

type Gap = {
  prompt: string;
  brand_mentioned: boolean;
  brand_rank: number | null;
  cited: Array<{ brand?: string; domain?: string; why?: string; strength?: number }>;
  missing_angles: string[];
  content_fixes: string[];
  gap_severity: string;
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
};

export default function LlmGapPanel() {
  const [brand, setBrand] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [prompts, setPrompts] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [summary, setSummary] = useState('');

  const run = useCallback(async () => {
    if (!brand.trim() || !prompts.trim()) return;
    setLoading(true);
    setError(null);
    const res = await apiPost<{ ok?: boolean; error?: string; gaps: Gap[]; summary: string }>(
      '/api/llm-gap/analyze',
      {
        brand: brand.trim(),
        competitors: competitors.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        prompts: prompts.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6),
      }
    );
    if (!res.ok) {
      setError(res.error || 'Analyze failed');
      setLoading(false);
      return;
    }
    setGaps(res.gaps || []);
    setSummary(res.summary || '');
    setLoading(false);
  }, [brand, competitors, prompts]);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>🤖 LLM Gap Analyzer</h1>
      <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 6 }}>
        Deepen AI visibility — find citation and answer gaps vs competitors across ChatGPT-class answers.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginTop: 16 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Brand</label>
          <input style={inputStyle} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Your brand" />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Competitors</label>
          <input style={inputStyle} value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="comp1, comp2" />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>Prompts / queries</label>
          <input style={inputStyle} value={prompts} onChange={(e) => setPrompts(e.target.value)} placeholder="best X tool, how to Y" />
        </div>
      </div>
      <button
        type="button"
        disabled={loading || !brand.trim() || !prompts.trim()}
        onClick={run}
        style={{
          marginTop: 12,
          padding: '9px 16px',
          borderRadius: 8,
          border: 'none',
          background: '#7C3AED',
          color: '#fff',
          fontWeight: 700,
          fontSize: '0.8rem',
          cursor: 'pointer',
          opacity: loading || !brand.trim() || !prompts.trim() ? 0.6 : 1,
        }}
      >
        {loading ? 'Analyzing…' : 'Analyze LLM gaps'}
      </button>

      {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 12 }}>{error}</p>}
      {summary && <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: 12 }}>{summary}</p>}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Citation & answer gaps ({gaps.length})</div>
        {gaps.map((g, i) => (
          <div key={i} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>{g.prompt}</span>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: g.gap_severity === 'high' ? '#E11D48' : g.gap_severity === 'medium' ? '#D97706' : '#6B7280',
                  color: '#fff',
                }}
              >
                {g.gap_severity}
              </span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid #D1D5DB' }}>
                {g.brand_mentioned ? 'Cited' : 'Missing'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
              Cited: {(g.cited || []).map((c) => c.brand || c.domain).filter(Boolean).join(', ') || '—'}
            </div>
            {(g.content_fixes || []).length > 0 && <div style={{ fontSize: '0.875rem', marginTop: 4 }}>{g.content_fixes[0]}</div>}
          </div>
        ))}
        {gaps.length === 0 && !loading && (
          <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>Run analysis to surface AI citation gaps.</p>
        )}
      </div>
    </div>
  );
}
