"use client";

// T116 Real-Time News — live news search + topic feeds + saved articles
// Powered by Real-Time News Data API on RapidAPI (real-time-news-data.p.rapidapi.com)
// Requires RAPIDAPI_KEY via Manage → 🔑 Platform APIs.

import { useState, useEffect, useCallback } from "react";

const TOPICS = [
  { id: "BUSINESS",     label: "Business",     emoji: "💼" },
  { id: "TECHNOLOGY",   label: "Technology",   emoji: "💻" },
  { id: "WORLD",        label: "World",        emoji: "🌍" },
  { id: "SCIENCE",      label: "Science",      emoji: "🔬" },
  { id: "HEALTH",       label: "Health",       emoji: "🏥" },
  { id: "ENTERTAINMENT",label: "Entertainment",emoji: "🎬" },
];

const COUNTRIES = [
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "ZA", label: "South Africa" },
  { code: "NG", label: "Nigeria" },
  { code: "KE", label: "Kenya" },
  { code: "IN", label: "India" },
  { code: "CA", label: "Canada" },
];

interface Article {
  title: string;
  snippet: string;
  url: string;
  source: string;
  image?: string | null;
  published: string;
  query?: string;
  topic?: string;
  id?: number;
  saved_at?: string;
  sentiment?: string;
  article_url?: string;
}

function fmtDate(s: string) {
  if (!s) return "";
  try {
    return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return s; }
}

function timeSince(s: string) {
  if (!s) return "";
  const diff = Date.now() - new Date(s).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SentimentBadge({ s }: { s: string }) {
  const map: Record<string, { label: string; color: string }> = {
    positive: { label: "Positive", color: "#16a34a" },
    negative: { label: "Negative", color: "#dc2626" },
    neutral:  { label: "Neutral",  color: "#64748b" },
  };
  const v = map[s] || map.neutral;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: v.color,
      background: v.color + "18", borderRadius: 4, padding: "2px 7px" }}>
      {v.label}
    </span>
  );
}

