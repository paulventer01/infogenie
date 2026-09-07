"use client";

// Native React port of the legacy `automations` panel (was
// `window.buildAutomations` in public/js/ig_reach_automation.js +
// `#view-automations`). Automation Center: a catalogue of marketing
// automations the user can activate/deactivate, filter by category, bulk
// toggle, and "run now". State is client-side (matching the legacy panel,
// which tracked toggle state on window globals) — no API calls. Cross-tool
// "View" links route via lib/nav#goToView.
// Also hosts the Zapier / n8n Automation Bridge (outbound + inbound webhooks).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import { useToast } from "@/hooks/useToast";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Automation {
  id: string;
  cat: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
  name: string;
  desc: string;
  trigger: string;
  actions: string[];
  nav: string;
}

interface LogEntry {
  id: string;
  time: string;
  result: string;
}

const AUTOMATIONS: Automation[] = [
  {
    id: "social-autopub", cat: "social", icon: "🚀", color: "#0f766e", bg: "#F5F3FF", border: "#DDD6FE",
    name: "Social Auto-Publisher",
    desc: "Monitors your scheduled posts every 60 seconds and automatically publishes them to connected platforms at their exact scheduled time.",
    trigger: "Scheduled post time reached",
    actions: ["Publish post to Meta/Instagram/TikTok", "Update post status to Published", "Log publish event"],
    nav: "social",
  },
  {
    id: "ai-caption-gen", cat: "social", icon: "✨", color: "#4F46E5", bg: "#EEF2FF", border: "#C7D2FE",
    name: "AI Caption Auto-Generator",
    desc: "When a new post is added to the calendar without a caption, automatically generates an optimised AI caption based on your brand and industry.",
    trigger: "New post created without caption",
    actions: ["Detect empty caption field", "Call GPT-4o caption API", "Populate caption & notify"],
    nav: "social",
  },
  {
    id: "content-cluster-alert", cat: "social", icon: "📊", color: "#0066FF", bg: "#EFF6FF", border: "#BFDBFE",
    name: "Content Opportunity Alert",
    desc: "Weekly scan of keyword clusters. When a new high-volume, low-competition cluster is detected, auto-creates a content brief and adds it to your queue.",
    trigger: "Weekly keyword cluster scan",
    actions: ["Run keyword cluster analysis", "Score opportunity gaps", "Create content brief & queue"],
    nav: "content",
  },
  {
    id: "budget-optimizer", cat: "campaigns", icon: "💰", color: "#059669", bg: "#F0FDF4", border: "#BBF7D0",
    name: "Campaign Budget Optimizer",
    desc: "Monitors campaign ROAS every 6 hours. Automatically shifts budget from underperforming campaigns to top performers to maximise ROI.",
    trigger: "Every 6 hours · ROAS threshold breach",
    actions: ["Pull live ROAS data", "Identify over/under performers", "Rebalance budget allocation"],
    nav: "campaigns",
  },
  {
    id: "ab-winner", cat: "campaigns", icon: "🏆", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A",
    name: "A/B Test Auto-Winner",
    desc: "Monitors A/B test variants. When statistical significance (95%) is reached, automatically pauses the loser and scales the winner.",
    trigger: "Statistical significance ≥ 95%",
    actions: ["Check test significance daily", "Pause losing variant", "Scale winning variant budget"],
    nav: "campaigns",
  },
  {
    id: "counter-ad-gen", cat: "campaigns", icon: "⚡", color: "#DC2626", bg: "#FEF2F2", border: "#FECACA",
    name: "Counter-Ad Auto-Generator",
    desc: "When a competitor publishes a new landing page or ad, automatically generates a counter-campaign brief and adds it to your campaign queue.",
    trigger: "Competitor new page detected",
    actions: ["Monitor competitor pages", "Detect new landing pages", "Generate counter-ad brief & queue"],
    nav: "campaigns",
  },
  {
    id: "competitor-spend-alert", cat: "campaigns", icon: "🔔", color: "#0f766e", bg: "#F5F3FF", border: "#DDD6FE",
    name: "Competitor Spend Alert",
    desc: "Detects significant changes in competitor estimated ad spend. Sends an in-app alert when a competitor increases or decreases spend by 25%+.",
    trigger: "Competitor spend change ≥ 25%",
    actions: ["Monitor competitor spend signals", "Calculate spend delta", "Trigger in-app notification"],
    nav: "intelligence",
  },
  {
    id: "brand-monitor", cat: "intelligence", icon: "🛡️", color: "#0A1628", bg: "#F1F5F9", border: "#CBD5E1",
    name: "Brand Mention Monitor",
    desc: "Continuously scans Reddit, news, and web for mentions of your brand. Scores sentiment and flags negative mentions for immediate review.",
    trigger: "Continuous · New mentions found",
    actions: ["Scan web/Reddit/news hourly", "Score sentiment with GPT-4o", "Flag negatives in Action Center"],
    nav: "reddit",
  },
  {
    id: "competitor-news", cat: "intelligence", icon: "📰", color: "#0066FF", bg: "#EFF6FF", border: "#BFDBFE",
    name: "Competitor News Alert",
    desc: "Monitors news sources for competitor activity — funding rounds, product launches, leadership changes. Delivers a daily briefing to your dashboard.",
    trigger: "Daily news scan",
    actions: ["Scrape competitor news", "Extract key events", "Push to Dashboard briefing"],
    nav: "intelligence",
  },
  {
    id: "reddit-watcher", cat: "intelligence", icon: "🔴", color: "#0f766e", bg: "#FFF4EF", border: "#FDBA74",
    name: "Reddit Signal Watcher",
    desc: "Auto-monitors subreddits relevant to your industry every 2 hours. Surfaces high-relevance threads and pre-drafts reply suggestions.",
    trigger: "Every 2 hours",
    actions: ["Scan relevant subreddits", "Score thread relevance", "Pre-draft replies for Review"],
    nav: "reddit",
  },
  {
    id: "page-tracker", cat: "intelligence", icon: "🆕", color: "#059669", bg: "#F0FDF4", border: "#BBF7D0",
    name: "New Page Tracker",
    desc: "Crawls competitor websites daily. Alerts you the moment a new landing page, pricing page, or feature page goes live — before your customers see it.",
    trigger: "Daily competitor site crawl",
    actions: ["Crawl competitor sitemaps", "Detect new/changed pages", "Queue counter-ad brief"],
    nav: "intelligence",
  },
  {
    id: "keyword-gap-alert", cat: "intelligence", icon: "🔑", color: "#4F46E5", bg: "#EEF2FF", border: "#C7D2FE",
    name: "Keyword Gap Alert",
    desc: "Weekly scan of keyword gaps vs competitors. When a new high-value gap is detected, auto-populates it in your keyword intelligence view.",
    trigger: "Weekly keyword scan",
    actions: ["Run gap analysis vs competitors", "Score keyword value", "Flag new gaps in Intelligence"],
    nav: "intelligence",
  },
  {
    id: "lead-dormancy", cat: "reengage", icon: "👥", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A",
    name: "Lead Dormancy Detector",
    desc: "Monitors lead activity. When a previously active lead goes silent for 21+ days, automatically flags them in the Re-Engagement Hub with a priority score.",
    trigger: "Lead inactive for 21+ days",
    actions: ["Monitor lead activity", "Calculate dormancy score", "Add to Re-Engage priority queue"],
    nav: "reengage",
  },
  {
    id: "winback-trigger", cat: "reengage", icon: "🎯", color: "#DC2626", bg: "#FEF2F2", border: "#FECACA",
    name: "Win-back Sequence Trigger",
    desc: "When a lead crosses the 30-day dormancy threshold, automatically launches the 30-Day Lapse win-back sequence across email and retargeting ads.",
    trigger: "Lead dormant for 30+ days",
    actions: ["Detect 30-day threshold breach", "Select matching win-back template", "Launch sequence automatically"],
    nav: "reengage",
  },
  {
    id: "ai-visibility-scan", cat: "ai", icon: "🤖", color: "#10A37F", bg: "#F0FDF8", border: "#6EE7B7",
    name: "AI Visibility Weekly Scan",
    desc: "Every Monday, runs a full AI visibility audit across ChatGPT, Claude, Gemini, and Perplexity. Tracks your citation score over time and alerts on drops.",
    trigger: "Every Monday 08:00",
    actions: ["Run AI citation audit", "Score all 6 AI platforms", "Update trend chart & alert on drops"],
    nav: "search-intel",
  },
];

