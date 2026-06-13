"use client";

// Native React port of the legacy `linksell` panel (was `window.buildLinksell`
// in `public/js/ig_studio.js` + `#view-linksell` in index.html). Edits the
// public Link-in-Bio + Stripe-checkout page via the existing Express API
// through `lib/api`:
//   GET  /api/linksell/page/me
//   POST /api/linksell/page/me
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface BioLink {
  icon?: string;
  label?: string;
  url?: string;
}
interface BioProduct {
  id?: string;
  name?: string;
  priceCents?: number;
  currency?: string;
  description?: string;
}
interface BioPage {
  title?: string;
  bio?: string;
  avatarUrl?: string;
  primaryColor?: string;
  links?: BioLink[];
  products?: BioProduct[];
}
interface PageResult {
  ok: boolean;
  error?: string;
  page?: BioPage;
}

interface Toast {
  msg: string;
  kind: "ok" | "err";
}

const SLUG = "me";

export default function Linksell() {
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#0066FF");
  const [links, setLinks] = useState<BioLink[]>([]);
  const [prods, setProds] = useState<BioProduct[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }

  useEffect(() => {
    (async () => {
      const j = await apiGet<PageResult>("/api/linksell/page/" + SLUG);
      const page = j.page || {};
      setTitle(page.title || "");
      setBio(page.bio || "");
      setAvatarUrl(page.avatarUrl || "");
      setPrimaryColor(page.primaryColor || "#0066FF");
      setLinks(page.links || []);
      setProds(page.products || []);
      setLoaded(true);
    })();
  }, []);

  function updateLink(i: number, key: keyof BioLink, v: string) {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, [key]: v } : l)));
  }
  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addLink() {
    setLinks((prev) => [...prev, { icon: "🔗", label: "", url: "" }]);
  }

  function updateProd(i: number, key: keyof BioProduct, v: string) {
    setProds((prev) =>
      prev.map((p, idx) => {
        if (idx !== i) return p;
        if (key === "priceCents") {
          return { ...p, priceCents: Math.round(Number(v || 0) * 100) };
        }
        return { ...p, [key]: v };
      }),
    );
  }
  function removeProd(i: number) {
    setProds((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addProd() {
    setProds((prev) => [
      ...prev,
      {
        id: "p_" + Date.now().toString(36),
        name: "",
        priceCents: 999,
        currency: "usd",
        description: "",
      },
    ]);
  }

  async function save() {
    const r = await apiPost<{ ok: boolean; error?: string }>(
      "/api/linksell/page/" + SLUG,
      {
        title,
        bio,
        avatarUrl,
        primaryColor,
        links,
        products: prods,
      },
    );
    if (!r.ok) {
      showToast(r.error || "save failed", "err");
      return;
    }
    showToast("Saved ✓");
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 10,
    border: "1.5px solid #E5E7EB",
    borderRadius: 8,
    margin: "6px 0",
    boxSizing: "border-box",
  };
  const cardStyle: React.CSSProperties = {
    background: "white",
    border: "1px solid #E5E7EB",
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>
                🔗 Link-in-Bio + Checkout
              </h1>
              <p style={{ margin: "6px 0 0", color: "#64748B" }}>
                Public bio page with links, lead opt-in and Stripe checkout.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ padding: "24px 0 64px" }}>
        <div
          style={{
            background: "#F0F9FF",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Public link:{" "}
          <a
            href={"/bio/" + SLUG}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#0066FF", fontWeight: 600 }}
          >
            {origin}/bio/{SLUG}
          </a>
        </div>

        {!loaded ? (
          <div>Loading…</div>
        ) : (
          <>
            <div style={cardStyle}>
              <h3 style={{ margin: "0 0 12px" }}>Page</h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <label>
                  Title
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <label>
                  Avatar URL
                  <input
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    style={inputStyle}
                  />
                </label>
              </div>
              <label>
                Bio
                <input
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label>
                Primary color
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  style={{
                    padding: 6,
                    border: "1.5px solid #E5E7EB",
                    borderRadius: 8,
                    height: 40,
                    margin: "6px 0",
                    display: "block",
                  }}
                />
              </label>
            </div>

            <div style={cardStyle}>
              <h3 style={{ margin: "0 0 12px" }}>
                Links
                <button
                  onClick={addLink}
                  style={{
                    float: "right",
                    background: "#0F766E",
                    color: "white",
                    border: 0,
                    padding: "6px 12px",
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  + Add link
                </button>
              </h3>
              <div>
                {links.map((l, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", gap: 6, marginBottom: 6 }}
                  >
                    <input
                      value={l.icon || "🔗"}
                      onChange={(e) => updateLink(i, "icon", e.target.value)}
                      style={{
                        width: 50,
                        padding: 8,
                        border: "1px solid #E5E7EB",
                        borderRadius: 6,
                        textAlign: "center",
                      }}
                    />
                    <input
                      value={l.label || ""}
                      onChange={(e) => updateLink(i, "label", e.target.value)}
                      placeholder="Label"
                      style={{
                        flex: 1,
                        padding: 8,
                        border: "1px solid #E5E7EB",
                        borderRadius: 6,
                      }}
                    />
                    <input
                      value={l.url || ""}
                      onChange={(e) => updateLink(i, "url", e.target.value)}
                      placeholder="https://"
                      style={{
                        flex: 2,
                        padding: 8,
                        border: "1px solid #E5E7EB",
                        borderRadius: 6,
                      }}
                    />
                    <button
                      onClick={() => removeLink(i)}
                      style={{
                        background: "#FEE2E2",
                        color: "#991B1B",
                        border: 0,
                        padding: "8px 12px",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={cardStyle}>
              <h3 style={{ margin: "0 0 12px" }}>
                Products (Stripe checkout)
                <button
                  onClick={addProd}
                  style={{
                    float: "right",
                    background: "#7C3AED",
                    color: "white",
                    border: 0,
                    padding: "6px 12px",
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  + Add product
                </button>
              </h3>
              <div>
                {prods.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #E5E7EB",
                      borderRadius: 8,
                      padding: 10,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 100px 80px 30px",
                        gap: 6,
                      }}
                    >
                      <input
                        value={p.name || ""}
                        onChange={(e) => updateProd(i, "name", e.target.value)}
                        placeholder="Product name"
                        style={{
                          padding: 8,
                          border: "1px solid #E5E7EB",
                          borderRadius: 6,
                        }}
                      />
                      <input
                        value={p.priceCents ? p.priceCents / 100 : ""}
                        onChange={(e) =>
                          updateProd(i, "priceCents", e.target.value)
                        }
                        placeholder="9.99"
                        type="number"
                        step="0.01"
                        style={{
                          padding: 8,
                          border: "1px solid #E5E7EB",
                          borderRadius: 6,
                        }}
                      />
                      <input
                        value={p.currency || "usd"}
                        onChange={(e) =>
                          updateProd(i, "currency", e.target.value)
                        }
                        style={{
                          padding: 8,
                          border: "1px solid #E5E7EB",
                          borderRadius: 6,
                        }}
                      />
                      <button
                        onClick={() => removeProd(i)}
                        style={{
                          background: "#FEE2E2",
                          color: "#991B1B",
                          border: 0,
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <input
                      value={p.description || ""}
                      onChange={(e) =>
                        updateProd(i, "description", e.target.value)
                      }
                      placeholder="Description"
                      style={{
                        width: "100%",
                        padding: 8,
                        border: "1px solid #E5E7EB",
                        borderRadius: 6,
                        marginTop: 6,
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={save}
              style={{
                background: "#0066FF",
                color: "white",
                border: 0,
                padding: "12px 28px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              💾 Save page
            </button>
          </>
        )}
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: toast.kind === "err" ? "#DC2626" : "#0F766E",
            color: "white",
            padding: "12px 20px",
            borderRadius: 10,
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,.16)",
            zIndex: 99999,
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
