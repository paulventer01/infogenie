"use client";

// Native React port of the legacy `audience-ad-sync` panel (was
// `window.buildAudienceAdSync` in public/js/ig_customer_engagement.js +
// `#view-audience-ad-sync`). Pushes InfoGenie segments to Meta / Google ad
// platforms and checks sync status via the existing Express API
// (`POST`/`GET /api/audiences/{id}/sync-ads`) through lib/api.

import { useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface SyncResponse {
  ok: boolean;
  error?: string;
  note?: string;
  synced?: number;
  audience_name?: string;
  instructions?: string;
}
interface StatusResponse {
  ok: boolean;
  error?: string;
  member_count?: number;
  meta_configured?: boolean;
  google_configured?: boolean;
}

export default function AudienceAdSync() {
  const toast = useToast();
  const [segId, setSegId] = useState("");
  const [platform, setPlatform] = useState("meta");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResponse | null>(null);

  const [statusId, setStatusId] = useState("");
  const [status, setStatus] = useState<StatusResponse | null>(null);

  async function sync() {
    if (!segId.trim()) {
      toast("Enter a segment ID.");
      return;
    }
    setSyncing(true);
    const d = await apiPost<SyncResponse>(
      `/api/audiences/${segId.trim()}/sync-ads`,
      { platform },
    );
    setSyncing(false);
    setSyncResult(d);
    if (d.ok) toast("Sync complete!");
  }

  async function checkStatus() {
    if (!statusId.trim()) {
      toast("Enter a segment ID.");
      return;
    }
    const d = await apiGet<StatusResponse>(
      `/api/audiences/${statusId.trim()}/sync-ads`,
    );
    setStatus(d);
  }

  return (
    <div>
      <div className="view-header">
        <h2>📡 Audience → Ad Platform Sync</h2>
        <p className="view-sub">
          Push your InfoGenie segments directly to Meta Custom Audiences or
          Google Customer Match for paid retargeting.
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          maxWidth: 1100,
        }}
      >
        <div className="ig-card">
          <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>Sync a Segment</h3>
          <div className="form-group">
            <label>Segment ID</label>
            <input
              className="form-control"
              placeholder="e.g. 42 — get IDs from Dynamic Audiences"
              value={segId}
              onChange={(e) => setSegId(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Platform</label>
            <select
              className="form-control"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              <option value="meta">Meta (Facebook / Instagram)</option>
              <option value="google">Google Customer Match</option>
            </select>
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 8 }}
            disabled={syncing}
            onClick={sync}
          >
            {syncing ? "⏳ Syncing…" : "🚀 Sync to Ad Platform"}
          </button>
          <div style={{ marginTop: 14 }}>
            {syncResult &&
              (syncResult.ok ? (
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: 8,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#15803d",
                      marginBottom: 8,
                    }}
                  >
                    ✅ Sync Complete
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#374151" }}>
                    {syncResult.note ||
                      `${syncResult.synced} contacts pushed to ${platform}`}
                  </div>
                  {syncResult.audience_name ? (
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "#6b7280",
                        marginTop: 4,
                      }}
                    >
                      Audience: <strong>{syncResult.audience_name}</strong>
                    </div>
                  ) : null}
                  {syncResult.instructions ? (
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#6b7280",
                        marginTop: 8,
                        fontStyle: "italic",
                      }}
                    >
                      {syncResult.instructions}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fca5a5",
                    borderRadius: 8,
                    padding: 12,
                    color: "#b91c1c",
                    fontSize: "0.85rem",
                  }}
                >
                  ⚠️ {syncResult.error || "Sync failed"}
                </div>
              ))}
          </div>
        </div>
        <div className="ig-card">
          <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>Sync Status</h3>
          <div className="form-group">
            <label>Check Segment ID</label>
            <input
              className="form-control"
              placeholder="Segment ID"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
            />
          </div>
          <button
            style={{
              padding: "8px 18px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
            }}
            onClick={checkStatus}
          >
            🔍 Check Status
          </button>
          <div style={{ marginTop: 14 }}>
            {status === null ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: "#94a3b8",
                  fontSize: "0.9rem",
                }}
              >
                Enter a segment ID to check sync status.
              </div>
            ) : !status.ok ? (
              <div style={{ color: "#b91c1c", fontSize: "0.85rem" }}>
                ⚠️ {status.error || "Error"}
              </div>
            ) : (
              <div style={{ fontSize: "0.85rem" }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>{status.member_count || 0}</strong> members eligible
                  for sync
                </div>
                <div style={{ color: "#6b7280" }}>
                  Meta creds:{" "}
                  {status.meta_configured ? "✅ Configured" : "❌ Not configured"}
                </div>
                <div style={{ color: "#6b7280" }}>
                  Google creds:{" "}
                  {status.google_configured
                    ? "✅ Configured"
                    : "❌ Not configured"}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
