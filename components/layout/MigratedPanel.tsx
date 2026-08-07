"use client";

import {
  Component,
  Suspense,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { pathToViewId } from "@/lib/viewRoutes";
import { markNavPending, settleNavPending } from "@/lib/navPending";
import { installDomSafetyPatch, isDomReconcileError } from "@/lib/domSafety";
import { MIGRATED_COMPONENTS } from "@/components/features/registry";

class PanelErrorBoundary extends Component<
  {
    children: ReactNode;
    view: string;
    /** Bumps when we need a clean remount after a DOM reconcile glitch. */
    remountKey: number;
    onDomGlitch: () => void;
  },
  { error: Error | null }
> {
  constructor(props: {
    children: ReactNode;
    view: string;
    remountKey: number;
    onDomGlitch: () => void;
  }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isDomReconcileError(error)) {
      console.warn(
        "[MigratedPanel] DOM reconcile glitch in view=" + this.props.view + " — remounting panel",
        error.message,
      );
      // Recover on next tick so we don't setState during the error path twice.
      queueMicrotask(() => this.props.onDomGlitch());
      return;
    }
    console.error("[MigratedPanel] component crash in view=" + this.props.view, error, info);
  }

  componentDidUpdate(prevProps: { view: string; remountKey: number }) {
    if (
      (prevProps.view !== this.props.view || prevProps.remountKey !== this.props.remountKey) &&
      this.state.error
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error && !isDomReconcileError(this.state.error)) {
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
    // Dom glitch: render null for one frame while remountKey bumps.
    if (this.state.error && isDomReconcileError(this.state.error)) {
      return <PanelFallback />;
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

/** Mounts only after the lazy panel chunk resolves — settles nav-pending after paint. */
function PanelReady({ view, children }: { view: string; children: ReactNode }) {
  useEffect(() => {
    settleNavPending(view);
  }, [view]);
  return children;
}

/**
 * Stable host for lazy panels. Keep Suspense + ErrorBoundary mounted across
 * view changes — only the inner panel is keyed. Remounting the boundary (via
 * key={view}) while Suspense is resolving races React's DOM reconciler and
 * throws NotFoundError: removeChild.
 *
 * Arm markNavPending in useLayoutEffect (not during render) when the view
 * changes. AppShell also calls markNavPending on click; this covers direct URL
 * loads / back-forward.
 */
export default function MigratedPanel() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [remountKey, setRemountKey] = useState(0);
  const armedView = useRef<string | null>(null);

  useEffect(() => {
    installDomSafetyPatch();
    setMounted(true);
  }, []);

  const view = pathToViewId(pathname);
  const Cmp = view ? MIGRATED_COMPONENTS[view] : undefined;

  useLayoutEffect(() => {
    if (!mounted || !view || !Cmp) return;
    if (armedView.current === view) return;
    armedView.current = view;
    markNavPending("nav→" + view);
  }, [mounted, view, Cmp]);

  const onDomGlitch = () => {
    setRemountKey((k) => k + 1);
  };

  if (!mounted || !view || !Cmp) return null;

  return (
    <div id="ig-react-panel" data-react-view={view}>
      <PanelErrorBoundary view={view} remountKey={remountKey} onDomGlitch={onDomGlitch}>
        <Suspense fallback={<PanelFallback />}>
          <PanelReady key={`${view}:${remountKey}`} view={view}>
            <Cmp />
          </PanelReady>
        </Suspense>
      </PanelErrorBoundary>
    </div>
  );
}
