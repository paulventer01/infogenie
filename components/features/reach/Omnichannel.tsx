"use client";

// Native React port of the legacy `omnichannel` panel (was
// `window.buildOmnichannel` in public/js/ig_journey_omnichannel.js +
// `#view-omnichannel`). Loads available channels, lets you write one message and
// fan it out across selected channels to a list of recipients — all against the
// existing Express API (`/api/omnichannel/*`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Channel {
  id: string;
  label: string;
  configured?: boolean;
  via?: string;
}

interface SendResult {
  ok?: boolean;
  [key: string]: unknown;
}

interface Contact {
  email?: string;
  phone?: string;
}

export default function Omnichannel() {
  const toast = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recips, setRecips] = useState("");
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await apiGet<{ channels?: Channel[] }>("/api/omnichannel/channels");
      const list = r.channels || [];
      setChannels(list);
      const init: Record<string, boolean> = {};
      list.forEach((c) => {
        init[c.id] = !!c.configured;
      });
      setSelected(init);
    })().catch((e) => toast("⚠️ " + (e instanceof Error ? e.message : "error")));
  }, [toast]);

  async function send() {
    const chosen = channels.filter((c) => selected[c.id]).map((c) => c.id);
    if (!chosen.length) {
      toast("⚠️ Pick at least one channel");
      return;
    }
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      toast("⚠️ Message body required");
      return;
    }
    const contacts: Contact[] = recips
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [a, b] = line.split(",").map((s) => (s || "").trim());
        const c: Contact = {};
        if (a && a.includes("@")) c.email = a;
        else if (a) c.phone = a;
        if (b && b.includes("@")) c.email = b;
        else if (b) c.phone = b;
        return c;
      });
    if (!contacts.length && !chosen.includes("webpush")) {
      toast("⚠️ Add at least one recipient (or pick Web Push to broadcast)");
      return;
    }
    setStatus("Sending…");
    setResults(null);
    try {
      const r = await apiPost<{ results?: SendResult[] }>("/api/omnichannel/send", {
        channels: chosen,
        contacts: contacts.length ? contacts : [{}],
        subject,
        body: trimmedBody,
      });
      const arr = r.results || [];
      const ok = arr.filter((x) => x.ok).length;
      const fail = arr.length - ok;
      setStatus(`Done · ${ok} ok · ${fail} failed`);
      setResults(arr);
      setShowResults(false);
    } catch (e) {
      setStatus("");
      toast("⚠️ " + (e instanceof Error ? e.message : "error"));
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#EEF2FF", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: "1.6rem", color: "#0F172A" }}>
            📡 Omnichannel Composer
          </h1>
          <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.92rem" }}>
            Write your message once. Pick which channels to send through. We fan it
            out — Email · SMS · WhatsApp · AI Voice Call · Web Push.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5,1fr)",
            gap: 10,
            marginBottom: 20,
          }}
        >
          {channels.map((c) => (
            <label
              key={c.id}
              style={{
                background: "#fff",
                border: `2px solid ${c.configured ? "#86EFAC" : "#E2E8F0"}`,
                borderRadius: 12,
                padding: 14,
                cursor: "pointer",
                display: "block",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={!!selected[c.id]}
                  onChange={(e) => setSelected((p) => ({ ...p, [c.id]: e.target.checked }))}
                />
                <strong style={{ color: "#0F172A" }}>{c.label}</strong>
              </div>
              <div style={{ fontSize: "0.74rem", color: c.configured ? "#15803D" : "#94A3B8" }}>
                {c.configured ? "✓ Configured · " + (c.via || "") : "Not configured · " + (c.via || "")}
              </div>
            </label>
          ))}
        </div>

        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: 22 }}>
          <label style={{ display: "block", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
            Subject / Push Title
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Used by Email + Web Push"
            style={{ width: "100%", padding: 10, border: "1px solid #E2E8F0", borderRadius: 8, marginBottom: 14, boxSizing: "border-box" }}
          />
          <label style={{ display: "block", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
            Message Body
          </label>
          <textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="The message — kept short for SMS, used as the script for AI Voice."
            style={{ width: "100%", padding: 10, border: "1px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit", marginBottom: 14, boxSizing: "border-box" }}
          />
          <label style={{ display: "block", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
            Recipients (one per line — <code>email,phone</code>)
          </label>
          <textarea
            rows={4}
            value={recips}
            onChange={(e) => setRecips(e.target.value)}
            placeholder={"alice@example.com,+15551234567\nbob@example.com,+15559876543"}
            style={{ width: "100%", padding: 10, border: "1px solid #E2E8F0", borderRadius: 8, fontFamily: "monospace", fontSize: "0.86rem", marginBottom: 14, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={send}
              style={{
                padding: "12px 22px",
                background: "linear-gradient(135deg,#6366F1,#8B5CF6)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🚀 Send to selected channels
            </button>
            <span style={{ color: "#64748B", fontSize: "0.86rem" }}>{status}</span>
          </div>
          {results && (
            <div style={{ marginTop: 18 }}>
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: 10 }}>
                <div
                  onClick={() => setShowResults((s) => !s)}
                  style={{ cursor: "pointer", fontWeight: 600 }}
                >
                  View {results.length} send results
                </div>
                {showResults && (
                  <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap", fontSize: "0.78rem", color: "#475569" }}>
                    {JSON.stringify(results, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
