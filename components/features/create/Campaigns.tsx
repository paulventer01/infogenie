"use client";

// React host for the legacy `campaigns` panel (was `buildCampaigns()` +
// `#view-campaigns` in index.html — the builder lives INLINE in app.js, not in a
// public/js module). Unlike the other Create-group ports, this panel calls NO
// `/api/*` endpoints: it derives its entire UI synchronously from the legacy
// `window.analysisData` global plus a set of helpers and mutable state that only
// exist inside app.js — `generateCampaignRecs()`, the launch/creative/landing/
// brand handlers (`window._igLaunch`, `window._igCreative`, …), the A/B-test
// manager (`launchABTest`, `window._abTests`), the launched-campaigns list
// (`window._launchedCampaigns`) and, critically, the queued counter-campaign
// list which is a `let`-scoped (non-window) variable in app.js and therefore
// unreachable from a separate React module.
//
// Because faithfully re-deriving every section (and re-running it after each of
// those handlers mutates legacy state and calls `buildCampaigns()` again) is
// impossible without editing app.js — which this task forbids — this component
// renders the canonical view header in JSX and mounts the real legacy builder
// into its own `#campaignsWrap` container. The result is the complete, real
// panel driven by real data, with every interaction working exactly as before.
// The legacy empty state ("Run an Analysis to See Campaign Recommendations") is
// produced by `buildCampaigns()` itself when `window.analysisData` is absent.

import { useEffect } from "react";
import { markNavPending, settleNavPending } from "@/lib/navPending";

interface CampaignsWindow {
  buildCampaigns?: () => void;
  _igLaunch?: (idx: number) => void;
  _lastCampRecs?: unknown[];
}

export default function Campaigns() {
  useEffect(() => {
    const w = window as unknown as CampaignsWindow;
    let timer: number | undefined;
    let tries = 0;
    const run = (): boolean => {
      if (typeof w.buildCampaigns === "function") {
        markNavPending("nav→campaigns");
        try {
          w.buildCampaigns();
        } catch {
          settleNavPending("campaigns");
          return false;
        }
        settleNavPending("campaigns");
        return true;
      }
      return false;
    };
    if (!run()) {
      timer = window.setInterval(() => {
        tries += 1;
        if (run() || tries > 40) {
          if (timer) window.clearInterval(timer);
        }
      }, 100);
    }
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, []);

  function onLaunch() {
    // Legacy provider-write launch is closed — drafting / approval / guarded
    // publishing requests remain the supported path.
    return;
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Campaigns
              </div>
              <h2 className="view-title">
                Campaign Intelligence &amp; Recommendations
              </h2>
              <p className="view-sub">
                AI-generated campaign improvements based on real competitor data
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                id="launchCampaignBtn"
                type="button"
                disabled
                title="Provider launch is disabled. Use campaign drafting and approval."
                aria-disabled="true"
                onClick={onLaunch}
                style={{ opacity: 0.55, cursor: "not-allowed" }}
              >
                Launch disabled
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" id="campaignsWrap" />
    </div>
  );
}
