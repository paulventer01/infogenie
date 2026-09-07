"use client";

import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

const STEPS = [
  { n: 1, title: "Hook & concept", view: "video-script", icon: "🎬", desc: "Generate a short-form script with a strong 3-second hook." },
  { n: 2, title: "UGC or avatar", view: "ugc-avatars", icon: "🧑‍🎤", desc: "Create UGC-style avatar video or use Product Video for ecom." },
  { n: 3, title: "Captions & hashtags", view: "hashtag-intel", icon: "🔖", desc: "Pull trending hashtags for TikTok / Reels." },
  { n: 4, title: "Publish", view: "social-publisher", icon: "📤", desc: "Schedule to TikTok, Instagram Reels, YouTube Shorts." },
  { n: 5, title: "Measure", view: "post-performance", icon: "⚗️", desc: "Review post performance and iterate hooks." },
];

export default function ShortFormVideo() {
  const router = useRouter();

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#fdf2f8 0%,#eef2ff 55%,#ecfdf5 100%)" }}>
        <div className="breadcrumb"><span className="bc-group" style={{ opacity: 0.85 }}>Create</span> <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Short-Form Video</div>
        <h1 className="ih-title">🎬 Short-Form Video Workflow</h1>
        <p className="ih-sub">Reels, Shorts, and TikTok — hook → script → publish → measure in five guided steps.</p>
      </div>

      <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
        {STEPS.map((s) => (
          <button
            key={s.n}
            type="button"
            onClick={() => goToView(router, s.view)}
            style={{
              display: "flex",
              gap: 16,
              width: "100%",
              textAlign: "left",
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 14,
              padding: "18px 20px",
              marginBottom: 12,
              cursor: "pointer",
              alignItems: "flex-start",
            }}
          >
            <span style={{ fontSize: "1.5rem", fontWeight: 900, color: "#0f766e", minWidth: 28 }}>{s.n}</span>
            <span style={{ fontSize: "1.4rem" }}>{s.icon}</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>{s.title}</div>
              <p style={{ margin: "6px 0 0", fontSize: "0.82rem", color: "#64748B" }}>{s.desc}</p>
            </div>
          </button>
        ))}
        <button type="button" onClick={() => goToView(router, "tiktok-ads-insights")} style={{ marginTop: 8, padding: "10px 16px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white", fontWeight: 700, cursor: "pointer" }}>
          Boost with TikTok Ads →
        </button>
      </div>
    </div>
  );
}