const CAT_LABELS: Record<string, string> = {
  all: "All", social: "Social & Content", campaigns: "Campaigns & Ads",
  intelligence: "Intelligence", reengage: "Re-Engagement", ai: "AI Visibility",
};
const CAT_COLORS: Record<string, string> = {
  all: "#10B981", social: "#0f766e", campaigns: "#059669",
  intelligence: "#0066FF", reengage: "#D97706", ai: "#10A37F",
};

const RUN_RESULTS = [
  "Scan completed — 3 new signals found",
  "Budget rebalanced across 2 campaigns",
  "Published 1 post to Instagram",
  "No changes needed — all clear",
  "2 leads flagged for re-engagement",
  "New competitor page detected",
  "AI visibility score updated",
  "Content brief queued",
  "No new gaps detected",
  "1 counter-ad brief generated",
];

function nowTime() {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ cursor: "pointer", flexShrink: 0 }}>
      <div
        style={{
          width: 46, height: 26, background: on ? "#10B981" : "#D1D5DB",
          borderRadius: 13, position: "relative", transition: "background .2s",
        }}
      >
        <div
          style={{
            position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20,
            background: "white", borderRadius: "50%", boxShadow: "0 1px 4px rgba(0,0,0,.2)",
            transition: "left .18s",
          }}
        />
      </div>
    </div>
  );
}

