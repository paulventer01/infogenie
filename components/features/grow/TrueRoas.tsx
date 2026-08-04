"use client";

// Native React port of the legacy `true-roas` panel (was
// `window.buildTrueRoas` + `_tr*` helpers in public/js/ig_true_roas.js +
// `#view-true-roas` in index.html). Surfaces offline + online revenue ROAS,
// revenue-lag cohorts and settings against the existing Express API:
//   GET  /api/true-roas/summary?days=30
//   GET  /api/true-roas/settings
//   GET  /api/true-roas/conversions?limit=100
//   GET  /api/true-roas/revenue-lag?days=90
//   POST /api/true-roas/upload                       (multipart CSV)
//   POST /api/true-roas/sync-hubspot
//   DELETE /api/true-roas/conversions/:id
//   POST /api/true-roas/settings
//   POST /api/true-roas/budget-recommendations/run
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface CurrencyCount {
  currency: string;
  count: number;
}
interface Summary {
  trueRoas: number | null;
  reportedRoas: number | null;
  spend: number;
  online: { revenue: number };
  offline: {
    revenue: number;
    conversions: number;
    mixedCurrency?: boolean;
    currencies?: CurrencyCount[];
  };
}

interface Settings {
  hubspotSyncEnabled?: boolean;
  hubspotLookbackDays?: number;
  hubspotPipelineStages?: string[];
  budgetCapEnabled?: boolean;
  minTrueRoasThreshold?: number;
  scaleTrueRoasThreshold?: number;
}

interface Conversion {
  id: number;
  closed_at?: string | null;
  source?: string;
  platform?: string;
  email?: string;
  revenue?: number;
  currency?: string;
}

interface LagBucket {
  week: string;
  deals: number;
  revenue: number;
  avgDaysToClose: number;
}
interface Lag {
  buckets?: LagBucket[];
  avgDaysToClose?: number | null;
  totalDeals?: number;
  totalRevenue?: number;
}

interface SettingsResult {
  ok: boolean;
  error?: string;
  settings?: Settings;
  hubspotConfigured?: boolean;
}
interface ConversionsResult {
  ok: boolean;
  conversions?: Conversion[];
}

interface Status {
  color: string;
  text: string;
}

type Tab = "conversions" | "lag" | "settings";

const fmtUsd = (n: unknown) => "$" + Math.round(Number(n || 0)).toLocaleString();
const fmtMoney = (n: unknown) =>
  "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString() : "—";

function platBadge(p?: string) {
  const colors: Record<string, string> = {
    meta: "#1877F2",
    google: "#4285F4",
    tiktok: "#000",
    linkedin: "#0A66C2",
    unknown: "#94A3B8",
  };
  const c = colors[p || ""] || "#64748B";
  return (
    <span
      style={{
        background: c,
        color: "white",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: "0.7rem",
        fontWeight: 700,
      }}
    >
      {p || "unknown"}
    </span>
  );
}

function sourceBadge(s?: string) {
  const c = s === "hubspot" ? "#FF7A59" : s === "csv" ? "#0F766E" : "#64748B";
  return (
    <span
      style={{
        background: c,
        color: "white",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: "0.7rem",
        fontWeight: 700,
      }}
    >
      {s}
    </span>
  );
}

