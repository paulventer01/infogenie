import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSessionWorkspace } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ws = await getSessionWorkspace();
  if (!ws) redirect("/");
  return (
    <AppShell email={ws.email} brandName={ws.analysis?.brandName}>
      {children}
    </AppShell>
  );
}
