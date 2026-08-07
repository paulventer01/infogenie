"use client";

// Native React port of the legacy `opt-folders` panel (was `buildOptFolders`
// and its `runOptFolders` / `showOptAction` / `showOptControl` helpers inline in
// app.js + `#view-opt-folders` in index.html). This panel is a fully
// client-side simulation: it derives deterministic per-domain folder data from
// the legacy `window.analysisData` global (seeded RNG) — it calls no `/api/*`
// endpoint, exactly like the legacy builder. Cross-tool navigation uses
// `lib/nav`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

interface Rule {
  cond: string;
  action: string;
}
interface RecentAction {
  type: string;
  what: string;
  when: string;
}
interface Folder {
  name: string;
  icon: string;
  color: string;
  rules: Rule[];
  campaigns: { name: string }[];
  spend: string;
  status: string;
  recent: RecentAction[];
}
interface OptData {
  folders: Folder[];
  savings: number;
  actions: number;
  uplift: number;
}

interface Playbook {
  icon: string;
  color: string;
  what: string;
  why: string;
  how: string[];
  impact: string;
  safety: string;
}

type Modal =
  | { kind: "action"; folderIdx: number; ruleIdx: number }
  | { kind: "edit" | "pause" | "force"; folderIdx: number }
  | null;

function showToast(msg: string) {
  (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
}

interface AnalysisData {
  url?: string;
  domain?: string;
  sector?: string;
  industry?: string | { name?: string };
}
function getAnalysisData(): AnalysisData | null {
  if (typeof window !== "undefined") {
    const ad = (window as unknown as { analysisData?: AnalysisData }).analysisData;
    if (ad) return ad;
    try {
      const url = localStorage.getItem("ig-last-analysed-url");
      if (url) return { url };
    } catch {
      /* ignore */
    }
  }
  return null;
}
function lsDomain(): string {
  const ad = getAnalysisData();
  const d = (ad && (ad.url || ad.domain)) || "";
  return String(d).replace(/^https?:\/\//, "").split("/")[0] || "";
}
function lsSector(): string {
  const ad = getAnalysisData();
  if (ad) {
    if (ad.sector) return ad.sector;
    if (ad.industry && typeof ad.industry === "string") return ad.industry;
    if (ad.industry && typeof ad.industry === "object" && ad.industry.name)
      return ad.industry.name;
  }
  return "your industry";
}
function seedRng(seedStr: string) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
}

const PLAYBOOK: Record<string, Playbook> = {
  "Scale +20% daily": {
    icon: "⬆",
    color: "#10B981",
    what: "Increases the daily ad-set budget by 20% every 24 hours, while ROAS stays above the trigger threshold.",
    why: "Top performers compound. A controlled 20% step lets the platform algorithms relearn audiences without resetting the learning phase.",
    how: [
      "Check the trigger: confirm ROAS is still ≥ the rule threshold (e.g. 3.5×) over the last 48h.",
      "Open the ad-set in the platform (Meta Ads Manager / Google Ads / TikTok Ads).",
      "Edit budget → set new daily = current × 1.20 (e.g. $100 → $120).",
      "Save and tag the change in your audit log so you can attribute the lift.",
      "Re-check after 24h — if ROAS holds, repeat. If it drops > 15%, revert and alert.",
    ],
    impact: "Avg outcome on similar campaigns: +18-26% revenue, +8-12% spend, ROAS dips ≤ 5%.",
    safety: "Capped at +20%/day to protect the learning phase. Hard ceiling: 5× starting budget per folder.",
  },
  "Scale +30%": {
    icon: "⬆",
    color: "#10B981",
    what: "A more aggressive +30% daily scale — used for retargeting where intent is already strong and ROAS > 5×.",
    why: "High-intent retargeting audiences absorb spend faster than prospecting. 30% steps still respect the learning phase.",
    how: [
      "Verify ROAS ≥ 5× over last 7 days and frequency < 4.",
      "In the platform, edit the retargeting ad-set → daily budget × 1.30.",
      "Add a creative refresh in parallel to combat fatigue (frequency tends to spike).",
      "Set a kill-switch: auto-pause if ROAS drops below 3× over any 48h window.",
      "Review after 72h — most folders settle into a new equilibrium by day 3.",
    ],
    impact: "Avg outcome: +24-38% revenue, +16-22% spend, frequency +0.4-0.7.",
    safety: "Only fires if frequency < 4 and 7-day ROAS > 5×. Both conditions must hold.",
  },
  "Refresh creative": {
    icon: "🎨",
    color: "#0EA5E9",
    what: "Replaces the worst-performing 50% of creatives in the ad-set with new variants from the Smart Creative Builder.",
    why: "Creative fatigue is the #1 cause of CTR decline. Rotating in fresh variants resets engagement without touching audiences or budget.",
    how: [
      "Open Smart Creative Builder → filter by the folder's platform → pick top 4-6 by predicted CTR.",
      "In the platform, pause the bottom-half of existing creatives (do not delete — keep for performance reference).",
      "Upload the new variants into the same ad-set so they inherit the audience signal.",
      "Let them spend 10-15% of daily budget before judging — algorithms need a learning window.",
      "Promote the winners (CTR > avg + 20%) to evergreen, retire the losers.",
    ],
    impact: "Avg outcome: CTR recovers +35-60% within 5-7 days, CPM stable, CPA -10-18%.",
    safety: "Old creatives are paused (not deleted) so you can always roll back.",
  },
  "Narrow audience": {
    icon: "🎯",
    color: "#0EA5E9",
    what: "Reduces the audience size by removing low-converting segments (age bands, placements, interests) until CPM drops back into target.",
    why: "High CPM usually means you're competing for low-value impressions. Narrowing focuses spend on the highest-intent segments.",
    how: [
      "Open the ad-set → Breakdown by age, placement, and interest.",
      "Identify segments where CPM is > 1.5× the folder average AND CVR is < 0.5×.",
      "Exclude those segments (Meta: edit audience exclusions; Google: negative audience lists).",
      "Set a minimum audience size of 500K to avoid over-narrowing — algorithms need scale.",
      "Re-evaluate after 72h. If CPM is still high, the issue is creative, not targeting.",
    ],
    impact: "Avg outcome: CPM -18-30%, audience size -25-40%, CVR +12-22%.",
    safety: "Stops narrowing when audience hits 500K floor. Original audience saved as a snapshot.",
  },
  "Pause & relaunch": {
    icon: "🔁",
    color: "#EF4444",
    what: "Pauses the ad-set, waits 24h to clear the auction signal, then relaunches with a fresh learning phase using updated bid + budget.",
    why: "When CPA blows past target, the algorithm has often locked onto a bad audience signal. A 24h pause + relaunch is faster than trying to fix it in place.",
    how: [
      "Pause the ad-set in the platform — do NOT delete (you'll lose history).",
      "Wait a full 24 hours so the auction signal decays.",
      "Duplicate the ad-set, increase the bid cap by 10-15%, and reduce daily budget by 30% to force a tighter learning phase.",
      "Launch the duplicate, archive the original.",
      "Monitor for 50 conversions before judging — Meta needs that for stable performance.",
    ],
    impact: "Avg outcome: CPA -22-40% on the relaunched ad-set within 7-10 days.",
    safety: "Original ad-set is preserved (paused, not deleted) so you can always re-enable it.",
  },
  "Pause & alert": {
    icon: "⏸",
    color: "#EF4444",
    what: "Pauses the ad-set immediately and sends a Slack/email alert so a human can decide next steps. Used for high-risk retargeting campaigns.",
    why: "Retargeting CPA spikes usually mean a tracking issue (pixel broken, dataset offline) — not a campaign issue. Auto-pause prevents waste while a human investigates.",
    how: [
      "Confirm the alert in your inbox / Slack channel #ad-alerts.",
      "Check the pixel/Conversion API: open Events Manager → confirm events firing in the last hour.",
      "If tracking is healthy, check the landing page for a 5xx error or checkout block.",
      "If everything is healthy, the audience is genuinely fatigued — refresh creative + narrow audience.",
      "Re-enable the ad-set only after the root cause is fixed.",
    ],
    impact: "Saves an avg of $180-$420/day in wasted retargeting spend during incidents.",
    safety: "Pause is reversible from the alert email with one click.",
  },
  "Promote to Top": {
    icon: "🚀",
    color: "#10B981",
    what: "Moves a Test & Learn campaign into the Top Performers folder, inheriting that folder's aggressive scaling rules.",
    why: "Once a test campaign has spent enough to prove out, it deserves the full scaling treatment — not the cautious test-mode rules.",
    how: [
      "Confirm the campaign has spent ≥ $200 with ROAS ≥ 3× over 7 days.",
      'In the folder UI, drag the campaign card into Top Performers (or use the "Move" menu).',
      "The campaign now inherits Top Performers rules: +20% daily scale, refresh on CTR drop.",
      "Original Test & Learn budget is freed up — InfoGenie suggests a new test concept to fill the slot.",
      "Track the promoted campaign for 14 days to confirm it sustains in the new folder.",
    ],
    impact: "Avg outcome: 2.4× spend velocity, +28% revenue from the campaign within 14 days.",
    safety: "Reversible — you can move the campaign back to Test & Learn at any time.",
  },
};

const TYPE_MAP: Record<string, string> = {
  "Scale +20% daily": "scale",
  "Scale +30%": "scale",
  "Refresh creative": "refresh",
  "Narrow audience": "refresh",
  "Pause & relaunch": "pause",
  "Pause & alert": "pause",
  "Promote to Top": "scale",
};

function buildData(): OptData {
  const rng = seedRng(lsDomain() + "opt");
  const sector = lsSector();
  const folderTpl = [
    {
      name: "Top Performers",
      icon: "🚀",
      color: "#10B981",
      rules: [
        { cond: "ROAS > 3.5", action: "Scale +20% daily" },
        { cond: "CTR drop > 30%", action: "Refresh creative" },
      ],
    },
    {
      name: "Test & Learn",
      icon: "🧪",
      color: "#0EA5E9",
      rules: [
        { cond: "CPA > $45", action: "Pause & relaunch" },
        { cond: "Spend > $200", action: "Promote to Top" },
      ],
    },
    {
      name: "Brand Campaigns",
      icon: "🎯",
      color: "#8B5CF6",
      rules: [
        { cond: "Frequency > 4.5", action: "Refresh creative" },
        { cond: "CPM > $25", action: "Narrow audience" },
      ],
    },
    {
      name: "Retargeting",
      icon: "🔁",
      color: "#F59E0B",
      rules: [
        { cond: "CPA > $25", action: "Pause & alert" },
        { cond: "ROAS > 5", action: "Scale +30%" },
      ],
    },
  ];
  const folders: Folder[] = folderTpl.map((f) => {
    const cn = 3 + Math.floor(rng() * 5);
    const status = rng() > 0.25 ? "Healthy" : "Needs Review";
    const recent: RecentAction[] = [
      { type: "scale", what: `${sector} retargeting +20%`, when: "2h ago" },
      {
        type: "pause",
        what: `Underperforming ${sector} ad set`,
        when: "5h ago",
      },
      { type: "refresh", what: "Creative refreshed: 4 new variants", when: "8h ago" },
    ].slice(0, 2 + Math.floor(rng() * 2));
    return {
      ...f,
      campaigns: Array.from({ length: cn }).map((_, j) => ({
        name: `${f.name} #${j + 1}`,
      })),
      spend: (800 + Math.floor(rng() * 4200)).toLocaleString(),
      status,
      recent,
    };
  });
  return {
    folders,
    savings: Math.floor(2400 + rng() * 5800),
    actions: Math.floor(28 + rng() * 52),
    uplift: 12 + Math.floor(rng() * 28),
  };
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#64748B",
  letterSpacing: ".05em",
  marginBottom: 6,
};

function OptModal({
  title,
  accent,
  onClose,
  children,
}: {
  title: string;
  accent: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: 20,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 14,
          maxWidth: 640,
          width: "100%",
          maxHeight: "88vh",
          overflowY: "auto",
          boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #E2E8F0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: `linear-gradient(135deg,${accent}10,${accent}05)`,
          }}
        >
          <h3 style={{ margin: 0, color: "#0F172A", fontSize: 17 }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              color: "#94A3B8",
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: "18px 20px" }}>{children}</div>
      </div>
    </div>
  );
}