export default function TrueRoas() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("conversions");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [hubspotConfigured, setHubspotConfigured] = useState(false);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [lag, setLag] = useState<Lag>({});

  // Conversions tab local state
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState<Status | null>(null);
  const [syncStatus, setSyncStatus] = useState<Status | null>(null);

  // Settings tab controlled inputs
  const [hsEnabled, setHsEnabled] = useState(false);
  const [hsLookback, setHsLookback] = useState("90");
  const [hsStages, setHsStages] = useState("closedwon");
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [minThr, setMinThr] = useState("1.5");
  const [scaleThr, setScaleThr] = useState("4.0");
  const [settingsStatus, setSettingsStatus] = useState<Status | null>(null);

  function applySettings(s: Settings) {
    setSettings(s);
    setHsEnabled(!!s.hubspotSyncEnabled);
    setHsLookback(String(s.hubspotLookbackDays || 90));
    setHsStages((s.hubspotPipelineStages || ["closedwon"]).join(","));
    setBudgetEnabled(!!s.budgetCapEnabled);
    setMinThr(String(s.minTrueRoasThreshold ?? 1.5));
    setScaleThr(String(s.scaleTrueRoasThreshold ?? 4.0));
  }

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [sumR, settingsR, convR, lagR] = await Promise.all([
        apiGet<Summary & { ok?: boolean }>("/api/true-roas/summary?days=30"),
        apiGet<SettingsResult>("/api/true-roas/settings"),
        apiGet<ConversionsResult>("/api/true-roas/conversions?limit=100"),
        apiGet<Lag & { ok?: boolean }>("/api/true-roas/revenue-lag?days=90"),
      ]);
      setSummary(sumR);
      applySettings(settingsR.settings || {});
      setHubspotConfigured(!!settingsR.hubspotConfigured);
      setConversions(convR.conversions || []);
      setLag(lagR);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function upload() {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setUploadStatus({ color: "#B91C1C", text: "⚠️ Pick a CSV file first" });
      return;
    }
    setUploadStatus({ color: "#64748B", text: "⏳ Uploading…" });
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await fetch("/api/true-roas/upload", {
        method: "POST",
        credentials: "same-origin",
        body: fd,
      });
      const j = (await r.json()) as {
        ok: boolean;
        error?: string;
        parsed?: number;
        inserted?: number;
        skipped?: number;
      };
      if (!j.ok) throw new Error(j.error || "upload failed");
      setUploadStatus({
        color: "#059669",
        text: `✓ Parsed ${j.parsed}, inserted ${j.inserted}, updated ${j.skipped}`,
      });
      setTimeout(load, 600);
    } catch (e) {
      setUploadStatus({
        color: "#B91C1C",
        text: `⚠️ ${e instanceof Error ? e.message : "upload failed"}`,
      });
    }
  }

  async function syncHubspot() {
    setSyncStatus({ color: "#64748B", text: "⏳ Syncing HubSpot deals…" });
    const j = await apiPost<{
      ok: boolean;
      error?: string;
      scanned?: number;
      inserted?: number;
      skipped?: number;
    }>("/api/true-roas/sync-hubspot");
    if (!j.ok) {
      setSyncStatus({ color: "#B91C1C", text: `⚠️ ${j.error || "sync failed"}` });
      return;
    }
    setSyncStatus({
      color: "#059669",
      text: `✓ Scanned ${j.scanned}, inserted ${j.inserted}, updated ${j.skipped}`,
    });
    setTimeout(load, 600);
  }

  async function deleteConversion(id: number) {
    if (!confirm("Delete this conversion?")) return;
    await apiDelete("/api/true-roas/conversions/" + id);
    load();
  }

  async function saveSettings() {
    setSettingsStatus({ color: "#64748B", text: "⏳ Saving…" });
    const body = {
      hubspotSyncEnabled: hsEnabled,
      hubspotLookbackDays: parseInt(hsLookback, 10) || 90,
      hubspotPipelineStages: hsStages
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      budgetCapEnabled: budgetEnabled,
      minTrueRoasThreshold: parseFloat(minThr) || 1.5,
      scaleTrueRoasThreshold: parseFloat(scaleThr) || 4.0,
    };
    const j = await apiPost<SettingsResult>("/api/true-roas/settings", body);
    if (!j.ok) {
      setSettingsStatus({ color: "#B91C1C", text: `⚠️ ${j.error || "save failed"}` });
      return;
    }
    setSettingsStatus({ color: "#059669", text: "✓ Settings saved" });
    if (j.settings) setSettings(j.settings);
  }

  async function runBudgetRecs() {
    setSettingsStatus({
      color: "#64748B",
      text: "⏳ Generating budget recommendations…",
    });
    const j = await apiPost<{
      ok: boolean;
      error?: string;
      generated?: number;
      skipped?: string;
    }>("/api/true-roas/budget-recommendations/run");
    if (!j.ok) {
      setSettingsStatus({ color: "#B91C1C", text: `⚠️ ${j.error || "failed"}` });
      return;
    }
    if (j.skipped === "disabled") {
      setSettingsStatus({
        color: "#B45309",
        text: '⚠️ Enable "Profit-aware budget recommendations" first, then save.',
      });
      return;
    }
    setSettingsStatus({
      color: "#059669",
      text: `✓ Generated ${j.generated} recommendation${j.generated === 1 ? "" : "s"} (visible in Optimizer Decision Log)`,
    });
  }

  return (
    <div>
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> True ROAS
              </div>
              <h2 className="view-title">💰 True ROAS — Offline + Online Revenue</h2>
              <p className="view-sub">
                Pull closed-deal revenue from HubSpot or upload a CSV from your
                data warehouse so InfoGenie sees the money your ad platforms
                can&apos;t. Get your real ROAS (online + offline ÷ spend), watch
                how long leads actually take to close, and let the optimizer
                recommend budget cuts on campaigns where the true picture is
                unprofitable — even when Meta says they&apos;re winning.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 56 }}
      >
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "#64748B" }}>
            ⏳ Loading True ROAS…
          </div>
        ) : loadError ? (
          <div
            style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 14,
              padding: 24,
              color: "#991B1B",
            }}
          >
            ⚠️ Could not load: {loadError}
          </div>
        ) : (
          <>
            <Hero summary={summary} />
            <div style={{ margin: "24px 0 16px" }}>
              {(
                [
                  ["conversions", "📥 Conversions"],
                  ["lag", "⏱️ Revenue Lag"],
                  ["settings", "⚙️ Settings"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  style={{
                    padding: "10px 18px",
                    border: "none",
                    background: tab === id ? "#0066FF" : "#E2E8F0",
                    color: tab === id ? "white" : "#0F172A",
                    fontWeight: 700,
                    borderRadius: 10,
                    cursor: "pointer",
                    marginRight: 8,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div>
              {tab === "conversions" && (
                <ConversionsTab
                  conversions={conversions}
                  settings={settings}
                  hubspotConfigured={hubspotConfigured}
                  fileRef={fileRef}
                  uploadStatus={uploadStatus}
                  syncStatus={syncStatus}
                  onUpload={upload}
                  onSync={syncHubspot}
                  onDelete={deleteConversion}
                />
              )}
              {tab === "lag" && <LagTab lag={lag} />}
              {tab === "settings" && (
                <SettingsTab
                  hsEnabled={hsEnabled}
                  setHsEnabled={setHsEnabled}
                  hsLookback={hsLookback}
                  setHsLookback={setHsLookback}
                  hsStages={hsStages}
                  setHsStages={setHsStages}
                  budgetEnabled={budgetEnabled}
                  setBudgetEnabled={setBudgetEnabled}
                  minThr={minThr}
                  setMinThr={setMinThr}
                  scaleThr={scaleThr}
                  setScaleThr={setScaleThr}
                  status={settingsStatus}
                  onSave={saveSettings}
                  onRunRecs={runBudgetRecs}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Hero({ summary }: { summary: Summary | null }) {
  const s = summary || ({} as Summary);
  const uplift =
    s.reportedRoas && s.trueRoas
      ? +(((s.trueRoas / s.reportedRoas) - 1) * 100).toFixed(1)
      : null;
  const currencies = s.offline?.currencies || [];

  const tile = (
    label: string,
    value: string,
    sub?: string,
    color?: string,
  ) => (
    <div
      style={{
        background: "rgba(255,255,255,.06)",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 14,
        padding: 18,
      }}
    >
      <div
        style={{
          fontSize: "0.7rem",
          opacity: 0.7,
          fontWeight: 700,
          letterSpacing: ".5px",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.95rem",
          fontWeight: 800,
          lineHeight: 1.1,
          color: color || "white",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "0.66rem", opacity: 0.6, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );

  return (
    <div
      style={{
        background:
          "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
        borderRadius: 18,
        padding: "28px 32px",
        color: "#0f172a",
        boxShadow: "0 8px 28px rgba(6,78,59,.35)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: "1.4rem" }}>💰</span>
        <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>
          True ROAS — last 30 days
        </div>
        <span
          style={{ marginLeft: "auto", fontSize: "0.74rem", opacity: 0.7 }}
        >
          {s.offline?.conversions || 0} offline conversions tracked
          {s.offline?.mixedCurrency && (
            <>
              {" · "}
              <span
                style={{
                  background: "#FCD34D",
                  color: "#78350F",
                  padding: "2px 8px",
                  borderRadius: 6,
                  fontWeight: 700,
                }}
              >
                ⚠️ mixed currencies:{" "}
                {currencies.map((c) => c.currency).join(", ")}
              </span>
            </>
          )}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 18,
        }}
      >
        {tile(
          "True ROAS",
          s.trueRoas != null ? s.trueRoas.toFixed(2) + "×" : "—",
          uplift != null && uplift > 0
            ? `+${uplift}% vs reported`
            : "Online + offline ÷ spend",
          "#34D399",
        )}
        {tile(
          "Reported ROAS",
          s.reportedRoas != null ? s.reportedRoas.toFixed(2) + "×" : "—",
          "What ad platforms see",
        )}
        {tile("Online Revenue", fmtUsd(s.online?.revenue), "From ad platforms")}
        {tile(
          "Offline Revenue",
          fmtUsd(s.offline?.revenue),
          "From CRM / CSV",
          "#FCD34D",
        )}
        {tile("Total Spend", fmtUsd(s.spend), "Last 30d ad spend")}
      </div>
    </div>
  );
}

function ConversionsTab({
  conversions,
  settings,
  hubspotConfigured,
  fileRef,
  uploadStatus,
  syncStatus,
  onUpload,
  onSync,
  onDelete,
}: {
  conversions: Conversion[];
  settings: Settings;
  hubspotConfigured: boolean;
  fileRef: React.RefObject<HTMLInputElement>;
  uploadStatus: Status | null;
  syncStatus: Status | null;
  onUpload: () => void;
  onSync: () => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            padding: 20,
          }}
        >
          <h3 style={{ margin: "0 0 10px", fontSize: "1rem" }}>📤 Upload CSV</h3>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: "0.82rem",
              color: "#64748B",
            }}
          >
            Columns auto-detected: <code>deal_id</code>, <code>email</code>,{" "}
            <code>revenue</code>/<code>amount</code>, <code>currency</code>,{" "}
            <code>fbclid</code>/<code>gclid</code>/<code>ttclid</code>,{" "}
            <code>platform</code>, <code>closed_at</code>,{" "}
            <code>lead_created_at</code>.
          </p>
          <input
            type="file"
            ref={fileRef}
            accept=".csv"
            style={{ marginBottom: 10, fontSize: "0.85rem" }}
          />
          <button
            onClick={onUpload}
            style={{
              background: "linear-gradient(135deg,#0066FF,#00C9C8)",
              color: "white",
              border: "none",
              padding: "10px 18px",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📤 Upload
          </button>
          {uploadStatus && (
            <div
              style={{
                marginTop: 10,
                fontSize: "0.82rem",
                color: uploadStatus.color,
              }}
            >
              {uploadStatus.text}
            </div>
          )}
        </div>
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            padding: 20,
          }}
        >
          <h3 style={{ margin: "0 0 10px", fontSize: "1rem" }}>
            🔄 Sync HubSpot
          </h3>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: "0.82rem",
              color: "#64748B",
            }}
          >
            Pulls closed-won deals from the last{" "}
            {settings.hubspotLookbackDays || 90} days.{" "}
            {hubspotConfigured ? (
              <b style={{ color: "#059669" }}>✓ Token configured</b>
            ) : (
              <b style={{ color: "#B91C1C" }}>
                ⚠️ HUBSPOT_PRIVATE_APP_TOKEN missing
              </b>
            )}
            .
          </p>
          <button
            onClick={onSync}
            disabled={!hubspotConfigured}
            style={{
              background: "#FF7A59",
              color: "white",
              border: "none",
              padding: "10px 18px",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
              opacity: hubspotConfigured ? 1 : 0.5,
            }}
          >
            🔄 Sync now
          </button>
          {syncStatus && (
            <div
              style={{
                marginTop: 10,
                fontSize: "0.82rem",
                color: syncStatus.color,
              }}
            >
              {syncStatus.text}
            </div>
          )}
        </div>
      </div>
      <h3 style={{ margin: "18px 0 10px", fontSize: "1rem" }}>
        📋 Recent conversions ({conversions.length})
      </h3>
      {conversions.length === 0 ? (
        <div
          style={{
            padding: 48,
            textAlign: "center",
            color: "#64748B",
            background: "#F8FAFC",
            borderRadius: 12,
          }}
        >
          No offline conversions yet. Upload a CSV or sync HubSpot below.
        </div>
      ) : (
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.85rem",
            }}
          >
            <thead>
              <tr style={{ background: "#F8FAFC", textAlign: "left" }}>
                <th style={{ padding: 10 }}>Closed</th>
                <th style={{ padding: 10 }}>Source</th>
                <th style={{ padding: 10 }}>Platform</th>
                <th style={{ padding: 10 }}>Email</th>
                <th style={{ padding: 10, textAlign: "right" }}>Revenue</th>
                <th style={{ padding: 10, textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {conversions.map((c) => (
                <tr key={c.id}>
                  <td
                    style={{ padding: 10, borderBottom: "1px solid #E2E8F0" }}
                  >
                    {fmtDate(c.closed_at)}
                  </td>
                  <td
                    style={{ padding: 10, borderBottom: "1px solid #E2E8F0" }}
                  >
                    {sourceBadge(c.source)}
                  </td>
                  <td
                    style={{ padding: 10, borderBottom: "1px solid #E2E8F0" }}
                  >
                    {platBadge(c.platform)}
                  </td>
                  <td
                    style={{ padding: 10, borderBottom: "1px solid #E2E8F0" }}
                  >
                    {c.email || "—"}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #E2E8F0",
                      textAlign: "right",
                      fontWeight: 700,
                    }}
                  >
                    {fmtMoney(c.revenue)}{" "}
                    <span
                      style={{
                        opacity: 0.5,
                        fontWeight: 400,
                        fontSize: ".75rem",
                      }}
                    >
                      {c.currency || ""}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #E2E8F0",
                      textAlign: "right",
                    }}
                  >
                    <button
                      onClick={() => onDelete(Number(c.id))}
                      style={{
                        background: "transparent",
                        border: "1px solid #FCA5A5",
                        color: "#B91C1C",
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: "0.72rem",
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LagTab({ lag }: { lag: Lag }) {
  const buckets = lag.buckets || [];
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            padding: 18,
          }}
        >
          <div
            style={{
              fontSize: "0.72rem",
              color: "#64748B",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Avg days to close
          </div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: 4 }}>
            {(lag.avgDaysToClose || 0).toFixed(1)}d
          </div>
        </div>
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            padding: 18,
          }}
        >
          <div
            style={{
              fontSize: "0.72rem",
              color: "#64748B",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Total deals (90d)
          </div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: 4 }}>
            {lag.totalDeals || 0}
          </div>
        </div>
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            padding: 18,
          }}
        >
          <div
            style={{
              fontSize: "0.72rem",
              color: "#64748B",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Total revenue (90d)
          </div>
          <div
            style={{
              fontSize: "1.8rem",
              fontWeight: 800,
              marginTop: 4,
              color: "#059669",
            }}
          >
            {fmtUsd(lag.totalRevenue)}
          </div>
        </div>
      </div>
      <h3 style={{ margin: "18px 0 10px", fontSize: "1rem" }}>
        📅 Weekly cohorts (lead-creation week)
      </h3>
      {buckets.length ? (
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.85rem",
            }}
          >
            <thead>
              <tr style={{ background: "#F8FAFC", textAlign: "left" }}>
                <th style={{ padding: 10 }}>Week of</th>
                <th style={{ padding: 10, textAlign: "right" }}>
                  Deals closed
                </th>
                <th style={{ padding: 10, textAlign: "right" }}>Revenue</th>
                <th style={{ padding: 10, textAlign: "right" }}>
                  Avg time-to-close
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b, i) => (
                <tr key={i}>
                  <td
                    style={{ padding: 10, borderBottom: "1px solid #E2E8F0" }}
                  >
                    {new Date(b.week).toLocaleDateString()}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #E2E8F0",
                      textAlign: "right",
                    }}
                  >
                    {b.deals}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #E2E8F0",
                      textAlign: "right",
                      fontWeight: 700,
                    }}
                  >
                    {fmtUsd(b.revenue)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #E2E8F0",
                      textAlign: "right",
                    }}
                  >
                    {b.avgDaysToClose}d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          style={{
            padding: 48,
            textAlign: "center",
            color: "#64748B",
            background: "#F8FAFC",
            borderRadius: 12,
          }}
        >
          No lag data yet. Upload conversions with <code>lead_created_at</code>{" "}
          populated to see how long deals take to close.
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  hsEnabled,
  setHsEnabled,
  hsLookback,
  setHsLookback,
  hsStages,
  setHsStages,
  budgetEnabled,
  setBudgetEnabled,
  minThr,
  setMinThr,
  scaleThr,
  setScaleThr,
  status,
  onSave,
  onRunRecs,
}: {
  hsEnabled: boolean;
  setHsEnabled: (v: boolean) => void;
  hsLookback: string;
  setHsLookback: (v: string) => void;
  hsStages: string;
  setHsStages: (v: string) => void;
  budgetEnabled: boolean;
  setBudgetEnabled: (v: boolean) => void;
  minThr: string;
  setMinThr: (v: string) => void;
  scaleThr: string;
  setScaleThr: (v: string) => void;
  status: Status | null;
  onSave: () => void;
  onRunRecs: () => void;
}) {
  const inputBox: React.CSSProperties = {
    padding: 8,
    border: "1px solid #CBD5E1",
    borderRadius: 6,
  };
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E2E8F0",
        borderRadius: 14,
        padding: 24,
        maxWidth: 680,
      }}
    >
      <h3 style={{ margin: "0 0 18px", fontSize: "1.05rem" }}>
        ⚙️ True ROAS Settings
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={hsEnabled}
            onChange={(e) => setHsEnabled(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <div>
            <b>Auto-sync HubSpot</b>
            <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
              Pull closed deals every 6 hours
            </div>
          </div>
        </label>
        <div>
          <label
            style={{
              display: "block",
              fontWeight: 700,
              fontSize: "0.85rem",
              marginBottom: 6,
            }}
          >
            HubSpot lookback (days)
          </label>
          <input
            type="number"
            value={hsLookback}
            onChange={(e) => setHsLookback(e.target.value)}
            min={1}
            max={365}
            style={{ ...inputBox, width: 120 }}
          />
        </div>
        <div>
          <label
            style={{
              display: "block",
              fontWeight: 700,
              fontSize: "0.85rem",
              marginBottom: 6,
            }}
          >
            HubSpot pipeline stages (comma-separated)
          </label>
          <input
            type="text"
            value={hsStages}
            onChange={(e) => setHsStages(e.target.value)}
            style={{ ...inputBox, width: "100%" }}
          />
          <div
            style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 4 }}
          >
            Default: <code>closedwon</code>. Use HubSpot stage IDs.
          </div>
        </div>
        <hr
          style={{
            border: "none",
            borderTop: "1px solid #E2E8F0",
            margin: "8px 0",
          }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={budgetEnabled}
            onChange={(e) => setBudgetEnabled(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <div>
            <b>Profit-aware budget recommendations</b>
            <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
              Optimizer suggests budget cuts/scales based on True ROAS
              (recommendation-only, never auto-applied).
            </div>
          </div>
        </label>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div>
            <label
              style={{
                display: "block",
                fontWeight: 700,
                fontSize: "0.85rem",
                marginBottom: 6,
              }}
            >
              Cut threshold (True ROAS &lt;)
            </label>
            <input
              type="number"
              value={minThr}
              onChange={(e) => setMinThr(e.target.value)}
              step={0.1}
              min={0}
              style={{ ...inputBox, width: 120 }}
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontWeight: 700,
                fontSize: "0.85rem",
                marginBottom: 6,
              }}
            >
              Scale threshold (True ROAS ≥)
            </label>
            <input
              type="number"
              value={scaleThr}
              onChange={(e) => setScaleThr(e.target.value)}
              step={0.1}
              min={0}
              style={{ ...inputBox, width: 120 }}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button
            onClick={onSave}
            style={{
              background: "linear-gradient(135deg,#0066FF,#00C9C8)",
              color: "white",
              border: "none",
              padding: "10px 18px",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            💾 Save settings
          </button>
          <button
            onClick={onRunRecs}
            style={{
              background: "#7C3AED",
              color: "white",
              border: "none",
              padding: "10px 18px",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🤖 Run budget recommendations now
          </button>
        </div>
        {status && (
          <div
            style={{ fontSize: "0.85rem", marginTop: 6, color: status.color }}
          >
            {status.text}
          </div>
        )}
      </div>
    </div>
  );
}
