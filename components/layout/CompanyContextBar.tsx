"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import styles from "../../styles/company-context.module.css";

interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  competitors?: unknown[];
}

function readDomain(): { domain: string; industry: string; competitors: number } | null {
  if (typeof window === "undefined") return null;
  const ad = (window as unknown as { analysisData?: AnalysisData }).analysisData;
  if (!ad?.url) {
    try {
      const url = localStorage.getItem("ig-last-analysed-url");
      if (url) return { domain: url.replace(/^https?:\/\//, "").split("/")[0], industry: "", competitors: 0 };
    } catch {
      /* ignore */
    }
    return null;
  }
  return {
    domain: String(ad.url).replace(/^https?:\/\//, "").split("/")[0],
    industry: ad.industry?.name || "",
    competitors: Array.isArray(ad.competitors) ? ad.competitors.length : 0,
  };
}

/** Persistent domain context bar — Semrush-style "you are analysing X" */
export default function CompanyContextBar() {
  const router = useRouter();
  const [ctx, setCtx] = useState<ReturnType<typeof readDomain>>(null);

  useEffect(() => {
    const refresh = () => setCtx(readDomain());
    refresh();
    document.addEventListener("ig:analysis-ready", refresh);
    return () => document.removeEventListener("ig:analysis-ready", refresh);
  }, []);

  if (!ctx?.domain) return null;

  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        <button type="button" className={styles.domainBtn} onClick={() => goToView(router, "dashboard")} title="Open company overview">
          <span className={styles.globe}>🌐</span>
          <span className={styles.domain}>{ctx.domain}</span>
          {ctx.industry ? <span className={styles.industry}>{ctx.industry}</span> : null}
        </button>
        {ctx.competitors > 0 ? (
          <span className={styles.meta}>{ctx.competitors} competitors tracked</span>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className={styles.linkBtn} onClick={() => goToView(router, "dashboard")}>
            Overview
          </button>
          <button type="button" className={styles.linkBtn} onClick={() => goToView(router, "competitors")}>
            Competitors
          </button>
          <button type="button" className={styles.linkBtn} onClick={() => goToView(router, "analytics-hub")}>
            Analytics
          </button>
          <button type="button" className={styles.primaryBtn} onClick={() => goToView(router, "home")}>
            Re-analyse
          </button>
        </div>
      </div>
    </div>
  );
}
