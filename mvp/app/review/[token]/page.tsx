import { notFound, redirect } from "next/navigation";
import { readAgency, writeAgency } from "@/lib/store";
import { decideApproval, findApprovalByToken } from "@/lib/approvals";
import styles from "@/styles/mvp.module.css";

async function clientDecide(formData: FormData) {
  "use server";
  const token = String(formData.get("token") || "");
  const status = String(formData.get("status") || "") as "approved" | "changes_requested";
  const note = String(formData.get("note") || "").trim();
  const agency = readAgency();
  if (!agency) redirect(`/review/${token}`);
  const found = findApprovalByToken(agency, token);
  if (!found) redirect(`/review/${token}`);
  writeAgency({
    ...agency,
    clients: agency.clients.map((c) => {
      if (c.id !== found.client.id) return c;
      return {
        ...c,
        approvals: (c.approvals || []).map((a) =>
          a.shareToken === token ? decideApproval(a, status, note || undefined) : a
        ),
      };
    }),
  });
  redirect(`/review/${token}?done=1`);
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const agency = readAgency();
  if (!agency) notFound();
  const found = findApprovalByToken(agency, token);
  if (!found) notFound();

  const { client, item } = found;

  return (
    <div className={styles.sharePage}>
      <header className={styles.shareHeader}>
        <p className={styles.eyebrow}>{agency.whiteLabel.agencyName}</p>
        <h1 className={styles.h1}>Review &amp; approve</h1>
        <p className={styles.sub}>
          {client.name} · {item.kind} · {item.title}
        </p>
      </header>

      {sp.done ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          Decision saved — thanks. Your agency team can see this in Approvals.
        </div>
      ) : null}

      <div className={`${styles.banner} ${item.status === "pending" ? styles.bannerWarn : styles.bannerInfo}`}>
        Status: <strong>{item.status.replace("_", " ")}</strong>
      </div>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{item.title}</h2>
        <pre className={styles.exportBox} style={{ marginTop: 12 }}>
          {item.preview}
        </pre>
      </section>

      {item.status === "pending" ? (
        <section className={styles.panel} style={{ marginTop: 16 }}>
          <h2 className={styles.panelTitle}>Your decision</h2>
          <form action={clientDecide} style={{ marginTop: 12 }}>
            <input type="hidden" name="token" value={token} />
            <div className={styles.field}>
              <label htmlFor="note">Comment (optional)</label>
              <textarea id="note" name="note" rows={3} placeholder="Looks good / please tweak headline…" />
            </div>
            <div className={styles.alertActions}>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                type="submit"
                name="status"
                value="approved"
              >
                Approve
              </button>
              <button
                className={`${styles.btn} ${styles.btnGhost}`}
                type="submit"
                name="status"
                value="changes_requested"
              >
                Request changes
              </button>
            </div>
          </form>
        </section>
      ) : item.note ? (
        <p className={styles.muted} style={{ marginTop: 16 }}>
          Note on file: {item.note}
        </p>
      ) : null}

      <footer className={styles.shareFoot}>
        Powered by InfoGenie MVP · {agency.whiteLabel.agencyName}
      </footer>
    </div>
  );
}
