"use client";

// Native React port of the legacy `audiences-dynamic` panel (was the
// `window.buildDynAudiences` family + the segment-builder / members / drip /
// HubSpot-list / re-engage modals in app.js, rendered into `#dynAudWrap` inside
// `#view-audiences-dynamic`). Faithfully reproduces the Phase-4 UI (Drip +
// HubSpot Static List + AI re-engage) against the existing Express API:
//   GET    /api/audiences
//   GET    /api/hubspot/status
//   GET    /api/audiences/:id
//   POST   /api/audiences            (create)
//   PUT    /api/audiences/:id        (update)
//   DELETE /api/audiences/:id
//   POST   /api/audiences/preview
//   POST   /api/audiences/:id/refresh
//   GET    /api/audiences/:id/members?limit=200
//   GET    /api/audiences/:id/log
//   GET/POST/DELETE /api/audiences/:id/drip-binding
//   GET/POST/DELETE /api/audiences/:id/hubspot-list
//   GET/POST/DELETE /api/audiences/:id/reengage
//   POST   /api/reengage/generate
//
// See docs/react-panel-migration.md for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface Condition {
  type: "property" | "event" | "commerce" | "engagement" | "ai_source";
  field?: string;
  op?: string;
  value?: string | number;
  event?: string;
  days?: number | string;
  metric?: string;
  source?: string;
}

interface Rules {
  match: string;
  conditions: Condition[];
}

interface Segment {
  id: number;
  name: string;
  description?: string;
  enabled?: boolean;
  member_count?: number;
  last_evaluated_at?: string | null;
  rules?: Rules;
}

interface AudiencesResult {
  ok: boolean;
  error?: string;
  segments?: Segment[];
}

interface HubspotStatus {
  ok: boolean;
  configured?: boolean;
}

interface DripStep {
  day: number;
  channel?: string;
  label?: string;
  subject?: string;
  msg?: string;
}

interface DripBinding {
  enabled?: boolean;
  dry_run?: boolean;
  auto_exit?: boolean;
  brand?: string | null;
  sequence?: DripStep[];
}

interface HsBinding {
  enabled?: boolean;
  list_id?: string | null;
  list_name?: string;
  auto_exit?: boolean;
  last_error?: string;
  last_sync_at?: string;
}

interface RengVariant {
  subject?: string;
  preheader?: string;
  body?: string;
  cta?: string;
  angle?: string;
  tone?: string;
}

interface RengBinding {
  enabled?: boolean;
  dry_run?: boolean;
  auto_exit?: boolean;
  brand?: string | null;
  variant?: RengVariant;
}

interface BindingSet {
  drip: DripBinding | null;
  hsList: HsBinding | null;
  reng: RengBinding | null;
}

interface Member {
  contact_email?: string;
  contact_id: string;
  joined_at: string;
}

interface LogRow {
  ran_at: string;
  members_added?: number;
  members_removed?: number;
  error?: string;
}

/* ── Shared inline-style helpers ────────────────────────────────────────── */

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(10,22,40,.55)",
  zIndex: 10010,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "32px 16px",
  overflowY: "auto",
  backdropFilter: "blur(4px)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: "1.4rem",
  cursor: "pointer",
  color: "#6B7280",
  padding: "4px 10px",
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 18px",
  background: '#eef4ff',
  border: "2px solid #1E1B4B",
  borderRadius: 8,
  fontSize: "0.78rem",
  fontWeight: 800,
  color: "#0f172a",
  WebkitTextFillColor: "#fff",
  cursor: "pointer",
  textShadow: "0 1px 2px rgba(0,0,0,.5)",
};

const dangerBtn: React.CSSProperties = {
  padding: "9px 16px",
  background: "#fff",
  border: "2px solid #FCA5A5",
  borderRadius: 8,
  fontSize: "0.78rem",
  fontWeight: 800,
  color: "#B91C1C",
  WebkitTextFillColor: "#B91C1C",
  cursor: "pointer",
};

/* ── Main component ─────────────────────────────────────────────────────── */

type ModalKind = "members" | "drip" | "hslist" | "reengage" | null;

