"use client";

// Native React port of the legacy `ad-swipe` panel (was
// `window.buildAdSwipe` + `#view-ad-swipe` in ig_manage_pack.js). A swipe file
// of saved competitor ads, with AI tag suggestions, scoring and notes, backed
// by the existing Express API (`GET /api/ad-swipe/list`, `/advertisers`,
// `/tags`, `POST /api/ad-swipe/suggest-tags`, `/:id/update`,
// `DELETE /api/ad-swipe/:id`) through `lib/api`. See
// `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

interface SwipeItem {
  id: number;
  advertiser: string;
  source: string;
  headline?: string;
  body?: string;
  score?: number;
  tags?: string[];
  notes?: string;
  snapshot_url?: string;
  saved_at?: string;
}
interface ListResponse {
  ok?: boolean;
  items?: SwipeItem[];
}
interface AdvertisersResponse {
  ok?: boolean;
  advertisers?: { advertiser: string }[];
}
interface TagsResponse {
  ok?: boolean;
  tags?: string[];
}
interface Suggestion {
  tag: string;
  why?: string;
}
interface SuggestResponse {
  ok?: boolean;
  error?: string;
  suggestions?: Suggestion[];
  note?: string;
  source?: string;
}
interface AnalysisCompetitor {
  name?: string;
  domain?: string;
  url?: string;
  website?: string;
}
interface AnalysisData {
  brandName?: string;
  companyName?: string;
  url?: string;
  domain?: string;
  competitors?: AnalysisCompetitor[];
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}
function norm(u?: string): string {
  return String(u || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}
function domToBrand(d?: string): string {
  const c = (d || "").split(".")[0];
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : "";
}

export default function AdSwipe() {
  const [tag, setTag] = useState("");
  const [adv, setAdv] = useState("");
  const [advPick, setAdvPick] = useState("");
  const [items, setItems] = useState<SwipeItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedAdvertisers, setSavedAdvertisers] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestState, setSuggestState] = useState<
    { loading: boolean; data: SuggestResponse | null; error: string }
  >({ loading: false, data: null, error: "" });

  const { own, comps } = useMemo(() => {
    const ad = getAnalysisData();
    const ownN =
      ad.brandName || ad.companyName || domToBrand(norm(ad.url || ad.domain));
    const compN = (Array.isArray(ad.competitors) ? ad.competitors : [])
      .map((c) => c.name || domToBrand(norm(c.domain || c.url || c.website)))
      .filter(Boolean) as string[];
    return { own: ownN, comps: compN };
  }, []);

  async function load(t = tag, a = adv) {
    setLoading(true);
    const qs = new URLSearchParams();
    if (t.trim()) qs.set("tag", t.trim());
    if (a.trim()) qs.set("advertiser", a.trim());
    const r = await apiGet<ListResponse>("/api/ad-swipe/list?" + qs.toString());
    setItems(r.items || []);
    setLoading(false);
  }

  useEffect(() => {
    void load("", "");
    void (async () => {
      const a = await apiGet<AdvertisersResponse>("/api/ad-swipe/advertisers");
      setSavedAdvertisers(
        (a.advertisers || []).map((x) => x.advertiser).filter(Boolean),
      );
      const t = await apiGet<TagsResponse>("/api/ad-swipe/tags");
      setAllTags(t.tags || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inSwipeOnly = savedAdvertisers.filter(
    (s) => s !== own && !comps.includes(s),
  );
  const datalistAdv = Array.from(
    new Set([own, ...comps, ...savedAdvertisers].filter(Boolean)),
  );

  function clearFilters() {
    setTag("");
    setAdv("");
    setAdvPick("");
    setSuggestOpen(false);
    void load("", "");
  }

  async function suggestTags() {
    setSuggestOpen(true);
    setSuggestState({ loading: true, data: null, error: "" });
    const ad = getAnalysisData();
    const brand = ad.brandName || "";
    const competitors = (Array.isArray(ad.competitors) ? ad.competitors : [])
      .map((c) => c.name || c.domain)
      .filter(Boolean)
      .slice(0, 8);
    const r = await apiPost<SuggestResponse>("/api/ad-swipe/suggest-tags", {
      brand,
      competitors,
    });
    if (!r.ok && (!r.suggestions || !r.suggestions.length)) {
      setSuggestState({
        loading: false,
        data: null,
        error: r.error || "AI suggest failed",
      });
      return;
    }
    setSuggestState({ loading: false, data: r, error: "" });
  }

  function applyTag(t: string) {
    setTag(t);
    void load(t, adv);
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Ad Swipe File
              </div>
              <h2 className="view-title">💾 Ad Swipe File</h2>
              <p className="view-sub">
                Your saved library of winning competitor ads — score them, tag
                them, and note what makes each one work.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 14,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "end",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 3,
                }}
              >
                FILTER BY ADVERTISER
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <select
                  value={advPick}
                  onChange={(e) => {
                    setAdvPick(e.target.value);
                    if (e.target.value) setAdv(e.target.value);
                  }}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid #D1D5DB",
                    borderRadius: 6,
                    fontSize: "0.82rem",
                    minWidth: 170,
                    background: "#fff",
                  }}
                >
                  <option value="">— pick from your brands —</option>
                  {own && <option value={own}>🏠 Your brand — {own}</option>}
                  {comps.length > 0 && (
                    <optgroup label="Your analysed competitors">
                      {comps.map((n, i) => (
                        <option key={i} value={n}>
                          {n}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {inSwipeOnly.length > 0 && (
                    <optgroup label="Already in your swipe file">
                      {inSwipeOnly.map((n, i) => (
                        <option key={i} value={n}>
                          {n}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <input
                  list="asAdvList"
                  value={adv}
                  onChange={(e) => setAdv(e.target.value)}
                  placeholder="any (or type)"
                  style={{
                    flex: 1,
                    minWidth: 120,
                    padding: "8px 10px",
                    border: "1px solid #D1D5DB",
                    borderRadius: 6,
                    fontSize: "0.85rem",
                    boxSizing: "border-box",
                  }}
                />
                <datalist id="asAdvList">
                  {datalistAdv.map((n, i) => (
                    <option key={i} value={n} />
                  ))}
                </datalist>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 3,
                }}
              >
                <span>FILTER BY TAG</span>
                <button
                  type="button"
                  onClick={suggestTags}
                  style={{
                    background: "linear-gradient(135deg,#0f766e,#0066FF)",
                    color: "#fff",
                    border: 0,
                    padding: "3px 10px",
                    borderRadius: 12,
                    fontSize: "0.68rem",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  🤖 AI Suggest
                </button>
              </label>
              <input
                list="asTagList"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="any (or type)"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 6,
                  fontSize: "0.85rem",
                  boxSizing: "border-box",
                }}
              />
              <datalist id="asTagList">
                {allTags.map((t, i) => (
                  <option key={i} value={t} />
                ))}
              </datalist>
            </div>
            <button
              onClick={() => load()}
              disabled={loading}
              style={{
                background: "#0066FF",
                color: "#fff",
                border: 0,
                padding: "9px 18px",
                borderRadius: 6,
                fontWeight: 800,
                cursor: "pointer",
                fontSize: "0.84rem",
              }}
            >
              {loading ? "⏳ …" : "🔍 Filter"}
            </button>
            <button
              onClick={clearFilters}
              style={{
                background: "#F3F4F6",
                color: "#374151",
                border: "1px solid #D1D5DB",
                padding: "9px 14px",
                borderRadius: 6,
                fontWeight: 700,
                cursor: "pointer",
                fontSize: "0.82rem",
              }}
            >
              Clear
            </button>
          </div>
          {suggestOpen && (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                background: "#F5F3FF",
                border: "1px solid #DDD6FE",
                borderRadius: 8,
              }}
            >
              <TagSuggestions state={suggestState} onApply={applyTag} />
            </div>
          )}
        </div>

        <SwipeList
          items={items}
          isFiltered={!!(tag.trim() || adv.trim())}
          filters={{ tag: tag.trim(), adv: adv.trim() }}
          onClear={clearFilters}
          onReload={() => load()}
        />
      </div>
    </div>
  );
}

function TagSuggestions({
  state,
  onApply,
}: {
  state: { loading: boolean; data: SuggestResponse | null; error: string };
  onApply: (t: string) => void;
}) {
  if (state.loading)
    return (
      <div
        style={{ color: "#6B21A8", fontSize: "0.82rem", fontWeight: 700 }}
      >
        Reading your saved ads and proposing useful filter tags…
      </div>
    );
  if (state.error)
    return (
      <div style={{ color: "#991B1B", fontSize: "0.82rem" }}>{state.error}</div>
    );
  const sugs = state.data?.suggestions || [];
  if (!sugs.length)
    return (
      <div style={{ color: "#6B21A8", fontSize: "0.82rem" }}>
        No tag suggestions returned — try saving a few more ads first.
      </div>
    );
  return (
    <div>
      <div
        style={{
          fontSize: "0.74rem",
          fontWeight: 800,
          color: "#6B21A8",
          marginBottom: 8,
        }}
      >
        🤖 Click a tag to filter
        {state.data?.source === "saved_ads"
          ? " — InfoGenie grouped your saved ads by these angles"
          : " (starter tags — save ads for tailored ones)"}
        :
      </div>
      {state.data?.note && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "#0f766e",
            marginBottom: 6,
            fontStyle: "italic",
          }}
        >
          {state.data.note}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sugs.map((s, i) => (
          <button
            key={i}
            type="button"
            title={s.why || ""}
            onClick={() => onApply(s.tag)}
            style={{
              background: "#fff",
              border: "1px solid #C4B5FD",
              color: "#5B21B6",
              padding: "5px 12px",
              borderRadius: 14,
              fontSize: "0.78rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {s.tag}
          </button>
        ))}
      </div>
    </div>
  );
}

function SwipeList({
  items,
  isFiltered,
  filters,
  onClear,
  onReload,
}: {
  items: SwipeItem[] | null;
  isFiltered: boolean;
  filters: { tag: string; adv: string };
  onClear: () => void;
  onReload: () => void;
}) {
  if (items === null)
    return <div style={{ color: "#9CA3AF" }}>Loading swipe file…</div>;
  if (!items.length) {
    if (isFiltered) {
      const parts: string[] = [];
      if (filters.adv) parts.push(`advertiser "${filters.adv}"`);
      if (filters.tag) parts.push(`tag "${filters.tag}"`);
      return (
        <div
          style={{
            background: "#F9FAFB",
            border: "1px dashed #D1D5DB",
            borderRadius: 10,
            padding: 32,
            textAlign: "center",
            color: "#6B7280",
          }}
        >
          <div style={{ fontSize: "1.4rem", marginBottom: 10 }}>🔍</div>
          <div
            style={{ fontWeight: 700, color: "#374151", marginBottom: 6 }}
          >
            No saved ads match {parts.join(" and ")}
          </div>
          <div style={{ fontSize: "0.82rem" }}>
            Try clearing the filters, or go to{" "}
            <strong>Compete → Ad Library Spy</strong> to search and save ads for
            this advertiser.
          </div>
          <button
            onClick={onClear}
            style={{
              marginTop: 14,
              background: "#0066FF",
              color: "#fff",
              border: 0,
              padding: "8px 20px",
              borderRadius: 6,
              fontWeight: 700,
              cursor: "pointer",
              fontSize: "0.82rem",
            }}
          >
            Clear Filters
          </button>
        </div>
      );
    }
    return (
      <div
        style={{
          background: "#F9FAFB",
          border: "1px dashed #D1D5DB",
          borderRadius: 10,
          padding: 32,
          textAlign: "center",
          color: "#6B7280",
        }}
      >
        Your swipe file is empty. Open{" "}
        <strong>Compete → Ad Library Spy</strong>, search a competitor, and click{" "}
        <strong>💾 Save to Swipe File</strong> on any winning ad.
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
        gap: 14,
      }}
    >
      {items.map((it) => (
        <SwipeCard key={it.id} item={it} onDeleted={onReload} />
      ))}
    </div>
  );
}

function SwipeCard({
  item,
  onDeleted,
}: {
  item: SwipeItem;
  onDeleted: () => void;
}) {
  const [tags, setTags] = useState((item.tags || []).join(", "));
  const [notes, setNotes] = useState(item.notes || "");
  const [score, setScore] = useState(item.score || 0);
  const [saveLabel, setSaveLabel] = useState("💾 Save");

  async function save() {
    const r = await apiPost<{ ok: boolean; error?: string }>(
      "/api/ad-swipe/" + item.id + "/update",
      {
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        notes,
        score: parseInt(String(score), 10) || 0,
      },
    );
    if (r.ok) {
      setSaveLabel("✅ Saved");
      setTimeout(() => setSaveLabel("💾 Save"), 1500);
    } else {
      setSaveLabel("⚠ " + (r.error || "fail"));
    }
  }

  async function del() {
    if (!confirm("Delete this saved ad?")) return;
    const r = await apiDelete<{ ok: boolean; error?: string }>(
      "/api/ad-swipe/" + item.id,
    );
    if (r.ok === false && r.error) {
      showToast("❌ " + r.error);
      return;
    }
    onDeleted();
  }

  const validUrl =
    item.snapshot_url && /^https?:\/\//i.test(item.snapshot_url);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          gap: 8,
        }}
      >
        <div
          style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.92rem" }}
        >
          {item.advertiser}
        </div>
        <div
          style={{
            background: "#FEF3C7",
            color: "#92400E",
            padding: "2px 8px",
            borderRadius: 10,
            fontSize: "0.7rem",
            fontWeight: 800,
          }}
        >
          {(item.source || "").toUpperCase()}
        </div>
      </div>
      {item.headline && (
        <div
          style={{ fontWeight: 700, color: "#1E1B4B", fontSize: "0.86rem" }}
        >
          {item.headline}
        </div>
      )}
      {item.body && (
        <div
          style={{
            color: "#374151",
            fontSize: "0.8rem",
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            maxHeight: 120,
            overflowY: "auto",
          }}
        >
          {item.body.slice(0, 400)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label
          style={{ fontSize: "0.7rem", color: "#6B7280", fontWeight: 700 }}
        >
          SCORE
        </label>
        <input
          type="number"
          min={0}
          max={10}
          value={score}
          onChange={(e) => setScore(parseInt(e.target.value, 10) || 0)}
          style={{
            width: 60,
            padding: "4px 6px",
            border: "1px solid #D1D5DB",
            borderRadius: 5,
            fontSize: "0.82rem",
          }}
        />
        <span style={{ fontSize: "0.68rem", color: "#9CA3AF" }}>/10</span>
      </div>
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="tags (comma-separated)"
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "1px solid #D1D5DB",
          borderRadius: 5,
          fontSize: "0.78rem",
          boxSizing: "border-box",
        }}
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="What makes this work?"
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "1px solid #D1D5DB",
          borderRadius: 5,
          fontSize: "0.78rem",
          fontFamily: "inherit",
          boxSizing: "border-box",
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button
          onClick={save}
          style={{
            flex: 1,
            background: "#0066FF",
            color: "#fff",
            border: 0,
            padding: 7,
            borderRadius: 6,
            fontSize: "0.74rem",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {saveLabel}
        </button>
        {validUrl && (
          <a
            href={item.snapshot_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: "#F3F4F6",
              color: "#374151",
              padding: "7px 10px",
              borderRadius: 6,
              fontSize: "0.74rem",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            View →
          </a>
        )}
        <button
          onClick={del}
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            color: "#991B1B",
            padding: "7px 10px",
            borderRadius: 6,
            fontSize: "0.74rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          🗑
        </button>
      </div>
      <div style={{ fontSize: "0.66rem", color: "#9CA3AF" }}>
        Saved{" "}
        {item.saved_at ? new Date(item.saved_at).toLocaleDateString() : ""}
      </div>
    </div>
  );
}
