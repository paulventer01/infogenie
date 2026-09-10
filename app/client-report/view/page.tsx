"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchPortalHistory, fetchPortalReport } from "@/lib/clientReportingPortal";
import { responseError } from "@/lib/clientReporting";
import { validPreview } from "@/lib/clientReportingReport";
import type { Preview } from "@/lib/clientReportingReport";
import type { DeliveryRow } from "@/lib/clientReportingPortal";

export default function ClientReportViewPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const report = await fetchPortalReport();
      if (!live.current) return;
      const failure = responseError(report);
      if (failure) {
        setError(failure === "portal_auth_required" ? "Sign in via your invitation link to view this report."
          : failure === "portal_session_expired" ? "Your portal session expired. Ask for a new invitation."
            : failure === "portal_revoked" ? "Portal access has been revoked."
              : "This report could not be loaded.");
        setPreview(null);
        return;
      }
      if (!report.client || !validPreview(report, report.client.id, report.profile_version, report.format)) {
        setError("The report snapshot could not be verified.");
        setPreview(null);
        return;
      }
      setPreview(report);
      const history = await fetchPortalHistory();
      if (!live.current) return;
      const historyFailure = responseError(history);
      if (!historyFailure && Array.isArray(history.deliveries)) setDeliveries(history.deliveries);
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void load();
    return () => { live.current = false; };
  }, [load]);

  return <main style={{ maxWidth: 960, margin: "32px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#0F172A" }}>
    <header style={{ marginBottom: 24 }}>
      <h1>Client report</h1>
      <p style={{ color: "#64748B" }}>Read-only portal view of your latest generated report and delivery history.</p>
    </header>
    {busy && <p role="status">Loading report…</p>}
    {error && !busy && <>
      <p role="alert" style={{ color: "#991B1B" }}>{error}</p>
      <p><Link href="/login">Return to login</Link></p>
    </>}
    {preview && !busy && <article style={{ borderTop: `4px solid ${preview.brand.primaryColor || "#0F766E"}`, color: preview.brand.textColor || "#0F172A" }}>
      {preview.brand.agencyName && <p>{preview.brand.agencyName}</p>}
      <h2>{preview.report.title}</h2>
      <p>Snapshot: {preview.report.generated_at}</p>
      {!preview.can_generate && <p>No mapped records are available for this report.</p>}
      {preview.report.sections.map((section, i) => <div key={i} style={{ marginTop: 20 }}>
        <h3>{section.title}</h3>
        {!section.rows.length ? <p>No data available for this section.</p> : <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{section.headers.map((header, j) => <th key={j} scope="col" style={{ textAlign: "left", padding: 8 }}>{header}</th>)}</tr></thead>
            <tbody>{section.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k} style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{cell === null ? "—" : cell}</td>)}</tr>)}</tbody>
          </table>
        </div>}
      </div>)}
      {preview.brand.footerText && <p style={{ marginTop: 24 }}>{preview.brand.footerText}</p>}
    </article>}
    {preview && !busy && <section aria-label="Delivery history" style={{ marginTop: 32 }}>
      <h2>Delivery history</h2>
      {!deliveries.length ? <p>No scheduled deliveries recorded yet.</p> : <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>
            {["Attempted", "Status", "Recipient", "Format", "Profile version"].map((header) => (
              <th key={header} scope="col" style={{ textAlign: "left", padding: 8 }}>{header}</th>
            ))}
          </tr></thead>
          <tbody>{deliveries.map((row) => <tr key={row.id}>
            <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.attempted_at}</td>
            <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.status}</td>
            <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.recipient_email || "—"}</td>
            <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.format || "—"}</td>
            <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{row.profile_version ?? "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>}
  </main>;
}
