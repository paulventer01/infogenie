"use client";

// Native React port of the legacy `email-designer` panel (was
// `window.buildEmailDesigner` in public/js/ig_customer_engagement.js +
// `#view-email-designer`). Block-based visual email builder against the existing
// Express API (`GET/POST /api/email-designer/templates`,
// `GET/DELETE /api/email-designer/templates/:id`) via lib/api.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

type BlockType = "header" | "text" | "image" | "button" | "divider" | "spacer" | "footer";

interface Block {
  type: BlockType;
  data: Record<string, string | number>;
}
interface TemplateRow {
  id: string;
  name: string;
}
interface TemplatesResp {
  ok: boolean;
  error?: string;
  templates?: TemplateRow[];
}
interface TemplateResp {
  ok: boolean;
  error?: string;
  template?: { name: string; blocks?: Block[] };
}

const BLOCK_TYPES: { type: BlockType; icon: string; label: string }[] = [
  { type: "header", icon: "🔷", label: "Header" },
  { type: "text", icon: "📝", label: "Text Block" },
  { type: "image", icon: "🖼️", label: "Image" },
  { type: "button", icon: "🔘", label: "Button" },
  { type: "divider", icon: "➖", label: "Divider" },
  { type: "spacer", icon: "⬜", label: "Spacer" },
  { type: "footer", icon: "📄", label: "Footer" },
];

const DEFAULTS: Record<BlockType, Record<string, string | number>> = {
  header: { text: "Your Brand Name", bg_color: "#1e293b", text_color: "#ffffff", font_size: 24, align: "center" },
  text: { content: "Write your email content here. Keep it clear and concise.", font_size: 14, text_color: "#374151", align: "left", padding: 16 },
  image: { src: "https://via.placeholder.com/600x200?text=Your+Image", alt: "Image", width: "100%", link: "" },
  button: { label: "Click Here", url: "#", bg_color: "#6366f1", text_color: "#ffffff", align: "center", border_radius: 8 },
  divider: { color: "#e2e8f0", thickness: 1, margin: 16 },
  spacer: { height: 24 },
  footer: { text: "You received this email because you signed up for updates.\n© 2026 Your Company · Unsubscribe", font_size: 11, text_color: "#9ca3af", align: "center" },
};

function esc(s: unknown) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

function blockPreview(b: Block): string {
  const d = b.data;
  switch (b.type) {
    case "header":
      return `<div style="background:${esc(d.bg_color)};color:${esc(d.text_color)};text-align:${esc(d.align)};padding:24px;font-size:${d.font_size}px;font-weight:700">${esc(d.text)}</div>`;
    case "text":
      return `<div style="padding:${d.padding}px;font-size:${d.font_size}px;color:${esc(d.text_color)};text-align:${esc(d.align)};line-height:1.6">${esc(d.content).replace(/\n/g, "<br>")}</div>`;
    case "image":
      return `<div style="text-align:${esc(d.align || "center")}"><img src="${esc(d.src)}" alt="${esc(d.alt)}" style="width:${esc(d.width)};max-width:100%;height:auto"></div>`;
    case "button":
      return `<div style="text-align:${esc(d.align)};padding:16px"><a href="${esc(d.url)}" style="display:inline-block;background:${esc(d.bg_color)};color:${esc(d.text_color)};padding:12px 28px;border-radius:${d.border_radius}px;text-decoration:none;font-weight:700;font-size:14px">${esc(d.label)}</a></div>`;
    case "divider":
      return `<div style="margin:${d.margin}px 0"><hr style="border:none;border-top:${d.thickness}px solid ${esc(d.color)};margin:0"></div>`;
    case "spacer":
      return `<div style="height:${d.height}px"></div>`;
    case "footer":
      return `<div style="padding:16px;text-align:${esc(d.align)};font-size:${d.font_size}px;color:${esc(d.text_color)}">${esc(d.text).replace(/\n/g, "<br>")}</div>`;
    default:
      return "";
  }
}

function buildHtml(blocks: Block[]): string {
  const inner = blocks.map((b) => blockPreview(b)).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email</title></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><table width="100%" style="background:#f1f5f9;padding:32px 0"><tr><td align="center"><table width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)"><tr><td>${inner}</td></tr></table></td></tr></table></body></html>`;
}

