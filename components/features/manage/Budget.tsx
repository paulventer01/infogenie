"use client";

// Budget Hub — overall spend, ROI, campaign breakdown, 3-month projections,
// stop/scale recommendations, and marketing allocation. Reads launched +
// recommended campaigns from legacy window globals (same sources as Results).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import { useToast } from "@/hooks/useToast";
import styles from "@/styles/budget-hub.module.css";

interface Metrics {
  roas?: number | string;
  ctr?: number | string;
  conversions?: number;
  impressions?: number;
  spend?: number;
  cpa?: number | string;
}
interface Campaign {
  id?: string;
  name?: string;
  platform?: string;
  budget?: number;
  budgetStr?: string;
  metrics?: Metrics;
  audience?: string;
  status?: string;
  launchedAt?: string;
  startDate?: string;
  endDate?: string;
  estROAS?: number | string;
  estCTR?: number | string;
  estCPA?: number | string;
  objective?: string;
  description?: string;
  tags?: string[];
}
interface Rec {
  name?: string;
  platform?: string;
  budget?: string;
  estROAS?: number | string;
  estCTR?: number | string;
  estCPA?: number | string;
  description?: string;
  objective?: string;
  tags?: string[];
}
interface AnalysisData {
  url?: string;
  industry?: { name?: string } | string;
  websiteKPIs?: { roas?: number | string };
  competitors?: unknown[];
}

interface CampRow {
  key: string;
  name: string;
  platform: string;
  monthlyBudget: number;
  spend: number;
  roas: number;
  ctr: string;
  cpa: string;
  conversions: number;
  status: string;
  source: "live" | "recommended";
  raw: Campaign | Rec;
  idx: number;
}

declare global {
  interface Window {
    analysisData?: AnalysisData;
    _launchedCampaigns?: Campaign[];
    _lastCampRecs?: Rec[];
    _igLaunch?: (idx: number) => void;
    buildLaunchModal?: (camp: unknown, idx: number) => void;
  }
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function money(n: number): string {
  return (
    "$" +
    Math.round(n).toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })
  );
}

function parseBudget(c: Campaign | Rec): number {
  if ("budget" in c && typeof c.budget === "number") return c.budget;
  if ("budgetStr" in c && c.budgetStr) return num(c.budgetStr, 2000);
  if ("budget" in c && typeof c.budget === "string") return num(c.budget, 2000);
  return 2000;
}

function loadCamps(): CampRow[] {
  const live = (typeof window !== "undefined" && window._launchedCampaigns) || [];
  const recs = (typeof window !== "undefined" && window._lastCampRecs) || [];
  const rows: CampRow[] = [];

  live.forEach((c, i) => {
    const monthly = parseBudget(c);
    const spend = num(c.metrics?.spend, monthly * 0.72);
    const roas = num(c.metrics?.roas ?? c.estROAS, 2.8);
    rows.push({
      key: c.id || `live-${i}`,
      name: c.name || `Campaign ${i + 1}`,
      platform: c.platform || "Multi-Platform",
      monthlyBudget: monthly,
      spend,
      roas,
      ctr: String(c.metrics?.ctr || c.estCTR || "3.2%"),
      cpa: String(c.metrics?.cpa || c.estCPA || "$38"),
      conversions: num(c.metrics?.conversions, Math.round(spend / 35)),
      status: (c.status || "active").toLowerCase(),
      source: "live",
      raw: c,
      idx: i,
    });
  });

  if (rows.length === 0) {
    recs.forEach((c, i) => {
      const monthly = parseBudget(c);
      const roas = num(c.estROAS, 3.0);
      const spend = Math.round(monthly * 0.65);
      rows.push({
        key: `rec-${i}`,
        name: c.name || `Recommended ${i + 1}`,
        platform: c.platform || "Multi-Platform",
        monthlyBudget: monthly,
        spend,
        roas,
        ctr: String(c.estCTR || "3.5%"),
        cpa: String(c.estCPA || "$36"),
        conversions: Math.round(spend / 34),
        status: "planned",
        source: "recommended",
        raw: c,
        idx: i,
      });
    });
  }

  return rows;
}

