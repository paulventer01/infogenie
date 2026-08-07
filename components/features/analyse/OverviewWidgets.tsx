"use client";

import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import type { OverviewWidget } from "@/lib/companyOverview";
import ow from "@/styles/overview-widgets.module.css";

const TONE_CLASS: Record<string, string> = {
  danger: ow.toneDanger,
  warn: ow.toneWarn,
  info: ow.toneInfo,
  ok: ow.toneOk,
};

interface Props {
  widgets: OverviewWidget[];
  /** Analysed domain — shown on every report tile so ownership is obvious. */
  domain?: string;
}

/** SE Ranking Project Overview-style report cards with View Full Report CTAs. */
export default function OverviewWidgets({ widgets, domain }: Props) {
  const router = useRouter();
  const owner = (domain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

  return (
    <section className={ow.section} aria-label="Project overview reports">
      <div className={ow.head}>
        <h4 className={ow.title}>Project overview</h4>
        <p className={ow.sub}>
          All analysis for {owner || "this company"} in one place — open any report for the full detail.
        </p>
      </div>
      <div className={ow.grid}>
        {widgets.map((w) => (
          <article key={w.id} className={ow.card} style={{ borderTopColor: w.accent }}>
            {owner ? <div className={ow.cardOwner}>{owner}</div> : null}
            <div className={ow.cardHead}>
              <h5 className={ow.cardTitle}>{w.title}</h5>
              <button
                type="button"
                className={ow.viewBtn}
                onClick={() => goToView(router, w.view)}
              >
                View full report
              </button>
            </div>
            {w.hero && (
              <div className={ow.hero}>
                <span className={ow.heroLabel}>{w.hero.label}</span>
                <span className={ow.heroValue} style={{ color: w.accent }}>
                  {w.hero.value}
                </span>
                {w.hero.suffix && <span className={ow.heroSuffix}>{w.hero.suffix}</span>}
              </div>
            )}
            <div className={ow.metrics}>
              {w.metrics.map((m) => (
                <div key={m.label} className={ow.metric}>
                  <span className={ow.metricLabel}>{m.label}</span>
                  <span className={`${ow.metricValue} ${m.tone ? TONE_CLASS[m.tone] || "" : ""}`}>
                    {m.value}
                  </span>
                </div>
              ))}
            </div>
            {w.note && <p className={ow.note}>{w.note}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
