"use client";

// Native React port of the legacy `signal-triggers` panel (was
// `window.buildSignalTriggers` in public/js/ig_journey_omnichannel.js +
// `#view-signal-triggers`). Lists signal-trigger types + journeys, creates and
// deletes triggers, and manually fires a test signal — all against the existing
// Express API (`/api/signal-triggers*`, `/api/journeys`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface SignalType {
  id: string;
  label: string;
}

interface Journey {
  id: string;
  name: string;
}

interface Trigger {
  id: string;
  name: string;
  signal_type: string;
  journey_id?: string;
  fire_count?: number;
  last_fired_at?: string | null;
}

export default function SignalTriggers() {
  const toast = useToast();
  const [types, setTypes] = useState<SignalType[]>([]);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [triggers, setTriggers] = useState<Trigger[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // new trigger form
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [minVal, setMinVal] = useState("");
  const [keyword, setKeyword] = useState("");
  const [journeyId, setJourneyId] = useState("");

  // fire form
  const [fireType, setFireType] = useState("");
  const [fireEmail, setFireEmail] = useState("");
  const [fireValue, setFireValue] = useState("");

  async function refresh() {
    setListError(null);
    try {
      const r = await apiGet<{ triggers?: Trigger[] }>("/api/signal-triggers");
      setTriggers(r.triggers || []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "error");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [t, j] = await Promise.all([
        apiGet<{ types?: SignalType[] }>("/api/signal-triggers/types"),
        apiGet<{ journeys?: Journey[] }>("/api/journeys"),
      ]);
      if (cancelled) return;
      const tl = t.types || [];
      setTypes(tl);
      setJourneys(j.journeys || []);
      if (tl.length) {
        setType(tl[0].id);
        setFireType(tl[0].id);
      }
      const r = await apiGet<{ triggers?: Trigger[] }>("/api/signal-triggers");
      if (cancelled) return;
      setTriggers(r.triggers || []);
    })().catch((e) => {
      if (!cancelled) setListError(e instanceof Error ? e.message : "error");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function addTrigger() {
    if (!name.trim()) {
      toast("⚠️ Name required");
      return;
    }
    if (!journeyId) {
      toast("⚠️ Pick a journey");
      return;
    }
    const condition: { minValue?: number; keyword?: string } = {};
    if (minVal) condition.minValue = +minVal;
    if (keyword.trim()) condition.keyword = keyword.trim();
    try {
      await apiPost("/api/signal-triggers", {
        name: name.trim(),
        signal_type: type,
        condition,
        journey_id: journeyId,
        enabled: true,
      });
      toast("✓ Trigger created");
      setName("");
      setMinVal("");
      setKeyword("");
      setJourneyId("");
      await refresh();
    } catch (e) {
      toast("⚠️ " + (e instanceof Error ? e.message : "error"));
    }
  }

  async function fire() {
    try {
      const r = await apiPost<{ matched?: number }>("/api/signal-triggers/fire", {
        signal_type: fireType,
        payload: {
          email: fireEmail.trim(),
          value: fireValue ? +fireValue : undefined,
        },
      });
      toast("✓ Fired · matched " + (r.matched || 0) + " triggers");
    } catch (e) {
      toast("⚠️ " + (e instanceof Error ? e.message : "error"));
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this trigger?")) return;
    try {
      await apiDelete("/api/signal-triggers/" + id);
      await refresh();
    } catch (e) {
      toast("⚠️ " + (e instanceof Error ? e.message : "error"));
    }
  }

  const inputAmber: React.CSSProperties = {
    padding: 9,
    border: "1px solid #FBBF24",
    borderRadius: 8,
  };
  const inputSlate: React.CSSProperties = {
    padding: 9,
    border: "1px solid #E2E8F0",
    borderRadius: 8,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FEF7E6", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: "1.6rem", color: "#0F172A" }}>
            ⚡ Real-time Signal Triggers
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              color: "#64748B",
              fontSize: "0.92rem",
            }}
          >
            When something happens out in the wild — a mention spike, a competitor
            price change, a bad review — automatically enrol affected contacts into
            a customer journey.
          </p>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #FBBF24",
            borderRadius: 14,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <h3 style={{ margin: "0 0 14px", color: "#92400E", fontSize: "1rem" }}>
            + New Trigger
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Trigger name (e.g. 'High-volume mentions → win-back')"
              style={inputAmber}
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={inputAmber}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <input
              type="number"
              value={minVal}
              onChange={(e) => setMinVal(e.target.value)}
              placeholder="Optional: minValue threshold"
              style={inputAmber}
            />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Optional: keyword filter"
              style={inputAmber}
            />
            <select
              value={journeyId}
              onChange={(e) => setJourneyId(e.target.value)}
              style={inputAmber}
            >
              <option value="">— Pick a journey to launch —</option>
              {journeys.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={addTrigger}
            style={{
              padding: "10px 18px",
              background: "#F59E0B",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Create Trigger
          </button>
        </div>

        <h3 style={{ margin: "0 0 12px", color: "#0F172A", fontSize: "1.05rem" }}>
          Active triggers
        </h3>
        <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
          {listError ? (
            <div style={{ color: "#B91C1C" }}>{listError}</div>
          ) : triggers === null ? (
            <div style={{ color: "#64748B" }}>Loading…</div>
          ) : triggers.length === 0 ? (
            <div
              style={{
                background: "#fff",
                border: "1px dashed #CBD5E1",
                borderRadius: 10,
                padding: 20,
                textAlign: "center",
                color: "#64748B",
              }}
            >
              No triggers yet
            </div>
          ) : (
            triggers.map((t) => (
              <div
                key={t.id}
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 10,
                  padding: 14,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div>
                  <strong style={{ color: "#0F172A" }}>{t.name}</strong>
                  <div
                    style={{
                      color: "#64748B",
                      fontSize: "0.84rem",
                      marginTop: 3,
                    }}
                  >
                    {t.signal_type} → journey {t.journey_id || "(none)"} · fired{" "}
                    {t.fire_count || 0}×{" "}
                    {t.last_fired_at
                      ? "· last " + new Date(t.last_fired_at).toLocaleString()
                      : ""}
                  </div>
                </div>
                <button
                  onClick={() => del(t.id)}
                  style={{
                    padding: "6px 12px",
                    background: "#FEE2E2",
                    color: "#B91C1C",
                    border: "1px solid #FCA5A5",
                    borderRadius: 7,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            padding: 20,
          }}
        >
          <h3 style={{ margin: "0 0 12px", color: "#0F172A", fontSize: "1rem" }}>
            🧪 Manually fire a signal (test)
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr auto",
              gap: 10,
              alignItems: "center",
            }}
          >
            <select
              value={fireType}
              onChange={(e) => setFireType(e.target.value)}
              style={inputSlate}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              value={fireEmail}
              onChange={(e) => setFireEmail(e.target.value)}
              placeholder="contact email"
              style={inputSlate}
            />
            <input
              type="number"
              value={fireValue}
              onChange={(e) => setFireValue(e.target.value)}
              placeholder="value (optional)"
              style={inputSlate}
            />
            <button
              onClick={fire}
              style={{
                padding: "9px 16px",
                background: "#0EA5E9",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Fire 🚀
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
