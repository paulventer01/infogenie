import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLegacyShell } from "@/lib/legacyShell";
import Navbar from "@/components/layout/Navbar";
import LegacyBody from "@/components/layout/LegacyBody";
import LegacyScripts from "@/components/layout/LegacyScripts";
import SpaRouter from "@/components/layout/SpaRouter";
import LegacyNavBridge from "@/components/layout/LegacyNavBridge";
import MigratedPanel from "@/components/layout/MigratedPanel";

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
      {/*
        Legacy stylesheet (served by Express via the next.config fallback).
        `precedence` makes React treat it as a managed stylesheet *resource*: it
        is hoisted into <head> — identically on the server and the client — and
        first paint is blocked until it loads. Without `precedence` React leaves
        it as a plain in-body <link>, which (a) paints the shell unstyled and
        then restyles once /style.css arrives (the visible flash/redraw) and
        (b) is the in-body-vs-hoisted discrepancy that surfaced as a hydration
        mismatch. Hoisting it as a resource fixes both at the root.
      */}
      <link rel="stylesheet" href="/style.css" precedence="default" />
      <Navbar />
      <LegacyBody />
      <MigratedPanel />
      {children}
      <SpaRouter />
      <LegacyNavBridge />
      <LegacyScripts scripts={scripts} />
    </>
  );
}
