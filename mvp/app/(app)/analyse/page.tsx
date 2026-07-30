import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { readAgency, updateActiveClient } from "@/lib/store";
import { getSessionClient, SESSION_COOKIE } from "@/lib/session";
import styles from "@/styles/mvp.module.css";

const TRY_SITES = [
  "shopify.com",
  "etoro.com",
  "hubspot.com",
  "coursera.org",
  "booking.com",
  "coinbase.com",
];

async function analyseAction(formData: FormData) {
  "use server";
  let domain = String(formData.get("domain") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  if (!domain && !industry) redirect("/analyse?error=input");

  // Industry-only: synthesize a workspace domain so the Day 1–7 loop still runs.
  if (!domain && industry) {
    domain = `${industry
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "client"}.example`;
  }

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

export default async function AnalysePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; domain?: string }>;
}) {
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const sp = await searchParams;
  const prefill = String(sp.domain || ctx.client.domain || "").replace(/^https?:\/\//i, "");

  return (
    <>
      <div className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Brief · Workspace</p>
          <h1 className={styles.h1}>
            Turn competitor intel into autonomous growth
          </h1>
          <p className={styles.sub}>
            Enter your website — or just pick an industry — and InfoGenie maps the market, finds
            5+ real competitors, and generates a full AI battle plan in under a minute.
          </p>
        </div>
        <span className={styles.chip}>AI-powered autonomous marketing intelligence</span>
      </div>

      {sp.error === "input" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Enter a website URL or an industry / sector to begin.
        </div>
      ) : null}

      <form className={styles.panel} action={analyseAction} style={{ maxWidth: 720 }}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Enter a website or a sector — either one is enough</h2>
          <span className={styles.chip}>Analyse Now</span>
        </div>

        <div className={styles.field} style={{ marginTop: 12 }}>
          <label htmlFor="domain">Website</label>
          <input
            id="domain"
            name="domain"
            placeholder="yourwebsite.com"
            defaultValue={prefill}
            autoComplete="url"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="industry">Industry / sector (optional if URL given)</label>
          <input
            id="industry"
            name="industry"
            placeholder="SaaS, fintech, ecommerce, edtech…"
          />
        </div>

        <div className={styles.chipRow} style={{ marginTop: 4, marginBottom: 12 }}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
            Analyse Now →
          </button>
          <Link className={`${styles.btn} ${styles.btnGhost}`} href="/campaigns">
            Launch Campaign
          </Link>
          <Link className={styles.muted} href="/competitors">
            + Add competitors manually
          </Link>
        </div>

        <p className={styles.muted} style={{ marginBottom: 8 }}>
          Try:
        </p>
        <div className={styles.chipRow}>
          {TRY_SITES.map((site) => (
            <Link key={site} className={styles.chip} href={`/analyse?domain=${encodeURIComponent(site)}`}>
              {site}
            </Link>
          ))}
        </div>

        {ctx.client.analysis ? (
          <p className={styles.muted} style={{ marginTop: 16 }}>
            Active workspace already has intel for <strong>{ctx.client.name}</strong>. Re-running
            replaces it.{" "}
            <Link href="/dashboard">Open dashboard →</Link>
          </p>
        ) : null}
      </form>

      <p className={styles.muted} style={{ marginTop: 20 }}>
        Analyses across Meta · Google · TikTok · LinkedIn · 180+ countries
      </p>
    </>
  );
}
