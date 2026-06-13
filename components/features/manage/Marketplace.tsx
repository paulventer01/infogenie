"use client";

// Native React port of the legacy `marketplace` panel (was
// `window.buildMarketplace` in public/js/ig_advanced_features.js +
// `#view-marketplace`). Browses, publishes, downloads and deletes marketplace
// listings against the existing Express API (`GET /api/marketplace/listings`,
// `GET /api/marketplace/stats`, `POST /api/marketplace/listings`,
// `POST /api/marketplace/listings/:id/download`, `DELETE /api/marketplace/listings/:id`).

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Listing {
  id: number;
  category?: string;
  title: string;
  description?: string;
  tags?: string[];
  downloads?: number;
  is_mine?: boolean;
}
interface ListResult {
  ok: boolean;
  listings?: Listing[];
}
interface StatsResult {
  ok: boolean;
  total_listings?: number;
  my_listings?: number;
  my_total_downloads?: number;
}
interface DownloadResult {
  ok: boolean;
  listing?: { content?: unknown };
}

const CATEGORIES = [
  "template",
  "campaign",
  "audience",
  "prompt_pack",
  "landing_page",
  "email_sequence",
  "ai_agent",
  "creative",
];
const CAT_ICONS: Record<string, string> = {
  template: "📄",
  campaign: "📣",
  audience: "🎯",
  prompt_pack: "💬",
  landing_page: "🚀",
  email_sequence: "📧",
  ai_agent: "🤖",
  creative: "🎨",
};

export default function Marketplace() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [stats, setStats] = useState<StatsResult | null>(null);

  const [showPublish, setShowPublish] = useState(false);
  const [pubTitle, setPubTitle] = useState("");
  const [pubCat, setPubCat] = useState(CATEGORIES[0]);
  const [pubDesc, setPubDesc] = useState("");
  const [pubTags, setPubTags] = useState("");
  const [pubContent, setPubContent] = useState("");

  async function loadListings() {
    const d = await apiGet<ListResult>(
      `/api/marketplace/listings?category=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}`,
    );
    const s = await apiGet<StatsResult>("/api/marketplace/stats");
    if (s.ok) setStats(s);
    if (d.ok) setListings(d.listings || []);
  }

  useEffect(() => {
    loadListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function publish() {
    const title = pubTitle.trim();
    if (!title) {
      alert("Title required.");
      return;
    }
    let content: unknown = {};
    try {
      content = JSON.parse(pubContent || "{}");
    } catch {
      content = { text: pubContent || "" };
    }
    const tags = pubTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const d = await apiPost<{ ok: boolean; error?: string }>("/api/marketplace/listings", {
      title,
      description: pubDesc,
      category: pubCat,
      tags,
      content,
    });
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setShowPublish(false);
    loadListings();
  }

  async function download(id: number, title: string) {
    const d = await apiPost<DownloadResult>(`/api/marketplace/listings/${id}/download`);
    if (!d.ok) {
      alert("Could not get listing.");
      return;
    }
    const content = d.listing?.content ?? {};
    const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (title || "listing").replace(/[^a-z0-9]/gi, "_") + ".txt";
    a.click();
    URL.revokeObjectURL(url);
    loadListings();
  }

  async function remove(id: number) {
    if (!confirm("Delete this listing?")) return;
    await apiDelete(`/api/marketplace/listings/${id}`);
    loadListings();
  }

  return (
    <div>
      <div className="view-header">
        <h2>🛍️ AI Marketing Marketplace</h2>
        <p className="view-sub">
          Browse, download, and publish marketing templates, campaigns, audiences, prompt packs,
          and AI agents.
        </p>
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
          alignItems: "center",
        }}
      >
        <input
          className="form-control"
          style={{ maxWidth: 260 }}
          placeholder="Search listings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="form-control"
          style={{ maxWidth: 180 }}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button className="btn btn-outline" onClick={loadListings}>
          🔍 Search
        </button>
        <button className="btn btn-primary" onClick={() => setShowPublish((v) => !v)}>
          + Publish Listing
        </button>
        <div style={{ marginLeft: "auto", fontSize: ".85rem", color: "#6b7280" }}>
          {stats?.ok
            ? `${stats.total_listings} listings · ${stats.my_listings} mine · ${stats.my_total_downloads} downloads`
            : ""}
        </div>
      </div>

      {showPublish && (
        <div style={{ marginBottom: 16 }}>
          <div className="ig-card">
            <h4 style={{ fontWeight: 600, marginBottom: 12 }}>Publish a New Listing</h4>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="form-group">
                <label>Title</label>
                <input
                  className="form-control"
                  placeholder="My Email Sequence Template"
                  value={pubTitle}
                  onChange={(e) => setPubTitle(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select
                  className="form-control"
                  value={pubCat}
                  onChange={(e) => setPubCat(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: "1/-1" }}>
                <label>Description</label>
                <textarea
                  className="form-control"
                  rows={2}
                  placeholder="What this is and how to use it"
                  value={pubDesc}
                  onChange={(e) => setPubDesc(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ gridColumn: "1/-1" }}>
                <label>Tags (comma-separated)</label>
                <input
                  className="form-control"
                  placeholder="email, cold outreach, B2B"
                  value={pubTags}
                  onChange={(e) => setPubTags(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ gridColumn: "1/-1" }}>
                <label>Content (JSON or plain text)</label>
                <textarea
                  className="form-control"
                  rows={4}
                  placeholder='{"subject":"...","body":"..."}'
                  value={pubContent}
                  onChange={(e) => setPubContent(e.target.value)}
                />
              </div>
            </div>
            <button className="btn btn-primary" onClick={publish}>
              Publish to Marketplace
            </button>
          </div>
        </div>
      )}

      <div>
        {listings && listings.length === 0 && (
          <div
            className="ig-card"
            style={{ padding: 32, textAlign: "center", color: "#6b7280" }}
          >
            No listings yet — be the first to publish something!
          </div>
        )}
        {listings && listings.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
              gap: 16,
            }}
          >
            {listings.map((l) => (
              <div key={l.id} className="ig-card" style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 6,
                  }}
                >
                  <div style={{ fontSize: "1.4rem" }}>{CAT_ICONS[l.category || ""] || "📦"}</div>
                  <span
                    style={{
                      background: "#f3f4f6",
                      borderRadius: 4,
                      padding: "2px 8px",
                      fontSize: ".75rem",
                      color: "#374151",
                    }}
                  >
                    {(l.category || "").replace("_", " ")}
                  </span>
                </div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{l.title}</div>
                <div style={{ fontSize: ".85rem", color: "#6b7280", flex: 1, marginBottom: 10 }}>
                  {l.description || ""}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {(l.tags || []).map((t, i) => (
                    <span
                      key={i}
                      style={{
                        background: "#eff6ff",
                        color: "#3b82f6",
                        borderRadius: 4,
                        padding: "2px 6px",
                        fontSize: ".7rem",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: ".8rem", color: "#6b7280" }}>
                    ⬇️ {l.downloads || 0} downloads
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => download(l.id, l.title)}
                    >
                      Get
                    </button>
                    {l.is_mine && (
                      <button className="btn btn-sm btn-outline" onClick={() => remove(l.id)}>
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
