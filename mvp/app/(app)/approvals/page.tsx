import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAgency, getSessionClient } from "@/lib/session";
import { updateClient, writeAgency } from "@/lib/store";
import {
  allApprovals,
  createApprovalFromCampaign,
  createApprovalFromDraft,
  createApprovalFromReport,
  decideApproval,
} from "@/lib/approvals";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

async function submitDraft(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const draftId = String(formData.get("draftId") || "");
  const item = createApprovalFromDraft(ctx.client, draftId);
  if (!item) redirect("/approvals");
  updateClient(ctx.agency, ctx.client.id, (c) => ({
    ...c,
    approvals: [item, ...(c.approvals || [])],
  }));
  redirect("/approvals");
}

async function submitCampaign(formData: FormData) {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const campaignId = String(formData.get("campaignId") || "");
  const item = createApprovalFromCampaign(ctx.client, campaignId);
  if (!item) redirect("/approvals");
  updateClient(ctx.agency, ctx.client.id, (c) => ({
    ...c,
    approvals: [item, ...(c.approvals || [])],
  }));
  redirect("/approvals");
}

async function submitReport() {
  "use server";
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const item = createApprovalFromReport(ctx.client);
  if (!item) redirect("/approvals?error=no-report");
  updateClient(ctx.agency, ctx.client.id, (c) => ({
    ...c,
    approvals: [item, ...(c.approvals || [])],
  }));
  redirect("/approvals");
}

async function decide(formData: FormData) {
  "use server";
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const approvalId = String(formData.get("approvalId") || "");
  const clientId = String(formData.get("clientId") || "");
  const status = String(formData.get("status") || "") as "approved" | "changes_requested";
  const note = String(formData.get("note") || "").trim();
  writeAgency({
    ...agency,
    clients: agency.clients.map((c) => {
      if (c.id !== clientId) return c;
      return {
        ...c,
        approvals: (c.approvals || []).map((a) =>
          a.id === approvalId ? decideApproval(a, status, note || undefined) : a
        ),
      };
    }),
  });
  redirect("/approvals");
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getSessionClient();
  if (!ctx) redirect("/");
  const sp = await searchParams;
  const queue = allApprovals(ctx.agency);
  const pending = queue.filter((a) => a.status === "pending");

  return (
    <>
      <PageHeader
        eyebrow="Collaboration · MVP thin"
        title="Approvals"
        sub="Send drafts, campaigns, and weekly reports for client review — one queue, shareable link, no email chaos."
      />

      {sp.error === "no-report" ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Generate a weekly report first, then submit it for approval.
        </div>
      ) : null}

      <div className={styles.grid3} style={{ marginBottom: 16 }}>
        <div className={`${styles.panel} ${styles.statPanel}`}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>{pending.length}</span>
            <span className={styles.metricLbl}>Pending</span>
          </div>
        </div>
        <div className={`${styles.panel} ${styles.statPanel}`}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>
              {queue.filter((a) => a.status === "approved").length}
            </span>
            <span className={styles.metricLbl}>Approved</span>
          </div>
        </div>
        <div className={`${styles.panel} ${styles.statPanel}`}>
          <div className={styles.metric}>
            <span className={styles.metricVal}>
              {queue.filter((a) => a.status === "changes_requested").length}
            </span>
            <span className={styles.metricLbl}>Changes requested</span>
          </div>
        </div>
      </div>

      <div className={styles.grid2}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Submit from {ctx.client.name}</h2>
          <div style={{ marginTop: 12 }}>
            {ctx.client.drafts.length === 0 && ctx.client.campaigns.length === 0 ? (
              <p className={styles.muted}>Create a draft or campaign first, then submit here.</p>
            ) : null}
            <ul className={styles.list}>
              {ctx.client.drafts.slice(0, 5).map((d) => (
                <li key={d.id} className={styles.listItem}>
                  <strong>{d.title}</strong>
                  <span className={styles.muted}>{d.kind}</span>
                  <form action={submitDraft} style={{ marginTop: 8 }}>
                    <input type="hidden" name="draftId" value={d.id} />
                    <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                      Send for approval
                    </button>
                  </form>
                </li>
              ))}
              {ctx.client.campaigns.slice(0, 5).map((c) => (
                <li key={c.id} className={styles.listItem}>
                  <strong>{c.name}</strong>
                  <span className={styles.muted}>{c.objective}</span>
                  <form action={submitCampaign} style={{ marginTop: 8 }}>
                    <input type="hidden" name="campaignId" value={c.id} />
                    <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                      Send campaign for approval
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            {ctx.client.weeklyReport ? (
              <form action={submitReport} style={{ marginTop: 12 }}>
                <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                  Submit weekly report
                </button>
              </form>
            ) : null}
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Agency queue</h2>
          {queue.length === 0 ? (
            <p className={styles.muted}>No approval items yet.</p>
          ) : (
            <ul className={styles.list}>
              {queue.map((item) => (
                <li key={item.id} className={styles.listItem}>
                  <strong>
                    {item.title}{" "}
                    <span className={styles.chip} style={{ marginLeft: 6 }}>
                      {item.status}
                    </span>
                  </strong>
                  <span className={styles.muted}>
                    {item.clientName} · {item.kind}
                  </span>
                  <pre className={styles.exportBox} style={{ marginTop: 8, maxHeight: 120 }}>
                    {item.preview.slice(0, 280)}
                    {item.preview.length > 280 ? "…" : ""}
                  </pre>
                  {item.note ? (
                    <p className={styles.muted} style={{ marginTop: 8 }}>
                      Note: {item.note}
                    </p>
                  ) : null}
                  <div className={styles.alertActions}>
                    <Link
                      className={`${styles.btn} ${styles.btnGhost}`}
                      href={`/review/${item.shareToken}`}
                    >
                      Client link
                    </Link>
                    {item.status === "pending" ? (
                      <>
                        <form action={decide}>
                          <input type="hidden" name="approvalId" value={item.id} />
                          <input type="hidden" name="clientId" value={item.clientId} />
                          <input type="hidden" name="status" value="approved" />
                          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                            Approve
                          </button>
                        </form>
                        <form action={decide}>
                          <input type="hidden" name="approvalId" value={item.id} />
                          <input type="hidden" name="clientId" value={item.clientId} />
                          <input type="hidden" name="status" value="changes_requested" />
                          <input type="hidden" name="note" value="Please revise and resubmit" />
                          <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                            Request changes
                          </button>
                        </form>
                      </>
                    ) : null}
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
