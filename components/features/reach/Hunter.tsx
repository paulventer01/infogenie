"use client";

// Native React port of the legacy `hunter` panel (was `window.buildHunter` in
// public/js/ig_intel_pack_b.js + `#view-hunter` in index.html). Four tabs —
// domain search, email finder, email verifier and search history — against the
// existing Express API (`POST /api/hunter/domain-search`, `/email-finder`,
// `/email-verifier`; `GET /api/hunter/history`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

type TabId = "domain" | "finder" | "verifier" | "history";

const TABS: { id: TabId; label: string }[] = [
  { id: "domain", label: "🔍 Domain Search" },
  { id: "finder", label: "🎯 Email Finder" },
  { id: "verifier", label: "✅ Email Verifier" },
  { id: "history", label: "🕘 Search History" },
];

interface DomainEmail {
  value: string;
  confidence: number;
  first_name: string;
  last_name: string;
  position?: string;
  type?: string;
  sources: number;
}
interface DomainResult {
  ok: boolean;
  error?: string;
  result?: {
    emails: DomainEmail[];
    organization?: string;
    domain: string;
    pattern?: string;
    country?: string;
  };
}
interface FinderResult {
  ok: boolean;
  error?: string;
  result?: {
    email?: string;
    score: number;
    position?: string;
    company?: string;
    sources: number;
  };
}
interface VerifyResult {
  ok: boolean;
  error?: string;
  result?: {
    status: string;
    score: number;
    email: string;
    regexp?: boolean;
    mx_records?: boolean;
    smtp_check?: boolean;
    disposable?: boolean;
    accept_all?: boolean;
    block?: boolean;
  };
}
interface HistoryRow {
  type: string;
  query: string;
  total_emails?: number;
  found_email?: string;
  verify_status?: string;
  created_at: string;
}
interface HistoryResult {
  ok: boolean;
  history?: HistoryRow[];
}