export default function Automations() {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [states, setStates] = useState<Record<string, boolean>>({});
  const [log, setLog] = useState<LogEntry[]>([]);

  const activeCount = AUTOMATIONS.filter((a) => states[a.id]).length;
  const runningCount = Math.max(0, activeCount - 1);
  const total = AUTOMATIONS.length;

  const filtered = filter === "all" ? AUTOMATIONS : AUTOMATIONS.filter((a) => a.cat === filter);

  function toggleAutomation(id: string) {
    const a = AUTOMATIONS.find((x) => x.id === id);
    if (!a) return;
    const wasOn = !!states[id];
    setStates((prev) => ({ ...prev, [id]: !wasOn }));
    setLog((prev) => [...prev, { id, time: nowTime(), result: !wasOn ? "Activated" : "Deactivated" }]);
    toast(!wasOn ? `⚡ ${a.name} activated — running automatically` : `⏸ ${a.name} paused`);
  }

  function runAutomationNow(id: string) {
    const a = AUTOMATIONS.find((x) => x.id === id);
    if (!a) return;
    if (!states[id]) {
      toast(`⚠️ Activate "${a.name}" first to run it`);
      return;
    }
    const rIdx = id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const result = RUN_RESULTS[rIdx % RUN_RESULTS.length];
    setLog((prev) => [...prev, { id, time: nowTime(), result }]);
    toast(`▷ ${a.name} ran now — ${result}`);
  }

  function toggleAllAutomations(turnOn: boolean) {
    const time = nowTime();
    let changed = 0;
    const newStates: Record<string, boolean> = { ...states };
    const newLog: LogEntry[] = [];
    AUTOMATIONS.forEach((a) => {
      const wasOn = !!newStates[a.id];
      if (wasOn === turnOn) return;
      newStates[a.id] = turnOn;
      newLog.push({ id: a.id, time, result: turnOn ? "Activated (bulk)" : "Deactivated (bulk)" });
      changed++;
    });
    if (!changed) {
      toast(turnOn ? "✓ All automations already running" : "✓ All automations already paused");
      return;
    }
    setStates(newStates);
    setLog((prev) => [...prev, ...newLog]);
    if (turnOn) {
      toast(`⚡ Activated ${changed} automation${changed === 1 ? "" : "s"} — your marketing now runs itself`);
    } else {
      toast(`⏸ Paused ${changed} automation${changed === 1 ? "" : "s"}`);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F0FDF9", padding: "28px 32px" }}>
      {/* Hero */}
      <div
        style={{
          background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", borderRadius: 20,
          padding: "28px 32px", marginBottom: 24, position: "relative", overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", top: -30, right: -30, width: 200, height: 200, background: "rgba(255,255,255,.05)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: -50, right: 80, width: 150, height: 150, background: "rgba(255,255,255,.04)", borderRadius: "50%" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.6rem", fontWeight: 800, color: '#0f766e', letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 3 }}>Grow › Automations</div>
            <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#BBF7D0", textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 6 }}>Automation Center</div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.7rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2, marginBottom: 8, textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>
              Your Marketing<br />Runs Itself
            </div>
            <div style={{ fontSize: "0.85rem", color: "#475569", maxWidth: 480, lineHeight: 1.55 }}>
              Activate any automation to put it on autopilot. InfoGenie monitors, decides, and acts — so you don&apos;t have to.
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {([
              ["⚡", "Active", activeCount, "#D1FAE5", "#065F46"],
              ["🔄", "Running", runningCount, "#A7F3D0", "#047857"],
              ["📋", "Total", total, "rgba(255,255,255,.2)", "white"],
            ] as const).map(([ic, l, v, bg, tc]) => (
              <div key={l} style={{ background: bg, borderRadius: 14, padding: "14px 18px", textAlign: "center", minWidth: 80 }}>
                <div style={{ fontSize: "1.4rem", fontWeight: 800, color: tc }}>{v}</div>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: tc, opacity: 0.8 }}>{ic} {l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filter bar + bulk action */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          {Object.entries(CAT_LABELS).map(([id, label]) => {
            const count = id === "all" ? AUTOMATIONS.length : AUTOMATIONS.filter((a) => a.cat === id).length;
            const active = filter === id;
            return (
              <button
                key={id}
                onClick={() => setFilter(id)}
                style={{
                  padding: "8px 16px", border: `1.5px solid ${active ? CAT_COLORS[id] : "#D1FAE5"}`,
                  borderRadius: 9, background: active ? CAT_COLORS[id] : "white",
                  fontSize: "0.75rem", fontWeight: active ? 700 : 500,
                  color: active ? "white" : CAT_COLORS[id] || "#059669", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {label} <span style={{ opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}
        </div>
        {activeCount === total ? (
          <button
            onClick={() => toggleAllAutomations(false)}
            style={{ padding: "9px 18px", border: "1.5px solid #D97706", borderRadius: 9, background: "#FFFBEB", color: "#92400E", fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span>⏸</span> Pause All ({total})
          </button>
        ) : (
          <button
            onClick={() => toggleAllAutomations(true)}
            style={{ padding: "9px 18px", border: "none", borderRadius: 9, background: "linear-gradient(135deg,#059669,#10B981)", color: "white", fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(16,185,129,.35)", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span>⚡</span> Automate All ({total - activeCount} off)
          </button>
        )}
      </div>

      {/* Cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 16 }}>
        {filtered.map((a) => {
          const on = !!states[a.id];
          const lastLog = log.filter((l) => l.id === a.id).slice(-1)[0];
          return (
            <div
              key={a.id}
              style={{
                background: "white", border: `1.5px solid ${on ? a.border : "#E5E7EB"}`,
                borderRadius: 18, padding: 22,
                boxShadow: on ? `0 0 0 3px ${a.border},0 2px 8px rgba(0,0,0,.06)` : "0 1px 4px rgba(0,0,0,.04)",
                transition: "all .2s", position: "relative", overflow: "hidden",
              }}
            >
              {on && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${a.color},${a.color}88)` }} />}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{ width: 44, height: 44, background: on ? a.bg : "#F9FAFB", border: `1.5px solid ${on ? a.border : "#E5E7EB"}`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", flexShrink: 0 }}>{a.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628" }}>{a.name}</div>
                      {on ? (
                        <span style={{ background: a.bg, color: a.color, borderRadius: 6, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, letterSpacing: ".04em" }}>● ACTIVE</span>
                      ) : (
                        <span style={{ background: "#F3F4F6", color: "#9CA3AF", borderRadius: 6, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 600 }}>INACTIVE</span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.63rem", fontWeight: 700, color: a.color, textTransform: "uppercase", letterSpacing: ".05em" }}>{CAT_LABELS[a.cat] || a.cat}</div>
                  </div>
                </div>
                <Toggle on={on} onClick={() => toggleAutomation(a.id)} />
              </div>
              <div style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.6, marginBottom: 12 }}>{a.desc}</div>
              <div style={{ background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>⚡ Trigger</div>
                <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#374151", marginBottom: 8 }}>{a.trigger}</div>
                <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>→ Actions</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {a.actions.map((ac, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.7rem", color: "#374151" }}>
                      <span style={{ width: 16, height: 16, background: on ? a.bg : "#F3F4F6", border: `1px solid ${on ? a.border : "#E5E7EB"}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6rem", fontWeight: 700, color: on ? a.color : "#9CA3AF", flexShrink: 0 }}>{i + 1}</span>
                      {ac}
                    </div>
                  ))}
                </div>
              </div>
              {lastLog && <div style={{ fontSize: "0.65rem", color: "#9CA3AF", marginBottom: 10 }}>Last run: {lastLog.time} · {lastLog.result}</div>}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => toggleAutomation(a.id)}
                  style={{ flex: 1, padding: 8, background: on ? `linear-gradient(135deg,${a.color},${a.color}CC)` : "#F3F4F6", border: "none", borderRadius: 9, fontSize: "0.75rem", fontWeight: 700, color: on ? "white" : "#6B7280", cursor: "pointer" }}
                >
                  {on ? "⏸ Deactivate" : "▶ Activate"}
                </button>
                <button
                  onClick={() => runAutomationNow(a.id)}
                  style={{ padding: "8px 12px", background: "white", border: `1.5px solid ${on ? a.border : "#E5E7EB"}`, borderRadius: 9, fontSize: "0.75rem", fontWeight: 600, color: on ? a.color : "#9CA3AF", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  ▷ Run Now
                </button>
                <button
                  onClick={() => goToView(router, a.nav)}
                  style={{ padding: "8px 12px", background: "white", border: "1.5px solid #E5E7EB", borderRadius: 9, fontSize: "0.75rem", fontWeight: 600, color: "#6B7280", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  → View
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <AutomationBridgePanel />

      {/* Activity log */}
      {log.length > 0 && (
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, marginTop: 24, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>📋 Automation Activity Log</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
            {[...log].reverse().slice(0, 20).map((l, i) => {
              const a = AUTOMATIONS.find((x) => x.id === l.id);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "#F8FAFC", borderRadius: 8, fontSize: "0.72rem" }}>
                  <span style={{ fontSize: "0.9rem" }}>{a?.icon || "⚡"}</span>
                  <span style={{ fontWeight: 700, color: "#0A1628", flexShrink: 0 }}>{a?.name || l.id}</span>
                  <span style={{ color: "#6B7280", flex: 1 }}>{l.result}</span>
                  <span style={{ color: "#9CA3AF", flexShrink: 0 }}>{l.time}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AutomationBridgePanel() {
  const toast = useToast();
  const [targets, setTargets] = useState<Array<{
    id: number; provider: string; name: string; target_url: string; triggers: string[]; enabled: boolean;
  }>>([]);
  const [inbound, setInbound] = useState<{ webhook_path?: string; webhook_url?: string; token?: string } | null>(null);
  const [catalog, setCatalog] = useState<{ triggers: Array<{ id: string; label: string }>; actions: Array<{ id: string; label: string }> }>({ triggers: [], actions: [] });
  const [provider, setProvider] = useState("zapier");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [t, i, c] = await Promise.all([
      apiGet<{ ok: boolean; items: typeof targets }>("/api/automation-bridge/targets"),
      apiGet<{ ok: boolean; items: Array<{ webhook_path?: string; webhook_url?: string; token?: string }> }>("/api/automation-bridge/inbound"),
      apiGet<{ ok: boolean; triggers: Array<{ id: string; label: string }>; actions: Array<{ id: string; label: string }> }>("/api/automation-bridge/catalog"),
    ]);
    if (t.ok) setTargets(t.items || []);
    if (i.ok) setInbound((i.items || [])[0] || null);
    if (c.ok) setCatalog({ triggers: c.triggers || [], actions: c.actions || [] });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addTarget() {
    if (!url.trim()) {
      toast("⚠️ Paste a Zapier / n8n / Make webhook URL");
      return;
    }
    setSaving(true);
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/automation-bridge/targets", {
      provider,
      name: `${provider} outbound`,
      target_url: url.trim(),
      triggers: ["*"],
    });
    setSaving(false);
    if (!r.ok) {
      toast("❌ " + (r.error || "Could not save webhook"));
      return;
    }
    toast("✅ Outbound webhook saved");
    setUrl("");
    load();
  }

  async function testFire() {
    const r = await apiPost<{ ok: boolean; delivered?: number; error?: string }>("/api/automation-bridge/test-fire", {
      event: "alert.raised",
      data: { message: "InfoGenie automation bridge test", severity: "info" },
    });
    toast(r.ok ? `✅ Delivered to ${r.delivered || 0} target(s)` : "❌ " + (r.error || "test failed"));
  }

  async function removeTarget(id: number) {
    await apiDelete(`/api/automation-bridge/targets/${id}`);
    load();
  }

  async function copyInbound() {
    const text = inbound?.webhook_url || (typeof window !== "undefined" ? `${window.location.origin}${inbound?.webhook_path || ""}` : "");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast("✅ Inbound webhook URL copied");
    } catch {
      toast(text);
    }
  }

  return (
    <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 22, marginTop: 28, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1rem", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>
        ⚡ Zapier · n8n · Make bridge
      </div>
      <p style={{ margin: "0 0 16px", fontSize: "0.82rem", color: "#64748b", maxWidth: 720 }}>
        Push InfoGenie events to external DIY automation, and let those tools call back into Document RAG, Marketing Memory, or officer tasks.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#0f766e", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Outbound (InfoGenie → Zapier/n8n)</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: "0.8rem" }}
            >
              <option value="zapier">Zapier</option>
              <option value="n8n">n8n</option>
              <option value="make">Make</option>
              <option value="custom">Custom</option>
            </select>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/... or n8n webhook URL"
              style={{ flex: 1, minWidth: 180, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: "0.8rem" }}
            />
            <button
              type="button"
              disabled={saving}
              onClick={addTarget}
              style={{ padding: "8px 12px", borderRadius: 8, border: 0, background: "linear-gradient(135deg,#0f766e,#0284c7)", color: "#fff", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={testFire}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #bae6fd", background: "#f0f9ff", color: "#0369a1", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}
            >
              Test fire
            </button>
          </div>
          {!targets.length ? (
            <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>No outbound targets yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {targets.map((t) => (
                <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: "#F8FAFC", borderRadius: 8, fontSize: "0.75rem" }}>
                  <strong style={{ textTransform: "capitalize" }}>{t.provider}</strong>
                  <span style={{ color: "#64748b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.target_url}</span>
                  <button type="button" onClick={() => removeTarget(t.id)} style={{ border: 0, background: "transparent", color: "#94a3b8", cursor: "pointer" }}>✕</button>
                </div>
              ))}
            </div>
          )}
          {!!catalog.triggers.length && (
            <div style={{ marginTop: 10, fontSize: "0.7rem", color: "#94a3b8" }}>
              Events: {catalog.triggers.map((t) => t.id).join(" · ")}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#0f766e", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Inbound (Zapier/n8n → InfoGenie)</div>
          <div style={{ padding: "10px 12px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 10, marginBottom: 10 }}>
            <div style={{ fontSize: "0.72rem", color: "#0f766e", fontWeight: 700, marginBottom: 4 }}>Webhook URL</div>
            <code style={{ fontSize: "0.72rem", wordBreak: "break-all", color: "#134e4a" }}>
              {inbound?.webhook_url || (inbound?.webhook_path ? `(origin)${inbound.webhook_path}` : "Loading…")}
            </code>
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={copyInbound}
                style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #99F6E4", background: "#fff", color: "#0f766e", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer" }}
              >
                Copy URL
              </button>
            </div>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748b", lineHeight: 1.5 }}>
            POST JSON: <code>{`{ "action": "memory.ingest", "params": { "summary": "…" } }`}</code>
            <br />
            Actions: {(catalog.actions || []).map((a) => a.id).join(", ") || "webhook.echo, memory.ingest, document.ingest_text, task.create"}
          </div>
        </div>
      </div>
    </div>
  );
}
