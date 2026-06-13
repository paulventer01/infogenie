"use client";

// Native React port of the legacy `content-calendar` panel (was
// `window.buildContentCalendar` / `_ccGo` / `_ccCopy` / `_ccScheduleAll` in
// `app.js` + `public/js/ig_intel_pack_a.js`, and `#view-content-calendar` in
// index.html). Generates a multi-channel content calendar and schedules it to
// Zernio via the existing Express API through `lib/api`:
//   POST /api/content-calendar/generate
//   GET  /api/social-publisher/profiles
//   POST /api/social-publisher/schedule-calendar
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

const CHANNELS = [
  "instagram",
  "tiktok",
  "linkedin",
  "x",
  "facebook",
  "youtube",
  "blog",
  "email",
];
const DEFAULT_CHECKED = ["instagram", "linkedin", "x"];

const CHANNEL_COLOR: Record<string, string> = {
  instagram: "#E1306C",
  tiktok: "#000",
  linkedin: "#0A66C2",
  x: "#000",
  facebook: "#1877F2",
  youtube: "#FF0000",
  blog: "#6B7280",
  email: "#7C3AED",
};

interface CalendarPost {
  day?: number | string;
  date?: string;
  channel?: string;
  format?: string;
  hook?: string;
  copy?: string;
  cta?: string;
  hashtags?: string[];
  best_time?: string;
}
interface GenerateResult {
  ok: boolean;
  error?: string;
  source?: string;
  posts?: CalendarPost[];
}

interface SocialProfile {
  _id?: string;
  id?: string;
  name?: string;
}
interface ProfilesResult {
  ok: boolean;
  error?: string;
  profiles?: SocialProfile[];
}
interface ScheduleResult {
  ok: boolean;
  error?: string;
  scheduled?: number;
  total?: number;
  failed?: number;
}

interface Banner {
  kind: "info" | "ok" | "err";
  text: string;
}

const PLATFORM_MAP: Record<string, string> = {
  instagram: "instagram",
  tiktok: "tiktok",
  linkedin: "linkedin",
  x: "twitter",
  twitter: "twitter",
  facebook: "facebook",
  youtube: "youtube",
};

