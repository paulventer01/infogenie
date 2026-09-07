import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getSessionAgency } from "@/lib/session";
import { writeAgency } from "@/lib/store";
import { runAnalysis } from "@/lib/analyse";
import { buildInstaReportSummary } from "@/lib/reports";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";
import type { InstaReport } from "@/lib/types";

async function createProspect(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const prospectName = String(formData.get("prospectName") || "").trim();
  const domain = String(formData.get("domain") || "").trim();
  const industry = String(formData.get("industry") || "").trim() || "General";
  if (!prospectName || !domain) redirect("/prospects");

  const analysis = await runAnalysis({ domain, industry });
  const prospect: InstaReport = {
    id: randomUUID(),
    prospectName,
    domain,
    industry,
    analysis,
    shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    createdAt: new Date().toISOString(),
  };
  writeAgency({ ...agency, prospects: [prospect, ...agency.prospects].slice(0, 30) });
  redirect("/prospects");
}

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const sp = await searchParams;

  return (
    <>
      <PageHeader
        eyebrow="Agency · New business"
        title="InstaReports"
        sub="Prospect audits in under 30 seconds — shareable link for pitches and QBR openers."
      />

      {sp.created ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          Prospect report created. Share the public link below with your prospect.
        </div>
      ) : null}

      <div className={styles.grid2}>
        <form className={styles.panel} action={createProspect}>
          <h2 className={styles.panelTitle}>New prospect audit</h2>
          <div className={styles.field} style={{ marginTop: 12 }}>
            <label htmlFor="prospectName">Prospect name</label>
            <input id="prospectName" name="prospectName" placeholder="Horizon SaaS" required />
          </div>
          <div className={styles.field}>
            <label htmlFor="domain">Domain</label>
            <input id="domain" name="domain" placeholder="horizon.example" required />
          </div>
          <div className={styles.field}>
            <label htmlFor="industry">Industry</label>
            <input id="industry" name="industry" placeholder="B2B SaaS" />
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
            Generate InstaReport →
          </button>
        </form>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Recent prospects</h2>
          {agency.prospects.length === 0 ? (
            <p className={styles.muted}>No prospect audits yet — create one for your next pitch.</p>
          ) : (
            <ul className={styles.list}>
              {agency.prospects.map((p) => (
                <li key={p.id} className={styles.listItem}>
                  <strong>{p.prospectName}</strong>
                  <div className={styles.muted}>
                    {p.domain} · {p.industry}
                  </div>
                  {p.analysis ? (
                    <pre className={styles.exportBox} style={{ marginTop: 10, fontSize: "0.82rem" }}>
                      {buildInstaReportSummary(p.analysis).slice(0, 420)}…
                    </pre>
                  ) : null}
                  <div className={styles.alertActions} style={{ marginTop: 10 }}>
                    <Link className={`${styles.btn} ${styles.btnPrimary}`} href={`/share/${p.shareToken}`}>
                      Public link →
                    </Link>
                    <span className={styles.muted} style={{ alignSelf: "center" }}>
                      /share/{p.shareToken}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