interface FieldDef {
  label: string;
  key: string;
  type: string;
  extra?: React.InputHTMLAttributes<HTMLInputElement>;
}

function fieldsFor(type: BlockType): FieldDef[] {
  switch (type) {
    case "header":
      return [
        { label: "Heading Text", key: "text", type: "text" },
        { label: "Background", key: "bg_color", type: "color" },
        { label: "Text Color", key: "text_color", type: "color" },
        { label: "Font Size (px)", key: "font_size", type: "number", extra: { min: 10, max: 72 } },
      ];
    case "text":
      return [
        { label: "Content", key: "content", type: "textarea" },
        { label: "Font Size (px)", key: "font_size", type: "number", extra: { min: 10, max: 36 } },
        { label: "Text Color", key: "text_color", type: "color" },
        { label: "Padding (px)", key: "padding", type: "number" },
      ];
    case "image":
      return [
        { label: "Image URL", key: "src", type: "url" },
        { label: "Alt Text", key: "alt", type: "text" },
        { label: "Link URL (optional)", key: "link", type: "url" },
      ];
    case "button":
      return [
        { label: "Button Label", key: "label", type: "text" },
        { label: "Link URL", key: "url", type: "url" },
        { label: "Background", key: "bg_color", type: "color" },
        { label: "Text Color", key: "text_color", type: "color" },
        { label: "Border Radius (px)", key: "border_radius", type: "number" },
      ];
    case "divider":
      return [
        { label: "Color", key: "color", type: "color" },
        { label: "Thickness (px)", key: "thickness", type: "number" },
        { label: "Margin (px)", key: "margin", type: "number" },
      ];
    case "spacer":
      return [{ label: "Height (px)", key: "height", type: "number" }];
    case "footer":
      return [
        { label: "Footer Text", key: "text", type: "textarea" },
        { label: "Font Size (px)", key: "font_size", type: "number" },
        { label: "Text Color", key: "text_color", type: "color" },
      ];
    default:
      return [];
  }
}

