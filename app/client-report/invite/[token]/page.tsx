"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { redeemInvite } from "@/lib/clientReportingPortal";
import { responseError } from "@/lib/clientReporting";

export default function ClientReportInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = typeof params.token === "string" ? params.token : "";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!token) { setError("Invalid invitation link."); setBusy(false); return; }
      const result = await redeemInvite(token);
      if (!active) return;
      const failure = responseError(result);
      if (failure) {
        setError(failure === "invitation_expired" ? "This invitation has expired. Ask your agency for a new link."
          : failure === "invitation_redeemed" ? "This invitation was already used."
            : failure === "invitation_revoked" || failure === "portal_revoked" ? "Portal access has been revoked."
              : failure === "invitation_not_found" ? "Invitation link not found."
                : "This invitation could not be redeemed.");
        setBusy(false);
        return;
      }
      router.replace("/client-report/view");
    }
    void run();
    return () => { active = false; };
  }, [token, router]);

  return <main style={{ maxWidth: 560, margin: "48px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#0F172A" }}>
    <h1>Client reporting portal</h1>
    {busy && !error && <p role="status">Verifying your invitation…</p>}
    {error && <>
      <p role="alert" style={{ color: "#991B1B" }}>{error}</p>
      <p><Link href="/login">Return to login</Link></p>
    </>}
  </main>;
}
