import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLegacyShell } from "@/lib/legacyShell";
import Navbar from "@/components/layout/Navbar";
import LegacyBody from "@/components/layout/LegacyBody";
import LegacyScripts from "@/components/layout/LegacyScripts";
import SpaRouter from "@/components/layout/SpaRouter";

// Phase 2 dashboard shell. In DEV, Next owns `/` and every /<group>/<view>
// route; this layout renders the React <Navbar/> plus the legacy SPA body and
// replays its scripts, so all 200+ #view-* panels and navigateTo() keep working
// with no regression. Auth is guarded here (cookie presence) as defense in depth
// alongside middleware.ts — unauthenticated visitors are sent to /login.
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
      {/* Legacy stylesheet (served by Express via the next.config fallback). */}
      <link rel="stylesheet" href="/style.css" />
      <Navbar />
      <LegacyBody />
      {children}
      <SpaRouter />
      <LegacyScripts scripts={scripts} />
    </>
  );
}
