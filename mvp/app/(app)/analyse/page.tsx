import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { readAgency } from "@/lib/store";
import { getSessionClient } from "@/lib/session";
import { updateActiveClient } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/session";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

async function analyseAction(formData: FormData) {
  "use server";
  const domain = String(formData.get("domain") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  if (!domain) redirect("/dashboard?error=domain");

  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  const agency = readAgency();
  if (!sid || !agency || agency.id !== sid) redirect("/");

  const { runAnalysis } = await import("@/lib/analyse");
  const analysis = await runAnalysis({ domain, industry: industry || undefined });
  updateActiveClient(agency, (c) => ({
    ...c,
    analysis,
    results: null,
    weeklyReport: null,
    domain,
    name: analysis.brandName,
  }));
  redirect("/dashboard");
}

export default async function AnalysePage() {
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");

  return (
    <>
      <PageHeader
        eyebrow="Day 1"
        title="Analyse a client domain"
        sub="Builds competitors, ad angles, keywords, and brand voice for the active workspace."
      />
      <form className={`${styles.panel}`} action={analyseAction} style={{ maxWidth: 520 }}>
        <div className={styles.field}>
          <label htmlFor="domain">Domain</label>
          <input
            id="domain"
            name="domain"
            placeholder={ctx.client.domain || "cmtrading.com"}
            defaultValue={ctx.client.domain || ""}
            required
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="industry">Industry (optional)</label>
          <input id="industry" name="industry" placeholder="Fintech & Finance" />
        </div>
        <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
          Analyse Now →
        </button>
        {ctx.client.analysis ? (
          <p className={styles.muted} style={{ marginTop: 12 }}>
            Re-running analysis replaces the current intel for <strong>{ctx.client.name}</strong>.
          </p>
        ) : null}
      </form>
      <p style={{ marginTop: 16 }}>
        <Link className={styles.muted} href="/dashboard">
          ← Back to dashboard
        </Link>
      </p>
    </>
  );
}
