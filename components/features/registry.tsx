"use client";

// view id -> React component map for migrated dashboard panels.
//
// Keep this in lockstep with `lib/migratedViews.ts` (the MIGRATED_VIEWS list):
// every entry there should have a component here, and vice-versa. <MigratedPanel/>
// looks the active view up in this map to decide whether to render React or fall
// through to the replayed legacy panel.

import type { ComponentType } from "react";
import SeoRoadmap from "@/components/features/reach/SeoRoadmap";
import Deliverability from "@/components/features/reach/Deliverability";
import WebVitals from "@/components/features/reach/WebVitals";
import TechStack from "@/components/features/analyse/TechStack";
import GrowthMethodology from "@/components/features/manage/GrowthMethodology";
import WhiteLabel from "@/components/features/manage/WhiteLabel";
import BulkReports from "@/components/features/manage/BulkReports";
import ModelCompare from "@/components/features/manage/ModelCompare";
import WebAnalytics from "@/components/features/manage/WebAnalytics";
import VerticalPlaybooks from "@/components/features/manage/VerticalPlaybooks";
import Flywheel from "@/components/features/manage/Flywheel";
import Playbook7Day from "@/components/features/manage/Playbook7Day";

export const MIGRATED_COMPONENTS: Record<string, ComponentType> = {
  "seo-roadmap": SeoRoadmap,
  deliverability: Deliverability,
  "web-vitals": WebVitals,
  "tech-stack": TechStack,
  "growth-methodology": GrowthMethodology,
  "white-label": WhiteLabel,
  "bulk-reports": BulkReports,
  "model-compare": ModelCompare,
  "web-analytics": WebAnalytics,
  "vertical-playbooks": VerticalPlaybooks,
  flywheel: Flywheel,
  "playbook-7day": Playbook7Day,
};
