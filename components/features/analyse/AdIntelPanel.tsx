'use client';

import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Megaphone } from 'lucide-react';

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
  media_url?: string;
  cta?: string;
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
    try {
      const res = await apiFetch<{
        matrix: BrandRow[];
        recent_creatives: Creative[];
        insights: string[];
      }>('/api/ad-intel/overview', {
        method: 'POST',
        body: JSON.stringify({
          domain: domain.trim() || undefined,
          competitors: competitors.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        }),
      });
      setMatrix(res.matrix || []);
      setCreatives(res.recent_creatives || []);
      setInsights(res.insights || []);
    } catch (e: any) {
      setError(e?.message || 'Analyze failed');
    } finally {
      setLoading(false);
    }
  }, [domain, competitors]);

  const totalSpend = matrix.reduce((s, r) => s + (r.estimated_monthly_spend_usd || 0), 0) || 1;

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-sky-600" />
          Ad Intelligence
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          AdClarity-style view of competitor display, social, and video spend & creatives.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Your domain</label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yoursite.com" />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Competitors</label>
            <Input
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              placeholder="rival1.com, rival2.com"
            />
          </div>
          <Button onClick={run} disabled={loading || (!domain.trim() && !competitors.trim())}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Analyze ads
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {insights.map((t, i) => (
        <p key={i} className="text-sm text-muted-foreground">
          {t}
        </p>
      ))}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Spend & channel matrix</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {matrix.map((row) => (
            <div key={row.brand} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="font-medium">
                  {row.brand}
                  {row.is_primary ? ' (you)' : ''}
                </span>
                <div className="flex gap-2">
                  <Badge variant="outline">
                    ~${Math.round(row.estimated_monthly_spend_usd).toLocaleString()}/mo
                  </Badge>
                  <Badge className="bg-sky-600">
                    SoV {Math.round((row.estimated_monthly_spend_usd / totalSpend) * 100)}%
                  </Badge>
                  {row.top_angle && <Badge variant="secondary">{row.top_angle}</Badge>}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {Object.entries(row.channels || {}).map(([ch, v]) => (
                  <div key={ch} className={`rounded border px-2 py-1.5 text-xs ${v.active ? '' : 'opacity-40'}`}>
                    <div className="capitalize text-muted-foreground">{ch}</div>
                    <div className="font-semibold tabular-nums">{v.share_pct}%</div>
                    <div className="text-muted-foreground">{(v.formats || []).join(', ') || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {matrix.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">Enter domains to estimate channel spend.</p>
          )}
        </CardContent>
      </Card>

      {creatives.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent creatives (Ad Swipe)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {creatives.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
                <div>
                  <div className="font-medium text-sm">{c.headline || c.primary_text?.slice(0, 80) || 'Creative'}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.brand} · {c.platform} · {c.cta || '—'}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