export default function AudiencesDynamic() {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [bindMap, setBindMap] = useState<Record<number, BindingSet>>({});
  const [hubConfigured, setHubConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Builder modal (create/edit)
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderEditId, setBuilderEditId] = useState<number | null>(null);

  // Secondary modals
  const [modal, setModal] = useState<ModalKind>(null);
  const [modalSeg, setModalSeg] = useState<Segment | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [r, hub] = await Promise.all([
      apiGet<AudiencesResult>("/api/audiences"),
      apiGet<HubspotStatus>("/api/hubspot/status"),
    ]);
    if (!r.ok) {
      setError(r.error || "Failed to load audiences");
      setSegments([]);
      return;
    }
    setHubConfigured(!!(hub.ok && hub.configured));
    const segs = r.segments || [];
    setSegments(segs);

    const allBindings = await Promise.all(
      segs.map((s) =>
        Promise.all([
          apiGet<{ binding?: DripBinding }>(`/api/audiences/${s.id}/drip-binding`),
          apiGet<{ binding?: HsBinding }>(`/api/audiences/${s.id}/hubspot-list`),
          apiGet<{ binding?: RengBinding }>(`/api/audiences/${s.id}/reengage`),
        ]),
      ),
    );
    const map: Record<number, BindingSet> = {};
    segs.forEach((s, i) => {
      map[s.id] = {
        drip: allBindings[i][0]?.binding || null,
        hsList: allBindings[i][1]?.binding || null,
        reng: allBindings[i][2]?.binding || null,
      };
    });
    setBindMap(map);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openBuilder(id: number | null) {
    setBuilderEditId(id);
    setBuilderOpen(true);
  }

  function openModal(kind: ModalKind, seg: Segment) {
    setModalSeg(seg);
    setModal(kind);
  }

  async function deleteSegment(s: Segment) {
    if (
      !confirm(
        `Delete dynamic audience "${s.name}"? This removes the rules + membership history. Drip campaigns wired to this segment will need re-targeting.`,
      )
    )
      return;
    await apiDelete(`/api/audiences/${s.id}`);
    showToast("🗑 Audience deleted");
    load();
  }

  async function refreshSegment(s: Segment) {
    showToast(
      '🔄 Re-evaluating "' +
        s.name +
        '" against your full HubSpot contact list…',
    );
    const r = await apiPost<{
      ok: boolean;
      error?: string;
      run?: {
        source?: string;
        hubspotError?: string;
        results?: { matched?: number; added?: number; removed?: number }[];
      };
    }>(`/api/audiences/${s.id}/refresh`);
    if (!r.ok) {
      showToast("❌ Refresh failed: " + (r.error || "refresh failed"));
      return;
    }
    const run = r.run || {};
    const seg = (run.results || [])[0] || {};
    if (run.source === "unavailable" || run.source === "hubspot_partial") {
      showToast("⚠ HubSpot fetch failed — " + (run.hubspotError || "unavailable"));
    } else {
      showToast(
        `✅ "${s.name}" — ${seg.matched || 0} members (${seg.added || 0} joined, ${seg.removed || 0} left)`,
      );
    }
    load();
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  return (
    <>
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Dynamic Audiences
              </div>
              <h2 className="view-title">⚡ Dynamic Audiences</h2>
              <p className="view-sub">
                Real-time, rule-based segments — contacts auto-flow in &amp; out
                as their behaviour changes. No manual list maintenance, ever.
              </p>
            </div>
            <div className="vh-actions">
              <button className="btn-primary" onClick={() => openBuilder(null)}>
                + New Audience
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 56 }}
      >
        {segments === null ? (
          <div
            style={{
              textAlign: "center",
              padding: 48,
              color: "#64748B",
              fontWeight: 600,
            }}
          >
            Loading audiences…
          </div>
        ) : error ? (
          <div
            style={{
              background: "#FEE2E2",
              border: "1px solid #FCA5A5",
              borderRadius: 10,
              padding: 16,
              color: "#B91C1C",
              fontWeight: 600,
            }}
          >
            Failed to load audiences: {error}
          </div>
        ) : (
          <>
            <div
              style={{
                background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)",
                border: "1px solid #C7D2FE",
                borderRadius: 14,
                padding: "18px 22px",
                marginBottom: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "1rem",
                    fontWeight: 800,
                    color: "#312E81",
                    marginBottom: 4,
                  }}
                >
                  ⚡ Dynamic Audiences · cross-channel
                </div>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "#4338CA",
                    lineHeight: 1.55,
                    maxWidth: 700,
                  }}
                >
                  Define rules once, fan out everywhere: Drip nurture, HubSpot
                  Static List, AI win-back. Contacts auto-flow in/out the moment
                  they qualify or stop matching.
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  alignItems: "flex-end",
                }}
              >
                <SourceBadge configured={hubConfigured} />
                <div
                  style={{
                    fontSize: "0.62rem",
                    color: "#6B7280",
                    fontWeight: 700,
                  }}
                >
                  Phase 4 · Drip + HubSpot list + Re-engage
                </div>
              </div>
            </div>

            {segments.length === 0 ? (
              <div
                style={{
                  background: "#fff",
                  border: "2px dashed #C7D2FE",
                  borderRadius: 14,
                  padding: 48,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>🎯</div>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: 800,
                    color: "#0A1628",
                    marginBottom: 6,
                  }}
                >
                  No dynamic audiences yet
                </div>
                <button
                  onClick={() => openBuilder(null)}
                  style={{
                    padding: "11px 22px",
                    background: '#eef4ff',
                    border: "2px solid #1E1B4B",
                    borderRadius: 9,
                    fontSize: "0.85rem",
                    fontWeight: 800,
                    color: "#0f172a",
                    WebkitTextFillColor: "#fff",
                    cursor: "pointer",
                    textShadow: "0 1px 2px rgba(0,0,0,.5)",
                    boxShadow: "0 4px 14px rgba(30,27,75,.35)",
                  }}
                >
                  + Create your first audience
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(380px,1fr))",
                  gap: 16,
                }}
              >
                {segments.map((s) => (
                  <SegmentCard
                    key={s.id}
                    seg={s}
                    bindings={bindMap[s.id]}
                    onSync={() => refreshSegment(s)}
                    onMembers={() => openModal("members", s)}
                    onDrip={() => openModal("drip", s)}
                    onHsList={() => openModal("hslist", s)}
                    onReengage={() => openModal("reengage", s)}
                    onEdit={() => openBuilder(s.id)}
                    onDelete={() => deleteSegment(s)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {builderOpen && (
        <SegmentBuilderModal
          editId={builderEditId}
          onClose={() => setBuilderOpen(false)}
          onSaved={() => {
            setBuilderOpen(false);
            load();
          }}
        />
      )}

      {modal === "members" && modalSeg && (
        <MembersModal seg={modalSeg} onClose={() => setModal(null)} />
      )}
      {modal === "drip" && modalSeg && (
        <DripBindingModal
          seg={modalSeg}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
      {modal === "hslist" && modalSeg && (
        <HsListModal
          seg={modalSeg}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
      {modal === "reengage" && modalSeg && (
        <ReengageModal
          seg={modalSeg}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </>
  );
}

/* ── Source badge ───────────────────────────────────────────────────────── */

function SourceBadge({ configured }: { configured: boolean }) {
  if (configured) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: "#DCFCE7",
          color: "#15803D",
          padding: "3px 9px",
          borderRadius: 6,
          fontSize: "0.65rem",
          fontWeight: 800,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            background: "#10B981",
            borderRadius: "50%",
          }}
        />
        HUBSPOT CONNECTED · live data
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: "#FEF3C7",
        color: "#92400E",
        padding: "3px 9px",
        borderRadius: 6,
        fontSize: "0.65rem",
        fontWeight: 800,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          background: "#F59E0B",
          borderRadius: "50%",
        }}
      />
      HUBSPOT NOT CONNECTED
    </span>
  );
}

/* ── Segment card ───────────────────────────────────────────────────────── */

function chip(
  label: string,
  on: boolean,
  sub?: string,
): React.ReactElement {
  const bg = on ? "#DCFCE7" : "#F3F4F6";
  const fg = on ? "#15803D" : "#9CA3AF";
  return (
    <span
      style={{
        background: bg,
        color: fg,
        padding: "2px 8px",
        borderRadius: 5,
        fontSize: "0.6rem",
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: ".05em",
      }}
    >
      {label}
      {sub ? " · " + sub : ""}
    </span>
  );
}

function SegmentCard({
  seg,
  bindings,
  onSync,
  onMembers,
  onDrip,
  onHsList,
  onReengage,
  onEdit,
  onDelete,
}: {
  seg: Segment;
  bindings?: BindingSet;
  onSync: () => void;
  onMembers: () => void;
  onDrip: () => void;
  onHsList: () => void;
  onReengage: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const b: BindingSet = bindings || { drip: null, hsList: null, reng: null };
  const last = seg.last_evaluated_at
    ? new Date(seg.last_evaluated_at).toLocaleString()
    : "never";
  const conds =
    seg.rules && Array.isArray(seg.rules.conditions)
      ? seg.rules.conditions.length
      : 0;

  const dripChip = b.drip
    ? chip("📨 Drip", !!b.drip.enabled, b.drip.dry_run ? "dry" : "LIVE")
    : chip("📨 Drip", false, "off");
  const hsChip = b.hsList
    ? chip(
        "🔗 HS list",
        !!b.hsList.enabled && !!b.hsList.list_id,
        b.hsList.list_id ? "#" + b.hsList.list_id : "no id",
      )
    : chip("🔗 HS list", false, "off");
  const rngChip = b.reng
    ? chip("💔 Re-eng", !!b.reng.enabled, b.reng.dry_run ? "dry" : "LIVE")
    : chip("💔 Re-eng", false, "off");

  const actionBtn = (
    bg: string,
    accent: string,
    on: boolean,
  ): React.CSSProperties => ({
    padding: 7,
    background: on ? bg : "#fff",
    border: `2px solid ${accent}`,
    borderRadius: 6,
    fontSize: "0.68rem",
    fontWeight: 800,
    color: on ? "#fff" : accent,
    WebkitTextFillColor: on ? "#fff" : accent,
    cursor: "pointer",
    ...(on ? { textShadow: "0 1px 2px rgba(0,0,0,.4)" } : {}),
  });

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 14,
        padding: "16px 18px",
        boxShadow: "0 1px 4px rgba(0,0,0,.04)",
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "0.95rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            {seg.name}
          </div>
          {seg.description ? (
            <div
              style={{
                fontSize: "0.72rem",
                color: "#6B7280",
                marginTop: 3,
                lineHeight: 1.45,
              }}
            >
              {seg.description}
            </div>
          ) : null}
        </div>
        <span
          style={{
            background: seg.enabled ? "#DCFCE7" : "#F3F4F6",
            color: seg.enabled ? "#15803D" : "#6B7280",
            padding: "2px 8px",
            borderRadius: 5,
            fontSize: "0.6rem",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: ".05em",
          }}
        >
          {seg.enabled ? "Live" : "Paused"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {dripChip}
        {hsChip}
        {rngChip}
      </div>

      <div
        style={{
          display: "flex",
          gap: 14,
          padding: "8px 0",
          borderTop: "1px solid #F1F5F9",
          borderBottom: "1px solid #F1F5F9",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "0.6rem",
              fontWeight: 700,
              color: "#9CA3AF",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Members
          </div>
          <div
            style={{
              fontSize: "1.3rem",
              fontWeight: 800,
              color: "#1E1B4B",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {(seg.member_count || 0).toLocaleString()}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "0.6rem",
              fontWeight: 700,
              color: "#9CA3AF",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Rules
          </div>
          <div
            style={{
              fontSize: "1.3rem",
              fontWeight: 800,
              color: "#1E1B4B",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {conds}
          </div>
        </div>
      </div>

      <div style={{ fontSize: "0.64rem", color: "#9CA3AF" }}>
        Last evaluated: {last}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2,1fr)",
          gap: 5,
          marginTop: 2,
        }}
      >
        <button onClick={onSync} style={actionBtn("#0EA5E9", "#0EA5E9", true)}>
          🔄 Sync
        </button>
        <button
          onClick={onMembers}
          style={actionBtn("#1E1B4B", "#1E1B4B", true)}
        >
          👥 Members
        </button>
        <button
          onClick={onDrip}
          style={actionBtn("#15803D", "#15803D", !!b.drip)}
        >
          📨 Drip
        </button>
        <button
          onClick={onHsList}
          style={actionBtn("#0f766e", "#0f766e", !!b.hsList)}
        >
          🔗 HS List
        </button>
        <button
          onClick={onReengage}
          style={actionBtn("#0f766e", "#0f766e", !!b.reng)}
        >
          💔 Re-eng
        </button>
        <div style={{ display: "flex", gap: 5 }}>
          <button
            onClick={onEdit}
            style={{
              flex: 1,
              padding: 7,
              background: "#fff",
              border: "2px solid #C7D2FE",
              borderRadius: 6,
              fontSize: "0.68rem",
              fontWeight: 800,
              color: "#4338CA",
              WebkitTextFillColor: "#4338CA",
              cursor: "pointer",
            }}
          >
            ✏️ Edit
          </button>
          <button
            onClick={onDelete}
            style={{
              padding: "7px 10px",
              background: "#fff",
              border: "2px solid #FCA5A5",
              borderRadius: 6,
              fontSize: "0.68rem",
              fontWeight: 800,
              color: "#B91C1C",
              WebkitTextFillColor: "#B91C1C",
              cursor: "pointer",
            }}
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Segment builder modal ──────────────────────────────────────────────── */

const inputBox: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1.5px solid #D1D5DB",
  borderRadius: 8,
  fontSize: "0.9rem",
  color: "#0A1628",
  background: "#fff",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 800,
  color: "#374151",
  marginBottom: 5,
  textTransform: "uppercase",
  letterSpacing: ".04em",
};

const rowInput: React.CSSProperties = {
  padding: "7px 10px",
  border: "1.5px solid #D1D5DB",
  borderRadius: 6,
  fontSize: "0.78rem",
  color: "#0A1628",
  background: "#fff",
};

const rowSelect: React.CSSProperties = { ...rowInput, fontWeight: 600 };

function defaultCondition(): Condition {
  return { type: "property", field: "lifecyclestage", op: "eq", value: "customer" };
}

function SegmentBuilderModal({
  editId,
  onClose,
  onSaved,
}: {
  editId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [match, setMatch] = useState("all");
  const [conds, setConds] = useState<Condition[]>([]);
  const [loaded, setLoaded] = useState(editId === null);

  const [previewCount, setPreviewCount] = useState("— matches");
  const [previewNote, setPreviewNote] = useState(
    "Add a condition to see your live count.",
  );
  const [previewHubspot, setPreviewHubspot] = useState<boolean | null>(null);

  // Load preset on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      if (editId) {
        const r = await apiGet<{ ok: boolean; segment?: Segment }>(
          `/api/audiences/${editId}`,
        );
        if (!active) return;
        if (r.ok && r.segment) {
          setName(r.segment.name || "");
          setDescription(r.segment.description || "");
          const rules = r.segment.rules || { match: "all", conditions: [] };
          setMatch(rules.match || "all");
          setConds(
            rules.conditions && rules.conditions.length
              ? [...rules.conditions]
              : [],
          );
        }
        setLoaded(true);
      } else {
        setConds([defaultCondition()]);
      }
    })();
    return () => {
      active = false;
    };
  }, [editId]);

  const runPreview = useCallback(async () => {
    if (!conds.length) {
      setPreviewCount("— matches");
      setPreviewNote("Add a condition to see your live count.");
      setPreviewHubspot(null);
      return;
    }
    setPreviewCount("⏳ counting…");
    setPreviewNote("Sampling contacts and applying rules…");
    setPreviewHubspot(null);
    const r = await apiPost<{
      ok: boolean;
      error?: string;
      preview?: {
        matches?: number;
        sampleSize?: number;
        note?: string;
        source?: string;
        error?: string;
      };
    }>("/api/audiences/preview", { rules: { match, conditions: conds } });
    if (r.ok && r.preview) {
      const p = r.preview;
      setPreviewCount(
        `${(p.matches || 0).toLocaleString()} of ${(p.sampleSize || 0).toLocaleString()} sampled contacts match`,
      );
      setPreviewNote(p.note || "");
      setPreviewHubspot(p.source === "hubspot");
    } else {
      setPreviewCount("⚠ preview failed");
      setPreviewNote(
        r.error || (r.preview && r.preview.error) || "Unknown error",
      );
      setPreviewHubspot(null);
    }
  }, [conds, match]);

  // Initial preview once preset conditions are present.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(runPreview, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  function updateCond(idx: number, key: keyof Condition, val: string | number) {
    setConds((prev) => {
      const next = prev.map((c) => ({ ...c }));
      const c = next[idx] || ({} as Condition);
      (c as Record<string, unknown>)[key] = val;
      if (key === "type") {
        if (val === "property") {
          c.field = "lifecyclestage";
          c.op = "eq";
          c.value = "";
        }
        if (val === "event") {
          c.event = "page_view";
          c.op = "happened";
          c.days = 30;
          c.value = "";
        }
        if (val === "commerce") {
          c.field = "total_purchases";
          c.op = "gt";
          c.value = 0;
        }
        if (val === "engagement") {
          c.metric = "opened_email";
          c.op = "happened";
          c.days = 30;
          c.value = "";
        }
        if (val === "ai_source") {
          c.source = "chatgpt";
          c.days = 30;
        }
      }
      next[idx] = c;
      return next;
    });
  }

  function addCondition() {
    setConds((prev) => [
      ...prev,
      { type: "property", field: "lifecyclestage", op: "eq", value: "" },
    ]);
  }

  function removeCondition(idx: number) {
    setConds((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    if (!name.trim()) {
      alert("Give the audience a name first.");
      return;
    }
    const body = {
      name,
      description,
      rules: { match, conditions: conds },
    };
    const url = editId ? `/api/audiences/${editId}` : "/api/audiences";
    const r = editId
      ? await apiPut<{ ok: boolean; error?: string }>(url, body)
      : await apiPost<{ ok: boolean; error?: string }>(url, body);
    if (!r.ok) {
      alert("Save failed: " + (r.error || "save failed"));
      return;
    }
    showToast(editId ? "💾 Audience updated" : "✨ Audience created");
    onSaved();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 780,
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          padding: "28px 32px",
          color: "#0A1628",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "1.3rem",
                fontWeight: 800,
              }}
            >
              {editId ? "✏️ Edit" : "➕ New"} Dynamic Audience
            </div>
            <div
              style={{
                fontSize: "0.78rem",
                color: "#6B7280",
                marginTop: 3,
              }}
            >
              Add rules — the live count below updates as you type.
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            ×
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            marginBottom: 18,
          }}
        >
          <div>
            <label style={labelStyle}>Audience name</label>
            <input
              type="text"
              placeholder="e.g. One-time buyers (last 30d)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputBox}
            />
          </div>
          <div>
            <label style={labelStyle}>Match logic</label>
            <select
              value={match}
              onChange={(e) => setMatch(e.target.value)}
              style={inputBox}
            >
              <option value="all">Match ALL conditions</option>
              <option value="any">Match ANY condition</option>
              <option value="none">Match NONE of these</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Description (optional)</label>
          <input
            type="text"
            placeholder="What is this audience for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...inputBox, fontSize: "0.85rem" }}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div
            style={{ fontSize: "0.78rem", fontWeight: 800, color: "#0A1628" }}
          >
            Conditions
          </div>
          <button
            onClick={addCondition}
            style={{
              padding: "7px 14px",
              background: '#eef4ff',
              border: "2px solid #1E1B4B",
              borderRadius: 7,
              fontSize: "0.72rem",
              fontWeight: 800,
              color: "#0f172a",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.5)",
            }}
          >
            + Add condition
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 18,
          }}
        >
          {conds.length === 0 ? (
            <div
              style={{
                background: "#F9FAFB",
                border: "1.5px dashed #D1D5DB",
                borderRadius: 9,
                padding: 20,
                textAlign: "center",
                color: "#6B7280",
                fontSize: "0.8rem",
              }}
            >
              No conditions yet — click &quot;+ Add condition&quot; above.
            </div>
          ) : (
            conds.map((c, i) => (
              <div
                key={i}
                style={{
                  background: "#F9FAFB",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 800,
                    color: "#6B7280",
                    minWidth: 18,
                  }}
                >
                  {i + 1}.
                </span>
                <select
                  value={c.type}
                  onChange={(e) => updateCond(i, "type", e.target.value)}
                  style={rowSelect}
                >
                  <option value="property">Contact property</option>
                  <option value="event">Event</option>
                  <option value="commerce">Commerce</option>
                  <option value="engagement">Engagement</option>
                  <option value="ai_source">AI referral source</option>
                </select>
                <ConditionFields
                  c={c}
                  idx={i}
                  update={updateCond}
                />
                <button
                  onClick={() => removeCondition(i)}
                  style={{
                    marginLeft: "auto",
                    background: "#fff",
                    border: "1.5px solid #FCA5A5",
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "#B91C1C",
                    WebkitTextFillColor: "#B91C1C",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)",
            border: "1.5px solid #C7D2FE",
            borderRadius: 12,
            padding: "16px 18px",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 800,
                  color: "#4338CA",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                Live preview
              </div>
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontSize: "1.6rem",
                  fontWeight: 800,
                  color: "#1E1B4B",
                  marginTop: 3,
                }}
              >
                {previewCount}
              </div>
              <div
                style={{ fontSize: "0.7rem", color: "#6B7280", marginTop: 3 }}
              >
                {previewNote}
                {previewHubspot === true && (
                  <span
                    style={{
                      display: "inline-block",
                      background: "#DCFCE7",
                      color: "#15803D",
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontSize: "0.62rem",
                      fontWeight: 800,
                      marginLeft: 4,
                    }}
                  >
                    LIVE · HubSpot
                  </span>
                )}
                {previewHubspot === false && (
                  <span
                    style={{
                      display: "inline-block",
                      background: "#FEF3C7",
                      color: "#92400E",
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontSize: "0.62rem",
                      fontWeight: 800,
                      marginLeft: 4,
                    }}
                  >
                    DEMO · synthetic
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={runPreview}
              style={{
                padding: "9px 16px",
                background: '#eef4ff',
                border: "2px solid #1E1B4B",
                borderRadius: 8,
                fontSize: "0.75rem",
                fontWeight: 800,
                color: "#0f172a",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.5)",
              }}
            >
              🔄 Refresh count
            </button>
          </div>
        </div>

        <div
          style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "10px 18px",
              background: "#fff",
              border: "2px solid #D1D5DB",
              borderRadius: 8,
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "#374151",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            style={{
              padding: "10px 22px",
              background: '#eef4ff',
              border: "2px solid #1E1B4B",
              borderRadius: 8,
              fontSize: "0.82rem",
              fontWeight: 800,
              color: "#0f172a",
              WebkitTextFillColor: "#fff",
              cursor: "pointer",
              textShadow: "0 1px 2px rgba(0,0,0,.5)",
              boxShadow: "0 4px 14px rgba(30,27,75,.35)",
            }}
          >
            {editId ? "💾 Save changes" : "✨ Create audience"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConditionFields({
  c,
  idx,
  update,
}: {
  c: Condition;
  idx: number;
  update: (idx: number, key: keyof Condition, val: string | number) => void;
}) {
  const txt = (
    key: keyof Condition,
    val: string | number | undefined,
    ph: string,
    w: number,
  ) => (
    <input
      type="text"
      placeholder={ph}
      value={val == null ? "" : String(val)}
      onChange={(e) => update(idx, key, e.target.value)}
      style={{ ...rowInput, width: w }}
    />
  );
  const num = (
    key: keyof Condition,
    val: string | number | undefined,
    ph: string,
    w: number,
  ) => (
    <input
      type="number"
      placeholder={ph}
      value={val == null ? "" : val}
      onChange={(e) => update(idx, key, e.target.value)}
      style={{ ...rowInput, width: w }}
    />
  );
  const sel = (
    key: keyof Condition,
    val: string | undefined,
    opts: [string, string][],
  ) => (
    <select
      value={val ?? ""}
      onChange={(e) => update(idx, key, e.target.value)}
      style={rowSelect}
    >
      {opts.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  const dayLabel = (
    <>
      <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>in last</span>
      {num("days", c.days, "30", 60)}
      <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>days</span>
    </>
  );

  if (c.type === "property") {
    return (
      <>
        {txt("field", c.field, "property name", 160)}
        {sel("op", c.op, [
          ["eq", "is"],
          ["neq", "is not"],
          ["contains", "contains"],
          ["gt", ">"],
          ["lt", "<"],
          ["exists", "is set"],
        ])}
        {c.op === "exists" ? null : txt("value", c.value, "value", 140)}
      </>
    );
  }
  if (c.type === "event") {
    return (
      <>
        {txt("event", c.event, "event name", 150)}
        {sel("op", c.op, [
          ["happened", "happened"],
          ["not_happened", "did not happen"],
          ["count_gt", "count >"],
          ["count_lt", "count <"],
        ])}
        {c.op === "count_gt" || c.op === "count_lt"
          ? num("value", c.value, "0", 60)
          : null}
        {dayLabel}
      </>
    );
  }
  if (c.type === "commerce") {
    return (
      <>
        {sel("field", c.field, [
          ["total_purchases", "total purchases"],
          ["last_purchase_days", "days since last purchase"],
          ["aov", "avg order value"],
        ])}
        {sel("op", c.op, [
          ["gt", ">"],
          ["lt", "<"],
          ["eq", "="],
        ])}
        {num("value", c.value, "0", 80)}
      </>
    );
  }
  if (c.type === "engagement") {
    return (
      <>
        {sel("metric", c.metric, [
          ["opened_email", "opened email"],
          ["clicked_email", "clicked email"],
          ["page_visited", "visited page"],
        ])}
        {sel("op", c.op, [
          ["happened", "happened"],
          ["not_happened", "did not happen"],
        ])}
        {c.metric === "page_visited"
          ? txt("value", c.value, "url contains", 140)
          : null}
        {dayLabel}
      </>
    );
  }
  if (c.type === "ai_source") {
    return (
      <>
        {sel("source", c.source, [
          ["chatgpt", "ChatGPT"],
          ["perplexity", "Perplexity"],
          ["gemini", "Gemini"],
          ["claude", "Claude"],
          ["copilot", "Copilot"],
          ["googleAi", "Google AI Overview"],
        ])}
        <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>
          referred in last
        </span>
        {num("days", c.days, "30", 60)}
        <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>days</span>
      </>
    );
  }
  return null;
}

/* ── Members modal ──────────────────────────────────────────────────────── */

function MembersModal({
  seg,
  onClose,
}: {
  seg: Segment;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [m, l] = await Promise.all([
        apiGet<{ ok?: boolean; members?: Member[]; total?: number }>(
          `/api/audiences/${seg.id}/members?limit=200`,
        ),
        apiGet<{ ok?: boolean; log?: LogRow[] }>(
          `/api/audiences/${seg.id}/log`,
        ),
      ]);
      if (!active) return;
      if (m.ok === false && l.ok === false) {
        setLoadErr("Failed to load members");
        return;
      }
      setMembers(m.members || []);
      setTotal(m.total || 0);
      setLog(l.log || []);
    })();
    return () => {
      active = false;
    };
  }, [seg.id]);

  const totals = log.reduce(
    (a, r) => ({
      added: a.added + (r.members_added || 0),
      removed: a.removed + (r.members_removed || 0),
      runs: a.runs + 1,
    }),
    { added: 0, removed: 0, runs: 0 },
  );
  const lastRun = log[0] ? new Date(log[0].ran_at).toLocaleString() : "never";

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 880,
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          padding: "28px 32px",
          color: "#0A1628",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "1.3rem",
                fontWeight: 800,
              }}
            >
              👥 Members of &quot;{seg.name}&quot;
            </div>
            <div
              style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: 3 }}
            >
              Live membership + recent in/out flow. Updated by the 15-minute
              sweep, the HubSpot webhook, and any manual sync.
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            ×
          </button>
        </div>

        {loadErr ? (
          <div
            style={{
              background: "#FEE2E2",
              border: "1px solid #FCA5A5",
              borderRadius: 10,
              padding: 16,
              color: "#B91C1C",
            }}
          >
            Failed to load members: {loadErr}
          </div>
        ) : members === null ? (
          <div
            style={{
              fontSize: "0.85rem",
              color: "#6B7280",
              textAlign: "center",
              padding: 32,
            }}
          >
            Loading…
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,1fr)",
                gap: 12,
                marginBottom: 18,
              }}
            >
              <StatBox
                bg="#F0FDF4"
                border="#BBF7D0"
                color="#166534"
                label="Active members"
                value={total.toLocaleString()}
              />
              <StatBox
                bg="#EFF6FF"
                border="#BFDBFE"
                color="#1E40AF"
                label="Joined (7d)"
                value={"+" + totals.added.toLocaleString()}
              />
              <StatBox
                bg="#FEF2F2"
                border="#FCA5A5"
                color="#991B1B"
                label="Left (7d)"
                value={"−" + totals.removed.toLocaleString()}
              />
              <StatBox
                bg="#F5F3FF"
                border="#DDD6FE"
                color="#5B21B6"
                label="Sweeps (7d)"
                value={String(totals.runs)}
              />
            </div>

            <div
              style={{ fontSize: "0.7rem", color: "#6B7280", marginBottom: 8 }}
            >
              Last evaluated:{" "}
              <strong style={{ color: "#0A1628" }}>{lastRun}</strong>
              {log[0]?.error ? (
                <span style={{ color: "#B91C1C" }}>
                  {" "}
                  · error: {log[0].error}
                </span>
              ) : null}
            </div>

            <div
              style={{
                fontSize: "0.78rem",
                fontWeight: 800,
                color: "#0A1628",
                margin: "18px 0 8px",
              }}
            >
              Active members{" "}
              {total > members.length
                ? `(showing first ${members.length} of ${total})`
                : `(${members.length})`}
            </div>

            {members.length === 0 ? (
              <div
                style={{
                  background: "#FAFAFA",
                  border: "1.5px dashed #E5E7EB",
                  borderRadius: 10,
                  padding: 24,
                  textAlign: "center",
                  color: "#6B7280",
                  fontSize: "0.85rem",
                }}
              >
                No active members yet.{" "}
                {log.length === 0
                  ? "Run a sync to do the first evaluation."
                  : "No HubSpot contacts currently match these rules."}
              </div>
            ) : (
              <div
                style={{
                  border: "1px solid #E5E7EB",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.78rem",
                  }}
                >
                  <thead style={{ background: "#F9FAFB" }}>
                    <tr>
                      <th style={memberTh}>Email</th>
                      <th style={memberTh}>Contact ID</th>
                      <th style={{ ...memberTh, textAlign: "right" }}>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((c, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
                        <td
                          style={{
                            padding: "9px 12px",
                            color: "#0A1628",
                            fontWeight: 600,
                          }}
                        >
                          {c.contact_email || "(no email)"}
                        </td>
                        <td
                          style={{
                            padding: "9px 12px",
                            color: "#6B7280",
                            fontFamily: "'JetBrains Mono',monospace",
                            fontSize: "0.72rem",
                          }}
                        >
                          {c.contact_id}
                        </td>
                        <td
                          style={{
                            padding: "9px 12px",
                            textAlign: "right",
                            color: "#6B7280",
                          }}
                        >
                          {new Date(c.joined_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const memberTh: React.CSSProperties = {
  textAlign: "left",
  padding: "9px 12px",
  fontWeight: 800,
  color: "#374151",
  fontSize: "0.7rem",
  textTransform: "uppercase",
  letterSpacing: ".05em",
};

function StatBox({
  bg,
  border,
  color,
  label,
  value,
}: {
  bg: string;
  border: string;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div
        style={{
          fontSize: "0.6rem",
          fontWeight: 800,
          color,
          textTransform: "uppercase",
          letterSpacing: ".06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 800,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ── Drip binding modal ─────────────────────────────────────────────────── */

const DEFAULT_DRIP: DripStep[] = [
  {
    day: 0,
    channel: "Email",
    label: "Welcome",
    subject: "Welcome — quick intro",
    msg: "Hi! You just qualified for our audience. Here's what to expect…",
  },
  {
    day: 2,
    channel: "Email",
    label: "Value drop",
    subject: "Idea you might find useful",
    msg: "Quick tip / case study you can use today.",
  },
  {
    day: 5,
    channel: "Email",
    label: "Soft CTA",
    subject: "Want to chat?",
    msg: "If this is on your radar, reply and we'll set up 15 min.",
  },
];

const smallLabel: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  color: "#374151",
};

const modalInput: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1.5px solid #E5E7EB",
  borderRadius: 7,
  fontSize: "0.85rem",
};

function DripBindingModal({
  seg,
  onClose,
  onSaved,
}: {
  seg: Segment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [existing, setExisting] = useState<DripBinding | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [brand, setBrand] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [autoExit, setAutoExit] = useState(true);
  const [seq, setSeq] = useState<DripStep[]>(DEFAULT_DRIP);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await apiGet<{ binding?: DripBinding }>(
        `/api/audiences/${seg.id}/drip-binding`,
      );
      if (!active) return;
      const b = r.binding || null;
      setExisting(b);
      if (b) {
        setBrand(b.brand || "");
        setDryRun(b.dry_run !== false);
        setAutoExit(b.auto_exit !== false);
        setSeq(
          Array.isArray(b.sequence) && b.sequence.length
            ? b.sequence
            : DEFAULT_DRIP,
        );
      }
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [seg.id]);

  function updateStep(i: number, key: keyof DripStep, val: string | number) {
    setSeq((prev) =>
      prev.map((s, idx) =>
        idx === i
          ? { ...s, [key]: key === "day" ? parseInt(String(val), 10) || 0 : val }
          : s,
      ),
    );
  }
  function removeStep(i: number) {
    setSeq((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addStep() {
    setSeq((prev) => {
      const lastDay = prev.length ? Number(prev[prev.length - 1].day || 0) : -1;
      return [
        ...prev,
        {
          day: lastDay + 2,
          channel: "Email",
          label: `Step ${prev.length + 1}`,
          subject: "",
          msg: "",
        },
      ];
    });
  }

  async function save() {
    const filtered = seq.filter(
      (s) => (s.subject || "").trim() || (s.msg || "").trim(),
    );
    if (!filtered.length) {
      showToast("❌ Add at least one step with subject or body");
      return;
    }
    const payload = {
      sequence: filtered,
      brand: brand.trim() || null,
      dry_run: dryRun,
      auto_exit: autoExit,
      app_origin: typeof window !== "undefined" ? window.location.origin : "",
    };
    const r = await apiPost<{ ok: boolean; error?: string }>(
      `/api/audiences/${seg.id}/drip-binding`,
      payload,
    );
    if (!r.ok) {
      showToast("❌ " + (r.error || "save failed"));
      return;
    }
    showToast(
      `✅ Drip binding saved (${filtered.length} steps · ${dryRun ? "dry-run" : "LIVE"})`,
    );
    onSaved();
  }

  async function remove() {
    if (
      !confirm(
        "Remove the Drip binding? Existing in-flight enrollments are NOT touched — only future joins will stop auto-enrolling.",
      )
    )
      return;
    const r = await apiDelete<{ ok: boolean; error?: string }>(
      `/api/audiences/${seg.id}/drip-binding`,
    );
    if (!r.ok) {
      showToast("❌ " + (r.error || "delete failed"));
      return;
    }
    showToast("🗑 Drip binding removed");
    onSaved();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 760,
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          padding: "28px 32px",
          color: "#0A1628",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "1.3rem",
                fontWeight: 800,
              }}
            >
              📨 Drip binding for &quot;{seg.name}&quot;
            </div>
            <div
              style={{
                fontSize: "0.78rem",
                color: "#6B7280",
                marginTop: 3,
                lineHeight: 1.5,
              }}
            >
              When a contact joins this audience, they&apos;re auto-enrolled into
              the email sequence below. When they leave, their active enrollment
              is auto-unsubscribed.
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            ×
          </button>
        </div>

        {!loaded ? (
          <div
            style={{
              fontSize: "0.85rem",
              color: "#6B7280",
              textAlign: "center",
              padding: 32,
            }}
          >
            Loading…
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <label style={smallLabel}>
                <div style={{ marginBottom: 4 }}>Brand name</div>
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="My Co"
                  style={modalInput}
                />
              </label>
              <label style={smallLabel}>
                <div style={{ marginBottom: 4 }}>Mode</div>
                <select
                  value={dryRun ? "true" : "false"}
                  onChange={(e) => setDryRun(e.target.value === "true")}
                  style={{ ...modalInput, background: "#fff" }}
                >
                  <option value="true">Dry-run (safe — no real sends)</option>
                  <option value="false">
                    Live (send real emails via Resend)
                  </option>
                </select>
              </label>
              <label style={smallLabel}>
                <div style={{ marginBottom: 4 }}>Auto-exit on leave</div>
                <select
                  value={autoExit ? "true" : "false"}
                  onChange={(e) => setAutoExit(e.target.value === "true")}
                  style={{ ...modalInput, background: "#fff" }}
                >
                  <option value="true">
                    Yes — unsubscribe when they leave
                  </option>
                  <option value="false">No — let sequence finish</option>
                </select>
              </label>
            </div>

            <div
              style={{
                fontSize: "0.78rem",
                fontWeight: 800,
                color: "#0A1628",
                margin: "8px 0",
              }}
            >
              Email sequence
            </div>

            <div>
              {seq.map((s, i) => (
                <div
                  key={i}
                  style={{
                    background: "#F9FAFB",
                    border: "1px solid #E5E7EB",
                    borderRadius: 10,
                    padding: "11px 13px",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginBottom: 7,
                    }}
                  >
                    <span
                      style={{
                        background: '#eef4ff',
                        color: "#0f172a",
                        WebkitTextFillColor: "#fff",
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.7rem",
                        fontWeight: 800,
                      }}
                    >
                      {i + 1}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={s.day || 0}
                      placeholder="day"
                      onChange={(e) => updateStep(i, "day", e.target.value)}
                      style={{
                        width: 70,
                        padding: "6px 8px",
                        border: "1px solid #E5E7EB",
                        borderRadius: 6,
                        fontSize: "0.78rem",
                      }}
                    />
                    <span style={{ fontSize: "0.68rem", color: "#9CA3AF" }}>
                      days after join
                    </span>
                    <input
                      value={s.label || ""}
                      placeholder="Step label"
                      onChange={(e) => updateStep(i, "label", e.target.value)}
                      style={{
                        flex: 1,
                        padding: "6px 8px",
                        border: "1px solid #E5E7EB",
                        borderRadius: 6,
                        fontSize: "0.78rem",
                      }}
                    />
                    <button
                      onClick={() => removeStep(i)}
                      style={{
                        background: "#fff",
                        border: "1px solid #FCA5A5",
                        color: "#B91C1C",
                        WebkitTextFillColor: "#B91C1C",
                        borderRadius: 6,
                        padding: "4px 10px",
                        fontSize: "0.7rem",
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <input
                    value={s.subject || ""}
                    placeholder="Email subject"
                    onChange={(e) => updateStep(i, "subject", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      border: "1px solid #E5E7EB",
                      borderRadius: 6,
                      fontSize: "0.78rem",
                      marginBottom: 6,
                    }}
                  />
                  <textarea
                    rows={3}
                    value={s.msg || ""}
                    placeholder="Email body"
                    onChange={(e) => updateStep(i, "msg", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      border: "1px solid #E5E7EB",
                      borderRadius: 6,
                      fontSize: "0.78rem",
                      fontFamily: "inherit",
                      resize: "vertical",
                    }}
                  />
                </div>
              ))}
            </div>

            <button
              onClick={addStep}
              style={{
                marginTop: 8,
                padding: "7px 14px",
                background: "#fff",
                border: "1.5px dashed #C7D2FE",
                borderRadius: 7,
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#4338CA",
                cursor: "pointer",
              }}
            >
              + Add step
            </button>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 18,
                paddingTop: 14,
                borderTop: "1px solid #F1F5F9",
              }}
            >
              {existing && (
                <button onClick={remove} style={dangerBtn}>
                  🗑 Remove binding
                </button>
              )}
              <button onClick={save} style={primaryBtn}>
                💾 Save binding
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── HubSpot list modal ─────────────────────────────────────────────────── */

function HsListModal({
  seg,
  onClose,
  onSaved,
}: {
  seg: Segment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [existing, setExisting] = useState<HsBinding | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [listName, setListName] = useState("");
  const [listId, setListId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [autoExit, setAutoExit] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await apiGet<{ binding?: HsBinding }>(
        `/api/audiences/${seg.id}/hubspot-list`,
      );
      if (!active) return;
      const b = r.binding || null;
      setExisting(b);
      setListName((b && b.list_name) || `${seg.name} — InfoGenie`);
      setListId((b && b.list_id) || "");
      setEnabled(b ? b.enabled !== false : true);
      setAutoExit(b ? b.auto_exit !== false : true);
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [seg.id, seg.name]);

  async function save() {
    const payload = {
      list_name: listName.trim(),
      list_id: listId.trim() || null,
      enabled,
      auto_exit: autoExit,
    };
    if (!payload.list_name) {
      showToast("❌ List name required");
      return;
    }
    const r = await apiPost<{ ok: boolean; error?: string; binding?: HsBinding }>(
      `/api/audiences/${seg.id}/hubspot-list`,
      payload,
    );
    if (!r.ok) {
      showToast("❌ " + (r.error || "save failed"));
      return;
    }
    const lid = r.binding?.list_id;
    showToast(
      lid
        ? `✅ Synced — HubSpot list ID ${lid}`
        : `⚠ Saved but list not yet created (check HubSpot permissions)`,
    );
    onSaved();
  }

  async function remove() {
    if (
      !confirm(
        "Remove HubSpot list binding? The HubSpot list itself is NOT deleted — only the auto-sync stops.",
      )
    )
      return;
    const r = await apiDelete<{ ok: boolean; error?: string }>(
      `/api/audiences/${seg.id}/hubspot-list`,
    );
    if (!r.ok) {
      showToast("❌ " + (r.error || "delete failed"));
      return;
    }
    showToast("🗑 HubSpot list binding removed");
    onSaved();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 600,
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          padding: "28px 32px",
          color: "#0A1628",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "1.3rem",
                fontWeight: 800,
              }}
            >
              🔗 HubSpot list sync · &quot;{seg.name}&quot;
            </div>
            <div
              style={{
                fontSize: "0.78rem",
                color: "#6B7280",
                marginTop: 3,
                lineHeight: 1.5,
              }}
            >
              Mirror this audience&apos;s membership to a HubSpot Static List.
              Your sales team will see live members inside HubSpot for follow-up,
              ads custom audiences, etc.
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            ×
          </button>
        </div>

        {!loaded ? (
          <div
            style={{
              fontSize: "0.85rem",
              color: "#6B7280",
              textAlign: "center",
              padding: 32,
            }}
          >
            Loading…
          </div>
        ) : (
          <>
            {existing && existing.last_error ? (
              <div
                style={{
                  background: "#FEF2F2",
                  border: "1px solid #FCA5A5",
                  color: "#B91C1C",
                  padding: "10px 12px",
                  borderRadius: 8,
                  fontSize: "0.78rem",
                  marginBottom: 12,
                }}
              >
                ⚠ Last sync error: {existing.last_error}
              </div>
            ) : null}
            {existing && existing.last_sync_at ? (
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "#6B7280",
                  marginBottom: 10,
                }}
              >
                Last synced:{" "}
                <strong>
                  {new Date(existing.last_sync_at).toLocaleString()}
                </strong>
              </div>
            ) : null}

            <label
              style={{ ...smallLabel, display: "block", marginBottom: 10 }}
            >
              <div style={{ marginBottom: 4 }}>
                List name (auto-creates a Static List in HubSpot the first time
                you save)
              </div>
              <input
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="e.g. Hot Leads (auto-synced)"
                style={{ ...modalInput, padding: "9px 11px" }}
              />
            </label>

            <label
              style={{ ...smallLabel, display: "block", marginBottom: 10 }}
            >
              <div style={{ marginBottom: 4 }}>
                Existing HubSpot list ID (optional — leave blank to auto-create)
              </div>
              <input
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                placeholder="e.g. 12345"
                style={{
                  ...modalInput,
                  padding: "9px 11px",
                  fontFamily: "'JetBrains Mono',monospace",
                }}
              />
            </label>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <label style={smallLabel}>
                <div style={{ marginBottom: 4 }}>Status</div>
                <select
                  value={enabled ? "true" : "false"}
                  onChange={(e) => setEnabled(e.target.value === "true")}
                  style={{ ...modalInput, background: "#fff" }}
                >
                  <option value="true">
                    Enabled — push joins/leaves to HubSpot
                  </option>
                  <option value="false">Paused</option>
                </select>
              </label>
              <label style={smallLabel}>
                <div style={{ marginBottom: 4 }}>Auto-remove on leave</div>
                <select
                  value={autoExit ? "true" : "false"}
                  onChange={(e) => setAutoExit(e.target.value === "true")}
                  style={{ ...modalInput, background: "#fff" }}
                >
                  <option value="true">Yes</option>
                  <option value="false">No — keep them on the list</option>
                </select>
              </label>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                paddingTop: 12,
                borderTop: "1px solid #F1F5F9",
              }}
            >
              {existing && (
                <button onClick={remove} style={dangerBtn}>
                  🗑 Remove
                </button>
              )}
              <button onClick={save} style={primaryBtn}>
                💾 Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Re-engage modal ────────────────────────────────────────────────────── */

const RENG_TONES = [
  "friendly",
  "warm",
  "direct",
  "playful",
  "professional",
  "urgent",
];

function ReengageModal({
  seg,
  onClose,
  onSaved,
}: {
  seg: Segment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [existing, setExisting] = useState<RengBinding | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [brand, setBrand] = useState("");
  const [tone, setTone] = useState("friendly");
  const [dryRun, setDryRun] = useState(true);
  const [angle, setAngle] = useState("churn-risk · 30 days inactive");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("");
  const [autoExit, setAutoExit] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await apiGet<{ binding?: RengBinding }>(
        `/api/audiences/${seg.id}/reengage`,
      );
      if (!active) return;
      const b = r.binding || null;
      setExisting(b);
      const v = (b && b.variant) || {};
      if (b) {
        setBrand(b.brand || "");
        setDryRun(b.dry_run !== false);
        setAutoExit(b.auto_exit !== false);
      }
      setTone(v.tone || "friendly");
      setAngle(v.angle || "churn-risk · 30 days inactive");
      setSubject(v.subject || "");
      setPreheader(v.preheader || "");
      setBody(v.body || "");
      setCta(v.cta || "");
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [seg.id]);

  async function generate() {
    setGenerating(true);
    const r = await apiPost<{
      variant?: RengVariant;
      variants?: RengVariant[];
      subject?: string;
      preheader?: string;
      body?: string;
      cta?: string;
    }>("/api/reengage/generate", {
      brand: brand || "InfoGenie",
      tone,
      segment: angle || "churn-risk",
    });
    const variant: RengVariant =
      r.variant || (r.variants && r.variants[0]) || (r as RengVariant);
    if (variant.subject) setSubject(variant.subject);
    if (variant.preheader) setPreheader(variant.preheader);
    if (variant.body) setBody(variant.body);
    if (variant.cta) setCta(variant.cta);
    showToast("✨ AI-generated win-back drafted — review & save");
    setGenerating(false);
  }

  async function save() {
    const payload = {
      variant: {
        subject: subject.trim(),
        preheader: preheader.trim(),
        body: body.trim(),
        cta: cta.trim(),
        angle: angle.trim(),
        tone,
      },
      brand: brand.trim() || null,
      dry_run: dryRun,
      auto_exit: autoExit,
      app_origin: typeof window !== "undefined" ? window.location.origin : "",
    };
    if (!payload.variant.subject || !payload.variant.body) {
      showToast("❌ Subject and body required");
      return;
    }
    const r = await apiPost<{ ok: boolean; error?: string }>(
      `/api/audiences/${seg.id}/reengage`,
      payload,
    );
    if (!r.ok) {
      showToast("❌ " + (r.error || "save failed"));
      return;
    }
    showToast(`✅ Re-engagement saved (${dryRun ? "dry-run" : "LIVE"})`);
    onSaved();
  }

  async function remove() {
    if (
      !confirm(
        "Remove the re-engagement binding? In-flight win-back enrollments are NOT touched.",
      )
    )
      return;
    const r = await apiDelete<{ ok: boolean; error?: string }>(
      `/api/audiences/${seg.id}/reengage`,
    );
    if (!r.ok) {
      showToast("❌ " + (r.error || "delete failed"));
      return;
    }
    showToast("🗑 Re-engagement binding removed");
    onSaved();
  }

  const fullInput: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    border: "1.5px solid #E5E7EB",
    borderRadius: 7,
    fontSize: "0.85rem",
    marginBottom: 8,
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 760,
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          padding: "28px 32px",
          color: "#0A1628",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "1.3rem",
                fontWeight: 800,
              }}
            >
              💔 Re-engage on join · &quot;{seg.name}&quot;
            </div>
            <div
              style={{
                fontSize: "0.78rem",
                color: "#6B7280",
                marginTop: 3,
                lineHeight: 1.5,
              }}
            >
              Auto-fire a single-touch personalised win-back the moment a contact
              qualifies (e.g. lands in your churn-risk audience). Generated by AI,
              editable, sent via the existing Drip engine.
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            ×
          </button>
        </div>

        {!loaded ? (
          <div
            style={{
              fontSize: "0.85rem",
              color: "#6B7280",
              textAlign: "center",
              padding: 32,
            }}
          >
            Loading…
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <label style={smallLabel}>
                <div style={{ marginBottom: 4 }}>Brand</div>
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="My Co"
                  style={modalInput}
                />
              </label>
              <label style={smallLabel}>
                <div style={{ marginBottom: 4 }}>Tone</div>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  style={{ ...modalInput, background: "#fff" }}
                >
                  {RENG_TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label style={smallLabel}>
                <div style={{ marginBottom: 4 }}>Mode</div>
                <select
                  value={dryRun ? "true" : "false"}
                  onChange={(e) => setDryRun(e.target.value === "true")}
                  style={{ ...modalInput, background: "#fff" }}
                >
                  <option value="true">Dry-run</option>
                  <option value="false">LIVE (real sends)</option>
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
                placeholder="Angle / context (e.g. abandoned trial)"
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 7,
                  fontSize: "0.85rem",
                }}
              />
              <button
                onClick={generate}
                disabled={generating}
                style={{
                  padding: "8px 14px",
                  background: "#0f766e",
                  border: "2px solid #0f766e",
                  borderRadius: 7,
                  fontSize: "0.75rem",
                  fontWeight: 800,
                  color: "#fff",
                  WebkitTextFillColor: "#fff",
                  cursor: "pointer",
                  textShadow: "0 1px 2px rgba(0,0,0,.4)",
                  whiteSpace: "nowrap",
                }}
              >
                {generating ? "✨ Generating…" : "✨ Generate with AI"}
              </button>
            </div>

            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
              style={fullInput}
            />
            <input
              value={preheader}
              onChange={(e) => setPreheader(e.target.value)}
              placeholder="Preheader (optional)"
              style={fullInput}
            />
            <textarea
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Email body"
              style={{
                ...fullInput,
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
            <input
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              placeholder="CTA line (optional)"
              style={{ ...fullInput, marginBottom: 14 }}
            />

            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                justifyContent: "flex-end",
                paddingTop: 12,
                borderTop: "1px solid #F1F5F9",
              }}
            >
              <label
                style={{
                  fontSize: "0.72rem",
                  color: "#374151",
                  marginRight: "auto",
                }}
              >
                <input
                  type="checkbox"
                  checked={autoExit}
                  onChange={(e) => setAutoExit(e.target.checked)}
                />{" "}
                Auto-unsubscribe when they leave the audience
              </label>
              {existing && (
                <button onClick={remove} style={dangerBtn}>
                  🗑 Remove
                </button>
              )}
              <button onClick={save} style={primaryBtn}>
                💾 Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
