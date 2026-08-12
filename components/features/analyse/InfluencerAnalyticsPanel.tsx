'use client';

import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users } from 'lucide-react';

type Signal = {
  competitor: string;
  platform: string;
  influencer_handle: string;
  follower_count: number;
  engagement_rate: number;
  content_url?: string;
  theme: string;
  estimated_cost_usd: number;
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
    try {
      const res = await apiFetch<{
        signals: Signal[];
        summary?: string;
        next_steps?: string[];
      }>('/api/influencer-analytics/competitor-campaigns', {
        method: 'POST',
        body: JSON.stringify({ competitors: comps, niche: niche.trim() || 'marketing' }),
      });
      setSignals(res.signals || []);
      setSummary(res.summary || '');
      setNextSteps(res.next_steps || []);
    } catch (e: any) {
      setError(e?.message || 'Analyze failed');
    } finally {
      setLoading(false);
    }
  }, [competitors, niche]);

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6 text-fuchsia-600" />
          Influencer Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Extend Reach beyond owned channels — competitor creator campaigns, affinity, and estimated cost.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Competitors</label>
            <Input
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              placeholder="rival1.com, rival2.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Niche</label>
            <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="saas, beauty…" />
          </div>
          <div className="md:col-span-3">
            <Button onClick={run} disabled={loading || !competitors.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Analyze influencers
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Competitor creator signals ({signals.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {signals.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div>
                <div className="font-medium">{s.influencer_handle}</div>
                <div className="text-xs text-muted-foreground">
                  {s.competitor} · {s.platform} · {s.theme} · {Math.round(s.follower_count).toLocaleString()} followers · ER{' '}
                  {s.engagement_rate}%
                </div>
              </div>
              <Badge className="bg-fuchsia-600">~${Math.round(s.estimated_cost_usd).toLocaleString()}</Badge>
            </div>
          ))}
          {signals.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">Run analysis to see competitor creator activity.</p>
          )}
        </CardContent>
      </Card>

      {nextSteps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Next steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {nextSteps.map((t, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                · {t}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
