"use client";

import { Component, Suspense, type ErrorInfo, type ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { pathToViewId } from "@/lib/viewRoutes";
import { MIGRATED_COMPONENTS } from "@/components/features/registry";

class PanelErrorBoundary extends Component<
  { children: ReactNode; view: string },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode; view: string }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[MigratedPanel] component crash in view=" + this.props.view, error, info);
  }

  componentDidUpdate(prevProps: { view: string }) {
    if (prevProps.view !== this.props.view && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: "40px 24px",
            textAlign: "center",
            color: "#6b7280",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>⚠️</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            This panel encountered an error
          </div>
          <div style={{ fontSize: ".85rem" }}>
            Try refreshing the page. If it keeps happening, check the browser console for details.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function PanelFallback() {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        color: "#6b7280",
        fontSize: "0.9rem",
      }}
      aria-busy="true"
    >
      Loading panel…
    </div>
  );
}

// Renders the native React panel for the currently-routed view, if it has been
// migrated. Mounted once in the dashboard layout, it resolves the active view
// from the URL and renders the matching lazily-loaded component from the
// registry — otherwise it renders nothing and the replayed legacy `#view-*`
// panel handles the view as before.
//
// Registry entries are React.lazy loaders so only the active panel's module is
// fetched/evaluated — avoids multi-second main-thread stalls from importing
// every migrated panel on first navigation.
export default function MigratedPanel() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const view = pathToViewId(pathname);
  const Cmp = view ? MIGRATED_COMPONENTS[view] : undefined;
  if (!mounted || !view || !Cmp) return null;
  return (
    <div id="ig-react-panel" data-react-view={view}>
      <PanelErrorBoundary key={view} view={view}>
        <Suspense fallback={<PanelFallback />}>
          <Cmp />
        </Suspense>
      </PanelErrorBoundary>
    </div>
  );
}