function ArticleCard({
  article,
  onSave,
  onUnsave,
  isSaved,
  savedId,
}: {
  article: Article;
  onSave?: (a: Article) => void;
  onUnsave?: (id: number) => void;
  isSaved?: boolean;
  savedId?: number;
}) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12,
      padding: 16, display: "flex", gap: 14, alignItems: "flex-start",
      transition: "box-shadow .15s",
    }}>
      {article.image && (
        <img
          src={article.image}
          alt=""
          style={{ width: 80, height: 56, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", textDecoration: "none",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {article.title}
        </a>
        {article.snippet && (
          <p style={{ fontSize: 12, color: "#64748b", marginTop: 4, lineHeight: 1.6,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {article.snippet}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#0f766e",
            background: "#ede9fe", borderRadius: 4, padding: "2px 7px" }}>
            {article.source}
          </span>
          {article.published && (
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{timeSince(article.published)}</span>
          )}
          {article.sentiment && article.sentiment !== "neutral" && (
            <SentimentBadge s={article.sentiment} />
          )}
        </div>
      </div>
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <a href={article.url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600, textDecoration: "none",
            whiteSpace: "nowrap" }}>
          Read →
        </a>
        {onSave && !isSaved && (
          <button onClick={() => onSave(article)}
            style={{ fontSize: 11, color: "#0f766e", background: "none", border: "none",
              cursor: "pointer", fontWeight: 600, padding: 0, whiteSpace: "nowrap" }}>
            🔖 Save
          </button>
        )}
        {onUnsave && isSaved && savedId !== undefined && (
          <button onClick={() => onUnsave(savedId)}
            style={{ fontSize: 11, color: "#dc2626", background: "none", border: "none",
              cursor: "pointer", fontWeight: 600, padding: 0, whiteSpace: "nowrap" }}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export default function RealtimeNews() {
  const [tab, setTab] = useState<"search" | "topics" | "saved">("search");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("US");
  const [activeTopic, setActiveTopic] = useState("BUSINESS");
  const [searchResults, setSearchResults] = useState<Article[]>([]);
  const [topicResults, setTopicResults] = useState<Article[]>([]);
  const [savedArticles, setSavedArticles] = useState<Article[]>([]);
  const [history, setHistory] = useState<{ query: string; result_count: number; searched_at: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/realtime-news/status")
      .then(r => r.json())
      .then(d => setConfigured(d.configured))
      .catch(() => setConfigured(false));
    loadSaved();
    loadHistory();
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const r = await fetch("/api/realtime-news/saved");
      const d = await r.json();
      if (Array.isArray(d.articles)) setSavedArticles(d.articles);
    } catch {}
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/realtime-news/history");
      const d = await r.json();
      if (Array.isArray(d.history)) setHistory(d.history);
    } catch {}
  }, []);

  const doSearch = useCallback(async (q?: string) => {
    const searchQ = (q || query).trim();
    if (!searchQ) return;
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/realtime-news/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQ, country, limit: 12 }),
      });
      const d = await r.json();
      if (d.error) { setErr(d.message || d.error); return; }
      setSearchResults(d.articles || []);
      loadHistory();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [query, country, loadHistory]);

  const doLoadTopic = useCallback(async (t?: string) => {
    const topic = t || activeTopic;
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/realtime-news/topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, country, limit: 12 }),
      });
      const d = await r.json();
      if (d.error) { setErr(d.error); return; }
      setTopicResults(d.articles || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [activeTopic, country]);

  useEffect(() => {
    if (tab === "topics" && topicResults.length === 0) doLoadTopic();
  }, [tab]);

  const saveArticle = useCallback(async (a: Article) => {
    await fetch("/api/realtime-news/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        article_url: a.url, title: a.title, snippet: a.snippet,
        source_name: a.source, published_at: a.published,
        search_query: a.query || "", topic: a.topic || "",
      }),
    });
    loadSaved();
  }, [loadSaved]);

  const unsaveArticle = useCallback(async (id: number) => {
    await fetch(`/api/realtime-news/saved/${id}`, { method: "DELETE" });
    setSavedArticles(prev => prev.filter(a => a.id !== id));
  }, []);

  const savedUrls = new Set(savedArticles.map(a => a.article_url));

  // ── Not configured ────────────────────────────────────────────────────────
  if (configured === false) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16,
          padding: 40, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📰</div>
          <h2 style={{ fontWeight: 800, fontSize: 20, color: "#0f172a", marginBottom: 8 }}>
            Real-Time News Data
          </h2>
          <p style={{ color: "#64748b", lineHeight: 1.7, marginBottom: 24 }}>
            Your <strong>RAPIDAPI_KEY</strong> is configured but doesn&apos;t appear to be subscribed
            to the <em>Real-Time News Data</em> API yet.
          </p>
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: 20,
            textAlign: "left", marginBottom: 24 }}>
            <p style={{ fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>To activate:</p>
            <ol style={{ paddingLeft: 20, color: "#475569", fontSize: 13, lineHeight: 2 }}>
              <li>Go to <strong>rapidapi.com</strong> and search <strong>&quot;Real-Time News Data&quot;</strong></li>
              <li>Find the API by <em>letscrape-6bRBa3QguO5</em> (free tier available)</li>
              <li>Click <strong>Subscribe to Test</strong> on the free plan</li>
              <li>Use the same API key already set in your environment</li>
            </ol>
          </div>
          <button onClick={() => window.open("https://rapidapi.com/letscrape-6bRBa3QguO5/api/real-time-news-data", "_blank")}
            style={{ background: "#0f766e", color: "#fff", border: "none", borderRadius: 8,
              padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            Open RapidAPI →
          </button>
        </div>
      </div>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "24px 28px", fontFamily: "Inter, sans-serif", maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 40 }}>📰</div>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: 22, color: "#0f172a", margin: 0 }}>
            Real-Time News
          </h1>
          <p style={{ color: "#64748b", fontSize: 14, margin: "4px 0 0" }}>
            Live news search, topic feeds, and saved article library — powered by RapidAPI
          </p>
        </div>
        {/* Country picker */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Country</label>
          <select value={country} onChange={e => setCountry(e.target.value)}
            style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px",
              fontSize: 13, color: "#0f172a", background: "#fff" }}>
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24,
        borderBottom: "2px solid #f1f5f9", paddingBottom: 0 }}>
        {(["search", "topics", "saved"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              background: "none", border: "none", padding: "10px 20px",
              fontWeight: 700, fontSize: 14, cursor: "pointer",
              color: tab === t ? "#0f766e" : "#64748b",
              borderBottom: tab === t ? "2px solid #0f766e" : "2px solid transparent",
              marginBottom: -2,
            }}>
            {t === "search" ? "🔍 Search" : t === "topics" ? "📂 Topic Feeds" : `🔖 Saved (${savedArticles.length})`}
          </button>
        ))}
      </div>

      {err && (
        <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 8,
          padding: "10px 16px", fontSize: 13, marginBottom: 16 }}>
          ⚠️ {err}
        </div>
      )}

      {/* ── SEARCH TAB ── */}
      {tab === "search" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()}
              placeholder="Search for brands, topics, competitors… e.g. 'OpenAI product launch'"
              style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px",
                fontSize: 14, color: "#0f172a", outline: "none" }}
            />
            <button onClick={() => doSearch()}
              disabled={loading || !query.trim()}
              style={{ background: loading ? "#a78bfa" : "#0f766e", color: "#fff", border: "none",
                borderRadius: 10, padding: "12px 24px", fontWeight: 700, fontSize: 14,
                cursor: loading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
              {loading ? "Searching…" : "Search"}
            </button>
          </div>

          {/* Recent history */}
          {history.length > 0 && searchResults.length === 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700, marginBottom: 8 }}>
                RECENT SEARCHES
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {history.slice(0, 8).map((h, i) => (
                  <button key={i} onClick={() => { setQuery(h.query); doSearch(h.query); }}
                    style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 20,
                      padding: "4px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
                      fontWeight: 600 }}>
                    {h.query}
                    <span style={{ color: "#94a3b8", marginLeft: 4 }}>({h.result_count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {searchResults.length > 0 && (
            <div>
              <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700, marginBottom: 12 }}>
                {searchResults.length} RESULTS FOR &quot;{query}&quot;
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {searchResults.map((a, i) => (
                  <ArticleCard
                    key={i}
                    article={a}
                    onSave={saveArticle}
                    isSaved={savedUrls.has(a.url)}
                    savedId={savedArticles.find(s => s.article_url === a.url)?.id}
                    onUnsave={unsaveArticle}
                  />
                ))}
              </div>
            </div>
          )}

          {searchResults.length === 0 && !loading && !err && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
              <p style={{ fontWeight: 600, fontSize: 15 }}>Search live news</p>
              <p style={{ fontSize: 13 }}>Try your brand name, a competitor, or any industry topic</p>
            </div>
          )}
        </div>
      )}

      {/* ── TOPICS TAB ── */}
      {tab === "topics" && (
        <div>
          {/* Topic pills */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {TOPICS.map(t => (
              <button key={t.id}
                onClick={() => { setActiveTopic(t.id); doLoadTopic(t.id); }}
                style={{
                  background: activeTopic === t.id ? "#0f766e" : "#f8fafc",
                  color: activeTopic === t.id ? "#fff" : "#475569",
                  border: activeTopic === t.id ? "none" : "1px solid #e2e8f0",
                  borderRadius: 20, padding: "8px 16px", fontSize: 13, fontWeight: 700,
                  cursor: "pointer",
                }}>
                {t.emoji} {t.label}
              </button>
            ))}
            <button onClick={() => doLoadTopic()}
              style={{ background: "#f1f5f9", color: "#0f766e", border: "1px solid #ddd6fe",
                borderRadius: 20, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              ↻ Refresh
            </button>
          </div>

          {loading && (
            <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
              Loading {activeTopic.toLowerCase()} news…
            </div>
          )}

          {!loading && topicResults.length > 0 && (
            <div>
              <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700, marginBottom: 12 }}>
                {topicResults.length} ARTICLES — {TOPICS.find(t => t.id === activeTopic)?.emoji}{" "}
                {TOPICS.find(t => t.id === activeTopic)?.label}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {topicResults.map((a, i) => (
                  <ArticleCard
                    key={i}
                    article={a}
                    onSave={saveArticle}
                    isSaved={savedUrls.has(a.url)}
                    savedId={savedArticles.find(s => s.article_url === a.url)?.id}
                    onUnsave={unsaveArticle}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SAVED TAB ── */}
      {tab === "saved" && (
        <div>
          {savedArticles.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔖</div>
              <p style={{ fontWeight: 600, fontSize: 15 }}>No saved articles yet</p>
              <p style={{ fontSize: 13 }}>Hit the &ldquo;Save&rdquo; button on any article to bookmark it here</p>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700, marginBottom: 12 }}>
                {savedArticles.length} SAVED ARTICLES
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {savedArticles.map((a) => (
                  <ArticleCard
                    key={a.id}
                    article={{ ...a, url: a.article_url || a.url || "#" }}
                    isSaved={true}
                    savedId={a.id}
                    onUnsave={unsaveArticle}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
