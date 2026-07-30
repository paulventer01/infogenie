"use client";

// Native React port of the legacy `advertise` panel (was `buildAdvertise` +
// the `openNewCampaignPicker` / `openChannelCampaign` / `generateChannelAd` /
// `confirmChannelLaunch` helpers + `#view-advertise` in index.html). The
// Multi-Channel Advertising Hub: connect ad platforms (state persisted in
// localStorage `ig_adv_conn`, same key the legacy used), launch per-channel
// 3-step lead-gen campaigns, and review launched campaigns. Generates AI ad
// copy against the existing Express API (`POST /api/ai-channel-ad`) via lib/api.
// Launched campaigns mirror the legacy in-memory `window._launchedCampaigns`.
//
// See docs/react-panel-migration.md for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiPost } from "@/lib/api";

interface Platform {
  name: string;
  icon: string;
  color: string;
  bg: string;
  cat: string;
  formats: string[];
}

const ADV_PLATFORMS: Platform[] = [
  { name: "Meta", icon: "📘", color: "#1877F2", bg: "#EBF3FF", cat: "meta", formats: ["Image Ad", "Video Ad", "Carousel", "Story Ad", "Lead Gen Form"] },
  { name: "Instagram", icon: "📸", color: "#E1306C", bg: "#FFF0F5", cat: "meta", formats: ["Image Post", "Reels Ad", "Story Ad", "Carousel", "Shopping Ad"] },
  { name: "Messenger & WhatsApp", icon: "💬", color: "#00B2FF", bg: "#E0F7FF", cat: "meta", formats: ["Sponsored Message", "Click-to-Messenger", "WhatsApp Click-to-Chat"] },
  { name: "Meta Calls", icon: "📞", color: "#1877F2", bg: "#EBF3FF", cat: "meta", formats: ["Click-to-Call Ad", "Call-Only Ad"] },
  { name: "Catalog Ads", icon: "🛍️", color: "#1877F2", bg: "#EBF3FF", cat: "meta", formats: ["Dynamic Product Ad", "Collection Ad", "Catalogue Carousel"] },
  { name: "Meta Boost", icon: "⚡", color: "#1877F2", bg: "#EBF3FF", cat: "meta", formats: ["Boosted Post", "Boosted Reel", "Boosted Story"] },
  { name: "Google Search", icon: "🔍", color: "#4285F4", bg: "#EFF6FF", cat: "google", formats: ["Responsive Search Ad", "Dynamic Search Ad", "Call Ad"] },
  { name: "Google Pmax", icon: "🎯", color: "#0F9D58", bg: "#F0FDF4", cat: "google", formats: ["Performance Max Asset Group", "Smart Shopping", "Full-Funnel Pmax"] },
  { name: "YouTube", icon: "🎬", color: "#FF0000", bg: "#FFF5F5", cat: "google", formats: ["Skippable In-Stream", "Non-Skippable 15s", "Bumper 6s", "Video Discovery"] },
  { name: "Google Display", icon: "🖼️", color: "#4285F4", bg: "#EFF6FF", cat: "google", formats: ["Responsive Display Ad", "Smart Display Campaign", "Gmail Ad"] },
  { name: "Google Shopping", icon: "🛒", color: "#FBBC04", bg: "#FFFBEB", cat: "google", formats: ["Standard Shopping", "Smart Shopping", "Local Inventory Ad"] },
  { name: "Google Demand Gen", icon: "✨", color: "#A142F4", bg: "#F5F0FF", cat: "google", formats: ["Demand Gen Image", "Demand Gen Video", "Demand Gen Carousel"] },
  { name: "Google Calls", icon: "📱", color: "#34A853", bg: "#F0FDF4", cat: "google", formats: ["Call-Only Ad", "Call Extension Ad"] },
  { name: "LinkedIn", icon: "💼", color: "#0A66C2", bg: "#F0F7FF", cat: "social", formats: ["Sponsored Content", "Single Image Ad", "Video Ad", "Carousel Ad"] },
  { name: "LinkedIn Message", icon: "📨", color: "#0A66C2", bg: "#F0F7FF", cat: "social", formats: ["Message Ad", "Conversation Ad", "Lead Gen Form"] },
  { name: "TikTok", icon: "⬛", color: "#010101", bg: "#F5F5F5", cat: "social", formats: ["In-Feed Video Ad", "TopView Ad", "Spark Ad", "Branded Hashtag"] },
  { name: "Snapchat", icon: "👻", color: "#FFCC00", bg: "#FFFDE0", cat: "social", formats: ["Single Image/Video", "Story Ad", "Collection Ad"] },
  { name: "Pinterest", icon: "📌", color: "#E60023", bg: "#FFF0F0", cat: "social", formats: ["Promoted Pin", "Video Pin", "Shopping Pin", "Carousel"] },
  { name: "X (Twitter)", icon: "✖️", color: "#14171A", bg: "#F5F5F5", cat: "social", formats: ["Promoted Tweet", "Carousel Ad", "Video Ad"] },
  { name: "Threads", icon: "🧵", color: "#000000", bg: "#F5F5F5", cat: "social", formats: ["Promoted Post", "Story Ad"] },
  { name: "Bing", icon: "🔵", color: "#008272", bg: "#E0FFF9", cat: "search", formats: ["Responsive Search Ad", "Dynamic Search Ad", "Shopping Ad"] },
  { name: "Spotify", icon: "🎵", color: "#1DB954", bg: "#F0FFF4", cat: "other", formats: ["Audio Ad", "Video Ad", "Podcast Ad"] },
  { name: "Direct Mail", icon: "✉️", color: "#6B7280", bg: "#F9FAFB", cat: "other", formats: ["Postcard", "Letter", "Brochure"] },
  { name: "Local Services", icon: "📍", color: "#F59E0B", bg: "#FFFBEB", cat: "other", formats: ["Local Service Ad", "Google Screened Ad"] },
];

