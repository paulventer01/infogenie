import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSessionAgency } from "@/lib/session";
import { getActiveClient } from "@/lib/store";
import { allAgencyAlerts } from "@/lib/alerts";
import { complianceReady } from "@/lib/permissions";
import styles from "@/styles/mvp.module.css";
import Link from "next/link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const agency = await getSessionAgency();
  if (!agency) redirect("/");
  const client = getActiveClient(agency);
  const openAlerts = allAgencyAlerts(agency).filter((a) => a.status === "open").length;
  const showCompliance = !complianceReady(agency);

  return (
    <AppShell
      email={agency.email}
      agencyName={agency.agencyName}
      brandName={client?.analysis?.brandName || client?.name}
      clients={agency.clients.map((c) => ({ id: c.id, name: c.name }))}
      activeClientId={agency.activeClientId}
      openAlertCount={openAlerts}
    >
      {showCompliance ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`} style={{ marginBottom: 16 }}>
          GDPR / DPA acknowledgments incomplete —{" "}
          <Link href="/settings">complete compliance in Settings</Link> before pitching enterprise
          clients.
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
