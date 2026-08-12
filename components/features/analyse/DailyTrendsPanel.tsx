'use client';

import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp } from 'lucide-react';

type Point = {
  date: string;
  visits: number;
  search?: number;
  social?: number;
  direct?: number;
  referral?: number;
  email?: number;
  paid?: number;
};

type AnalyzeResult = {
  ok?: boolean;
  domain: string;
  competitors: string[];
  granularity: string;
  growth_pct: number;
  growth: Record<string, number>;
  channel_mix: Record<string, number>;
  series: Record<string, Point[]>;
  insight?: string;
};

export default function DailyTrendsPanel() {
  const [domain, setDomain] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeResult | null>(null);

  const analyze = useCallback(async () => {
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const comps = competitors.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
      const res = await apiFetch<AnalyzeResult>('/api/daily-trends/analyze', {
        method: 'POST',
        body: JSON.stringify({ domain: domain.trim(), competitors: comps, days: 30 }),
      });
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Analyze failed');
    } finally {
      setLoading(false);
    }
  }, [domain, competitors]);

  const primarySeries = data?.series?.[data.domain] || [];
  const maxVisits = Math.max(1, ...primarySeries.map((p) => p.visits || 0));

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-emerald-600" />
          Daily Trends
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track competitor traffic shifts day-by-day across search, social, direct, referral, email, and paid.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Domain</label>
            <Input
              placeholder="Enter domain, subdomain or subfolder"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && analyze()}
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Competitors (optional)</label>
            <Input
              placeholder="Add competitors, comma-separated"
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
            />
          </div>
          <Button onClick={analyze} disabled={loading || !domain.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Analyze
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="outline">Granularity: {data.granularity}</Badge>
            <Badge className={data.growth_pct >= 0 ? 'bg-emerald-600' : 'bg-rose-600'}>
              Traffic growth {data.growth_pct >= 0 ? '+' : ''}
              {data.growth_pct}%
            </Badge>
          </div>
          {data.insight && <p className="text-sm text-muted-foreground">{data.insight}</p>}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Daily visits — {data.domain}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-0.5 h-40">
                {primarySeries.map((p) => (
                  <div key={p.date} className="flex-1 flex flex-col justify-end min-w-0">
                    <div
                      className="bg-emerald-500/80 hover:bg-emerald-600 rounded-t transition-all"
                      style={{ height: `${Math.max(4, (p.visits / maxVisits) * 100)}%` }}
                      title={`${p.date}: ${p.visits.toLocaleString()}`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>{primarySeries[0]?.date}</span>
                <span>{primarySeries[primarySeries.length - 1]?.date}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Channel mix (latest)</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.entries(data.channel_mix || {}).map(([ch, v]) => (
                <div key={ch} className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground capitalize">{ch}</div>
                  <div className="text-lg font-semibold tabular-nums">{Number(v).toLocaleString()}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          {(data.competitors || []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Competitor overlay</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.competitors.map((c) => {
                  const series = data.series?.[c] || [];
                  const last = series[series.length - 1]?.visits || 0;
                  const g = data.growth?.[c];
                  return (
                    <div key={c} className="flex items-center justify-between border-b py-2 last:border-0">
                      <span className="font-medium">{c}</span>
                      <span className="text-sm tabular-nums">
                        {last.toLocaleString()}
                        {g != null && (
                          <span className={g >= 0 ? ' text-emerald-600 ml-2' : ' text-rose-600 ml-2'}>
                            {g >= 0 ? '+' : ''}
                            {g}%
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