export default function OptFolders() {
  const router = useRouter();
  const [data, setData] = useState<OptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const hasDomain = typeof window !== "undefined" ? !!lsDomain() : true;

  function runOptFolders() {
    if (!lsDomain()) {
      showToast("⚠️ Run an analysis on the home page first");
      goToView(router, "home");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setData(buildData());
      setLoading(false);
      showToast("✅ 4 folders built — auto-optimisation live");
    }, 1300);
  }

  function applyOptAction(folderIdx: number, ruleIdx: number) {
    setData((d) => {
      if (!d || !d.folders[folderIdx]) return d;
      const folders = d.folders.map((f) => ({ ...f }));
      const f = folders[folderIdx];
      const r = f.rules[ruleIdx];
      f.recent = [
        { type: TYPE_MAP[r.action] || "refresh", what: `${r.action} applied (manual)`, when: "just now" },
        ...f.recent,
      ].slice(0, 4);
      const next = { ...d, folders, actions: (d.actions || 0) + 1 };
      showToast(`✅ ${r.action} applied to ${f.name}`);
      return next;
    });
    setModal(null);
  }

  function confirmOptPause(folderIdx: number) {
    setData((d) => {
      if (!d || !d.folders[folderIdx]) return d;
      const folders = d.folders.map((f) => ({ ...f }));
      const f = folders[folderIdx];
      f.status = f.status === "Healthy" ? "Needs Review" : "Healthy";
      f.recent = [
        { type: "pause", what: "Auto-optimisation paused by you", when: "just now" },
        ...f.recent,
      ].slice(0, 4);
      showToast(`⏸ Auto-optimisation paused for ${f.name}`);
      return { ...d, folders };
    });
    setModal(null);
  }

  function confirmOptForceRun(folderIdx: number) {
    setModal(null);
    setTimeout(() => {
      setData((d) => {
        if (!d || !d.folders[folderIdx]) return d;
        const folders = d.folders.map((f) => ({ ...f }));
        const f = folders[folderIdx];
        const rHash = (f.name || "")
          .split("")
          .reduce((a, c) => a + c.charCodeAt(0), 0);
        const fired = f.rules.filter((_, ri) => (rHash + ri * 31) % 10 > 4);
        f.recent = [
          ...fired.map((r) => ({
            type: TYPE_MAP[r.action] || "refresh",
            what: `${r.action} (force run)`,
            when: "just now",
          })),
          ...f.recent,
        ].slice(0, 4);
        f.status = "Healthy";
        showToast(
          `✅ Force run complete — ${fired.length} rule${fired.length === 1 ? "" : "s"} fired on ${f.name}`,
        );
        return { ...d, folders, actions: (d.actions || 0) + fired.length };
      });
    }, 1200);
  }

  function renderModalContent() {
    if (!modal || !data) return null;
    const f = data.folders[modal.folderIdx];
    if (!f) return null;

    if (modal.kind === "action") {
      const r = f.rules[modal.ruleIdx];
      const p =
        PLAYBOOK[r.action] || {
          icon: "⚙",
          color: "#64748B",
          what: "Custom rule action.",
          why: "Defined by your team.",
          how: ["Open the campaign in the platform", "Apply the change manually"],
          impact: "Varies by campaign.",
          safety: "Always reversible.",
        };
      return (
        <OptModal
          title={`${p.icon} ${r.action}`}
          accent={p.color}
          onClose={() => setModal(null)}
        >
          <div
            style={{
              background: `${p.color}15`,
              borderLeft: `3px solid ${p.color}`,
              padding: "10px 12px",
              borderRadius: 6,
              marginBottom: 14,
            }}
          >
            <div style={labelStyle}>TRIGGER</div>
            <div style={{ fontSize: 14, color: "#1E293B" }}>
              <strong>{f.name}</strong> folder, when <strong>{r.cond}</strong>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>WHAT IT DOES</div>
            <div style={{ fontSize: 13, color: "#1E293B", lineHeight: 1.55 }}>
              {p.what}
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>WHY THIS WORKS</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.55 }}>
              {p.why}
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>HOW TO DO IT (STEP BY STEP)</div>
            <ol
              style={{
                margin: 0,
                paddingLeft: 20,
                fontSize: 13,
                color: "#1E293B",
                lineHeight: 1.7,
              }}
            >
              {p.how.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                borderRadius: 8,
                padding: 10,
              }}
            >
              <div style={{ ...labelStyle, color: "#065F46", fontSize: 10, marginBottom: 4 }}>
                EXPECTED IMPACT
              </div>
              <div style={{ fontSize: 12, color: "#064E3B", lineHeight: 1.5 }}>
                {p.impact}
              </div>
            </div>
            <div
              style={{
                background: "#EFF6FF",
                border: "1px solid #BFDBFE",
                borderRadius: 8,
                padding: 10,
              }}
            >
              <div style={{ ...labelStyle, color: "#1E40AF", fontSize: 10, marginBottom: 4 }}>
                SAFETY GUARDRAIL
              </div>
              <div style={{ fontSize: 12, color: "#1E3A8A", lineHeight: 1.5 }}>
                {p.safety}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setModal(null)} style={modalCancelBtn}>
              Close
            </button>
            <button
              onClick={() => applyOptAction(modal.folderIdx, modal.ruleIdx)}
              style={{
                padding: "9px 16px",
                background: p.color,
                color: "white",
                border: "none",
                borderRadius: 7,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Apply now
            </button>
          </div>
        </OptModal>
      );
    }

    if (modal.kind === "edit") {
      return (
        <OptModal
          title={`⚙ Edit Rules — ${f.name}`}
          accent="#1E40AF"
          onClose={() => setModal(null)}
        >
          <p style={{ margin: "0 0 14px", color: "#64748B", fontSize: 13 }}>
            These rules run automatically every hour. Click any action to learn
            what it does. Toggle a rule off to disable it without deleting.
          </p>
          {f.rules.map((r, ri) => (
            <div
              key={ri}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 10,
                background: "#F8FAFC",
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                marginBottom: 8,
              }}
            >
              <input
                type="checkbox"
                defaultChecked
                onChange={(e) =>
                  showToast(e.target.checked ? "✓ Rule enabled" : "⏸ Rule disabled")
                }
                style={{ width: 18, height: 18, cursor: "pointer" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "#1E293B" }}>
                  <strong>If</strong> {r.cond}
                </div>
                <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                  <strong>Then</strong> {r.action}
                </div>
              </div>
              <button
                onClick={() =>
                  setModal({ kind: "action", folderIdx: modal.folderIdx, ruleIdx: ri })
                }
                style={{
                  padding: "6px 12px",
                  background: "#EFF6FF",
                  color: "#1E40AF",
                  border: "1px solid #BFDBFE",
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                View details
              </button>
            </div>
          ))}
          <div
            style={{
              background: "#FFFBEB",
              border: "1px solid #FCD34D",
              borderRadius: 8,
              padding: 10,
              marginTop: 14,
              fontSize: 12,
              color: "#92400E",
            }}
          >
            <strong>Tip:</strong> Adding more than 4 rules per folder can cause
            conflicts. Keep rules narrow and let folder boundaries (not rule
            complexity) do the segmentation work.
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 16,
            }}
          >
            <button onClick={() => setModal(null)} style={modalCancelBtn}>
              Cancel
            </button>
            <button
              onClick={() => {
                setModal(null);
                showToast(`✅ Rules saved for ${f.name}`);
              }}
              style={{
                padding: "9px 16px",
                background: "#1E40AF",
                color: "white",
                border: "none",
                borderRadius: 7,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Save changes
            </button>
          </div>
        </OptModal>
      );
    }

    if (modal.kind === "pause") {
      return (
        <OptModal
          title={`⏸ Pause Auto-Optimisation — ${f.name}`}
          accent="#F59E0B"
          onClose={() => setModal(null)}
        >
          <div
            style={{
              background: "#FFFBEB",
              borderLeft: "3px solid #F59E0B",
              padding: "10px 12px",
              borderRadius: 6,
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 13, color: "#78350F" }}>
              <strong>What this does:</strong> Stops InfoGenie from running any
              automatic actions on the <strong>{f.name}</strong> folder. Existing
              campaigns keep running — only the auto-rules are paused.
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>WHEN TO USE</div>
            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                fontSize: 13,
                color: "#1E293B",
                lineHeight: 1.7,
              }}
            >
              <li>
                You&apos;re running a manual experiment and don&apos;t want
                auto-rules interfering.
              </li>
              <li>
                You suspect a tracking issue — pause auto-rules until your
                pixel/CAPI is verified.
              </li>
              <li>
                It&apos;s launch week and you want a human in the loop for every
                change.
              </li>
            </ul>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>WHAT WILL HAPPEN</div>
            <ol
              style={{
                margin: 0,
                paddingLeft: 20,
                fontSize: 13,
                color: "#1E293B",
                lineHeight: 1.7,
              }}
            >
              <li>The hourly optimisation loop skips this folder.</li>
              <li>Recent actions feed continues to log manual changes.</li>
              <li>
                You&apos;ll get a daily digest of what <em>would</em> have been
                auto-actioned, so you can catch up later.
              </li>
              <li>Re-enable any time — auto-rules resume on the next hourly tick.</li>
            </ol>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setModal(null)} style={modalCancelBtn}>
              Cancel
            </button>
            <button
              onClick={() => confirmOptPause(modal.folderIdx)}
              style={{
                padding: "9px 16px",
                background: "#F59E0B",
                color: "white",
                border: "none",
                borderRadius: 7,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Pause auto-optimisation
            </button>
          </div>
        </OptModal>
      );
    }

    // force
    return (
      <OptModal
        title={`▶ Force Run — ${f.name}`}
        accent="#10B981"
        onClose={() => setModal(null)}
      >
        <div
          style={{
            background: "#F0FDF4",
            borderLeft: "3px solid #10B981",
            padding: "10px 12px",
            borderRadius: 6,
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "#065F46" }}>
            <strong>What this does:</strong> Runs every rule on the{" "}
            <strong>{f.name}</strong> folder right now, ignoring the hourly
            schedule.
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>WHAT WILL BE EVALUATED</div>
          <ol
            style={{
              margin: 0,
              paddingLeft: 20,
              fontSize: 13,
              color: "#1E293B",
              lineHeight: 1.7,
            }}
          >
            {f.rules.map((r, i) => (
              <li key={i}>
                <strong>{r.cond}</strong> → may trigger <em>{r.action}</em>
              </li>
            ))}
          </ol>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>WHAT WILL HAPPEN</div>
          <ol
            style={{
              margin: 0,
              paddingLeft: 20,
              fontSize: 13,
              color: "#1E293B",
              lineHeight: 1.7,
            }}
          >
            <li>
              InfoGenie pulls the latest 24h metrics for all {f.campaigns.length}{" "}
              campaigns in this folder.
            </li>
            <li>Each rule&apos;s condition is evaluated against the live data.</li>
            <li>
              Matching rules fire their action immediately (scale, refresh,
              pause, etc.).
            </li>
            <li>Every action is logged to the Recent Actions feed and the audit log.</li>
            <li>You&apos;ll see a summary toast with the count of actions taken.</li>
          </ol>
        </div>
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 8,
            padding: 10,
            marginBottom: 14,
            fontSize: 12,
            color: "#991B1B",
          }}
        >
          <strong>⚠ Important:</strong> Force Run can apply multiple changes in
          one go. Use it after a creative refresh or budget reset, not during a
          stable hour.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={() => setModal(null)} style={modalCancelBtn}>
            Cancel
          </button>
          <button
            onClick={() => confirmOptForceRun(modal.folderIdx)}
            style={{
              padding: "9px 16px",
              background: "#10B981",
              color: "white",
              border: "none",
              borderRadius: 7,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Run all rules now
          </button>
        </div>
      </OptModal>
    );
  }

  return (
    <div className="view-header-wrap">
      <div
        className="view-header ig-panel-hero"
        style={{
          background:
            "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: '#475569' }}>
                <span className="bc-group" style={{ color: "rgba(191,219,254,.8)" }}>
                  Reach
                </span>{" "}
                <span className="bc-sep" style={{ color: '#94a3b8' }}>
                  ›
                </span>{" "}
                Optimization Folders
              </div>
              <h2 className="view-title">📁 Optimization Folders</h2>
              <p className="view-sub">
                Group campaigns into auto-optimising folders — set rules (pause
                if CPA &gt; X, scale if ROAS &gt; Y) and InfoGenie runs the loop
                hourly.
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                style={{ background: "white", color: "#1E40AF" }}
                onClick={runOptFolders}
              >
                📁 Build Folders
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 40 }}
      >
        {!hasDomain ? (
          <div
            style={{
              background: "white",
              border: "2px dashed #CBD5E1",
              borderRadius: 12,
              padding: 48,
              textAlign: "center",
              marginTop: 20,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔎</div>
            <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>
              Run an analysis first
            </h3>
            <p
              style={{
                margin: "0 0 18px",
                color: "#64748B",
                maxWidth: 480,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              Optimization Folders needs your competitor &amp; sector data. Head
              to the home page, enter your website (or pick a sector), and
              we&apos;ll have everything ready in under a minute.
            </p>
            <button
              className="btn-primary"
              onClick={() => goToView(router, "home")}
              style={{
                background: "linear-gradient(135deg,#0066FF,#00D8D7)",
                color: "white",
                border: "none",
                padding: "10px 22px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ↗ Go to Home — Run Analysis
            </button>
          </div>
        ) : !data ? (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              border: "1px solid #E2E8F0",
            }}
          >
            <div style={{ fontSize: 42, marginBottom: 12 }}>📁</div>
            <h3 style={{ margin: "0 0 8px", color: "#1E293B" }}>
              Auto-optimise campaigns by folder
            </h3>
            <p
              style={{
                margin: "0 0 18px",
                color: "#64748B",
                maxWidth: 520,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              Group campaigns into folders, set rules (e.g. <em>pause if CPA &gt;
              $40</em>), and InfoGenie runs the loop hourly.
            </p>
            <button
              className="btn-primary"
              onClick={runOptFolders}
              disabled={loading}
              style={{
                background: "linear-gradient(135deg,#0f766e,#0284c7)",
                color: "white",
                border: "none",
                padding: "11px 24px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {loading ? "⏳ Building…" : "📁 Build Folders"}
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 12,
                marginBottom: 18,
              }}
            >
              {(
                [
                  ["Total saved last 30d", `$${data.savings.toLocaleString()}`, "#10B981"],
                  ["Auto-actions taken", String(data.actions), "#0EA5E9"],
                  ["ROAS uplift", "+" + data.uplift + "%", "#F59E0B"],
                ] as [string, string, string][]
              ).map((s) => (
                <div
                  key={s[0]}
                  style={{
                    background: "white",
                    borderRadius: 10,
                    padding: 14,
                    border: "1px solid #E2E8F0",
                    borderLeft: `3px solid ${s[2]}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#64748B",
                      fontWeight: 700,
                      letterSpacing: ".05em",
                    }}
                  >
                    {s[0]}
                  </div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 800,
                      color: "#1E293B",
                      marginTop: 4,
                    }}
                  >
                    {s[1]}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
              }}
            >
              {data.folders.map((f, i) => (
                <div
                  key={i}
                  style={{
                    background: "white",
                    borderRadius: 12,
                    padding: 16,
                    border: "1px solid #E2E8F0",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          background: f.color + "20",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 18,
                        }}
                      >
                        {f.icon}
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, color: "#1E293B" }}>
                          {f.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748B" }}>
                          {f.campaigns.length} campaigns • ${f.spend} budget
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "3px 9px",
                        background: f.status === "Healthy" ? "#F0FDF4" : "#FEF3C7",
                        color: f.status === "Healthy" ? "#065F46" : "#92400E",
                        borderRadius: 99,
                      }}
                    >
                      {f.status === "Healthy" ? "✓" : "⚠"} {f.status}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "#F8FAFC",
                      borderRadius: 8,
                      padding: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#64748B",
                        letterSpacing: ".05em",
                        marginBottom: 6,
                      }}
                    >
                      RULES — click any action for details
                    </div>
                    {f.rules.map((r, ri) => {
                      const isPause = r.action.startsWith("Pause");
                      const isScale = r.action.startsWith("Scale");
                      return (
                        <div
                          key={ri}
                          style={{
                            fontSize: 12,
                            color: "#1E293B",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "4px 0",
                          }}
                        >
                          <span>{r.cond}</span>
                          <button
                            onClick={() =>
                              setModal({ kind: "action", folderIdx: i, ruleIdx: ri })
                            }
                            title="Click to see what this does and how"
                            style={{
                              background: isPause
                                ? "#FEE2E2"
                                : isScale
                                  ? "#DCFCE7"
                                  : "#DBEAFE",
                              color: isPause
                                ? "#991B1B"
                                : isScale
                                  ? "#065F46"
                                  : "#1E40AF",
                              border: `1px solid ${isPause ? "#FCA5A5" : isScale ? "#86EFAC" : "#93C5FD"}`,
                              fontWeight: 700,
                              padding: "4px 10px",
                              borderRadius: 6,
                              cursor: "pointer",
                              fontSize: 11,
                            }}
                          >
                            → {r.action} ⓘ
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748B",
                      letterSpacing: ".05em",
                      marginBottom: 6,
                    }}
                  >
                    RECENT ACTIONS
                  </div>
                  {f.recent.map((r, ri) => (
                    <div
                      key={ri}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "6px 0",
                        fontSize: 12,
                        borderBottom: "1px dashed #F1F5F9",
                      }}
                    >
                      <div>
                        <span
                          style={{
                            color:
                              r.type === "pause"
                                ? "#EF4444"
                                : r.type === "scale"
                                  ? "#10B981"
                                  : "#0EA5E9",
                            fontWeight: 700,
                          }}
                        >
                          {r.type === "pause" ? "⏸" : r.type === "scale" ? "⬆" : "🔁"}
                        </span>{" "}
                        <span style={{ color: "#1E293B" }}>{r.what}</span>
                      </div>
                      <div style={{ color: "#94A3B8" }}>{r.when}</div>
                    </div>
                  ))}
                  <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                    <button
                      onClick={() => setModal({ kind: "edit", folderIdx: i })}
                      title="View & modify the rules for this folder"
                      style={{
                        flex: 1,
                        padding: 7,
                        background: "#F1F5F9",
                        border: "1px solid #E2E8F0",
                        color: "#1E293B",
                        borderRadius: 6,
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      ⚙ Edit Rules
                    </button>
                    <button
                      onClick={() =>
                        setModal({
                          kind: f.status === "Healthy" ? "pause" : "force",
                          folderIdx: i,
                        })
                      }
                      title={
                        f.status === "Healthy"
                          ? "Stop auto-optimisation for this folder"
                          : "Run all rules immediately, ignoring the hourly schedule"
                      }
                      style={{
                        flex: 1,
                        padding: 7,
                        background: "#1E40AF",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {f.status === "Healthy" ? "⏸ Pause Auto" : "▶ Force Run"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {renderModalContent()}
    </div>
  );
}

const modalCancelBtn: React.CSSProperties = {
  padding: "9px 16px",
  background: "#F1F5F9",
  border: "1px solid #E2E8F0",
  color: "#475569",
  borderRadius: 7,
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
