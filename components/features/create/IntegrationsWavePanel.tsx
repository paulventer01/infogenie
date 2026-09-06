'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { goToView } from '@/lib/nav';
import { useRouter } from 'next/navigation';

type Status = { grok?: boolean; fireflies?: boolean; deepl?: boolean; notion?: boolean };

export default function IntegrationsWavePanel() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  // Grok
  const [grokPrompt, setGrokPrompt] = useState('best CFD trading platform for beginners');
  const [grokBrand, setGrokBrand] = useState('cmtrading.com');
  const [grokAnswer, setGrokAnswer] = useState('');

  // Fireflies
  const [ffTranscript, setFfTranscript] = useState('');
  const [ffTitle, setFfTitle] = useState('Discovery call');

  // DeepL
  const [dlText, setDlText] = useState('Switch to a platform built for serious traders.');
  const [dlTarget, setDlTarget] = useState('ES');
  const [dlOut, setDlOut] = useState('');

  // Notion
  const [ntTitle, setNtTitle] = useState('Attack Plan brief');
  const [ntBody, setNtBody] = useState('Executive summary\n\nWeek 1–2 focus\n\nKeyword targets');

  const refresh = useCallback(async () => {
    const s = await apiGet<{ ok?: boolean } & Status>('/api/integrations-wave/status');
    setStatus(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pill = (ok?: boolean, label?: string) => (
    <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: ok ? '#DCFCE7' : '#F1F5F9', color: ok ? '#166534' : '#64748B', fontWeight: 700 }}>
      {label} {ok ? 'ready' : 'add key'}
    </span>
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero" style={{ background: 'linear-gradient(135deg,#f5f3ff 0%,#eff6ff 55%,#ecfdf5 100%)' }}>
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span> <span className="bc-sep">›</span> Integrations Wave
              </div>
              <h2 className="view-title">🔌 Grok · Fireflies · DeepL · Notion</h2>
              <p className="view-sub">
                Next-wave integrations that fill real InfoGenie gaps — AI visibility, meeting ingest, localization, and brief handoff.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {pill(status.grok, 'Grok/xAI')}
          {pill(status.fireflies, 'Fireflies')}
          {pill(status.deepl, 'DeepL')}
          {pill(status.notion, 'Notion')}
          <button type="button" onClick={() => goToView(router, 'settings')} style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            Open Settings →
          </button>
        </div>

        {msg && <p style={{ color: '#0F766E', fontSize: '0.875rem', marginBottom: 12 }}>{msg}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
          {/* Grok */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>𝕏 Grok visibility probe</div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>Ask how Grok would answer a category query — complements LLM Gap.</div>
            <input value={grokBrand} onChange={(e) => setGrokBrand(e.target.value)} placeholder="Brand" style={{ width: '100%', marginBottom: 8, padding: 8, borderRadius: 8, border: '1px solid #D1D5DB' }} />
            <textarea value={grokPrompt} onChange={(e) => setGrokPrompt(e.target.value)} rows={3} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #D1D5DB', fontFamily: 'inherit' }} />
            <button
              type="button"
              disabled={busy === 'grok'}
              onClick={async () => {
                setBusy('grok');
                const r = await apiPost<{ ok?: boolean; answer?: string; error?: string }>('/api/integrations-wave/grok/ask', {
                  prompt: grokPrompt,
                  brand: grokBrand,
                });
                setGrokAnswer(r.answer || r.error || '');
                setBusy('');
              }}
              style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              {busy === 'grok' ? 'Asking…' : 'Ask Grok'}
            </button>
            {grokAnswer && <p style={{ fontSize: '0.82rem', marginTop: 10, color: '#334155' }}>{grokAnswer}</p>}
            <button type="button" onClick={() => goToView(router, 'llm-gap')} style={{ marginTop: 8, background: 'none', border: 'none', color: '#2563EB', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12 }}>
              Open LLM Gap →
            </button>
          </div>

          {/* Fireflies */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>🎙 Fireflies ingest</div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>Pipe a transcript into Meeting Notes for BANT summary.</div>
            <input value={ffTitle} onChange={(e) => setFfTitle(e.target.value)} placeholder="Meeting title" style={{ width: '100%', marginBottom: 8, padding: 8, borderRadius: 8, border: '1px solid #D1D5DB' }} />
            <textarea value={ffTranscript} onChange={(e) => setFfTranscript(e.target.value)} rows={4} placeholder="Paste transcript…" style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #D1D5DB', fontFamily: 'inherit' }} />
            <button
              type="button"
              disabled={busy === 'ff' || !ffTranscript.trim()}
              onClick={async () => {
                setBusy('ff');
                const r = await apiPost<{ ok?: boolean; error?: string; next?: string }>('/api/integrations-wave/fireflies/ingest', {
                  title: ffTitle,
                  transcript: ffTranscript,
                });
                setMsg(r.ok ? r.next || 'Ingested.' : r.error || 'Failed');
                setBusy('');
              }}
              style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              {busy === 'ff' ? 'Ingesting…' : 'Ingest transcript'}
            </button>
            <button type="button" onClick={() => goToView(router, 'meeting-notes')} style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', color: '#2563EB', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12 }}>
              Open Meeting Notes →
            </button>
          </div>

          {/* DeepL */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>🌍 DeepL localize</div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>Campaign-quality translation for multi-market launches.</div>
            <textarea value={dlText} onChange={(e) => setDlText(e.target.value)} rows={3} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #D1D5DB', fontFamily: 'inherit' }} />
            <select value={dlTarget} onChange={(e) => setDlTarget(e.target.value)} style={{ width: '100%', marginTop: 8, padding: 8, borderRadius: 8, border: '1px solid #D1D5DB' }}>
              {['ES', 'DE', 'FR', 'PT', 'IT', 'JA', 'ZH'].map((l) => (
                <option key={l} value={l}>
                  Target {l}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy === 'dl' || !dlText.trim()}
              onClick={async () => {
                setBusy('dl');
                const r = await apiPost<{ ok?: boolean; translations?: { text: string }[]; error?: string }>(
                  '/api/integrations-wave/deepl/translate',
                  { text: dlText, target_lang: dlTarget }
                );
                setDlOut(r.translations?.[0]?.text || r.error || '');
                setBusy('');
              }}
              style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, border: 'none', background: '#0F766E', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              {busy === 'dl' ? 'Translating…' : 'Translate'}
            </button>
            {dlOut && <p style={{ fontSize: '0.82rem', marginTop: 10, color: '#334155' }}>{dlOut}</p>}
            <button type="button" onClick={() => goToView(router, 'localization')} style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', color: '#2563EB', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12 }}>
              Open Localization →
            </button>
          </div>

          {/* Notion */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>📓 Notion export</div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>Push an Attack Plan / brief into your agency Notion workspace.</div>
            <input value={ntTitle} onChange={(e) => setNtTitle(e.target.value)} style={{ width: '100%', marginBottom: 8, padding: 8, borderRadius: 8, border: '1px solid #D1D5DB' }} />
            <textarea value={ntBody} onChange={(e) => setNtBody(e.target.value)} rows={4} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #D1D5DB', fontFamily: 'inherit' }} />
            <button
              type="button"
              disabled={busy === 'nt' || !ntBody.trim()}
              onClick={async () => {
                setBusy('nt');
                const r = await apiPost<{ ok?: boolean; url?: string; note?: string; error?: string }>(
                  '/api/integrations-wave/notion/export',
                  { title: ntTitle, body: ntBody }
                );
                setMsg(r.url ? `Notion page: ${r.url}` : r.note || r.error || 'Exported');
                setBusy('');
              }}
              style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              {busy === 'nt' ? 'Exporting…' : 'Export to Notion'}
            </button>
            <button type="button" onClick={() => goToView(router, 'battleplan')} style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', color: '#2563EB', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12 }}>
              Open Battle Plan →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