export default function EmailDesigner() {
  const toast = useToast();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  async function loadTemplates() {
    const d = await apiGet<TemplatesResp>("/api/email-designer/templates");
    if (!d.ok || !d.templates?.length) {
      setTemplates([]);
      return;
    }
    setTemplates(d.templates);
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  function addBlock(type: BlockType) {
    setBlocks((bs) => {
      const next = [...bs, { type, data: { ...DEFAULTS[type] } }];
      setActiveIdx(next.length - 1);
      return next;
    });
  }

  function updateActive(key: string, value: string | number) {
    setBlocks((bs) =>
      bs.map((b, i) => (i === activeIdx ? { ...b, data: { ...b.data, [key]: value } } : b)),
    );
  }

  function moveUp(i: number) {
    setBlocks((bs) => {
      const next = [...bs];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
    setActiveIdx((a) => (a === i ? i - 1 : a));
  }
  function moveDown(i: number) {
    setBlocks((bs) => {
      const next = [...bs];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });
    setActiveIdx((a) => (a === i ? i + 1 : a));
  }
  function deleteBlock(i: number) {
    setBlocks((bs) => {
      const next = bs.filter((_, idx) => idx !== i);
      setActiveIdx((a) => (a != null && a >= next.length ? next.length - 1 : a));
      return next;
    });
  }

  function clearAll() {
    if (!confirm("Clear all blocks?")) return;
    setBlocks([]);
    setActiveIdx(null);
  }

  function previewHtml() {
    setModalOpen(true);
    setTimeout(() => {
      if (iframeRef.current) iframeRef.current.srcdoc = buildHtml(blocks);
    }, 0);
  }

  async function save() {
    if (!templateName.trim()) {
      toast("Enter a template name.");
      return;
    }
    if (!blocks.length) {
      toast("Add at least one block.");
      return;
    }
    setSaving(true);
    const d = await apiPost("/api/email-designer/templates", {
      name: templateName.trim(),
      blocks,
      preview_html: buildHtml(blocks),
    });
    setSaving(false);
    if (d.ok) {
      toast("Template saved!");
      loadTemplates();
    } else toast(d.error || "Save failed");
  }

  async function loadTemplate(id: string) {
    const r = await apiGet<TemplateResp>(`/api/email-designer/templates/${id}`);
    if (r.ok && r.template) {
      setBlocks(r.template.blocks || []);
      setActiveIdx(null);
      setTemplateName(r.template.name);
      toast("Template loaded.");
    }
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete template?")) return;
    const r = await apiDelete(`/api/email-designer/templates/${id}`);
    if (r.ok) {
      toast("Deleted.");
      loadTemplates();
    }
  }

  const activeBlock = activeIdx != null ? blocks[activeIdx] : null;

  return (
    <div>
      <div className="view-header">
        <h2>🎨 Visual Email Designer</h2>
        <p className="view-sub">
          Drag-and-drop block editor — build beautiful emails, preview HTML, export to drip
          campaigns.
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr 320px",
          gap: 16,
          maxWidth: 1200,
          height: "calc(100vh - 200px)",
        }}
      >
        {/* Block palette */}
        <div className="ig-card" style={{ overflowY: "auto" }}>
          <h4 style={{ margin: "0 0 12px", fontSize: "0.85rem", fontWeight: 700, color: "#374151" }}>
            BLOCKS
          </h4>
          <div style={{ display: "grid", gap: 8 }}>
            {BLOCK_TYPES.map((b) => (
              <button
                key={b.type}
                onClick={() => addBlock(b.type)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  width: "100%",
                }}
              >
                <span>{b.icon}</span>
                <span>{b.label}</span>
              </button>
            ))}
          </div>
          <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid #e2e8f0" }} />
          <h4 style={{ margin: "0 0 12px", fontSize: "0.85rem", fontWeight: 700, color: "#374151" }}>
            SAVED TEMPLATES
          </h4>
          <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            {templates === null ? (
              <div
                style={{ textAlign: "center", padding: 32, color: "#6b7280", fontSize: "0.9rem" }}
              >
                ⏳ Loading…
              </div>
            ) : templates.length === 0 ? (
              <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>No saved templates yet.</span>
            ) : (
              templates.map((t) => (
                <div
                  key={t.id}
                  style={{
                    marginBottom: 8,
                    border: "1px solid #e2e8f0",
                    borderRadius: 7,
                    padding: "7px 10px",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "0.82rem" }}>{t.name}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                    <button
                      onClick={() => loadTemplate(t.id)}
                      style={{
                        padding: "3px 8px",
                        background: "#f0fdf4",
                        border: "1px solid #86efac",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        color: "#15803d",
                      }}
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteTemplate(t.id)}
                      style={{
                        padding: "3px 8px",
                        background: "#fef2f2",
                        border: "1px solid #fca5a5",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        color: "#b91c1c",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        {/* Canvas */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "10px 10px 0 0",
              padding: "10px 14px",
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <input
              className="form-control"
              placeholder="Template name…"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              style={{ maxWidth: 240, padding: "6px 10px" }}
            />
            <button
              className="btn btn-primary"
              style={{ padding: "7px 16px", fontSize: "0.85rem" }}
              disabled={saving}
              onClick={save}
            >
              {saving ? "Saving…" : "💾 Save"}
            </button>
            <button
              onClick={previewHtml}
              style={{
                padding: "7px 14px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              👁 Preview
            </button>
            <button
              onClick={clearAll}
              style={{
                padding: "7px 14px",
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
                color: "#b91c1c",
                marginLeft: "auto",
              }}
            >
              🗑 Clear
            </button>
          </div>
          <div
            style={{
              flex: 1,
              background: "#f1f5f9",
              border: "1px solid #e2e8f0",
              overflowY: "auto",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0,
            }}
          >
            <div
              style={{
                width: 600,
                background: "#fff",
                borderRadius: 8,
                overflow: "hidden",
                boxShadow: "0 2px 12px rgba(0,0,0,.08)",
              }}
            >
              {!blocks.length ? (
                <div
                  style={{
                    padding: "60px 24px",
                    textAlign: "center",
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                    border: "2px dashed #cbd5e1",
                    borderRadius: 8,
                    margin: 12,
                  }}
                >
                  ← Click a block to add it to your email
                </div>
              ) : (
                blocks.map((b, i) => (
                  <div
                    key={i}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("button")) return;
                      setActiveIdx(i);
                    }}
                    style={{
                      position: "relative",
                      border: `2px solid ${i === activeIdx ? "#6366f1" : "transparent"}`,
                      borderRadius: 4,
                      cursor: "pointer",
                      transition: "border .15s",
                    }}
                  >
                    <div dangerouslySetInnerHTML={{ __html: blockPreview(b) }} />
                    <div
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        display: "flex",
                        gap: 4,
                        opacity: hoverIdx === i ? 1 : 0,
                        transition: "opacity .15s",
                      }}
                    >
                      {i > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            moveUp(i);
                          }}
                          style={{
                            padding: "2px 7px",
                            background: "#fff",
                            border: "1px solid #e2e8f0",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: ".75rem",
                          }}
                        >
                          ↑
                        </button>
                      )}
                      {i < blocks.length - 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            moveDown(i);
                          }}
                          style={{
                            padding: "2px 7px",
                            background: "#fff",
                            border: "1px solid #e2e8f0",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: ".75rem",
                          }}
                        >
                          ↓
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBlock(i);
                        }}
                        style={{
                          padding: "2px 7px",
                          background: "#fee2e2",
                          border: "1px solid #fca5a5",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: ".75rem",
                          color: "#b91c1c",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "0 0 10px 10px",
              padding: "8px 14px",
              fontSize: "0.78rem",
              color: "#94a3b8",
            }}
          >
            <span>
              {blocks.length} block{blocks.length !== 1 ? "s" : ""}
            </span>{" "}
            · 600px width · Email-safe HTML
          </div>
        </div>
        {/* Properties panel */}
        <div className="ig-card" style={{ overflowY: "auto" }}>
          <h4 style={{ margin: "0 0 12px", fontSize: "0.85rem", fontWeight: 700, color: "#374151" }}>
            PROPERTIES
          </h4>
          <div>
            {!activeBlock ? (
              <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                Click a block to edit its properties.
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: "#6366f1",
                    marginBottom: 14,
                    textTransform: "uppercase",
                  }}
                >
                  {activeBlock.type} block
                </div>
                {fieldsFor(activeBlock.type).map((f) => (
                  <div key={f.key} className="form-group" style={{ marginBottom: 10 }}>
                    <label
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: "#374151",
                        display: "block",
                        marginBottom: 4,
                      }}
                    >
                      {f.label}
                    </label>
                    {f.type === "textarea" ? (
                      <textarea
                        rows={4}
                        value={String(activeBlock.data[f.key] ?? "")}
                        onChange={(e) => updateActive(f.key, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          fontFamily: "inherit",
                          fontSize: "0.82rem",
                          boxSizing: "border-box",
                        }}
                      />
                    ) : (
                      <input
                        type={f.type}
                        {...f.extra}
                        value={String(activeBlock.data[f.key] ?? "")}
                        onChange={(e) =>
                          updateActive(
                            f.key,
                            f.type === "number" ? +e.target.value : e.target.value,
                          )
                        }
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          fontSize: "0.82rem",
                          boxSizing: "border-box",
                        }}
                      />
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
      {/* HTML Preview Modal */}
      {modalOpen && (
        <div
          style={{
            display: "flex",
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            zIndex: 9998,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: 700,
              maxWidth: "95vw",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              <span style={{ fontWeight: 700 }}>HTML Preview</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(buildHtml(blocks)).then(() => toast("HTML copied!"))
                  }
                  style={{
                    padding: "6px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: "0.82rem",
                  }}
                >
                  📋 Copy HTML
                </button>
                <button
                  onClick={() => setModalOpen(false)}
                  style={{
                    padding: "6px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: "0.82rem",
                  }}
                >
                  ✕ Close
                </button>
              </div>
            </div>
            <iframe ref={iframeRef} style={{ flex: 1, border: "none", minHeight: 500 }} />
          </div>
        </div>
      )}
    </div>
  );
}
