"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, session, type Capability, type Tenant } from "@/lib/api";

const NAV = [
  { href: "/", label: "Overview", glyph: "◧" },
  { href: "/brand", label: "Brand Foundation", glyph: "◈" },
  { href: "/studio", label: "Capability Studio", glyph: "▶" },
  { href: "/actions", label: "Actions & Approvals", glyph: "⛨" },
  { href: "/integrations", label: "Integrations", glyph: "⇄" },
];

const DOMAIN_ORDER = ["compete", "grow", "reach", "manage", "analyse", "monitor", "create", "seo"];
const DOMAIN_LABELS: Record<string, string> = {
  compete: "Compete", grow: "Grow", reach: "Reach", manage: "Manage",
  analyse: "Analyse", monitor: "Monitor", create: "Create", seo: "SEO",
};

/** The capability tree that lives under "Capability Studio" in the sidebar:
 * each domain is a dropdown, each capability a sub-item that opens the Studio
 * with that capability selected. */
function CapabilityTree({
  capabilities, activeKey, onNavigate,
}: {
  capabilities: Capability[];
  activeKey: string | null;
  onNavigate: (key: string) => void;
}) {
  const [openDomain, setOpenDomain] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (activeKey) {
      const cap = capabilities.find((c) => c.key === activeKey);
      if (cap) setOpenDomain(cap.domain);
    }
  }, [activeKey, capabilities]);

  const byDomain = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? capabilities.filter((c) => c.name.toLowerCase().includes(q) || c.domain.includes(q) || (c.description ?? "").toLowerCase().includes(q))
      : capabilities;
    const m = new Map<string, Capability[]>();
    for (const c of filtered) {
      if (!m.has(c.domain)) m.set(c.domain, []);
      m.get(c.domain)!.push(c);
    }
    for (const caps of m.values()) caps.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [capabilities, filter]);

  const searching = filter.trim().length > 0;

  return (
    <div className="nav-tree">
      <div className="tree-search">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Search ${capabilities.length} capabilities…`}
          aria-label="Search capabilities"
        />
      </div>
      {DOMAIN_ORDER.filter((d) => byDomain.get(d)?.length).map((domain) => {
        const caps = byDomain.get(domain)!;
        const open = searching || openDomain === domain;
        return (
          <div key={domain} className={`cap-domain${open ? " open" : ""}`}>
            <button
              type="button"
              className="cap-domain-toggle"
              onClick={() => setOpenDomain(open && !searching ? null : domain)}
            >
              <span className="caret">{open ? "▾" : "▸"}</span>
              {DOMAIN_LABELS[domain] ?? domain}
              <span className="cap-count">{caps.length}</span>
            </button>
            {open && (
              <div className="cap-items">
                {caps.map((c) => (
                  <button
                    type="button"
                    key={c.key}
                    className={`cap-item${c.key === activeKey ? " selected" : ""}`}
                    onClick={() => onNavigate(c.key)}
                  >
                    {c.name}
                    {c.irreversible && <span className="cap-flag">A2 max</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
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
    api.capabilities().then((r) => { setEngine(r.engine); setCapabilities(r.capabilities); }).catch(() => {});
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

  const activeCapKey = pathname === "/studio" ? searchParams.get("cap") : null;

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
            <div key={item.href}>
              <Link
                href={item.href}
                className={pathname === item.href ? "active" : ""}
              >
                <span className="glyph" aria-hidden>{item.glyph}</span>
                {item.label}
              </Link>
              {item.href === "/studio" && capabilities.length > 0 && (
                <CapabilityTree
                  capabilities={capabilities}
                  activeKey={activeCapKey}
                  onNavigate={(key) => router.push(`/studio?cap=${encodeURIComponent(key)}`)}
                />
              )}
            </div>
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
