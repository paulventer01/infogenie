"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, session, type Tenant } from "@/lib/api";

const NAV = [
  { href: "/", label: "Overview", glyph: "◧" },
  { href: "/brand", label: "Brand Foundation", glyph: "◈" },
  { href: "/studio", label: "Capability Studio", glyph: "▶" },
  { href: "/actions", label: "Actions & Approvals", glyph: "⛨" },
];

export default function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [engine, setEngine] = useState<"live" | "mock" | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!session.token) {
      router.replace("/login");
      return;
    }
    setTenantId(session.tenantId);
    api
      .myTenants()
      .then(({ tenants }) => {
        setTenants(tenants);
        if (!session.tenantId && tenants[0]) {
          session.tenantId = tenants[0].id;
          setTenantId(tenants[0].id);
        }
        setReady(true);
      })
      .catch(() => router.replace("/login"));
    api.capabilities().then((r) => setEngine(r.engine)).catch(() => {});
    // Intentionally runs once on mount: session state is read from storage.
  }, [router]);

  function switchTenant(id: string) {
    session.tenantId = id;
    setTenantId(id);
    // Full reload so every page refetches under the new tenant context.
    window.location.reload();
  }

  function signOut() {
    session.clear();
    router.replace("/login");
  }

  if (!ready) return null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">IG</div>
          <div>
            <b>InfoGenie</b>
            <small>Operator Console</small>
          </div>
        </div>
        <div className="nav-label">Workspace</div>
        <nav className="nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "active" : ""}
            >
              <span className="glyph" aria-hidden>{item.glyph}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          Every action here is grounded in brand context, checked by the guardrail gate, and written to the audit rail.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <select
            aria-label="Active tenant"
            value={tenantId ?? ""}
            onChange={(e) => switchTenant(e.target.value)}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.type === "agency" ? "⌂ " : ""}{t.name}
              </option>
            ))}
          </select>
          <div className="topbar-right">
            {engine && (
              <span className={`engine-pill ${engine}`}>
                {engine === "live" ? "ENGINE · LIVE" : "ENGINE · MOCK"}
              </span>
            )}
            <button className="signout" onClick={signOut}>Sign out</button>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
