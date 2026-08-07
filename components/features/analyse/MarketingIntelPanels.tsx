"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildMarketingIntel } = require("@/lib/marketingIntelSeed") as {
  buildMarketingIntel: (domain: string, industry?: string) => import("@/lib/marketingIntelSeed").MarketingIntel;
};
import dm from "@/styles/dashboard-marketing.module.css";

interface Props {
  domain: string;
  industryName: string;
}

export default function MarketingIntelPanels({ domain, industryName }: Props) {
  const router = useRouter();
  const intel = useMemo(() => buildMarketingIntel(domain, industryName), [domain, industryName]);
  const totalSessions = intel.engagementByChannel.reduce((a, c) => a + c.sessions, 0);

  return (
    <div className={dm.intelWrap}>
      <div className={dm.intelHeader}>
        <div>
          <h4 className={dm.panelTitle}>📊 Website marketing intelligence</h4>
          <p className={dm.profileText} style={{ margin: 0 }}>
            Seven checks from your requirements doc — engagement, search, channels, scroll, audience, site search, and SEO notes for <strong>{domain}</strong>.
          </p>
        </div>
        <div className={dm.intelHeaderActions}>
          <span className={dm.intelBadge}>{intel.period}</span>
          <button type="button" className="btn-secondary" style={{ fontSize: "0.78rem" }} onClick={() => goToView(router, "analytics-hub")}>
            Connect GA4 / GSC →
          </button>
        </div>
      </div>

      {/* 1. Engaged sessions */}
      <section className={dm.intelSection}>
        <h5 className={dm.intelTitle}>1. Engaged sessions by channel</h5>
        <p className={dm.intelHint}>Check engagement quality — not just traffic volume.</p>
        <div className={dm.tableScroll}>
          <table className={dm.intelTable}>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Sessions</th>
                <th>Engagement rate</th>
                <th>Bounce rate</th>
                <th>Avg engagement</th>
                <th>Events / session</th>
              </tr>
            </thead>
            <tbody>
              {intel.engagementByChannel.map((row) => (
                <tr key={row.name}>
                  <td>
                    <span className={dm.channelDot} style={{ background: row.color, display: "inline-block", marginRight: 6 }} />
                    {row.name}
                  </td>
                  <td>{row.sessions.toLocaleString()}</td>
                  <td><strong style={{ color: "#10B981" }}>{row.engagementRate}%</strong></td>
                  <td>{row.bounceRate}%</td>
                  <td>{row.avgEngagement}</td>
                  <td>{row.eventsPerSession}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className={dm.intelTwoCol}>
        {/* 2. High impression low CTR */}
        <section className={dm.intelSection}>
          <h5 className={dm.intelTitle}>2. High-impression queries with low CTR</h5>
          <p className={dm.intelHint}>Visibility without clicks — improve titles & meta descriptions.</p>
          <table className={dm.intelTable}>
            <thead>
              <tr>
                <th>Query</th>
                <th>Impressions</th>
                <th>CTR</th>
                <th>Position</th>
              </tr>
            </thead>
            <tbody>
              {intel.lowCtrQueries.map((q) => (
                <tr key={q.query}>
                  <td>{q.query}</td>
                  <td>{q.impressions.toLocaleString()}</td>
                  <td style={{ color: q.ctr < 2 ? "#DC2626" : "#0F172A" }}>{q.ctr}%</td>
                  <td>{q.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 5. New vs returning */}
        <section className={dm.intelSection}>
          <h5 className={dm.intelTitle}>5. New vs returning organic users</h5>
          <div className={dm.audienceRow}>
            <div className={dm.donutWrap}>
              <div
                className={dm.donut}
                style={{
                  background: `conic-gradient(#0066FF 0 ${intel.audienceSplit.newUsers}%, #00C9C8 ${intel.audienceSplit.newUsers}% 100%)`,
                }}
              >
                <div className={dm.donutCenter}>
                  <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>{totalSessions > 999 ? Math.round(totalSessions / 1000) + "k" : totalSessions}</div>
                  <div style={{ fontSize: "0.62rem", color: "#64748B" }}>SESSIONS</div>
                </div>
              </div>
              <div className={dm.donutLegend}>
                <div><span style={{ color: "#0066FF" }}>●</span> New {intel.audienceSplit.newUsers}%</div>
                <div><span style={{ color: "#00C9C8" }}>●</span> Returning {intel.audienceSplit.returningUsers}%</div>
              </div>
            </div>
            <div>
              <div className={dm.bounceCompare}>
                <div>New visitor bounce: <strong>{intel.audienceSplit.newBounce}%</strong></div>
                <div>Returning bounce: <strong style={{ color: "#10B981" }}>{intel.audienceSplit.retBounce}%</strong></div>
              </div>
              <div style={{ marginTop: 12, fontSize: "0.76rem", color: "#475569" }}>
                <strong>Top returning pages</strong>
                {intel.topReturningPages.slice(0, 3).map((p) => (
                  <div key={p.path} style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span>{p.label}</span>
                    <span style={{ color: p.delta >= 0 ? "#10B981" : "#DC2626" }}>{p.delta >= 0 ? "+" : ""}{p.delta}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* 4. Scroll depth */}
      <section className={dm.intelSection}>
        <h5 className={dm.intelTitle}>4. Scroll depth on key pages</h5>
        <p className={dm.intelHint}>Where users drop off — focus on blogs and landing pages.</p>
        <div className={dm.scrollBars}>
          {intel.scrollDepth.map((row) => (
            <div key={row.pct} className={dm.scrollRow}>
              <span className={dm.scrollLabel}>{row.pct}%</span>
              <div className={dm.scrollTrack}>
                <div className={dm.scrollFill} style={{ width: `${Math.max(4, (row.unique / intel.scrollDepth[0].unique) * 100)}%` }} />
              </div>
              <span className={dm.scrollVal}>{row.unique.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      <div className={dm.intelTwoCol}>
        {/* 6. Site search */}
        <section className={dm.intelSection}>
          <h5 className={dm.intelTitle}>6. On-site search terms</h5>
          <p className={dm.intelHint}>What visitors can&apos;t find — content & navigation gaps.</p>
          <table className={dm.intelTable}>
            <thead>
              <tr><th>Search term</th><th>Searches</th></tr>
            </thead>
            <tbody>
              {intel.siteSearches.map((s) => (
                <tr key={s.term}>
                  <td>{s.term}</td>
                  <td>{s.searches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 7. SEO notes */}
        <section className={dm.intelSection}>
          <h5 className={dm.intelTitle}>7. SEO change log</h5>
          <p className={dm.intelHint}>Annotate important changes to connect traffic shifts to actions.</p>
          <div className={dm.noteList}>
            {intel.seoNotes.map((n, i) => (
              <div key={i} className={dm.noteItem}>
                <div className={dm.noteDate}>{n.date}</div>
                <div>{n.note}</div>
              </div>
            ))}
            <button type="button" className={dm.addNoteBtn} onClick={() => goToView(router, "analytics-hub")}>
              + Add note on timeline (connect GA4)
            </button>
          </div>
        </section>
      </div>

      <p className={dm.intelDisclaimer}>
        ⚠️ Panels use domain-seeded estimates until Google Analytics 4 and Search Console are connected. Connect live data in <button type="button" className={dm.linkBtn} onClick={() => goToView(router, "analytics-hub")}>GSC / GA4 Hub</button> to replace estimates with real numbers.
      </p>
    </div>
  );
}
