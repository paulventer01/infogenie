"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import { viewToPath } from "@/lib/viewRoutes";
import styles from "../../styles/company-context.module.css";

interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  competitors?: unknown[];
}

const ACTIONS: { label: string; view: string; hash?: string }[] = [
  { label: "Overview", view: "dashboard", hash: "#ig-domain-snapshot" },
  { label: "Competitors", view: "competitors" },
  { label: "Plan", view: "battleplan" },
  { label: "Analytics", view: "analytics-hub" },
  { label: "Budget", view: "budget" },
  { label: "Ecosystem", view: "ecosystem-spine" },
];

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

function scrollToHash(hash?: string) {
  if (!hash) return;
  const id = hash.replace(/^#/, "");
  window.requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

/** Persistent domain context bar — Semrush-style "you are analysing X" */
export default function CompanyContextBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [ctx, setCtx] = useState<ReturnType<typeof readDomain>>(null);

  useEffect(() => {
    const refresh = () => setCtx(readDomain());
    refresh();
    document.addEventListener("ig:analysis-ready", refresh);
    return () => document.removeEventListener("ig:analysis-ready", refresh);
  }, []);

  if (!ctx?.domain) return null;

  const overviewHref = `${viewToPath("dashboard")}#ig-domain-snapshot`;

  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        <Link
          href={overviewHref}
          className={styles.domainBtn}
          title="Open company overview"
          onClick={(e) => {
            e.preventDefault();
            goToView(router, "dashboard");
            scrollToHash("#ig-domain-snapshot");
          }}
        >
          <span className={styles.globe}>🌐</span>
          <span className={styles.domain}>{ctx.domain}</span>
          {ctx.industry ? <span className={styles.industry}>{ctx.industry}</span> : null}
        </Link>
        {ctx.competitors > 0 ? (
          <span className={styles.meta}>{ctx.competitors} competitors tracked</span>
        ) : null}
        <div className={styles.actions}>
          {ACTIONS.map((action) => {
            const href = viewToPath(action.view) + (action.hash || "");
            const active =
              pathname === viewToPath(action.view) ||
              pathname.endsWith(`/${action.view}`);
            return (
              <Link
                key={action.view}
                href={href}
                className={`${styles.linkBtn} ${active ? styles.linkBtnActive : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  const alreadyHere =
                    pathname === viewToPath(action.view) ||
                    pathname.endsWith(`/${action.view}`);
                  if (alreadyHere && action.hash) {
                    scrollToHash(action.hash);
                    return;
                  }
                  goToView(router, action.view);
                  if (action.hash) {
                    window.setTimeout(() => scrollToHash(action.hash), 350);
                  }
                }}
              >
                {action.label}
              </Link>
            );
          })}
          <Link
            href={viewToPath("home")}
            className={styles.primaryBtn}
            onClick={(e) => {
              e.preventDefault();
              goToView(router, "home");
            }}
          >
            Re-analyse
          </Link>
        </div>
      </div>
    </div>
  );
}
