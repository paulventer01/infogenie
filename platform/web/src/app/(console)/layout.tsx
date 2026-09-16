import { Suspense } from "react";
import ConsoleShell from "@/components/ConsoleShell";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Suspense boundary: the shell reads the URL (search params) to highlight the
  // active capability in the sidebar tree.
  return (
    <Suspense fallback={null}>
      <ConsoleShell>{children}</ConsoleShell>
    </Suspense>
  );
}
