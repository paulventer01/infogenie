"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Integration } from "@/lib/api";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  live: { label: "available", cls: "pass" },
  pending: { label: "pending", cls: "pending_approval" },
  blocked: { label: "blocked", cls: "blocked" },
  not_integrated: { label: "not integrated", cls: "not_applicable" },
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = () =>
    api.integrations().then((r) => { setIntegrations(r.integrations); setLoaded(true); }).catch(() => setLoaded(true));

  useEffect(() => { refresh(); }, []);

  async function connect(key: string) {
    setError(null);
    try {
      await api.saveIntegrationCredential(key, secret);
      setSecret(""); setOpen(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403
        ? "Storing connector credentials requires the tenant:admin permission (owner role)."
        : err instanceof Error ? err.message : "Failed to store credential");
    }
  }

  if (!loaded) return null;
  const live = integrations.filter((i) => i.status === "live");
  const rest = integrations.filter((i) => i.status !== "live");

  const row = (i: Integration, connectable: boolean) => (
    <div key={i.key}>
      <div className="rowline">
        <div>
          <div className="t">{i.name}</div>
          <div className="s">
            {i.purpose} · powers {i.capability_count} capabilit{i.capability_count === 1 ? "y" : "ies"}
            {i.reason ? ` — ${i.reason}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {i.connected && <span className="pill executed">connected ····{i.secret_hint}</span>}
          {!i.connected && connectable && i.auth_kind !== "none" && (
            <button className="btn small" onClick={() => { setOpen(open === i.key ? null : i.key); setSecret(""); }}>
              {open === i.key ? "Cancel" : "Connect"}
            </button>
          )}
          {i.auth_kind === "none" && !i.connected && <span className="pill na">no key needed</span>}
          <span className={`pill ${STATUS_LABEL[i.status]?.cls ?? "na"}`}>{STATUS_LABEL[i.status]?.label ?? i.status}</span>
        </div>
      </div>
      {open === i.key && (
        <div style={{ display: "flex", gap: 10, padding: "2px 0 14px", alignItems: "center" }}>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={`${i.name} API key — stored encrypted, write-only`}
            style={{ maxWidth: 420 }}
          />
          <button className="btn small primary" onClick={() => connect(i.key)} disabled={secret.length < 8}>
            Save credential
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <h1 className="page-title">Integrations</h1>
      <p className="page-sub">
        The integration landscape from the platform reference: {live.length} providers available,
        {" "}{rest.length} recorded as pending, blocked or deliberately not built — with the reason,
        because the reason determines whether the gap is worth closing. Credentials are tenant-scoped,
        encrypted, and write-only: stored once, never displayed again. Until a live adapter and
        credential are present, capabilities run on clearly-labelled simulated evidence.
      </p>
      {error && <div className="banner block">{error}</div>}

      <div className="stack">
        <div className="card">
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Providers ({live.length})</h2>
          <div className="rows">{live.map((i) => row(i, true))}</div>
        </div>
        <div className="card">
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Not connected — with the reason ({rest.length})</h2>
          <div className="rows">{rest.map((i) => row(i, false))}</div>
        </div>
      </div>
    </>
  );
}
