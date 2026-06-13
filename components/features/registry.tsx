"use client";

// view id -> React component map for migrated dashboard panels.
//
// Keep this in lockstep with `lib/migratedViews.ts` (the MIGRATED_VIEWS list):
// every entry there should have a component here, and vice-versa. <MigratedPanel/>
// looks the active view up in this map to decide whether to render React or fall
// through to the replayed legacy panel.

import type { ComponentType } from "react";
import SeoRoadmap from "@/components/features/reach/SeoRoadmap";

export const MIGRATED_COMPONENTS: Record<string, ComponentType> = {
  "seo-roadmap": SeoRoadmap,
};