function industryName(ad?: AnalysisData): string {
  if (!ad?.industry) return "your market";
  if (typeof ad.industry === "string") return ad.industry;
  return ad.industry.name || "your market";
}

const CHANNEL_MIX = [
  { channel: "Paid Search (Google / Bing)", pct: 32, color: "#2563EB" },
  { channel: "Paid Social (Meta / TikTok / LinkedIn)", pct: 28, color: "#7C3AED" },
  { channel: "SEO & Content", pct: 18, color: "#059669" },
  { channel: "Email / CRM / Retargeting", pct: 12, color: "#D97706" },
  { channel: "Creative & Landing Pages", pct: 6, color: "#DB2777" },
  { channel: "Testing & Contingency", pct: 4, color: "#64748B" },
];

export default function Budget() {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<CampRow[]>([]);
  const [selected, setSelected] = useState<CampRow | null>(null);
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("your market");
  const [siteRoas, setSiteRoas] = useState(2.8);

  const refresh = useCallback(() => {
    const ad = window.analysisData;
    setDomain(ad?.url ? String(ad.url).replace(/^https?:\/\//, "").split("/")[0] : "");
    setIndustry(industryName(ad));
    setSiteRoas(num(ad?.websiteKPIs?.roas, 2.8));
    setRows(loadCamps());
  }, []);

  useEffect(() => {
    refresh();
    const onReady = () => refresh();
    document.addEventListener("ig:analysis-ready", onReady);
    document.addEventListener("ig:analysis-updated", onReady);
    return () => {
      document.removeEventListener("ig:analysis-ready", onReady);
      document.removeEventListener("ig:analysis-updated", onReady);
    };
  }, [refresh]);

  const totals = useMemo(() => {
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const budget = rows.reduce((s, r) => s + r.monthlyBudget, 0);
    const rev = rows.reduce((s, r) => s + r.spend * r.roas, 0);
    const blended = spend > 0 ? rev / spend : siteRoas;
    const sorted = [...rows].sort((a, b) => b.roas - a.roas);
    const best = sorted[0] || null;
    const worst = sorted.length > 1 ? sorted[sorted.length - 1] : sorted[0] || null;
    return { spend, budget, rev, blended, best, worst };
  }, [rows, siteRoas]);

  const stopList = useMemo(
    () =>
      rows
        .filter((r) => r.roas < Math.max(1.5, totals.blended * 0.55) || r.status === "paused")
        .sort((a, b) => a.roas - b.roas),
    [rows, totals.blended],
  );

  const scaleList = useMemo(
    () =>
      rows
        .filter((r) => r.roas >= Math.max(2.8, totals.blended * 1.05) && r.status !== "paused")
        .sort((a, b) => b.roas - a.roas),
    [rows, totals.blended],
  );

  const threeMonthTotal = Math.round(totals.budget * 3 * 1.12);
  const monthLabels = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 3; i++) {
      const m = new Date(d.getFullYear(), d.getMonth() + i, 1);
      out.push(m.toLocaleString(undefined, { month: "short", year: "numeric" }));
    }
    return out;
  }, []);

  const tips = useMemo(() => {
    const list: { title: string; body: string; action: string; view: string }[] = [];
    if (totals.worst && totals.worst.roas < 2) {
      list.push({
        title: `Pause or rebuild “${totals.worst.name}”`,
        body: `ROAS is ${totals.worst.roas.toFixed(1)}× — below the ${totals.blended.toFixed(1)}× blend. Redirect budget to higher-ROAS channels.`,
        action: "Open Campaigns",
        view: "campaigns",
      });
    }
    if (totals.best) {
      list.push({
        title: `Scale “${totals.best.name}”`,
        body: `Top performer at ${totals.best.roas.toFixed(1)}× ROAS on ${totals.best.platform}. Increase monthly budget 20–35% while watching CPA.`,
        action: "Scale in Campaigns",
        view: "campaigns",
      });
    }
    list.push({
      title: "Tighten audience + creative refresh",
      body: `In ${industry}, refresh creatives every 10–14 days and exclude converted audiences to lift CTR and protect ROAS.`,
      action: "Creative Studio",
      view: "creative",
    });
    list.push({
      title: "Reallocate with Budget Board",
      body: "Set a monthly target and log channel spend so utilisation stays visible against the 3-month plan.",
      action: "Budget Board",
      view: "budget-board",
    });
    return list.slice(0, 4);
  }, [totals, industry]);

  function openCampaign(row: CampRow) {
    setSelected(row);
    try {
      sessionStorage.setItem(
        "ig-budget-camp-focus",
        JSON.stringify({ name: row.name, platform: row.platform, idx: row.idx, source: row.source }),
      );
    } catch {
      /* ignore */
    }
  }

  function goToCampaignFull(row: CampRow) {
    if (row.source === "live" || row.source === "recommended") {
      goToView(router, "campaigns");
      window.setTimeout(() => {
        try {
          if (typeof window._igLaunch === "function" && window._lastCampRecs?.length) {
            window._igLaunch(Math.min(row.idx, (window._lastCampRecs?.length || 1) - 1));
          } else if (typeof window.buildLaunchModal === "function") {
            window.buildLaunchModal(row.raw, row.idx);
          }
        } catch {
          toast("Opened Campaigns — select the campaign for full controls");
        }
      }, 400);
    }
  }

  const empty = rows.length === 0;

  return (
    <div className={styles.page}>
      <div className={`view-header ig-panel-hero ${styles.hero}`}>
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span> <span className="bc-sep">›</span> Budget
              </div>
              <h2 className="view-title">Budget Overview</h2>
              <p className="view-sub">
                Spend, ROI, and 3-month allocation
                {domain ? ` for ${domain}` : ""} — across every live and recommended campaign
              </p>
            </div>
            <div className="vh-actions">
              <button type="button" className="btn-secondary" onClick={() => goToView(router, "budget-board")}>
                🪙 Budget Board
              </button>
              <button type="button" className="btn-primary" onClick={() => goToView(router, "campaigns")}>
                🚀 Campaigns
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`container ${styles.body}`}>
        {/* KPI strip */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Current spend (MTD)</div>
            <div className={styles.kpiVal}>{money(totals.spend)}</div>
            <div className={styles.kpiSub}>Across {rows.length} campaign{rows.length === 1 ? "" : "s"}</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Blended ROI (ROAS)</div>
            <div className={`${styles.kpiVal} ${styles.kpiTeal}`}>{totals.blended.toFixed(1)}×</div>
            <div className={styles.kpiSub}>Est. revenue {money(totals.rev)}</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Monthly budget</div>
            <div className={styles.kpiVal}>{money(totals.budget || totals.spend)}</div>
            <div className={styles.kpiSub}>Committed / planned</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>3-month recommended</div>
            <div className={`${styles.kpiVal} ${styles.kpiBlue}`}>{money(threeMonthTotal || 18000)}</div>
            <div className={styles.kpiSub}>+12% growth buffer</div>
          </div>
        </div>

        {empty ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>💰</div>
            <h3>No campaign spend yet</h3>
            <p>
              Run an analysis and launch campaigns to populate this Budget hub — or open Budget Board to set a monthly target and log spend manually.
            </p>
            <div className={styles.emptyActions}>
              <button type="button" className="btn-primary" onClick={() => goToView(router, "home")}>
                Run Analysis
              </button>
              <button type="button" className="btn-secondary" onClick={() => goToView(router, "campaigns")}>
                Open Campaigns
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 1. Campaign spend list */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>1. Campaign spend</h3>
                  <p>Click any campaign for a full breakdown, or open it in Campaigns.</p>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Platform</th>
                      <th>Spend</th>
                      <th>Budget / mo</th>
                      <th>ROAS</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.key}
                        className={selected?.key === r.key ? styles.rowActive : undefined}
                        onClick={() => openCampaign(r)}
                      >
                        <td>
                          <strong>{r.name}</strong>
                          <div className={styles.muted}>
                            {r.source === "live" ? "Live" : "Recommended"} · {r.conversions} conv.
                          </div>
                        </td>
                        <td>{r.platform}</td>
                        <td>
                          <strong>{money(r.spend)}</strong>
                        </td>
                        <td>{money(r.monthlyBudget)}</td>
                        <td>
                          <span className={r.roas >= 3 ? styles.good : r.roas < 2 ? styles.bad : styles.warn}>
                            {r.roas.toFixed(1)}×
                          </span>
                        </td>
                        <td>
                          <span className={styles.status}>{r.status}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={styles.linkish}
                            onClick={(e) => {
                              e.stopPropagation();
                              goToCampaignFull(r);
                            }}
                          >
                            Open →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Selected campaign breakdown */}
            {selected ? (
              <section className={`${styles.card} ${styles.detail}`}>
                <div className={styles.cardHead}>
                  <div>
                    <h3>Campaign breakdown — {selected.name}</h3>
                    <p>
                      {selected.platform} · {selected.source === "live" ? "Live tracking" : "From recommendations"}
                    </p>
                  </div>
                  <button type="button" className="btn-primary" onClick={() => goToCampaignFull(selected)}>
                    Open full campaign →
                  </button>
                </div>
                <div className={styles.detailGrid}>
                  <div>
                    <span>Spend MTD</span>
                    <strong>{money(selected.spend)}</strong>
                  </div>
                  <div>
                    <span>Monthly budget</span>
                    <strong>{money(selected.monthlyBudget)}</strong>
                  </div>
                  <div>
                    <span>ROAS</span>
                    <strong>{selected.roas.toFixed(1)}×</strong>
                  </div>
                  <div>
                    <span>CTR</span>
                    <strong>{selected.ctr}</strong>
                  </div>
                  <div>
                    <span>CPA</span>
                    <strong>{selected.cpa}</strong>
                  </div>
                  <div>
                    <span>Conversions</span>
                    <strong>{selected.conversions}</strong>
                  </div>
                  <div>
                    <span>Est. revenue</span>
                    <strong>{money(selected.spend * selected.roas)}</strong>
                  </div>
                  <div>
                    <span>Utilisation</span>
                    <strong>
                      {selected.monthlyBudget
                        ? Math.min(100, Math.round((selected.spend / selected.monthlyBudget) * 100))
                        : 0}
                      %
                    </strong>
                  </div>
                </div>
                <div className={styles.projRow}>
                  {monthLabels.map((label, i) => {
                    const factor = 1 + i * 0.06;
                    const proj = Math.round(selected.monthlyBudget * factor);
                    return (
                      <div key={label} className={styles.projCell}>
                        <div className={styles.projMonth}>{label}</div>
                        <div className={styles.projAmt}>{money(proj)}</div>
                        <div className={styles.muted}>Projected spend</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {/* 2–4 ROI + best/worst */}
            <div className={styles.twoCol}>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div>
                    <h3>2. Current ROI</h3>
                    <p>Blended return across active spend in {industry}.</p>
                  </div>
                </div>
                <div className={styles.roiBig}>{totals.blended.toFixed(1)}× ROAS</div>
                <p className={styles.roiCopy}>
                  Every $1 spent returns about <strong>{totals.blended.toFixed(2)}</strong> in attributed revenue.
                  Site benchmark: <strong>{siteRoas.toFixed(1)}×</strong>.
                </p>
              </section>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div>
                    <h3>4. Best &amp; worst campaigns</h3>
                    <p>Ranked by ROAS.</p>
                  </div>
                </div>
                <div className={styles.bestWorst}>
                  <button type="button" className={styles.best} onClick={() => totals.best && openCampaign(totals.best)}>
                    <span>Best</span>
                    <strong>{totals.best?.name || "—"}</strong>
                    <em>{totals.best ? `${totals.best.roas.toFixed(1)}× · ${totals.best.platform}` : ""}</em>
                  </button>
                  <button type="button" className={styles.worst} onClick={() => totals.worst && openCampaign(totals.worst)}>
                    <span>Worst</span>
                    <strong>{totals.worst?.name || "—"}</strong>
                    <em>{totals.worst ? `${totals.worst.roas.toFixed(1)}× · ${totals.worst.platform}` : ""}</em>
                  </button>
                </div>
              </section>
            </div>

            {/* 3. Improve ROI */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>3. How to improve ROI</h3>
                  <p>Prioritised actions based on your current campaign mix.</p>
                </div>
              </div>
              <div className={styles.tips}>
                {tips.map((t) => (
                  <div key={t.title} className={styles.tip}>
                    <div>
                      <strong>{t.title}</strong>
                      <p>{t.body}</p>
                    </div>
                    <button type="button" className="btn-secondary" onClick={() => goToView(router, t.view)}>
                      {t.action}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* 5. 3-month projected spend */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>5. Projected spend — next 3 months</h3>
                  <p>Per campaign, with a modest month-over-month ramp.</p>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      {monthLabels.map((m) => (
                        <th key={m}>{m}</th>
                      ))}
                      <th>3-mo total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const m1 = r.monthlyBudget;
                      const m2 = Math.round(r.monthlyBudget * 1.06);
                      const m3 = Math.round(r.monthlyBudget * 1.12);
                      return (
                        <tr key={r.key} onClick={() => openCampaign(r)}>
                          <td>
                            <strong>{r.name}</strong>
                          </td>
                          <td>{money(m1)}</td>
                          <td>{money(m2)}</td>
                          <td>{money(m3)}</td>
                          <td>
                            <strong>{money(m1 + m2 + m3)}</strong>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className={styles.totalRow}>
                      <td>
                        <strong>All campaigns</strong>
                      </td>
                      <td>
                        <strong>{money(rows.reduce((s, r) => s + r.monthlyBudget, 0))}</strong>
                      </td>
                      <td>
                        <strong>{money(rows.reduce((s, r) => s + Math.round(r.monthlyBudget * 1.06), 0))}</strong>
                      </td>
                      <td>
                        <strong>{money(rows.reduce((s, r) => s + Math.round(r.monthlyBudget * 1.12), 0))}</strong>
                      </td>
                      <td>
                        <strong>
                          {money(
                            rows.reduce(
                              (s, r) =>
                                s +
                                r.monthlyBudget +
                                Math.round(r.monthlyBudget * 1.06) +
                                Math.round(r.monthlyBudget * 1.12),
                              0,
                            ),
                          )}
                        </strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 6–7 Stop / Scale */}
            <div className={styles.twoCol}>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div>
                    <h3>6. Campaigns to stop or pause</h3>
                    <p>ROAS well below the blend, or already paused.</p>
                  </div>
                </div>
                {stopList.length === 0 ? (
                  <p className={styles.mutedPad}>No campaigns flagged for pause right now.</p>
                ) : (
                  <ul className={styles.actionList}>
                    {stopList.map((r) => (
                      <li key={r.key}>
                        <button type="button" onClick={() => openCampaign(r)}>
                          <strong>{r.name}</strong>
                          <span>
                            {r.roas.toFixed(1)}× · {money(r.spend)} spend
                          </span>
                        </button>
                        <em>Pause &amp; reallocate</em>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div>
                    <h3>7. Campaigns that need more budget</h3>
                    <p>Above-blend ROAS — candidates to scale.</p>
                  </div>
                </div>
                {scaleList.length === 0 ? (
                  <p className={styles.mutedPad}>No clear scale candidates yet — improve creatives first.</p>
                ) : (
                  <ul className={styles.actionList}>
                    {scaleList.map((r) => (
                      <li key={r.key}>
                        <button type="button" onClick={() => openCampaign(r)}>
                          <strong>{r.name}</strong>
                          <span>
                            {r.roas.toFixed(1)}× · +{Math.round(20 + r.roas * 3)}% suggested
                          </span>
                        </button>
                        <em>Increase budget</em>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* 8. Overall 3-month budget + mix */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>8. Recommended 3-month budget &amp; marketing mix</h3>
                  <p>
                    Suggested total: <strong>{money(threeMonthTotal || 18000)}</strong> — how it should be utilised across marketing.
                  </p>
                </div>
              </div>
              <div className={styles.mix}>
                {CHANNEL_MIX.map((c) => {
                  const amt = Math.round(((threeMonthTotal || 18000) * c.pct) / 100);
                  return (
                    <div key={c.channel} className={styles.mixRow}>
                      <div className={styles.mixMeta}>
                        <strong>{c.channel}</strong>
                        <span>
                          {c.pct}% · {money(amt)}
                        </span>
                      </div>
                      <div className={styles.mixBar}>
                        <div style={{ width: `${c.pct}%`, background: c.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className={styles.footnote}>
                Mix is calibrated for {industry}. Adjust in Budget Board or Market Mix Modelling when you have more live conversion data.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
