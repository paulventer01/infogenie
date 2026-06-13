// Placeholder for Phase 2 (Dashboard Shell & Routing). The real dashboard
// chrome (navbar, sidebar, providers) lands here. Intentionally a pass-through
// for now so the route-group skeleton has a home without owning any route — no
// `page.tsx` exists in this group yet, so `/` still falls through to the legacy
// Express SPA via the rewrites in next.config.ts.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
