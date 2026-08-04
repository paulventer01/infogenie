"use client";
import { useState, useEffect } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import PanelHero from "@/components/layout/PanelHero";

interface FAQ { q: string; a: string; }
interface Objection { objection: string; response: string; }

interface Product {
  id: number;
  name: string;
  tagline: string;
  category: string;
  pricing_model: string;
  price: number | null;
  currency: string;
  description: string;
  usp: string;
  features: string[];
  benefits: string[];
  faqs: FAQ[];
  objections: Objection[];
  cross_sell: string[];
  upsell: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

const PRICING_MODELS = ["one_time","subscription","freemium","usage","custom"];
const PRICING_LABELS: Record<string, string> = { one_time:"One-Time", subscription:"Subscription", freemium:"Freemium", usage:"Usage-Based", custom:"Custom" };
const CURRENCIES = ["USD","EUR","GBP","ZAR","AUD","CAD","NGN","KES"];

function emptyProduct(): Omit<Product,"id"|"status"|"created_at"|"updated_at"> {
  return { name:"", tagline:"", category:"", pricing_model:"subscription", price:null, currency:"USD",
    description:"", usp:"", features:[], benefits:[], faqs:[], objections:[], cross_sell:[], upsell:[] };
}

function TagList({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState("");
  function add() {
    const v = input.trim();
    if (v && !items.includes(v)) { onChange([...items, v]); setInput(""); }
  }
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {items.map((t, i) => (
          <span key={i} style={{ background: "#EFF6FF", color: "#1D4ED8", padding: "2px 10px", borderRadius: 20, fontSize: "0.75rem", display: "flex", alignItems: "center", gap: 4 }}>
            {t}
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B7280", padding: 0, lineHeight: 1 }}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), add())} placeholder={placeholder}
          style={{ flex: 1, padding: "5px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.78rem" }} />
        <button onClick={add} style={{ padding: "5px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, color: "#1D4ED8", fontSize: "0.75rem", cursor: "pointer" }}>Add</button>
      </div>
    </div>
  );
}

function PairList({ items, onChange, keyPlaceholder, valPlaceholder }: { items: { [k: string]: string }[]; onChange: (v: { [k: string]: string }[]) => void; keyPlaceholder: string; valPlaceholder: string }) {
  const [k, setK] = useState(""); const [v, setV] = useState("");
  function add() { if (k.trim() && v.trim()) { onChange([...items, { [keyPlaceholder.toLowerCase().split(" ")[0]]: k, [valPlaceholder.toLowerCase().split(" ")[0]]: v }]); setK(""); setV(""); } }
  return (
    <div>
      {items.map((item, i) => {
        const [ik, iv] = Object.values(item) as [string, string];
        return (
          <div key={i} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", marginBottom: 6, position: "relative" }}>
            <div style={{ fontWeight: 600, fontSize: "0.78rem", marginBottom: 2 }}>{ik}</div>
            <div style={{ fontSize: "0.76rem", color: "#6B7280" }}>{iv}</div>
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: "0.78rem" }}>✕</button>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <input value={k} onChange={e => setK(e.target.value)} placeholder={keyPlaceholder} style={{ flex: 1, padding: "5px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.75rem" }} />
        <input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), add())} placeholder={valPlaceholder} style={{ flex: 1, padding: "5px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.75rem" }} />
        <button onClick={add} style={{ padding: "5px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, color: "#1D4ED8", fontSize: "0.75rem", cursor: "pointer" }}>Add</button>
      </div>
    </div>
  );
}

export default function ProductLibrary() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState<Partial<Product> | null>(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeTab, setActiveTab]   = useState("basics");

  async function reload() {
    setLoading(true);
    const d = await apiGet<{ ok: boolean; products: Product[] }>("/api/products");
    if (d.ok) setProducts(d.products || []);
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  function startNew() {
    setEditing(emptyProduct()); setSelectedId(null); setActiveTab("basics"); setError(null);
  }

  function startEdit(p: Product) {
    setEditing({ ...p }); setSelectedId(p.id); setActiveTab("basics"); setError(null);
  }

  async function save() {
    if (!editing?.name?.trim()) return setError("Product name is required.");
    setSaving(true); setError(null);
    const payload = {
      ...editing,
      faqs: (editing.faqs || []).map((f: FAQ) => ({ q: f.q, a: f.a })),
      objections: (editing.objections || []).map((o: Objection) => ({ objection: o.objection, response: o.response })),
    };
    const d = selectedId
      ? await apiPut<{ ok: boolean; error?: string; product: Product }>(`/api/products/${selectedId}`, payload)
      : await apiPost<{ ok: boolean; error?: string; product: Product }>("/api/products", payload);
    setSaving(false);
    if (!d.ok) { setError(d.error || "Save failed"); return; }
    setEditing(null); setSelectedId(null);
    await reload();
  }

  async function archive(id: number) {
    await apiDelete(`/api/products/${id}`);
    setProducts(p => p.filter(x => x.id !== id));
    if (selectedId === id) { setEditing(null); setSelectedId(null); }
  }

  const selected = selectedId ? products.find(p => p.id === selectedId) : null;
  const TABS = ["basics","features","pricing","faq","cross-sell","objections"];

  return (
    <div style={{ fontFamily: "inherit", background: "transparent", minHeight: "100%" }}>
      <PanelHero
        group="Manage"
        title="📦 Product Library"
        subtitle="Build a structured catalog of your products and services — features, benefits, USP, pricing, FAQs, objections, and cross-sell/upsell opportunities."
      />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "4px 4px 40px", display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>
        {/* Sidebar */}
        <div>
          <button onClick={startNew} style={{ width: "100%", padding: "10px 0", minHeight: 42, background: "linear-gradient(135deg,#0f766e,#0284c7)", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", marginBottom: 12 }}>
            + Add Product / Service
          </button>
          {loading ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.8rem", textAlign: "center", padding: 20 }}>Loading…</div>
          ) : products.length === 0 ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.8rem", textAlign: "center", padding: 20 }}>No products yet. Add your first one →</div>
          ) : (
            products.map(p => (
              <div key={p.id} onClick={() => { startEdit(p); }} style={{ background: selectedId === p.id ? "#EFF6FF" : "#fff", border: `1px solid ${selectedId === p.id ? "#BFDBFE" : "#E5E7EB"}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer", transition: "all .15s" }}>
                <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#0A1628" }}>{p.name}</div>
                {p.tagline && <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>{p.tagline}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.65rem", background: "#F0FDF4", color: "#059669", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{PRICING_LABELS[p.pricing_model]}</span>
                  {p.price != null && <span style={{ fontSize: "0.65rem", background: "#EFF6FF", color: "#1D4ED8", padding: "2px 8px", borderRadius: 20 }}>{p.currency} {Number(p.price).toLocaleString()}</span>}
                  {p.category && <span style={{ fontSize: "0.65rem", background: "#F9FAFB", color: "#6B7280", padding: "2px 8px", borderRadius: 20 }}>{p.category}</span>}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Editor / Detail */}
        {editing ? (
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ background: "linear-gradient(135deg, #F8FAFF, #EFF4FF)", padding: "14px 18px", borderBottom: "1px solid #E8EEF8", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: "0.88rem" }}>{selectedId ? "Edit Product" : "New Product"}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setEditing(null); setSelectedId(null); }} style={{ padding: "5px 14px", background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: "0.75rem", cursor: "pointer" }}>Cancel</button>
                <button onClick={save} disabled={saving} style={{ padding: "5px 14px", background: saving ? "#E5E7EB" : "linear-gradient(135deg,#0f766e,#0284c7)", border: "none", borderRadius: 8, color: saving ? "#6B7280" : "#fff", fontWeight: 700, fontSize: "0.75rem", cursor: saving ? "not-allowed" : "pointer", boxShadow: saving ? "none" : "0 4px 12px rgba(15,118,110,0.22)" }}>
                  {saving ? "Saving…" : "Save Product"}
                </button>
              </div>
            </div>

            {/* Tab nav */}
            <div style={{ borderBottom: "1px solid #E5E7EB", display: "flex", overflowX: "auto" }}>
              {TABS.map(t => (
                <button key={t} onClick={() => setActiveTab(t)} style={{ padding: "8px 14px", border: "none", borderBottom: activeTab === t ? "2px solid #059669" : "2px solid transparent", background: "none", fontWeight: activeTab === t ? 700 : 500, fontSize: "0.75rem", color: activeTab === t ? "#059669" : "#6B7280", cursor: "pointer", whiteSpace: "nowrap", textTransform: "capitalize" }}>
                  {t.replace("-", " ")}
                </button>
              ))}
            </div>

            <div style={{ padding: 20 }}>
              {error && <div style={{ marginBottom: 12, padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, color: "#991B1B", fontSize: "0.78rem" }}>⚠️ {error}</div>}

              {activeTab === "basics" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {[
                    { label: "Product / Service Name *", field: "name", placeholder: "e.g. InfoGenie Pro" },
                    { label: "Tagline", field: "tagline", placeholder: "One-line pitch" },
                    { label: "Category", field: "category", placeholder: "e.g. SaaS, Consulting, Physical Product" },
                    { label: "Unique Selling Proposition (USP)", field: "usp", placeholder: "What makes this product different from all competitors?" },
                  ].map(({ label, field, placeholder }) => (
                    <div key={field}>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>{label}</label>
                      <input value={(editing as Record<string, string>)[field] || ""} onChange={e => setEditing(p => ({ ...p!, [field]: e.target.value }))} placeholder={placeholder}
                        style={{ width: "100%", padding: "7px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.8rem", boxSizing: "border-box" }} />
                    </div>
                  ))}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>Description</label>
                    <textarea value={editing.description || ""} onChange={e => setEditing(p => ({ ...p!, description: e.target.value }))} placeholder="Full product description…" rows={4}
                      style={{ width: "100%", padding: "7px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.8rem", boxSizing: "border-box", resize: "vertical" }} />
                  </div>
                </div>
              )}

              {activeTab === "pricing" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>Pricing Model</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {PRICING_MODELS.map(m => (
                        <button key={m} onClick={() => setEditing(p => ({ ...p!, pricing_model: m }))}
                          style={{ padding: "6px 14px", border: `1.5px solid ${editing.pricing_model === m ? "#059669" : "#E5E7EB"}`, borderRadius: 20, background: editing.pricing_model === m ? "#F0FDF4" : "#fff", color: editing.pricing_model === m ? "#059669" : "#6B7280", fontWeight: editing.pricing_model === m ? 700 : 500, fontSize: "0.75rem", cursor: "pointer" }}>
                          {PRICING_LABELS[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>Price</label>
                      <input type="number" min="0" value={editing.price ?? ""} onChange={e => setEditing(p => ({ ...p!, price: e.target.value ? Number(e.target.value) : null }))} placeholder="0.00"
                        style={{ width: "100%", padding: "7px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.8rem", boxSizing: "border-box" }} />
                    </div>
                    <div style={{ width: 110 }}>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>Currency</label>
                      <select value={editing.currency || "USD"} onChange={e => setEditing(p => ({ ...p!, currency: e.target.value }))}
                        style={{ width: "100%", padding: "7px 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.8rem" }}>
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "features" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 8 }}>Features (what it does)</label>
                    <TagList items={editing.features || []} onChange={v => setEditing(p => ({ ...p!, features: v }))} placeholder="e.g. AI-powered keyword research" />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 8 }}>Benefits (what the customer gets)</label>
                    <TagList items={editing.benefits || []} onChange={v => setEditing(p => ({ ...p!, benefits: v }))} placeholder="e.g. Save 10 hours per week" />
                  </div>
                </div>
              )}

              {activeTab === "faq" && (
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 8 }}>FAQs</label>
                  <PairList items={(editing.faqs || []) as unknown as { [k: string]: string }[]}
                    onChange={v => setEditing(p => ({ ...p!, faqs: v as unknown as FAQ[] }))}
                    keyPlaceholder="Question" valPlaceholder="Answer" />
                </div>
              )}

              {activeTab === "objections" && (
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 8 }}>Objections & Responses</label>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 10 }}>Common reasons people don&apos;t buy, and how to handle them.</div>
                  <PairList items={(editing.objections || []) as unknown as { [k: string]: string }[]}
                    onChange={v => setEditing(p => ({ ...p!, objections: v as unknown as Objection[] }))}
                    keyPlaceholder="Objection" valPlaceholder="Response" />
                </div>
              )}

              {activeTab === "cross-sell" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 8 }}>Cross-sell Opportunities</label>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 8 }}>Products/services that complement this one (sold alongside).</div>
                    <TagList items={editing.cross_sell || []} onChange={v => setEditing(p => ({ ...p!, cross_sell: v }))} placeholder="e.g. Email Marketing Add-on" />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 8 }}>Upsell Opportunities</label>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 8 }}>Higher-tier products/services to upgrade customers to.</div>
                    <TagList items={editing.upsell || []} onChange={v => setEditing(p => ({ ...p!, upsell: v }))} placeholder="e.g. Enterprise Plan" />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : selected ? (
          // Product detail view
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: "1.2rem", fontWeight: 900 }}>{selected.name}</h3>
                {selected.tagline && <div style={{ color: "#6B7280", fontSize: "0.85rem", marginTop: 4 }}>{selected.tagline}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <span style={{ background: "#F0FDF4", color: "#059669", padding: "3px 10px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 600 }}>{PRICING_LABELS[selected.pricing_model]}</span>
                  {selected.price != null && <span style={{ background: "#EFF6FF", color: "#1D4ED8", padding: "3px 10px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 700 }}>{selected.currency} {Number(selected.price).toLocaleString()}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => startEdit(selected)} style={{ padding: "6px 16px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, color: "#1D4ED8", fontWeight: 600, fontSize: "0.75rem", cursor: "pointer" }}>✏️ Edit</button>
                <button onClick={() => archive(selected.id)} style={{ padding: "6px 16px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, color: "#DC2626", fontSize: "0.75rem", cursor: "pointer" }}>Archive</button>
              </div>
            </div>
            {selected.usp && <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: "0.82rem", color: "#92400E" }}><strong>USP:</strong> {selected.usp}</div>}
            {selected.description && <p style={{ fontSize: "0.82rem", color: "#374151", lineHeight: 1.7, marginBottom: 16 }}>{selected.description}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {selected.features?.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.78rem", marginBottom: 6, color: "#374151" }}>✅ Features</div>
                  {selected.features.map((f, i) => <div key={i} style={{ fontSize: "0.77rem", color: "#4B5563", marginBottom: 3 }}>• {f}</div>)}
                </div>
              )}
              {selected.benefits?.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.78rem", marginBottom: 6, color: "#374151" }}>🎁 Benefits</div>
                  {selected.benefits.map((b, i) => <div key={i} style={{ fontSize: "0.77rem", color: "#4B5563", marginBottom: 3 }}>• {b}</div>)}
                </div>
              )}
              {selected.cross_sell?.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.78rem", marginBottom: 6, color: "#374151" }}>🔀 Cross-sell</div>
                  {selected.cross_sell.map((c, i) => <div key={i} style={{ fontSize: "0.77rem", color: "#4B5563", marginBottom: 3 }}>• {c}</div>)}
                </div>
              )}
              {selected.upsell?.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.78rem", marginBottom: 6, color: "#374151" }}>⬆️ Upsell</div>
                  {selected.upsell.map((u, i) => <div key={i} style={{ fontSize: "0.77rem", color: "#4B5563", marginBottom: 3 }}>• {u}</div>)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px dashed #D1D5DB", borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, color: "#9CA3AF" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📦</div>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Select a product or add a new one</div>
            <div style={{ fontSize: "0.78rem", marginTop: 4, textAlign: "center" }}>Your product catalog lives here — features, benefits, pricing, FAQs, objections, and cross-sell/upsell paths.</div>
          </div>
        )}
      </div>
    </div>
  );
}
