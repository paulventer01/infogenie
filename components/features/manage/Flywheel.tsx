"use client";

// Native React port of the legacy `flywheel` panel (was
// `public/js/ig_growth_flywheel.js` + `#view-flywheel` in index.html). Renders
// the 6-stage Performance Growth Flywheel, reads its live activity counts from
// the existing Express API (`GET /api/flywheel/summary`) via `lib/api`, and
// jumps to other dashboard tools through `lib/nav` (legacy navigateTo + Next
// router). The CSS is mounted verbatim from the legacy module via a <style> tag
// so the visual output is byte-for-byte the same.

import { useCallback, useEffect, useState } from "react";
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
  icon: string;
  label: string;
  color: string;
  desc: string;
}

const STAGE_META: Record<StageId, StageMeta> = {
  research: { icon: "🔍", label: "Research", color: "#6366f1", desc: "Know your market & competitors" },
  gaps: { icon: "📊", label: "Gaps", color: "#f59e0b", desc: "Spot what you're missing" },
  opportunities: { icon: "💡", label: "Opportunities", color: "#10b981", desc: "Find the highest-leverage moves" },
  execute: { icon: "🚀", label: "Execute", color: "#3b82f6", desc: "Launch campaigns & content" },
  evaluate: { icon: "📈", label: "Evaluate", color: "#8b5cf6", desc: "Measure what's working" },
  report: { icon: "📬", label: "Report", color: "#ec4899", desc: "Share results, feed back in" },
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

const FW_CSS = `
.fw-wrap { max-width:960px; margin:0 auto; padding:0 16px 40px; }
.fw-hero { text-align:center; margin-bottom:32px; }
.fw-hero h3 { font-size:1.5rem; font-weight:700; margin:0 0 6px; }
.fw-hero p { color:var(--text-muted,#6b7280); margin:0; }
.fw-stats-row { display:flex; gap:16px; justify-content:center; flex-wrap:wrap; margin-bottom:32px; }
.fw-stat-pill { background:var(--card-bg,#fff); border:1px solid var(--border,#e5e7eb); border-radius:12px; padding:12px 24px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,.06); }
.fw-stat-pill .sp-val { font-size:1.6rem; font-weight:800; color:var(--text,#111); }
.fw-stat-pill .sp-lbl { font-size:.75rem; color:var(--text-muted,#6b7280); margin-top:2px; }
.fw-ring { display:flex; flex-direction:column; gap:0; align-items:center; margin-bottom:28px; }
.fw-row { display:flex; align-items:center; gap:0; flex-wrap:wrap; justify-content:center; }
.fw-arrow-h { font-size:1.4rem; color:var(--text-muted,#9ca3af); padding:0 4px; flex-shrink:0; }
.fw-arrow-v { font-size:1.4rem; color:var(--text-muted,#9ca3af); align-self:flex-end; margin-right:10px; }
.fw-arrow-v-left { font-size:1.4rem; color:var(--text-muted,#9ca3af); align-self:flex-start; margin-left:10px; }
.fw-back-row { display:flex; width:100%; justify-content:space-between; align-items:center; padding:4px 24px; }
.fw-back-line { flex:1; border-top:2px dashed var(--border,#d1d5db); margin:0 8px; position:relative; }
.fw-back-line::after { content:''; position:absolute; left:0; top:-5px; border:5px solid transparent; border-right-color:var(--border,#d1d5db); }
.fw-stage { background:var(--card-bg,#fff); border:2px solid var(--stage-color); border-radius:16px; padding:16px 14px; width:220px; cursor:pointer; transition:transform .18s,box-shadow .18s; position:relative; text-align:center; }
.fw-stage:hover { transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,.12); }
.fw-stage-next { box-shadow:0 0 0 3px var(--stage-color); }
.fw-stage-icon { font-size:1.6rem; margin-bottom:4px; }
.fw-stage-name { font-weight:700; font-size:1rem; color:var(--stage-color); margin-bottom:2px; }
.fw-stage-desc { font-size:.72rem; color:var(--text-muted,#6b7280); margin-bottom:8px; min-height:28px; }
.fw-stage-stat { display:flex; align-items:center; justify-content:center; gap:6px; margin-bottom:8px; }
.fw-badge { background:var(--stage-color); color:#fff; border-radius:20px; padding:2px 10px; font-size:.8rem; font-weight:700; }
.fw-badge-zero { background:var(--border,#e5e7eb); color:var(--text-muted,#9ca3af); }
.fw-stat-label { font-size:.72rem; color:var(--text-muted,#6b7280); }
.fw-stage-tools { display:flex; flex-direction:column; gap:4px; }
.fw-tool-btn { background:transparent; border:1px solid var(--stage-color); color:var(--stage-color); border-radius:6px; padding:4px 8px; font-size:.72rem; cursor:pointer; transition:background .15s; text-align:left; }
.fw-tool-btn:hover { background:var(--stage-color); color:#fff; }
.fw-next-flag { position:absolute; top:-11px; left:50%; transform:translateX(-50%); background:var(--stage-color); color:#fff; font-size:.65rem; font-weight:700; border-radius:8px; padding:2px 8px; white-space:nowrap; }
.fw-next-card { background:var(--card-bg,#fff); border:2px solid var(--primary,#4f46e5); border-radius:16px; padding:20px 24px; max-width:600px; margin:0 auto 24px; display:flex; align-items:flex-start; gap:16px; box-shadow:0 4px 16px rgba(79,70,229,.12); }
.fw-next-card .fn-icon { font-size:2rem; flex-shrink:0; }
.fw-next-card .fn-title { font-weight:700; font-size:1rem; margin-bottom:4px; }
.fw-next-card .fn-msg { font-size:.85rem; color:var(--text-muted,#6b7280); margin-bottom:12px; }
.fw-next-card .fn-btn { background:var(--primary,#4f46e5); color:#fff; border:none; border-radius:8px; padding:8px 18px; font-size:.85rem; font-weight:600; cursor:pointer; }
.fw-next-card .fn-btn:hover { opacity:.88; }
.fw-refresh-btn { display:block; margin:0 auto; background:transparent; border:1px solid var(--border,#e5e7eb); color:var(--text-muted,#6b7280); border-radius:8px; padding:7px 18px; font-size:.8rem; cursor:pointer; }
.fw-refresh-btn:hover { border-color:var(--primary,#4f46e5); color:var(--primary,#4f46e5); }
@media(max-width:700px){
  .fw-stage{width:calc(50vw - 40px); padding:12px 8px;}
  .fw-arrow-h{font-size:1rem;}
  .fw-tool-btn{font-size:.65rem;}
}
@media(max-width:480px){
  .fw-stage{width:calc(100vw - 48px); margin:4px 0;}
  .fw-row{flex-direction:column;}
  .fw-arrow-h{transform:rotate(90deg);}
  .fw-back-row{display:none;}
}
`;

function Badge({ count }: { count: number }) {
  if (!count) return <span className="fw-badge fw-badge-zero">0</span>;
  return <span className="fw-badge">{count}</span>;
}

function StageCard({
  id,
  data,
  isNext,
  onNav,
}: {
  id: StageId;
  data: StageData;
  isNext: boolean;
  onNav: (view: string) => void;
}) {
  const m = STAGE_META[id];
  return (
    <div
      className={`fw-stage${isNext ? " fw-stage-next" : ""}`}
      data-stage={id}
      style={{ "--stage-color": m.color } as React.CSSProperties}
      onClick={() => onNav(data.view)}
    >
      <div className="fw-stage-icon">{m.icon}</div>
      <div className="fw-stage-name">{m.label}</div>
      <div className="fw-stage-desc">{m.desc}</div>
      <div className="fw-stage-stat">
        <Badge count={data.count} />{" "}
        <span className="fw-stat-label">{data.label}</span>
      </div>
      <div className="fw-stage-tools">
        {(data.tools || []).map((t) => (
          <button
            key={t.view}
            className="fw-tool-btn"
            onClick={(e) => {
              e.stopPropagation();
              onNav(t.view);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isNext && <div className="fw-next-flag">⚡ Next action</div>}
    </div>
  );
}

export default function Flywheel() {
  const router = useRouter();
  const [data, setData] = useState<FlywheelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setError(res?.error || "Failed to load flywheel");
      setLoading(false);
      return;
    }
    setData(res as FlywheelData);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const render = () => {
    if (loading) {
      return (
        <div
          style={{
            textAlign: "center",
            padding: "60px 0",
            color: "var(--text-muted,#6b7280)",
          }}
        >
          ⚙️ Loading flywheel…
        </div>
      );
    }
    if (error || !data) {
      return (
        <div style={{ textAlign: "center", padding: 40, color: "#ef4444" }}>
          Failed to load flywheel: {error}
        </div>
      );
    }

    const { stages, order, nextAction } = data;
    const top = order.slice(0, 3);
    const bot = order.slice(3).reverse();
    const totalActivity = order.reduce((s, id) => s + stages[id].count, 0);
    const activeStages = order.filter((id) => stages[id].count > 0).length;
    const nextMeta = STAGE_META[nextAction.stage];

    const rowCards = (ids: StageId[]) =>
      ids.map((id, i) => (
        <span key={id} style={{ display: "contents" }}>
          <StageCard
            id={id}
            data={stages[id]}
            isNext={nextAction.stage === id}
            onNav={onNav}
          />
          {i < ids.length - 1 && <div className="fw-arrow-h">→</div>}
        </span>
      ));

    return (
      <div className="fw-wrap">
        <div className="fw-hero">
          <h3>⚙️ Performance Growth Flywheel</h3>
          <p>
            InfoGenie runs this loop autonomously — the more stages active, the
            faster you grow.
          </p>
        </div>
        <div className="fw-stats-row">
          <div className="fw-stat-pill">
            <div className="sp-val">
              {activeStages}
              <span style={{ fontSize: "1rem", fontWeight: 400 }}>/6</span>
            </div>
            <div className="sp-lbl">Stages active</div>
          </div>
          <div className="fw-stat-pill">
            <div className="sp-val">{totalActivity}</div>
            <div className="sp-lbl">Total actions tracked</div>
          </div>
        </div>
        <div className="fw-ring">
          <div className="fw-row">{rowCards(top)}</div>
          <div className="fw-back-row">
            <span style={{ fontSize: ".75rem", color: "var(--text-muted,#9ca3af)" }}>
              ↑ feeds back in
            </span>
            <div className="fw-back-line" />
            <span style={{ fontSize: ".75rem", color: "var(--text-muted,#9ca3af)" }}>
              cycle continues ↓
            </span>
          </div>
          <div className="fw-row">{rowCards(bot)}</div>
        </div>
        <div className="fw-next-card">
          <div className="fn-icon">{nextMeta.icon}</div>
          <div>
            <div className="fn-title">Next best action — {nextMeta.label}</div>
            <div className="fn-msg">{nextAction.message}</div>
            <button className="fn-btn" onClick={() => onNav(nextAction.view)}>
              Go to {nextMeta.label} →
            </button>
          </div>
        </div>
        <button className="fw-refresh-btn" onClick={() => load()}>
          ↻ Refresh flywheel
        </button>
      </div>
    );
  };

  return (
    <div className="view-header-wrap">
      <style dangerouslySetInnerHTML={{ __html: FW_CSS }} />
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Performance Growth Flywheel
              </div>
              <h2 className="view-title">🌀 Performance Growth Flywheel</h2>
              <p className="view-sub">
                The six-stage loop InfoGenie runs autonomously — Research → Gaps →
                Opportunities → Execute → Evaluate → Report — and back again.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {render()}
      </div>
    </div>
  );
}
