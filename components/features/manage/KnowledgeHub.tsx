"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface RagDoc {
  id: number;
  title: string;
  kind: string;
  source: string;
  chars: number;
  chunk_count: number;
  status: string;
  updated_at: string;
}

interface Connector {
  id: string;
  label: string;
  connected: boolean;
  status: string;
  last_sync_at: string | null;
  items_synced: number;
  chunks_indexed: number;
  error: string | null;
}

const KIND_ICON: Record<string, string> = {
  pdf: "📄",
  docx: "📝",
  csv: "📊",
  txt: "📃",
  slack: "💬",
  notion: "📓",
  google_drive: "📁",
};

export default function KnowledgeHub() {
  const toast = useToast(); // (msg) => void
  const fileRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<RagDoc[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, c] = await Promise.all([
      apiGet<{ ok: boolean; items: RagDoc[] }>("/api/document-rag/documents?limit=60"),
      apiGet<{ ok: boolean; connectors: Connector[] }>("/api/enterprise-search/connectors"),
    ]);
    if (d.ok) setDocs(d.items || []);
    if (c.ok) setConnectors(c.connectors || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    const fd = new FormData();
    Array.from(files).slice(0, 5).forEach((f) => fd.append("files", f));
    try {
      const r = await fetch("/api/document-rag/upload", { method: "POST", body: fd, credentials: "same-origin" }).then((x) => x.json());
      if (!r.ok) {
        toast("❌ " + (r.error || "Upload failed"));
      } else {
        toast(`✅ Indexed ${r.uploaded} file(s) into Ask InfoGenie`);
        load();
      }
    } catch (e) {
      toast("❌ " + (e instanceof Error ? e.message : "upload error"));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function ingestPaste() {
    if (pasteText.trim().length < 20) {
      toast("⚠️ Paste at least a short paragraph");
      return;
    }
    setPasting(true);
    const r = await apiPost<{ ok: boolean; chunks?: number; error?: string }>("/api/document-rag/ingest-text", {
      title: pasteTitle || "Pasted note",
      text: pasteText,
    });
    setPasting(false);
    if (!r.ok) {
      toast("❌ " + (r.error || "failed"));
      return;
    }
    toast(`✅ Indexed ${r.chunks || 0} chunks`);
    setPasteText("");
    setPasteTitle("");
    load();
  }

  async function removeDoc(id: number) {
    if (!confirm("Remove this document from the knowledge index?")) return;
    await apiDelete(`/api/document-rag/documents/${id}`);
    load();
  }

  async function syncOne(id: string) {
    setSyncing(id);
    const r = await apiPost<{ ok: boolean; items?: number; chunks?: number; error?: string; hint?: string }>(
      `/api/enterprise-search/sync/${id}`,
      { limit: 20 },
    );
    setSyncing(null);
    if (!r.ok) {
      toast("❌ " + (r.error || "sync failed") + (r.hint ? ` — ${r.hint}` : ""));
    } else {
      toast(`✅ ${id}: ${r.items || 0} items · ${r.chunks || 0} chunks`);
    }
    load();
  }

  async function syncAll() {
    setSyncing("all");
    const r = await apiPost<{ ok: boolean; results?: Array<{ ok: boolean; connector?: string; error?: string }> }>(
      "/api/enterprise-search/sync-all",
      {},
    );
    setSyncing(null);
    const ok = (r.results || []).filter((x) => x.ok).length;
    toast(r.ok ? `✅ Synced ${ok} connector(s)` : "⚠️ No connectors synced — check Settings keys");
    load();
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Knowledge Hub
              </div>
              <h2 className="view-title">📚 Knowledge Hub</h2>
              <p className="view-sub">
                NotebookLM-class document RAG + Glean-class Slack / Notion / Drive search — all indexed into the same Ask InfoGenie retrieval layer.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 48 }}>
        {/* Document upload */}
        <section style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: "1.05rem", margin: "0 0 6px", color: "#0f172a" }}>Document RAG</h3>
          <p style={{ margin: "0 0 14px", fontSize: "0.84rem", color: "#64748b" }}>
            Upload PDF, DOCX, CSV, or TXT. Chunks are embedded and searchable alongside campaign data in Ask InfoGenie.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.csv,.txt,.md,application/pdf"
              multiple
              style={{ display: "none" }}
              onChange={(e) => onUpload(e.target.files)}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: 0,
                background: "linear-gradient(135deg,#0f766e,#0284c7)",
                color: "#fff",
                fontWeight: 700,
                fontSize: "0.82rem",
                cursor: uploading ? "wait" : "pointer",
              }}
            >
              {uploading ? "Indexing…" : "Upload documents"}
            </button>
            <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Max 5 files · 12MB each</span>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "minmax(160px, 220px) 1fr auto",
            gap: 8,
            marginBottom: 16,
          }}>
            <input
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder="Note title"
              style={{ padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.84rem" }}
            />
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Or paste brand docs, briefs, FAQs…"
              rows={2}
              style={{ padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.84rem", resize: "vertical" }}
            />
            <button
              type="button"
              disabled={pasting}
              onClick={ingestPaste}
              style={{
                padding: "9px 14px",
                borderRadius: 8,
                border: "1px solid #bae6fd",
                background: "#f0f9ff",
                color: "#0369a1",
                fontWeight: 700,
                fontSize: "0.8rem",
                cursor: "pointer",
                alignSelf: "start",
              }}
            >
              {pasting ? "…" : "Index text"}
            </button>
          </div>

          {loading && !docs.length ? (
            <div style={{ color: "#94a3b8", padding: 16 }}>Loading documents…</div>
          ) : !docs.length ? (
            <div style={{
              border: "1px dashed #cbd5e1",
              borderRadius: 10,
              padding: 28,
              textAlign: "center",
              color: "#64748b",
              fontSize: "0.88rem",
            }}>
              No documents indexed yet. Upload a PDF or paste a brief to get started.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {docs.map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 14px",
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    background: "#fff",
                  }}
                >
                  <span style={{ fontSize: "1.25rem" }}>{KIND_ICON[d.kind] || "📎"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>{d.title}</div>
                    <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                      {d.source} · {d.kind} · {d.chunk_count} chunks · {Math.round((d.chars || 0) / 1000)}k chars
                      {d.updated_at ? ` · ${new Date(d.updated_at).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDoc(d.id)}
                    style={{
                      border: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      borderRadius: 7,
                      padding: "5px 10px",
                      fontSize: "0.72rem",
                      cursor: "pointer",
                      color: "#64748b",
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Enterprise connectors */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ fontSize: "1.05rem", margin: "0 0 6px", color: "#0f172a" }}>Enterprise connectors</h3>
              <p style={{ margin: 0, fontSize: "0.84rem", color: "#64748b" }}>
                Sync Slack, Notion, and Google Drive into the same retrieval index (Glean-style workplace search).
              </p>
            </div>
            <button
              type="button"
              disabled={!!syncing}
              onClick={syncAll}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: 0,
                background: "linear-gradient(135deg,#0f766e,#0284c7)",
                color: "#fff",
                fontWeight: 700,
                fontSize: "0.78rem",
                cursor: syncing ? "wait" : "pointer",
              }}
            >
              {syncing === "all" ? "Syncing…" : "Sync all connected"}
            </button>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 12,
            marginTop: 16,
          }}>
            {connectors.map((c) => (
              <div
                key={c.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 16,
                  background: "#fff",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: "1.3rem" }}>{KIND_ICON[c.id] || "🔌"}</span>
                  <strong style={{ fontSize: "0.95rem", color: "#0f172a" }}>{c.label}</strong>
                  <span style={{
                    marginLeft: "auto",
                    fontSize: "0.65rem",
                    fontWeight: 800,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: c.connected ? "#ecfdf5" : "#f1f5f9",
                    color: c.connected ? "#047857" : "#64748b",
                  }}>
                    {c.connected ? "KEY SAVED" : "NOT CONNECTED"}
                  </span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 10, minHeight: 36 }}>
                  {c.error
                    ? `Error: ${c.error}`
                    : c.last_sync_at
                      ? `Last sync ${new Date(c.last_sync_at).toLocaleString()} · ${c.items_synced} items · ${c.chunks_indexed} chunks`
                      : "Connect the API key in Settings, then sync."}
                </div>
                <button
                  type="button"
                  disabled={!!syncing || !c.connected}
                  onClick={() => syncOne(c.id)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #bae6fd",
                    background: c.connected ? "#f0f9ff" : "#f8fafc",
                    color: c.connected ? "#0369a1" : "#94a3b8",
                    fontWeight: 700,
                    fontSize: "0.78rem",
                    cursor: c.connected && !syncing ? "pointer" : "not-allowed",
                  }}
                >
                  {syncing === c.id ? "Syncing…" : "Sync now"}
                </button>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 14, fontSize: "0.75rem", color: "#94a3b8" }}>
            Keys: Settings → Slack bot token · Notion integration secret · Google Drive OAuth access token (`google_drive`).
          </p>
        </section>
      </div>
    </div>
  );
}
