import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLegacyShell } from "@/lib/legacyShell";
import AppShell from "@/components/layout/AppShell";
import LegacyBody from "@/components/layout/LegacyBody";
import LegacyScripts from "@/components/layout/LegacyScripts";
import SpaRouter from "@/components/layout/SpaRouter";
import LegacyNavBridge from "@/components/layout/LegacyNavBridge";
import MigratedPanel from "@/components/layout/MigratedPanel";

// Dashboard shell: collapsible left sidebar + main stage for all panels.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jar = await cookies();
  if (!jar.get("infogenie.sid")) {
    redirect("/login");
  }

  const { scripts } = getLegacyShell();

  return (
    <>
      <link rel="stylesheet" href="/style.css" precedence="default" />
      <AppShell>
        <LegacyBody />
        <MigratedPanel />
        {children}
      </AppShell>
      <SpaRouter />
      <LegacyNavBridge />
      <LegacyScripts scripts={scripts} />
    </>
  );
}
