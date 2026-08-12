'use client';

import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Target } from 'lucide-react';

type Opportunity = {
  keyword: string;
  competitor_domain: string;
  competitor_url: string;
  competitor_title?: string;
  position: number | null;
  my_position: number | null;
  opportunity_score: number;
  weakness_score?: number;
  reasons?: string[];
  suggested_action?: string;
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
    try {
      const kws = keywords.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
      const res = await apiFetch<{ opportunities: Opportunity[]; summary?: string }>('/api/serp-gap/analyze', {
        method: 'POST',
        body: JSON.stringify({ domain: domain.trim(), my_domain: domain.trim(), keywords: kws }),
      });
      setOps(res.opportunities || []);
      setSummary(res.summary || '');
    } catch (e: any) {
      setError(e?.message || 'Analyze failed');
    } finally {
      setLoading(false);
    }
  }, [domain, keywords]);

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Target className="h-6 w-6 text-amber-600" />
          SERP Gap Analyzer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Find easy-rank / weak-page opportunities where rivals hold fragile positions — feeds Attack Plan.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Your domain</label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yoursite.com" />
          </div>
          <div className="flex-[2] space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Seed keywords</label>
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="best crm software, email marketing tool, …"
            />
          </div>
          <Button onClick={run} disabled={loading || !domain.trim() || !keywords.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Find gaps
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Opportunities ({ops.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ops.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">Run an analysis to surface weak competitor pages.</p>
          )}
          {ops.map((o, i) => (
            <div
              key={`${o.keyword}-${o.competitor_domain}-${i}`}
              className="rounded-md border p-3 flex flex-col md:flex-row md:items-center gap-2 justify-between"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{o.keyword}</div>
                <div className="text-xs text-muted-foreground truncate">{o.competitor_url}</div>
                <div className="text-xs mt-1">
                  {(o.reasons || []).join(' · ') || o.suggested_action || ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline">#{o.position ?? '—'}</Badge>
                <Badge variant="secondary">{o.competitor_domain}</Badge>
                <Badge className="bg-amber-600">Score {o.opportunity_score}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
