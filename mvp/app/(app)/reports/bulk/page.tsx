import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAgency } from "@/lib/session";
import { writeAgency } from "@/lib/store";
import { generateAllClientReports } from "@/lib/reports";
import { getDataMode } from "@/lib/strict-mode";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

async function runBulkReports() {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const before = agency.clients.filter((c) => c.weeklyReport).length;
  const updated = generateAllClientReports(agency);
  const after = updated.clients.filter((c) => c.weeklyReport).length;
  const newReports = Math.max(0, after - before) || after;
  const { bumpHoursSaved } = await import("@/lib/attribution");
  writeAgency(bumpHoursSaved(updated, newReports * 2.5));
  redirect("/reports/bulk?done=1");
}

export default async function BulkReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const sp = await searchParams;
  const mode = getDataMode(agency);

  const rows = agency.clients.map((c) => ({
    id: c.id,
    name: c.name,
    owner: c.owner,
    hasAnalysis: !!c.analysis,
    reportStatus: c.weeklyReport?.status || null,
    reportDate: c.weeklyReport?.updatedAt || c.weeklyReport?.generatedAt || null,
    withheld: c.weeklyReport?.narrative.includes("[WITHHELD]") ?? false,
  }));

  const ready = rows.filter((r) => r.reportStatus).length;
  const skipped = rows.filter((r) => !r.hasAnalysis).length;

  return (
    <>
      <PageHeader
        eyebrow="Agency · Bulk reporting"
        title="Batch weekly reports"
        sub={`Run reports for all ${agency.clients.length} clients in one pass — honest sections, white-label export per client.`}
        right={
          <form action={runBulkReports}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
              Generate all ({agency.clients.length}) →
            </button>
          </form>
        }
      />

      {sp.done ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          Batch complete — {ready} report{ready !== 1 ? "s" : ""} generated. {skipped > 0 ? `${skipped} skipped (no analysis).` : ""}
        </div>
      ) : null}

      <div className={`${styles.banner} ${styles.bannerWarn}`}>
        Data mode: <strong>{mode}</strong> — performance sections are withheld when integrations
        aren&apos;t connected. No fabricated KPIs in client-facing exports.
      </div>

      <section className={styles.panel}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Client</th>
              <th>Owner</th>
              <th>Analysis</th>
              <th>Report</th>
              <th>Last generated</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                </td>
                <td>{row.owner}</td>
                <td>{row.hasAnalysis ? <span className={styles.chip}>Ready</span> : <span className={styles.muted}>Missing</span>}</td>
                <td>
                  {row.reportStatus ? (
                    <span className={styles.chip}>{row.reportStatus}</span>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>
                  {row.reportDate ? new Date(row.reportDate).toLocaleString() : "—"}
                </td>
                <td>
                  {!row.hasAnalysis ? (
                    <span className={styles.muted}>Run Analyse first</span>
                  ) : row.withheld ? (
                    <span className={`${styles.severity} ${styles.sevmedium}`}>Sections withheld</span>
                  ) : (
                    <span className={styles.muted}>OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p style={{ marginTop: 16 }}>
        <Link className={styles.muted} href="/agency">
          ← Back to command center
        </Link>
      </p>
    </>
  );
}
