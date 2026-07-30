"use client";

// Native React port of the legacy `schema-generator` panel (was
// `window.buildSchemaGenerator` in `public/js/ig_seo.js` +
// `#view-schema-generator` in index.html). Builds Schema.org / JSON-LD blocks
// from a typed form via the existing Express API through `lib/api`:
//   GET    /api/schema-generator/types
//   POST   /api/schema-generator/generate   (live preview)
//   GET    /api/schema-generator/list
//   POST   /api/schema-generator/save
//   DELETE /api/schema-generator/:id
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";

interface SubField {
  key: string;
  kind?: string;
  placeholder?: string;
}
interface SchemaField {
  key: string;
  kind?: string;
  required?: boolean;
  help?: string;
  placeholder?: string;
  subFields?: SubField[];
  subKey?: string;
}
interface SchemaTypeDef {
  label?: string;
  fields: SchemaField[];
}
interface TypesResult {
  ok: boolean;
  error?: string;
  types?: Record<string, SchemaTypeDef>;
}
interface GenerateResult {
  ok: boolean;
  error?: string;
  jsonld?: string;
}
interface SavedBlock {
  id: number | string;
  name: string;
  type: string;
  jsonld: string;
  created_at: string;
}
interface ListResult {
  ok: boolean;
  blocks?: SavedBlock[];
}

type RepeatRow = Record<string, string>;
type FieldCollected = string | RepeatRow;

function subsFor(f: SchemaField): SubField[] {
  return (
    f.subFields || [
      { key: f.subKey || "value", kind: "text", placeholder: f.placeholder || "" },
    ]
  );
}

function inputType(kind?: string): string {
  if (kind === "url") return "url";
  if (kind === "email") return "email";
  if (kind === "tel") return "tel";
  if (kind === "number") return "number";
  if (kind === "date") return "date";
  return "text";
}

