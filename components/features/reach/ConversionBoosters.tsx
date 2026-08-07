"use client";

// Native React port of the legacy `conversion-boosters` panel (was
// `window.buildConversionBoosters` + `#view-conversion-boosters` / `#cnvbWrap`
// in public/js/ig_seo.js). Manages Social Proof and Exit Intent embed widgets
// against the existing Express API (`/api/conversion-boosters/*`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

interface CBItem {
  name: string;
  location?: string;
  action?: string;
  when?: string;
}

interface CBSettings {
  position?: string;
  intervalSeconds?: number;
  displaySeconds?: number;
  accent?: string;
  items?: CBItem[];
  headline?: string;
  subheadline?: string;
  ctaText?: string;
  dismissCookieDays?: number;
  redirectUrl?: string;
}

interface CBWidget {
  id: string;
  type: string;
  name: string;
  views: number;
  leads: number;
  settings?: CBSettings;
}

interface CBEvent {
  event_type: string;
  email?: string;
  created_at: string;
}

interface EventState {
  counts: Record<string, number>;
  events: CBEvent[];
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--border-color,#e2e8f0)",
  borderRadius: 6,
  background: "var(--card-bg,#fff)",
  marginTop: 4,
};

function CBForm({
  type,
  widget,
  defaults,
  onSaved,
  onCancel,
}: {
  type: string;
  widget: CBWidget | null;
  defaults: Record<string, CBSettings> | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const def = (defaults && defaults[type]) || {};
  const cur = (widget && widget.settings) || def;

  const [name, setName] = useState(widget ? widget.name : type === "social_proof" ? "My Social Proof" : "My Exit Intent");
  // social_proof
  const [position, setPosition] = useState(cur.position || "bottom-left");
  const [intervalSeconds, setIntervalSeconds] = useState(cur.intervalSeconds || 12);
  const [displaySeconds, setDisplaySeconds] = useState(cur.displaySeconds || 5);
  const [spAccent, setSpAccent] = useState(cur.accent || "#10B981");
  const [items, setItems] = useState(
    (cur.items || def.items || [])
      .map((i) => `${i.name} | ${i.location || ""} | ${i.action || ""} | ${i.when || ""}`)
      .join("\n"),
  );
  // exit_intent
  const [eiAccent, setEiAccent] = useState(cur.accent || "#0066FF");
  const [headline, setHeadline] = useState(cur.headline || "Wait — before you go!");
  const [subheadline, setSubheadline] = useState(cur.subheadline || "");
  const [ctaText, setCtaText] = useState(cur.ctaText || "Send me the guide");
  const [cookieDays, setCookieDays] = useState(cur.dismissCookieDays ?? 7);
  const [redirectUrl, setRedirectUrl] = useState(cur.redirectUrl || "");

  async function save() {
    const finalName = name.trim() || (type === "social_proof" ? "Social Proof" : "Exit Intent");
    let settings: CBSettings;
    if (type === "social_proof") {
      const parsed = items
        .split("\n")
        .map((l) => {
          const p = l.split("|").map((s) => s.trim());
          if (!p[0]) return null;
          return { name: p[0], location: p[1] || "", action: p[2] || "just signed up", when: p[3] || "recently" };
        })
        .filter(Boolean) as CBItem[];
      settings = {
        position,
        intervalSeconds: parseInt(String(intervalSeconds), 10),
        displaySeconds: parseInt(String(displaySeconds), 10),
        accent: spAccent,
        items: parsed,
      };
    } else {
      settings = {
        headline,
        subheadline,
        ctaText,
        accent: eiAccent,
        dismissCookieDays: parseInt(String(cookieDays), 10) || 0,
        redirectUrl: redirectUrl.trim(),
      };
    }
    const r = widget
      ? await apiPatch<{ ok: boolean; error?: string }>("/api/conversion-boosters/widgets/" + widget.id, {
          name: finalName,
          settings,
        })
      : await apiPost<{ ok: boolean; error?: string }>("/api/conversion-boosters/widgets", {
          type,
          name: finalName,
          settings,
        });
    if (!r.ok) {
      alert("Failed: " + (r.error || "unknown"));
      return;
    }
    onSaved();
  }

  return (
    <div className="dna-card" style={{ padding: 20, marginBottom: 16 }}>
      {type === "social_proof" ? (
        <>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>{widget ? "Edit" : "New"} Social Proof Widget</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              Name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
            </label>
            <label>
              Position
              <select value={position} onChange={(e) => setPosition(e.target.value)} style={fieldStyle}>
                {["bottom-left", "bottom-right", "top-left", "top-right"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Show every (sec)
              <input
                type="number"
                min={4}
                max={120}
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                style={fieldStyle}
              />
            </label>
            <label>
              Display for (sec)
              <input
                type="number"
                min={2}
                max={30}
                value={displaySeconds}
                onChange={(e) => setDisplaySeconds(Number(e.target.value))}
                style={fieldStyle}
              />
            </label>
            <label>
              Accent color
              <input
                type="color"
                value={spAccent}
                onChange={(e) => setSpAccent(e.target.value)}
                style={{ ...fieldStyle, height: 38, padding: 4 }}
              />
            </label>
          </div>
          <label style={{ display: "block", marginTop: 14 }}>
            Recent activity items{" "}
            <span style={{ color: "#64748b", fontWeight: "normal", fontSize: "0.8rem" }}>
              (one per line: Name | Location | Action | When)
            </span>
            <textarea
              rows={6}
              value={items}
              onChange={(e) => setItems(e.target.value)}
              style={{ ...fieldStyle, fontFamily: "monospace", fontSize: "0.82rem" }}
            />
          </label>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>{widget ? "Edit" : "New"} Exit Intent Widget</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              Name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
            </label>
            <label>
              Accent color
              <input
                type="color"
                value={eiAccent}
                onChange={(e) => setEiAccent(e.target.value)}
                style={{ ...fieldStyle, height: 38, padding: 4 }}
              />
            </label>
          </div>
          <label style={{ display: "block", marginTop: 12 }}>
            Headline
            <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} style={fieldStyle} />
          </label>
          <label style={{ display: "block", marginTop: 12 }}>
            Subheadline
            <input type="text" value={subheadline} onChange={(e) => setSubheadline(e.target.value)} style={fieldStyle} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
            <label>
              CTA button text
              <input type="text" value={ctaText} onChange={(e) => setCtaText(e.target.value)} style={fieldStyle} />
            </label>
            <label>
              Cookie days <span style={{ color: "#64748b", fontSize: "0.78rem" }}>(don&apos;t re-show)</span>
              <input
                type="number"
                min={0}
                max={365}
                value={cookieDays}
                onChange={(e) => setCookieDays(Number(e.target.value))}
                style={fieldStyle}
              />
            </label>
            <label>
              Redirect after submit (optional)
              <input
                type="url"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="https://…"
                style={fieldStyle}
              />
            </label>
          </div>
        </>
      )}
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button className="btn btn-primary" onClick={save}>
          {widget ? "💾 Save" : "🚀 Create widget"}
        </button>
        <button className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function ConversionBoosters() {
  const [defaults, setDefaults] = useState<Record<string, CBSettings> | null>(null);
  const [widgets, setWidgets] = useState<CBWidget[] | null>(null);
  const [formType, setFormType] = useState<string | null>(null);
  const [editing, setEditing] = useState<CBWidget | null>(null);
  const [events, setEvents] = useState<Record<string, EventState | "loading" | null>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function loadDefaults() {
    const j = await apiGet<{ defaults: Record<string, CBSettings> }>("/api/conversion-boosters/defaults");
    setDefaults(j.defaults || {});
  }

  async function loadList() {
    const j = await apiGet<{ ok: boolean; widgets: CBWidget[] }>("/api/conversion-boosters/widgets");
    if (!j.ok || !j.widgets) setWidgets([]);
    else setWidgets(j.widgets);
  }

  useEffect(() => {
    loadDefaults();
    loadList();
  }, []);

  function openForm(type: string, widget: CBWidget | null) {
    setEditing(widget);
    setFormType(type);
  }

  function closeForm() {
    setFormType(null);
    setEditing(null);
  }

  function onSaved() {
    closeForm();
    loadList();
  }

  async function del(id: string) {
    if (!confirm("Delete this widget? The embed snippet will stop working.")) return;
    await apiDelete("/api/conversion-boosters/widgets/" + id);
    loadList();
  }

  async function toggleEvents(id: string) {
    if (events[id] && events[id] !== "loading") {
      setEvents((e) => ({ ...e, [id]: null }));
      return;
    }
    setEvents((e) => ({ ...e, [id]: "loading" }));
    const r = await apiGet<{ ok: boolean; counts?: Record<string, number>; events?: CBEvent[] }>(
      "/api/conversion-boosters/widgets/" + id + "/events",
    );
    if (!r.ok) {
      setEvents((e) => ({ ...e, [id]: { counts: {}, events: [] } }));
      return;
    }
    setEvents((e) => ({ ...e, [id]: { counts: r.counts || {}, events: r.events || [] } }));
  }

  function copySnippet(snippet: string, id: string) {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    });
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Conversion Boosters
              </div>
              <h2 className="view-title">🚀 Conversion Boosters</h2>
              <p className="view-sub">
                Two paste-once widgets for any external marketing site — <strong>Social Proof popup</strong> (rotating
                &quot;Sarah from Cape Town just signed up&quot; toasts) and <strong>Exit Intent popup</strong> (captures
                email when the visitor&apos;s mouse leaves the page). Same one-line embed pattern as the SEO Audit
                Widget. Captured leads land in the Unified Inbox automatically.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
          <div
            className="dna-card cb-pick"
            onClick={() => openForm("social_proof", null)}
            style={{
              padding: 22,
              cursor: "pointer",
              border: `2px solid ${formType === "social_proof" ? "#0ea5e9" : "transparent"}`,
              transition: ".15s",
            }}
          >
            <div style={{ fontSize: "1.8rem", marginBottom: 8 }}>📣</div>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 4 }}>Social Proof Popup</div>
            <div style={{ color: "#64748b", fontSize: "0.86rem" }}>
              Rotating &quot;Sarah from Cape Town just signed up&quot; toasts. Proven 5–15% conversion lift.
            </div>
          </div>
          <div
            className="dna-card cb-pick"
            onClick={() => openForm("exit_intent", null)}
            style={{
              padding: 22,
              cursor: "pointer",
              border: `2px solid ${formType === "exit_intent" ? "#0ea5e9" : "transparent"}`,
              transition: ".15s",
            }}
          >
            <div style={{ fontSize: "1.8rem", marginBottom: 8 }}>🚪</div>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 4 }}>Exit Intent Popup</div>
            <div style={{ color: "#64748b", fontSize: "0.86rem" }}>
              Captures email when the visitor&apos;s mouse leaves the page. Lands in Unified Inbox.
            </div>
          </div>
        </div>

        {formType && (
          <CBForm
            key={(editing ? editing.id : "new") + ":" + formType}
            type={formType}
            widget={editing}
            defaults={defaults}
            onSaved={onSaved}
            onCancel={closeForm}
          />
        )}

        <div className="dna-card" style={{ padding: 0 }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-color,#e2e8f0)", fontWeight: 700 }}>
            Your widgets
          </div>
          <div>
            {widgets === null ? (
              <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>Loading…</div>
            ) : widgets.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                No widgets yet — click a card above to create your first.
              </div>
            ) : (
              widgets.map((w) => {
                const snippet = `<script src="${origin}/api/conversion-boosters/embed/${w.id}.js" async></` + `script>`;
                const emoji = w.type === "social_proof" ? "📣" : "🚪";
                const ev = events[w.id];
                return (
                  <div key={w.id} style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-color,#e2e8f0)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 2 }}>
                          {emoji} {w.name}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "0.82rem" }}>
                          {w.type} · {w.views} views · {w.leads} leads · ID: <code>{w.id}</code>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button className="btn btn-secondary" onClick={() => openForm(w.type, w)} style={{ fontSize: "0.82rem" }}>
                          ⚙️ Edit
                        </button>
                        <button className="btn btn-secondary" onClick={() => toggleEvents(w.id)} style={{ fontSize: "0.82rem" }}>
                          📊 Activity
                        </button>
                        <button className="btn btn-link" onClick={() => del(w.id)} style={{ color: "#dc2626", fontSize: "0.82rem" }}>
                          🗑
                        </button>
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>
                        Paste this on any page:
                      </label>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="text"
                          readOnly
                          value={snippet}
                          style={{
                            flex: 1,
                            padding: "8px 10px",
                            fontFamily: "monospace",
                            fontSize: "0.78rem",
                            border: "1px solid var(--border-color,#e2e8f0)",
                            borderRadius: 6,
                            background: "var(--bg-secondary,#f8fafc)",
                          }}
                        />
                        <button className="btn btn-primary" onClick={() => copySnippet(snippet, w.id)} style={{ fontSize: "0.82rem" }}>
                          {copiedId === w.id ? "✓ Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                    {ev && ev !== "loading" ? (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ background: "var(--bg-secondary,#f8fafc)", padding: 12, borderRadius: 6, fontSize: "0.86rem" }}>
                          <div style={{ marginBottom: 8 }}>
                            <strong>{ev.counts.view || 0}</strong> views · <strong>{ev.counts.lead || 0}</strong> leads ·{" "}
                            <strong>{ev.counts.dismiss || 0}</strong> dismissals
                          </div>
                          {ev.events.length ? (
                            <div style={{ maxHeight: 240, overflowY: "auto" }}>
                              {ev.events.map((e, ei) => (
                                <div
                                  key={ei}
                                  style={{
                                    padding: "6px 0",
                                    borderTop: "1px solid var(--border-color,#e2e8f0)",
                                    fontSize: "0.82rem",
                                  }}
                                >
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 60,
                                      color: e.event_type === "lead" ? "#16a34a" : e.event_type === "dismiss" ? "#dc2626" : "#64748b",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {e.event_type}
                                  </span>{" "}
                                  {e.email ? e.email + " · " : ""}
                                  <span style={{ color: "#94a3b8" }}>{new Date(e.created_at).toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ color: "#64748b" }}>No activity yet.</div>
                          )}
                        </div>
                      </div>
                    ) : ev === "loading" ? (
                      <div style={{ marginTop: 12, padding: 12, color: "#64748b" }}>Loading…</div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
