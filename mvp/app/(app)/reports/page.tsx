import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/session";
import { updateActiveClient, writeAgency } from "@/lib/store";
import { generateWeeklyReport, gatherReportSections } from "@/lib/reports";
import { bumpHoursSaved } from "@/lib/attribution";
import { getDataMode } from "@/lib/strict-mode";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

async function generateReport() {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx?.client.analysis) redirect("/");
  const report = generateWeeklyReport(ctx.client, ctx.agency);
  const hadReport = !!ctx.client.weeklyReport;
  updateActiveClient(ctx.agency, (c) => ({ ...c, weeklyReport: report }));
  // Re-read after update via bump on agency hours
  const { readAgency } = await import("@/lib/store");
  const agency = readAgency();
  if (agency && !hadReport) writeAgency(bumpHoursSaved(agency, 2.5));
  redirect("/reports");
}

async function saveReport(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx?.client.weeklyReport) redirect("/reports");
  const narrative = String(formData.get("narrative") || "");
  const status = String(formData.get("status") || "draft") as "draft" | "final";
  const autopilot = formData.get("autopilot") === "on";
  const nextSend = new Date();
  nextSend.setDate(nextSend.getDate() + ((1 + 7 - nextSend.getDay()) % 7 || 7));
  nextSend.setHours(8, 0, 0, 0);
  updateActiveClient(ctx.agency, (c) => ({
    ...c,
    weeklyReport: c.weeklyReport
      ? {
          ...c.weeklyReport,
          narrative,
          status,
          autopilot,
          nextSendAt: autopilot ? nextSend.toISOString() : undefined,
          updatedAt: new Date().toISOString(),
        }
      : null,
  }));
  redirect("/reports");
}

function sectionClass(status: string) {
  if (status === "withheld") return styles.sectionWithheld;
  if (status === "empty") return styles.sectionEmpty;
  return styles.sectionOk;
}

export default async function ReportsPage() {
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const { client, agency } = ctx;
  if (!client.analysis) return <NeedAnalysis />;

  const report = client.weeklyReport;
  const mode = getDataMode(agency);
  const sections = gatherReportSections(client, mode);
  const exportText = report?.narrative || "";

  return (
    <>
      <PageHeader
        eyebrow="Agency · Reporting"
        title={`Weekly report — ${client.analysis.brandName}`}
        sub="One-click export with white-label header. Sections withhold when data isn't real (strict mode)."
        right={
          <div className={styles.chipRow}>
            <Link className={`${styles.btn} ${styles.btnGhost}`} href="/reports/bulk">
              Batch all clients
            </Link>
            <form action={generateReport}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                {report ? "Regenerate" : "Generate report"}
              </button>
            </form>
          </div>
        }
      />

      <div className={`${styles.banner} ${styles.bannerInfo}`}>
        White-label: <strong>{agency.whiteLabel.agencyName}</strong> · Data mode:{" "}
        <strong>{mode}</strong> — withheld sections never show fabricated KPIs.
      </div>

      <section className={styles.panel} style={{ marginBottom: 16 }}>
        <h2 className={styles.panelTitle}>Report sections</h2>
        <div className={styles.sectionGrid}>
          {sections.map((s) => (
            <div key={s.id} className={`${styles.sectionCard} ${sectionClass(s.status)}`}>
              <div className={styles.panelHead}>
                <strong>{s.title}</strong>
                <span className={styles.chip}>{s.status}</span>
              </div>
              <p className={styles.muted} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {!report ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <p className={styles.muted}>
            No report yet. Generate to assemble sections with honest empty/withheld states.
          </p>
        </div>
      ) : (
        <div className={styles.grid2}>
          <form className={styles.panel} action={saveReport}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Editable narrative</h2>
              <span className={styles.chip}>{report.status}</span>
            </div>
            <div className={styles.field}>
              <label htmlFor="narrative">Client-ready copy</label>
              <textarea id="narrative" name="narrative" defaultValue={report.narrative} rows={18} />
            </div>
            <div className={styles.field}>
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={report.status}>
                <option value="draft">Draft</option>
                <option value="final">Final — ready to send</option>
              </select>
            </div>
            <label className={styles.checkRow}>
              <input type="checkbox" name="autopilot" defaultChecked={!!report.autopilot} />
              Autopilot — schedule Monday 08:00 white-label send (Resend in production)
            </label>
            {report.autopilot && report.nextSendAt ? (
              <p className={styles.muted} style={{ marginBottom: 12 }}>
                Next send: {new Date(report.nextSendAt).toLocaleString()}
              </p>
            ) : null}
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
              Save report
            </button>
          </form>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>One-click export</h2>
            <p className={styles.muted} style={{ marginBottom: 12 }}>
              White-label PDF-ready text. Updated {new Date(report.updatedAt).toLocaleString()}.
            </p>
            <pre className={styles.exportBox}>{exportText}</pre>
            <p className={styles.muted} style={{ marginTop: 12 }}>
              Copy block includes {agency.whiteLabel.agencyName} header/footer. Scheduled send via
              Resend is Phase 2.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