export default function SchemaGenerator() {
  const [types, setTypes] = useState<Record<string, SchemaTypeDef>>({});
  const [loadError, setLoadError] = useState("");
  const [currentType, setCurrentType] = useState("");

  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [repeatRows, setRepeatRows] = useState<Record<string, RepeatRow[]>>({});

  const [output, setOutput] = useState("Pick a type to start →");
  const [outputError, setOutputError] = useState(false);

  const [blocks, setBlocks] = useState<SavedBlock[]>([]);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const [savedCopiedId, setSavedCopiedId] = useState<string | null>(null);

  const typeKeys = useMemo(() => Object.keys(types), [types]);
  const def = currentType ? types[currentType] : null;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadTypes() {
    const j = await apiGet<TypesResult>("/api/schema-generator/types");
    if (!j.ok || !j.types) {
      setLoadError(j.error || "load failed");
      return;
    }
    setTypes(j.types);
    const first = Object.keys(j.types)[0];
    if (first) selectType(first, j.types);
  }

  async function loadSaved() {
    const j = await apiGet<ListResult>("/api/schema-generator/list");
    if (j.ok) setBlocks(j.blocks || []);
  }

  useEffect(() => {
    loadTypes();
    loadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectType(t: string, src?: Record<string, SchemaTypeDef>) {
    const table = src || types;
    setCurrentType(t);
    setTextValues({});
    // Seed each repeat group with one empty row.
    const initRepeats: Record<string, RepeatRow[]> = {};
    (table[t]?.fields || []).forEach((f) => {
      if (f.kind === "repeat") {
        const subs = subsFor(f);
        const row: RepeatRow = {};
        subs.forEach((s) => (row[s.key] = ""));
        initRepeats[f.key] = [row];
      }
    });
    setRepeatRows(initRepeats);
  }

  function collect(): Record<string, FieldCollected[] | string> {
    const out: Record<string, FieldCollected[] | string> = {};
    (def?.fields || []).forEach((f) => {
      if (f.kind === "repeat") {
        const subs = subsFor(f);
        const rows = (repeatRows[f.key] || [])
          .map((row): FieldCollected => {
            if (subs.length === 1) return (row[subs[0].key] || "").trim();
            const obj: RepeatRow = {};
            subs.forEach((s) => (obj[s.key] = (row[s.key] || "").trim()));
            return obj;
          })
          .filter((v) =>
            typeof v === "string"
              ? Boolean(v)
              : Object.values(v).some((x) => x),
          );
        if (rows.length) out[f.key] = rows;
      } else {
        const v = (textValues[f.key] || "").trim();
        if (v) out[f.key] = v;
      }
    });
    return out;
  }

  async function regen() {
    if (!currentType) return;
    const fields = collect();
    const j = await apiPost<GenerateResult>("/api/schema-generator/generate", {
      type: currentType,
      fields,
    });
    if (!j.ok) {
      setOutputError(true);
      setOutput(j.error || "generate failed");
      return;
    }
    setOutputError(false);
    setOutput(j.jsonld || "");
  }

  // Live regenerate on every form change (debounced).
  useEffect(() => {
    if (!currentType) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(regen, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentType, textValues, repeatRows]);

  function setText(key: string, v: string) {
    setTextValues((prev) => ({ ...prev, [key]: v }));
  }
  function addRow(f: SchemaField) {
    const subs = subsFor(f);
    const row: RepeatRow = {};
    subs.forEach((s) => (row[s.key] = ""));
    setRepeatRows((prev) => ({
      ...prev,
      [f.key]: [...(prev[f.key] || []), row],
    }));
  }
  function removeRow(fieldKey: string, idx: number) {
    setRepeatRows((prev) => ({
      ...prev,
      [fieldKey]: (prev[fieldKey] || []).filter((_, i) => i !== idx),
    }));
  }
  function setRowValue(fieldKey: string, idx: number, subKey: string, v: string) {
    setRepeatRows((prev) => ({
      ...prev,
      [fieldKey]: (prev[fieldKey] || []).map((row, i) =>
        i === idx ? { ...row, [subKey]: v } : row,
      ),
    }));
  }

  function copyOutput() {
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  function copySaved(b: SavedBlock) {
    navigator.clipboard.writeText(b.jsonld).then(() => {
      setSavedCopiedId(String(b.id));
      setTimeout(() => setSavedCopiedId(null), 1500);
    });
  }

  async function save() {
    const nm =
      name.trim() || `${currentType} ${new Date().toLocaleDateString()}`;
    const fields = collect();
    const r = await apiPost<{ ok: boolean; error?: string }>(
      "/api/schema-generator/save",
      { name: nm, type: currentType, fields },
    );
    if (!r.ok) {
      alert(r.error);
      return;
    }
    setName("");
    loadSaved();
  }
  async function del(id: number | string) {
    if (!confirm("Delete this saved block?")) return;
    await apiDelete(`/api/schema-generator/${id}`);
    loadSaved();
  }

  const subInputStyle: React.CSSProperties = {
    flex: 1,
    padding: 6,
    border: "1px solid #D1D5DB",
    borderRadius: 4,
    fontSize: "0.78rem",
    boxSizing: "border-box",
  };

  function renderField(f: SchemaField) {
    const req = f.required ? <span style={{ color: "#EF4444" }}>*</span> : null;
    if (f.kind === "repeat") {
      const subs = subsFor(f);
      const rows = repeatRows[f.key] || [];
      return (
        <div
          key={f.key}
          style={{
            marginBottom: 14,
            border: "1px dashed #D1D5DB",
            borderRadius: 8,
            padding: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <strong style={{ fontSize: "0.78rem", color: "#374151" }}>
              {f.key} {req}
            </strong>
            <button
              onClick={() => addRow(f)}
              style={{
                background: "#10B981",
                color: "#fff",
                border: "none",
                padding: "4px 10px",
                borderRadius: 4,
                fontSize: "0.74rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + Add row
            </button>
          </div>
          <div>
            {rows.map((row, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  gap: 6,
                  marginBottom: 6,
                  alignItems: "start",
                }}
              >
                {subs.map((s) =>
                  s.kind === "textarea" ? (
                    <textarea
                      key={s.key}
                      rows={2}
                      value={row[s.key] || ""}
                      placeholder={s.placeholder || s.key}
                      onChange={(e) =>
                        setRowValue(f.key, idx, s.key, e.target.value)
                      }
                      style={{
                        ...subInputStyle,
                        fontFamily: "inherit",
                        resize: "vertical",
                      }}
                    />
                  ) : (
                    <input
                      key={s.key}
                      type={s.kind === "url" ? "url" : "text"}
                      value={row[s.key] || ""}
                      placeholder={s.placeholder || s.key}
                      onChange={(e) =>
                        setRowValue(f.key, idx, s.key, e.target.value)
                      }
                      style={subInputStyle}
                    />
                  ),
                )}
                <button
                  onClick={() => removeRow(f.key, idx)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#B91C1C",
                    cursor: "pointer",
                    fontSize: "1rem",
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {f.help && (
            <div
              style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 4 }}
            >
              {f.help}
            </div>
          )}
        </div>
      );
    }
    const labelEl = (
      <label
        style={{
          display: "block",
          fontSize: "0.72rem",
          fontWeight: 700,
          color: "#6B7280",
          marginBottom: 3,
        }}
      >
        {f.key} {req}
      </label>
    );
    const help = f.help ? (
      <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 2 }}>
        {f.help}
      </div>
    ) : null;
    const common: React.CSSProperties = {
      width: "100%",
      padding: 7,
      border: "1px solid #D1D5DB",
      borderRadius: 5,
      fontSize: "0.82rem",
      boxSizing: "border-box",
    };
    return (
      <div key={f.key} style={{ marginBottom: 10 }}>
        {labelEl}
        {f.kind === "textarea" ? (
          <textarea
            rows={2}
            value={textValues[f.key] || ""}
            placeholder={f.placeholder || ""}
            onChange={(e) => setText(f.key, e.target.value)}
            style={{ ...common, fontFamily: "inherit", resize: "vertical" }}
          />
        ) : (
          <input
            type={inputType(f.kind)}
            step={f.kind === "number" ? "any" : undefined}
            value={textValues[f.key] || ""}
            placeholder={f.placeholder || ""}
            onChange={(e) => setText(f.key, e.target.value)}
            style={f.kind === "date" ? { ...common, width: "auto" } : common}
          />
        )}
        {help}
      </div>
    );
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Schema Generator
              </div>
              <h2 className="view-title">🏷️ Schema.org / JSON-LD Generator</h2>
              <p className="view-sub">
                Generate valid structured-data markup for rich Google results —
                FAQs, products, articles, local business, breadcrumbs and more.
                Copy the JSON-LD straight into your &lt;head&gt;.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {loadError ? (
          <div style={{ color: "#B91C1C" }}>{loadError}</div>
        ) : !typeKeys.length ? (
          <div style={{ color: "#9CA3AF" }}>Loading schema types…</div>
        ) : (
          <>
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
                marginBottom: 14,
              }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 6,
                }}
              >
                SCHEMA TYPE
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {typeKeys.map((t) => {
                  const sel = t === currentType;
                  return (
                    <button
                      key={t}
                      onClick={() => selectType(t)}
                      style={{
                        background: sel ? "#0066FF" : "#fff",
                        border: `1px solid ${sel ? "#0066FF" : "#D1D5DB"}`,
                        color: sel ? "#fff" : "#374151",
                        padding: "7px 14px",
                        borderRadius: 18,
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {types[t].label || t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 18,
                }}
              >
                <h3
                  style={{
                    margin: "0 0 12px",
                    fontSize: "1rem",
                    color: "#0A1628",
                  }}
                >
                  📝 Fields
                </h3>
                <div>{(def?.fields || []).map(renderField)}</div>
                <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Block name (for saving)"
                    style={{
                      flex: 1,
                      padding: 8,
                      border: "1px solid #D1D5DB",
                      borderRadius: 5,
                      fontSize: "0.84rem",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    onClick={save}
                    style={{
                      background: "linear-gradient(135deg,#7C3AED,#0066FF)",
                      color: "#fff",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: 5,
                      fontSize: "0.82rem",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    💾 Save
                  </button>
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 18,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1rem", color: "#0A1628" }}>
                    📋 JSON-LD output
                  </h3>
                  <button
                    onClick={copyOutput}
                    style={{
                      background: "#0066FF",
                      color: "#fff",
                      border: "none",
                      padding: "6px 14px",
                      borderRadius: 5,
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {copied ? "✓ Copied" : "📋 Copy"}
                  </button>
                </div>
                <pre
                  style={{
                    background: '#eef4ff',
                    color: outputError ? "#FCA5A5" : "#A7F3D0",
                    padding: 14,
                    borderRadius: 8,
                    fontSize: "0.74rem",
                    lineHeight: 1.5,
                    overflow: "auto",
                    maxHeight: 480,
                    margin: 0,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <code>{output}</code>
                </pre>
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <h3
                style={{
                  fontSize: "0.94rem",
                  color: "#374151",
                  marginBottom: 10,
                }}
              >
                💾 Saved blocks
              </h3>
              <div>
                {!blocks.length ? (
                  <div style={{ color: "#9CA3AF", fontSize: "0.82rem" }}>
                    No saved blocks yet.
                  </div>
                ) : (
                  blocks.map((b) => (
                    <div
                      key={b.id}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderRadius: 8,
                        padding: "10px 14px",
                        marginBottom: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <strong>{b.name}</strong>{" "}
                        <span
                          style={{
                            background: "#EEF2FF",
                            color: "#4338CA",
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            marginLeft: 6,
                          }}
                        >
                          {b.type}
                        </span>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "#9CA3AF",
                            marginTop: 2,
                          }}
                        >
                          {new Date(b.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => copySaved(b)}
                          style={{
                            background: "#0066FF",
                            color: "#fff",
                            border: "none",
                            padding: "5px 10px",
                            borderRadius: 4,
                            fontSize: "0.74rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {savedCopiedId === String(b.id) ? "✓" : "📋 Copy"}
                        </button>
                        <button
                          onClick={() => del(b.id)}
                          style={{
                            background: "none",
                            border: "1px solid #FCA5A5",
                            color: "#B91C1C",
                            padding: "5px 10px",
                            borderRadius: 4,
                            fontSize: "0.74rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
