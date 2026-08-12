'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Radio } from 'lucide-react';

type Dash = {
  ok?: boolean;
  brand?: string;
  inbox_new: number;
  mentions: Array<{
    source?: string;
    title?: string;
    content?: string;
    sentiment?: string;
    occurred_at?: string;
    source_url?: string;
  }>;
  crisis: Array<{ severity?: string; title?: string; summary?: string; created_at?: string }>;
  media: Array<{ title?: string; source?: string; sentiment?: string; published_at?: string }>;
  sov: Array<{ brand?: string; mentions?: number; pos_count?: number; neu_count?: number; neg_count?: number }>;
  alerts: Array<{ type?: string; severity?: string; text?: string; at?: string }>;
  summary?: string;
};

export default function BrandMonitorPanel() {
  const [brand, setBrand] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Dash | null>(null);

  const load = useCallback(async (b?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = b?.trim() ? `?brand=${encodeURIComponent(b.trim())}` : '';
      const res = await apiFetch<Dash>(`/api/brand-monitor/dashboard${q}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
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
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Radio className="h-6 w-6 text-rose-600" />
          Brand Monitoring
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complements Crisis Radar and mention SoV — unified brand mention pulse across inbox, media, and social.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Brand filter (optional)</label>
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" />
          </div>
          <Button onClick={() => load(brand)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Refresh
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.summary && <p className="text-sm text-muted-foreground">{data.summary}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Recent mentions</div>
                <div className="text-2xl font-semibold tabular-nums">{mentionTotal}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Inbox new</div>
                <div className="text-2xl font-semibold tabular-nums">{data.inbox_new}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Crisis alerts</div>
                <div className="text-2xl font-semibold tabular-nums text-rose-600">{data.crisis?.length || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">SoV sentiment</div>
                <div className="text-sm mt-1">
                  <span className="text-emerald-600">+{pos}</span>
                  {' · '}
                  <span className="text-muted-foreground">={neu}</span>
                  {' · '}
                  <span className="text-rose-600">-{neg}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {(data.alerts || []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Alerts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.alerts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border-b py-2 last:border-0">
                    <div className="text-sm min-w-0 truncate">{a.text}</div>
                    <Badge className={a.severity === 'high' ? 'bg-rose-600' : 'bg-amber-600'}>
                      {a.type}:{a.severity}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent mentions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(data.mentions || []).map((m, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{m.title || m.content?.slice(0, 100) || 'Mention'}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.source}
                      {m.occurred_at ? ` · ${m.occurred_at}` : ''}
                    </div>
                  </div>
                  <Badge
                    className={
                      m.sentiment === 'positive'
                        ? 'bg-emerald-600'
                        : m.sentiment === 'negative'
                          ? 'bg-rose-600'
                          : 'bg-slate-500'
                    }
                  >
                    {m.sentiment || 'neutral'}
                  </Badge>
                </div>
              ))}
              {(data.mentions || []).length === 0 && (
                <p className="text-sm text-muted-foreground">No recent mentions in aggregated sources yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
