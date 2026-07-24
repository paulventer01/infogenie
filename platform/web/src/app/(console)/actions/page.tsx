"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type ActionRow } from "@/lib/api";
import GateChecklist from "@/components/GateChecklist";

export default function ActionsPage() {
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = () =>
    api.actions().then((r) => { setActions(r.actions); setLoaded(true); }).catch(() => setLoaded(true));

  useEffect(() => { refresh(); }, []);

  async function approve(id: string) {
    setError(null);
    try {
      await api.approve(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403
        ? "Approving actions requires the send:approve permission (operator or owner role)."
        : err instanceof Error ? err.message : "Approval failed");
    }
  }

  const pending = actions.filter((a) => a.status === "pending_approval");
  const rest = actions.filter((a) => a.status !== "pending_approval");

  if (!loaded) return null;

  return (
    <>
      <h1 className="page-title">Actions &amp; Approvals</h1>
      <p className="page-sub">
        The governed action pipeline, visible: what is waiting on a human, what executed, and what the
        gate refused — with every rejection reason surfaced here, not buried in logs.
      </p>
      {error && <div className="banner block">{error}</div>}

      <div className="stack">
        <div className="card">
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Awaiting approval ({pending.length})</h2>
          {pending.length === 0 ? (
            <div className="empty">Nothing waiting. Runs at A0–A2 will queue here for a human decision.</div>
          ) : (
            <div className="rows">
              {pending.map((a) => (
                <div key={a.id}>
                  <div className="rowline">
                    <div>
                      <div className="t">{a.capability_key}</div>
                      <div className="s">A{a.autonomy_level} · {new Date(a.created_at).toLocaleString()} · {a.id.slice(0, 8)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn small" onClick={() => setOpen(open === a.id ? null : a.id)}>
                        {open === a.id ? "Hide gate" : "Gate detail"}
                      </button>
                      <button className="btn small primary" onClick={() => approve(a.id)}>Approve &amp; execute</button>
                    </div>
                  </div>
                  {open === a.id && <div style={{ padding: "4px 0 14px" }}><GateChecklist gate={a.gate} /></div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>History</h2>
          {rest.length === 0 ? (
            <div className="empty">No decided actions yet.</div>
          ) : (
            <div className="rows">
              {rest.map((a) => (
                <div key={a.id}>
                  <div className="rowline">
                    <div>
                      <div className="t">{a.capability_key}</div>
                      <div className="s">
                        A{a.autonomy_level} · {new Date(a.created_at).toLocaleString()}
                        {a.status === "blocked" && a.gate.reason ? ` — ${a.gate.reason}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button className="btn small" onClick={() => setOpen(open === a.id ? null : a.id)}>
                        {open === a.id ? "Hide gate" : "Gate detail"}
                      </button>
                      <span className={`pill ${a.status}`}>{a.status.replace("_", " ")}</span>
                    </div>
                  </div>
                  {open === a.id && <div style={{ padding: "4px 0 14px" }}><GateChecklist gate={a.gate} /></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