export default function ContentCalendar() {
  const [brand, setBrand] = useState("Nike");
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState(7);
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [channels, setChannels] = useState<string[]>([...DEFAULT_CHECKED]);

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [notice, setNotice] = useState("");
  const [banner, setBanner] = useState<Banner | null>(null);

  function toggleChannel(c: string) {
    setChannels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  async function generate() {
    if (!brand.trim()) {
      setNotice("⚠️ Brand required");
      return;
    }
    if (!channels.length) {
      setNotice("⚠️ Pick at least one channel");
      return;
    }
    setNotice("");
    setBanner(null);
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<GenerateResult>("/api/content-calendar/generate", {
      brand: brand.trim(),
      goal,
      audience,
      tone,
      days,
      channels,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("done");
  }

  async function copyCsv() {
    const posts = result?.posts || [];
    if (!posts.length) return;
    const headers = [
      "day",
      "date",
      "channel",
      "format",
      "hook",
      "copy",
      "cta",
      "hashtags",
      "best_time",
    ];
    const csv = [headers.join(",")]
      .concat(
        posts.map((p) =>
          headers
            .map((h) => {
              const raw =
                h === "hashtags"
                  ? Array.isArray(p.hashtags)
                    ? p.hashtags.join(" ")
                    : ""
                  : (p[h as keyof CalendarPost] as string | number | undefined) ??
                    "";
              return '"' + String(raw).replace(/"/g, '""') + '"';
            })
            .join(","),
        ),
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(csv);
      setNotice("✅ Copied as CSV");
    } catch (e) {
      setNotice("❌ " + (e instanceof Error ? e.message : "copy failed"));
    }
  }

  async function scheduleAll() {
    const posts = result?.posts || [];
    if (!posts.length) {
      setNotice("⚠️ Generate a calendar first");
      return;
    }
    const pr = await apiGet<ProfilesResult>("/api/social-publisher/profiles");
    if (!pr.ok) {
      setNotice("❌ " + (pr.error || "failed"));
      return;
    }
    const profiles = pr.profiles || [];
    if (!profiles.length) {
      if (
        confirm("No Zernio profiles yet. Open Social Publisher to create one?")
      ) {
        window.navigateTo?.("social-publisher");
      }
      return;
    }
    let profileId: string | null = null;
    if (profiles.length === 1) {
      profileId = profiles[0]._id || profiles[0].id || null;
    } else {
      const choice = prompt(
        "Pick a profile by number:\n\n" +
          profiles.map((p, i) => `${i + 1}. ${p.name}`).join("\n"),
      );
      const idx = parseInt(choice || "", 10) - 1;
      profileId =
        idx >= 0 && profiles[idx]
          ? profiles[idx]._id || profiles[idx].id || null
          : null;
    }
    if (!profileId) return;

    const items = posts
      .map((p) => {
        const channel = String(p.channel || "").toLowerCase();
        const mapped = PLATFORM_MAP[channel];
        if (!mapped) return null;
        const dateStr =
          p.date && p.best_time
            ? `${p.date} ${p.best_time}`
            : p.date || null;
        let scheduledFor: string | null = null;
        if (dateStr) {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) scheduledFor = d.toISOString();
        }
        const text = [
          p.hook,
          p.copy,
          p.cta,
          Array.isArray(p.hashtags) ? p.hashtags.join(" ") : "",
        ]
          .filter(Boolean)
          .join("\n\n")
          .trim();
        return { date: scheduledFor, channel: mapped, copy: text };
      })
      .filter((x): x is { date: string | null; channel: string; copy: string } =>
        Boolean(x),
      );

    if (!items.length) {
      setNotice("⚠️ No posts mapped to Zernio platforms (blog/email skipped)");
      return;
    }
    const distinct = [...new Set(items.map((i) => i.channel))].join(", ");
    if (
      !confirm(
        `Schedule ${items.length} post(s) to Zernio across ${distinct}?\n\n(Posts on blog/email channels are skipped — Zernio handles social only.)`,
      )
    ) {
      return;
    }

    setBanner({
      kind: "info",
      text: `📤 Scheduling ${items.length} posts to Zernio…`,
    });
    const r = await apiPost<ScheduleResult>(
      "/api/social-publisher/schedule-calendar",
      { profileId, items },
    );
    if (!r.ok) {
      setBanner({ kind: "err", text: "❌ " + (r.error || "failed") });
      return;
    }
    setBanner({
      kind: r.failed ? "info" : "ok",
      text: `✅ Scheduled ${r.scheduled ?? 0}/${r.total ?? 0}${
        r.failed
          ? ` · ${r.failed} failed (open Social Publisher to inspect)`
          : ""
      }`,
    });
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 4,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: 8,
    fontSize: "0.88rem",
    boxSizing: "border-box",
  };

  const bannerColors: Record<Banner["kind"], React.CSSProperties> = {
    info: { background: "#FFF7ED", borderColor: "#FED7AA", color: "#9A3412" },
    ok: { background: "#ECFDF5", borderColor: "#A7F3D0", color: "#065F46" },
    err: { background: "#FEF2F2", borderColor: "#FECACA", color: "#991B1B" },
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Content Calendar
              </div>
              <h2 className="view-title">📅 Content Calendar Auto-Pilot</h2>
              <p className="view-sub">
                Generate a fully-fleshed multi-channel content calendar in
                seconds — hook, copy, hashtags, CTA and best time per post.
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
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 100px",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>Brand</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Nike"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Goal</label>
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. drive 10% more sign-ups"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Days</label>
              <input
                type="number"
                value={days}
                min={1}
                max={30}
                onChange={(e) => setDays(parseInt(e.target.value, 10) || 7)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Audience</label>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. urban athletes 18-34"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Tone</label>
              <input
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="e.g. bold + motivational"
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Channels</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CHANNELS.map((c) => (
                <label
                  key={c}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "#F3F4F6",
                    padding: "6px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: "0.78rem",
                    color: "#374151",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={channels.includes(c)}
                    onChange={() => toggleChannel(c)}
                  />{" "}
                  {c}
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={generate}
            disabled={status === "loading"}
            style={{
              marginTop: 14,
              padding: "10px 22px",
              background: "#059669",
              border: "2px solid #059669",
              borderRadius: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#fff",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.4)",
            }}
          >
            📅 Generate Calendar
          </button>
          {notice && (
            <div
              style={{ marginTop: 10, fontSize: "0.8rem", color: "#374151" }}
            >
              {notice}
            </div>
          )}
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              ⏳ Drafting {days}-day calendar across {channels.length} channel(s)…
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
          {status === "done" && result && (
            <>
              {banner && (
                <div
                  style={{
                    ...bannerColors[banner.kind],
                    border: `1px solid ${bannerColors[banner.kind].borderColor}`,
                    padding: 12,
                    borderRadius: 8,
                    marginBottom: 12,
                    fontSize: "0.84rem",
                  }}
                >
                  {banner.text}
                </div>
              )}
              <div
                style={{
                  marginBottom: 14,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontWeight: 800, color: "#0A1628" }}>
                  📋 {(result.posts || []).length} posts ·{" "}
                  {result.source === "openai" ? "AI-generated" : "Template"}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    onClick={copyCsv}
                    style={{
                      padding: "7px 14px",
                      background: "#fff",
                      border: "2px solid #D1D5DB",
                      borderRadius: 6,
                      fontSize: "0.74rem",
                      fontWeight: 700,
                      color: "#374151",
                      cursor: "pointer",
                    }}
                  >
                    📋 Copy All as CSV
                  </button>
                  <button
                    onClick={scheduleAll}
                    title="Schedule all posts to Zernio (social platforms only — blog/email skipped)"
                    style={{
                      padding: "7px 14px",
                      background: "linear-gradient(135deg,#FF5722,#FF7043)",
                      border: "none",
                      borderRadius: 6,
                      fontSize: "0.74rem",
                      fontWeight: 800,
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    📤 Schedule All to Social
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))",
                  gap: 12,
                }}
              >
                {(result.posts || []).map((p, i) => {
                  const tint = CHANNEL_COLOR[p.channel || ""] || "#0891B2";
                  return (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderTop: `3px solid ${tint}`,
                        borderRadius: 10,
                        padding: "14px 16px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              background: tint,
                              color: "#fff",
                              padding: "3px 8px",
                              borderRadius: 5,
                              fontSize: "0.66rem",
                              fontWeight: 800,
                              textTransform: "uppercase",
                            }}
                          >
                            {p.channel || ""}
                          </span>
                          <span
                            style={{ fontSize: "0.7rem", color: "#6B7280" }}
                          >
                            {p.format || ""}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>
                          Day {p.day} · {p.date || ""} · {p.best_time || ""}
                        </div>
                      </div>
                      <div
                        style={{
                          fontWeight: 800,
                          color: "#0A1628",
                          fontSize: "0.92rem",
                          marginBottom: 6,
                        }}
                      >
                        {p.hook || ""}
                      </div>
                      <div
                        style={{
                          fontSize: "0.82rem",
                          color: "#374151",
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {p.copy || ""}
                      </div>
                      {p.cta && (
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: "0.78rem",
                            color: "#059669",
                            fontWeight: 700,
                          }}
                        >
                          → {p.cta}
                        </div>
                      )}
                      {Array.isArray(p.hashtags) && p.hashtags.length > 0 && (
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: "0.74rem",
                            color: "#0891B2",
                          }}
                        >
                          {p.hashtags.join(" ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
