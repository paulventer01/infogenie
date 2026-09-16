"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import ContentSafetyWarnings from "@/components/layout/ContentSafetyWarnings";
import type { SocialDraft } from "./SocialCalendarView";

interface Props {
  onEditDraft?: (d: SocialDraft) => void;
  refreshKey?: number;
}

function selfHealMeta(d: SocialDraft): { healed?: boolean; passed?: boolean; final_verdict?: string; attempts?: number } | null {
  const m = d.meta?.self_heal;
  if (!m || typeof m !== "object") return null;
  return m as { healed?: boolean; passed?: boolean; final_verdict?: string; attempts?: number };
}

export default function SocialApprovalsPanel({ onEditDraft, refreshKey = 0 }: Props) {
  const [drafts, setDrafts] = useState<SocialDraft[]>([]);
  const [requireApproval, setRequireApproval] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftWarnings, setDraftWarnings] = useState<Record<number, string[]>>({});
  const [note, setNote] = useState("");
  const approveRequestRef = useRef(0);

  const load = useCallback(async () => {
    const [q, s] = await Promise.all([
      apiGet<{ ok: boolean; drafts?: SocialDraft[]; error?: string }>("/api/social-drafts/approvals/queue"),
      apiGet<{ ok: boolean; settings?: { require_approval?: boolean } }>("/api/social-drafts/settings"),
    ]);
    if (q.ok) {
      const rows = q.drafts || [];
      setDrafts(rows);
      setDraftWarnings((prev) => {
        const next = { ...prev };
        for (const d of rows) {
          if (d.content_safety_warnings?.length) next[d.id] = d.content_safety_warnings;
        }
        return next;
      });
    } else setError(q.error || "Failed to load queue");
    if (s.ok) setRequireApproval(!!s.settings?.require_approval);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function toggleRequire(next: boolean) {
    setRequireApproval(next);
    await apiPut("/api/social-drafts/settings", { require_approval: next });
  }

  async function approve(id: number) {
    const reqSeq = approveRequestRef.current + 1;
    approveRequestRef.current = reqSeq;
    const priorWarnings = draftWarnings[id] || drafts.find((d) => d.id === id)?.content_safety_warnings || [];
    setBusy(id);
    setError(null);
    const r = await apiPost<{
      ok: boolean;
      error?: string;
      userMessage?: string;
      content_safety_warnings?: string[];
      draft?: SocialDraft;
    }>(`/api/social-drafts/${id}/approve`, { notes: note || null });
    if (approveRequestRef.current !== reqSeq) return;
    setBusy(null);
    if (!r.ok) {
      const code = r.error || "";
      if (code === "content_safety_blocked" || code === "content_safety_block" || code === "content_safety_unavailable") {
        setError(String(r.userMessage || r.error || "Approval blocked by content safety checks."));
        setDraftWarnings((prev) => ({ ...prev, [id]: priorWarnings }));
        return;
      }
      setError(r.error || "Approve failed");
      setDraftWarnings((prev) => ({ ...prev, [id]: priorWarnings }));
      return;
    }
    const warnings = r.content_safety_warnings || r.draft?.content_safety_warnings || [];
    if (warnings.length) setDraftWarnings((prev) => ({ ...prev, [id]: warnings }));
    setNote("");
    load();
  }

  async function reject(id: number) {
    setBusy(id);
    const r = await apiPost<{ ok: boolean; error?: string }>(`/api/social-drafts/${id}/reject`, { notes: note || null });
    setBusy(null);
    if (!r.ok) {
      setError(r.error || "Reject failed");
      return;
    }
    setNote("");
    load();
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: "Sora,sans-serif", fontSize: "0.95rem", color: "#0A1628" }}>
            ✅ Approvals
          </h3>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            Self-heal runs before review · then approve to publish
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", fontWeight: 700, color: "#374151", cursor: "pointer" }}>
          <input type="checkbox" checked={requireApproval} onChange={(e) => toggleRequire(e.target.checked)} />
          Require approval before publish
        </label>
      </div>

      {error ? (
        <div role="alert" style={{ color: "#991B1B", background: "#FEF2F2", border: "1px solid #FECACA", padding: 8, borderRadius: 6, fontSize: "0.78rem", marginBottom: 8 }}>
          ⚠ {error}
        </div>
      ) : null}

      <div style={{ marginBottom: 12 }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reviewer notes (optional)"
          style={{ width: "100%", padding: 8, border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.78rem", boxSizing: "border-box" }}
        />
      </div>

      {!drafts.length ? (
        <div style={{ color: "#9CA3AF", fontSize: "0.82rem", fontStyle: "italic" }}>
          No drafts pending approval. Submit a draft from Compose → “Submit for approval”.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {drafts.map((d) => {
            const sh = selfHealMeta(d);
            return (
              <div key={d.id} style={{ border: "1px solid #FED7AA", background: "#FFF7ED", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: "0.82rem", color: "#0A1628", lineHeight: 1.45, marginBottom: 8 }}>
                  {(d.text || "").slice(0, 220)}
                  {(d.text || "").length > 220 ? "…" : ""}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#9A3412", marginBottom: 6 }}>
                  {(d.platforms || []).join(" · ")}
                  {d.scheduled_for ? ` · ${new Date(d.scheduled_for).toLocaleString()}` : ""}
                </div>
                {sh && (
                  <div
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      marginBottom: 8,
                      color: sh.passed ? "#065F46" : sh.final_verdict === "fail" ? "#991B1B" : "#92400E",
                      background: sh.passed ? "#ECFDF5" : sh.final_verdict === "fail" ? "#FEF2F2" : "#FFFBEB",
                      display: "inline-block",
                      padding: "3px 8px",
                      borderRadius: 4,
                    }}
                  >
                    Self-heal: {sh.passed ? "passed" : sh.final_verdict || "caution"}
                    {sh.healed ? " · text rewritten" : ""}
                    {sh.attempts != null ? ` · ${sh.attempts} attempt(s)` : ""}
                  </div>
                )}
                <ContentSafetyWarnings warnings={draftWarnings[d.id] || d.content_safety_warnings || []} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" disabled={busy === d.id} onClick={() => approve(d.id)} style={btn("#0D9488", "#fff")}>
                    Approve &amp; publish
                  </button>
                  <button type="button" disabled={busy === d.id} onClick={() => reject(d.id)} style={btn("#FEF2F2", "#991B1B")}>
                    Reject
                  </button>
                  <button type="button" onClick={() => onEditDraft?.(d)} style={btn("#F3F4F6", "#374151")}>
                    View
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function btn(bg: string, color: string): CSSProperties {
  return {
    background: bg,
    color,
    border: "1px solid transparent",
    padding: "7px 12px",
    borderRadius: 6,
    fontSize: "0.74rem",
    fontWeight: 800,
    cursor: "pointer",
  };
}
