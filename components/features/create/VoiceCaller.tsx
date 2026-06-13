"use client";

// Native React port of the legacy `voice-caller` panel
// (`window.buildVoiceCaller` + `#view-voice-caller`, builder in
// public/js/ig_studio.js). Outbound voice agent + inbound AI receptionist
// (Vapi.ai). Endpoints: `GET /api/voice-caller/status`,
// `GET|POST /api/voice-caller/inbound-config`, `GET /api/voice-caller/calls`,
// `POST /api/voice-caller/call`. Renders REAL API data only.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface StatusResponse {
  ok: boolean;
  configured?: boolean;
}
interface InboundConfig {
  enabled?: boolean;
  voice?: string;
  greeting?: string;
  systemPrompt?: string;
  knowledge?: string;
  notifyEmail?: string;
  forwardTo?: string;
}
interface InboundConfigResponse {
  ok: boolean;
  config?: InboundConfig;
}
interface CallRow {
  lead_name?: string;
  to_number?: string;
  goal?: string;
  status?: string;
  outcome?: string;
  duration_sec?: number;
  summary?: string;
  recording_url?: string;
}
interface CallsResponse {
  ok: boolean;
  error?: string;
  calls: CallRow[];
}

function toast(msg: string) {
  const w = window as unknown as { showToast?: (m: string) => void };
  if (typeof w.showToast === "function") w.showToast(msg);
}

function origin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.82rem",
};
const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: 9,
  border: "1.5px solid #E5E7EB",
  borderRadius: 8,
  margin: "4px 0",
  boxSizing: "border-box",
};

