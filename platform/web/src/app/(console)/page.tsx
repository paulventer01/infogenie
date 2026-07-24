"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ActionRow, type Brand, type Capability } from "@/lib/api";

export default function OverviewPage() {
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      api.actions().then((r) => setActions(r.actions)),
      api.capabilities().then((r) => setCapabilities(r.capabilities)),
      api.brand().then((r) => setBrand(r.brand)),
    ]).then(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  const pending = actions.filter((a) => a.status === "pending_approval").length;
  const blocked = actions.filter((a) => a.status === "blocked").length;
  const executed = actions.filter((a) => a.status === "executed").length;

  return (
    <>
      <h1 className="page-title">Overview</h1>
      <p className="page-sub">
        The state of this tenant&apos;s governed operation: what ran, what&apos;s waiting on a human,
        and what the gate refused — with the reason for every refusal.
      </p>

      {!brand && (
        <div className="banner block">
          No Brand Foundation exists for this tenant yet — generation is blocked until brand
          onboarding is complete. <Link href="/brand" style={{ textDecoration: "underline" }}>Set it up now →</Link>
        </div>
      )}

      <div className="grid-stats">
        <div className="card stat"><div className="k">Awaiting approval</div><div className="v">{pending}</div></div>
        <div className="card stat"><div className="k">Executed</div><div className="v">{executed}</div></div>
        <div className="card stat"><div className="k">Blocked by the gate</div><div className="v">{blocked}</div></div>
        <div className="card stat">
          <div className="k">Brand Foundation</div>
          <div className="v">{brand ? <>v{brand.version}</> : <small>not set</small>}</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Capability autonomy</h2>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
            Per capability, per tenant. Promotion is earned on evidence; irreversible actions never exceed A2.
          </p>
          <div className="rows">
            {capabilities.map((c) => (
              <div className="rowline" key={c.key}>
                <div>
                  <div className="t">{c.name}</div>
                  <div className="s">{c.domain} · {c.archetype}{c.irreversible ? " · irreversible" : ""}</div>
                </div>
                <span className="pill level">A{c.level} / ceiling A{c.irreversible ? Math.min(c.autonomy_ceiling, 2) : c.autonomy_ceiling}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Recent actions</h2>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
            The audit-backed action history — every run, its autonomy level and its outcome.
          </p>
          {actions.length === 0 ? (
            <div className="empty">Nothing yet. Run a capability from the Studio.</div>
          ) : (
            <div className="rows">
              {actions.slice(0, 6).map((a) => (
                <div className="rowline" key={a.id}>
                  <div>
                    <div className="t">{a.capability_key}</div>
                    <div className="s">A{a.autonomy_level} · {new Date(a.created_at).toLocaleString()}</div>
                  </div>
                  <span className={`pill ${a.status}`}>{a.status.replace("_", " ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
