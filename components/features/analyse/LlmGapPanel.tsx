'use client';

import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Bot } from 'lucide-react';

type Gap = {
  prompt: string;
  brand_mentioned: boolean;
  brand_rank: number | null;
  cited: Array<{ brand?: string; domain?: string; why?: string; strength?: number }>;
  missing_angles: string[];
  content_fixes: string[];
  gap_severity: string;
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
    try {
      const res = await apiFetch<{ gaps: Gap[]; summary: string }>('/api/llm-gap/analyze', {
        method: 'POST',
        body: JSON.stringify({
          brand: brand.trim(),
          competitors: competitors.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
          prompts: prompts.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6),
        }),
      });
      setGaps(res.gaps || []);
      setSummary(res.summary || '');
    } catch (e: any) {
      setError(e?.message || 'Analyze failed');
    } finally {
      setLoading(false);
    }
  }, [brand, competitors, prompts]);

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Bot className="h-6 w-6 text-violet-600" />
          LLM Gap Analyzer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Deepen AI visibility — find citation and answer gaps vs competitors across ChatGPT-class answers.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Brand</label>
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Your brand" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Competitors</label>
            <Input value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="comp1, comp2" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Prompts / queries</label>
            <Input value={prompts} onChange={(e) => setPrompts(e.target.value)} placeholder="best X tool, how to Y" />
          </div>
          <div className="md:col-span-3">
            <Button onClick={run} disabled={loading || !brand.trim() || !prompts.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Analyze LLM gaps
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Citation & answer gaps ({gaps.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {gaps.map((g, i) => (
            <div key={i} className="rounded-md border p-3 space-y-1">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="font-medium">{g.prompt}</span>
                <Badge
                  className={
                    g.gap_severity === 'high' ? 'bg-rose-600' : g.gap_severity === 'medium' ? 'bg-amber-600' : 'bg-slate-500'
                  }
                >
                  {g.gap_severity}
                </Badge>
                <Badge variant="outline">{g.brand_mentioned ? 'Cited' : 'Missing'}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Cited: {(g.cited || []).map((c) => c.brand || c.domain).filter(Boolean).join(', ') || '—'}
              </div>
              {(g.content_fixes || []).length > 0 && (
                <div className="text-sm">{g.content_fixes[0]}</div>
              )}
            </div>
          ))}
          {gaps.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">Run analysis to surface AI citation gaps.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