export default function VoiceCaller() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  // Inbound config
  const [inEnabled, setInEnabled] = useState(false);
  const [inVoice, setInVoice] = useState("jennifer");
  const [inGreet, setInGreet] = useState(
    "Hi, thanks for calling. How can I help you today?",
  );
  const [inSys, setInSys] = useState(
    "You are a friendly receptionist. Keep replies under 2 sentences. If the caller wants to book a meeting, take their name, email and preferred time, then confirm.",
  );
  const [inKnowledge, setInKnowledge] = useState("");
  const [inEmail, setInEmail] = useState("");
  const [inForward, setInForward] = useState("");

  // Outbound
  const [to, setTo] = useState("");
  const [leadName, setLeadName] = useState("");
  const [goal, setGoal] = useState("qualify");
  const [script, setScript] = useState("");

  // Calls
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [callsStatus, setCallsStatus] = useState<
    "loading" | "idle" | "error"
  >("loading");
  const [callsError, setCallsError] = useState("");

  const reloadCalls = useCallback(async () => {
    setCallsStatus("loading");
    const r = await apiGet<CallsResponse>("/api/voice-caller/calls");
    if (!r.ok) {
      setCallsStatus("error");
      setCallsError(r.error || "failed");
      return;
    }
    setCalls(r.calls || []);
    setCallsStatus("idle");
  }, []);

  useEffect(() => {
    (async () => {
      const st = await apiGet<StatusResponse>("/api/voice-caller/status");
      if (st.ok) setConfigured(!!st.configured);
      const ic = await apiGet<InboundConfigResponse>(
        "/api/voice-caller/inbound-config",
      );
      if (ic.ok && ic.config) {
        const c = ic.config;
        setInEnabled(!!c.enabled);
        setInVoice(c.voice || "jennifer");
        if (c.greeting) setInGreet(c.greeting);
        if (c.systemPrompt) setInSys(c.systemPrompt);
        setInKnowledge(c.knowledge || "");
        setInEmail(c.notifyEmail || "");
        setInForward(c.forwardTo || "");
      }
    })();
    reloadCalls();
  }, [reloadCalls]);

  async function saveInbound() {
    const r = await apiPost("/api/voice-caller/inbound-config", {
      enabled: inEnabled,
      voice: inVoice,
      greeting: inGreet,
      systemPrompt: inSys,
      knowledge: inKnowledge,
      notifyEmail: inEmail,
      forwardTo: inForward,
    });
    if (r.ok) toast("Inbound config saved ✓");
    else toast(r.error || "Save failed");
  }

  async function placeCall() {
    const r = await apiPost("/api/voice-caller/call", {
      to,
      leadName,
      goal,
      script,
    });
    if (r.ok) {
      toast("Call queued ✓");
      reloadCalls();
    } else {
      toast(r.error || "Call failed");
    }
  }

  const webhook = `${origin()}/api/voice-caller/webhook`;

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>
                📞 AI Voice Caller
              </h1>
              <p style={{ margin: "6px 0 0", color: "#64748B" }}>
                Outbound voice agent + inbound AI receptionist, powered by
                Vapi.ai.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ padding: "24px 0 64px" }}>
        <div style={{ marginBottom: 16 }}>
          {configured === true && (
            <div
              style={{
                background: "#ECFDF5",
                color: "#065F46",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              ✓ Vapi configured. Webhook URL: <code>{webhook}</code>
            </div>
          )}
          {configured === false && (
            <div
              style={{
                background: "#FEF3C7",
                color: "#78350F",
                padding: "12px 14px",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              ⚠ Vapi not configured. Add <code>VAPI_API_KEY</code> and{" "}
              <code>VAPI_PHONE_NUMBER_ID</code> in Secrets, then set Vapi server
              URL to <code>{webhook}</code>.
            </div>
          )}
        </div>

        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <h3 style={{ margin: 0 }}>📥 Inbound Receptionist</h3>
            <button
              onClick={saveInbound}
              style={{
                background: "#0F766E",
                color: "white",
                border: 0,
                padding: "8px 16px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              💾 Save inbound config
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 12px" }}>
            When enabled, calls to your Vapi number are answered by an AI
            receptionist. In Vapi → Phone Numbers, set{" "}
            <strong>Server URL</strong> to <code>{webhook}</code> so Vapi asks us
            for the assistant on each inbound call.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={inEnabled}
                onChange={(e) => setInEnabled(e.target.checked)}
              />{" "}
              Enabled (answer inbound calls)
            </label>
            <label style={labelStyle}>
              Voice
              <select
                value={inVoice}
                onChange={(e) => setInVoice(e.target.value)}
                style={fieldStyle}
              >
                <option>jennifer</option>
                <option>cole</option>
                <option>mark</option>
                <option>sarah</option>
                <option>elliot</option>
              </select>
            </label>
          </div>
          <label style={labelStyle}>
            Greeting (first thing the AI says)
            <input
              value={inGreet}
              onChange={(e) => setInGreet(e.target.value)}
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            System prompt (how the AI should behave)
            <textarea
              rows={3}
              value={inSys}
              onChange={(e) => setInSys(e.target.value)}
              style={{ ...fieldStyle, fontFamily: "inherit" }}
            />
          </label>
          <label style={labelStyle}>
            Knowledge / FAQ (paste your &quot;About&quot; page or any facts the
            AI should know)
            <textarea
              rows={4}
              value={inKnowledge}
              onChange={(e) => setInKnowledge(e.target.value)}
              placeholder="Hours: Mon-Fri 9-5. Pricing: Starter $29/mo… etc."
              style={{ ...fieldStyle, fontFamily: "inherit" }}
            />
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <label style={labelStyle}>
              Notify on call (email)
              <input
                value={inEmail}
                onChange={(e) => setInEmail(e.target.value)}
                placeholder="ops@yourdomain.com"
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              Forward-to number (optional, E.164)
              <input
                value={inForward}
                onChange={(e) => setInForward(e.target.value)}
                placeholder="+27821234567"
                style={fieldStyle}
              />
            </label>
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
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <h3 style={{ margin: "0 0 12px" }}>📤 Place an outbound call</h3>
            <label style={labelStyle}>
              To (E.164, e.g. +27821234567)
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={{ ...fieldStyle, padding: 10 }}
              />
            </label>
            <label style={labelStyle}>
              Lead name (optional)
              <input
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                style={{ ...fieldStyle, padding: 10 }}
              />
            </label>
            <label style={labelStyle}>
              Goal
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                style={{ ...fieldStyle, padding: 10 }}
              >
                <option value="qualify">Qualify lead</option>
                <option value="book-meeting">Book a meeting</option>
                <option value="win-back">Win back churned customer</option>
                <option value="follow-up">Follow up after demo</option>
              </select>
            </label>
            <label style={labelStyle}>
              Script / context
              <textarea
                rows={6}
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Hi, I'm calling on behalf of [your company]. We help [target] do [outcome]. Goal: confirm whether they have [problem] right now and book a 15-min call."
                style={{ ...fieldStyle, padding: 10, fontFamily: "inherit" }}
              />
            </label>
            <button
              onClick={placeCall}
              style={{
                background: "#0066FF",
                color: "white",
                border: 0,
                padding: "12px 24px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              📞 Place call
            </button>
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <h3 style={{ margin: "0 0 12px" }}>Recent calls</h3>
            {callsStatus === "loading" && (
              <div style={{ color: "#94A3B8", fontSize: 13 }}>Loading…</div>
            )}
            {callsStatus === "error" && (
              <div style={{ color: "#DC2626" }}>{callsError}</div>
            )}
            {callsStatus === "idle" &&
              (calls.length ? (
                calls.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      borderBottom: "1px solid #F1F5F9",
                      padding: "10px 0",
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {c.lead_name || ""} {c.to_number}
                    </div>
                    <div style={{ color: "#64748B" }}>
                      {c.goal || ""} · {c.status || ""}{" "}
                      {c.outcome ? "· " + c.outcome : ""}{" "}
                      {c.duration_sec ? "· " + c.duration_sec + "s" : ""}
                    </div>
                    {c.summary && (
                      <div
                        style={{
                          marginTop: 4,
                          color: "#475569",
                          fontStyle: "italic",
                        }}
                      >
                        {c.summary.slice(0, 200)}
                      </div>
                    )}
                    {c.recording_url && (
                      <a
                        href={c.recording_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: "#0066FF" }}
                      >
                        ▶ Recording
                      </a>
                    )}
                  </div>
                ))
              ) : (
                <p style={{ color: "#94A3B8", fontSize: 13 }}>No calls yet.</p>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
