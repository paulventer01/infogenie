"use client";

/**
 * Growth Goals Loop — six-stage compounding cycle.
 * Framed around setting marketing goals that drive Research → Report.
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";

type StageId =
  | "research"
  | "gaps"
  | "opportunities"
  | "execute"
  | "evaluate"
  | "report";

interface StageMeta {
  label: string;
  verb: string;
  desc: string;
  accent: string;
  soft: string;
}

const STAGE_META: Record<StageId, StageMeta> = {
  research: {
    label: "Research",
    verb: "Discover",
    desc: "Map competitors and market signals your goals depend on.",
    accent: "#0f766e",
    soft: "rgba(15, 118, 110, 0.1)",
  },
  gaps: {
    label: "Gaps",
    verb: "Diagnose",
    desc: "Find content and SEO shortfalls holding growth back.",
    accent: "#b45309",
    soft: "rgba(180, 83, 9, 0.1)",
  },
  opportunities: {
    label: "Opportunities",
    verb: "Prioritize",
    desc: "Pick the highest-leverage keywords and moves.",
    accent: "#047857",
    soft: "rgba(4, 120, 87, 0.1)",
  },
  execute: {
    label: "Execute",
    verb: "Ship",
    desc: "Launch campaigns and content against the goal.",
    accent: "#0369a1",
    soft: "rgba(3, 105, 161, 0.1)",
  },
  evaluate: {
    label: "Evaluate",
    verb: "Measure",
    desc: "See what moved the needle — double down or cut.",
    accent: "#0e7490",
    soft: "rgba(14, 116, 144, 0.1)",
  },
  report: {
    label: "Report",
    verb: "Close the loop",
    desc: "Share outcomes and feed learnings into the next goal.",
    accent: "#be123c",
    soft: "rgba(190, 18, 60, 0.08)",
  },
};

interface StageData {
  count: number;
  label: string;
  lastAction?: string | null;
  view: string;
  tools: { label: string; view: string }[];
}

interface FlywheelData {
  stages: Record<StageId, StageData>;
  order: StageId[];
  nextAction: { stage: StageId; message: string; view: string };
}

const IG = {
  ink: "#0b1220",
  muted: "#5b6577",
  border: "rgba(11, 18, 32, 0.1)",
  surface: "#ffffff",
  stage: "#f3f6fb",
  teal: "#0f766e",
  soft: "rgba(15, 118, 110, 0.12)",
  shadow: "0 1px 0 rgba(11, 18, 32, 0.04), 0 18px 40px rgba(11, 18, 32, 0.07)",
};

function cleanLabel(label: string) {
  return String(label || "").replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\s]+/u, "").trim() || label;
}

const CSS = `
@keyframes igFwIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes igFwPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(15, 118, 110, 0.35); }
  50% { box-shadow: 0 0 0 8px rgba(15, 118, 110, 0); }
}
.ig-fw { --ink:#0b1220; --muted:#5b6577; --border:rgba(11,18,32,.1); --teal:#0f766e; }
.ig-fw * { box-sizing: border-box; }
.ig-fw-shell {
  max-width: 1040px; margin: 0 auto; padding: 0 4px 48px;
  animation: igFwIn .45s ease both;
}
.ig-fw-atmosphere {
  position: relative;
  border-radius: 20px;
  padding: 28px 28px 24px;
  background:
    radial-gradient(1200px 420px at 8% -10%, rgba(15,118,110,.14), transparent 55%),
    radial-gradient(900px 380px at 100% 0%, rgba(2,132,199,.1), transparent 50%),
    linear-gradient(180deg, #f7fafc 0%, #ffffff 55%);
  border: 1px solid var(--border);
  box-shadow: ${IG.shadow};
  overflow: hidden;
}
.ig-fw-atmosphere::before {
  content: "";
  position: absolute; inset: 0;
  background-image: linear-gradient(rgba(11,18,32,.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(11,18,32,.03) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: linear-gradient(180deg, rgba(0,0,0,.45), transparent 70%);
  pointer-events: none;
}
.ig-fw-kicker {
  position: relative;
  display: inline-flex; align-items: center; gap: 8px;
  font-size: .68rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
  color: var(--teal); margin: 0 0 10px;
}
.ig-fw-title {
  position: relative;
  margin: 0 0 8px;
  font-size: clamp(1.55rem, 2.6vw, 2.05rem);
  font-weight: 800; letter-spacing: -.03em; color: var(--ink); line-height: 1.15;
}
.ig-fw-sub {
  position: relative;
  margin: 0; max-width: 540px;
  font-size: .95rem; line-height: 1.5; color: var(--muted);
}
.ig-fw-cta-row {
  position: relative;
  display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; align-items: center;
}
.ig-fw-btn {
  appearance: none; border: none; cursor: pointer; font-family: inherit;
  border-radius: 10px; padding: 11px 18px; font-size: .86rem; font-weight: 700;
  transition: transform .15s ease, opacity .15s ease, background .15s ease;
}
.ig-fw-btn:hover { transform: translateY(-1px); }
.ig-fw-btn-primary { background: var(--teal); color: #fff; }
.ig-fw-btn-primary:hover { opacity: .92; }
.ig-fw-btn-ghost {
  background: rgba(255,255,255,.8); color: var(--ink);
  border: 1px solid var(--border);
}
.ig-fw-metrics {
  position: relative;
  display: grid; grid-template-columns: repeat(3, minmax(0,1fr));
  gap: 10px; margin-top: 22px;
}
.ig-fw-metric {
  background: rgba(255,255,255,.78);
  border: 1px solid var(--border);
  border-radius: 12px; padding: 12px 14px;
}
.ig-fw-metric strong {
  display: block; font-size: 1.35rem; font-weight: 800; color: var(--ink);
  letter-spacing: -.02em; line-height: 1.1;
}
.ig-fw-metric span { font-size: .72rem; color: var(--muted); font-weight: 600; }
.ig-fw-loop {
  margin-top: 22px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 18px 16px 14px;
  box-shadow: 0 1px 0 rgba(11,18,32,.03);
}
.ig-fw-loop-head {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 12px; margin: 0 12px 14px; flex-wrap: wrap;
}
.ig-fw-loop-head h3 {
  margin: 0; font-size: .95rem; font-weight: 800; color: var(--ink); letter-spacing: -.01em;
}
.ig-fw-loop-head p { margin: 0; font-size: .78rem; color: var(--muted); }
.ig-fw-rail {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}
.ig-fw-step {
  position: relative;
  text-align: left;
  border: 1px solid var(--border);
  background: #fbfcfe;
  border-radius: 14px;
  padding: 14px 12px 12px;
  cursor: pointer;
  transition: border-color .18s ease, background .18s ease, transform .18s ease;
  min-height: 132px;
  animation: igFwIn .5s ease both;
}
.ig-fw-step:nth-child(1){animation-delay:.02s}
.ig-fw-step:nth-child(2){animation-delay:.06s}
.ig-fw-step:nth-child(3){animation-delay:.1s}
.ig-fw-step:nth-child(4){animation-delay:.14s}
.ig-fw-step:nth-child(5){animation-delay:.18s}
.ig-fw-step:nth-child(6){animation-delay:.22s}
.ig-fw-step:hover { transform: translateY(-2px); border-color: rgba(15,118,110,.35); }
.ig-fw-step.is-active {
  background: #fff;
  border-color: var(--step-accent, var(--teal));
  box-shadow: 0 0 0 1px var(--step-accent, var(--teal));
}
.ig-fw-step.is-next { animation: igFwPulse 2.2s ease-in-out infinite; }
.ig-fw-step-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 999px;
  font-size: .68rem; font-weight: 800; color: #fff;
  background: var(--step-accent, var(--teal));
  margin-bottom: 8px;
}
.ig-fw-step-verb {
  font-size: .65rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: var(--step-accent, var(--teal)); margin-bottom: 2px;
}
.ig-fw-step-label {
  font-size: .92rem; font-weight: 800; color: var(--ink); margin-bottom: 4px; letter-spacing: -.015em;
}
.ig-fw-step-desc {
  font-size: .72rem; line-height: 1.35; color: var(--muted); margin: 0 0 10px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.ig-fw-step-stat {
  font-size: .72rem; font-weight: 700; color: var(--ink);
  display: flex; align-items: baseline; gap: 4px;
}
.ig-fw-step-stat em { font-style: normal; color: var(--muted); font-weight: 600; }
.ig-fw-detail {
  margin-top: 14px;
  border-radius: 14px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  background: linear-gradient(135deg, rgba(15,118,110,.06), rgba(255,255,255,.9));
  display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; align-items: start;
  animation: igFwIn .35s ease both;
}
.ig-fw-detail h4 {
  margin: 0 0 6px; font-size: 1rem; font-weight: 800; color: var(--ink); letter-spacing: -.015em;
}
.ig-fw-detail p { margin: 0 0 12px; font-size: .86rem; color: var(--muted); line-height: 1.45; }
.ig-fw-tools { display: flex; flex-wrap: wrap; gap: 8px; }
.ig-fw-tool {
  appearance: none; cursor: pointer; font-family: inherit;
  border: 1px solid var(--border); background: #fff; color: var(--ink);
  border-radius: 8px; padding: 8px 12px; font-size: .78rem; font-weight: 700;
}
.ig-fw-tool:hover { border-color: var(--teal); color: var(--teal); }
.ig-fw-next-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  color: var(--teal); background: rgba(15,118,110,.1);
  border-radius: 999px; padding: 4px 10px; margin-bottom: 8px;
}
@media (max-width: 900px) {
  .ig-fw-rail { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .ig-fw-detail { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .ig-fw-atmosphere { padding: 20px 16px; }
  .ig-fw-metrics { grid-template-columns: 1fr; }
  .ig-fw-rail { grid-template-columns: 1fr 1fr; }
}
`;

export default function Flywheel() {
  const router = useRouter();
  const [data, setData] = useState<FlywheelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StageId | null>(null);

  const onNav = useCallback(
    (view: string) => goToView(router, view),
    [router],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiGet<
      Partial<FlywheelData> & { ok?: boolean; error?: string }
    >("/api/flywheel/summary");
    if (!res || !res.stages || !res.order || !res.nextAction) {
      setError(res?.error || "Failed to load growth loop");
      setLoading(false);
      return;
    }
    setData(res as FlywheelData);
    setSelected(res.nextAction.stage);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeId = selected || data?.nextAction.stage || "research";
  const activeMeta = STAGE_META[activeId];
  const activeData = data?.stages[activeId];

  const totalActivity = data
    ? data.order.reduce((s, id) => s + (data.stages[id]?.count || 0), 0)
    : 0;
  const activeStages = data
    ? data.order.filter((id) => (data.stages[id]?.count || 0) > 0).length
    : 0;
  const progressPct = Math.round((activeStages / 6) * 100);

  return (
    <div className="ig-fw view-header-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> Growth Goals Loop
              </div>
              <h2 className="view-title">Growth Goals Loop</h2>
              <p className="view-sub">
                Set the outcome you want — then run the six-stage loop that compounds it.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 20, paddingBottom: 56 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 64, color: IG.muted }}>
            Loading your growth loop…
          </div>
        ) : error || !data ? (
          <div style={{ textAlign: "center", padding: 40, color: "#b91c1c" }}>
            {error || "Could not load growth loop"}
          </div>
        ) : (
          <div className="ig-fw-shell">
            <section className="ig-fw-atmosphere">
              <div className="ig-fw-kicker">
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: IG.teal,
                    display: "inline-block",
                  }}
                />
                Marketing goals · compounding loop
              </div>
              <h3 className="ig-fw-title">
                Set a goal. Let the loop do the work.
              </h3>
              <p className="ig-fw-sub">
                Research, find gaps, prioritize opportunities, execute, measure, and report —
                then feed results into your next marketing goal.
              </p>
              <div className="ig-fw-cta-row">
                <button
                  type="button"
                  className="ig-fw-btn ig-fw-btn-primary"
                  onClick={() => onNav("agent-goals")}
                >
                  Set a marketing goal
                </button>
                <button
                  type="button"
                  className="ig-fw-btn ig-fw-btn-ghost"
                  onClick={() => onNav(data.nextAction.view)}
                >
                  Continue: {STAGE_META[data.nextAction.stage].label}
                </button>
              </div>

              <div className="ig-fw-metrics">
                <div className="ig-fw-metric">
                  <strong>{activeStages}/6</strong>
                  <span>Stages with activity</span>
                </div>
                <div className="ig-fw-metric">
                  <strong>{totalActivity}</strong>
                  <span>Actions tracked</span>
                </div>
                <div className="ig-fw-metric">
                  <strong>{progressPct}%</strong>
                  <span>Loop coverage</span>
                </div>
              </div>

              <div className="ig-fw-loop">
                <div className="ig-fw-loop-head">
                  <h3>Six stages that turn goals into growth</h3>
                  <p>Select a stage to see tools and your next move</p>
                </div>
                <div className="ig-fw-rail" role="list">
                  {data.order.map((id, i) => {
                    const m = STAGE_META[id];
                    const st = data.stages[id];
                    const isNext = data.nextAction.stage === id;
                    const isActive = activeId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="listitem"
                        className={`ig-fw-step${isActive ? " is-active" : ""}${isNext ? " is-next" : ""}`}
                        style={{ "--step-accent": m.accent } as CSSProperties}
                        onClick={() => setSelected(id)}
                      >
                        <div className="ig-fw-step-num">{i + 1}</div>
                        <div className="ig-fw-step-verb">{m.verb}</div>
                        <div className="ig-fw-step-label">{m.label}</div>
                        <p className="ig-fw-step-desc">{m.desc}</p>
                        <div className="ig-fw-step-stat">
                          {st.count} <em>{st.label}</em>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {activeData && (
                  <div
                    className="ig-fw-detail"
                    style={{ borderColor: `${activeMeta.accent}33`, background: `linear-gradient(135deg, ${activeMeta.soft}, #fff)` }}
                  >
                    <div>
                      {data.nextAction.stage === activeId && (
                        <div className="ig-fw-next-badge">Recommended next</div>
                      )}
                      <h4>
                        {activeMeta.label} — {activeMeta.verb}
                      </h4>
                      <p>
                        {data.nextAction.stage === activeId
                          ? data.nextAction.message
                          : activeMeta.desc}
                      </p>
                      <button
                        type="button"
                        className="ig-fw-btn ig-fw-btn-primary"
                        style={{ background: activeMeta.accent }}
                        onClick={() => onNav(activeData.view)}
                      >
                        Open {activeMeta.label}
                      </button>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: "0.68rem",
                          fontWeight: 800,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: IG.muted,
                          marginBottom: 8,
                        }}
                      >
                        Tools for this stage
                      </div>
                      <div className="ig-fw-tools">
                        {(activeData.tools || []).map((t) => (
                          <button
                            key={t.view}
                            type="button"
                            className="ig-fw-tool"
                            onClick={() => onNav(t.view)}
                          >
                            {cleanLabel(t.label)}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="ig-fw-tool"
                          onClick={() => onNav("agent-goals")}
                        >
                          Marketing Goals
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{
                  position: "relative",
                  marginTop: 14,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="ig-fw-btn ig-fw-btn-ghost"
                  onClick={() => load()}
                  style={{ padding: "8px 14px", fontSize: "0.78rem" }}
                >
                  Refresh activity
                </button>
                <span style={{ fontSize: "0.75rem", color: IG.muted }}>
                  Tip: start with a clear goal, then work the weakest stage.
                </span>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