const DEFAULT_CONN: Record<string, boolean> = {
  Meta: true, Instagram: true, "Messenger & WhatsApp": true, "Meta Calls": true,
  "Catalog Ads": true, "Meta Boost": true, "Google Search": true, "Google Pmax": true,
  YouTube: true, "Google Display": true, "Google Calls": true, LinkedIn: true,
  "LinkedIn Message": true, TikTok: true, Bing: true, "Direct Mail": true,
  "Local Services": true, Snapchat: false, Spotify: false, Pinterest: false,
  "X (Twitter)": false, Threads: false,
};

const STORAGE_KEY = "ig_adv_conn";

const GOOGLE_NAMES = ["Google Search", "Google Pmax", "Google Display", "Google Shopping", "Google Demand Gen", "Google Calls", "YouTube"];
const META_NAMES = ["Meta", "Instagram", "Messenger & WhatsApp", "Meta Calls", "Catalog Ads", "Meta Boost"];

interface Metrics {
  roas: string;
  ctr: string;
  conversions: number;
  spend: number;
  cpa: string;
  impressions: number;
}
interface CampaignAction {
  time: string;
  action: string;
  type: string;
}
interface Campaign {
  id: string;
  name: string;
  platform: string;
  budget: number;
  budgetStr: string;
  startDate: string;
  endDate?: string;
  audience: string;
  launchedAt: string;
  status: string;
  daysRunning: number;
  creatives: Record<string, unknown>;
  metrics: Metrics;
  actions: CampaignAction[];
}

interface AdCopy {
  headline?: string;
  body?: string;
  cta?: string;
  hashtags?: string;
}
interface ChannelAdResult {
  ok?: boolean;
  ad?: AdCopy;
  error?: string;
}

interface AnalysisData {
  url?: string;
  audience?: string;
  industry?: { name?: string };
}

function getAnalysisData(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  const ad = (window as unknown as { analysisData?: AnalysisData }).analysisData;
  return ad || null;
}

function toast(msg: string) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { showToast?: (m: string) => void };
  if (typeof w.showToast === "function") w.showToast(msg);
}

function loadConnections(): Record<string, boolean> {
  if (typeof window === "undefined") return { ...DEFAULT_CONN };
  try {
    const s = window.localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s) as Record<string, boolean>;
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONN };
}

function saveConnections(conn: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
  } catch {
    /* ignore */
  }
}

function loadLaunched(): Campaign[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as { _launchedCampaigns?: Campaign[] };
  return Array.isArray(w._launchedCampaigns) ? w._launchedCampaigns : [];
}

