'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { goToView } from '@/lib/nav';
import { useRouter } from 'next/navigation';

type Scene = {
  scene: number;
  duration_s: number;
  shot: string;
  action: string;
  voiceover: string;
  text_overlay: string;
};

export default function AiVideoPanel() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [brand, setBrand] = useState('');
  const [provider, setProvider] = useState('auto');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ runway?: boolean; heygen?: boolean }>({});
  const [storyboard, setStoryboard] = useState<Scene[]>([]);
  const [meta, setMeta] = useState<{ provider?: string; status?: string; warning?: string }>({});

  useEffect(() => {
    apiGet<{ ok?: boolean; runway?: boolean; heygen?: boolean }>('/api/ai-video/status').then((r) => {
      setStatus({ runway: !!r.runway, heygen: !!r.heygen });
    });
  }, []);

  const run = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    const r = await apiPost<{
      ok?: boolean;
      error?: string;
      provider?: string;
      status?: string;
      warning?: string;
      storyboard?: Scene[];
    }>('/api/ai-video/generate', {
      prompt: prompt.trim(),
      brand: brand.trim(),
      provider,
      duration_seconds: 24,
    });
    if (!r.ok) {
      setError(r.error || 'Generate failed');
      setLoading(false);
      return;
    }
    setStoryboard(r.storyboard || []);
    setMeta({ provider: r.provider, status: r.status, warning: r.warning });
    setLoading(false);
  }, [prompt, brand, provider]);

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero" style={{ background: 'linear-gradient(135deg,#fff1f2 0%,#eef2ff 55%,#ecfeff 100%)' }}>
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span> <span className="bc-sep">›</span> AI Video
              </div>
              <h2 className="view-title">🎬 AI Video (Runway / HeyGen)</h2>
              <p className="view-sub">
                Generate short-form video jobs or production-ready storyboards for ads, Reels, and avatar spots.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: status.runway ? '#DCFCE7' : '#F1F5F9', color: status.runway ? '#166534' : '#64748B', fontWeight: 700 }}>
            Runway {status.runway ? 'connected' : 'not configured'}
          </span>
          <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: status.heygen ? '#DCFCE7' : '#F1F5F9', color: status.heygen ? '#166534' : '#64748B', fontWeight: 700 }}>
            HeyGen {status.heygen ? 'connected' : 'not configured'}
          </span>
        </div>

        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 18 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>PROMPT / SCRIPT</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="15s fintech ad: hook on switching costs, show app UI, end on free account CTA…"
            style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #D1D5DB', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, marginTop: 12, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>BRAND</label>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="cmtrading.com" style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid #D1D5DB' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>PROVIDER</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid #D1D5DB' }}>
                <option value="auto">Auto (HeyGen → Runway → storyboard)</option>
                <option value="heygen">HeyGen avatar</option>
                <option value="runway">Runway gen</option>
                <option value="storyboard">Storyboard only</option>
              </select>
            </div>
            <button
              type="button"
              disabled={loading || !prompt.trim()}
              onClick={run}
              style={{
                padding: '11px 18px',
                borderRadius: 10,
                border: 'none',
                background: 'linear-gradient(135deg,#E11D48,#7C3AED)',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: loading || !prompt.trim() ? 0.6 : 1,
              }}
            >
              {loading ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>

        {error && <p style={{ color: '#DC2626', marginTop: 12 }}>{error}</p>}
        {meta.provider && (
          <p style={{ color: '#64748B', marginTop: 12, fontSize: '0.875rem' }}>
            Provider: <strong>{meta.provider}</strong> · Status: {meta.status}
            {meta.warning ? ` · ${meta.warning}` : ''}
          </p>
        )}

        {storyboard.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Storyboard</div>
            {storyboard.map((s) => (
              <div key={s.scene} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 14, marginBottom: 8 }}>
                <div style={{ fontWeight: 800 }}>Scene {s.scene} · {s.shot} · {s.duration_s}s</div>
                <div style={{ fontSize: '0.875rem', color: '#334155', marginTop: 4 }}>{s.action}</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>VO: {s.voiceover}</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>Overlay: {s.text_overlay}</div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" onClick={() => goToView(router, 'voiceover')} style={{ padding: '9px 14px', borderRadius: 9, border: '1px solid #CBD5E1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                Generate voiceover →
              </button>
              <button type="button" onClick={() => goToView(router, 'canva')} style={{ padding: '9px 14px', borderRadius: 9, border: '1px solid #CBD5E1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                Open in Canva →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
