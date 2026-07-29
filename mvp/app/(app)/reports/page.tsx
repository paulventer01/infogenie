import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/session";
import { updateActiveClient } from "@/lib/store";
import { generateWeeklyReport } from "@/lib/reports";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

async function generateReport() {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx?.client.analysis) redirect("/");
  const report = generateWeeklyReport(ctx.client);
  updateActiveClient(ctx.agency, (c) => ({ ...c, weeklyReport: report }));
  redirect("/reports");
}

async function saveReport(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx?.client.weeklyReport) redirect("/reports");
  const narrative = String(formData.get("narrative") || "");
  const status = String(formData.get("status") || "draft") as "draft" | "final";
  updateActiveClient(ctx.agency, (c) => ({
    ...c,
    weeklyReport: c.weeklyReport
      ? {
          ...c.weeklyReport,
          narrative,
          status,
          updatedAt: new Date().toISOString(),
        }
      : null,
  }));
  redirect("/reports");
}

export default async function ReportsPage() {
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const { client, agency } = ctx;
  if (!client.analysis) return <NeedAnalysis />;

  const report = client.weeklyReport;
  const exportText = report?.narrative || "";

  return (
    <>
      <PageHeader
        eyebrow="Agency · Reporting"
        title={`Weekly report — ${client.analysis.brandName}`}
        sub="Auto-generated brief with editable narrative. Export in minutes, not hours."
        right={
          <form action={generateReport}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
              {report ? "Regenerate draft" : "Generate report"}
            </button>
          </form>
        }
      />

      <div className={`${styles.banner} ${styles.bannerInfo}`}>
        White-label: <strong>{agency.whiteLabel.agencyName}</strong> · Per-client KPIs and
        narrative — connect Meta/Google for live numbers (Results page uses honest illustrative
        mode until then).
      </div>

      {!report ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <p className={styles.muted}>
            No report yet for this client. Generate a draft from analysis + results snapshot.
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
              <textarea id="narrative" name="narrative" defaultValue={report.narrative} rows={22} />
            </div>
            <div className={styles.field}>
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={report.status}>
                <option value="draft">Draft</option>
                <option value="final">Final — ready to send</option>
              </select>
            </div>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
              Save report
            </button>
          </form>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Export preview</h2>
            <p className={styles.muted} style={{ marginBottom: 12 }}>
              Copy to email, Notion, or PDF. Last updated{" "}
              {new Date(report.updatedAt).toLocaleString()}.
            </p>
            <pre className={styles.exportBox}>{exportText}</pre>
            <p className={styles.muted} style={{ marginTop: 12 }}>
              MVP export: select-all copy. Phase 2 adds PDF + scheduled send via Resend.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