export default function Advertise() {
  const [conn, setConn] = useState<Record<string, boolean>>({});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null);

  useEffect(() => {
    setConn(loadConnections());
    setCampaigns(loadLaunched());
  }, []);

  const persistConn = useCallback((next: Record<string, boolean>) => {
    setConn(next);
    saveConnections(next);
    if (typeof window !== "undefined") {
      (window as unknown as { _advertiseConnections?: Record<string, boolean> })._advertiseConnections = next;
    }
  }, []);

  const setConnected = useCallback(
    (name: string, value: boolean) => {
      persistConn({ ...conn, [name]: value });
    },
    [conn, persistConn],
  );

  const connectAll = useCallback(() => {
    const next: Record<string, boolean> = { ...conn };
    ADV_PLATFORMS.forEach((p) => {
      next[p.name] = true;
    });
    persistConn(next);
  }, [conn, persistConn]);

  const addCampaign = useCallback((record: Campaign) => {
    setCampaigns((prev) => {
      const next = [record, ...prev];
      if (typeof window !== "undefined") {
        (window as unknown as { _launchedCampaigns?: Campaign[] })._launchedCampaigns = next;
      }
      return next;
    });
  }, []);

  const connCount = ADV_PLATFORMS.filter((p) => conn[p.name]).length;

  const stats: Array<[string, string | number, string, string, string]> = [
    ["Connected Channels", connCount, "#10B981", "📡", "Ad platforms you have authorised InfoGenie to push campaigns to. Connect more channels to expand your reach."],
    ["Active Campaigns", campaigns.length, "#0066FF", "🚀", "Number of campaigns you have launched from InfoGenie that are currently running or tracked."],
    ["Channels Available", ADV_PLATFORMS.length, "#7C3AED", "🌐", "Total ad platforms supported by InfoGenie — connect any to start pushing campaigns with one click."],
    ["AI Optimisation", "94%", "#F59E0B", "⚡", "InfoGenie's AI engine efficiency score — bids, budgets, and targeting are continuously adjusted to maximise ROAS."],
  ];

  return (
    <div className="view">
      <div className="view-header" style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)" }}>
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#00C9C8" }}>
                <span className="bc-group" style={{ color: "rgba(0,229,255,.7)" }}>Reach</span>{" "}
                <span className="bc-sep" style={{ color: "rgba(255,255,255,.3)" }}>›</span> Advertise
              </div>
              <h2 className="view-title">Multi-Channel Advertising Hub</h2>
              <p className="view-sub">
                Lead-generation ads across 20+ channels — connected accounts, 3-step campaign creation, and AI-powered optimisation
              </p>
            </div>
            <div className="vh-actions">
              <button className="btn-primary" onClick={() => setPickerOpen(true)}>
                + New Campaign
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        <div style={{ padding: "28px 0" }}>
          {/* Stat bar */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 28 }}>
            {stats.map(([label, value, color, icon, tip]) => (
              <div
                key={label}
                title={tip}
                style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}
              >
                <div style={{ fontSize: "1.8rem", marginBottom: 4 }}>{icon}</div>
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>{value}</div>
                <div style={{ fontSize: "0.68rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Channel grid */}
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 18, padding: 24, marginBottom: 28, boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h3 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.1rem", fontWeight: 800, color: "#0A1628", margin: "0 0 4px" }}>
                  📡 Connected Accounts — Click to Launch Per-Channel Campaign
                </h3>
                <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>
                  {connCount} of {ADV_PLATFORMS.length} channels connected · Each channel has its own 3-step lead-gen flow
                </div>
              </div>
              <button
                onClick={connectAll}
                style={{ padding: "8px 18px", background: "linear-gradient(135deg,#00C9C8,#0066FF)", border: "none", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, color: "white", cursor: "pointer" }}
              >
                ⚡ Connect All
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", gap: 12 }}>
              {ADV_PLATFORMS.map((p) => {
                const isConn = conn[p.name] || false;
                return (
                  <div
                    key={p.name}
                    style={{ background: p.bg, border: `1.5px solid ${isConn ? p.color + "55" : "#E5E7EB"}`, borderRadius: 16, padding: "18px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, position: "relative", minWidth: 0 }}
                  >
                    {isConn && (
                      <div style={{ position: "absolute", top: 9, right: 9, width: 9, height: 9, background: "#10B981", borderRadius: "50%", boxShadow: "0 0 0 2px #D1FAE5" }} />
                    )}
                    <div style={{ fontSize: "2rem", lineHeight: 1 }}>{p.icon}</div>
                    <div style={{ fontSize: "0.73rem", fontWeight: 800, color: "#0A1628", textAlign: "center", lineHeight: 1.3 }}>{p.name}</div>
                    <div style={{ fontSize: "0.6rem", fontWeight: 600, color: isConn ? p.color : "#9CA3AF" }}>{isConn ? "● Connected" : "○ Not Connected"}</div>
                    {isConn ? (
                      <>
                        <button
                          onClick={() => setActivePlatform(p)}
                          style={{ width: "100%", padding: "7px 0", fontSize: "0.7rem", fontWeight: 800, color: "white", background: p.color, border: "none", borderRadius: 8, cursor: "pointer", marginTop: 2 }}
                        >
                          🎯 3-Step Campaign
                        </button>
                        <button
                          onClick={() => setConnected(p.name, false)}
                          style={{ width: "100%", padding: "4px 0", fontSize: "0.62rem", fontWeight: 600, color: "#DC2626", background: "white", border: "1px solid #FCA5A5", borderRadius: 6, cursor: "pointer" }}
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConnected(p.name, true)}
                        style={{ width: "100%", padding: "7px 0", fontSize: "0.7rem", fontWeight: 700, color: p.color, background: "white", border: `1.5px solid ${p.color}55`, borderRadius: 8, cursor: "pointer", marginTop: 2 }}
                      >
                        Connect
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Optimisation folders */}
          {campaigns.length > 0 && (
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 18, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <h3 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.1rem", fontWeight: 800, color: "#0A1628", margin: 0 }}>🗂️ Live Campaign Optimisation Folders</h3>
                <button
                  onClick={() => toast("🤖 AI optimisation running — bids, audiences, and budgets being adjusted")}
                  style={{ padding: "7px 16px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, fontSize: "0.75rem", fontWeight: 700, color: "#059669", cursor: "pointer" }}
                >
                  🤖 AI Optimisation Active
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {campaigns.map((c) => (
                  <div
                    key={c.id}
                    style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}
                  >
                    <div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0A1628" }}>{c.name}</div>
                      <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                        {c.platform} · {c.budgetStr}/mo · {c.startDate || "—"}
                        {c.endDate ? " → " + c.endDate : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ textAlign: "center" }} title="Return on Ad Spend — revenue generated per $1 spent on this campaign. Higher is better.">
                        <div style={{ fontSize: "1rem", fontWeight: 800, color: "#10B981" }}>{c.metrics?.roas || "—"}×</div>
                        <div style={{ fontSize: "0.62rem", color: "#6B7280" }}>ROAS</div>
                      </div>
                      <div style={{ textAlign: "center" }} title="Click-Through Rate — percentage of people who saw your ad and clicked it. Industry average is 2–5%.">
                        <div style={{ fontSize: "1rem", fontWeight: 800, color: "#0066FF" }}>{c.metrics?.ctr || "—"}</div>
                        <div style={{ fontSize: "0.62rem", color: "#6B7280" }}>CTR</div>
                      </div>
                      <span
                        title="Current campaign status — Active means ads are running and spending budget."
                        style={{ background: "#10B98122", color: "#059669", fontSize: "0.65rem", fontWeight: 700, padding: "3px 9px", borderRadius: 8, textTransform: "uppercase" }}
                      >
                        {c.status || "active"}
                      </span>
                      <button
                        onClick={() => toast("⚙️ Optimising — adjusting bids and targeting")}
                        title="Trigger InfoGenie AI to re-optimise bids, budgets, and targeting for this campaign right now."
                        style={{ padding: "5px 12px", background: "var(--ig-panel)", border: "none", borderRadius: 7, fontSize: "0.7rem", fontWeight: 700, color: "white", cursor: "pointer" }}
                      >
                        ⚡ Optimise
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <NewCampaignPicker
          conn={conn}
          onClose={() => setPickerOpen(false)}
          onPick={(platforms) => {
            setPickerOpen(false);
            if (!platforms.length) return;
            if (platforms.length > 1) {
              toast(`🚀 Launching ${platforms.length} campaigns — starting with ${platforms[0].name}`);
            }
            setActivePlatform(platforms[0]);
          }}
        />
      )}

      {activePlatform && (
        <ChannelCampaignModal
          platform={activePlatform}
          onClose={() => setActivePlatform(null)}
          onLaunch={(record) => {
            addCampaign(record);
            setActivePlatform(null);
            toast(`🚀 "${record.name}" is now live on ${record.platform}!`);
          }}
        />
      )}
    </div>
  );
}

// ── New Campaign channel picker modal ────────────────────────────────────────
function NewCampaignPicker({
  conn,
  onClose,
  onPick,
}: {
  conn: Record<string, boolean>;
  onClose: () => void;
  onPick: (platforms: Platform[]) => void;
}) {
  const connected = ADV_PLATFORMS.filter((p) => conn[p.name]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const googleConnectedCount = connected.filter((p) => GOOGLE_NAMES.includes(p.name)).length;
  const metaConnectedCount = connected.filter((p) => META_NAMES.includes(p.name)).length;
  const presets = [1, 2, 3, 5, 10].filter((n) => n <= connected.length);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function applyPreset(opts: { count?: number; group?: "google" | "meta"; all?: boolean; none?: boolean }) {
    const next = new Set<string>();
    if (opts.all) connected.forEach((p) => next.add(p.name));
    else if (opts.none) {
      /* cleared */
    } else if (opts.group === "google") connected.forEach((p) => { if (GOOGLE_NAMES.includes(p.name)) next.add(p.name); });
    else if (opts.group === "meta") connected.forEach((p) => { if (META_NAMES.includes(p.name)) next.add(p.name); });
    else if (opts.count) connected.slice(0, opts.count).forEach((p) => next.add(p.name));
    setSelected(next);
  }

  function launch() {
    const names = Array.from(selected);
    if (!names.length) return;
    const platforms = names.map((n) => ADV_PLATFORMS.find((p) => p.name === n)).filter((p): p is Platform => !!p);
    onPick(platforms);
  }

  const presetBtnStyle: React.CSSProperties = { padding: "6px 12px", background: "#EEF2FF", border: "1.5px solid #C7D2FE", borderRadius: 8, fontSize: "0.72rem", fontWeight: 700, color: "#3730A3", cursor: "pointer" };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.78)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(4px)" }}
    >
      <div style={{ background: "#FFFFFF", borderRadius: 18, width: "100%", maxWidth: 780, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" }}>
        <div style={{ padding: "22px 26px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#0066FF", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 4 }}>New Campaign</div>
            <div style={{ fontFamily: "'Space Grotesk',Sora,sans-serif", fontSize: "1.25rem", fontWeight: 800, color: "#0A1628" }}>Choose channel(s) to launch on</div>
            <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: 4 }}>
              {connected.length} connected channel{connected.length !== 1 ? "s" : ""} · pick one or many · 3-step flow each
            </div>
          </div>
          <button onClick={onClose} style={{ background: "#F3F4F6", border: "none", width: 34, height: 34, borderRadius: 10, fontSize: "1.1rem", cursor: "pointer", color: "#6B7280", fontWeight: 700, flexShrink: 0 }}>✕</button>
        </div>

        {connected.length > 0 && (
          <div style={{ padding: "14px 26px", borderBottom: "1px solid #F1F5F9", background: "#F8FAFC", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#475569", marginRight: 4 }}>Quick pick:</span>
            {presets.map((n) => (
              <button key={n} onClick={() => applyPreset({ count: n })} style={presetBtnStyle}>First {n}</button>
            ))}
            {googleConnectedCount > 0 && (
              <button onClick={() => applyPreset({ group: "google" })} style={{ padding: "6px 12px", background: "#DBEAFE", border: "1.5px solid #93C5FD", borderRadius: 8, fontSize: "0.72rem", fontWeight: 700, color: "#1E40AF", cursor: "pointer" }}>
                🔍 Google Ads (All {googleConnectedCount})
              </button>
            )}
            {metaConnectedCount > 0 && (
              <button onClick={() => applyPreset({ group: "meta" })} style={{ padding: "6px 12px", background: "#E0E7FF", border: "1.5px solid #A5B4FC", borderRadius: 8, fontSize: "0.72rem", fontWeight: 700, color: "#3730A3", cursor: "pointer" }}>
                📘 Meta (All {metaConnectedCount})
              </button>
            )}
            <button onClick={() => applyPreset({ all: true })} style={{ padding: "6px 12px", background: "#10B981", border: "1.5px solid #059669", borderRadius: 8, fontSize: "0.72rem", fontWeight: 800, color: "#FFFFFF", cursor: "pointer" }}>
              ✓ Select All ({connected.length})
            </button>
            <button onClick={() => applyPreset({ none: true })} style={{ padding: "6px 12px", background: "#FFFFFF", border: "1.5px solid #CBD5E1", borderRadius: 8, fontSize: "0.72rem", fontWeight: 700, color: "#475569", cursor: "pointer" }}>
              Clear
            </button>
          </div>
        )}

        <div style={{ padding: "18px 26px 22px", overflowY: "auto", flex: 1 }}>
          {connected.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(135px,1fr))", gap: 10 }}>
              {connected.map((p) => {
                const isGoogle = GOOGLE_NAMES.includes(p.name);
                const subLabel = isGoogle ? "Google Ads" : META_NAMES.includes(p.name) ? "Meta Ads" : "Connected";
                const subColor = isGoogle ? "#4285F4" : META_NAMES.includes(p.name) ? "#1877F2" : p.color;
                const checked = selected.has(p.name);
                return (
                  <label
                    key={p.name}
                    onClick={() => toggle(p.name)}
                    style={{
                      background: p.bg,
                      border: `1.5px solid ${p.color}55`,
                      borderRadius: 14,
                      padding: "14px 10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 5,
                      cursor: "pointer",
                      textAlign: "center",
                      position: "relative",
                      userSelect: "none",
                      boxShadow: checked ? "0 0 0 2px #10B981, 0 6px 18px rgba(16,185,129,0.25)" : "",
                      transform: checked ? "translateY(-2px)" : "none",
                      transition: "all .15s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.name)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: "absolute", top: 8, left: 8, width: 16, height: 16, cursor: "pointer", accentColor: p.color }}
                    />
                    <div style={{ fontSize: "1.7rem", lineHeight: 1, marginTop: 4 }}>{p.icon}</div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#0A1628", lineHeight: 1.2 }}>{p.name}</div>
                    <div style={{ fontSize: "0.55rem", fontWeight: 700, color: subColor, textTransform: "uppercase", letterSpacing: ".04em" }}>{subLabel}</div>
                  </label>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px", background: "#FEF3C7", border: "1.5px dashed #F59E0B", borderRadius: 14 }}>
              <div style={{ fontSize: "2.2rem", marginBottom: 8 }}>🔌</div>
              <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#92400E", marginBottom: 4 }}>No channels connected yet</div>
              <div style={{ fontSize: "0.78rem", color: "#78350F" }}>Connect at least one ad channel below to launch a campaign.</div>
            </div>
          )}
        </div>

        {connected.length > 0 && (
          <div style={{ padding: "14px 26px 18px", borderTop: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#FAFBFC" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>
              {selected.size} channel{selected.size !== 1 ? "s" : ""} selected
            </div>
            <button
              onClick={launch}
              disabled={selected.size === 0}
              style={
                selected.size > 0
                  ? { padding: "10px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 10, fontSize: "0.85rem", fontWeight: 800, color: "#FFFFFF", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,102,255,0.3)" }
                  : { padding: "10px 22px", background: "#CBD5E1", border: "none", borderRadius: 10, fontSize: "0.85rem", fontWeight: 800, color: "#FFFFFF", cursor: "not-allowed" }
              }
            >
              {selected.size <= 1 ? "🚀 Launch Campaign" : `🚀 Launch ${selected.size} Campaigns`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Per-channel 3-step lead-gen modal ────────────────────────────────────────
const GOALS = ["Lead Generation", "Website Traffic", "Brand Awareness", "Sales & Conversions", "App Installs", "Event Promotion"];
const COUNTRIES = ["Global", "United States", "United Kingdom", "Australia", "Canada", "South Africa", "Germany", "France"];
const STEP_LABELS = ["Goal & Audience", "Budget & Format", "Generate & Launch"];

function ChannelCampaignModal({
  platform,
  onClose,
  onLaunch,
}: {
  platform: Platform;
  onClose: () => void;
  onLaunch: (record: Campaign) => void;
}) {
  const { name: platName, icon: platIcon, color: platColor, bg: platBg } = platform;
  const formats = platform.formats.length ? platform.formats : ["Standard Ad"];
  const ad = getAnalysisData();
  const defaultName = ad?.url ? ad.url.replace(/https?:\/\//, "").split(".")[0] + ` — ${platName} Lead Gen` : `${platName} Lead Gen`;

  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState(GOALS[0]);
  const [audience, setAudience] = useState(ad?.audience || "");
  const [campName, setCampName] = useState(defaultName);
  const [format, setFormat] = useState(formats[0]);
  const [budget, setBudget] = useState("100");
  const [country, setCountry] = useState("Global");
  const [url, setUrl] = useState(ad?.url || "");

  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<{ kind: "ready" | "loading" | "done" | "error"; text: string }>({
    kind: "ready",
    text: "",
  });
  const [adCopy, setAdCopy] = useState<AdCopy | null>(null);
  const [showLaunch, setShowLaunch] = useState(false);
  const [launching, setLaunching] = useState(false);

  async function generate() {
    setGenerating(true);
    setGenStatus({ kind: "loading", text: `GPT-4 is crafting ${format} copy optimised for ${goal.toLowerCase()} on ${platName}` });
    const domain = (url || ad?.url || "yourdomain.com").replace(/https?:\/\//, "").split("/")[0];
    const industry = ad?.industry?.name || "your industry";
    const r = await apiPost<ChannelAdResult>("/api/ai-channel-ad", {
      platform: platName,
      format,
      goal,
      audience: audience || "business owners",
      domain,
      industry,
      budget,
    });
    if (r.ad) {
      setAdCopy(r.ad);
      setGenStatus({ kind: "done", text: `Review and edit below, then launch when ready.` });
      setShowLaunch(true);
    } else {
      setAdCopy(null);
      setGenStatus({ kind: "error", text: "Connection issue — you can still launch with default copy" });
      setShowLaunch(true);
    }
    setGenerating(false);
  }

  function confirmLaunch() {
    setLaunching(true);
    const b = parseInt(budget, 10) || 0;
    window.setTimeout(() => {
      const record: Campaign = {
        id: "camp_" + Date.now(),
        name: campName || `${platName} Campaign`,
        platform: `${platIcon} ${platName} — ${format}`,
        budget: b * 30,
        budgetStr: "$" + b * 30,
        startDate: new Date().toISOString().split("T")[0],
        audience: audience || "High-intent buyers",
        launchedAt: new Date().toLocaleString(),
        status: "active",
        daysRunning: 0,
        creatives: {},
        metrics: { roas: "3.2", ctr: "3.2%", conversions: Math.round(b * 0.9), spend: 0, cpa: "$35", impressions: Math.round(b * 130) },
        actions: [{ time: "Just now", action: `Launched ${format} on ${platName}`, type: "launch" }],
      };
      onLaunch(record);
    }, 1800);
  }

  const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 13px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", outline: "none", fontFamily: "'Inter',sans-serif" };

  function StepDots() {
    return (
      <div style={{ padding: "16px 24px 0", display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 0 }}>
        {[1, 2, 3].map((n) => {
          const active = n === step;
          const done = n < step;
          return (
            <div key={n} style={{ display: "flex", alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 800, background: done || active ? platColor : "#E5E7EB", color: done || active ? "white" : "#9CA3AF" }}>
                    {done ? "✓" : n}
                  </div>
                </div>
                <div style={{ fontSize: "0.6rem", fontWeight: active ? 700 : 500, color: active ? platColor : "#9CA3AF", textAlign: "center", marginTop: 3, maxWidth: 70, lineHeight: 1.2 }}>
                  {STEP_LABELS[n - 1]}
                </div>
              </div>
              {n < 3 && <div style={{ width: 40, height: 2, background: n < step ? platColor : "#E5E7EB", marginTop: 14, flexShrink: 0 }} />}
            </div>
          );
        })}
      </div>
    );
  }

  const labelStyle: React.CSSProperties = { fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "var(--ig-rgba70, rgba(10,22,40,0.7))", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ background: "white", borderRadius: 20, width: "100%", maxWidth: 540, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 28px 90px rgba(0,0,0,0.3)" }}>
        <div style={{ background: `linear-gradient(135deg,${platColor},${platColor}99)`, borderRadius: "20px 20px 0 0", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: "2.2rem" }}>{platIcon}</div>
            <div>
              <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: ".08em" }}>3-Step Lead Gen</div>
              <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.1rem", fontWeight: 800, color: "white" }}>{platName} Campaign</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%", width: 32, height: 32, fontSize: "1.1rem", color: "white", cursor: "pointer" }}>✕</button>
        </div>

        <StepDots />

        <div style={{ padding: "20px 24px" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>Step {step} of 3</div>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1rem", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>{STEP_LABELS[step - 1]}</div>

          {step === 1 && (
            <div>
              <div style={labelStyle}>Primary Goal</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                {GOALS.map((g) => {
                  const sel = goal === g;
                  return (
                    <label
                      key={g}
                      onClick={() => setGoal(g)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: sel ? platBg : "#F9FAFB", border: `1.5px solid ${sel ? platColor + "55" : "#E5E7EB"}`, borderRadius: 9, cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, color: sel ? platColor : "#374151" }}
                    >
                      <input type="radio" name="ch-goal" value={g} checked={sel} onChange={() => setGoal(g)} style={{ accentColor: platColor }} />
                      {g}
                    </label>
                  );
                })}
              </div>
              <div style={labelStyle}>Target Audience</div>
              <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. Small business owners 28–45 interested in automation" style={inputStyle} />
              <div style={{ ...labelStyle, margin: "10px 0 6px" }}>Campaign Name</div>
              <input value={campName} onChange={(e) => setCampName(e.target.value)} style={inputStyle} />
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={labelStyle}>Ad Format</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
                {formats.map((f) => {
                  const sel = format === f;
                  return (
                    <label
                      key={f}
                      onClick={() => setFormat(f)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: sel ? platBg : "#F9FAFB", border: `1.5px solid ${sel ? platColor + "66" : "#E5E7EB"}`, borderRadius: 9, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: sel ? platColor : "#374151" }}
                    >
                      <input type="radio" name="ch-format" value={f} checked={sel} onChange={() => setFormat(f)} style={{ accentColor: platColor }} />
                      {f}
                    </label>
                  );
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ ...labelStyle, marginBottom: 5 }}>Daily Budget (USD)</div>
                  <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} style={{ ...inputStyle, padding: "9px 12px" }} />
                </div>
                <div>
                  <div style={{ ...labelStyle, marginBottom: 5 }}>Country</div>
                  <select value={country} onChange={(e) => setCountry(e.target.value)} style={{ ...inputStyle, padding: "9px 12px", background: "white" }}>
                    {COUNTRIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ ...labelStyle, marginBottom: 5 }}>Landing Page URL</div>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" style={{ ...inputStyle, padding: "9px 12px" }} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div
                style={
                  genStatus.kind === "error"
                    ? { background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: 14, fontSize: "0.8rem", color: "#DC2626", lineHeight: 1.6, marginBottom: 12 }
                    : genStatus.kind === "done"
                      ? { background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: 14, fontSize: "0.8rem", color: "#059669", lineHeight: 1.6, marginBottom: 12 }
                      : { background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: 14, fontSize: "0.8rem", color: "#0369A1", lineHeight: 1.6, marginBottom: 12 }
                }
              >
                {genStatus.kind === "ready" && (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>✅ Ready to generate</div>
                    <div>
                      InfoGenie AI will write <strong>{platName}-optimised</strong> ad copy for your selected format, then push the campaign live with one click.
                    </div>
                  </>
                )}
                {genStatus.kind === "loading" && (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>⏳ Writing {platName} ad copy…</div>
                    <div>{genStatus.text}</div>
                  </>
                )}
                {genStatus.kind === "done" && (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>✅ {platName} ad copy generated!</div>
                    <div>{genStatus.text}</div>
                  </>
                )}
                {genStatus.kind === "error" && (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ Generation failed — using fallback</div>
                    <div>{genStatus.text}</div>
                  </>
                )}
              </div>

              <button
                onClick={generate}
                disabled={generating}
                style={{ width: "100%", padding: 12, background: `linear-gradient(135deg,${platColor},${platColor}CC)`, border: "none", borderRadius: 10, fontSize: "0.88rem", fontWeight: 800, color: "white", cursor: generating ? "wait" : "pointer", marginBottom: 10 }}
              >
                {generating ? "⏳ Generating…" : adCopy || showLaunch ? "✨ Regenerate Ad Copy" : `✨ Generate ${platName} Ad Copy with AI`}
              </button>

              {adCopy && (
                <div style={{ background: "#F9FAFB", border: `1.5px solid ${platColor}44`, borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: "1.2rem" }}>{platIcon}</div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: platColor, textTransform: "uppercase" }}>{platName} — {format}</div>
                  </div>
                  {adCopy.headline && (
                    <div contentEditable suppressContentEditableWarning style={{ fontSize: "0.9rem", fontWeight: 800, color: "#0A1628", marginBottom: 6 }}>{adCopy.headline}</div>
                  )}
                  {adCopy.body && (
                    <div contentEditable suppressContentEditableWarning style={{ fontSize: "0.8rem", color: "#374151", lineHeight: 1.5, marginBottom: 8 }}>{adCopy.body}</div>
                  )}
                  {adCopy.cta && (
                    <div style={{ display: "inline-block", background: platColor, color: "white", fontSize: "0.75rem", fontWeight: 700, padding: "6px 14px", borderRadius: 8 }}>{adCopy.cta}</div>
                  )}
                  {adCopy.hashtags && (
                    <div style={{ fontSize: "0.72rem", color: platColor, marginTop: 8 }}>{adCopy.hashtags}</div>
                  )}
                </div>
              )}

              {showLaunch && (
                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={confirmLaunch}
                    disabled={launching}
                    style={{ width: "100%", padding: 13, background: "linear-gradient(135deg,#00C9C8,#0066FF)", border: "none", borderRadius: 10, fontSize: "0.9rem", fontWeight: 800, color: "white", cursor: launching ? "wait" : "pointer" }}
                  >
                    {launching ? "⏳ Launching…" : `🚀 Launch ${platName} Campaign`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "0 24px 20px", display: "flex", gap: 10 }}>
          {step > 1 ? (
            <button onClick={() => setStep(step - 1)} style={{ flex: 1, padding: 11, background: "#F3F4F6", border: "none", borderRadius: 10, fontSize: "0.85rem", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>
              ← Back
            </button>
          ) : (
            <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F3F4F6", border: "none", borderRadius: 10, fontSize: "0.85rem", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>
              Cancel
            </button>
          )}
          {step < 3 && (
            <button onClick={() => setStep(step + 1)} style={{ flex: 2, padding: 11, background: platColor, border: "none", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700, color: "white", cursor: "pointer" }}>
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