function confidenceColor(n: number) {
  return n >= 80 ? "#16A34A" : n >= 50 ? "#D97706" : "#DC2626";
}
function verifyColor(s: string) {
  return (
    (
      {
        deliverable: "#16A34A",
        risky: "#D97706",
        undeliverable: "#DC2626",
        unknown: "#6B7280",
      } as Record<string, string>
    )[s] || "#6B7280"
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E5E7EB",
  borderRadius: 12,
  padding: 24,
  marginBottom: 24,
};
const inputStyle: React.CSSProperties = {
  padding: "10px 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontSize: "0.9rem",
};
const btnStyle: React.CSSProperties = {
  padding: "10px 20px",
  background: "#6C63FF",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 700,
  cursor: "pointer",
};

function DomainTab() {
  const [domain, setDomain] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [res, setRes] = useState<DomainResult["result"] | null>(null);

  async function search() {
    if (!domain.trim()) return;
    setStatus("loading");
    setError("");
    const d = await apiPost<DomainResult>("/api/hunter/domain-search", {
      domain: domain.trim(),
      type,
    });
    if (!d.ok || !d.result) {
      setStatus("error");
      setError(d.error || "Search failed");
      return;
    }
    setRes(d.result);
    setStatus("done");
  }

  return (
    <>
      <div style={{ ...cardStyle, maxWidth: 640 }}>
        <h3
          style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 700, color: "#111" }}
        >
          Domain Search
        </h3>
        <p style={{ margin: "0 0 18px", fontSize: "0.84rem", color: "#6B7280" }}>
          Find all email addresses associated with a company domain.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            placeholder="acme.com"
            style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <select
            style={{ ...inputStyle, fontSize: "0.84rem", background: "#fff" }}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">All types</option>
            <option value="personal">Personal only</option>
            <option value="generic">Generic only</option>
          </select>
          <button onClick={search} style={btnStyle}>
            Search
          </button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: "0.78rem", color: "#9CA3AF" }}>
          No API key yet? <strong>Add HUNTER_API_KEY</strong> to environment
          secrets —{" "}
          <a
            href="https://hunter.io/api-keys"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#6C63FF" }}
          >
            get your free key at hunter.io
          </a>{" "}
          (25 searches/month free).
        </p>
      </div>
      <div>
        {status === "loading" && (
          <div style={{ color: "#6B7280", fontSize: "0.9rem", padding: 12 }}>
            Searching...
          </div>
        )}
        {status === "error" && (
          <div
            style={{
              color: "#DC2626",
              padding: 12,
              background: "#FEF2F2",
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        )}
        {status === "done" && res && (
          <>
            <div
              style={{
                marginBottom: 16,
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  background: "#F0FDF4",
                  border: "1px solid #BBF7D0",
                  borderRadius: 10,
                  padding: "16px 24px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{ fontSize: "1.6rem", fontWeight: 800, color: "#16A34A" }}
                >
                  {res.emails.length}
                </div>
                <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>
                  Emails found
                </div>
              </div>
              <div
                style={{
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: 10,
                  padding: "16px 24px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1D4ED8" }}
                >
                  {res.organization || res.domain}
                </div>
                <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>
                  {res.pattern ? "Pattern: " + res.pattern : res.country || ""}
                </div>
              </div>
            </div>
            {res.emails.length === 0 ? (
              <div
                style={{
                  color: "#6B7280",
                  padding: 16,
                  background: "#F9FAFB",
                  borderRadius: 8,
                  textAlign: "center",
                }}
              >
                No emails found for this domain.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.84rem",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#F9FAFB" }}>
                      {["Email", "Confidence", "Name", "Position", "Type", "Sources"].map(
                        (h) => (
                          <th
                            key={h}
                            style={{
                              padding: "10px 14px",
                              textAlign: "left",
                              borderBottom: "2px solid #E5E7EB",
                              fontWeight: 700,
                              color: "#374151",
                            }}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {res.emails.map((e, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <td
                          style={{
                            padding: "10px 14px",
                            fontFamily: "monospace",
                            fontSize: "0.83rem",
                          }}
                        >
                          {e.value}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span
                            style={{
                              color: confidenceColor(e.confidence),
                              fontWeight: 700,
                            }}
                          >
                            {e.confidence}%
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          {(e.first_name + " " + e.last_name).trim() || "—"}
                        </td>
                        <td style={{ padding: "10px 14px", color: "#6B7280" }}>
                          {e.position || "—"}
                        </td>
                        <td
                          style={{
                            padding: "10px 14px",
                            textTransform: "capitalize",
                          }}
                        >
                          {e.type || "—"}
                        </td>
                        <td style={{ padding: "10px 14px", color: "#6B7280" }}>
                          {e.sources}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function FinderTab() {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [res, setRes] = useState<FinderResult["result"] | null>(null);
  const [copied, setCopied] = useState(false);

  async function find() {
    if (!first.trim() || !last.trim() || !domain.trim()) {
      alert("Please fill in first name, last name and domain.");
      return;
    }
    setStatus("loading");
    setError("");
    const d = await apiPost<FinderResult>("/api/hunter/email-finder", {
      first_name: first.trim(),
      last_name: last.trim(),
      domain: domain.trim(),
    });
    if (!d.ok || !d.result) {
      setStatus("error");
      setError(d.error || "Search failed");
      return;
    }
    setRes(d.result);
    setStatus("done");
  }

  return (
    <>
      <div style={{ ...cardStyle, maxWidth: 640 }}>
        <h3
          style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 700, color: "#111" }}
        >
          Email Finder
        </h3>
        <p style={{ margin: "0 0 18px", fontSize: "0.84rem", color: "#6B7280" }}>
          Know the name? Hunter will find their most likely email address.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <input
            placeholder="First name"
            style={inputStyle}
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
          <input
            placeholder="Last name"
            style={inputStyle}
            value={last}
            onChange={(e) => setLast(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            placeholder="company.com"
            style={{ ...inputStyle, flex: 1 }}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <button onClick={find} style={btnStyle}>
            Find Email
          </button>
        </div>
      </div>
      <div>
        {status === "loading" && (
          <div style={{ color: "#6B7280", padding: 12 }}>Finding email...</div>
        )}
        {status === "error" && (
          <div
            style={{
              color: "#DC2626",
              padding: 12,
              background: "#FEF2F2",
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        )}
        {status === "done" &&
          res &&
          (res.email ? (
            <div
              style={{
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                borderRadius: 12,
                padding: "20px 24px",
                maxWidth: 500,
              }}
            >
              <div
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 800,
                  color: "#16A34A",
                  fontFamily: "monospace",
                  marginBottom: 8,
                }}
              >
                {res.email}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 24,
                  fontSize: "0.84rem",
                  color: "#374151",
                }}
              >
                <span>
                  Score:{" "}
                  <strong style={{ color: confidenceColor(res.score) }}>
                    {res.score}%
                  </strong>
                </span>
                {res.position && (
                  <span>
                    Role: <strong>{res.position}</strong>
                  </span>
                )}
                {res.company && (
                  <span>
                    Company: <strong>{res.company}</strong>
                  </span>
                )}
                <span>
                  Sources: <strong>{res.sources}</strong>
                </span>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(res.email || "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                style={{
                  marginTop: 12,
                  padding: "8px 16px",
                  background: "#6C63FF",
                  color: "#fff",
                  border: "none",
                  borderRadius: 7,
                  fontSize: "0.84rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {copied ? "✅ Copied!" : "📋 Copy Email"}
              </button>
            </div>
          ) : (
            <div
              style={{
                color: "#6B7280",
                padding: 16,
                background: "#F9FAFB",
                borderRadius: 8,
              }}
            >
              No email found for this person. Try a domain search to see all
              emails on record.
            </div>
          ))}
      </div>
    </>
  );
}

function VerifierTab() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [res, setRes] = useState<VerifyResult["result"] | null>(null);

  async function verify() {
    if (!email.trim()) return;
    setStatus("loading");
    setError("");
    const d = await apiPost<VerifyResult>("/api/hunter/email-verifier", {
      email: email.trim(),
    });
    if (!d.ok || !d.result) {
      setStatus("error");
      setError(d.error || "Verification failed");
      return;
    }
    setRes(d.result);
    setStatus("done");
  }

  const checks = res
    ? [
        { label: "Format valid", val: res.regexp },
        { label: "MX records", val: res.mx_records },
        { label: "SMTP check", val: res.smtp_check },
        { label: "Not disposable", val: res.disposable === false },
        { label: "Not catch-all", val: res.accept_all === false },
        { label: "Not blocked", val: res.block === false },
      ]
    : [];

  return (
    <>
      <div style={{ ...cardStyle, maxWidth: 560 }}>
        <h3
          style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 700, color: "#111" }}
        >
          Email Verifier
        </h3>
        <p style={{ margin: "0 0 18px", fontSize: "0.84rem", color: "#6B7280" }}>
          Check deliverability before you send — avoid bounces and protect your
          sender reputation.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            placeholder="name@company.com"
            style={{ ...inputStyle, flex: 1 }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button onClick={verify} style={btnStyle}>
            Verify
          </button>
        </div>
      </div>
      <div>
        {status === "loading" && (
          <div style={{ color: "#6B7280", padding: 12 }}>Verifying...</div>
        )}
        {status === "error" && (
          <div
            style={{
              color: "#DC2626",
              padding: 12,
              background: "#FEF2F2",
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        )}
        {status === "done" && res && (
          <div
            style={{
              background: "#fff",
              border: `2px solid ${verifyColor(res.status)}`,
              borderRadius: 12,
              padding: "20px 24px",
              maxWidth: 500,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: verifyColor(res.status),
                }}
              />
              <span
                style={{
                  fontSize: "1rem",
                  fontWeight: 800,
                  color: verifyColor(res.status),
                  textTransform: "capitalize",
                }}
              >
                {res.status}
              </span>
              <span
                style={{
                  fontSize: "0.84rem",
                  color: "#6B7280",
                  marginLeft: "auto",
                }}
              >
                Score:{" "}
                <strong style={{ color: confidenceColor(res.score) }}>
                  {res.score}%
                </strong>
              </span>
            </div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: "0.9rem",
                color: "#374151",
                marginBottom: 16,
              }}
            >
              {res.email}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              {checks.map((c) => (
                <div
                  key={c.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: "0.83rem",
                    color: "#374151",
                  }}
                >
                  <span style={{ color: c.val ? "#16A34A" : "#DC2626" }}>
                    {c.val ? "✓" : "✗"}
                  </span>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function HistoryTab() {
  const [status, setStatus] = useState<"loading" | "error" | "done">("loading");
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await apiGet<HistoryResult>("/api/hunter/history");
      if (cancelled) return;
      if (!d.ok || !d.history) {
        setStatus("error");
        return;
      }
      setHistory(d.history);
      setStatus("done");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const typeColors: Record<string, string> = {
    domain: "#6C63FF",
    finder: "#059669",
    verifier: "#D97706",
  };

  if (status === "loading")
    return <div style={{ color: "#6B7280", padding: 12 }}>Loading history...</div>;
  if (status === "error")
    return (
      <div style={{ color: "#DC2626", padding: 12 }}>Failed to load history.</div>
    );
  if (!history.length)
    return (
      <div
        style={{
          color: "#6B7280",
          padding: 16,
          background: "#F9FAFB",
          borderRadius: 8,
          textAlign: "center",
        }}
      >
        No searches yet.
      </div>
    );

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}
      >
        <thead>
          <tr style={{ background: "#F9FAFB" }}>
            {["Type", "Query", "Result", "Date"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "10px 14px",
                  textAlign: "left",
                  borderBottom: "2px solid #E5E7EB",
                  fontWeight: 700,
                  color: "#374151",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => {
            let resultText = "";
            if (h.type === "domain")
              resultText = `${h.total_emails || 0} emails found`;
            else if (h.type === "finder")
              resultText = h.found_email || "Not found";
            else resultText = h.verify_status || "—";
            const c = typeColors[h.type] || "#6B7280";
            return (
              <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "10px 14px" }}>
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 12,
                      background: c + "20",
                      color: c,
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      textTransform: "capitalize",
                    }}
                  >
                    {h.type}
                  </span>
                </td>
                <td
                  style={{
                    padding: "10px 14px",
                    fontFamily: "monospace",
                    fontSize: "0.83rem",
                  }}
                >
                  {h.query}
                </td>
                <td style={{ padding: "10px 14px", color: "#374151" }}>
                  {resultText}
                </td>
                <td
                  style={{
                    padding: "10px 14px",
                    color: "#9CA3AF",
                    fontSize: "0.8rem",
                  }}
                >
                  {new Date(h.created_at).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Hunter() {
  const [tab, setTab] = useState<TabId>("domain");

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Hunter.io Email Finder
              </div>
              <h2 className="view-title">🎯 Hunter.io Email Finder</h2>
              <p className="view-sub">
                Find verified email addresses for any company domain — search all
                emails on record, find a specific person&apos;s email by name, or
                verify any address before you send. Feeds directly into Lead
                Finder and Cold Email Writer.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 24,
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "8px 18px",
                borderRadius: 20,
                border: `2px solid ${tab === t.id ? "#6C63FF" : "#E5E7EB"}`,
                background: tab === t.id ? "#6C63FF" : "#fff",
                color: tab === t.id ? "#fff" : "#374151",
                fontSize: "0.84rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div>
          {tab === "domain" && <DomainTab />}
          {tab === "finder" && <FinderTab />}
          {tab === "verifier" && <VerifierTab />}
          {tab === "history" && <HistoryTab />}
        </div>
      </div>
    </div>
  );
}
