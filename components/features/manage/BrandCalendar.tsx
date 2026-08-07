"use client";

// Native React port of the legacy `brand-calendar` panel (was
// `window.buildBrandCalendar` in public/js/ig_manage_pack.js + `#view-brand-calendar`).
// Month grid + category sidebar with add/edit/delete items and a Google Calendar
// sync, against the existing Express API (`/api/brand-calendar`,
// `/api/brand-calendar/categories`, `/api/integrations/workspace/calendar/sync`).

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Category {
  id: string;
  label: string;
  color: string;
}
interface CalItem {
  id: string;
  category: string;
  title: string;
  scheduled_at: string;
  notes?: string;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function BrandCalendar({ embedded = false }: { embedded?: boolean } = {}) {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState("");
  const [items, setItems] = useState<CalItem[]>([]);
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [syncing, setSyncing] = useState(false);

  const [modal, setModal] = useState<{
    existing: CalItem | null;
    category: string;
    title: string;
    when: string;
    notes: string;
  } | null>(null);

  const loadItems = useCallback(async () => {
    const from = new Date(viewYear, viewMonth, 1, -12, 0).toISOString();
    const to = new Date(viewYear, viewMonth + 1, 1, 12, 0).toISOString();
    const q = new URLSearchParams({ from, to });
    if (activeCat) q.set("category", activeCat);
    const j = await apiGet<{ items?: CalItem[] }>("/api/brand-calendar?" + q.toString());
    setItems(j.items || []);
  }, [viewYear, viewMonth, activeCat]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const j = await apiGet<{ categories?: Category[] }>("/api/brand-calendar/categories");
      if (cancelled) return;
      setCategories(j.categories || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  }

  async function syncToGCal() {
    setSyncing(true);
    try {
      const from = new Date(viewYear, viewMonth, 1, -12, 0).toISOString();
      const to = new Date(viewYear, viewMonth + 1, 1, 12, 0).toISOString();
      const j = await apiGet<{ items?: CalItem[] }>(
        `/api/brand-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      const its = j.items || [];
      if (!its.length) {
        toast("No items this month to sync.");
        setSyncing(false);
        return;
      }
      const r = await apiPost<{ ok: boolean; synced?: number; failed?: number; error?: string }>(
        "/api/integrations/workspace/calendar/sync",
        { items: its },
      );
      if (!r.ok) {
        if (r.error && r.error.includes("not connected")) {
          alert(
            "Google Workspace is not connected yet.\n\nGo to Settings → Google Workspace → Connect via OAuth to link your account.",
          );
        } else {
          alert("Sync failed: " + (r.error || "unknown"));
        }
      } else {
        toast(
          `✅ ${r.synced} item${r.synced !== 1 ? "s" : ""} synced to Google Calendar${
            r.failed ? ` (${r.failed} failed)` : ""
          }.`,
        );
      }
    } catch (e) {
      alert("Sync error: " + (e instanceof Error ? e.message : String(e)));
    }
    setSyncing(false);
  }

  function openAdd(existing: CalItem | null, day?: number) {
    const d = existing
      ? new Date(existing.scheduled_at)
      : new Date(viewYear, viewMonth, day || new Date().getDate(), 9, 0);
    const dtv = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setModal({
      existing,
      category: existing?.category || (categories[0]?.id ?? ""),
      title: existing?.title || "",
      when: dtv,
      notes: existing?.notes || "",
    });
  }

  async function saveModal() {
    if (!modal) return;
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/brand-calendar", {
      id: modal.existing?.id,
      category: modal.category,
      title: modal.title.trim(),
      scheduled_at: new Date(modal.when).toISOString(),
      notes: modal.notes,
    });
    if (!r.ok) {
      toast("⚠️ " + (r.error || "Failed"));
      return;
    }
    setModal(null);
    loadItems();
  }

  async function deleteModal() {
    if (!modal?.existing) return;
    if (!confirm("Delete?")) return;
    const r = await apiDelete<{ ok: boolean; error?: string }>(
      "/api/brand-calendar/" + modal.existing.id,
    );
    if (!r.ok) {
      toast("⚠️ " + (r.error || "Failed"));
      return;
    }
    setModal(null);
    loadItems();
  }

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
  const byDay: Record<number, CalItem[]> = {};
  items.forEach((i) => {
    const d = new Date(i.scheduled_at).getDate();
    (byDay[d] = byDay[d] || []).push(i);
  });
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysIn = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);

  return (
    <div style={{ minHeight: embedded ? "auto" : "100vh", background: embedded ? "transparent" : "#F0F9FF", padding: embedded ? "8px 28px 28px" : "28px 32px" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        {!embedded ? (
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: "1.6rem", color: "#0F172A" }}>📅 Brand Calendar</h1>
          <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.92rem" }}>
            Plan everything across 10 categories. Filter the sidebar, click a day to add an item.
          </p>
        </div>
        ) : (
          <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: "#0F766E" }}>
            Brand Calendar editor
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 20 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #BAE6FD",
              borderRadius: 12,
              padding: 14,
              height: "fit-content",
            }}
          >
            <h3 style={{ margin: "0 0 10px", color: "#075985", fontSize: "0.95rem" }}>Calendar</h3>
            <div>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveCat("");
                }}
                style={{
                  display: "block",
                  padding: "8px 10px",
                  borderRadius: 7,
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: "0.86rem",
                  background: activeCat === "" ? "#0EA5E9" : "transparent",
                  color: activeCat === "" ? "#fff" : "#075985",
                  marginBottom: 4,
                }}
              >
                All categories
              </a>
              {categories.map((c) => (
                <a
                  key={c.id}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveCat(c.id);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 7,
                    textDecoration: "none",
                    fontSize: "0.86rem",
                    background: activeCat === c.id ? c.color : "transparent",
                    color: activeCat === c.id ? "#fff" : "#0F172A",
                    fontWeight: activeCat === c.id ? 700 : 500,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      background: c.color,
                    }}
                  />
                  {c.label}
                </a>
              ))}
            </div>
          </div>
          <div
            style={{
              background: "#fff",
              border: "1px solid #BAE6FD",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={prevMonth}
                  style={{
                    width: 32,
                    height: 32,
                    border: "1px solid #BAE6FD",
                    background: "#F0F9FF",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  ‹
                </button>
                <strong
                  style={{
                    fontSize: "1.1rem",
                    color: "#0F172A",
                    minWidth: 170,
                    textAlign: "center",
                  }}
                >
                  {monthName}
                </strong>
                <button
                  onClick={nextMonth}
                  style={{
                    width: 32,
                    height: 32,
                    border: "1px solid #BAE6FD",
                    background: "#F0F9FF",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  ›
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={syncToGCal}
                  disabled={syncing}
                  title="Sync this month's Brand Calendar items to Google Calendar as all-day events"
                  style={{
                    padding: "8px 14px",
                    background: "#fff",
                    color: "#0369a1",
                    border: "1px solid #BAE6FD",
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  {syncing ? "⏳ Syncing…" : "📅 Sync to Google Calendar"}
                </button>
                <button
                  onClick={() => openAdd(null)}
                  style={{
                    padding: "8px 16px",
                    background: "linear-gradient(135deg,#0EA5E9,#0284C7)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  + Add item
                </button>
              </div>
            </div>
            <div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7,1fr)",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                {DOW.map((d) => (
                  <div
                    key={d}
                    style={{
                      textAlign: "center",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "#64748B",
                      padding: 4,
                    }}
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
                {cells.map((d, idx) => {
                  if (d == null) return <div key={"e" + idx} />;
                  const list = byDay[d] || [];
                  return (
                    <div
                      key={d}
                      onClick={() => openAdd(null, d)}
                      style={{
                        border: "1px solid #E0F2FE",
                        borderRadius: 8,
                        minHeight: 90,
                        padding: 6,
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          color: "#075985",
                          fontSize: "0.78rem",
                          marginBottom: 4,
                        }}
                      >
                        {d}
                      </div>
                      {list.slice(0, 3).map((i) => {
                        const c = categories.find((x) => x.id === i.category) || {
                          color: "#64748B",
                        };
                        return (
                          <div
                            key={i.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              openAdd(i);
                            }}
                            title={i.title}
                            style={{
                              background: c.color,
                              color: "#fff",
                              fontSize: "0.7rem",
                              padding: "2px 5px",
                              borderRadius: 4,
                              marginBottom: 2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {i.title}
                          </div>
                        );
                      })}
                      {list.length > 3 && (
                        <div style={{ fontSize: "0.65rem", color: "#64748B" }}>
                          +{list.length - 3} more
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: 24,
              width: 480,
              maxWidth: "90vw",
            }}
          >
            <h3 style={{ margin: "0 0 14px", color: "#0F172A" }}>
              {modal.existing ? "Edit" : "New"} calendar item
            </h3>
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "#475569",
                marginBottom: 4,
              }}
            >
              Category
            </label>
            <select
              value={modal.category}
              onChange={(e) => setModal({ ...modal, category: e.target.value })}
              style={{
                width: "100%",
                padding: 9,
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                marginBottom: 10,
              }}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "#475569",
                marginBottom: 4,
              }}
            >
              Title
            </label>
            <input
              value={modal.title}
              onChange={(e) => setModal({ ...modal, title: e.target.value })}
              placeholder="e.g. Send launch email"
              style={{
                width: "100%",
                padding: 9,
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                marginBottom: 10,
              }}
            />
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "#475569",
                marginBottom: 4,
              }}
            >
              When
            </label>
            <input
              type="datetime-local"
              value={modal.when}
              onChange={(e) => setModal({ ...modal, when: e.target.value })}
              style={{
                width: "100%",
                padding: 9,
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                marginBottom: 10,
              }}
            />
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "#475569",
                marginBottom: 4,
              }}
            >
              Notes
            </label>
            <textarea
              rows={2}
              value={modal.notes}
              onChange={(e) => setModal({ ...modal, notes: e.target.value })}
              style={{
                width: "100%",
                padding: 9,
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                fontFamily: "inherit",
                marginBottom: 14,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              {modal.existing && (
                <button
                  onClick={deleteModal}
                  style={{
                    marginRight: "auto",
                    padding: "9px 16px",
                    background: "#FEE2E2",
                    color: "#B91C1C",
                    border: "1px solid #FCA5A5",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => setModal(null)}
                style={{
                  padding: "9px 16px",
                  background: "#F1F5F9",
                  border: "1px solid #CBD5E1",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveModal}
                style={{
                  padding: "9px 18px",
                  background: "#0EA5E9",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
